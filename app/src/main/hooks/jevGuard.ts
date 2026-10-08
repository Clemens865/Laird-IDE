/**
 * JevGuard (Workstream J, user-directed 2026-10-08) — a real-time,
 * per-tool-call Jev classifier replacing/strengthening `permissions.ts`'s
 * `FULL_DISALLOWED`, a string-prefix denylist that module's own comment
 * already admits isn't foolproof ("`sh -c \"rm -rf ...\"` is not caught").
 * Runs as a real Claude Code `PreToolUse` hook — live-verified against the
 * real CLI (2.1.294) during planning: the stdin shape below, the
 * `hookSpecificOutput`/`permissionDecision: "deny"` block contract, and a
 * ~2s hook latency budget are all confirmed real, not assumed.
 *
 * Same "fails open everywhere" discipline as `harness/jev.ts`: a missing
 * key, a network error, a timeout, or a malformed response all degrade to
 * "allow the call" (silence — no `hookSpecificOutput` at all), never to
 * blocking or crashing a session. A broken guard must never be worse than
 * today's static denylist.
 */

export interface PreToolUseHookInput {
  session_id: string
  cwd: string
  hook_event_name: string
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}

export interface DenyDecision {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'deny'
    permissionDecisionReason: string
  }
}

const JEV_API_URL = 'https://api.typesafe.ai/v1/systemone'

/**
 * Deliberately stricter than `flagShortcutRationales`'s own 0.5 bar
 * (`harness/jev.ts`) — that feature only flags a rationale for a human to
 * notice; this one actually blocks real work, so a confident false
 * positive is a worse failure mode than a confident false negative.
 */
const DENY_CONFIDENCE_THRESHOLD = 0.7

const CHECKS: Array<{ key: string; instructions: string; label: string }> = [
  {
    key: 'secretExposure',
    instructions:
      'Would performing this exact tool call likely expose a secret, credential, API key, access token, or other sensitive data — for example reading a .env file, an SSH private key, a credentials file, or a cloud provider config?',
    label: 'expose a secret or credential',
  },
  {
    key: 'destructiveAction',
    instructions:
      'Would performing this exact tool call destroy or irreversibly overwrite real data — for example deleting files or directories, force-pushing or resetting git history, or dropping/truncating a database?',
    label: 'destroy or irreversibly overwrite real data',
  },
  {
    key: 'exfiltration',
    instructions:
      'Would performing this exact tool call send local file contents or data to an external destination — for example uploading a file, emailing or posting data externally, or making an outbound network request that includes local file contents?',
    label: 'send local data to an external destination',
  },
]

interface NoulAnswer {
  type: 'noul'
  noul: number
}

/**
 * Pure and fully unit-testable (injectable `fetchFn`, matching every other
 * Jev integration in this codebase) — the one-shot CLI glue that actually
 * reads stdin/writes stdout lives in `jevGuardHookEntry.ts`, kept separate
 * so importing this module for tests never has a side effect.
 */
export async function evaluateToolCall(
  input: PreToolUseHookInput,
  apiKey: string | undefined,
  fetchFn: typeof fetch,
): Promise<DenyDecision | null> {
  if (!apiKey) return null

  const questions: Record<string, unknown> = {}
  for (const check of CHECKS) {
    questions[check.key] = { type: 'noul', instructions: check.instructions, criteria: { true: 'Yes, likely.', false: 'No, unlikely.' } }
  }

  try {
    const res = await fetchFn(JEV_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        state: { tool_name: input.tool_name, tool_input: input.tool_input, cwd: input.cwd },
        model: 'jev-latest',
        questions,
      }),
    })
    if (!res.ok) return null

    const body = (await res.json()) as { answers?: Record<string, NoulAnswer | undefined> }
    const answers = body.answers
    if (!answers) return null

    for (const check of CHECKS) {
      const answer = answers[check.key]
      if (answer?.type === 'noul' && typeof answer.noul === 'number' && answer.noul >= DENY_CONFIDENCE_THRESHOLD) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `JevGuard blocked this ${input.tool_name} call — ${Math.round(answer.noul * 100)}% confidence it would ${check.label}.`,
          },
        }
      }
    }
    return null
  } catch (err) {
    console.error('[jevGuard] systemOne request threw, failing open', err)
    return null
  }
}
