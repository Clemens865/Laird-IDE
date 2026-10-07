import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { IPC } from './ipc/channels'
import { ipcHandle, registerCleanup, runCleanups } from './ipc/registry'
import { addProject } from './project/registry'
import { removeWorktree } from './project/worktree'
import { assertMainFrame } from './security'
import { discoverSkillsAndAgents, resolveEnabledSkills } from './skills/discovery'
import { detectStackSignals, recommendGlobalSkills } from './skills/recommend'
import { createProjectSkill } from './skills/create'
import { browsePlugins, installPlugin, listMarketplaces, uninstallPlugin } from './skills/marketplace'
import { MemoryStore, defaultSnapshotPath } from './store/memoryStore'
import { SessionManager } from './session/sessionManager'
import { buildSessionHistory } from './session/history'
import type { Project } from '../shared/types'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

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

app.whenReady().then(() => {
  mainWindow = createWindow()

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
