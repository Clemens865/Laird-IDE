/**
 * "Take back control" (observability-trust-and-harness.md) — always
 * visible while a session is running, never buried in a menu. Stops the
 * real process immediately and revokes the project's autonomy; the next
 * attempted session is refused until explicitly re-granted (see
 * `AutonomyRevokedBanner`).
 */
export function KillSwitch({ onKill }: { onKill: () => void }) {
  return (
    <div style={{ padding: '0 34px 8px', display: 'flex' }}>
      <div
        className="btn"
        onClick={onKill}
        data-testid="kill-switch-button"
        style={{ cursor: 'pointer', background: 'var(--state-danger-soft)', color: 'var(--state-danger)' }}
      >
        Take back control
      </div>
    </div>
  )
}
