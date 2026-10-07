// Workstream G chunk 1 (harness-mode design pass) verification — free, no
// real `claude` CLI call: exercises spec authoring and the preview-command
// detect-then-confirm flow against the real built app (Playwright's
// `_electron`, same pattern as smoke.mjs). Run via `node e2e/harness.mjs`
// after `npm run build`.
//
// Deliberately stops short of clicking "Run harness" — since chunk 2
// (src/main/harness/reviewer.ts), that button triggers a real, billed
// `claude` reviewer call. The real-reviewer path is covered by the gated
// `e2e/harness-reviewer.mjs` instead (LAIRD_E2E_REAL_SESSION=1).

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[harness-e2e] PASS: ${name}`)
  } else {
    console.error(`[harness-e2e] FAIL: ${name}`)
    failed = true
  }
}

async function addProject(window, projectPath) {
  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(projectPath)
  await window.locator('[data-testid="confirm-add-project"]').click()
}

const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-harness-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-harness-e2e-project-'))
  // A real vite dev script — gives `detectPreviewCommand` something real to find.
  writeFileSync(
    path.join(scratchDir, 'package.json'),
    JSON.stringify({ name: 'scratch', scripts: { dev: 'vite', test: 'vitest run' }, devDependencies: { vite: '^5.0.0' } }),
  )
  await addProject(window, scratchDir)
  await window.waitForSelector('[data-testid="project-status"]', { timeout: 10_000 })

  await window.locator('[data-testid="toggle-harness-button"]').click()
  await window.waitForSelector('[data-testid="harness-view"]', { timeout: 10_000 })

  check('harness view starts with no criteria', (await window.locator('[data-testid="harness-criterion-row"]').count()) === 0)
  check(
    'running is disabled with zero criteria',
    await window.locator('[data-testid="harness-run-button"]').evaluate((el) => el.style.opacity === '0.5'),
  )

  await window.locator('[data-testid="harness-criterion-input"]').fill('The signup form should work on mobile')
  await window.locator('[data-testid="harness-criterion-add"]').click()
  await window.locator('[data-testid="harness-criterion-input"]').fill('The API should reject negative amounts')
  await window.locator('[data-testid="harness-criterion-add"]').click()

  await window.waitForFunction(
    () => document.querySelectorAll('[data-testid="harness-criterion-row"]').length === 2,
    undefined,
    { timeout: 5_000 },
  )
  check('two criteria were added and persisted to view state', true)

  await window.locator('[data-testid="harness-criterion-remove"]').first().click()
  await window.waitForFunction(
    () => document.querySelectorAll('[data-testid="harness-criterion-row"]').length === 1,
    undefined,
    { timeout: 5_000 },
  )
  check('removing a criterion works', true)
  // Re-add the second criterion so a real run below has two to check.
  await window.locator('[data-testid="harness-criterion-input"]').fill('The signup form should work on mobile')
  await window.locator('[data-testid="harness-criterion-add"]').click()
  await window.waitForFunction(
    () => document.querySelectorAll('[data-testid="harness-criterion-row"]').length === 2,
    undefined,
    { timeout: 5_000 },
  )

  await window.locator('[data-testid="harness-preview-detect"]').click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="harness-preview-command"]')?.value === 'npm run dev',
    undefined,
    { timeout: 5_000 },
  )
  check('a real dev command was detected from the scratch project\'s package.json', true)
  check(
    'the known vite port was proposed alongside it',
    (await window.locator('[data-testid="harness-preview-port"]').inputValue()) === '5173',
  )

  await window.locator('[data-testid="harness-preview-save"]').click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="harness-preview-status"]')?.textContent?.includes('Confirmed: npm run dev on port 5173'),
    undefined,
    { timeout: 5_000 },
  )
  check('the detected preview command was confirmed and persisted, never silently auto-started', true)

  check(
    'running is enabled now that criteria exist (a real click here would trigger a billed reviewer call — covered by harness-reviewer.mjs instead)',
    await window.locator('[data-testid="harness-run-button"]').evaluate((el) => el.style.opacity !== '0.5'),
  )

  await window.locator('[data-testid="harness-test-detect"]').click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="harness-test-command"]')?.value === 'npm test',
    undefined,
    { timeout: 5_000 },
  )
  check('a real test command was detected from the scratch project\'s package.json', true)

  await window.locator('[data-testid="harness-test-save"]').click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="harness-test-status"]')?.textContent?.includes('Confirmed: npm test'),
    undefined,
    { timeout: 5_000 },
  )
  check('the detected test command was confirmed and persisted, never silently auto-run', true)

  check('the Jev feature menu renders all four capabilities', (await window.locator('[data-testid^="jev-feature-toggle-"]').count()) === 4)
  check(
    'every Jev feature toggle starts disabled with no API key configured',
    (await window.locator('[data-testid^="jev-feature-toggle-"]:not([disabled])').count()) === 0,
  )

  await window.locator('[data-testid="typesafe-key-input"]').fill('sk-fake-e2e-key-not-real')
  await window.locator('[data-testid="typesafe-key-save"]').click()
  await window.waitForSelector('[data-testid="typesafe-key-status"]', { timeout: 5_000 })
  check(
    'every Jev feature toggle becomes enabled once a key is configured',
    (await window.locator('[data-testid^="jev-feature-toggle-"]:not([disabled])').count()) === 4,
  )

  await window.locator('[data-testid="jev-feature-toggle-criterionRouting"]').click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="jev-feature-toggle-criterionRouting"]')?.checked === true,
    undefined,
    { timeout: 5_000 },
  )
  check('toggling an individual Jev feature on persists via real IPC', true)

  const screenshotPath = process.env.LAIRD_SCREENSHOT_PATH ?? path.join(tmpdir(), 'laird-harness-view.png')
  await window.screenshot({ path: screenshotPath })
  console.log(`[harness-e2e] screenshot saved to ${screenshotPath}`)
} finally {
  await app.close()
}

if (failed) {
  console.error('\n[harness-e2e] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[harness-e2e] all checks passed')
}
