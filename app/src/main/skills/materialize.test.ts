import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { materializeSkills } from './materialize'
import type { Skill } from '../../shared/types'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laird-materialize-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeGlobalSkill(name: string, content: string): { skill: Skill; sourceDir: string } {
  const sourceDir = join(root, 'global-skills', name)
  mkdirSync(sourceDir, { recursive: true })
  const skillPath = join(sourceDir, 'SKILL.md')
  writeFileSync(skillPath, content)
  return {
    skill: { id: skillPath, scope: 'global', source: 'skills-dir', name, description: 'd', path: skillPath },
    sourceDir,
  }
}

describe('materializeSkills', () => {
  it('symlinks an enabled global skill into the worktree, readable through the new path', () => {
    const worktree = join(root, 'worktree')
    mkdirSync(worktree, { recursive: true })
    const { skill } = makeGlobalSkill('my-global-skill', '---\nname: my-global-skill\ndescription: d\n---\nbody')

    materializeSkills(worktree, [skill])

    const linkedSkillMd = join(worktree, '.claude', 'skills', 'my-global-skill', 'SKILL.md')
    expect(existsSync(linkedSkillMd)).toBe(true)
    expect(readFileSync(linkedSkillMd, 'utf8')).toContain('my-global-skill')
    expect(lstatSync(join(worktree, '.claude', 'skills', 'my-global-skill')).isSymbolicLink()).toBe(true)
  })

  it('points the symlink at the real skill source, not a copy', () => {
    const worktree = join(root, 'worktree')
    mkdirSync(worktree, { recursive: true })
    const { skill, sourceDir } = makeGlobalSkill('real-source', '---\nname: real-source\ndescription: d\n---\nv1')

    materializeSkills(worktree, [skill])

    const linkPath = join(worktree, '.claude', 'skills', 'real-source')
    expect(realpathSync(linkPath)).toBe(realpathSync(sourceDir))

    // Editing the real source is reflected through the symlink — proves it's live, not a stale copy.
    writeFileSync(join(sourceDir, 'SKILL.md'), '---\nname: real-source\ndescription: d\n---\nv2')
    expect(readFileSync(join(linkPath, 'SKILL.md'), 'utf8')).toContain('v2')
  })

  it('materializes a project-scoped skill too (e.g. one just created through Laird, not yet committed)', () => {
    const worktree = join(root, 'worktree')
    mkdirSync(worktree, { recursive: true })
    const sourceDir = join(root, 'project', '.claude', 'skills', 'p')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'SKILL.md'), '---\nname: p\ndescription: d\n---\nbody')
    const projectSkill: Skill = { id: 'x', scope: 'project', source: 'skills-dir', name: 'p', description: 'd', path: join(sourceDir, 'SKILL.md') }

    materializeSkills(worktree, [projectSkill])

    expect(existsSync(join(worktree, '.claude', 'skills', 'p', 'SKILL.md'))).toBe(true)
  })

  it('replaces a stale symlink from a previous materialization rather than erroring', () => {
    const worktree = join(root, 'worktree')
    mkdirSync(worktree, { recursive: true })
    const { skill: skillA } = makeGlobalSkill('same-name', '---\nname: same-name\ndescription: a\n---\nfrom A')

    materializeSkills(worktree, [skillA])
    expect(() => materializeSkills(worktree, [skillA])).not.toThrow()
    expect(existsSync(join(worktree, '.claude', 'skills', 'same-name', 'SKILL.md'))).toBe(true)
  })

  it('never destroys a project skill when the "worktree" is actually the project\'s own path (the non-git fallback — a real bug caught live, e2e)', () => {
    // worktree.ts falls back to running directly in the project's own path
    // for a non-git project — no separate worktree directory at all. A
    // project skill's source and its "materialized" link then resolve to
    // the exact same real directory; this must be a safe no-op, not a
    // delete-then-relink that destroys the real skill.
    const projectPath = join(root, 'project')
    const sourceDir = join(projectPath, '.claude', 'skills', 'my-skill')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'SKILL.md'), '---\nname: my-skill\ndescription: d\n---\nbody')
    const skill: Skill = { id: join(sourceDir, 'SKILL.md'), scope: 'project', source: 'skills-dir', name: 'my-skill', description: 'd', path: join(sourceDir, 'SKILL.md') }

    materializeSkills(projectPath, [skill])

    expect(existsSync(join(sourceDir, 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(sourceDir, 'SKILL.md'), 'utf8')).toContain('body')
    expect(lstatSync(sourceDir).isSymbolicLink()).toBe(false) // untouched, not turned into a self-symlink
  })

  it('creates the .claude/skills directory even with an empty enabled list', () => {
    const worktree = join(root, 'worktree')
    mkdirSync(worktree, { recursive: true })
    materializeSkills(worktree, [])
    expect(existsSync(join(worktree, '.claude', 'skills'))).toBe(true)
  })
})
