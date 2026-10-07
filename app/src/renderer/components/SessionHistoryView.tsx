import { useEffect, useState } from 'react'

interface SessionHistoryEntry {
  sessionId: string
  startedAt: string
  status: 'running' | 'idle' | 'needs-review'
  costUsd: number
  durationMs: number
  filesChanged: number
  prompt: string
}

const STATUS_LABEL: Record<SessionHistoryEntry['status'], string> = {
  running: 'running',
  idle: 'completed',
  'needs-review': 'needs review',
}

const STATUS_COLOR: Record<SessionHistoryEntry['status'], string> = {
  running: 'var(--codex)',
  idle: 'var(--muted)',
  'needs-review': 'var(--state-danger)',
}

function formatCostAndTime(costUsd: number, durationMs: number): string {
  const seconds = Math.round(durationMs / 1000)
  const time = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
  return `¤${costUsd.toFixed(2)} · ${time}`
}

/**
 * "Per-project history: a simple local timeline of past sessions, their
 * cost, and outcome" (docs/prd/technical/observability-trust-and-harness.md)
 * — answers "what has this agent been doing and what did it cost me"
 * without reading logs. Read-only: this is a summary surface, not a
 * transcript viewer.
 */
export function SessionHistoryView({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<SessionHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.laird.session.historyList({ projectId }).then((result) => {
      if (!cancelled) {
        setEntries(result)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (loading) {
    return (
      <div className="skills-view" data-testid="history-view">
        <span className="mono" style={{ color: 'var(--muted)' }}>
          Loading…
        </span>
      </div>
    )
  }

  return (
    <div className="skills-view" data-testid="history-view">
      <div className="skills-section">
        <div className="label">Session history</div>
        {entries.length === 0 ? (
          <div className="skills-section-empty">No sessions yet for this project.</div>
        ) : (
          entries.map((entry) => (
            <div className="row-card" key={entry.sessionId} data-testid="history-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.prompt}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                  {new Date(entry.startedAt).toLocaleString()} · {formatCostAndTime(entry.costUsd, entry.durationMs)} ·{' '}
                  {entry.filesChanged} {entry.filesChanged === 1 ? 'file' : 'files'} changed
                </div>
              </div>
              <span className="mono" style={{ fontSize: 10.5, color: STATUS_COLOR[entry.status] }} data-testid="history-row-status">
                {STATUS_LABEL[entry.status]}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
