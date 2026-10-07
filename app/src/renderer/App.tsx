import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityLogEntry, Project, SessionStatus, Subagent, Turn } from '../shared/types'
import { ActionLog } from './components/ActionLog'
import { ActivityStream } from './components/ActivityStream'
import { AutonomyRevokedBanner } from './components/AutonomyRevokedBanner'
import { BoardDefs } from './components/BoardDefs'
import { ConfirmStart } from './components/ConfirmStart'
import { CostFooter } from './components/CostFooter'
import { Composer } from './components/Composer'
import { Decorative } from './components/Decorative'
import { GridView, lastMessageFrom } from './components/GridView'
import { KillSwitch } from './components/KillSwitch'
import { MarketplaceView } from './components/MarketplaceView'
import { PermissionControl } from './components/PermissionControl'
import { ProjectTab } from './components/ProjectTab'
import { SessionHistoryView } from './components/SessionHistoryView'
import { SkillsView } from './components/SkillsView'
import { SubagentRoster } from './components/SubagentRoster'
import { Topbar, type AppView } from './components/Topbar'

interface PendingConfirmation {
  confirmationId: string
  tier: Project['permissionTier']
  prompt: string
}

interface ProjectSessionState {
  sessionId: string | null
  status: SessionStatus
  turns: Turn[]
  usage: { costUsd: number; durationMs: number }
  subagents: Subagent[]
  activityLog: ActivityLogEntry[]
  pendingConfirmation: PendingConfirmation | null
}

function emptyState(): ProjectSessionState {
  return {
    sessionId: null,
    status: 'idle',
    turns: [],
    usage: { costUsd: 0, durationMs: 0 },
    subagents: [],
    activityLog: [],
    pendingConfirmation: null,
  }
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [sessionState, setSessionState] = useState<Record<string, ProjectSessionState>>({})
  const [addingProject, setAddingProject] = useState(false)
  const [newProjectPath, setNewProjectPath] = useState('')
  const [view, setView] = useState<AppView>('tabs')

  // sessionId -> projectId: populated the moment a session starts, since
  // raw transport/turn events only carry a sessionId, not a projectId.
  const sessionOwner = useRef<Record<string, string>>({})

  useEffect(() => {
    window.laird.project.list().then((loaded) => {
      setProjects(loaded)
      setSessionState(Object.fromEntries(loaded.map((p) => [p.id, emptyState()])))
      if (loaded.length > 0) setSelectedProjectId(loaded[0].id)
    })
  }, [])

  useEffect(() => {
    const unsubscribe = window.laird.session.onEvent((sessionId, event) => {
      if (event.kind === 'session-status') {
        const session = event.payload as { projectId: string; status: SessionStatus }
        setSessionState((prev) => ({
          ...prev,
          [session.projectId]: { ...(prev[session.projectId] ?? emptyState()), status: session.status },
        }))
        return
      }

      const projectId = sessionOwner.current[sessionId]
      if (!projectId) return // an event for a session this window didn't start (shouldn't happen in Foundation)

      if (event.kind === 'turn') {
        const turn = event.payload as Turn
        setSessionState((prev) => ({
          ...prev,
          [projectId]: { ...(prev[projectId] ?? emptyState()), turns: [...(prev[projectId]?.turns ?? []), turn] },
        }))
      } else if (event.kind === 'usage') {
        const payload = event.payload as { costUsd: number; durationMs: number }
        setSessionState((prev) => ({
          ...prev,
          [projectId]: { ...(prev[projectId] ?? emptyState()), usage: payload },
        }))
      } else if (event.kind === 'subagent') {
        const subagent = event.payload as Subagent
        setSessionState((prev) => {
          const current = prev[projectId] ?? emptyState()
          const existingIndex = current.subagents.findIndex((s) => s.id === subagent.id)
          const subagents =
            existingIndex === -1
              ? [...current.subagents, subagent]
              : current.subagents.map((s, i) => (i === existingIndex ? subagent : s))
          return { ...prev, [projectId]: { ...current, subagents } }
        })
      } else if (event.kind === 'activity-log') {
        const entry = event.payload as ActivityLogEntry
        setSessionState((prev) => {
          const current = prev[projectId] ?? emptyState()
          return { ...prev, [projectId]: { ...current, activityLog: [...current.activityLog, entry] } }
        })
      }
    })
    return unsubscribe
  }, [])

  const handleAddProject = useCallback(async () => {
    const path = newProjectPath.trim()
    if (!path) return
    const project = await window.laird.project.add({ path })
    setProjects((prev) => [...prev, project])
    setSessionState((prev) => ({ ...prev, [project.id]: emptyState() }))
    setSelectedProjectId(project.id)
    setNewProjectPath('')
    setAddingProject(false)
  }, [newProjectPath])

  // Replaces the project in-place everywhere it's held, after any call that
  // returns an updated Project (kill, grant-autonomy, permission changes).
  const applyProjectUpdate = useCallback((updated: Project | undefined) => {
    if (!updated) return
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }, [])

  const handleSend = useCallback(
    async (projectId: string, prompt: string) => {
      const result = await window.laird.session.requestStart({ projectId, prompt })
      if (result.status === 'started') {
        setSessionState((prev) => ({ ...prev, [projectId]: { ...emptyState(), status: 'running', sessionId: result.sessionId } }))
        sessionOwner.current[result.sessionId] = projectId
      } else {
        setSessionState((prev) => ({
          ...prev,
          [projectId]: {
            ...(prev[projectId] ?? emptyState()),
            pendingConfirmation: { confirmationId: result.confirmationId, tier: result.tier, prompt: result.prompt },
          },
        }))
      }
    },
    [],
  )

  const handleConfirmStart = useCallback(async (projectId: string, pending: PendingConfirmation) => {
    setSessionState((prev) => ({ ...prev, [projectId]: { ...emptyState(), status: 'running' } }))
    try {
      const sessionId = await window.laird.session.confirmStart({ confirmationId: pending.confirmationId, prompt: pending.prompt })
      sessionOwner.current[sessionId] = projectId
      setSessionState((prev) => ({ ...prev, [projectId]: { ...(prev[projectId] ?? emptyState()), sessionId } }))
    } catch (err) {
      // Plan-bound confirmation was invalidated (or already consumed) — back to an editable composer, not stuck "running" forever.
      console.error('[confirmStart] failed', err)
      setSessionState((prev) => ({ ...prev, [projectId]: emptyState() }))
    }
  }, [])

  const handleCancelStart = useCallback(async (projectId: string, confirmationId: string) => {
    await window.laird.session.cancelStart({ confirmationId })
    setSessionState((prev) => ({ ...prev, [projectId]: { ...(prev[projectId] ?? emptyState()), pendingConfirmation: null } }))
  }, [])

  const handleKill = useCallback(
    async (sessionId: string) => {
      const updated = await window.laird.session.kill({ sessionId })
      applyProjectUpdate(updated)
    },
    [applyProjectUpdate],
  )

  const handleGrantAutonomy = useCallback(
    async (projectId: string) => {
      const updated = await window.laird.session.grantAutonomy({ projectId })
      applyProjectUpdate(updated)
    },
    [applyProjectUpdate],
  )

  const handleSetPermissions = useCallback(
    async (projectId: string, change: { permissionTier?: Project['permissionTier']; approvalMode?: Project['approvalMode'] }) => {
      const updated = await window.laird.project.setPermissions({ projectId, ...change })
      applyProjectUpdate(updated)
    },
    [applyProjectUpdate],
  )

  const selected = projects.find((p) => p.id === selectedProjectId) ?? null
  const selectedState = selectedProjectId ? sessionState[selectedProjectId] ?? emptyState() : emptyState()
  const filesChanged = selectedState.turns.reduce(
    (count, turn) => count + turn.blocks.filter((b) => b.kind === 'fileChange').length,
    0,
  )

  return (
    <div className="app" data-testid="app-root">
      <BoardDefs />
      <Decorative className="grain">
        <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
          <filter id="grainF">
            <feTurbulence type="fractalNoise" baseFrequency={0.85} numOctaves={2} seed={11} stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grainF)" />
        </svg>
      </Decorative>
      <Decorative className="mist-layer">
        <div className="mist-blob m1" />
        <div className="mist-blob m2" />
        <div className="mist-blob m3" />
      </Decorative>

      <Topbar view={view} onSetView={setView} />

      <div className="tabs">
        {view === 'tabs' &&
          projects.map((project) => (
            <ProjectTab
              key={project.id}
              project={project}
              status={sessionState[project.id]?.status ?? 'idle'}
              selected={project.id === selectedProjectId}
              onSelect={() => setSelectedProjectId(project.id)}
            />
          ))}
        {addingProject ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              data-testid="new-project-path-input"
              value={newProjectPath}
              onChange={(e) => setNewProjectPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddProject()}
              placeholder="/path/to/project"
              className="mono"
              style={{ fontSize: 12, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', background: 'var(--surface-raised)' }}
              autoFocus
            />
            <button className="tab-add" onClick={handleAddProject} data-testid="confirm-add-project" aria-label="Confirm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M20 6 L9 17 L4 12" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            className="tab-add"
            onClick={() => setAddingProject(true)}
            data-testid="add-project-button"
            aria-label="Add project"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5 V19 M5 12 H19" />
            </svg>
          </button>
        )}
      </div>

      {view === 'marketplace' ? (
        <MarketplaceView />
      ) : view === 'history' ? (
        selected ? (
          <SessionHistoryView projectId={selected.id} />
        ) : (
          <div style={{ padding: 40, color: 'var(--muted)' }}>Add a project first.</div>
        )
      ) : view === 'skills' ? (
        selected ? (
          <SkillsView projectId={selected.id} />
        ) : (
          <div style={{ padding: 40, color: 'var(--muted)' }}>Add a project first.</div>
        )
      ) : view === 'grid' ? (
        <GridView
          cards={projects.map((project) => ({
            project,
            status: sessionState[project.id]?.status ?? 'idle',
            lastMessage: lastMessageFrom(sessionState[project.id]?.turns ?? []),
            costUsd: sessionState[project.id]?.usage.costUsd ?? 0,
            durationMs: sessionState[project.id]?.usage.durationMs ?? 0,
          }))}
          selectedProjectId={selectedProjectId}
          onSelect={(projectId) => {
            setSelectedProjectId(projectId)
            setView('tabs')
          }}
        />
      ) : selected ? (
        <div className="body">
          <div className="stream-col glass">
            <ActivityStream turns={selectedState.turns} projectName={selected.name} />
            {selected.autonomyRevoked ? (
              <AutonomyRevokedBanner onResume={() => handleGrantAutonomy(selected.id)} />
            ) : selectedState.pendingConfirmation ? (
              <ConfirmStart
                prompt={selectedState.pendingConfirmation.prompt}
                tier={selectedState.pendingConfirmation.tier}
                onConfirm={() => handleConfirmStart(selected.id, selectedState.pendingConfirmation!)}
                onCancel={() => handleCancelStart(selected.id, selectedState.pendingConfirmation!.confirmationId)}
              />
            ) : (
              <>
                {selectedState.status === 'running' && selectedState.sessionId && (
                  <KillSwitch onKill={() => handleKill(selectedState.sessionId!)} />
                )}
                <PermissionControl
                  tier={selected.permissionTier}
                  approvalMode={selected.approvalMode}
                  onChange={(change) => handleSetPermissions(selected.id, change)}
                />
                <Composer
                  onSend={(prompt) => handleSend(selected.id, prompt)}
                  disabled={selectedState.status === 'running'}
                  placeholder={`Tell Laird what to build next in ${selected.name}…`}
                />
              </>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <SubagentRoster subagents={selectedState.subagents} />
            <ActionLog entries={selectedState.activityLog} />
            <CostFooter costUsd={selectedState.usage.costUsd} durationMs={selectedState.usage.durationMs} filesChanged={filesChanged} />
          </div>
        </div>
      ) : (
        <div style={{ padding: 40, color: 'var(--muted)' }} data-testid="empty-state">
          No projects yet — add one to get started.
        </div>
      )}
    </div>
  )
}
