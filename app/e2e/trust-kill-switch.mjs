// Workstream D: the "Take back control" kill switch, verified against a
// real, billed `claude` session — not just unit-tested mechanics. Confirms
// the PRD's own bar: the kill switch demonstrably halts a running session's
// next action (here: the real OS process dies and a follow-up send is
// refused) in an e2e test, not just in code review.
//
// Gated behind LAIRD_E2E_REAL_SESSION=1, same policy as the other e2e files
// — makes a real, billed API call. Run via `npm run build && node
// e2e/trust-kill-switch.mjs` with that env var set.

import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.env.LAIRD_E2E_REAL_SESSION !== '1') {
  console.log('[kill-switch] skipped — set LAIRD_E2E_REAL_SESSION=1 to run (makes a real billed API call)')
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[kill-switch] PASS: ${name}`)
  } else {
    console.error(`[kill-switch] FAIL: ${name}`)
    failed = true
  }
}

/**
 * Scoped to processes whose real cwd is this test's own scratch directory —
 * NOT a blanket `ps aux | grep "claude -p"`. Real finding, live
 * (hardening-kill-mid-run.mjs): this machine runs other, unrelated tools
 * that also invoke `claude -p` directly — a blanket grep can false-positive
 * against them.
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

// Isolated per run — avoids cross-contamination with other local Electron
// apps sharing dev mode's default userData dir (see hardening-kill-mid-run.mjs).
const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-kill-switch-e2e-'))
  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(scratchDir)
  await window.locator('[data-testid="confirm-add-project"]').click()
  await window.waitForSelector('[data-testid="project-tab"]', { timeout: 5_000 })

  const before = claudeProcessCount(scratchDir)
  check('no claude process running before the test starts', before === 0)

  // A long-running, slow task — gives the kill switch something real to interrupt mid-run.
  await window.locator('[data-testid="composer-input"]').fill(
    'Write a very detailed, at least 500-word essay about the history of lighthouses, one paragraph at a time.',
  )
  await window.locator('[data-testid="composer-send"]').click()

  await window.waitForFunction(
    () => document.querySelector('[data-testid="project-status"]')?.textContent === 'running',
    undefined,
    { timeout: 10_000 },
  )
  const duringRun = claudeProcessCount(scratchDir)
  check('a real claude process is running mid-session', duringRun >= 1)

  await window.waitForSelector('[data-testid="kill-switch-button"]', { timeout: 5_000 })
  check('the kill switch is visible while a session is running', true)

  // The actual scenario under test: take back control mid-run.
  await window.locator('[data-testid="kill-switch-button"]').click()

  await new Promise((r) => setTimeout(r, 1_500)) // grace period for SIGTERM/SIGKILL to land
  const after = claudeProcessCount(scratchDir)
  check('no claude process remains after taking back control', after === 0)

  await window.waitForFunction(
    () => document.querySelector('[data-testid="project-status"]')?.textContent === 'needs review',
    undefined,
    { timeout: 5_000 },
  )
  check('session status reflects the forced stop (needs review), not a clean idle exit', true)

  await window.waitForSelector('[data-testid="autonomy-revoked-banner"]', { timeout: 5_000 })
  check('the autonomy-revoked banner replaces the composer', true)
  check('the composer itself is gone while autonomy is revoked', (await window.locator('[data-testid="composer-input"]').count()) === 0)

  // Resume control, then confirm a brand-new real session actually works again.
  await window.locator('[data-testid="resume-autonomy-button"]').click()
  await window.waitForSelector('[data-testid="composer-input"]', { timeout: 5_000 })
  check('resuming control brings back a real, usable composer', true)

  await window.locator('[data-testid="composer-input"]').fill(
    'Create a file named after-kill-switch.txt containing exactly this text with no trailing newline: back in control',
  )
  await window.locator('[data-testid="composer-send"]').click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="project-status"]')?.textContent === 'running',
    undefined,
    { timeout: 10_000 },
  )
  await window.waitForFunction(
    () => document.querySelector('[data-testid="project-status"]')?.textContent === 'idle',
    undefined,
    { timeout: 60_000 },
  )
  const { existsSync, readFileSync } = await import('node:fs')
  const fileOk =
    existsSync(path.join(scratchDir, 'after-kill-switch.txt')) &&
    readFileSync(path.join(scratchDir, 'after-kill-switch.txt'), 'utf8').trim() === 'back in control'
  check('a real new session after resuming control actually ran and produced the expected file', fileOk)
} finally {
  await app.close()
}

if (failed) {
  console.error('\n[kill-switch] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[kill-switch] all checks passed')
}
