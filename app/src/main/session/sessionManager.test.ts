import { describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { SessionManager } from './sessionManager'
import type { Project } from '../../shared/types'
import type {
  SessionTransport,
  SessionTransportEvent,
  SessionTransportExitInfo,
  SessionTransportStartOptions,
} from './transport'

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
    ...overrides,
  }
}

/** No child process, no native module, no API cost — a fake transport the test drives by hand. */
class FakeTransport implements SessionTransport {
  started = false
  stopped = false
  startedWith: SessionTransportStartOptions | null = null
  private eventListeners: Array<(e: SessionTransportEvent) => void> = []
  private exitListeners: Array<(info: SessionTransportExitInfo) => void> = []

  start(opts: SessionTransportStartOptions): void {
    this.started = true
    this.startedWith = opts
  }
  send(): void {}
  cancel(): void {
    this.stop()
  }
  stop(): void {
    this.stopped = true
  }
  onEvent(cb: (e: SessionTransportEvent) => void): void {
    this.eventListeners.push(cb)
  }
  onExit(cb: (info: SessionTransportExitInfo) => void): void {
    this.exitListeners.push(cb)
  }
  emit(e: SessionTransportEvent): void {
    for (const cb of this.eventListeners) cb(e)
  }
  exit(info: SessionTransportExitInfo): void {
    for (const cb of this.exitListeners) cb(info)
  }
}

// No real filesystem/`claude plugin list` in these tests — discovery and
// materialization have their own real-fixture tests in src/main/skills/.
const noSkills = async () => ({ projectSkills: [], globalSkills: [], projectAgents: [], globalAgents: [] })
const noMaterialize = () => {}

function setup(projectOverrides: Partial<Project> = {}) {
  const store = new MemoryStore(null) // in-memory only, no disk I/O in unit tests
  store.upsertProject(makeProject(projectOverrides))
  const fakeTransport = new FakeTransport()
  const onEvent = vi.fn()
  const onSessionUpdate = vi.fn()
  const manager = new SessionManager({
    store,
    onEvent,
    onSessionUpdate,
    createTransport: () => fakeTransport,
    // No real git here — the project's own path stands in for "the worktree," which is exactly
    // what worktree.ts itself falls back to for a non-git project. Real git worktree creation is
    // covered separately and for real in worktree.test.ts.
    createWorktree: (repoPath, sessionId) => ({ path: repoPath, branch: `laird/${sessionId}`, isGitRepo: true }),
    discoverSkillsAndAgents: noSkills,
    materializeSkills: noMaterialize,
  })
  return { store, fakeTransport, onEvent, onSessionUpdate, manager }
}

describe('SessionManager', () => {
  it('starts a session, creates a running Session record, and a user Turn', async () => {
    const { store, fakeTransport, manager } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'do the thing' })

    expect(fakeTransport.started).toBe(true)
    expect(fakeTransport.startedWith).toMatchObject({ cwd: '/tmp/proj', prompt: 'do the thing' })

    const session = store.getSession(sessionId)
    expect(session?.status).toBe('running')
    expect(session?.projectId).toBe('p1')

    const turns = store.getTurns(sessionId)
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ role: 'user', blocks: [{ kind: 'text', text: 'do the thing' }] })
  })

  it('throws for an unknown projectId rather than silently starting somewhere wrong', async () => {
    const { manager } = setup()
    await expect(manager.startSession({ projectId: 'does-not-exist', prompt: 'x' })).rejects.toThrow(/unknown projectId/)
  })

  it('records a tool-call event as an activity log entry and a pending block', async () => {
    const { store, fakeTransport, manager, onEvent } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'edit a file' })

    fakeTransport.emit({ kind: 'tool-call', payload: { name: 'Write', status: 'started' } })

    expect(onEvent).toHaveBeenCalledWith(sessionId, { kind: 'tool-call', payload: { name: 'Write', status: 'started' } })
    const log = store.getActivityLog(sessionId)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ kind: 'tool-call', payload: { name: 'Write' } })
  })

  it('dedupes a tool-call event that repeats the same tool_use id (the real CLI emits one twice under --include-partial-messages: once as a partial stream_event, once as the complete assistant message)', async () => {
    const { store, fakeTransport, manager, onEvent } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'edit a file' })
    onEvent.mockClear()

    fakeTransport.emit({ kind: 'tool-call', payload: { id: 'toolu_dup', name: 'Write', status: 'started' } })
    fakeTransport.emit({ kind: 'tool-call', payload: { id: 'toolu_dup', name: 'Write', status: 'started' } })

    const log = store.getActivityLog(sessionId)
    expect(log.filter((e) => e.kind === 'tool-call' && (e.payload as { id?: string }).id === 'toolu_dup')).toHaveLength(1)
    expect(onEvent.mock.calls.filter((call) => call[1]?.kind === 'tool-call')).toHaveLength(1)
  })

  it('pushes every new activity-log entry live, not just the raw transport event — the "always-visible action log" (Workstream D)', async () => {
    const { manager, fakeTransport, onEvent } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'edit a file' })

    fakeTransport.emit({ kind: 'tool-call', payload: { name: 'Write', status: 'started' } })

    expect(onEvent).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ kind: 'activity-log', payload: expect.objectContaining({ sessionId, kind: 'tool-call' }) }),
    )
  })

  it('records a usage event on exit, attributing filesChanged from real fileChange blocks and a real turnId', async () => {
    const { store, fakeTransport, manager } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'edit two files' })

    fakeTransport.emit({ kind: 'tool-call', payload: { name: 'Write', input: { file_path: '/tmp/proj/a.txt', content: 'x' } } })
    fakeTransport.emit({ kind: 'tool-call', payload: { name: 'Write', input: { file_path: '/tmp/proj/b.txt', content: 'y' } } })
    fakeTransport.emit({ kind: 'usage', payload: { costUsd: 0.05, durationMs: 1200, isError: false } })

    // Usage is deferred until exit — the result line always arrives before
    // process exit, but the finalized Turn (and its id) doesn't exist yet.
    expect(store.getUsageEvents(sessionId)).toHaveLength(0)

    fakeTransport.exit({ code: 0 })

    const usage = store.getUsageEvents(sessionId)
    expect(usage).toHaveLength(1)
    const agentTurn = store.getTurns(sessionId).find((t) => t.role === 'agent')
    expect(usage[0]).toMatchObject({ costUsd: 0.05, durationMs: 1200, filesChanged: 2, turnId: agentTurn?.id })
    expect(usage[0].turnId).not.toBe('')
  })

  it('captures the real token breakdown onto the finalized UsageEvent, not just cost/duration', async () => {
    const { store, fakeTransport, manager } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'do a thing' })

    fakeTransport.emit({
      kind: 'usage',
      payload: { costUsd: 0.01, durationMs: 500, isError: false, inputTokens: 17, outputTokens: 238, cacheReadTokens: 21604, cacheCreationTokens: 21884 },
    })
    fakeTransport.exit({ code: 0 })

    const [usage] = store.getUsageEvents(sessionId)
    expect(usage).toMatchObject({ inputTokens: 17, outputTokens: 238, cacheReadTokens: 21604, cacheCreationTokens: 21884 })
  })

  it('on exit, finalizes an agent Turn from pending blocks and marks the session idle', async () => {
    const { store, fakeTransport, manager, onSessionUpdate } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'say hi' })

    fakeTransport.emit({ kind: 'text', payload: { text: 'hello!' } })
    fakeTransport.exit({ code: 0 })

    const turns = store.getTurns(sessionId)
    expect(turns).toHaveLength(2) // user turn + finalized agent turn
    expect(turns[1]).toMatchObject({ role: 'agent', blocks: [{ kind: 'text', text: 'hello!' }] })

    const session = store.getSession(sessionId)
    expect(session?.status).toBe('idle')
    expect(onSessionUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'idle' }))
  })

  it('on exit with a failure, marks the session needs-review and logs the failure', async () => {
    const { store, fakeTransport, manager } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'will time out' })

    fakeTransport.exit({ code: null, failure: { kind: 'idle-timeout', message: 'no output for 120000ms' } })

    const session = store.getSession(sessionId)
    expect(session?.status).toBe('needs-review')
    const log = store.getActivityLog(sessionId)
    expect(log.some((e) => e.kind === 'decision' && (e.payload as { failure?: unknown }).failure)).toBe(true)
  })

  it('turns a Write tool-call into a real fileChange block, not a generic tool-call', async () => {
    const { store, fakeTransport, manager } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'create hello.txt' })

    fakeTransport.emit({
      kind: 'tool-call',
      payload: { name: 'Write', input: { file_path: '/tmp/proj/hello.txt', content: 'line one\nline two' } },
    })
    fakeTransport.exit({ code: 0 })

    const turns = store.getTurns(sessionId)
    const agentTurn = turns.find((t) => t.role === 'agent')
    expect(agentTurn?.blocks).toEqual([{ kind: 'fileChange', path: 'hello.txt', summary: 'created', diffStat: '+2' }])
  })

  it('falls back to a generic toolCall block for non-file tools', async () => {
    const { store, fakeTransport, manager } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'search the web' })

    fakeTransport.emit({ kind: 'tool-call', payload: { name: 'WebSearch', input: { query: 'x' } } })
    fakeTransport.exit({ code: 0 })

    const agentTurn = store.getTurns(sessionId).find((t) => t.role === 'agent')
    expect(agentTurn?.blocks).toEqual([{ kind: 'toolCall', name: 'WebSearch', status: 'started' }])
  })

  it('merges subagent events into a full Subagent object, keyed by taskId, and logs them', async () => {
    const { manager, fakeTransport, onEvent, store } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'spawn a subagent' })

    fakeTransport.emit({
      kind: 'subagent',
      payload: { taskId: 't1', subagentType: 'general-purpose', description: 'Count files', status: 'active', lastAction: 'started' },
    })
    expect(onEvent).toHaveBeenCalledWith(sessionId, {
      kind: 'subagent',
      payload: { id: 't1', sessionId, name: 'Count files', role: 'general-purpose', status: 'active', lastAction: 'started' },
    })

    // A later partial update (no description/subagentType) merges onto what's already known.
    fakeTransport.emit({ kind: 'subagent', payload: { taskId: 't1', status: 'active', lastAction: 'Running Bash' } })
    expect(onEvent).toHaveBeenCalledWith(sessionId, {
      kind: 'subagent',
      payload: { id: 't1', sessionId, name: 'Count files', role: 'general-purpose', status: 'active', lastAction: 'Running Bash' },
    })

    fakeTransport.emit({ kind: 'subagent', payload: { taskId: 't1', status: 'done', lastAction: '0' } })
    expect(onEvent).toHaveBeenCalledWith(sessionId, {
      kind: 'subagent',
      payload: { id: 't1', sessionId, name: 'Count files', role: 'general-purpose', status: 'done', lastAction: '0' },
    })

    const log = store.getActivityLog(sessionId)
    expect(log.filter((e) => e.kind === 'tool-call' && (e.payload as { id?: string }).id === 't1')).toHaveLength(3)
  })

  it('links a subagent back to the real ActivityLogEntry for the Agent tool-call that spawned it', async () => {
    const { manager, fakeTransport, onEvent, store } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'spawn a subagent' })

    // The real sequence, confirmed live: an `Agent` tool_use block (with its own real id) arrives first, then a `task_started` event referencing that same id as `tool_use_id`.
    fakeTransport.emit({ kind: 'tool-call', payload: { id: 'toolu_abc', name: 'Agent', input: { description: 'Count files' } } })
    fakeTransport.emit({
      kind: 'subagent',
      payload: { taskId: 't1', toolUseId: 'toolu_abc', subagentType: 'general-purpose', description: 'Count files', status: 'active' },
    })

    const agentToolCallLog = store.getActivityLog(sessionId).find((e) => e.kind === 'tool-call' && (e.payload as { name?: string }).name === 'Agent')
    expect(agentToolCallLog).toBeDefined()
    expect(onEvent).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ kind: 'subagent', payload: expect.objectContaining({ id: 't1', parentActivityLogEntryId: agentToolCallLog!.id }) }),
    )

    // A later partial update with no toolUseId still carries the parent link forward, not dropping it.
    fakeTransport.emit({ kind: 'subagent', payload: { taskId: 't1', status: 'done' } })
    expect(onEvent).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ kind: 'subagent', payload: expect.objectContaining({ status: 'done', parentActivityLogEntryId: agentToolCallLog!.id }) }),
    )
  })

  it('leaves parentActivityLogEntryId undefined when no matching Agent tool-call was ever logged, rather than guessing', async () => {
    const { manager, fakeTransport, onEvent } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'spawn a subagent' })

    fakeTransport.emit({ kind: 'subagent', payload: { taskId: 't1', toolUseId: 'toolu_never_logged', status: 'active' } })

    expect(onEvent).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ kind: 'subagent', payload: expect.not.objectContaining({ parentActivityLogEntryId: expect.anything() }) }),
    )
  })

  it('tracks two concurrent subagents independently within one session', async () => {
    const { manager, fakeTransport, onEvent } = setup()
    const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'spawn two subagents' })

    fakeTransport.emit({ kind: 'subagent', payload: { taskId: 't1', subagentType: 'general-purpose', description: 'A', status: 'active' } })
    fakeTransport.emit({ kind: 'subagent', payload: { taskId: 't2', subagentType: 'general-purpose', description: 'B', status: 'active' } })
    fakeTransport.emit({ kind: 'subagent', payload: { taskId: 't1', status: 'done' } })

    expect(onEvent).toHaveBeenCalledWith(sessionId, {
      kind: 'subagent',
      payload: { id: 't1', sessionId, name: 'A', role: 'general-purpose', status: 'done', lastAction: undefined },
    })
  })

  it('stopAll stops every active transport (the orphaned-process fix)', async () => {
    const { fakeTransport, manager } = setup()
    await manager.startSession({ projectId: 'p1', prompt: 'long running' })
    expect(fakeTransport.stopped).toBe(false)

    manager.stopAll()
    expect(fakeTransport.stopped).toBe(true)
  })

  it('isolates two concurrent sessions — turns/activity from one never appear in the other', async () => {
    const store = new MemoryStore(null)
    for (const id of ['p1', 'p2']) {
      store.upsertProject(makeProject({ id, name: id, path: `/tmp/${id}` }))
    }
    const transports = new Map<string, FakeTransport>()
    const manager = new SessionManager({
      store,
      onEvent: () => {},
      onSessionUpdate: () => {},
      createTransport: (sessionId) => {
        const t = new FakeTransport()
        transports.set(sessionId, t)
        return t
      },
      createWorktree: (repoPath, sessionId) => ({ path: repoPath, branch: `laird/${sessionId}`, isGitRepo: true }),
      discoverSkillsAndAgents: noSkills,
      materializeSkills: noMaterialize,
    })

    const sessionA = await manager.startSession({ projectId: 'p1', prompt: 'prompt A' })
    const sessionB = await manager.startSession({ projectId: 'p2', prompt: 'prompt B' })

    transports.get(sessionA)!.emit({ kind: 'text', payload: { text: 'response to A' } })
    transports.get(sessionB)!.emit({ kind: 'text', payload: { text: 'response to B' } })
    transports.get(sessionA)!.exit({ code: 0 })
    transports.get(sessionB)!.exit({ code: 0 })

    const turnsA = store.getTurns(sessionA)
    const turnsB = store.getTurns(sessionB)
    expect(turnsA.every((t) => t.sessionId === sessionA)).toBe(true)
    expect(turnsB.every((t) => t.sessionId === sessionB)).toBe(true)
    expect(turnsA.some((t) => t.blocks.some((b) => b.kind === 'text' && b.text === 'response to B'))).toBe(false)
    expect(turnsB.some((t) => t.blocks.some((b) => b.kind === 'text' && b.text === 'response to A'))).toBe(false)
  })

  it('materializes the project\'s own skills plus only the enabled global skills into the worktree before the transport starts', async () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject({ enabledGlobalSkillIds: ['enabled-skill'] }))
    const fakeTransport = new FakeTransport()
    const materialize = vi.fn()
    const manager = new SessionManager({
      store,
      onEvent: () => {},
      onSessionUpdate: () => {},
      createTransport: () => fakeTransport,
      createWorktree: (repoPath, sessionId) => ({ path: `${repoPath}/.worktrees/${sessionId}`, branch: null, isGitRepo: false }),
      discoverSkillsAndAgents: async () => ({
        projectSkills: [
          { id: 'uncommitted-project-skill', scope: 'project', source: 'skills-dir', name: 'p', description: 'd', path: '/tmp/proj/.claude/skills/p/SKILL.md' },
        ],
        projectAgents: [],
        globalAgents: [],
        globalSkills: [
          { id: 'enabled-skill', scope: 'global', source: 'skills-dir', name: 'enabled', description: 'd', path: '/skills/enabled-skill/SKILL.md' },
          { id: 'disabled-skill', scope: 'global', source: 'skills-dir', name: 'disabled', description: 'd', path: '/skills/disabled-skill/SKILL.md' },
        ],
      }),
      materializeSkills: materialize,
    })

    await manager.startSession({ projectId: 'p1', prompt: 'x' })

    expect(materialize).toHaveBeenCalledTimes(1)
    const [worktreePath, enabledSkills] = materialize.mock.calls[0] as [string, Array<{ id: string }>]
    expect(worktreePath).toContain('/tmp/proj/.worktrees/')
    expect(enabledSkills.map((s) => s.id)).toEqual(['uncommitted-project-skill', 'enabled-skill']) // disabled-skill correctly filtered out
  })

  describe('requestStart / confirmStart / cancelStart — plan-bound confirmation', () => {
    it('auto mode starts immediately, same as calling startSession directly', async () => {
      const { manager, fakeTransport } = setup({ approvalMode: 'auto' })
      const result = await manager.requestStart({ projectId: 'p1', prompt: 'do it' })
      expect(result).toMatchObject({ status: 'started' })
      expect(fakeTransport.started).toBe(true)
    })

    it('ask mode returns a pending confirmation and does NOT start anything yet', async () => {
      const { manager, fakeTransport } = setup({ approvalMode: 'ask', permissionTier: 'manage' })
      const result = await manager.requestStart({ projectId: 'p1', prompt: 'do it' })
      expect(result).toMatchObject({ status: 'pending', tier: 'manage', prompt: 'do it' })
      expect(fakeTransport.started).toBe(false)
    })

    it('confirmStart with the exact same prompt actually starts the session', async () => {
      const { manager, fakeTransport } = setup({ approvalMode: 'ask' })
      const requested = await manager.requestStart({ projectId: 'p1', prompt: 'do it' })
      if (requested.status !== 'pending') throw new Error('expected a pending confirmation')

      const sessionId = await manager.confirmStart({ confirmationId: requested.confirmationId, prompt: 'do it' })
      expect(typeof sessionId).toBe('string')
      expect(fakeTransport.started).toBe(true)
    })

    it('confirmStart with a DIFFERENT prompt than what was proposed is rejected — plan-bound, not silently re-used', async () => {
      const { manager, fakeTransport } = setup({ approvalMode: 'ask' })
      const requested = await manager.requestStart({ projectId: 'p1', prompt: 'do the safe thing' })
      if (requested.status !== 'pending') throw new Error('expected a pending confirmation')

      await expect(manager.confirmStart({ confirmationId: requested.confirmationId, prompt: 'do something else entirely' })).rejects.toThrow(
        /changed since this confirmation was shown/,
      )
      expect(fakeTransport.started).toBe(false)

      // The invalidated confirmation can't be retried even with the original text — it's consumed, not just rejected once.
      await expect(manager.confirmStart({ confirmationId: requested.confirmationId, prompt: 'do the safe thing' })).rejects.toThrow(
        /no such pending confirmation/,
      )
    })

    it('cancelStart discards a pending confirmation outright', async () => {
      const { manager } = setup({ approvalMode: 'ask' })
      const requested = await manager.requestStart({ projectId: 'p1', prompt: 'do it' })
      if (requested.status !== 'pending') throw new Error('expected a pending confirmation')

      manager.cancelStart(requested.confirmationId)
      await expect(manager.confirmStart({ confirmationId: requested.confirmationId, prompt: 'do it' })).rejects.toThrow(
        /no such pending confirmation/,
      )
    })
  })

  describe('killSession / grantAutonomy — the "Take back control" kill switch', () => {
    it('kill stops the real transport immediately and marks the session needs-review', async () => {
      const { manager, fakeTransport, store } = setup()
      const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'long running' })

      manager.killSession(sessionId)

      expect(fakeTransport.stopped).toBe(true)
      expect(store.getSession(sessionId)?.status).toBe('needs-review')
    })

    it('a clean exit after a kill still resolves to needs-review, not idle — handleExit must not clobber the kill', async () => {
      const { manager, fakeTransport, store } = setup()
      const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'long running' })

      manager.killSession(sessionId)
      fakeTransport.exit({ code: 0 }) // the killed process's own exit event, arriving after the fact

      expect(store.getSession(sessionId)?.status).toBe('needs-review')
    })

    it('kill logs a real kill-switch activity-log entry, pushed live', async () => {
      const { manager, onEvent } = setup()
      const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'long running' })

      manager.killSession(sessionId)

      expect(onEvent).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ kind: 'activity-log', payload: expect.objectContaining({ kind: 'kill-switch' }) }),
      )
    })

    it('kill revokes the PROJECT\'s autonomy — the next startSession attempt is refused outright', async () => {
      const { manager } = setup()
      const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'long running' })
      manager.killSession(sessionId)

      await expect(manager.startSession({ projectId: 'p1', prompt: 'try again' })).rejects.toThrow(/Autonomy has been revoked/)
    })

    it('requestStart also refuses once autonomy is revoked, even in auto mode', async () => {
      const { manager } = setup({ approvalMode: 'auto' })
      const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'long running' })
      manager.killSession(sessionId)

      await expect(manager.requestStart({ projectId: 'p1', prompt: 'try again' })).rejects.toThrow(/Autonomy has been revoked/)
    })

    it('grantAutonomy re-arms the project so a new session can start again', async () => {
      const { manager, store } = setup()
      const sessionId = await manager.startSession({ projectId: 'p1', prompt: 'long running' })
      manager.killSession(sessionId)

      manager.grantAutonomy('p1')

      expect(store.getProject('p1')?.autonomyRevoked).toBe(false)
      const newSessionId = await manager.startSession({ projectId: 'p1', prompt: 'try again' })
      expect(newSessionId).not.toBe(sessionId)
    })

    it('killing one project never revokes a different project\'s autonomy', async () => {
      const store = new MemoryStore(null)
      store.upsertProject(makeProject({ id: 'p1' }))
      store.upsertProject(makeProject({ id: 'p2' }))
      const transports = new Map<string, FakeTransport>()
      const manager = new SessionManager({
        store,
        onEvent: () => {},
        onSessionUpdate: () => {},
        createTransport: (sessionId) => {
          const t = new FakeTransport()
          transports.set(sessionId, t)
          return t
        },
        createWorktree: (repoPath, sessionId) => ({ path: repoPath, branch: `laird/${sessionId}`, isGitRepo: true }),
        discoverSkillsAndAgents: noSkills,
        materializeSkills: noMaterialize,
      })

      const sessionA = await manager.startSession({ projectId: 'p1', prompt: 'A' })
      manager.killSession(sessionA)

      const sessionB = await manager.startSession({ projectId: 'p2', prompt: 'B' })
      expect(transports.get(sessionB)!.started).toBe(true)
    })
  })
})
