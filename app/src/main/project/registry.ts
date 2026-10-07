import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { MemoryStore } from '../store/memoryStore'
import type { Project } from '../../shared/types'
import { ACCENT_PALETTE } from '../../shared/theme'

export function nextAccentColor(existingCount: number): string {
  return ACCENT_PALETTE[existingCount % ACCENT_PALETTE.length]
}

export function addProject(store: MemoryStore, opts: { path: string; name?: string; colorToken?: string }): Project {
  const now = new Date().toISOString()
  const project: Project = {
    id: randomUUID(),
    name: opts.name ?? basename(opts.path),
    path: opts.path,
    colorToken: opts.colorToken ?? nextAccentColor(store.listProjects().length),
    createdAt: now,
    lastActiveAt: now,
    enabledGlobalSkillIds: [],
    // A moderate, non-destructive, non-confirmation-gated default — power
    // users dial up to 'manage'/'full' and switch to 'ask' explicitly.
    permissionTier: 'write',
    approvalMode: 'auto',
    autonomyRevoked: false,
  }
  store.upsertProject(project)
  return project
}
