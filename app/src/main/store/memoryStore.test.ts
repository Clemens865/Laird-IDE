import { describe, expect, it } from 'vitest'
import { MemoryStore } from './memoryStore'
import type { Project } from '../../shared/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Laird_IDE',
    path: '/tmp/laird',
    colorToken: '#D97757',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    enabledGlobalSkillIds: [],
    permissionTier: 'write',
    approvalMode: 'auto',
    autonomyRevoked: false,
    ...overrides,
  }
}

describe('MemoryStore — project registry', () => {
  it('adds and lists projects', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject({ id: 'p1' }))
    store.upsertProject(makeProject({ id: 'p2', name: 'TerminalOS' }))

    const projects = store.listProjects()
    expect(projects).toHaveLength(2)
    expect(projects.map((p) => p.name).sort()).toEqual(['Laird_IDE', 'TerminalOS'])
  })

  it('upserts in place rather than duplicating', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject({ id: 'p1', name: 'Original' }))
    store.upsertProject(makeProject({ id: 'p1', name: 'Renamed' }))

    const projects = store.listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('Renamed')
  })

  it('removes a project by id', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject({ id: 'p1' }))
    store.removeProject('p1')

    expect(store.listProjects()).toHaveLength(0)
    expect(store.getProject('p1')).toBeUndefined()
  })
})
