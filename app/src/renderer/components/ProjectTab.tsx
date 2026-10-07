import type { CSSProperties } from 'react'
import type { Project, SessionStatus } from '../../shared/types'
import { BoardFlip } from './BoardFlip'

const STATE_LABEL: Record<SessionStatus, string> = {
  running: 'running',
  idle: 'idle',
  'needs-review': 'needs review',
}

/**
 * `selected` drives the board-flip (matches the original v9-signature
 * mockup's own click-handler behavior: selecting a tab turns its board
 * over). `status` drives the separate `.state` text, independent of
 * selection — a background project can show "running" while a different,
 * selected tab is what's currently in view.
 */
export function ProjectTab({
  project,
  status,
  selected,
  onSelect,
}: {
  project: Project
  status: SessionStatus
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div
      className={`tab${selected ? ' active' : ''}`}
      style={{ '--tc': project.colorToken } as CSSProperties}
      onClick={onSelect}
      data-testid="project-tab"
      data-project-id={project.id}
    >
      <BoardFlip active={selected} color={project.colorToken} />
      <div className="tab-text">
        {project.name}
        <span className="state" data-testid="project-status">
          {STATE_LABEL[status]}
        </span>
      </div>
    </div>
  )
}
