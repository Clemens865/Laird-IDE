export {}

import type { Project, Skill, SubagentDefinition } from '../shared/types'

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
    }
  }
}
