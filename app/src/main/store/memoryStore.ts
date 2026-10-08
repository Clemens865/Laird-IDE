import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ActivityLogEntry, HarnessRun, Project, Session, Turn, UsageEvent } from '../../shared/types'
import type { RecordedScript } from '../harness/recordedScript'

interface StoreSnapshot {
  projects: Project[]
  sessions: Session[]
  turns: Turn[]
  activityLog: ActivityLogEntry[]
  usageEvents: UsageEvent[]
  harnessRuns: HarnessRun[]
  recordedScripts: Array<[string, RecordedScript]>
}

/** `Project.id` + the exact criterion text — a script only ever applies to the one criterion it was recorded for. */
function recordedScriptKey(projectId: string, criterion: string): string {
  return `${projectId}::${criterion}`
}

const DEBOUNCE_MS = 1_000

/**
 * In-memory store with a debounced JSON snapshot for crash survival — same
 * shape as Workspace-OS's `persistConversations()` pattern. Deliberately not
 * SQLite yet — fine at this scale (a handful of projects/sessions); move to
 * `better-sqlite3` once there's real multi-session history worth querying
 * (per Convidence_AI's own "same store, separate table" lesson — don't
 * introduce a second storage system before it's actually needed).
 */
export class MemoryStore {
  private projects = new Map<string, Project>()
  private sessions = new Map<string, Session>()
  private turns: Turn[] = []
  private activityLog: ActivityLogEntry[] = []
  private usageEvents: UsageEvent[] = []
  private harnessRuns: HarnessRun[] = []
  private recordedScripts = new Map<string, RecordedScript>()
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly snapshotPath: string | null) {
    if (this.snapshotPath && existsSync(this.snapshotPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.snapshotPath, 'utf8')) as StoreSnapshot
        for (const p of raw.projects ?? []) this.projects.set(p.id, p)
        for (const s of raw.sessions ?? []) this.sessions.set(s.id, s)
        this.turns = raw.turns ?? []
        this.activityLog = raw.activityLog ?? []
        this.usageEvents = raw.usageEvents ?? []
        this.harnessRuns = raw.harnessRuns ?? []
        for (const [key, script] of raw.recordedScripts ?? []) this.recordedScripts.set(key, script)
      } catch (err) {
        console.error('[store] failed to load snapshot, starting empty', err)
      }
    }
  }

  upsertProject(project: Project): void {
    this.projects.set(project.id, project)
    this.scheduleSnapshot()
  }

  listProjects(): Project[] {
    return [...this.projects.values()]
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id)
  }

  /** The per-project opt-in toggle for a global skill — see `Project.enabledGlobalSkillIds`. */
  setGlobalSkillEnabled(projectId: string, skillId: string, enabled: boolean): void {
    const project = this.projects.get(projectId)
    if (!project) return
    const current = new Set(project.enabledGlobalSkillIds)
    if (enabled) current.add(skillId)
    else current.delete(skillId)
    this.upsertProject({ ...project, enabledGlobalSkillIds: [...current] })
  }

  /** The "Take back control" kill switch (revoke: true) and its resume counterpart (revoke: false). */
  setAutonomyRevoked(projectId: string, revoked: boolean): void {
    const project = this.projects.get(projectId)
    if (!project) return
    this.upsertProject({ ...project, autonomyRevoked: revoked })
  }

  setPermissions(projectId: string, permissions: { permissionTier?: Project['permissionTier']; approvalMode?: Project['approvalMode'] }): void {
    const project = this.projects.get(projectId)
    if (!project) return
    this.upsertProject({ ...project, ...permissions })
  }

  /** The user-authored, numbered acceptance criteria a harness run checks — see `Project.harnessCriteria`. */
  setHarnessCriteria(projectId: string, criteria: string[]): void {
    const project = this.projects.get(projectId)
    if (!project) return
    this.upsertProject({ ...project, harnessCriteria: criteria })
  }

  /** The detect-then-confirm dev command/port a harness run uses to reach this project's own UI — see `Project.uiPreview`. */
  setUiPreview(projectId: string, uiPreview: Project['uiPreview']): void {
    const project = this.projects.get(projectId)
    if (!project) return
    this.upsertProject({ ...project, uiPreview })
  }

  /** Per-feature TypeSafe/Jev opt-in for harness runs — see `Project.jevFeatures`/`JevFeatures`. */
  setJevFeatures(projectId: string, features: Partial<Project['jevFeatures']>): void {
    const project = this.projects.get(projectId)
    if (!project) return
    this.upsertProject({ ...project, jevFeatures: { ...project.jevFeatures, ...features } })
  }

  /** Detect-then-confirm test command a harness run uses for criteria that reduce to "the tests should pass" — see `Project.testCommand`. */
  setTestCommand(projectId: string, testCommand: Project['testCommand']): void {
    const project = this.projects.get(projectId)
    if (!project) return
    this.upsertProject({ ...project, testCommand })
  }

  /** The real-dollar cap on a single harness run's reviewer spend — see `Project.harnessCostCeilingUsd`. `undefined` clears it. */
  setCostCeiling(projectId: string, costCeilingUsd: number | undefined): void {
    const project = this.projects.get(projectId)
    if (!project) return
    this.upsertProject({ ...project, harnessCostCeilingUsd: costCeilingUsd })
  }

  appendHarnessRun(run: HarnessRun): void {
    this.harnessRuns.push(run)
    this.scheduleSnapshot()
  }

  getHarnessRuns(projectId: string): HarnessRun[] {
    return this.harnessRuns.filter((r) => r.projectId === projectId)
  }

  /** Saves a successful browser-driven check's real steps for free, deterministic replay next time — see `recordedScript.ts`. */
  setRecordedScript(projectId: string, criterion: string, script: RecordedScript): void {
    this.recordedScripts.set(recordedScriptKey(projectId, criterion), script)
    this.scheduleSnapshot()
  }

  getRecordedScript(projectId: string, criterion: string): RecordedScript | undefined {
    return this.recordedScripts.get(recordedScriptKey(projectId, criterion))
  }

  /** Called when a saved script no longer replays — the next run falls back to a fresh LLM-driven check, which may record a new one. */
  clearRecordedScript(projectId: string, criterion: string): void {
    this.recordedScripts.delete(recordedScriptKey(projectId, criterion))
    this.scheduleSnapshot()
  }

  removeProject(id: string): void {
    this.projects.delete(id)
    this.scheduleSnapshot()
  }

  upsertSession(session: Session): void {
    this.sessions.set(session.id, session)
    this.scheduleSnapshot()
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  getSessionsForProject(projectId: string): Session[] {
    return [...this.sessions.values()].filter((s) => s.projectId === projectId)
  }

  appendTurn(turn: Turn): void {
    this.turns.push(turn)
    this.scheduleSnapshot()
  }

  getTurns(sessionId: string): Turn[] {
    return this.turns.filter((t) => t.sessionId === sessionId)
  }

  appendActivityLog(entry: ActivityLogEntry): void {
    this.activityLog.push(entry)
    this.scheduleSnapshot()
  }

  getActivityLog(sessionId: string): ActivityLogEntry[] {
    return this.activityLog.filter((e) => e.sessionId === sessionId)
  }

  appendUsageEvent(event: UsageEvent): void {
    this.usageEvents.push(event)
    this.scheduleSnapshot()
  }

  getUsageEvents(sessionId: string): UsageEvent[] {
    return this.usageEvents.filter((e) => e.sessionId === sessionId)
  }

  private scheduleSnapshot(): void {
    if (!this.snapshotPath) return
    if (this.snapshotTimer) return
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null
      this.writeSnapshotNow()
    }, DEBOUNCE_MS)
  }

  /** Flush immediately — used on app quit, where a debounce would lose data. */
  writeSnapshotNow(): void {
    if (!this.snapshotPath) return
    const snapshot: StoreSnapshot = {
      projects: [...this.projects.values()],
      sessions: [...this.sessions.values()],
      turns: this.turns,
      activityLog: this.activityLog,
      usageEvents: this.usageEvents,
      harnessRuns: this.harnessRuns,
      recordedScripts: [...this.recordedScripts.entries()],
    }
    try {
      mkdirSync(dirname(this.snapshotPath), { recursive: true })
      writeFileSync(this.snapshotPath, JSON.stringify(snapshot), 'utf8')
    } catch (err) {
      console.error('[store] failed to write snapshot', err)
    }
  }
}

export function defaultSnapshotPath(userDataDir: string): string {
  return join(userDataDir, 'laird-store.json')
}
