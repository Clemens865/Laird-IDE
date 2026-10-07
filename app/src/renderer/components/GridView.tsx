import type { CSSProperties } from 'react'
import type { Project, SessionStatus, Turn } from '../../shared/types'
import { BoardFlip } from './BoardFlip'

interface ProjectCardData {
  project: Project
  status: SessionStatus
  lastMessage: string
  costUsd: number
  durationMs: number
}

function lastMessageFrom(turns: Turn[]): string {
  const last = turns[turns.length - 1]
  if (!last) return 'No activity yet'
  const text = last.blocks.find((b) => b.kind === 'text')
  if (text && text.kind === 'text') return text.text
  const fileChange = last.blocks.find((b) => b.kind === 'fileChange')
  if (fileChange && fileChange.kind === 'fileChange') return `${fileChange.summary} ${fileChange.path}`
  return 'No activity yet'
}

export function GridView({
  cards,
  selectedProjectId,
  onSelect,
}: {
  cards: ProjectCardData[]
  selectedProjectId: string | null
  onSelect: (projectId: string) => void
}) {
  return (
    <div className="grid-view" data-testid="grid-view">
      {cards.map(({ project, status, lastMessage, costUsd, durationMs }) => (
        <div
          key={project.id}
          className={`project-card glass${project.id === selectedProjectId ? ' selected' : ''}`}
          style={{ '--tc': project.colorToken } as CSSProperties}
          onClick={() => onSelect(project.id)}
          data-testid="project-card"
          data-project-id={project.id}
        >
          <div className="project-card-head">
            <BoardFlip active={status === 'running'} color={project.colorToken} />
            <span className="project-card-name">{project.name}</span>
          </div>
          <div className="project-card-last">{lastMessage}</div>
          <div className="project-card-meta mono">
            <span>{status}</span>
            <span>
              ¤{costUsd.toFixed(2)} · {Math.round(durationMs / 1000)}s
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export { lastMessageFrom }
