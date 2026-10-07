import { spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'

const KILL_GRACE_MS = 3_000

export interface DevServerHandle {
  stop(): void
}

/**
 * Starts a project's own confirmed dev command (`Project.uiPreview`) as a
 * real, long-lived background process — only ever called once a harness
 * run has actually routed a criterion to `ui_interaction` AND the user has
 * already explicitly confirmed this command (same discipline as
 * `testRunner.ts`, never silently started).
 *
 * Spawned `detached` so it becomes its own process-group leader: `npm run
 * dev` (the common case) is really a shell wrapping a real listener
 * (vite/next/etc.), and killing just the shell's own pid does not
 * necessarily kill that grandchild — a real, already-documented risk
 * elsewhere in this codebase (architecture-and-data.md's orphaned-process
 * finding), and genuinely reproduced live here: whether the shell's own
 * `sh -c "<command>"` exec-replaces itself with the real command or forks
 * a separate child is a shell/platform implementation detail that isn't
 * reliable to depend on (confirmed live — a real `node server.js` child
 * survived a correct process-group SIGTERM/SIGKILL because the launching
 * shell had already exited on its own, reparenting the real server to
 * `init` under a process-group id that no longer had a live leader by the
 * time `stop()` ran). The deterministic fix: force `exec` so the shell
 * always replaces its own process image with the real command — there is
 * then only ever one real process, never an ambiguous parent/child pair to
 * reason about.
 */
export function startDevServer(projectPath: string, command: string, opts: { spawnFn?: typeof spawn } = {}): DevServerHandle {
  const spawnFn = opts.spawnFn ?? spawn
  const child: ChildProcess = spawnFn(`exec ${command}`, {
    cwd: projectPath,
    shell: true,
    detached: true,
    stdio: 'ignore',
  })
  // A dev server that fails to start at all (bad command) still needs a
  // handled 'error' — otherwise an uncaught exception would crash the whole
  // main process, not just this one harness run.
  child.on('error', (err) => {
    console.error('[devServer] failed to start', err)
  })

  let stopped = false
  return {
    stop() {
      if (stopped || !child.pid) return
      stopped = true
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // The group may already be gone (process exited on its own) — not an error worth surfacing.
      }
      const killTimer = setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL')
        } catch {
          // Already gone.
        }
      }, KILL_GRACE_MS)
      killTimer.unref()
    },
  }
}

/**
 * Polls a real TCP connect attempt until the dev server is actually
 * listening (or the bound is reached) — never assumes a fixed startup
 * delay, never waits forever.
 */
export function waitForPort(port: number, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const intervalMs = opts.intervalMs ?? 300
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve) => {
    const attempt = () => {
      const socket = connect({ port, host: '127.0.0.1' })
      const onFail = () => {
        socket.destroy()
        if (Date.now() >= deadline) {
          resolve(false)
        } else {
          setTimeout(attempt, intervalMs)
        }
      }
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', onFail)
      socket.setTimeout(intervalMs, onFail)
    }
    attempt()
  })
}
