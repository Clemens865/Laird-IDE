import type { MemoryStore } from '../store/memoryStore'
import type { SessionStatus } from '../../shared/types'

const PROMPT_PREVIEW_MAX = 120

export interface SessionHistoryEntry {
  sessionId: string
  startedAt: string
  status: SessionStatus
  costUsd: number
  durationMs: number
  filesChanged: number
  /** The first user prompt, truncated — "what was this session about," per the PRD's own framing. */
  prompt: string
}

/**
 * "Per-project history: a simple local timeline of past sessions, their
 * cost, and outcome" (docs/prd/technical/observability-trust-and-harness.md)
 * — a read-only view over data every other Workstream D surface already
 * reads from (`Session`, `UsageEvent`, `Turn`), not a second mechanism.
 * Newest first, so "what has this agent been doing" reads top-down like a
 * normal history list.
 */
export function buildSessionHistory(store: MemoryStore, projectId: string): SessionHistoryEntry[] {
  const sessions = store.getSessionsForProject(projectId)

  const entries = sessions.map((session) => {
    const usage = store.getUsageEvents(session.id)
    const costUsd = usage.reduce((sum, u) => sum + u.costUsd, 0)
    const durationMs = usage.reduce((sum, u) => sum + u.durationMs, 0)
    const filesChanged = usage.reduce((sum, u) => sum + u.filesChanged, 0)

    const firstUserTurn = store.getTurns(session.id).find((t) => t.role === 'user')
    const rawPrompt = firstUserTurn?.blocks.find((b) => b.kind === 'text')?.text ?? '(no prompt recorded)'
    const prompt = rawPrompt.length > PROMPT_PREVIEW_MAX ? `${rawPrompt.slice(0, PROMPT_PREVIEW_MAX)}…` : rawPrompt

    return { sessionId: session.id, startedAt: session.startedAt, status: session.status, costUsd, durationMs, filesChanged, prompt }
  })

  return entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
