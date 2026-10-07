import type { TurnFileChangeBlock } from '../../shared/types'

export function FileChangeChip({ block }: { block: TurnFileChangeBlock }) {
  return (
    <div className="chip">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--codex)" strokeWidth={2}>
        <path d="M20 6 L9 17 L4 12" />
      </svg>
      <span className="path mono">{block.path}</span>
      <span className="note">— {block.summary}</span>
      {block.diffStat && <span className="diff">{block.diffStat}</span>}
    </div>
  )
}
