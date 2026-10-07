import { randomUUID } from 'node:crypto'
import type { MemoryStore } from '../store/memoryStore'
import { createWorktree as createWorktreeImpl, type WorktreeResult } from '../project/worktree'
import { discoverSkillsAndAgents, resolveEnabledSkills, type DiscoveredSkillsAndAgents } from '../skills/discovery'
import { materializeSkills as materializeSkillsImpl } from '../skills/materialize'
import type { ActivityLogEntry, PermissionTier, Session, Subagent, Turn, TurnContentBlock, TurnFileChangeBlock } from '../../shared/types'
import { ClaudeHeadlessTransport } from './claudeHeadlessTransport'
import type { SessionTransport, SessionTransportEvent } from './transport'

/**
 * `Write`/`Edit` tool-calls become real `fileChange` blocks (path + a rough
 * diff stat) instead of a generic tool-call label — this is what lets the
 * UI render an actual file-change chip ("Settings.tsx — created, +18") from
 * real data, per the v9-signature mockup, rather than a placeholder.
 */
function toFileChangeBlock(payload: { name: string; input?: Record<string, unknown> }): TurnFileChangeBlock | null {
  if (payload.name !== 'Write' && payload.name !== 'Edit') return null
  const filePath = typeof payload.input?.file_path === 'string' ? payload.input.file_path : undefined
  if (!filePath) return null
  const path = filePath.split('/').pop() ?? filePath
  if (payload.name === 'Write') {
    const content = typeof payload.input?.content === 'string' ? payload.input.content : ''
    const lines = content ? content.split('\n').length : 0
    return { kind: 'fileChange', path, summary: 'created', diffStat: `+${lines}` }
  }
  return { kind: 'fileChange', path, summary: 'edited' }
}

/** What the renderer actually receives over IPC: real transport deltas, plus finalized Turn/Subagent/ActivityLogEntry objects. */
export type SessionManagerEvent =
  | SessionTransportEvent
  | { kind: 'turn'; payload: Turn }
  | { kind: 'subagent'; payload: Subagent }
  | { kind: 'activity-log'; payload: ActivityLogEntry }

export interface SessionManagerDeps {
  store: MemoryStore
  onEvent: (sessionId: string, event: SessionManagerEvent) => void
  onSessionUpdate: (session: Session) => void
  /** Injectable so tests never touch a real child process. */
  createTransport?: (sessionId: string) => SessionTransport
  /** Injectable so tests never touch real git — defaults to the real worktree.ts implementation. */
  createWorktree?: (repoPath: string, sessionId: string) => WorktreeResult
  /** Injectable so tests never touch the real filesystem/`claude plugin list` — defaults to the real discovery.ts implementation. */
  discoverSkillsAndAgents?: (project: Parameters<typeof discoverSkillsAndAgents>[0]) => Promise<DiscoveredSkillsAndAgents>
  /** Injectable so tests never touch the real filesystem — defaults to the real materialize.ts implementation. */
  materializeSkills?: typeof materializeSkillsImpl
}

interface PendingUsage {
  costUsd: number
  durationMs: number
  isError: boolean
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

interface ManagedSession {
  session: Session
  transport: SessionTransport
  pendingAgentBlocks: TurnContentBlock[]
  pendingUsage: PendingUsage | null
  /** Live subagent roster, keyed by the stable `task_id` from `task_*` system events (see mapEvents.ts). */
  subagents: Map<string, Subagent>
  /**
   * tool_use id → the `ActivityLogEntry` row logged for that same tool-call.
   * Two jobs: (1) dedup — a real `claude` run under
   * `--include-partial-messages` emits the same `tool_use` block twice
   * (mapEvents.ts shape B's partial `stream_event`, then shape A's complete
   * `assistant` message), sharing the same id; without this, every real
   * tool call would log two ActivityLogEntry rows and push two Turn blocks
   * (confirmed live via e2e/subagent-live-status.ts). (2) for an `Agent`
   * tool-call specifically, also resolved against a later `task_started`
   * event's own `tool_use_id` to set `Subagent.parentActivityLogEntryId`
   * (docs/research/observability-landscape-2026.md).
   */
  toolCallLogIdByToolUseId: Map<string, string>
  /**
   * tool_use id → that tool-call's own index in `pendingAgentBlocks`. The
   * partial `stream_event` arrival (shape B) always carries an empty
   * `input` (nothing has streamed in yet at `content_block_start` time), so
   * `toFileChangeBlock` can only ever build a real `fileChange` block
   * (path/diffStat) from the LATER, complete arrival (shape A) — a repeat
   * tool-call event for an id already in this map overwrites that same
   * array slot in place with the newer (more complete) block instead of
   * being dropped, which previously left every real Write/Edit chip stuck
   * on shape B's empty-input placeholder (confirmed live via
   * e2e/two-project-isolation.mjs after `toolCallLogIdByToolUseId`'s own
   * dedup fix: the activity-log duplicate was fixed, but the Turn's own
   * chip silently regressed to the wrong, incomplete shape).
   */
  toolCallBlockIndexByToolUseId: Map<string, number>
  /** Set by `killSession` — tells `handleExit` to keep the session in `needs-review`, not silently report a clean `idle` exit for what was actually a forced stop. */
  killed: boolean
}

/** Plan-bound: the exact `projectId`/`prompt`/`model` a confirmation screen showed — `confirmStart` re-checks the prompt matches before actually running it. */
interface PendingConfirmation {
  projectId: string
  prompt: string
  model?: string
}

export type RequestStartResult =
  | { status: 'started'; sessionId: string }
  | { status: 'pending'; confirmationId: string; tier: PermissionTier; prompt: string }

/**
 * `Map<sessionId, ManagedSession>`, directly modeled on Workspace-OS's own
 * session maps (`agent-pty.ts`'s `sessions` Map). One map, transport-
 * agnostic — Workstream A only ever constructs `ClaudeHeadlessTransport`,
 * but nothing here assumes that.
 */
export class SessionManager {
  private sessions = new Map<string, ManagedSession>()
  private pendingConfirmations = new Map<string, PendingConfirmation>()

  constructor(private readonly deps: SessionManagerDeps) {}

  /**
   * The approval-mode-aware entry point (Workstream D) — what the renderer's
   * "send" should actually call, not `startSession` directly. `auto` mode
   * starts immediately (unchanged behavior); `ask` mode returns a
   * plan-bound pending confirmation instead of starting anything, which
   * `confirmStart` must be called with the *exact same prompt* to resolve.
   */
  async requestStart(opts: { projectId: string; prompt: string; model?: string }): Promise<RequestStartResult> {
    const project = this.deps.store.getProject(opts.projectId)
    if (!project) throw new Error(`requestStart: unknown projectId ${opts.projectId}`)
    if (project.autonomyRevoked) {
      throw new Error('Autonomy has been revoked for this project — resume control before starting a new session.')
    }

    if (project.approvalMode === 'auto') {
      const sessionId = await this.startSession(opts)
      return { status: 'started', sessionId }
    }

    const confirmationId = randomUUID()
    this.pendingConfirmations.set(confirmationId, { projectId: opts.projectId, prompt: opts.prompt, model: opts.model })
    return { status: 'pending', confirmationId, tier: project.permissionTier, prompt: opts.prompt }
  }

  /**
   * Plan-bound confirmation (observability-trust-and-harness.md): the
   * caller must pass back the exact prompt text the pending confirmation
   * showed. If it doesn't match — the proposed action changed underneath
   * the still-open confirmation — the old approval is invalidated outright,
   * not silently re-used against a different action.
   */
  async confirmStart(opts: { confirmationId: string; prompt: string }): Promise<string> {
    const pending = this.pendingConfirmations.get(opts.confirmationId)
    if (!pending) {
      throw new Error('confirmStart: no such pending confirmation (already confirmed, cancelled, or never existed)')
    }
    if (pending.prompt !== opts.prompt) {
      this.pendingConfirmations.delete(opts.confirmationId)
      throw new Error('The proposed action changed since this confirmation was shown — review and confirm again.')
    }
    this.pendingConfirmations.delete(opts.confirmationId)
    return this.startSession({ projectId: pending.projectId, prompt: pending.prompt, model: pending.model })
  }

  cancelStart(confirmationId: string): void {
    this.pendingConfirmations.delete(confirmationId)
  }

  /**
   * `cwd` is resolved from the project's registered path, not taken from the
   * caller (Workstream B) — and, as of Workstream C, so are the skills a
   * fresh worktree actually needs symlinked in: its own project skills
   * (which might be real but uncommitted, e.g. just created through Laird's
   * own "create a new skill" form — a bare `git worktree add` only checks
   * out HEAD, confirmed live, so it would otherwise miss them) plus whichever
   * global skills this project explicitly opted into (see materialize.ts).
   *
   * The real, guaranteed-immediate start — called directly by tests that
   * exercise start/exit mechanics, and internally by `requestStart`'s
   * `auto`-mode branch and by `confirmStart`. Still enforces the kill-switch
   * (`autonomyRevoked`) itself, since that hard gate applies regardless of
   * which path reached it.
   */
  async startSession(opts: { projectId: string; prompt: string; model?: string }): Promise<string> {
    const project = this.deps.store.getProject(opts.projectId)
    if (!project) throw new Error(`startSession: unknown projectId ${opts.projectId}`)
    if (project.autonomyRevoked) {
      throw new Error('Autonomy has been revoked for this project — resume control before starting a new session.')
    }

    const sessionId = randomUUID()
    const now = new Date().toISOString()

    const makeWorktree = this.deps.createWorktree ?? createWorktreeImpl
    const worktree = makeWorktree(project.path, sessionId)

    const discover = this.deps.discoverSkillsAndAgents ?? discoverSkillsAndAgents
    const materialize = this.deps.materializeSkills ?? materializeSkillsImpl
    const discovered = await discover(project)
    const enabledGlobalSkills = resolveEnabledSkills(discovered, project).filter((s) => s.scope === 'global')
    materialize(worktree.path, [...discovered.projectSkills, ...enabledGlobalSkills])

    const session: Session = {
      id: sessionId,
      projectId: opts.projectId,
      worktreePath: worktree.path,
      status: 'running',
      startedAt: now,
    }
    this.deps.store.upsertSession(session)
    this.deps.onSessionUpdate(session)

    const userTurn: Turn = {
      id: randomUUID(),
      sessionId,
      role: 'user',
      blocks: [{ kind: 'text', text: opts.prompt }],
      createdAt: now,
    }
    this.deps.store.appendTurn(userTurn)
    this.deps.onEvent(sessionId, { kind: 'turn', payload: userTurn })

    const transport = this.deps.createTransport
      ? this.deps.createTransport(sessionId)
      : new ClaudeHeadlessTransport({ permissionTier: project.permissionTier })

    const managed: ManagedSession = {
      session,
      transport,
      pendingAgentBlocks: [],
      pendingUsage: null,
      subagents: new Map(),
      toolCallLogIdByToolUseId: new Map(),
      toolCallBlockIndexByToolUseId: new Map(),
      killed: false,
    }
    this.sessions.set(sessionId, managed)

    transport.onEvent((event) => this.handleEvent(sessionId, event))
    transport.onExit((info) => this.handleExit(sessionId, info))

    transport.start({ cwd: worktree.path, prompt: opts.prompt, model: opts.model })

    return sessionId
  }

  stopSession(sessionId: string): void {
    this.sessions.get(sessionId)?.transport.stop()
  }

  /**
   * "Take back control" (observability-trust-and-harness.md): stops the
   * active transport immediately — same mechanism `stopSession` already
   * uses, live-verified in Workstream A's hardening pass — and additionally
   * revokes the *project's* autonomy (see `Project.autonomyRevoked`), since
   * Laird's one-process-per-turn architecture has no "next action" inside a
   * dead process to refuse; the next real action is always a fresh session,
   * and that's what gets refused until `grantAutonomy` is called.
   */
  killSession(sessionId: string): void {
    const managed = this.sessions.get(sessionId)
    if (!managed) return

    managed.killed = true
    managed.transport.stop()

    managed.session = { ...managed.session, status: 'needs-review' }
    this.deps.store.upsertSession(managed.session)
    this.deps.onSessionUpdate(managed.session)

    this.deps.store.setAutonomyRevoked(managed.session.projectId, true)
    this.appendActivityLog(sessionId, { kind: 'kill-switch', payload: { projectId: managed.session.projectId } })
  }

  /** Re-grants autonomy after a kill switch — the explicit human action the PRD requires before a new session can start. */
  grantAutonomy(projectId: string): void {
    this.deps.store.setAutonomyRevoked(projectId, false)
  }

  /** Called on app quit — the direct fix for the orphaned-process risk observed in chunk 2. */
  stopAll(): void {
    for (const { transport } of this.sessions.values()) transport.stop()
  }

  private handleEvent(sessionId: string, event: SessionTransportEvent): void {
    const managed = this.sessions.get(sessionId)
    if (!managed) return

    if (event.kind === 'subagent') {
      const payload = event.payload as {
        taskId: string
        toolUseId?: string
        subagentType?: string
        description?: string
        status?: Subagent['status']
        lastAction?: string
      }
      const existing = managed.subagents.get(payload.taskId)
      const parentActivityLogEntryId =
        (payload.toolUseId && managed.toolCallLogIdByToolUseId.get(payload.toolUseId)) || existing?.parentActivityLogEntryId
      const merged: Subagent = {
        id: payload.taskId,
        sessionId,
        name: payload.description ?? existing?.name ?? payload.taskId,
        role: payload.subagentType ?? existing?.role ?? 'subagent',
        status: payload.status ?? existing?.status ?? 'active',
        lastAction: payload.lastAction ?? existing?.lastAction,
        parentActivityLogEntryId,
      }
      managed.subagents.set(payload.taskId, merged)
      this.deps.onEvent(sessionId, { kind: 'subagent', payload: merged })
      this.appendActivityLog(sessionId, { kind: 'tool-call', payload: merged })
      return
    }

    if (event.kind === 'tool-call') {
      const payload = event.payload as { id?: string; name: string; input?: Record<string, unknown>; status?: string }
      const block = toFileChangeBlock(payload) ?? { kind: 'toolCall' as const, name: payload.name, status: 'started' as const }
      const existingIndex = payload.id ? managed.toolCallBlockIndexByToolUseId.get(payload.id) : undefined

      if (existingIndex !== undefined) {
        // A real `claude` run emits the same tool_use id twice — a partial
        // stream_event (always empty `input`, nothing has streamed in yet
        // at `content_block_start` time) then the complete assistant
        // message. Only the second, complete arrival can ever produce a
        // real `fileChange` block, so this overwrites the same array slot
        // in place rather than appending a duplicate or being dropped
        // outright — neither the renderer nor the activity log sees the
        // repeat (see `toolCallLogIdByToolUseId`'s doc comment), but the
        // eventually-finalized Turn still gets the real, complete data.
        managed.pendingAgentBlocks[existingIndex] = block
        return
      }

      managed.pendingAgentBlocks.push(block)
      if (payload.id) managed.toolCallBlockIndexByToolUseId.set(payload.id, managed.pendingAgentBlocks.length - 1)

      this.deps.onEvent(sessionId, event)
      const logEntryId = this.appendActivityLog(sessionId, { kind: 'tool-call', payload })
      // Remembered so a later `task_started` event (mapEvents.ts) can link
      // its subagent back to this exact ActivityLogEntry via `tool_use_id`.
      if (payload.id) {
        managed.toolCallLogIdByToolUseId.set(payload.id, logEntryId)
      }
      return
    }

    this.deps.onEvent(sessionId, event)

    if (event.kind === 'session-id') {
      const payload = event.payload as { sessionId: string }
      managed.session = { ...managed.session, claudeSessionId: payload.sessionId }
      this.deps.store.upsertSession(managed.session)
      return
    }

    if (event.kind === 'text') {
      const payload = event.payload as { text: string }
      managed.pendingAgentBlocks.push({ kind: 'text', text: payload.text })
      return
    }

    if (event.kind === 'usage') {
      // Deferred until handleExit, where the finalized Turn's real id exists
      // to attach UsageEvent.turnId to — the result line always arrives
      // before process exit, never after.
      managed.pendingUsage = event.payload as PendingUsage
      this.appendActivityLog(sessionId, { kind: 'decision', payload: event.payload })
    }
  }

  private handleExit(sessionId: string, info: { code: number | null; failure?: { kind: string; message: string } }): void {
    const managed = this.sessions.get(sessionId)
    if (!managed) return

    const filesChanged = managed.pendingAgentBlocks.filter((b) => b.kind === 'fileChange').length

    let finalTurnId = ''
    if (managed.pendingAgentBlocks.length > 0) {
      const agentTurn: Turn = {
        id: randomUUID(),
        sessionId,
        role: 'agent',
        blocks: managed.pendingAgentBlocks,
        createdAt: new Date().toISOString(),
      }
      finalTurnId = agentTurn.id
      this.deps.store.appendTurn(agentTurn)
      this.deps.onEvent(sessionId, { kind: 'turn', payload: agentTurn })
    }

    if (managed.pendingUsage) {
      this.deps.store.appendUsageEvent({
        id: randomUUID(),
        sessionId,
        turnId: finalTurnId,
        costUsd: managed.pendingUsage.costUsd,
        durationMs: managed.pendingUsage.durationMs,
        filesChanged,
        inputTokens: managed.pendingUsage.inputTokens,
        outputTokens: managed.pendingUsage.outputTokens,
        cacheReadTokens: managed.pendingUsage.cacheReadTokens,
        cacheCreationTokens: managed.pendingUsage.cacheCreationTokens,
      })
    }

    managed.session = {
      ...managed.session,
      // A deliberate kill always resolves to needs-review, regardless of
      // how the child process happened to exit (SIGTERM is not a failure
      // from the transport's own point of view) — killSession already set
      // this, but handleExit runs after and would otherwise clobber it back
      // to 'idle' the moment the process actually dies.
      status: managed.killed ? 'needs-review' : info.failure ? 'needs-review' : 'idle',
    }
    this.deps.store.upsertSession(managed.session)
    this.deps.onSessionUpdate(managed.session)

    if (info.failure) {
      this.appendActivityLog(sessionId, { kind: 'decision', payload: { failure: info.failure } })
    }
  }

  /**
   * The one write path into `ActivityLogEntry` (per architecture-and-data.md)
   * — and, as of Workstream D, also the one place that pushes it live to the
   * renderer. The trust/guardrail "always-visible action log"
   * (observability-trust-and-harness.md) is this log, rendered — not a
   * second mechanism that re-derives the same facts.
   */
  private appendActivityLog(sessionId: string, entry: Pick<ActivityLogEntry, 'kind' | 'payload'>): string {
    const logEntry: ActivityLogEntry = {
      id: randomUUID(),
      sessionId,
      kind: entry.kind,
      payload: entry.payload,
      createdAt: new Date().toISOString(),
    }
    this.deps.store.appendActivityLog(logEntry)
    this.deps.onEvent(sessionId, { kind: 'activity-log', payload: logEntry })
    return logEntry.id
  }
}
