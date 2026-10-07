import { execFile } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parseFrontmatter } from './frontmatter'
import type { Project, Skill, SubagentDefinition } from '../../shared/types'

const execFileAsync = promisify(execFile)

/**
 * Scans `<dirPath>/<name>/SKILL.md` for every immediate subdirectory — the
 * real convention, confirmed against this machine's own global skills dir
 * and an installed plugin's own bundled-skills dir (identical shape either
 * way). Silently skips anything without a parseable `name`/`description` —
 * a malformed skill file should never crash discovery for every other one.
 */
export function readSkillsFromDir(
  dirPath: string,
  scope: 'project' | 'global',
  source: 'skills-dir' | 'plugin',
  pluginId?: string,
): Skill[] {
  if (!existsSync(dirPath)) return []
  const skills: Skill[] = []
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillPath = join(dirPath, entry.name, 'SKILL.md')
    if (!existsSync(skillPath)) continue
    try {
      const frontmatter = parseFrontmatter(readFileSync(skillPath, 'utf8'))
      const name = frontmatter?.name
      const description = frontmatter?.description
      if (typeof name !== 'string' || typeof description !== 'string') continue
      skills.push({ id: skillPath, scope, source, pluginId, name, description, path: skillPath })
    } catch (err) {
      console.error(`[discovery] failed to read skill at ${skillPath}`, err)
    }
  }
  return skills
}

/**
 * Scans `<dirPath>/*.md` directly (not nested) — the real convention for
 * custom subagents, confirmed against `~/.claude/agents/*.md`.
 */
export function readAgentsFromDir(dirPath: string, scope: 'project' | 'global'): SubagentDefinition[] {
  if (!existsSync(dirPath)) return []
  const agents: SubagentDefinition[] = []
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const agentPath = join(dirPath, entry.name)
    try {
      const frontmatter = parseFrontmatter(readFileSync(agentPath, 'utf8'))
      const name = frontmatter?.name
      const description = frontmatter?.description
      if (typeof name !== 'string' || typeof description !== 'string') continue
      agents.push({ id: agentPath, scope, name, description, path: agentPath })
    } catch (err) {
      console.error(`[discovery] failed to read agent at ${agentPath}`, err)
    }
  }
  return agents
}

export interface InstalledPlugin {
  id: string
  installPath: string
  enabled: boolean
}

/** `claude plugin list --json` — free, no API cost, confirmed live against the real CLI. */
export async function listGlobalPlugins(): Promise<InstalledPlugin[]> {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'list', '--json'])
    const raw = JSON.parse(stdout) as Array<{ id: string; installPath: string; enabled: boolean }>
    return raw.map((p) => ({ id: p.id, installPath: p.installPath, enabled: p.enabled }))
  } catch (err) {
    console.error('[discovery] failed to list plugins', err)
    return []
  }
}

export interface DiscoveredSkillsAndAgents {
  projectSkills: Skill[]
  globalSkills: Skill[]
  projectAgents: SubagentDefinition[]
  globalAgents: SubagentDefinition[]
}

export interface DiscoverDeps {
  /** Defaults to `$HOME` — injectable so tests never depend on the real machine's actual global skill library. */
  homeDir?: string
  /** Defaults to the real `listGlobalPlugins` — injectable for the same reason. */
  listGlobalPlugins?: () => Promise<InstalledPlugin[]>
}

/**
 * The full picture for one project: its own `.claude/skills` + `.claude/agents`
 * (always active), and everything available globally — loose
 * `~/.claude/skills`/`~/.claude/agents` plus every enabled plugin's bundled
 * skills — listed but inert until the project opts in (`Project.enabledGlobalSkillIds`).
 */
export async function discoverSkillsAndAgents(project: Project, deps: DiscoverDeps = {}): Promise<DiscoveredSkillsAndAgents> {
  const home = deps.homeDir ?? process.env.HOME ?? ''
  const fetchPlugins = deps.listGlobalPlugins ?? listGlobalPlugins

  const projectSkills = readSkillsFromDir(join(project.path, '.claude', 'skills'), 'project', 'skills-dir')
  const projectAgents = readAgentsFromDir(join(project.path, '.claude', 'agents'), 'project')

  const globalSkills = readSkillsFromDir(join(home, '.claude', 'skills'), 'global', 'skills-dir')
  const globalAgents = readAgentsFromDir(join(home, '.claude', 'agents'), 'global')

  const plugins = await fetchPlugins()
  for (const plugin of plugins) {
    if (!plugin.enabled) continue
    const pluginSkills = readSkillsFromDir(join(plugin.installPath, 'skills'), 'global', 'plugin', plugin.id)
    globalSkills.push(...pluginSkills)
  }

  return { projectSkills, globalSkills, projectAgents, globalAgents }
}

/** Only the skills a session should actually have — project's own, plus whichever global ones it opted into. */
export function resolveEnabledSkills(discovered: DiscoveredSkillsAndAgents, project: Project): Skill[] {
  const enabled = new Set(project.enabledGlobalSkillIds)
  return [...discovered.projectSkills, ...discovered.globalSkills.filter((s) => enabled.has(s.id))]
}

function skillDirName(skill: Skill): string {
  // SKILL.md's parent directory name, e.g. "frontend-design" from ".../skills/frontend-design/SKILL.md".
  const parts = skill.path.split('/')
  return parts[parts.length - 2]
}

export { skillDirName }
