import type { PermissionTier } from '../../shared/types'

/**
 * Plan-bound confirmation (observability-trust-and-harness.md): shown
 * instead of letting "send" start anything, while `approvalMode === 'ask'`.
 * The exact prompt text shown here is the exact text `confirmStart` will
 * send back — nothing is re-derived or editable underneath it; "Cancel"
 * returns to a normal, editable composer rather than silently reusing a
 * stale approval.
 */
export function ConfirmStart({
  prompt,
  tier,
  onConfirm,
  onCancel,
}: {
  prompt: string
  tier: PermissionTier
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="composer-wrap" data-testid="confirm-start">
      <div className="row-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          About to run at the <strong className="mono">{tier}</strong> permission tier:
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink)' }} data-testid="confirm-start-prompt">
          {prompt}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="btn" onClick={onConfirm} data-testid="confirm-start-accept" style={{ cursor: 'pointer', background: 'var(--accent)', color: 'var(--on-accent)' }}>
            Confirm &amp; run
          </div>
          <div className="btn" onClick={onCancel} data-testid="confirm-start-cancel" style={{ cursor: 'pointer', opacity: 0.7 }}>
            Cancel
          </div>
        </div>
      </div>
    </div>
  )
}
