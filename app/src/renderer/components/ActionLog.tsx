import type { ActivityLogEntry } from '../../shared/types'

/**
 * "A live, always-visible action log — the UI rendering of the
 * ActivityLogEntry table, not a separate feature" (docs/prd/technical/
 * observability-trust-and-harness.md). Renders the exact same log every
 * other trust surface (and, later, the harness mode's evidence tiers) will
 * read from — not a re-derived narrative. Plain-language per entry, newest
 * first; capped so one long session doesn't turn the sidebar into an
 * unreadable wall of text — this is a trust surface, not a debug console.
 */
function summarize(entry: ActivityLogEntry): string {
  const p = (entry.payload ?? {}) as Record<string, unknown>

  if (entry.kind === 'tool-call') {
    // A merged Subagent object (see sessionManager.ts) has `role`/`status`; a plain tool-call has `name`/`input`.
    if (typeof p.role === 'string' && typeof p.status === 'string') {
      const status = p.status === 'done' ? 'finished' : 'is working'
      const detail = typeof p.lastAction === 'string' && p.lastAction ? ` — ${p.lastAction}` : ''
      return `Subagent "${String(p.name ?? 'unknown')}" ${status}${detail}`
    }
    if (typeof p.name === 'string') return `Used ${p.name}`
  }

  if (entry.kind === 'decision') {
    const failure = p.failure as { kind?: string; message?: string } | undefined
    if (failure) return `Session ended with a problem: ${failure.message ?? failure.kind ?? 'unknown failure'}`
    if (typeof p.costUsd === 'number') {
      const seconds = Math.round((typeof p.durationMs === 'number' ? p.durationMs : 0) / 1000)
      return `Turn finished — ¤${p.costUsd.toFixed(2)}, ${seconds}s`
    }
  }

  if (entry.kind === 'kill-switch') return 'Took back control — session stopped'
  if (entry.kind === 'permission-prompt') return 'Waiting for your confirmation'
  if (entry.kind === 'file-change') return 'File changed'
  // `p.reason` is already a complete sentence (JevGuard's own hook writes it) — no need to re-compose one around it.
  if (entry.kind === 'jev-guard-blocked') return `🛡 ${String(p.reason ?? `Blocked a ${String(p.toolName ?? 'tool')} call`)}`

  return entry.kind
}

const MAX_VISIBLE = 30

export function ActionLog({ entries }: { entries: ActivityLogEntry[] }) {
  if (entries.length === 0) return null

  const visible = entries.slice(-MAX_VISIBLE).reverse()

  return (
    <div className="sidebar glass" style={{ width: 240, flexShrink: 0 }} data-testid="action-log">
      <div>
        <div className="label">Action log</div>
        {visible.map((entry) => {
          const blocked = entry.kind === 'jev-guard-blocked'
          return (
            <div
              key={entry.id}
              data-testid="action-log-row"
              data-jev-guard-blocked={blocked ? 'true' : undefined}
              style={{
                fontSize: 11.5,
                lineHeight: 1.5,
                padding: '5px 2px',
                borderBottom: '1px solid var(--line)',
                background: blocked ? 'var(--state-danger-soft)' : undefined,
                borderRadius: blocked ? 6 : undefined,
              }}
            >
              <span className="mono" style={{ color: 'var(--faint)', marginRight: 6 }}>
                {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span style={{ color: blocked ? 'var(--state-danger)' : 'var(--ink-2)', fontWeight: blocked ? 600 : undefined }}>
                {summarize(entry)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
