import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProjectSkill, InvalidSkillInputError, validateSkillInput } from './create'
import { parseFrontmatter } from './frontmatter'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laird-create-skill-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('validateSkillInput', () => {
  it('accepts a real lowercase-hyphenated name and a non-empty description', () => {
    expect(() => validateSkillInput({ name: 'design-review', description: 'Reviews a design.' })).not.toThrow()
  })

  it('rejects an uppercase or space-containing name', () => {
    expect(() => validateSkillInput({ name: 'Design Review', description: 'd' })).toThrow(InvalidSkillInputError)
  })

  it('rejects an empty description', () => {
    expect(() => validateSkillInput({ name: 'design-review', description: '   ' })).toThrow(InvalidSkillInputError)
  })
})

describe('createProjectSkill', () => {
  it('writes a real SKILL.md whose own frontmatter parser reads it back correctly', () => {
    const skill = createProjectSkill(root, {
      name: 'ship-checklist',
      description: 'Walks through the pre-ship checklist before marking work done.',
      body: '1. Run tests.\n2. Check the build.',
    })

    const skillPath = join(root, '.claude', 'skills', 'ship-checklist', 'SKILL.md')
    expect(skill.path).toBe(skillPath)
    expect(existsSync(skillPath)).toBe(true)

    // Round-trips through the real parser used elsewhere in discovery — not
    // just "a file got written," but "a file Claude Code can actually read."
    const raw = readFileSync(skillPath, 'utf8')
    const frontmatter = parseFrontmatter(raw)
    expect(frontmatter).toMatchObject({ name: 'ship-checklist', description: 'Walks through the pre-ship checklist before marking work done.' })
    expect(raw).toContain('1. Run tests.')
  })

  it('produces valid YAML even when the description contains a colon — the exact real bug class fixed in frontmatter.ts', () => {
    const skill = createProjectSkill(root, {
      name: 'trigger-words',
      description: 'Use this when the user says: "ship it" or similar.',
      body: 'body',
    })
    const frontmatter = parseFrontmatter(readFileSync(skill.path, 'utf8'))
    expect(frontmatter?.description).toBe('Use this when the user says: "ship it" or similar.')
  })

  it('refuses to overwrite an existing skill with the same name', () => {
    createProjectSkill(root, { name: 'dup', description: 'first', body: 'b' })
    expect(() => createProjectSkill(root, { name: 'dup', description: 'second', body: 'b' })).toThrow(InvalidSkillInputError)
  })

  it('falls back to a minimal body when none is given', () => {
    const skill = createProjectSkill(root, { name: 'no-body', description: 'd', body: '' })
    expect(readFileSync(skill.path, 'utf8')).toContain('Describe how Claude should carry this out.')
  })
})
