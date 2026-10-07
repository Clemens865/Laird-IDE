import type { spawn } from 'node:child_process'
import { WebContentsView, type BrowserWindow } from 'electron'
import { startDevServer, waitForPort, type DevServerHandle } from './devServer'

export interface PreviewPanelState {
  projectId: string
  url: string
}

export type PreviewPanelStartResult = { ok: true } | { ok: false; message: string }

/**
 * One real, embedded, live-interactive `WebContentsView` panel inside
 * Laird's own window (observability-trust-and-harness.md's "embedded, live,
 * user-interactive PiP window" — user-directed follow-up, 2026-10-07): the
 * same real page the user watches is the exact thing the harness's own
 * Playwright MCP server later drives via CDP (`cdpTarget.ts`), not a
 * second, invisible browser. Only one active panel at a time in v1 — a
 * second `start()` tears down whatever was already showing first.
 *
 * Ownership while the harness is actively driving it (`reviewer.ts`'s
 * `onLockChange`) is advisory, not an input block: Electron's
 * `setIgnoreMouseEvents` only exists at the whole-window level
 * (`BrowserWindow`), not per-view — calling it here would freeze all of
 * Laird's own chrome UI too, not just this one panel. The real reclaim
 * mechanism is the visible lock banner plus "Take back control," which
 * cancels the harness run (`HARNESS_RUN_CANCEL`) outright, not a
 * client-side click-block.
 */
export class PreviewPanelManager {
  private view: WebContentsView | null = null
  private devServer: DevServerHandle | null = null
  private current: PreviewPanelState | null = null

  constructor(private readonly win: BrowserWindow) {}

  getState(): PreviewPanelState | null {
    return this.current
  }

  async start(opts: {
    projectId: string
    projectPath: string
    command: string
    port: number
    devServerSpawnFn?: typeof spawn
    waitForPortFn?: typeof waitForPort
  }): Promise<PreviewPanelStartResult> {
    this.stop()

    const devServer = startDevServer(opts.projectPath, opts.command, { spawnFn: opts.devServerSpawnFn })
    const waitFn = opts.waitForPortFn ?? waitForPort
    const ready = await waitFn(opts.port, { timeoutMs: 20_000 })
    if (!ready) {
      devServer.stop()
      return { ok: false, message: `The preview command (\`${opts.command}\`) didn’t start listening on port ${opts.port} in time.` }
    }

    const view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true } })
    this.win.contentView.addChildView(view)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const url = `http://localhost:${opts.port}`
    try {
      await view.webContents.loadURL(url)
    } catch (err) {
      this.win.contentView.removeChildView(view)
      devServer.stop()
      return { ok: false, message: `The preview page at ${url} failed to load: ${err instanceof Error ? err.message : String(err)}` }
    }

    this.view = view
    this.devServer = devServer
    this.current = { projectId: opts.projectId, url }
    return { ok: true }
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.view?.setBounds(bounds)
  }

  /** Moves the panel out of view without tearing down the dev server — a quick view-switch shouldn't pay the reload cost. */
  hide(): void {
    this.view?.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }

  stop(): void {
    if (this.view) {
      this.win.contentView.removeChildView(this.view)
      this.view.webContents.close()
      this.view = null
    }
    this.devServer?.stop()
    this.devServer = null
    this.current = null
  }
}
