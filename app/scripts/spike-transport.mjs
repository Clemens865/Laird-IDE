#!/usr/bin/env node
// Chunk 1 of Workstream A (Foundation): standalone proof that the verified
// `claude -p --output-format stream-json` recipe round-trips a real prompt
// that edits a real file, mapped to ActivityLogEntry/Turn-shaped JSON.
// No Electron, no IPC — just the transport, run directly with `node`.
//
// Verified command shape (see docs/prd/technical/architecture-and-data.md
// and the approved plan at ~/.claude/plans/tidy-snuggling-pebble.md):
// - prompt via stdin, never argv
// - never --bare (breaks subscription auth)
// - --settings disableAllHooks + --mcp-config empty + --strict-mcp-config
//   + --setting-sources project, to keep a Foundation session isolated
//   from ambient hooks/MCP/global skills

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratchDir = mkdtempSync(join(tmpdir(), 'laird-spike-'))
const targetFile = join(scratchDir, 'hello.txt')
const expectedContent = 'Laird spike works'
const prompt = `Create a file named hello.txt in the current directory containing exactly this text with no trailing newline: ${expectedContent}`

const args = [
  '-p',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--verbose',
  '--model', 'claude-haiku-4-5-20251001',
  '--settings', JSON.stringify({ disableAllHooks: true }),
  '--mcp-config', JSON.stringify({ mcpServers: {} }),
  '--strict-mcp-config',
  '--setting-sources', 'project',
  '--allowedTools', 'Write,Read,Edit,Glob,Grep',
]

console.error('[spike] scratch dir:', scratchDir)
console.error('[spike] spawning: claude', args.join(' '))

const child = spawn('claude', args, {
  cwd: scratchDir,
  stdio: ['pipe', 'pipe', 'pipe'],
})

child.stdin.write(prompt)
child.stdin.end()

let buffer = ''
const activityLog = []

function mapLine(obj) {
  const out = []
  if (obj.type === 'system' && obj.subtype === 'init') {
    out.push({ kind: 'session-id', payload: { sessionId: obj.session_id, model: obj.model } })
  } else if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
    for (const block of obj.message.content) {
      if (block.type === 'text' && block.text) {
        out.push({ kind: 'text', payload: { text: block.text } })
      } else if (block.type === 'tool_use') {
        out.push({ kind: 'tool-call', payload: { name: block.name, input: block.input } })
      }
      // 'thinking' blocks deliberately discarded — never surfaced, per pillar 2.
    }
  } else if (obj.type === 'result') {
    out.push({
      kind: 'usage',
      payload: { costUsd: obj.total_cost_usd, durationMs: obj.duration_ms, isError: obj.is_error, result: obj.result },
    })
  }
  return out
}

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 1)
    if (!line.trim()) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      console.error('[spike] unparseable line, skipping:', line.slice(0, 200))
      continue
    }
    const mapped = mapLine(obj)
    for (const entry of mapped) {
      activityLog.push(entry)
      console.log(JSON.stringify(entry))
    }
  }
})

let stderrBuf = ''
child.stderr.on('data', (d) => {
  stderrBuf += d.toString()
})

child.on('error', (err) => {
  console.error('[spike] FAILURE: failed to spawn claude:', err.message)
  process.exitCode = 1
})

child.on('exit', (code) => {
  console.error(`\n[spike] claude exited with code ${code}`)
  if (stderrBuf.trim()) console.error('[spike] stderr:', stderrBuf.trim())

  const fileOk = existsSync(targetFile) && readFileSync(targetFile, 'utf8').trim() === expectedContent
  const usageEntry = activityLog.find((e) => e.kind === 'usage')
  const sawToolCall = activityLog.some((e) => e.kind === 'tool-call' && e.payload.name === 'Write')

  console.error('\n[spike] --- verification ---')
  console.error('[spike] real file created with exact expected content:', fileOk)
  console.error('[spike] a Write tool-call was observed in the mapped stream:', sawToolCall)
  console.error('[spike] usage/result event captured:', Boolean(usageEntry), usageEntry?.payload)

  if (fileOk && sawToolCall && usageEntry && !usageEntry.payload.isError) {
    console.error('\n[spike] PASS: round trip verified end to end.')
    process.exitCode = 0
  } else {
    console.error('\n[spike] FAIL: one or more checks did not pass.')
    process.exitCode = 1
  }
})
