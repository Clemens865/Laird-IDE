/**
 * Workstream K (distribution & auto-update). A small, injectable wrapper
 * around `electron-updater`'s real `autoUpdater` — same discipline as
 * `settings/typesafeKey.ts`'s `SecureStringCodec` for `safeStorage`: the
 * real library is only ever constructed in `index.ts`, so this module's
 * own event-mapping logic stays unit-testable with a fake updater, no real
 * network/update-server behavior in the test suite.
 *
 * `autoDownload` is explicitly forced `false` — the UI, not the library,
 * decides when a download actually starts, matching this app's own
 * "explicit, never ambient" discipline used everywhere else (global-skill
 * materialization, zero-MCP-by-default, JevGuard's own opt-in key).
 */
export interface AutoUpdaterLike {
  autoDownload: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  on(event: string, cb: (...args: unknown[]) => void): void
}

export type UpdateEvent =
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string }
  | { kind: 'progress'; percent: number }
  | { kind: 'downloaded'; version: string }

function versionOf(info: unknown): string {
  return typeof info === 'object' && info && 'version' in info && typeof (info as { version: unknown }).version === 'string'
    ? (info as { version: string }).version
    : 'unknown'
}

/** Maps every real `electron-updater` event this app cares about to the plain `UpdateEvent` shape the renderer actually consumes. */
export function wireAutoUpdater(updater: AutoUpdaterLike, onEvent: (event: UpdateEvent) => void): void {
  updater.autoDownload = false
  updater.on('checking-for-update', () => onEvent({ kind: 'checking' }))
  updater.on('update-available', (info) => onEvent({ kind: 'available', version: versionOf(info) }))
  updater.on('update-not-available', () => onEvent({ kind: 'not-available' }))
  updater.on('error', (err) => onEvent({ kind: 'error', message: err instanceof Error ? err.message : String(err) }))
  updater.on('download-progress', (progress) => {
    const percent =
      typeof progress === 'object' && progress && 'percent' in progress && typeof (progress as { percent: unknown }).percent === 'number'
        ? Math.round((progress as { percent: number }).percent)
        : 0
    onEvent({ kind: 'progress', percent })
  })
  updater.on('update-downloaded', (info) => onEvent({ kind: 'downloaded', version: versionOf(info) }))
}
