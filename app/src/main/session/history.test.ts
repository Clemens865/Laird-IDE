import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { buildSessionHistory } from './history'
import type { Project, Session, Turn, UsageEvent } from '../../shared/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    path: '/tmp/proj',
    colorToken: '#D97757',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    enabledGlobalSkillIds: [],
    permissionTier: 'write',
    approvalMode: 'auto',
    autonomyRevoked: false,
    harnessCriteria: [],
    jevFeatures: { criterionRouting: false, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    projectId: 'p1',
    worktreePath: '/tmp/proj/.laird-worktrees/s1',
    status: 'idle',
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('buildSessionHistory', () => {
  it('returns one entry per session with its real aggregated cost/duration/filesChanged', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject())
    store.upsertSession(makeSession({ id: 's1', startedAt: '2026-01-01T00:00:00.000Z' }))
    store.appendTurn({ id: 't1', sessionId: 's1', role: 'user', blocks: [{ kind: 'text', text: 'Build a login form' }], createdAt: '2026-01-01T00:00:00.000Z' })
    store.appendUsageEvent({ id: 'u1', sessionId: 's1', turnId: 't1', costUsd: 0.05, durationMs: 1000, filesChanged: 2 })
    store.appendUsageEvent({ id: 'u2', sessionId: 's1', turnId: 't1', costUsd: 0.03, durationMs: 500, filesChanged: 1 })

    const history = buildSessionHistory(store, 'p1')

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      sessionId: 's1',
      status: 'idle',
      costUsd: 0.08,
      durationMs: 1500,
      filesChanged: 3,
      prompt: 'Build a login form',
    })
  })

  it('truncates a long prompt rather than showing the whole thing', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject())
    store.upsertSession(makeSession())
    const longPrompt = 'x'.repeat(200)
    store.appendTurn({ id: 't1', sessionId: 's1', role: 'user', blocks: [{ kind: 'text', text: longPrompt }], createdAt: new Date().toISOString() })

    const [entry] = buildSessionHistory(store, 'p1')
    expect(entry.prompt.length).toBeLessThan(longPrompt.length)
    expect(entry.prompt.endsWith('…')).toBe(true)
  })

  it('falls back to a placeholder when no user turn was ever recorded', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject())
    store.upsertSession(makeSession())

    const [entry] = buildSessionHistory(store, 'p1')
    expect(entry.prompt).toBe('(no prompt recorded)')
  })

  it('sorts newest first', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject())
    store.upsertSession(makeSession({ id: 's1', startedAt: '2026-01-01T00:00:00.000Z' }))
    store.upsertSession(makeSession({ id: 's2', startedAt: '2026-01-03T00:00:00.000Z' }))
    store.upsertSession(makeSession({ id: 's3', startedAt: '2026-01-02T00:00:00.000Z' }))

    const history = buildSessionHistory(store, 'p1')
    expect(history.map((e) => e.sessionId)).toEqual(['s2', 's3', 's1'])
  })

  it('never mixes in a different project\'s sessions', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject({ id: 'p1' }))
    store.upsertProject(makeProject({ id: 'p2' }))
    store.upsertSession(makeSession({ id: 's1', projectId: 'p1' }))
    store.upsertSession(makeSession({ id: 's2', projectId: 'p2' }))

    const history = buildSessionHistory(store, 'p1')
    expect(history.map((e) => e.sessionId)).toEqual(['s1'])
  })

  it('reflects a needs-review outcome accurately, not papered over as idle', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject())
    store.upsertSession(makeSession({ status: 'needs-review' }))

    const [entry] = buildSessionHistory(store, 'p1')
    expect(entry.status).toBe('needs-review')
  })

  it('returns an empty list for a project with no sessions yet', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject())
    expect(buildSessionHistory(store, 'p1')).toEqual([])
  })
})
