import { describe, expect, it } from 'vitest'
import { buildPermissionArgs, FULL_DISALLOWED } from './permissions'

function allowedToolsFrom(args: string[]): string[] {
  return args[args.indexOf('--allowedTools') + 1].split(',')
}

describe('buildPermissionArgs', () => {
  it('read tier only allows read-only tools, no Bash', () => {
    const allowed = allowedToolsFrom(buildPermissionArgs('read'))
    expect(allowed).toEqual(['Read', 'Glob', 'Grep'])
    expect(allowed).not.toContain('Write')
    expect(allowed).not.toContain('Bash')
  })

  it('write tier adds file edits but not subagents, web, or Bash', () => {
    const allowed = allowedToolsFrom(buildPermissionArgs('write'))
    expect(allowed).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']))
    expect(allowed).not.toContain('Agent')
    expect(allowed).not.toContain('Bash')
  })

  it('manage tier adds subagents, skills, and web research but still no Bash', () => {
    const allowed = allowedToolsFrom(buildPermissionArgs('manage'))
    expect(allowed).toEqual(expect.arrayContaining(['Write', 'Task', 'Agent', 'Skill', 'WebFetch', 'WebSearch']))
    expect(allowed).not.toContain('Bash')
  })

  it('full tier is the only tier that adds Bash, and only full tier gets a disallowed list', () => {
    const fullArgs = buildPermissionArgs('full')
    const allowed = allowedToolsFrom(fullArgs)
    expect(allowed).toContain('Bash')
    expect(fullArgs).toContain('--disallowedTools')

    for (const tier of ['read', 'write', 'manage'] as const) {
      expect(buildPermissionArgs(tier)).not.toContain('--disallowedTools')
    }
  })

  it('the full-tier disallowed list is a real Bash(...*) prefix pattern covering the documented dangerous commands', () => {
    const fullArgs = buildPermissionArgs('full')
    const disallowed = fullArgs[fullArgs.indexOf('--disallowedTools') + 1]
    for (const dangerous of FULL_DISALLOWED) {
      expect(disallowed).toContain(`Bash(${dangerous}*)`)
    }
  })

  it('every tier is strictly additive (each higher tier is a superset of the one below)', () => {
    const read = allowedToolsFrom(buildPermissionArgs('read'))
    const write = allowedToolsFrom(buildPermissionArgs('write'))
    const manage = allowedToolsFrom(buildPermissionArgs('manage'))
    const full = allowedToolsFrom(buildPermissionArgs('full'))
    expect(read.every((t) => write.includes(t))).toBe(true)
    expect(write.every((t) => manage.includes(t))).toBe(true)
    expect(manage.every((t) => full.includes(t))).toBe(true)
  })
})
