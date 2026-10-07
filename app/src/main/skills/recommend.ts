import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DiscoveredSkillsAndAgents } from './discovery'
import type { Skill } from '../../shared/types'

function hasPackageDependency(projectPath: string, dep: string): boolean {
  const pkgPath = join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
    }
    return Boolean(pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep])
  } catch {
    return false
  }
}

const STACK_SIGNALS: Array<{ tag: string; check: (projectPath: string) => boolean }> = [
  { tag: 'typescript', check: (p) => existsSync(join(p, 'tsconfig.json')) },
  { tag: 'react', check: (p) => hasPackageDependency(p, 'react') },
  { tag: 'electron', check: (p) => hasPackageDependency(p, 'electron') },
  { tag: 'vue', check: (p) => hasPackageDependency(p, 'vue') },
  { tag: 'node', check: (p) => existsSync(join(p, 'package.json')) },
  { tag: 'python', check: (p) => existsSync(join(p, 'requirements.txt')) || existsSync(join(p, 'pyproject.toml')) },
  { tag: 'rust', check: (p) => existsSync(join(p, 'Cargo.toml')) },
  { tag: 'go', check: (p) => existsSync(join(p, 'go.mod')) },
]

/**
 * A cheap, read-only, non-LLM scan of a project's top-level files — never
 * executes anything, per the research-derived "read a project, never run
 * it" principle (docs/research/external-analysis/metaharness.md, carried
 * into docs/prd/technical/skills-and-plugins.md's "auto-recommend" addition).
 * Returns plain stack tags, e.g. `["typescript", "react", "electron"]`.
 */
export function detectStackSignals(projectPath: string): string[] {
  return STACK_SIGNALS.filter((s) => s.check(projectPath)).map((s) => s.tag)
}

/**
 * Proposes, never installs: global skills whose own name/description
 * mentions one of the detected stack tags. Plain substring matching against
 * real, already-discovered skill metadata — not an embedding/ML match, and
 * honest about that limitation rather than pretending to be smarter than it
 * is. The caller still has to explicitly turn each one on (see
 * `Project.enabledGlobalSkillIds`) — this only proposes an editable list.
 */
export function recommendGlobalSkills(discovered: DiscoveredSkillsAndAgents, signals: string[]): Skill[] {
  if (signals.length === 0) return []
  return discovered.globalSkills.filter((skill) => {
    const haystack = `${skill.name} ${skill.description}`.toLowerCase()
    return signals.some((tag) => haystack.includes(tag.toLowerCase()))
  })
}
