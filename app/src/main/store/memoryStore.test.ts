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
    harnessCriteria: [],
    jevFeatures: { criterionRouting: false, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
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

describe('MemoryStore — harness mode', () => {
  it('sets a project\'s harness criteria', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject({ id: 'p1' }))
    store.setHarnessCriteria('p1', ['Signup works on mobile'])
    expect(store.getProject('p1')?.harnessCriteria).toEqual(['Signup works on mobile'])
  })

  it('sets a project\'s UI preview config', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject({ id: 'p1' }))
    store.setUiPreview('p1', { command: 'npm run dev', port: 5173 })
    expect(store.getProject('p1')?.uiPreview).toEqual({ command: 'npm run dev', port: 5173 })
  })

  it("sets and clears a project's harness cost ceiling", () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject({ id: 'p1' }))
    store.setCostCeiling('p1', 2.5)
    expect(store.getProject('p1')?.harnessCostCeilingUsd).toBe(2.5)

    store.setCostCeiling('p1', undefined)
    expect(store.getProject('p1')?.harnessCostCeilingUsd).toBeUndefined()
  })

  it('appends and lists harness runs scoped to their project', () => {
    const store = new MemoryStore(null)
    store.upsertProject(makeProject({ id: 'p1' }))
    store.upsertProject(makeProject({ id: 'p2' }))
    store.appendHarnessRun({ id: 'r1', projectId: 'p1', spec: [], disposition: 'unverifiable', perCriterionResult: [], createdAt: new Date().toISOString(), totalCostUsd: 0 })
    store.appendHarnessRun({ id: 'r2', projectId: 'p2', spec: [], disposition: 'unverifiable', perCriterionResult: [], createdAt: new Date().toISOString(), totalCostUsd: 0 })

    expect(store.getHarnessRuns('p1').map((r) => r.id)).toEqual(['r1'])
    expect(store.getHarnessRuns('p2').map((r) => r.id)).toEqual(['r2'])
  })

  it('stores and retrieves a recorded script scoped to its exact project + criterion', () => {
    const store = new MemoryStore(null)
    const script = { url: 'http://localhost:3000', steps: [], assertions: [], recordedAt: new Date().toISOString() }
    store.setRecordedScript('p1', 'Clicking X shows Y', script)

    expect(store.getRecordedScript('p1', 'Clicking X shows Y')).toEqual(script)
    expect(store.getRecordedScript('p1', 'A different criterion')).toBeUndefined()
    expect(store.getRecordedScript('p2', 'Clicking X shows Y')).toBeUndefined()
  })

  it('clears a recorded script that no longer replays', () => {
    const store = new MemoryStore(null)
    const script = { url: 'http://localhost:3000', steps: [], assertions: [], recordedAt: new Date().toISOString() }
    store.setRecordedScript('p1', 'Clicking X shows Y', script)
    store.clearRecordedScript('p1', 'Clicking X shows Y')

    expect(store.getRecordedScript('p1', 'Clicking X shows Y')).toBeUndefined()
  })
})
