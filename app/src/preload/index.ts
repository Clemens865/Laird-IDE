import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../main/ipc/channels'
import type { DiscoveredSkillsAndAgents } from '../main/skills/discovery'
import type { BrowseResult, InstallResult, MarketplaceEntry, UninstallResult } from '../main/skills/marketplace'
import type { SessionHistoryEntry } from '../main/session/history'
import type { RequestStartResult, SessionManagerEvent } from '../main/session/sessionManager'
import type { HarnessRun, Project, Skill } from '../shared/types'

contextBridge.exposeInMainWorld('laird', {
  session: {
    ping: () => ipcRenderer.invoke(IPC.SESSION_PING),
    requestStart: (opts: { projectId: string; prompt: string }): Promise<RequestStartResult> =>
      ipcRenderer.invoke(IPC.SESSION_REQUEST_START, opts),
    confirmStart: (opts: { confirmationId: string; prompt: string }): Promise<string> =>
      ipcRenderer.invoke(IPC.SESSION_CONFIRM_START, opts),
    cancelStart: (opts: { confirmationId: string }) => ipcRenderer.invoke(IPC.SESSION_CANCEL_START, opts),
    kill: (opts: { sessionId: string }): Promise<Project | undefined> => ipcRenderer.invoke(IPC.SESSION_KILL, opts),
    grantAutonomy: (opts: { projectId: string }): Promise<Project | undefined> =>
      ipcRenderer.invoke(IPC.SESSION_GRANT_AUTONOMY, opts),
    historyList: (opts: { projectId: string }): Promise<SessionHistoryEntry[]> =>
      ipcRenderer.invoke(IPC.SESSION_HISTORY_LIST, opts),
    onEvent: (cb: (sessionId: string, event: SessionManagerEvent) => void) => {
      const handler = (_e: unknown, sessionId: string, event: SessionManagerEvent) => cb(sessionId, event)
      ipcRenderer.on(IPC.SESSION_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_EVENT, handler)
    },
  },
  project: {
    add: (opts: { path: string; name?: string }): Promise<Project> => ipcRenderer.invoke(IPC.PROJECT_ADD, opts),
    list: (): Promise<Project[]> => ipcRenderer.invoke(IPC.PROJECT_LIST),
    remove: (opts: { id: string }) => ipcRenderer.invoke(IPC.PROJECT_REMOVE, opts),
    setPermissions: (opts: {
      projectId: string
      permissionTier?: Project['permissionTier']
      approvalMode?: Project['approvalMode']
    }): Promise<Project | undefined> => ipcRenderer.invoke(IPC.PROJECT_SET_PERMISSIONS, opts),
  },
  skills: {
    list: (opts: { projectId: string }): Promise<DiscoveredSkillsAndAgents & { enabledGlobalSkillIds: string[] }> =>
      ipcRenderer.invoke(IPC.SKILLS_LIST, opts),
    setEnabled: (opts: { projectId: string; skillId: string; enabled: boolean }) =>
      ipcRenderer.invoke(IPC.SKILLS_SET_ENABLED, opts),
    recommend: (opts: { projectId: string }): Promise<{ isFirstRun: boolean; signals: string[]; recommended: Skill[] }> =>
      ipcRenderer.invoke(IPC.SKILLS_RECOMMEND, opts),
    create: (opts: { projectId: string; name: string; description: string; body: string }): Promise<Skill> =>
      ipcRenderer.invoke(IPC.SKILLS_CREATE, opts),
  },
  marketplace: {
    list: (): Promise<MarketplaceEntry[]> => ipcRenderer.invoke(IPC.MARKETPLACE_LIST),
    browse: (): Promise<BrowseResult> => ipcRenderer.invoke(IPC.MARKETPLACE_BROWSE),
    install: (opts: { pluginId: string }): Promise<InstallResult> => ipcRenderer.invoke(IPC.MARKETPLACE_INSTALL, opts),
    uninstall: (opts: { pluginId: string }): Promise<UninstallResult> => ipcRenderer.invoke(IPC.MARKETPLACE_UNINSTALL, opts),
  },
  harness: {
    setCriteria: (opts: { projectId: string; criteria: string[] }): Promise<Project | undefined> =>
      ipcRenderer.invoke(IPC.HARNESS_CRITERIA_SET, opts),
    detectPreview: (opts: { projectId: string }): Promise<Project['uiPreview'] | null> =>
      ipcRenderer.invoke(IPC.HARNESS_PREVIEW_DETECT, opts),
    setPreview: (opts: { projectId: string; uiPreview: Project['uiPreview'] }): Promise<Project | undefined> =>
      ipcRenderer.invoke(IPC.HARNESS_PREVIEW_SET, opts),
    startRun: (opts: { projectId: string }): Promise<HarnessRun> => ipcRenderer.invoke(IPC.HARNESS_RUN_START, opts),
    cancelRun: (opts: { projectId: string }): Promise<void> => ipcRenderer.invoke(IPC.HARNESS_RUN_CANCEL, opts),
    listRuns: (opts: { projectId: string }): Promise<HarnessRun[]> => ipcRenderer.invoke(IPC.HARNESS_RUN_LIST, opts),
    setJevFeatures: (opts: { projectId: string; features: Partial<Project['jevFeatures']> }): Promise<Project | undefined> =>
      ipcRenderer.invoke(IPC.HARNESS_JEV_SET_FEATURES, opts),
    detectTest: (opts: { projectId: string }): Promise<Project['testCommand'] | null> => ipcRenderer.invoke(IPC.HARNESS_TEST_DETECT, opts),
    setTest: (opts: { projectId: string; testCommand: Project['testCommand'] }): Promise<Project | undefined> =>
      ipcRenderer.invoke(IPC.HARNESS_TEST_SET, opts),
    criterionPrefilter: (opts: { projectId: string; criterion: string }): Promise<{ clear: boolean; confidence: number }> =>
      ipcRenderer.invoke(IPC.HARNESS_CRITERION_PREFILTER, opts),
  },
  settings: {
    typesafeStatus: (): Promise<{ configured: boolean; available: boolean }> => ipcRenderer.invoke(IPC.SETTINGS_TYPESAFE_STATUS),
    typesafeSetKey: (opts: { apiKey: string }): Promise<{ configured: boolean; available: boolean }> =>
      ipcRenderer.invoke(IPC.SETTINGS_TYPESAFE_SET_KEY, opts),
    typesafeClearKey: (): Promise<{ configured: boolean; available: boolean }> => ipcRenderer.invoke(IPC.SETTINGS_TYPESAFE_CLEAR_KEY),
  },
  previewPanel: {
    start: (opts: { projectId: string }): Promise<{ ok: true } | { ok: false; message: string }> =>
      ipcRenderer.invoke(IPC.PREVIEW_PANEL_START, opts),
    stop: (): Promise<void> => ipcRenderer.invoke(IPC.PREVIEW_PANEL_STOP),
    hide: (): Promise<void> => ipcRenderer.invoke(IPC.PREVIEW_PANEL_HIDE),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<void> =>
      ipcRenderer.invoke(IPC.PREVIEW_PANEL_SET_BOUNDS, bounds),
    status: (): Promise<{ projectId: string; url: string } | null> => ipcRenderer.invoke(IPC.PREVIEW_PANEL_STATUS),
    onLockChange: (cb: (locked: boolean) => void) => {
      const handler = (_e: unknown, locked: boolean) => cb(locked)
      ipcRenderer.on(IPC.PREVIEW_PANEL_LOCK_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.PREVIEW_PANEL_LOCK_CHANGED, handler)
    },
  },
})
