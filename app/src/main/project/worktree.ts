import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export interface WorktreeResult {
  /** The directory a session should actually run in. */
  path: string
  branch: string | null
  /** False when `repoPath` isn't a git repo — path falls back to `repoPath` itself, no worktree created. */
  isGitRepo: boolean
}

function isGitRepo(repoPath: string): boolean {
  return existsSync(join(repoPath, '.git'))
}

/**
 * One disposable worktree per session, under `<repo>/.laird-worktrees/<id>`
 * on branch `laird/<id>` — the pattern every fleet manager (Conductor,
 * Crystal, Vibe Kanban) independently converged on, per the technical PRD.
 * Non-git projects are a real case (not every project is a repo yet) —
 * falls back to running directly in `repoPath` rather than hard-failing.
 */
export function createWorktree(repoPath: string, sessionId: string): WorktreeResult {
  if (!isGitRepo(repoPath)) {
    return { path: repoPath, branch: null, isGitRepo: false }
  }

  const worktreePath = join(repoPath, '.laird-worktrees', sessionId)
  const branch = `laird/${sessionId}`

  try {
    execFileSync('git', ['worktree', 'add', worktreePath, '-b', branch], { cwd: repoPath, stdio: 'pipe' })
    return { path: worktreePath, branch, isGitRepo: true }
  } catch (err) {
    console.error('[worktree] failed to create worktree, falling back to repo root', err)
    return { path: repoPath, branch: null, isGitRepo: true }
  }
}

/**
 * Disposable by design: `--force` so leftover uncommitted scratch work in a
 * session's own worktree never blocks cleanup — the source repo's own
 * working tree is never touched by this. Safe to call even if the worktree
 * was never actually created (e.g. a non-git project, or `createWorktree`
 * fell back) — it's a no-op in that case.
 */
export function removeWorktree(repoPath: string, worktreePath: string): void {
  if (worktreePath === repoPath) return // never created, nothing to remove
  try {
    execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath, stdio: 'pipe' })
  } catch (err) {
    console.error('[worktree] git worktree remove failed, cleaning up directory directly', err)
    rmSync(worktreePath, { recursive: true, force: true })
  }
}
