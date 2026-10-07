import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorktree, removeWorktree } from './worktree'

// Real throwaway git repos, not mocked — git itself is the thing under test
// here, free (no API cost), and a mock would just restate the implementation.
let repoPath: string

beforeEach(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'laird-worktree-test-'))
  execFileSync('git', ['init', '-q'], { cwd: repoPath })
  execFileSync('git', ['config', 'user.email', 'test@laird.local'], { cwd: repoPath })
  execFileSync('git', ['config', 'user.name', 'Laird Test'], { cwd: repoPath })
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'initial'], { cwd: repoPath })
})

afterEach(() => {
  rmSync(repoPath, { recursive: true, force: true })
})

describe('createWorktree', () => {
  it('creates a real worktree directory on a dedicated branch', () => {
    const result = createWorktree(repoPath, 'session-1')

    expect(result.isGitRepo).toBe(true)
    expect(result.branch).toBe('laird/session-1')
    expect(result.path).toBe(join(repoPath, '.laird-worktrees', 'session-1'))
    expect(existsSync(result.path)).toBe(true)

    const branches = execFileSync('git', ['branch', '--list'], { cwd: repoPath }).toString()
    expect(branches).toContain('laird/session-1')
  })

  it('falls back to the repo path for a non-git project, without throwing', () => {
    const plainDir = mkdtempSync(join(tmpdir(), 'laird-non-git-'))
    try {
      const result = createWorktree(plainDir, 'session-2')
      expect(result.isGitRepo).toBe(false)
      expect(result.path).toBe(plainDir)
      expect(result.branch).toBeNull()
    } finally {
      rmSync(plainDir, { recursive: true, force: true })
    }
  })
})

describe('removeWorktree', () => {
  it('removes a real worktree directory from disk', () => {
    const { path } = createWorktree(repoPath, 'session-3')
    expect(existsSync(path)).toBe(true)

    removeWorktree(repoPath, path)
    expect(existsSync(path)).toBe(false)
  })

  it('is a no-op for a path that was never actually a separate worktree', () => {
    expect(() => removeWorktree(repoPath, repoPath)).not.toThrow()
  })
})
