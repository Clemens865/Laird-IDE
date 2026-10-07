/**
 * Replaces the composer entirely while `Project.autonomyRevoked` is true —
 * the kill switch's other half: a new session is refused outright (see
 * `SessionManager.startSession`/`requestStart`) until this explicit human
 * action re-grants it, never silently or automatically.
 */
export function AutonomyRevokedBanner({ onResume }: { onResume: () => void }) {
  return (
    <div className="composer-wrap" data-testid="autonomy-revoked-banner">
      <div className="row-card" style={{ justifyContent: 'space-between', background: 'var(--state-danger-soft)' }}>
        <span style={{ fontSize: 12.5, color: 'var(--state-danger)' }}>
          Autonomy revoked for this project — no new session can start until you resume control.
        </span>
        <div className="btn" onClick={onResume} data-testid="resume-autonomy-button" style={{ cursor: 'pointer', background: 'var(--surface-solid)' }}>
          Resume control
        </div>
      </div>
    </div>
  )
}
