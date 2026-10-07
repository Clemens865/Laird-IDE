import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { addProject, nextAccentColor } from './registry'

describe('addProject', () => {
  it('defaults the name to the path basename', () => {
    const store = new MemoryStore(null)
    const project = addProject(store, { path: '/Users/clemens/Documents/Laird_IDE' })
    expect(project.name).toBe('Laird_IDE')
  })

  it('uses an explicit name when given', () => {
    const store = new MemoryStore(null)
    const project = addProject(store, { path: '/tmp/x', name: 'Custom Name' })
    expect(project.name).toBe('Custom Name')
  })

  it('assigns rotating accent colors so consecutive projects are never the same color', () => {
    const store = new MemoryStore(null)
    const a = addProject(store, { path: '/tmp/a' })
    const b = addProject(store, { path: '/tmp/b' })
    const c = addProject(store, { path: '/tmp/c' })
    expect(new Set([a.colorToken, b.colorToken, c.colorToken]).size).toBe(3)
  })

  it('persists the project to the store', () => {
    const store = new MemoryStore(null)
    const project = addProject(store, { path: '/tmp/x' })
    expect(store.getProject(project.id)).toEqual(project)
  })
})

describe('nextAccentColor', () => {
  it('cycles through the 4-color palette', () => {
    const colors = [0, 1, 2, 3, 4].map(nextAccentColor)
    expect(colors[4]).toBe(colors[0])
  })
})
