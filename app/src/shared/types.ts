// Data model, verbatim from docs/prd/technical/architecture-and-data.md.
// Shared between main, preload, and renderer.

/**
 * Named exactly per docs/prd/technical/observability-trust-and-harness.md's
 * tiered-permission model, mapped onto Claude Code's real tool surface in
 * `src/main/session/permissions.ts`: `read` (Read/Glob/Grep only) →
 * `write` (+ file edits) → `manage` (+ subagents/skills/web research) →
 * `full` (+ a scoped, denylisted Bash).
 */
export type PermissionTier = 'read' | 'write' | 'manage' | 'full'

/**
 * `ask` means a session doesn't start the moment "send" is clicked — Laird
 * shows a plan-bound confirmation (the exact prompt text + tier about to
 * run) first. `auto` skips that pre-flight confirmation. Neither mode ever
 * removes the hard exceptions in `permissions.ts` (FULL_DISALLOWED) — those
 * are stronger than "ask," because a headless `claude -p` session has no
 * human attached to ask mid-turn; see that module's own doc comment.
 */
export type ApprovalMode = 'ask' | 'auto'

export interface Project {
  id: string
  name: string
  path: string
  gitRemote?: string
  colorToken: string
  createdAt: string
  lastActiveAt: string
  /**
   * Global skills explicitly turned on for this project — per
   * docs/prd/technical/skills-and-plugins.md's resolved design, nothing
   * global ever applies by default. Identified by `Skill.id`.
   */
  enabledGlobalSkillIds: string[]
  permissionTier: PermissionTier
  approvalMode: ApprovalMode
  /**
   * Set by the "Take back control" kill switch (observability-trust-and-
   * harness.md): true means a new session is refused outright until
   * explicitly re-granted — not just "the current one stopped."
   */
  autonomyRevoked: boolean
}

export type SessionStatus = 'running' | 'idle' | 'needs-review'

export interface Session {
  id: string
  projectId: string
  worktreePath: string
  status: SessionStatus
  startedAt: string
  /** The underlying `claude` CLI's own session id, used for --resume. */
  claudeSessionId?: string
}

export interface TurnTextBlock {
  kind: 'text'
  text: string
}

export interface TurnFileChangeBlock {
  kind: 'fileChange'
  path: string
  summary: string
  diffStat?: string
}

export interface TurnToolCallBlock {
  kind: 'toolCall'
  name: string
  status: 'started' | 'ok' | 'error'
}

export type TurnContentBlock = TurnTextBlock | TurnFileChangeBlock | TurnToolCallBlock

export interface Turn {
  id: string
  sessionId: string
  role: 'user' | 'agent'
  blocks: TurnContentBlock[]
  createdAt: string
}

/**
 * A discovered skill DEFINITION (a real `SKILL.md` file on disk, or one
 * bundled inside an installed plugin) — not a session's live state.
 * `scope: 'project'` skills always apply; `scope: 'global'` ones only apply
 * once explicitly turned on for a project (see `Project.enabledGlobalSkillIds`).
 */
export interface Skill {
  id: string
  scope: 'project' | 'global'
  /** Loose file under a `.claude/skills/` dir, or bundled inside an installed plugin. */
  source: 'skills-dir' | 'plugin'
  pluginId?: string
  name: string
  description: string
  path: string
  iconRef?: string
  shortcut?: string
}

/** A discovered custom-subagent DEFINITION (a real `.md` file under `.claude/agents/`). */
export interface SubagentDefinition {
  id: string
  scope: 'project' | 'global'
  name: string
  description: string
  path: string
}

/** A subagent's LIVE status during one running session — distinct from its definition above. */
export interface Subagent {
  id: string
  sessionId: string
  name: string
  role: string
  status: 'active' | 'idle' | 'done'
  lastAction?: string
  /**
   * The `ActivityLogEntry` row for the `Agent` tool-call that spawned this
   * subagent — matches OpenInference's "a child span inherits its parent
   * agent's id" rule (docs/research/observability-landscape-2026.md).
   * `undefined` only if that correlation genuinely couldn't be made (e.g. a
   * `task_started` event arriving with no matching prior tool-call logged),
   * never silently guessed.
   */
  parentActivityLogEntryId?: string
}

export interface UsageEvent {
  id: string
  sessionId: string
  turnId: string
  costUsd: number
  durationMs: number
  filesChanged: number
  /**
   * The real token breakdown the `claude` CLI already reports on every turn
   * — named to match OTel GenAI's `gen_ai.usage.input_tokens`/`output_tokens`
   * directly; cache token fields are Laird-specific since OTel GenAI doesn't
   * yet standardize them (docs/research/observability-landscape-2026.md).
   * Optional because older persisted snapshots (pre-this-field) won't have them.
   */
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

export type EvidenceTier = 'VERIFIED' | 'CORROBORATED' | 'UNCORROBORATED' | 'INFERENCE' | 'STATED'

export interface HarnessRun {
  id: string
  projectId: string
  spec: string[]
  disposition: 'ship' | 'hold' | 'rework'
  perCriterionResult: Array<{ passed: boolean; evidenceTier: EvidenceTier }>
  linkedTurnId: string
}

export interface PluginInstall {
  id: string
  source: string
  name: string
  components: string[]
  enabled: boolean
}

export type ActivityLogKind = 'tool-call' | 'file-change' | 'decision' | 'permission-prompt' | 'kill-switch'

export interface ActivityLogEntry {
  id: string
  sessionId: string
  turnId?: string
  kind: ActivityLogKind
  payload: unknown
  createdAt: string
}
