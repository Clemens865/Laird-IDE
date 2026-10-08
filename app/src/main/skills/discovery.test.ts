import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  discoverSkillsAndAgents,
  listGlobalPlugins,
  readAgentsFromDir,
  readSkillsFromDir,
  resolveEnabledSkills,
} from './discovery'
import type { Project } from '../../shared/types'

function writeSkill(dir: string, name: string, frontmatter: string) {
  const skillDir = join(dir, name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n\nBody.`)
}

function writeAgent(dir: string, filename: string, frontmatter: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, filename), `---\n${frontmatter}\n---\n\nBody.`)
}

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laird-discovery-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readSkillsFromDir', () => {
  it('finds a real SKILL.md and parses its frontmatter', () => {
    writeSkill(root, 'my-skill', 'name: my-skill\ndescription: Does a thing.')
    const skills = readSkillsFromDir(root, 'global', 'skills-dir')
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ scope: 'global', source: 'skills-dir', name: 'my-skill', description: 'Does a thing.' })
    expect(skills[0].id).toBe(join(root, 'my-skill', 'SKILL.md'))
  })

  it('skips a subdirectory with no SKILL.md, without throwing', () => {
    mkdirSync(join(root, 'not-a-skill'), { recursive: true })
    expect(readSkillsFromDir(root, 'global', 'skills-dir')).toEqual([])
  })

  it('skips a SKILL.md with no parseable name/description', () => {
    writeSkill(root, 'broken', 'something_else: true')
    expect(readSkillsFromDir(root, 'global', 'skills-dir')).toEqual([])
  })

  it('returns an empty array for a directory that does not exist', () => {
    expect(readSkillsFromDir(join(root, 'does-not-exist'), 'global', 'skills-dir')).toEqual([])
  })

  it('tags plugin-sourced skills with their pluginId', () => {
    writeSkill(root, 'bundled-skill', 'name: bundled-skill\ndescription: Comes from a plugin.')
    const skills = readSkillsFromDir(root, 'global', 'plugin', 'frontend-design@claude-plugins-official')
    expect(skills[0]).toMatchObject({ source: 'plugin', pluginId: 'frontend-design@claude-plugins-official' })
  })
})

describe('readAgentsFromDir', () => {
  it('finds real .md agent files directly in the directory (not nested)', () => {
    writeAgent(root, 'marlow.md', 'name: Marlow — Trip Planner\ndescription: Plans trips.')
    writeAgent(root, 'elena.md', 'name: Elena — Application Tailor\ndescription: Tailors applications.')
    const agents = readAgentsFromDir(root, 'global')
    expect(agents).toHaveLength(2)
    expect(agents.map((a) => a.name).sort()).toEqual(['Elena — Application Tailor', 'Marlow — Trip Planner'])
  })

  it('ignores non-.md files and nested directories', () => {
    writeAgent(root, 'real.md', 'name: Real\ndescription: A real one.')
    writeFileSync(join(root, 'notes.txt'), 'irrelevant')
    mkdirSync(join(root, 'nested'), { recursive: true })
    writeAgent(join(root, 'nested'), 'hidden.md', 'name: Hidden\ndescription: Should not be found.')
    const agents = readAgentsFromDir(root, 'global')
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe('Real')
  })
})

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    path: join(root, 'project'),
    colorToken: '#D97757',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    enabledGlobalSkillIds: [],
    permissionTier: 'write',
    approvalMode: 'auto',
    autonomyRevoked: false,
    harnessCriteria: [],
    jevGuardEnabled: false,
    jevFeatures: { criterionRouting: false, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    ...overrides,
  }
}

describe('discoverSkillsAndAgents', () => {
  it('combines project-scoped and global skills/agents, keeping them clearly separate', async () => {
    const projectPath = join(root, 'project')
    writeSkill(join(projectPath, '.claude', 'skills'), 'project-only-skill', 'name: project-only-skill\ndescription: Lives in the project.')
    writeAgent(join(projectPath, '.claude', 'agents'), 'project-agent.md', 'name: Project Agent\ndescription: Project-scoped.')

    const homeDir = join(root, 'home')
    writeSkill(join(homeDir, '.claude', 'skills'), 'global-only-skill', 'name: global-only-skill\ndescription: Lives globally.')
    writeAgent(join(homeDir, '.claude', 'agents'), 'global-agent.md', 'name: Global Agent\ndescription: Global.')

    const project = makeProject({ path: projectPath })
    const result = await discoverSkillsAndAgents(project, {
      homeDir,
      listGlobalPlugins: async () => [],
    })

    expect(result.projectSkills).toHaveLength(1)
    expect(result.projectSkills[0].name).toBe('project-only-skill')
    expect(result.globalSkills).toHaveLength(1)
    expect(result.globalSkills[0].name).toBe('global-only-skill')
    expect(result.projectAgents[0].name).toBe('Project Agent')
    expect(result.globalAgents[0].name).toBe('Global Agent')
  })

  it("includes an enabled plugin's bundled skills in the global list, keyed by pluginId", async () => {
    const projectPath = join(root, 'project')
    const homeDir = join(root, 'home')
    const pluginInstallPath = join(root, 'plugins', 'frontend-design', 'abc123')
    writeSkill(join(pluginInstallPath, 'skills'), 'frontend-design', 'name: frontend-design\ndescription: Design skill.')

    const project = makeProject({ path: projectPath })
    const result = await discoverSkillsAndAgents(project, {
      homeDir,
      listGlobalPlugins: async () => [{ id: 'frontend-design@official', installPath: pluginInstallPath, enabled: true }],
    })

    expect(result.globalSkills).toHaveLength(1)
    expect(result.globalSkills[0]).toMatchObject({ source: 'plugin', pluginId: 'frontend-design@official', name: 'frontend-design' })
  })

  it('excludes a disabled plugin\'s bundled skills entirely', async () => {
    const projectPath = join(root, 'project')
    const homeDir = join(root, 'home')
    const pluginInstallPath = join(root, 'plugins', 'disabled-plugin', 'abc123')
    writeSkill(join(pluginInstallPath, 'skills'), 'disabled-skill', 'name: disabled-skill\ndescription: Should not appear.')

    const project = makeProject({ path: projectPath })
    const result = await discoverSkillsAndAgents(project, {
      homeDir,
      listGlobalPlugins: async () => [{ id: 'disabled-plugin@official', installPath: pluginInstallPath, enabled: false }],
    })

    expect(result.globalSkills).toHaveLength(0)
  })
})

describe('resolveEnabledSkills', () => {
  it('always includes project skills and only the explicitly-enabled global ones', () => {
    const discovered = {
      projectSkills: [{ id: 'proj-skill', scope: 'project' as const, source: 'skills-dir' as const, name: 'p', description: 'd', path: 'proj-skill' }],
      globalSkills: [
        { id: 'global-a', scope: 'global' as const, source: 'skills-dir' as const, name: 'a', description: 'd', path: 'global-a' },
        { id: 'global-b', scope: 'global' as const, source: 'skills-dir' as const, name: 'b', description: 'd', path: 'global-b' },
      ],
      projectAgents: [],
      globalAgents: [],
    }
    const project = makeProject({ enabledGlobalSkillIds: ['global-b'] })
    const resolved = resolveEnabledSkills(discovered, project)
    expect(resolved.map((s) => s.id).sort()).toEqual(['global-b', 'proj-skill'])
  })
})

describe('listGlobalPlugins (real CLI call, free — no API cost)', () => {
  it('runs the real `claude plugin list --json` command and returns a parsed array', async () => {
    const plugins = await listGlobalPlugins()
    expect(Array.isArray(plugins)).toBe(true)
    if (plugins.length > 0) {
      expect(plugins[0]).toHaveProperty('id')
      expect(plugins[0]).toHaveProperty('installPath')
      expect(plugins[0]).toHaveProperty('enabled')
    }
  })
})
