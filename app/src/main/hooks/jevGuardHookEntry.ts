/**
 * The real `PreToolUse` hook command Claude Code invokes — a separate
 * build entry (see `electron.vite.config.ts`), run via Electron's own
 * binary in `ELECTRON_RUN_AS_NODE` mode (never assumes a system `node` is
 * on PATH — a packaged app can't rely on that). Reads the hook's real
 * stdin JSON, calls `evaluateToolCall`, writes its decision (or nothing,
 * for an allow) to stdout, and always exits 0 — this process's own
 * failure must never block a tool call either, same fail-open discipline
 * as the logic it wraps.
 */
import { evaluateToolCall, type PreToolUseHookInput } from './jevGuard'

async function readStdin(): Promise<string> {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  return raw
}

async function main(): Promise<void> {
  try {
    const raw = await readStdin()
    const input = JSON.parse(raw) as PreToolUseHookInput
    const decision = await evaluateToolCall(input, process.env.LAIRD_TYPESAFE_KEY, fetch)
    if (decision) process.stdout.write(JSON.stringify(decision))
  } catch (err) {
    console.error('[jevGuardHookEntry] failed, failing open', err)
  }
  process.exit(0)
}

void main()
