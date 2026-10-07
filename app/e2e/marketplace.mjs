// Workstream E: the plugin marketplace browser, verified against the real
// `claude plugin` CLI — browsing the real catalog, installing a real
// (harmless, official, skill/agent-only) plugin, verifying Laird's own
// post-install check against what the real CLI itself reports, then
// removing it again to leave the machine exactly as it was.
//
// Not billed (no API call), but it DOES mutate this machine's real,
// global Claude Code plugin configuration — gated behind an explicit
// opt-in by the same care principle as the billed e2e files, not run by
// default. Run via `npm run build && LAIRD_E2E_REAL_MARKETPLACE=1 node
// e2e/marketplace.mjs`.

import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.env.LAIRD_E2E_REAL_MARKETPLACE !== '1') {
  console.log('[marketplace] skipped — set LAIRD_E2E_REAL_MARKETPLACE=1 to run (installs/removes a real, harmless plugin on this machine)')
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[marketplace] PASS: ${name}`)
  } else {
    console.error(`[marketplace] FAIL: ${name}`)
    failed = true
  }
}

function realInstalledIds() {
  const out = execFileSync('claude', ['plugin', 'list', '--json']).toString()
  return JSON.parse(out).map((p) => p.id)
}

const TEST_PLUGIN_ID = 'agent-sdk-dev@claude-plugins-official'
const before = realInstalledIds()
if (before.includes(TEST_PLUGIN_ID)) {
  console.error(`[marketplace] ${TEST_PLUGIN_ID} is already installed on this machine — aborting rather than risk removing a real one the user installed themselves.`)
  process.exit(1)
}

const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  await window.locator('[data-testid="toggle-marketplace-button"]').click()
  await window.waitForSelector('[data-testid="marketplace-view"]', { timeout: 10_000 })
  check('the disclosure banner is shown', (await window.locator('[data-testid="marketplace-disclosure"]').textContent())?.includes('not sandboxed'))

  // The real catalog is thousands of entries — wait for rows to actually render, not just the container.
  await window.waitForSelector('[data-testid="marketplace-row"]', { timeout: 10_000 })
  const totalCount = await window.locator('[data-testid="marketplace-row"]').count()
  check('the real plugin catalog rendered many real entries, not a stub', totalCount > 10)

  await window.locator('[data-testid="marketplace-search"]').fill('agent-sdk-dev')
  // Real finding: more than one marketplace ships a plugin named
  // "agent-sdk-dev" (claude-plugins-official and anthropic-plugin-directory
  // both do) — search narrows the catalog, but not necessarily to one row.
  const row = window.locator('[data-testid="marketplace-row"][data-plugin-id="agent-sdk-dev@claude-plugins-official"]')
  await row.waitFor({ timeout: 5_000 })
  check('searching narrows the real catalog down to the exact real plugin', (await row.count()) === 1)

  await row.locator('[data-testid="marketplace-install-button"]').click()
  await window.waitForSelector('[data-plugin-id="agent-sdk-dev@claude-plugins-official"] [data-testid="marketplace-verify-result"]', {
    timeout: 20_000,
  })

  const afterInstall = realInstalledIds()
  check('the real claude CLI now reports the plugin installed', afterInstall.includes(TEST_PLUGIN_ID))

  const verifyText = await row.locator('[data-testid="marketplace-verify-result"]').textContent()
  check(
    'the real post-install verify shows the real component inventory (1 skill, 2 agents)',
    (verifyText ?? '').includes('1 skill') && (verifyText ?? '').includes('2 agents'),
  )
  const scanText = await row.locator('[data-testid="marketplace-scan-result"]').textContent()
  check('the real secret scan reported clean for this real, official plugin', (scanText ?? '').includes('nothing flagged'))

  check('the row now shows Remove instead of Install', (await row.locator('[data-testid="marketplace-uninstall-button"]').count()) === 1)

  await row.locator('[data-testid="marketplace-uninstall-button"]').click()
  await window.waitForFunction(
    () => document.querySelector('[data-plugin-id="agent-sdk-dev@claude-plugins-official"] [data-testid="marketplace-install-button"]') !== null,
    undefined,
    { timeout: 10_000 },
  )

  const afterRemove = realInstalledIds()
  check('the real claude CLI confirms the plugin is gone again', !afterRemove.includes(TEST_PLUGIN_ID))
  check('the machine ends up with exactly the same installed set it started with', JSON.stringify(afterRemove.sort()) === JSON.stringify(before.sort()))
} finally {
  await app.close()
  // Safety net regardless of what the UI-driven test above did or didn't finish.
  if (realInstalledIds().includes(TEST_PLUGIN_ID)) {
    console.error('[marketplace] cleanup: uninstalling the test plugin via the real CLI directly')
    execFileSync('claude', ['plugin', 'uninstall', TEST_PLUGIN_ID, '-y'])
  }
}

if (failed) {
  console.error('\n[marketplace] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[marketplace] all checks passed')
}
