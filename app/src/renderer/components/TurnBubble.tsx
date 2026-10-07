import type { Turn } from '../../shared/types'
import { FileChangeChip } from './FileChangeChip'

function ToolCallChip({ name }: { name: string }) {
  return (
    <div className="chip">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2}>
        <circle cx="12" cy="12" r="8" />
      </svg>
      <span className="path mono">{name}</span>
    </div>
  )
}

export function TurnBubble({ turn, projectName }: { turn: Turn; projectName: string }) {
  if (turn.role === 'user') {
    const text = turn.blocks
      .filter((b) => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
    return <div className="bubble-user">{text}</div>
  }

  return (
    <div className="turn">
      <div className="turn-head">
        <span className="badge" />
        Claude · {projectName}
      </div>
      {turn.blocks.map((block, i) => {
        if (block.kind === 'text') return <div key={i} className="turn-body">{block.text}</div>
        if (block.kind === 'fileChange') return <FileChangeChip key={i} block={block} />
        return <ToolCallChip key={i} name={block.name} />
      })}
    </div>
  )
}
