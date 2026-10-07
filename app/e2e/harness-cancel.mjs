// Harness-run cancellation ("Take back control") verification — a real,
// billed `claude -p` reviewer call, canceled mid-run through the real UI.
// Same trust-feature verification bar as the existing session kill switch
// (trust-kill-switch.mjs): confirms via the real OS process table that the
// real reviewer process is genuinely gone, not just that the UI stopped
// showing "Running…".
//
// Gated behind LAIRD_E2E_REAL_SESSION=1 — makes one real, billed API call.
// Run with: LAIRD_E2E_REAL_SESSION=1 node e2e/harness-cancel.mjs

import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.env.LAIRD_E2E_REAL_SESSION !== '1') {
  console.log('[harness-cancel-e2e] skipped — set LAIRD_E2E_REAL_SESSION=1 to run (makes a real billed API call)')
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[harness-cancel-e2e] PASS: ${name}`)
  } else {
    console.error(`[harness-cancel-e2e] FAIL: ${name}`)
    failed = true
  }
}

/** Scoped to this test's own scratch dir, so other unrelated `claude -p` processes on the machine never produce a false positive (the established pattern in this project's other real e2e files). */
function realClaudeProcessesForCwd(cwd) {
  try {
    const pids = execSync('pgrep -f "claude -p"', { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    return pids.filter((pid) => {
      try {
        const realCwd = execSync(`lsof -p ${pid} -a -d cwd -Fn`, { encoding: 'utf8' })
        return realCwd.includes(cwd)
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-harness-cancel-e2e-'))
writeFileSync(path.join(scratchDir, 'README.md'), '# Scratch project for a harness-cancel e2e check\n')

const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-harness-cancel-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(scratchDir)
  await window.locator('[data-testid="confirm-add-project"]').click()
  await window.waitForSelector('[data-testid="project-status"]', { timeout: 10_000 })

  await window.locator('[data-testid="toggle-harness-button"]').click()
  await window.waitForSelector('[data-testid="harness-view"]', { timeout: 10_000 })

  await window.locator('[data-testid="harness-criterion-input"]').fill('This project has a real README.md file')
  await window.locator('[data-testid="harness-criterion-add"]').click()
  await window.waitForSelector('[data-testid="harness-criterion-row"]', { timeout: 5_000 })

  await window.locator('[data-testid="harness-run-button"]').click()
  await window.waitForSelector('[data-testid="harness-run-cancel"]', { timeout: 10_000 })
  check('a "Take back control" cancel button appears once a real run starts', true)

  // Give the real `claude -p` process a moment to actually spawn before canceling it.
  await window.waitForTimeout(1_500)
  const pidsBeforeCancel = realClaudeProcessesForCwd(scratchDir)
  check('a real claude -p process for this scratch project is genuinely running before cancel', pidsBeforeCancel.length > 0)

  await window.locator('[data-testid="harness-run-cancel"]').click()
  await window.waitForSelector('[data-testid="harness-run-row"]', { timeout: 15_000 })

  const runRowText = await window.locator('[data-testid="harness-run-row"]').first().textContent()
  check('the run resolved with an honest canceled result, not a fabricated verdict', runRowText.includes('Canceled'))

  await window.waitForTimeout(1_000)
  const pidsAfterCancel = realClaudeProcessesForCwd(scratchDir)
  check('the real claude -p process is genuinely gone after cancel, confirmed via the real OS process table', pidsAfterCancel.length === 0)
} finally {
  await app.close()
}

if (failed) {
  console.error('\n[harness-cancel-e2e] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[harness-cancel-e2e] all checks passed')
}
