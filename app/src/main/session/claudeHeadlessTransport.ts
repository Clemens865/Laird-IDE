import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mapEvents } from './mapEvents'
import { buildPermissionArgs } from './permissions'
import type { PermissionTier } from '../../shared/types'
import type {
  SessionTransport,
  SessionTransportEvent,
  SessionTransportExitInfo,
  SessionTransportStartOptions,
} from './transport'

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60_000
const KILL_GRACE_MS = 3_000

export interface ClaudeHeadlessTransportOptions {
  /** Injectable for tests — never touches a real process in the unit suite. */
  spawnFn?: typeof spawn
  permissionTier?: PermissionTier
  /** Injectable so hardening tests can verify idle-timeout kill behavior without waiting 2 minutes. */
  idleTimeoutMs?: number
  /**
   * Bypasses `buildPermissionArgs(permissionTier)` entirely when provided —
   * for a narrow, call-specific tool grant that doesn't fit the general
   * tiered model (e.g. harness mode's UI-reviewer pass, which needs
   * Playwright MCP tools but should stay just as read-only/check-only as an
   * ordinary `read`-tier reviewer otherwise).
   */
  allowedToolsOverride?: string[]
  /**
   * Overrides the default zero-MCP-servers config when provided — still
   * passed alongside `--strict-mcp-config`, so it's still an explicit,
   * call-specific grant, never ambient project/user MCP config.
   */
  mcpServers?: Record<string, unknown>
}

/**
 * Primary SessionTransport implementation: a trimmed port of Workspace-OS's
 * `launchRun.ts`, live-verified against the real `claude` CLI in chunk 1's
 * spike (app/scripts/spike-transport.mjs). See docs/prd/technical/
 * architecture-and-data.md and the approved Foundation plan for the full
 * command-shape rationale (never --bare, hooks/MCP disabled, project-only
 * setting sources).
 */
export class ClaudeHeadlessTransport implements SessionTransport {
  private readonly spawnFn: typeof spawn
  private readonly permissionTier: PermissionTier
  private readonly idleTimeoutMs: number
  private readonly allowedToolsOverride?: string[]
  private readonly mcpServers: Record<string, unknown>
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private eventListeners: Array<(e: SessionTransportEvent) => void> = []
  private exitListeners: Array<(info: SessionTransportExitInfo) => void> = []

  constructor(opts: ClaudeHeadlessTransportOptions = {}) {
    this.spawnFn = opts.spawnFn ?? spawn
    this.permissionTier = opts.permissionTier ?? 'write'
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.allowedToolsOverride = opts.allowedToolsOverride
    this.mcpServers = opts.mcpServers ?? {}
  }

  onEvent(cb: (e: SessionTransportEvent) => void): void {
    this.eventListeners.push(cb)
  }

  onExit(cb: (info: SessionTransportExitInfo) => void): void {
    this.exitListeners.push(cb)
  }

  start(opts: SessionTransportStartOptions): void {
    if (this.child) {
      throw new Error('ClaudeHeadlessTransport already has an active run; call stop() first')
    }
    this.stopped = false

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model', opts.model ?? DEFAULT_MODEL,
      '--settings', JSON.stringify({ disableAllHooks: true }),
      '--mcp-config', JSON.stringify({ mcpServers: this.mcpServers }),
      '--strict-mcp-config',
      '--setting-sources', 'project',
      ...(this.allowedToolsOverride ? ['--allowedTools', this.allowedToolsOverride.join(',')] : buildPermissionArgs(this.permissionTier)),
    ]
    if (opts.resumeId) args.push('--resume', opts.resumeId)

    const child = this.spawnFn('claude', args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams

    this.child = child
    child.stdin.write(opts.prompt)
    child.stdin.end()

    child.stdout.on('data', (chunk: Buffer) => this.handleChunk(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      console.error('[claude stderr]', chunk.toString('utf8'))
    })
    child.on('error', (err) => {
      this.clearIdleTimer()
      this.emitExit({ code: null, failure: { kind: 'spawn-error', message: err.message } })
      this.child = null
    })
    child.on('exit', (code) => {
      this.clearIdleTimer()
      this.emitExit({ code })
      this.child = null
    })

    this.resetIdleTimer()
  }

  send(prompt: string): void {
    // Foundation scope: one turn per start(); multi-turn resume is Workstream
    // B's concern (via --resume). Calling send() without an active child is
    // a programmer error, not a recoverable runtime state.
    if (!this.child) throw new Error('ClaudeHeadlessTransport has no active run; call start() first')
    this.child.stdin.write(prompt)
    this.child.stdin.end()
    this.resetIdleTimer()
  }

  cancel(): void {
    this.stop()
  }

  stop(): void {
    // Set first, synchronously — a real, live-reproduced race otherwise
    // exists: the child's last buffered stdout chunk can arrive just after
    // SIGTERM is sent (the OS pipe doesn't close instantly), and
    // `handleChunk` re-arming a brand-new, un-cleared 2-minute idle timer
    // at that point kept Electron's whole main process alive for up to two
    // minutes after quit — confirmed live by instrumenting Electron's own
    // quit lifecycle: 'quit' fired in ~120ms, but the OS process itself
    // didn't actually exit until the stray idle timer finally elapsed.
    this.stopped = true
    this.clearIdleTimer()
    const child = this.child
    if (!child) return
    child.kill('SIGTERM')
    const killTimer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL')
    }, KILL_GRACE_MS)
    killTimer.unref() // never block the parent process's own shutdown — see resetIdleTimer's comment
    child.once('exit', () => {
      clearTimeout(killTimer)
      // Explicit, not left to GC — an open stdio handle can otherwise keep
      // the parent process's event loop alive well after the child itself
      // has actually died, which matters a lot here: this transport's
      // parent is Electron's own main process, and a lingering handle can
      // delay or hang the whole app's shutdown, not just this one object.
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.stdin?.destroy()
    })
  }

  private handleChunk(chunk: Buffer): void {
    if (this.stopped) return // the race described in stop()'s own comment — a post-stop chunk must never re-arm anything
    this.resetIdleTimer()
    this.buffer += chunk.toString('utf8')
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      for (const event of mapEvents(line)) this.emitEvent(event)
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      console.error('[claude] idle timeout exceeded, killing hung run')
      this.stop()
      this.emitExit({ code: null, failure: { kind: 'idle-timeout', message: `no output for ${this.idleTimeoutMs}ms` } })
    }, this.idleTimeoutMs)
    // Defense in depth, beyond the `stopped` guard above: NO timer this
    // class owns should ever be able to keep the parent process (Electron's
    // own main process) alive past its own intended shutdown. `unref()`
    // excludes it from that liveness count entirely — the timer still
    // fires normally if the process stays alive for other reasons, it just
    // never forces the process to stay alive on its own.
    this.idleTimer.unref()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private emitEvent(e: SessionTransportEvent): void {
    for (const cb of this.eventListeners) cb(e)
  }

  private emitExit(info: SessionTransportExitInfo): void {
    for (const cb of this.exitListeners) cb(info)
  }
}
