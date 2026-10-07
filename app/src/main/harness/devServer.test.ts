import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startDevServer, waitForPort } from './devServer'

function randomPort(): number {
  return 35000 + Math.floor(Math.random() * 10_000)
}

describe('waitForPort', () => {
  it('resolves false quickly when nothing is listening', async () => {
    const result = await waitForPort(randomPort(), { timeoutMs: 500, intervalMs: 100 })
    expect(result).toBe(false)
  })
})

describe('startDevServer / stop — real process execution (no mocking, no API cost)', () => {
  it('starts a real command that opens a real port, confirmed by a real connection', async () => {
    const port = randomPort()
    const command = `${process.execPath} -e "require('net').createServer(s=>s.end()).listen(${port})"`
    const handle = startDevServer(process.cwd(), command)
    try {
      const up = await waitForPort(port, { timeoutMs: 5_000, intervalMs: 200 })
      expect(up).toBe(true)
    } finally {
      handle.stop()
    }
  }, 10_000)

  it('actually kills the real listening process on stop(), not just the shell wrapping it', async () => {
    const port = randomPort()
    const command = `${process.execPath} -e "require('net').createServer(s=>s.end()).listen(${port})"`
    const handle = startDevServer(process.cwd(), command)

    const up = await waitForPort(port, { timeoutMs: 5_000, intervalMs: 200 })
    expect(up).toBe(true)

    handle.stop()
    await new Promise((r) => setTimeout(r, 500))

    const stillUp = await waitForPort(port, { timeoutMs: 500, intervalMs: 100 })
    expect(stillUp).toBe(false)
  }, 10_000)

  it('kills the real listening process for a "node <scriptfile>" command — the exact shape that exposed a real orphaned-process bug (shell exec-replacement is not guaranteed, so a plain process-group kill cannot be relied on alone)', async () => {
    const port = randomPort()
    const dir = mkdtempSync(join(tmpdir(), 'laird-devserver-script-'))
    writeFileSync(join(dir, 'server.js'), `require('net').createServer(s=>s.end()).listen(${port})`)
    const handle = startDevServer(dir, 'node server.js')

    const up = await waitForPort(port, { timeoutMs: 5_000, intervalMs: 200 })
    expect(up).toBe(true)

    handle.stop()
    await new Promise((r) => setTimeout(r, 500))

    const stillUp = await waitForPort(port, { timeoutMs: 500, intervalMs: 100 })
    expect(stillUp).toBe(false)
  }, 10_000)

  it('does not throw when the command itself fails to spawn', () => {
    expect(() => startDevServer(process.cwd(), '/definitely/does/not/exist-binary-xyz')).not.toThrow()
  })

  it('stop() is safe to call twice', async () => {
    const port = randomPort()
    const command = `${process.execPath} -e "require('net').createServer(s=>s.end()).listen(${port})"`
    const handle = startDevServer(process.cwd(), command)
    await waitForPort(port, { timeoutMs: 5_000, intervalMs: 200 })
    expect(() => {
      handle.stop()
      handle.stop()
    }).not.toThrow()
  }, 10_000)
})
