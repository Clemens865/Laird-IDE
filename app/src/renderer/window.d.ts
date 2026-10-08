export {}

import type { HarnessRun, Project, Skill, SubagentDefinition } from '../shared/types'
import type { DirectoryListing, FilePreview } from '../main/files/browser'
import type { UpdateEvent } from '../main/update/autoUpdater'
import type { BatteryState } from '../main/system/battery'

interface SessionTransportEvent {
  kind: string
  payload: unknown
  turnId?: string
}

interface SkillsListResult {
  projectSkills: Skill[]
  globalSkills: Skill[]
  projectAgents: SubagentDefinition[]
  globalAgents: SubagentDefinition[]
  enabledGlobalSkillIds: string[]
}

interface SkillsRecommendResult {
  isFirstRun: boolean
  signals: string[]
  recommended: Skill[]
}

type RequestStartResult =
  | { status: 'started'; sessionId: string }
  | { status: 'pending'; confirmationId: string; tier: Project['permissionTier']; prompt: string }

interface SessionHistoryEntry {
  sessionId: string
  startedAt: string
  status: 'running' | 'idle' | 'needs-review'
  costUsd: number
  durationMs: number
  filesChanged: number
  prompt: string
}

interface MarketplaceEntry {
  name: string
  source: string
  url?: string
  repo?: string
  installLocation: string
}

interface AvailablePlugin {
  pluginId: string
  name: string
  description: string
  marketplaceName: string
  installCount?: number
}

interface BrowseResult {
  installedIds: string[]
  available: AvailablePlugin[]
}

interface PluginDetails {
  description: string
  skillsCount: number
  skillNames: string[]
  agentsCount: number
  agentNames: string[]
  hooksCount: number
  mcpServersCount: number
  lspServersCount: number
  alwaysOnTokenCost: number | null
}

interface SecretScanResult {
  clean: boolean
  findings: Array<{ label: string; path: string }>
}

interface InstallResult {
  outcome: 'ok' | 'error'
  message: string
  details?: PluginDetails
  secretScan?: SecretScanResult
}

interface UninstallResult {
  outcome: 'ok' | 'error'
  message: string
}

declare global {
  interface Window {
    laird: {
      session: {
        ping: () => Promise<{ ok: boolean; ts: number }>
        requestStart: (opts: { projectId: string; prompt: string }) => Promise<RequestStartResult>
        confirmStart: (opts: { confirmationId: string; prompt: string }) => Promise<string>
        cancelStart: (opts: { confirmationId: string }) => Promise<void>
        kill: (opts: { sessionId: string }) => Promise<Project | undefined>
        grantAutonomy: (opts: { projectId: string }) => Promise<Project | undefined>
        historyList: (opts: { projectId: string }) => Promise<SessionHistoryEntry[]>
        onEvent: (cb: (sessionId: string, event: SessionTransportEvent) => void) => () => void
      }
      project: {
        add: (opts: { path: string; name?: string }) => Promise<Project>
        list: () => Promise<Project[]>
        remove: (opts: { id: string }) => Promise<void>
        setPermissions: (opts: {
          projectId: string
          permissionTier?: Project['permissionTier']
          approvalMode?: Project['approvalMode']
        }) => Promise<Project | undefined>
        setJevGuard: (opts: { projectId: string; enabled: boolean }) => Promise<Project | undefined>
        pickFolder: () => Promise<string | null>
      }
      system: {
        getBattery: () => Promise<BatteryState | null>
      }
      skills: {
        list: (opts: { projectId: string }) => Promise<SkillsListResult>
        setEnabled: (opts: { projectId: string; skillId: string; enabled: boolean }) => Promise<void>
        recommend: (opts: { projectId: string }) => Promise<SkillsRecommendResult>
        create: (opts: { projectId: string; name: string; description: string; body: string }) => Promise<Skill>
      }
      marketplace: {
        list: () => Promise<MarketplaceEntry[]>
        browse: () => Promise<BrowseResult>
        install: (opts: { pluginId: string }) => Promise<InstallResult>
        uninstall: (opts: { pluginId: string }) => Promise<UninstallResult>
      }
      harness: {
        setCriteria: (opts: { projectId: string; criteria: string[] }) => Promise<Project | undefined>
        detectPreview: (opts: { projectId: string }) => Promise<Project['uiPreview'] | null>
        setPreview: (opts: { projectId: string; uiPreview: Project['uiPreview'] }) => Promise<Project | undefined>
        startRun: (opts: { projectId: string }) => Promise<HarnessRun>
        cancelRun: (opts: { projectId: string }) => Promise<void>
        listRuns: (opts: { projectId: string }) => Promise<HarnessRun[]>
        setJevFeatures: (opts: { projectId: string; features: Partial<Project['jevFeatures']> }) => Promise<Project | undefined>
        detectTest: (opts: { projectId: string }) => Promise<Project['testCommand'] | null>
        setTest: (opts: { projectId: string; testCommand: Project['testCommand'] }) => Promise<Project | undefined>
        criterionPrefilter: (opts: { projectId: string; criterion: string }) => Promise<{ clear: boolean; confidence: number }>
        setCostCeiling: (opts: { projectId: string; costCeilingUsd: number | undefined }) => Promise<Project | undefined>
      }
      settings: {
        typesafeStatus: () => Promise<{ configured: boolean; available: boolean }>
        typesafeSetKey: (opts: { apiKey: string }) => Promise<{ configured: boolean; available: boolean }>
        typesafeClearKey: () => Promise<{ configured: boolean; available: boolean }>
      }
      previewPanel: {
        start: (opts: { projectId: string }) => Promise<{ ok: true } | { ok: false; message: string }>
        stop: () => Promise<void>
        hide: () => Promise<void>
        setBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
        status: () => Promise<{ projectId: string; url: string } | null>
        onLockChange: (cb: (locked: boolean) => void) => () => void
      }
      files: {
        list: (opts: { projectId: string; relativePath: string }) => Promise<DirectoryListing>
        read: (opts: { projectId: string; relativePath: string }) => Promise<FilePreview>
        openExternal: (opts: { projectId: string; relativePath: string }) => Promise<{ ok: true } | { ok: false; message: string }>
      }
      update: {
        check: () => Promise<void>
        download: () => Promise<void>
        install: () => Promise<void>
        onEvent: (cb: (event: UpdateEvent) => void) => () => void
      }
    }
  }
}
