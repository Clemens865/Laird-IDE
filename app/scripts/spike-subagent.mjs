#!/usr/bin/env node
// Workstream C chunk 4 spike: what does the real `claude -p
// --output-format stream-json` NDJSON stream actually look like when the
// main agent spawns a subagent? Needed to design the live subagent roster
// on real data, not assumption. No Electron, no IPC — just the raw CLI,
// run directly with `node`. Real findings from the live run this produced
// are recorded in docs/prd and the implementation plan's Workstream C
// section, and are what `mapEvents.ts`/`sessionManager.ts` are built
// against.
//
// Real, live-confirmed findings:
// - The tool that spawns a subagent is named "Agent" in this CLI version
//   (not "Task" — both names are harmlessly present in permissions.ts's
//   FULL_ALLOWED list).
// - Live status comes from a separate family of "system" events, not from
//   the Agent tool_use/tool_result pair itself: task_started (spawned),
//   task_progress (last_tool_name updates), task_updated (a patch.status of
//   completed/failed), task_notification (final, with a plain-language
//   summary) — all four keyed by a stable task_id, distinct from the
//   Agent tool_use's own id.

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratchDir = mkdtempSync(join(tmpdir(), 'laird-subagent-spike-'))
const prompt =
  'Use the Task tool to launch a subagent (general-purpose type) with the instruction: ' +
  '"Count the number of files in the current directory and reply with just the number." ' +
  'Wait for its result and then reply with exactly that number and nothing else.'

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
  '--allowedTools', 'Task,Read,Glob,Bash(ls:*)',
]

console.error('[spike] scratch dir:', scratchDir)
console.error('[spike] spawning: claude', args.join(' '))

const child = spawn('claude', args, { cwd: scratchDir, stdio: ['pipe', 'pipe', 'pipe'] })
child.stdin.write(prompt)
child.stdin.end()

let buffer = ''
const lines = []
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 1)
    if (line.trim()) lines.push(line)
  }
})
child.stderr.on('data', (d) => console.error('[stderr]', d.toString()))
child.on('close', (code) => {
  console.error('[spike] exit code', code)
  console.error('[spike] total lines:', lines.length)
  const taskLines = lines.filter((l) => l.includes('"subtype":"task_'))
  console.error('[spike] task_* lines (the live-status signal this chunk needed):')
  for (const line of taskLines) console.log(line)
})
