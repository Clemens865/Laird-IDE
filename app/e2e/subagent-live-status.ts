// Workstream C chunk 4 verification: the real subagent-liveness wiring
// (claude CLI -> mapEvents -> SessionManager's merge logic -> the event the
// renderer would receive), exercised against a REAL `claude` CLI run that
// actually spawns a subagent via the `Agent` tool — not a fake transport.
//
// Deliberately bypasses Electron/the UI: SessionManager has no Electron
// dependency, and the one thing this chunk needs verified for real is the
// main-process wiring, not React rendering (sanity-checked manually via
// `npm run dev` instead — a permission-tier UI control for subagent-capable
// sessions is Workstream D's job, not this chunk's).
//
// Gated behind LAIRD_E2E_REAL_SESSION=1, same policy as the other e2e files
// — makes a real, billed API call. Run with `npx tsx e2e/subagent-live-status.ts`.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../src/main/store/memoryStore'
import { SessionManager, type SessionManagerEvent } from '../src/main/session/sessionManager'
import { ClaudeHeadlessTransport } from '../src/main/session/claudeHeadlessTransport'
import type { Subagent } from '../src/shared/types'

if (process.env.LAIRD_E2E_REAL_SESSION !== '1') {
  console.log('[subagent-live-status] skipped — set LAIRD_E2E_REAL_SESSION=1 to run (makes a real billed API call)')
  process.exit(0)
}

let failed = false
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`[subagent-live-status] PASS: ${name}`)
  } else {
    console.error(`[subagent-live-status] FAIL: ${name}`)
    failed = true
  }
}

const scratchDir = mkdtempSync(join(tmpdir(), 'laird-subagent-e2e-'))
const store = new MemoryStore(null)
store.upsertProject({
  id: 'p1',
  name: 'Subagent E2E',
  path: scratchDir,
  colorToken: '#D97757',
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  enabledGlobalSkillIds: [],
  permissionTier: 'full',
  approvalMode: 'auto',
  autonomyRevoked: false,
})

const seenBySubagentId = new Map<string, Subagent[]>()
const manager = new SessionManager({
  store,
  onEvent: (_sessionId, event: SessionManagerEvent) => {
    if (event.kind === 'subagent') {
      const subagent = event.payload
      const history = seenBySubagentId.get(subagent.id) ?? []
      history.push(subagent)
      seenBySubagentId.set(subagent.id, history)
    }
  },
  onSessionUpdate: () => {},
  // Real git worktree creation isn't the point of this test — reuse the
  // scratch dir itself, exactly like sessionManager.test.ts's own fake.
  createWorktree: (repoPath) => ({ path: repoPath, branch: null, isGitRepo: false }),
  // Full tier, deliberately, for this one diagnostic run only — the product
  // default stays 'safe' until Workstream D's tiered-permission UI exists.
  createTransport: () => new ClaudeHeadlessTransport({ permissionTier: 'full' }),
})

const prompt =
  'Use the Task tool to launch a subagent (general-purpose type) with the instruction: ' +
  '"Count the number of files in the current directory and reply with just the number." ' +
  'Wait for its result and then reply with exactly that number and nothing else.'

const sessionId = await manager.startSession({ projectId: 'p1', prompt, model: 'claude-haiku-4-5-20251001' })

await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('timed out waiting for the session to finish')), 60_000)
  const poll = setInterval(() => {
    const session = store.getSession(sessionId)
    if (session?.status === 'idle' || session?.status === 'needs-review') {
      clearInterval(poll)
      clearTimeout(timeout)
      resolve()
    }
  }, 500)
})

check('exactly one subagent was spawned', seenBySubagentId.size === 1)
const history = [...seenBySubagentId.values()][0] ?? []
check('the subagent was seen in an active state at least once', history.some((s) => s.status === 'active'))
check('the subagent ended in a done state', history.at(-1)?.status === 'done')
check('the subagent carried a real role (subagent_type)', history.at(-1)?.role === 'general-purpose')
check(
  'the final done update kept the description as its name (partial updates merged onto earlier ones)',
  typeof history.at(-1)?.name === 'string' && (history.at(-1)?.name.length ?? 0) > 0,
)

// Workstream F addition (docs/research/observability-landscape-2026.md):
// the subagent should carry a real, resolved link back to the ActivityLogEntry
// for the real `Agent` tool-call that spawned it — not left undefined.
const agentToolCallLogs = store.getActivityLog(sessionId).filter((e) => {
  const payload = e.payload as { name?: string; id?: string }
  return e.kind === 'tool-call' && payload.name === 'Agent'
})
check(
  'exactly one ActivityLogEntry was logged for the real Agent tool-call (no duplicate from the partial-message stream_event shape)',
  agentToolCallLogs.length === 1,
)
const agentToolCallLog = agentToolCallLogs[0]
check('a real ActivityLogEntry was logged for the real Agent tool-call', agentToolCallLog !== undefined)
check(
  'the subagent\'s parentActivityLogEntryId resolves to that real ActivityLogEntry, not left undefined',
  history.at(-1)?.parentActivityLogEntryId === agentToolCallLog?.id,
)

// Workstream F addition: the real token breakdown should now be captured
// on the session's UsageEvent, not just cost/duration.
const [usage] = store.getUsageEvents(sessionId)
check(
  'the real token breakdown was captured on the UsageEvent, not discarded',
  typeof usage?.inputTokens === 'number' && typeof usage?.outputTokens === 'number' && usage.inputTokens > 0 && usage.outputTokens > 0,
)

if (failed) {
  console.error('\n[subagent-live-status] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[subagent-live-status] all checks passed')
}
