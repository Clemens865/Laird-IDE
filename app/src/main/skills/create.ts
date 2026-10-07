import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as yaml from 'js-yaml'
import type { Skill } from '../../shared/types'

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export class InvalidSkillInputError extends Error {}

/**
 * Validated at this boundary, not trusted from the renderer (per this
 * project's own "validate input at system boundaries" rule): `name` must be
 * the same lowercase-hyphenated slug Claude Code's own skills use (it
 * becomes both the directory name and the `name:` frontmatter field), and
 * `description` can't be empty — Claude Code uses it to decide when to
 * invoke the skill at all.
 */
export function validateSkillInput(opts: { name: string; description: string }): void {
  if (!NAME_PATTERN.test(opts.name)) {
    throw new InvalidSkillInputError('Skill name must be lowercase letters, numbers, and hyphens only (e.g. "design-review").')
  }
  if (opts.description.trim().length === 0) {
    throw new InvalidSkillInputError('A skill needs a description — it\'s how Claude Code decides when to use it.')
  }
}

/**
 * Writes a real Claude Code skill file — not a Laird-specific format, per
 * docs/prd/technical/skills-and-plugins.md's explicit requirement that
 * anything created through Laird also works in plain Claude Code. Frontmatter
 * is produced with `yaml.dump`, not hand-assembled, so it's always valid YAML
 * even when the description contains punctuation that would break a naive
 * string template (the exact class of real bug fixed in frontmatter.ts's
 * parse side during Workstream C chunk 4).
 */
export function createProjectSkill(
  projectPath: string,
  opts: { name: string; description: string; body: string },
): Skill {
  validateSkillInput(opts)

  const skillDir = join(projectPath, '.claude', 'skills', opts.name)
  const skillPath = join(skillDir, 'SKILL.md')
  if (existsSync(skillPath)) {
    throw new InvalidSkillInputError(`A skill named "${opts.name}" already exists in this project.`)
  }

  mkdirSync(skillDir, { recursive: true })
  const frontmatter = yaml.dump({ name: opts.name, description: opts.description.trim() }).trimEnd()
  const body = opts.body.trim() || `# ${opts.name}\n\nDescribe how Claude should carry this out.`
  writeFileSync(skillPath, `---\n${frontmatter}\n---\n\n${body}\n`, 'utf8')

  return { id: skillPath, scope: 'project', source: 'skills-dir', name: opts.name, description: opts.description.trim(), path: skillPath }
}
