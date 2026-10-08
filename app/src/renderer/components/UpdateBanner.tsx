import { useEffect, useState } from 'react'
import type { UpdateEvent } from '../../main/update/autoUpdater'

/**
 * Workstream K (distribution & auto-update) — mounted once, machine-wide,
 * near the Topbar. Renders nothing until an update is genuinely available;
 * never auto-restarts the app on its own, matching the house trust tone
 * (plain language, nothing silent). Checks once on mount — a manual
 * "Check for updates" control is Settings-view territory, which doesn't
 * exist yet; this is the minimal honest v1.
 */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateEvent>({ kind: 'checking' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const unsubscribe = window.laird.update.onEvent((event) => {
      setState(event)
      setDismissed(false)
    })
    window.laird.update.check()
    return unsubscribe
  }, [])

  if (dismissed) return null
  if (state.kind === 'checking' || state.kind === 'not-available' || state.kind === 'error') return null

  return (
    <div
      className="glass"
      data-testid="update-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        margin: '0 34px 8px',
        borderRadius: 12,
        fontSize: 11.5,
      }}
    >
      {state.kind === 'available' && (
        <>
          <span style={{ color: 'var(--ink-2)' }}>Update available (v{state.version}).</span>
          <div className="btn" onClick={() => window.laird.update.download()} data-testid="update-download" style={{ cursor: 'pointer' }}>
            Download
          </div>
        </>
      )}
      {state.kind === 'progress' && <span style={{ color: 'var(--muted)' }}>Downloading update… {state.percent}%</span>}
      {state.kind === 'downloaded' && (
        <>
          <span style={{ color: 'var(--state-success)' }}>Update ready (v{state.version}).</span>
          <div className="btn" onClick={() => window.laird.update.install()} data-testid="update-install" style={{ cursor: 'pointer' }}>
            Restart to update
          </div>
        </>
      )}
      <span
        className="mono"
        onClick={() => setDismissed(true)}
        data-testid="update-banner-dismiss"
        style={{ marginLeft: 'auto', color: 'var(--muted)', cursor: 'pointer', fontSize: 11 }}
      >
        dismiss
      </span>
    </div>
  )
}
