/**
 * The plain-language cost/time/files-changed summary — in scope for
 * Foundation per the approved plan, even though the rest of the sidebar
 * (agent activity roster, skills list) is not (Workstreams C/D). Reuses the
 * v9-signature `.sidebar`/`.meta` classes since this is the exact visual
 * container the mockup uses for this content, just without its other rows.
 */
export function CostFooter({
  costUsd,
  durationMs,
  filesChanged,
}: {
  costUsd: number
  durationMs: number
  filesChanged: number
}) {
  const cost = `¤${costUsd.toFixed(2)}`
  const seconds = Math.round(durationMs / 1000)
  const time = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`

  return (
    <div className="sidebar glass" style={{ width: 240 }} data-testid="cost-footer">
      <div className="meta" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
        <div className="r">
          <span>This session</span>
          <span className="mono">{cost}</span>
        </div>
        <div className="r">
          <span>Time</span>
          <span className="mono">{time}</span>
        </div>
        <div className="r">
          <span>Files changed</span>
          <span className="mono">{filesChanged}</span>
        </div>
      </div>
    </div>
  )
}
