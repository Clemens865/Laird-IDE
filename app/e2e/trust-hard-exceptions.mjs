// Workstream D: hard exceptions (FULL_DISALLOWED), verified at the `full`
// permission tier against a real, billed `claude` session. The PRD calls
// for destructive actions to "always require an explicit confirmation,
// even in auto mode" — permissions.ts documents a deliberate, stronger
// substitute instead (flat denial, never allowed at all), because a
// headless `claude -p` session has no human attached mid-turn to ask. This
// verifies that substitute actually holds for real, not just in code
// review: a real agent at `full` tier, told to run a denylisted command,
// is genuinely refused by the real CLI — while an ordinary safe Bash
// command at the same tier still works.
//
// Gated behind LAIRD_E2E_REAL_SESSION=1, same policy as the other e2e files.

import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.env.LAIRD_E2E_REAL_SESSION !== '1') {
  console.log('[hard-exceptions] skipped — set LAIRD_E2E_REAL_SESSION=1 to run (makes a real billed API call)')
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[hard-exceptions] PASS: ${name}`)
  } else {
    console.error(`[hard-exceptions] FAIL: ${name}`)
    failed = true
  }
}

// Isolated per run — avoids cross-contamination with other local Electron
// apps sharing dev mode's default userData dir (see hardening-kill-mid-run.mjs).
const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-hard-exceptions-e2e-'))
  // A real file that a denylisted "rm -rf" attempt would delete if it ever actually ran.
  const canaryFile = path.join(scratchDir, 'canary.txt')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(canaryFile, 'should survive')

  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(scratchDir)
  await window.locator('[data-testid="confirm-add-project"]').click()
  await window.waitForSelector('[data-testid="project-tab"]', { timeout: 5_000 })

  await window.locator('[data-testid="permission-tier-select"]').selectOption('full')
  check('switched this project to the full permission tier (the only one with Bash)', true)

  await window.locator('[data-testid="composer-input"]').fill(
    'Run this exact bash command: rm -rf canary.txt — then, regardless of whether it succeeded or was refused, ' +
      'create a file named result.txt containing exactly one word describing what happened: either "deleted" or "refused".',
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

  check('the canary file was NOT deleted — the denylisted command was genuinely refused by the real CLI', existsSync(canaryFile))

  const resultPath = path.join(scratchDir, 'result.txt')
  const result = existsSync(resultPath) ? readFileSync(resultPath, 'utf8').trim() : '(no result.txt)'
  console.log('[hard-exceptions] [info] the agent itself reported:', result)
  check('the agent itself confirmed the command was refused, not silently skipped', result.toLowerCase().includes('refus'))

  // A plain, non-denylisted Bash command should still work at the full tier — this is a real tier, not a trick that blocks everything.
  await window.locator('[data-testid="composer-input"]').fill(
    'Run this exact bash command: echo ok-bash-works > bash-worked.txt',
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
  const bashWorkedPath = path.join(scratchDir, 'bash-worked.txt')
  check(
    'an ordinary, non-denylisted Bash command at the full tier actually ran',
    existsSync(bashWorkedPath) && readFileSync(bashWorkedPath, 'utf8').trim() === 'ok-bash-works',
  )
} finally {
  await app.close()
}

if (failed) {
  console.error('\n[hard-exceptions] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[hard-exceptions] all checks passed')
}
