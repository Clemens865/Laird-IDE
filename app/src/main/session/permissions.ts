import type { PermissionTier } from '../../shared/types'

/**
 * Scoped tool allow-lists, ported from Workspace-OS's `agent-permissions.ts`
 * and expanded in Workstream D into the full named model from docs/prd/
 * technical/observability-trust-and-harness.md. `claude -p` can't show
 * interactive permission prompts (anything not pre-authorized is
 * auto-denied) — there's no human attached mid-turn in headless mode — so
 * Laird replaces `bypassPermissions` entirely with explicit allow-lists
 * instead of one blanket bypass, chosen *before* the session starts.
 *
 * **Why hard exceptions are a flat denylist, not a "confirm then allow"
 * gate.** The PRD's trust model calls for destructive/spend/network actions
 * to "always require an explicit confirmation, even in auto mode." A
 * headless `claude -p` run cannot pause mid-turn and wait for a human's
 * answer — there is no TTY, no mechanism to surface a prompt and resume.
 * Laird's honest, stronger substitute: `FULL_DISALLOWED` commands are never
 * allowed at all, in any tier or approval mode, full stop. Spend itself is
 * already gated by construction — a session only ever starts from an
 * explicit "send" click (optionally itself gated by a plan-bound
 * confirmation when `approvalMode === 'ask'`, see sessionManager.ts) — so
 * there's no path to autonomous spend without a prior human action.
 */

export const READ_ALLOWED = ['Read', 'Glob', 'Grep'] as const
export const WRITE_ALLOWED = [...READ_ALLOWED, 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const
export const MANAGE_ALLOWED = [...WRITE_ALLOWED, 'Task', 'Agent', 'TodoWrite', 'Skill', 'WebFetch', 'WebSearch'] as const
export const FULL_ALLOWED = [...MANAGE_ALLOWED, 'Bash', 'BashOutput', 'KillShell'] as const

const ALLOWED_BY_TIER: Record<PermissionTier, readonly string[]> = {
  read: READ_ALLOWED,
  write: WRITE_ALLOWED,
  manage: MANAGE_ALLOWED,
  full: FULL_ALLOWED,
}

/**
 * Prefix-matched denylist — honest limitation, carried over from the source
 * module's own comment: these are string-prefix matches on the command, so
 * `sh -c "rm -rf ..."` is not caught. Not the real safety net; a pre-run
 * checkpoint is (see store/memoryStore.ts's snapshot-before-write, and the
 * fuller git-checkpoint version planned for Workstream B). Only reachable
 * at all at the `full` tier, since it's the only one with `Bash`.
 */
export const FULL_DISALLOWED = [
  'sudo',
  'rm -rf',
  'rm -fr',
  'shutdown',
  'reboot',
  'halt',
  'mkfs',
  'dd ',
  'diskutil',
  'launchctl',
  'crontab',
  'git push --force',
  'git push -f',
  'git reset --hard',
  'git clean -f',
  'git clean -fd',
  'git branch -D',
  '> /dev/',
  'chmod -R 777',
] as const

export function buildPermissionArgs(tier: PermissionTier): string[] {
  const args = ['--allowedTools', ALLOWED_BY_TIER[tier].join(',')]
  if (tier === 'full') {
    args.push('--disallowedTools', FULL_DISALLOWED.map((c) => `Bash(${c}*)`).join(','))
  }
  return args
}
