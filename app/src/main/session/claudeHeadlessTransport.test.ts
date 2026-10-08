import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ClaudeHeadlessTransport } from './claudeHeadlessTransport'

/**
 * Chunk 5 hardening: these tests use a real, harmless child process (a hung
 * `node -e` one-liner standing in for "claude" via the injectable spawnFn —
 * no real `claude` CLI, no API cost) to verify the idle-timeout and
 * kill-on-stop behavior actually work, not just that the code looks right.
 */
function spawnHungProcess(): ReturnType<typeof spawn> {
  // Never writes to stdout, never exits on its own — the real-world shape
  // of a hung `claude` run this logic has to be able to kill.
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
}

describe('ClaudeHeadlessTransport hardening', () => {
  it('kills a hung process after the idle timeout and reports the failure', async () => {
    const transport = new ClaudeHeadlessTransport({
      idleTimeoutMs: 150,
      spawnFn: () => spawnHungProcess() as never,
    })

    const exitInfo = await new Promise<{ code: number | null; failure?: { kind: string } }>((resolve) => {
      transport.onExit(resolve)
      transport.start({ cwd: '/tmp', prompt: 'irrelevant — spawnFn ignores real claude args' })
    })

    expect(exitInfo.failure?.kind).toBe('idle-timeout')
  })

  it('actually terminates the real OS process on stop(), not just internal state', async () => {
    let child: ReturnType<typeof spawn> | null = null
    const transport = new ClaudeHeadlessTransport({
      spawnFn: () => {
        child = spawnHungProcess()
        return child as never
      },
    })

    transport.start({ cwd: '/tmp', prompt: 'irrelevant' })
    await new Promise((r) => setTimeout(r, 50)) // let the process actually start

    expect(child).not.toBeNull()
    expect(child!.exitCode).toBeNull() // still running

    const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()))
    transport.stop()
    await exited

    expect(child!.killed || child!.exitCode !== null).toBe(true)
  })

  it('a stdout chunk arriving just after stop() is ignored outright — the real race that kept Electron\'s main process alive for up to 2 minutes after quit', async () => {
    let child: ReturnType<typeof spawn> | null = null
    const transport = new ClaudeHeadlessTransport({
      spawnFn: () => {
        child = spawnHungProcess()
        return child as never
      },
    })
    const events: unknown[] = []
    transport.onEvent((e) => events.push(e))

    transport.start({ cwd: '/tmp', prompt: 'irrelevant' })
    await new Promise((r) => setTimeout(r, 50))

    transport.stop()
    // The real-world race, reproduced directly: the OS pipe can still
    // deliver one more buffered chunk after SIGTERM is sent, before the
    // child is actually reaped — simulated here by emitting on the real
    // stdout stream by hand, since real timing isn't reliably controllable
    // in a test.
    child!.stdout!.emit('data', Buffer.from('{"type":"result","total_cost_usd":0.01,"duration_ms":1,"is_error":false,"result":"late"}\n'))

    expect(events).toHaveLength(0) // handleChunk must have returned early, not processed or re-armed anything
  })

  it('every timer this class owns is unref()d — none of them can keep the parent process alive on their own', async () => {
    let child: ReturnType<typeof spawn> | null = null
    const transport = new ClaudeHeadlessTransport({
      idleTimeoutMs: 50,
      spawnFn: () => {
        child = spawnHungProcess()
        return child as never
      },
    })
    transport.start({ cwd: '/tmp', prompt: 'irrelevant' })
    await new Promise((r) => setTimeout(r, 10))

    // hasRef() reflects whether the timer would hold the event loop open — must be false immediately, not just eventually.
    const idleTimer = (transport as unknown as { idleTimer: NodeJS.Timeout | null }).idleTimer
    expect(idleTimer?.hasRef()).toBe(false)

    transport.stop()
  })

  it('allowedToolsOverride replaces the tier-based args entirely, and mcpServers replaces the default empty config', () => {
    let capturedArgs: string[] = []
    const transport = new ClaudeHeadlessTransport({
      permissionTier: 'read',
      allowedToolsOverride: ['Read', 'mcp__playwright__*'],
      mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } },
      spawnFn: ((_cmd: string, args: string[]) => {
        capturedArgs = args
        return spawnHungProcess()
      }) as never,
    })
    transport.start({ cwd: '/tmp', prompt: 'irrelevant' })
    transport.stop()

    const allowedToolsIndex = capturedArgs.indexOf('--allowedTools')
    expect(capturedArgs[allowedToolsIndex + 1]).toBe('Read,mcp__playwright__*')
    const mcpConfigIndex = capturedArgs.indexOf('--mcp-config')
    expect(JSON.parse(capturedArgs[mcpConfigIndex + 1])).toEqual({ mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } } })
  })

  it('without jevGuard, hooks stay fully disabled and setting-sources stays "project" — byte-identical to every prior session', () => {
    let capturedArgs: string[] = []
    const transport = new ClaudeHeadlessTransport({
      spawnFn: ((_cmd: string, args: string[]) => {
        capturedArgs = args
        return spawnHungProcess()
      }) as never,
    })
    transport.start({ cwd: '/tmp', prompt: 'irrelevant' })
    transport.stop()

    const settingsIndex = capturedArgs.indexOf('--settings')
    expect(JSON.parse(capturedArgs[settingsIndex + 1])).toEqual({ disableAllHooks: true })
    const sourcesIndex = capturedArgs.indexOf('--setting-sources')
    expect(capturedArgs[sourcesIndex + 1]).toBe('project')
  })

  it('jevGuard re-enables hooks for exactly one Laird-authored PreToolUse command and drops project from setting-sources', () => {
    let capturedArgs: string[] = []
    let capturedEnv: NodeJS.ProcessEnv | undefined
    const transport = new ClaudeHeadlessTransport({
      jevGuard: { apiKey: 'sk-test-guard-key', hookCommand: "ELECTRON_RUN_AS_NODE=1 '/path/to/electron' '/path/to/jevGuardHookEntry.js'" },
      spawnFn: ((_cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
        capturedArgs = args
        capturedEnv = opts?.env
        return spawnHungProcess()
      }) as never,
    })
    transport.start({ cwd: '/tmp', prompt: 'irrelevant' })
    transport.stop()

    const settingsIndex = capturedArgs.indexOf('--settings')
    expect(JSON.parse(capturedArgs[settingsIndex + 1])).toEqual({
      disableAllHooks: false,
      hooks: {
        PreToolUse: [
          { matcher: '*', hooks: [{ type: 'command', command: "ELECTRON_RUN_AS_NODE=1 '/path/to/electron' '/path/to/jevGuardHookEntry.js'" }] },
        ],
      },
    })
    const sourcesIndex = capturedArgs.indexOf('--setting-sources')
    expect(capturedArgs[sourcesIndex + 1]).toBe('')
    expect(capturedEnv?.LAIRD_TYPESAFE_KEY).toBe('sk-test-guard-key')
  })
})
