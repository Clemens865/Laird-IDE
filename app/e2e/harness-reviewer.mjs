// Workstream G chunk 2 verification — a real, billed fresh-context reviewer
// invocation (src/main/harness/reviewer.ts), driven through the real built
// app's UI, not called directly. Gated behind LAIRD_E2E_REAL_SESSION=1, same
// policy as the other real-API-call e2e files. Run with
// `LAIRD_E2E_REAL_SESSION=1 node e2e/harness-reviewer.mjs` after `npm run build`.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.env.LAIRD_E2E_REAL_SESSION !== '1') {
  console.log('[harness-reviewer-e2e] skipped — set LAIRD_E2E_REAL_SESSION=1 to run (makes a real billed API call)')
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[harness-reviewer-e2e] PASS: ${name}`)
  } else {
    console.error(`[harness-reviewer-e2e] FAIL: ${name}`)
    failed = true
  }
}

const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-harness-reviewer-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-harness-reviewer-e2e-project-'))
  // A real, unambiguous file for the reviewer to genuinely find via Read/Glob/Grep.
  writeFileSync(
    path.join(scratchDir, 'math.js'),
    "function add(a, b) {\n  return a + b\n}\n\nmodule.exports = { add }\n",
  )

  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(scratchDir)
  await window.locator('[data-testid="confirm-add-project"]').click()
  await window.waitForSelector('[data-testid="project-status"]', { timeout: 10_000 })

  await window.locator('[data-testid="toggle-harness-button"]').click()
  await window.waitForSelector('[data-testid="harness-view"]', { timeout: 10_000 })

  const trueCriterion = 'math.js exports a function called add that adds two numbers together'
  const falseCriterion = 'math.js exports a function called subtractNumbers that subtracts two numbers'

  for (const criterion of [trueCriterion, falseCriterion]) {
    await window.locator('[data-testid="harness-criterion-input"]').fill(criterion)
    await window.locator('[data-testid="harness-criterion-add"]').click()
  }
  await window.waitForFunction(
    () => document.querySelectorAll('[data-testid="harness-criterion-row"]').length === 2,
    undefined,
    { timeout: 5_000 },
  )

  await window.locator('[data-testid="harness-run-button"]').click()
  // A real reviewer run (fresh claude -p process with Read/Glob/Grep) can
  // genuinely take a while — generous timeout, same spirit as the other
  // real-session e2e files.
  await window.waitForSelector('[data-testid="harness-run-row"]', { timeout: 120_000 })

  const resultRows = window.locator('[data-testid="harness-criterion-result"]')
  check('a real harness run rendered with one result row per criterion', (await resultRows.count()) === 2)

  const allText = await window.locator('[data-testid="harness-run-row"]').first().textContent()
  check(
    'the run is NOT the chunk-1 placeholder text — a real reviewer genuinely ran',
    !allText.includes('No reviewer has checked this yet'),
  )
  check(
    'at least one criterion came back with real evidence, not just STATED (the reviewer actually looked at the real file)',
    /VERIFIED|CORROBORATED/.test(allText),
  )

  const trueRowText = await resultRows.filter({ hasText: 'add' }).first().textContent()
  check('the genuinely-true criterion was recognized as shipping', trueRowText.includes('SHIP'))

  await app.close()
} catch (err) {
  console.error('[harness-reviewer-e2e] threw:', err)
  failed = true
  await app.close().catch(() => {})
}

if (failed) {
  console.error('\n[harness-reviewer-e2e] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[harness-reviewer-e2e] all checks passed')
}
