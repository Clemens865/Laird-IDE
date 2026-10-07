// Workstream D: plan-bound confirmation (approvalMode === 'ask'), verified
// against a real, billed `claude` session. Confirms the exact prompt shown
// in the confirmation panel is the exact prompt that runs, and that
// cancelling genuinely starts nothing.
//
// Gated behind LAIRD_E2E_REAL_SESSION=1, same policy as the other e2e files
// — makes a real, billed API call.

import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.env.LAIRD_E2E_REAL_SESSION !== '1') {
  console.log('[confirm-start] skipped — set LAIRD_E2E_REAL_SESSION=1 to run (makes a real billed API call)')
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[confirm-start] PASS: ${name}`)
  } else {
    console.error(`[confirm-start] FAIL: ${name}`)
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

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-confirm-start-e2e-'))
  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(scratchDir)
  await window.locator('[data-testid="confirm-add-project"]').click()
  await window.waitForSelector('[data-testid="project-tab"]', { timeout: 5_000 })

  await window.locator('[data-testid="approval-mode-select"]').selectOption('ask')
  check('switching to ask mode through the real permission control succeeded', true)

  const prompt = 'Create a file named confirmed.txt containing exactly this text with no trailing newline: plan-bound confirmation works'
  await window.locator('[data-testid="composer-input"]').fill(prompt)
  await window.locator('[data-testid="composer-send"]').click()

  await window.waitForSelector('[data-testid="confirm-start"]', { timeout: 5_000 })
  check('sending in ask mode shows a confirmation instead of starting anything', true)
  check('no claude process started before confirming', claudeProcessCount(scratchDir) === 0)

  const shownPrompt = await window.locator('[data-testid="confirm-start-prompt"]').textContent()
  check('the confirmation shows the exact proposed prompt', shownPrompt === prompt)

  // Cancel first — confirm cancelling genuinely starts nothing, then redo for real.
  await window.locator('[data-testid="confirm-start-cancel"]').click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="confirm-start"]') === null,
    undefined,
    { timeout: 5_000 },
  )
  check('cancelling returns to a normal composer', (await window.locator('[data-testid="composer-input"]').count()) === 1)
  check('cancelling started no real process', claudeProcessCount(scratchDir) === 0)
  check('cancelling left no file behind', !existsSync(path.join(scratchDir, 'confirmed.txt')))

  await window.locator('[data-testid="composer-input"]').fill(prompt)
  await window.locator('[data-testid="composer-send"]').click()
  await window.waitForSelector('[data-testid="confirm-start"]', { timeout: 5_000 })

  await window.locator('[data-testid="confirm-start-accept"]').click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="project-status"]')?.textContent === 'running',
    undefined,
    { timeout: 10_000 },
  )
  check('confirming actually starts a real session', true)

  await window.waitForFunction(
    () => document.querySelector('[data-testid="project-status"]')?.textContent === 'idle',
    undefined,
    { timeout: 60_000 },
  )

  const fileOk = existsSync(path.join(scratchDir, 'confirmed.txt')) && readFileSync(path.join(scratchDir, 'confirmed.txt'), 'utf8').trim() === 'plan-bound confirmation works'
  check('the confirmed real session produced exactly the file the confirmed prompt described', fileOk)
} finally {
  await app.close()
}

if (failed) {
  console.error('\n[confirm-start] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[confirm-start] all checks passed')
}
