import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectStackSignals, recommendGlobalSkills } from './recommend'
import type { DiscoveredSkillsAndAgents } from './discovery'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laird-recommend-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('detectStackSignals', () => {
  it('detects typescript from a real tsconfig.json', () => {
    writeFileSync(join(root, 'tsconfig.json'), '{}')
    expect(detectStackSignals(root)).toContain('typescript')
  })

  it('detects react and electron from real package.json dependencies', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.0.0' }, devDependencies: { electron: '^30.0.0' } }),
    )
    const signals = detectStackSignals(root)
    expect(signals).toEqual(expect.arrayContaining(['node', 'react', 'electron']))
  })

  it('detects python from a real requirements.txt', () => {
    writeFileSync(join(root, 'requirements.txt'), 'flask==3.0.0')
    expect(detectStackSignals(root)).toContain('python')
  })

  it('returns no signals for an empty directory', () => {
    expect(detectStackSignals(root)).toEqual([])
  })

  it('does not crash on a malformed package.json', () => {
    writeFileSync(join(root, 'package.json'), '{ not valid json')
    expect(detectStackSignals(root)).not.toContain('react')
  })
})

describe('recommendGlobalSkills', () => {
  const discovered: DiscoveredSkillsAndAgents = {
    projectSkills: [],
    projectAgents: [],
    globalAgents: [],
    globalSkills: [
      { id: 'ts-review', scope: 'global', source: 'skills-dir', name: 'TypeScript review', description: 'Reviews TS code.', path: '/x/ts-review/SKILL.md' },
      { id: 'py-lint', scope: 'global', source: 'skills-dir', name: 'Python lint', description: 'Lints python files.', path: '/x/py-lint/SKILL.md' },
      { id: 'unrelated', scope: 'global', source: 'skills-dir', name: 'Recipe helper', description: 'Suggests dinner recipes.', path: '/x/unrelated/SKILL.md' },
    ],
  }

  it('proposes only skills matching a detected signal', () => {
    const recommended = recommendGlobalSkills(discovered, ['typescript'])
    expect(recommended.map((s) => s.id)).toEqual(['ts-review'])
  })

  it('proposes nothing when no signals were detected', () => {
    expect(recommendGlobalSkills(discovered, [])).toEqual([])
  })

  it('matches case-insensitively against name and description', () => {
    const recommended = recommendGlobalSkills(discovered, ['PYTHON'])
    expect(recommended.map((s) => s.id)).toEqual(['py-lint'])
  })
})
