import type { ApprovalMode, PermissionTier } from '../../shared/types'

const TIER_LABEL: Record<PermissionTier, string> = {
  read: 'Read only',
  write: 'Read + write files',
  manage: 'Read + write + subagents/web',
  full: 'Full (adds shell)',
}

/**
 * Always-visible permission tier × approval mode control (observability-
 * trust-and-harness.md) — never buried in a settings menu, since the whole
 * point is the user always knows what an agent is currently allowed to do
 * in this project before they type anything.
 */
export function PermissionControl({
  tier,
  approvalMode,
  onChange,
}: {
  tier: PermissionTier
  approvalMode: ApprovalMode
  onChange: (next: { permissionTier?: PermissionTier; approvalMode?: ApprovalMode }) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 34px 8px' }} data-testid="permission-control">
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
        Permissions
      </span>
      <select
        value={tier}
        onChange={(e) => onChange({ permissionTier: e.target.value as PermissionTier })}
        data-testid="permission-tier-select"
        className="mono"
        style={{ fontSize: 11, border: '1px solid var(--line)', borderRadius: 8, padding: '3px 6px', background: 'var(--surface-raised)', color: 'var(--ink-2)' }}
      >
        {(Object.keys(TIER_LABEL) as PermissionTier[]).map((t) => (
          <option key={t} value={t}>
            {TIER_LABEL[t]}
          </option>
        ))}
      </select>
      <select
        value={approvalMode}
        onChange={(e) => onChange({ approvalMode: e.target.value as ApprovalMode })}
        data-testid="approval-mode-select"
        className="mono"
        style={{ fontSize: 11, border: '1px solid var(--line)', borderRadius: 8, padding: '3px 6px', background: 'var(--surface-raised)', color: 'var(--ink-2)' }}
      >
        <option value="auto">Auto-run</option>
        <option value="ask">Ask before each run</option>
      </select>
    </div>
  )
}
