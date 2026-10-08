import { join } from 'node:path'
import { app, BrowserWindow, safeStorage } from 'electron'

/**
 * User-confirmed tradeoff (2026-10-07): exposes Chrome DevTools Protocol on
 * loopback-only for the lifetime of the app, so the harness's own
 * Playwright MCP server can drive the exact same embedded live-preview
 * panel the user is watching (`previewPanel.ts`) instead of a second,
 * invisible browser. Must be set before `app` is ready — Chromium
 * command-line switches can't be toggled per-session afterward. Same
 * default bind (127.0.0.1 only, never 0.0.0.0) Electron already uses for
 * this flag — a standing local debug surface, comparable in risk to e.g.
 * React DevTools, not a new network-exposed service.
 */
const CDP_PORT = 9335
app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT))
import { IPC } from './ipc/channels'
import { ipcHandle, registerCleanup, runCleanups } from './ipc/registry'
import { listDirectory, openExternal, pathExists, readFilePreview } from './files/browser'
import { resolveWithinProject } from './files/security'
import { addProject } from './project/registry'
import { removeWorktree } from './project/worktree'
import { assertMainFrame } from './security'
import { discoverSkillsAndAgents, resolveEnabledSkills } from './skills/discovery'
import { detectStackSignals, recommendGlobalSkills } from './skills/recommend'
import { createProjectSkill } from './skills/create'
import { browsePlugins, installPlugin, listMarketplaces, uninstallPlugin } from './skills/marketplace'
import { detectPreviewCommand } from './harness/previewDetect'
import { detectTestCommand } from './harness/testRunner'
import { runReviewer } from './harness/reviewer'
import { classifyCriterionClarity } from './harness/jev'
import { cdpTargetExists, getBrowserCdpEndpoint } from './harness/cdpTarget'
import { PreviewPanelManager } from './harness/previewPanel'
import { TypesafeKeyStore, defaultTypesafeKeyPath } from './settings/typesafeKey'
import { MemoryStore, defaultSnapshotPath } from './store/memoryStore'
import { SessionManager } from './session/sessionManager'
import { buildSessionHistory } from './session/history'
import type { Project } from '../shared/types'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let previewPanelManager: PreviewPanelManager | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

const store = new MemoryStore(isDev ? null : defaultSnapshotPath(app.getPath('userData')))
const typesafeKeyStore = new TypesafeKeyStore(defaultTypesafeKeyPath(app.getPath('userData')), safeStorage)

/**
 * The real root cause of a real hang, found live: quitting the app while a
 * session is still active lets that session's eventual exit/update arrive
 * *after* the window has already been destroyed. `mainWindow?.` only guards
 * against `mainWindow` being `null` — `webContents.send()` on an
 * already-destroyed window throws synchronously ("Object has been
 * destroyed"), and an uncaught main-process exception triggers Electron's
 * own blocking error dialog, which silently hung every "quit mid-run"
 * scenario (it has no human present to click OK in an automated test, or
 * ever again before a crash-report tool surfaces it to a real user).
 */
function sendToMainWindow(channel: string, ...args: unknown[]): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send(channel, ...args)
}

const sessionManager = new SessionManager({
  store,
  onEvent: (sessionId, event) => {
    sendToMainWindow(IPC.SESSION_EVENT, sessionId, event)
  },
  onSessionUpdate: (session) => {
    sendToMainWindow(IPC.SESSION_EVENT, session.id, { kind: 'session-status', payload: session })
  },
})

// Direct fix for the orphaned-process behavior observed in chunk 2 (killing
// the dev-mode wrapper left the real Electron process tree running): every
// active transport is stopped before quit, not left to the OS to clean up.
registerCleanup('session-manager', () => sessionManager.stopAll())

ipcHandle(IPC.SESSION_PING, (event) => {
  assertMainFrame(event)
  return { ok: true, ts: Date.now() }
})

ipcHandle(IPC.SESSION_REQUEST_START, (event, opts: { projectId: string; prompt: string }) => {
  assertMainFrame(event)
  return sessionManager.requestStart(opts)
})

ipcHandle(IPC.SESSION_CONFIRM_START, (event, opts: { confirmationId: string; prompt: string }) => {
  assertMainFrame(event)
  return sessionManager.confirmStart(opts)
})

ipcHandle(IPC.SESSION_CANCEL_START, (event, opts: { confirmationId: string }) => {
  assertMainFrame(event)
  sessionManager.cancelStart(opts.confirmationId)
})

ipcHandle(IPC.SESSION_KILL, (event, opts: { sessionId: string }) => {
  assertMainFrame(event)
  sessionManager.killSession(opts.sessionId)
  const session = store.getSession(opts.sessionId)
  return session ? store.getProject(session.projectId) : undefined
})

ipcHandle(IPC.SESSION_GRANT_AUTONOMY, (event, opts: { projectId: string }) => {
  assertMainFrame(event)
  sessionManager.grantAutonomy(opts.projectId)
  return store.getProject(opts.projectId)
})

ipcHandle(IPC.SESSION_HISTORY_LIST, (event, opts: { projectId: string }) => {
  assertMainFrame(event)
  return buildSessionHistory(store, opts.projectId)
})

ipcHandle(IPC.PROJECT_ADD, (event, opts: { path: string; name?: string }) => {
  assertMainFrame(event)
  return addProject(store, opts)
})

ipcHandle(IPC.PROJECT_LIST, (event) => {
  assertMainFrame(event)
  return store.listProjects()
})

ipcHandle(
  IPC.PROJECT_SET_PERMISSIONS,
  (event, opts: { projectId: string; permissionTier?: Project['permissionTier']; approvalMode?: Project['approvalMode'] }) => {
    assertMainFrame(event)
    store.setPermissions(opts.projectId, opts)
    return store.getProject(opts.projectId)
  },
)

ipcHandle(IPC.PROJECT_REMOVE, (event, opts: { id: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.id)
  if (project) {
    // Disposable by design (see worktree.ts) — a project's own worktrees are
    // cleaned up with it, never left as orphaned git-worktree cruft.
    for (const session of store.getSessionsForProject(opts.id)) {
      removeWorktree(project.path, session.worktreePath)
    }
  }
  store.removeProject(opts.id)
})

ipcHandle(IPC.SKILLS_LIST, async (event, opts: { projectId: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`SKILLS_LIST: unknown projectId ${opts.projectId}`)
  const discovered = await discoverSkillsAndAgents(project)
  return { ...discovered, enabledGlobalSkillIds: project.enabledGlobalSkillIds }
})

ipcHandle(IPC.SKILLS_SET_ENABLED, (event, opts: { projectId: string; skillId: string; enabled: boolean }) => {
  assertMainFrame(event)
  store.setGlobalSkillEnabled(opts.projectId, opts.skillId, opts.enabled)
})

ipcHandle(IPC.SKILLS_RECOMMEND, async (event, opts: { projectId: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`SKILLS_RECOMMEND: unknown projectId ${opts.projectId}`)
  // "First run" — never prompted again once the project has a real session,
  // so the suggestion stays a one-time first-impression, not a recurring nag.
  const isFirstRun = store.getSessionsForProject(opts.projectId).length === 0
  const signals = detectStackSignals(project.path)
  const discovered = await discoverSkillsAndAgents(project)
  const recommended = recommendGlobalSkills(discovered, signals)
  return { isFirstRun, signals, recommended }
})

ipcHandle(IPC.SKILLS_CREATE, (event, opts: { projectId: string; name: string; description: string; body: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`SKILLS_CREATE: unknown projectId ${opts.projectId}`)
  // Errors here (bad name, empty description, duplicate) are meant to reach
  // the renderer's own try/catch and surface as an inline form error, not
  // get swallowed — ipcHandle's own rejection propagates that as-is.
  return createProjectSkill(project.path, opts)
})

ipcHandle(IPC.MARKETPLACE_LIST, (event) => {
  assertMainFrame(event)
  return listMarketplaces()
})

ipcHandle(IPC.MARKETPLACE_BROWSE, (event) => {
  assertMainFrame(event)
  return browsePlugins()
})

ipcHandle(IPC.MARKETPLACE_INSTALL, (event, opts: { pluginId: string }) => {
  assertMainFrame(event)
  return installPlugin(opts.pluginId)
})

ipcHandle(IPC.MARKETPLACE_UNINSTALL, (event, opts: { pluginId: string }) => {
  assertMainFrame(event)
  return uninstallPlugin(opts.pluginId)
})

ipcHandle(IPC.HARNESS_CRITERIA_SET, (event, opts: { projectId: string; criteria: string[] }) => {
  assertMainFrame(event)
  store.setHarnessCriteria(opts.projectId, opts.criteria)
  return store.getProject(opts.projectId)
})

ipcHandle(IPC.HARNESS_PREVIEW_DETECT, (event, opts: { projectId: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`HARNESS_PREVIEW_DETECT: unknown projectId ${opts.projectId}`)
  return detectPreviewCommand(project.path)
})

ipcHandle(IPC.HARNESS_PREVIEW_SET, (event, opts: { projectId: string; uiPreview: Project['uiPreview'] }) => {
  assertMainFrame(event)
  store.setUiPreview(opts.projectId, opts.uiPreview)
  return store.getProject(opts.projectId)
})

ipcHandle(IPC.HARNESS_COST_CEILING_SET, (event, opts: { projectId: string; costCeilingUsd: number | undefined }) => {
  assertMainFrame(event)
  store.setCostCeiling(opts.projectId, opts.costCeilingUsd)
  return store.getProject(opts.projectId)
})

/** One active, cancelable harness run per project — matches the UI's own "Run harness" button, which is disabled while a run is already in flight. */
const activeHarnessRuns = new Map<string, AbortController>()

ipcHandle(IPC.HARNESS_RUN_START, async (event, opts: { projectId: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`HARNESS_RUN_START: unknown projectId ${opts.projectId}`)
  if (project.harnessCriteria.length === 0) throw new Error('HARNESS_RUN_START: project has no harness criteria to check')
  const anyJevFeatureEnabled = Object.values(project.jevFeatures).some(Boolean)
  const jevApiKey = anyJevFeatureEnabled ? (typesafeKeyStore.getKey() ?? undefined) : undefined

  // If the embedded live-preview panel already has this exact project's dev
  // server up, the harness shares that same visible surface over CDP
  // instead of starting a second, invisible one. Two real findings from
  // live runs shaped this: (1) a page-level CDP session can't manage
  // targets at all ("Target.createTarget: Not supported") — Playwright
  // needs the real browser-level endpoint instead; (2) that endpoint
  // covers every top-level view under this one `--remote-debugging-port`,
  // including Laird's own chrome window, so `cdpTargetExists` only
  // confirms the embedded page is genuinely still open — it's
  // `buildUiReviewerPrompt`'s own shared-browser preamble (list tabs,
  // select the one at the exact right URL, refuse rather than guess if
  // it's missing) that actually keeps the reviewer off Laird's own UI.
  let sharedPreview: { url: string; cdpEndpoint: string; onLockChange: (locked: boolean) => void } | undefined
  const activePreview = previewPanelManager?.getState()
  if (activePreview?.projectId === project.id && (await cdpTargetExists(CDP_PORT, activePreview.url))) {
    const cdpEndpoint = await getBrowserCdpEndpoint(CDP_PORT)
    if (cdpEndpoint) {
      sharedPreview = {
        url: activePreview.url,
        cdpEndpoint,
        onLockChange: (locked) => sendToMainWindow(IPC.PREVIEW_PANEL_LOCK_CHANGED, locked),
      }
    }
  }

  const controller = new AbortController()
  activeHarnessRuns.set(project.id, controller)
  try {
    const run = await runReviewer(project, {
      jevApiKey,
      signal: controller.signal,
      sharedPreview,
      getRecordedScript: (criterion) => store.getRecordedScript(project.id, criterion),
      saveRecordedScript: (criterion, script) => store.setRecordedScript(project.id, criterion, script),
      clearRecordedScript: (criterion) => store.clearRecordedScript(project.id, criterion),
    })
    store.appendHarnessRun(run)
    return run
  } finally {
    activeHarnessRuns.delete(project.id)
  }
})

ipcHandle(IPC.HARNESS_RUN_CANCEL, (event, opts: { projectId: string }) => {
  assertMainFrame(event)
  activeHarnessRuns.get(opts.projectId)?.abort()
})

ipcHandle(IPC.HARNESS_RUN_LIST, (event, opts: { projectId: string }) => {
  assertMainFrame(event)
  return store.getHarnessRuns(opts.projectId)
})

ipcHandle(IPC.HARNESS_JEV_SET_FEATURES, (event, opts: { projectId: string; features: Partial<Project['jevFeatures']> }) => {
  assertMainFrame(event)
  store.setJevFeatures(opts.projectId, opts.features)
  return store.getProject(opts.projectId)
})

ipcHandle(IPC.HARNESS_TEST_DETECT, (event, opts: { projectId: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`HARNESS_TEST_DETECT: unknown projectId ${opts.projectId}`)
  return detectTestCommand(project.path)
})

ipcHandle(IPC.HARNESS_TEST_SET, (event, opts: { projectId: string; testCommand: Project['testCommand'] }) => {
  assertMainFrame(event)
  store.setTestCommand(opts.projectId, opts.testCommand)
  return store.getProject(opts.projectId)
})

ipcHandle(IPC.HARNESS_CRITERION_PREFILTER, async (event, opts: { projectId: string; criterion: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`HARNESS_CRITERION_PREFILTER: unknown projectId ${opts.projectId}`)
  if (!project.jevFeatures.criteriaPrefilter) return { clear: true, confidence: 0 }
  const apiKey = typesafeKeyStore.getKey()
  if (!apiKey) return { clear: true, confidence: 0 }
  return classifyCriterionClarity(apiKey, opts.criterion)
})

ipcHandle(IPC.SETTINGS_TYPESAFE_STATUS, (event) => {
  assertMainFrame(event)
  return { configured: typesafeKeyStore.hasKey(), available: typesafeKeyStore.isAvailable() }
})

ipcHandle(IPC.SETTINGS_TYPESAFE_SET_KEY, (event, opts: { apiKey: string }) => {
  assertMainFrame(event)
  // Validation errors (e.g. secure storage unavailable) propagate to the
  // renderer's own try/catch, same convention as SKILLS_CREATE.
  typesafeKeyStore.setKey(opts.apiKey)
  return { configured: typesafeKeyStore.hasKey(), available: typesafeKeyStore.isAvailable() }
})

ipcHandle(IPC.SETTINGS_TYPESAFE_CLEAR_KEY, (event) => {
  assertMainFrame(event)
  typesafeKeyStore.clearKey()
  return { configured: typesafeKeyStore.hasKey(), available: typesafeKeyStore.isAvailable() }
})

/**
 * Workstream I (pillar 5) — `files/security.ts`'s `resolveWithinProject` is
 * the real containment check; every handler here resolves against the
 * project's own `path`, never a session's ephemeral worktree (see the
 * plan's own research: a worktree is torn down with its session, `path` is
 * the stable, persistent directory a "browse this project's files" feature
 * actually means).
 */
ipcHandle(IPC.FILES_LIST, (event, opts: { projectId: string; relativePath: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`FILES_LIST: unknown projectId ${opts.projectId}`)
  const absoluteDir = resolveWithinProject(project.path, opts.relativePath)
  if (!pathExists(absoluteDir)) throw new Error(`FILES_LIST: ${opts.relativePath} does not exist`)
  return listDirectory(absoluteDir)
})

ipcHandle(IPC.FILES_READ, (event, opts: { projectId: string; relativePath: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`FILES_READ: unknown projectId ${opts.projectId}`)
  const absolutePath = resolveWithinProject(project.path, opts.relativePath)
  if (!pathExists(absolutePath)) throw new Error(`FILES_READ: ${opts.relativePath} does not exist`)
  return readFilePreview(absolutePath)
})

ipcHandle(IPC.FILES_OPEN_EXTERNAL, async (event, opts: { projectId: string; relativePath: string }) => {
  assertMainFrame(event)
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`FILES_OPEN_EXTERNAL: unknown projectId ${opts.projectId}`)
  const absolutePath = resolveWithinProject(project.path, opts.relativePath)
  if (!pathExists(absolutePath)) throw new Error(`FILES_OPEN_EXTERNAL: ${opts.relativePath} does not exist`)
  return openExternal(absolutePath)
})

ipcHandle(IPC.PREVIEW_PANEL_START, async (event, opts: { projectId: string }) => {
  assertMainFrame(event)
  if (!previewPanelManager) throw new Error('PREVIEW_PANEL_START: no window yet')
  const project = store.getProject(opts.projectId)
  if (!project) throw new Error(`PREVIEW_PANEL_START: unknown projectId ${opts.projectId}`)
  if (!project.uiPreview) return { ok: false, message: 'No UI preview command is configured for this project yet.' }
  if (project.uiPreview.port == null) return { ok: false, message: 'A UI preview command is configured but no port was set.' }
  return previewPanelManager.start({
    projectId: project.id,
    projectPath: project.path,
    command: project.uiPreview.command,
    port: project.uiPreview.port,
  })
})

ipcHandle(IPC.PREVIEW_PANEL_STOP, (event) => {
  assertMainFrame(event)
  previewPanelManager?.stop()
})

ipcHandle(IPC.PREVIEW_PANEL_HIDE, (event) => {
  assertMainFrame(event)
  previewPanelManager?.hide()
})

ipcHandle(IPC.PREVIEW_PANEL_SET_BOUNDS, (event, bounds: { x: number; y: number; width: number; height: number }) => {
  assertMainFrame(event)
  previewPanelManager?.setBounds(bounds)
})

ipcHandle(IPC.PREVIEW_PANEL_STATUS, (event) => {
  assertMainFrame(event)
  return previewPanelManager?.getState() ?? null
})

app.whenReady().then(() => {
  mainWindow = createWindow()
  previewPanelManager = new PreviewPanelManager(mainWindow)
  registerCleanup('preview-panel', () => previewPanelManager?.stop())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void runCleanups()
})
