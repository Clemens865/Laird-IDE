// Chunk 5 hardening: starts a real `claude` session through the real UI,
// quits the Electron app while it's still running (the exact scenario
// Risk #3 — orphaned background processes — is worried about), then checks
// the real OS process table for any leftover `claude` process.
//
// Gated behind LAIRD_E2E_REAL_SESSION=1 — makes a real, billed API call.
// Not run by default, same policy as e2e/smoke.mjs.

import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.env.LAIRD_E2E_REAL_SESSION !== '1') {
  console.log('[hardening] skipped — set LAIRD_E2E_REAL_SESSION=1 to run (makes a real billed API call)')
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/**
 * Scoped to processes whose real cwd is this test's own scratch directory —
 * NOT a blanket `ps aux | grep "claude -p"`. Real finding, live: this
 * machine runs other, completely unrelated tools that also invoke
 * `claude -p` directly (seen mid-debug: a design-studio task with its own
 * schema/system-prompt, nothing to do with Laird) — a blanket grep falsely
 * fails "no claude process running" whenever one of those happens to be
 * active at the same moment, which is a real, recurring condition on a
 * busy dev machine, not a one-off coincidence.
 */
function claudeProcessCount(scratchDir) {
  try {
    const pids = execSync('pgrep -f "claude -p" || true').toString().trim().split('\n').filter(Boolean)
    let count = 0
    for (const pid of pids) {
      try {
        const cwdLine = execSync(`lsof -p ${pid} -a -d cwd -Fn 2>/dev/null || true`).toString()
        if (cwdLine.includes(scratchDir)) count++
      } catch {
        // The process may have exited between pgrep and lsof — not a match, not an error.
      }
    }
    return count
  } catch {
    return 0
  }
}

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[hardening] PASS: ${name}`)
  } else {
    console.error(`[hardening] FAIL: ${name}`)
    failed = true
  }
}

const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-hardening-e2e-'))

const before = claudeProcessCount(scratchDir)
check('no claude process running in this test\'s own scratch dir before the test starts', before === 0)

// A dedicated, disposable userData dir per run — the real root cause found
// live while debugging a flaky app.close() hang during Workstream D: dev
// mode's default Electron userData dir is shared with every OTHER local
// Electron app on this machine, and lock/resource contention between them
// can make `app.close()` hang indefinitely even though the underlying
// `claude` child process (the thing actually under test) was already
// cleanly killed. Isolating this per run removes that cross-contamination
// vector entirely, for this test and every other e2e file.
const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })
const window = await app.firstWindow()
await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

await window.locator('[data-testid="add-project-button"]').click()
await window.locator('[data-testid="new-project-path-input"]').fill(scratchDir)
await window.locator('[data-testid="confirm-add-project"]').click()
await window.waitForSelector('[data-testid="project-tab"]', { timeout: 5_000 })

await window.locator('[data-testid="composer-input"]').fill(
  'Write a short paragraph (at least 200 words) explaining how photosynthesis works, slowly and in detail.',
)
await window.locator('[data-testid="composer-send"]').click()

await window.waitForFunction(
  () => document.querySelector('[data-testid="project-status"]')?.textContent === 'running',
  undefined,
  { timeout: 10_000 },
)
const duringRun = claudeProcessCount(scratchDir)
check('a real claude process is running mid-session', duringRun >= 1)

// The actual scenario under test: quit while a session is still active.
await app.close()
await new Promise((r) => setTimeout(r, 1_500)) // grace period for SIGTERM/SIGKILL to land

const after = claudeProcessCount(scratchDir)
check('no claude process remains after quitting mid-run', after === 0)

if (failed) {
  console.error('\n[hardening] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[hardening] all checks passed')
}
