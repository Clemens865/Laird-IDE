import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Skill } from '../../shared/types'

/**
 * A *committed* project skill would arrive in a session's worktree for free
 * — git worktrees check out the same tracked files as any other branch
 * checkout. But a skill created through Laird's own "create a new skill"
 * form is real, on-disk, and almost certainly uncommitted the moment it's
 * created — live-verified (Workstream C) that `git worktree add` checks out
 * HEAD, not the main working directory's untracked files, so an uncommitted
 * project skill is genuinely invisible to a fresh worktree otherwise. A
 * *global* skill (loose in `~/.claude/skills/`, or bundled inside an
 * installed plugin) lives outside the repo entirely and was never going to
 * arrive "for free" regardless of commit state.
 *
 * So both cases get the same treatment here, uniformly: every skill a
 * session should see — the project's own plus whichever global ones were
 * explicitly enabled — is symlinked (not copied) into the worktree, live,
 * removed/recreated fresh per session rather than accumulating or going
 * stale relative to a possibly-uncommitted source.
 */
export function materializeSkills(worktreePath: string, skills: Skill[]): void {
  const skillsDir = join(worktreePath, '.claude', 'skills')
  mkdirSync(skillsDir, { recursive: true })

  for (const skill of skills) {
    const sourceDir = dirname(skill.path) // SKILL.md's own directory
    const linkPath = join(skillsDir, dirName(sourceDir))

    // Real bug, caught live: for a non-git project, `startSession` falls
    // back to running directly in the project's own path (no separate
    // worktree at all — see worktree.ts), so a project skill's `sourceDir`
    // and its "materialized" `linkPath` are the exact same real directory.
    // Without this guard, the rmSync below deletes the real skill first and
    // then tries to symlink it to itself, destroying it outright.
    if (sourceDir === linkPath) continue

    if (existsSync(linkPath) || isSymlink(linkPath)) {
      rmSync(linkPath, { recursive: true, force: true })
    }
    try {
      symlinkSync(sourceDir, linkPath, 'dir')
    } catch (err) {
      console.error(`[materialize] failed to symlink skill ${skill.name} into worktree`, err)
    }
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function dirName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1]
}
