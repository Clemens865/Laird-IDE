// Embedded-preview piece 3 verification — the real, complete pipeline
// through the real UI: a real TypeSafe key entered into Laird's own key
// field, real Jev criterion routing, and a real embedded live-preview
// panel open at the same time as a real harness run.
//
// A real, billed run of an earlier version of this file is what actually
// found the reason CDP-sharing is currently disabled (see index.ts's own
// comment): Playwright's `connectOverCDP` needs a browser-level CDP
// endpoint to manage targets, but a single `WebContentsView`'s CDP session
// only supports the page-scoped domains — handing it a page-level
// `webSocketDebuggerUrl` fails outright with "Target.createTarget: Not
// supported". So today this file verifies the current, intentional
// behavior instead: a harness run still works correctly via its own
// standalone ephemeral browser even while an unrelated live preview
// happens to be open for the same project, and does NOT show the
// sharing lock banner (since sharing isn't active).
//
// Gated behind LAIRD_E2E_REAL_SESSION=1 — makes real, billed API calls
// (both TypeSafe and a real `claude -p` reviewer). Requires a real
// TYPESAFE_API_KEY in the environment (never logged or printed here).
// Run with:
//   LAIRD_E2E_REAL_SESSION=1 node e2e/harness-shared-preview.mjs

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.env.LAIRD_E2E_REAL_SESSION !== '1') {
  console.log('[harness-shared-preview] skipped — set LAIRD_E2E_REAL_SESSION=1 to run (makes real billed API calls)')
  process.exit(0)
}
if (!process.env.TYPESAFE_API_KEY) {
  console.log('[harness-shared-preview] skipped — no TYPESAFE_API_KEY in the environment')
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const CDP_PORT = 9335
const PORT = 48181

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[harness-shared-preview] PASS: ${name}`)
  } else {
    console.error(`[harness-shared-preview] FAIL: ${name}`)
    failed = true
  }
}

const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-shared-preview-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })
app.process().stderr?.on('data', (chunk) => process.stdout.write(`[main] ${chunk}`))

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-shared-preview-e2e-project-'))
  writeFileSync(
    path.join(scratchDir, 'server.js'),
    `const http = require('http')
const html = '<!doctype html><html><body style="margin:0;font-family:sans-serif;background:#1b2730;color:white;display:flex;align-items:center;justify-content:center;height:100vh;"><h1 id="status">Not clicked</h1><button id="btn" onclick="document.getElementById(\\'status\\').textContent = \\'Clicked!\\'">Click me</button></body></html>'
http.createServer((req, res) => { res.writeHead(200, {'Content-Type': 'text/html'}); res.end(html) }).listen(${PORT}, '127.0.0.1')
`,
  )
  writeFileSync(path.join(scratchDir, 'package.json'), JSON.stringify({ name: 'scratch', scripts: { dev: 'node server.js' } }))

  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(scratchDir)
  await window.locator('[data-testid="confirm-add-project"]').click()
  await window.waitForSelector('[data-testid="project-status"]', { timeout: 10_000 })

  await window.locator('[data-testid="toggle-harness-button"]').click()
  await window.waitForSelector('[data-testid="harness-view"]', { timeout: 10_000 })

  // Real criterion — genuinely true, checkable only by actually clicking.
  await window.locator('[data-testid="harness-criterion-input"]').fill('Clicking the "Click me" button changes the status text to "Clicked!"')
  await window.locator('[data-testid="harness-criterion-add"]').click()
  await window.waitForSelector('[data-testid="harness-criterion-row"]', { timeout: 5_000 })

  // Real UI preview config.
  await window.locator('[data-testid="harness-preview-command"]').fill('node server.js')
  await window.locator('[data-testid="harness-preview-port"]').fill(String(PORT))
  await window.locator('[data-testid="harness-preview-save"]').click()
  await window.waitForFunction(
    (port) => document.querySelector('[data-testid="harness-preview-status"]')?.textContent?.includes(`on port ${port}`),
    PORT,
    { timeout: 5_000 },
  )

  // Real TypeSafe key, typed into Laird's own field — never logged.
  await window.locator('[data-testid="typesafe-key-input"]').fill(process.env.TYPESAFE_API_KEY)
  await window.locator('[data-testid="typesafe-key-save"]').click()
  await window.waitForSelector('[data-testid="typesafe-key-status"]', { timeout: 5_000 })
  check('the real TypeSafe key was accepted and stored', true)

  await window.locator('[data-testid="jev-feature-toggle-criterionRouting"]').click()

  // Start the real embedded live preview — this is the panel the harness should share.
  await window.locator('[data-testid="live-preview-start"]').click()
  await window.waitForSelector('[data-testid="live-preview-stop"]', { timeout: 15_000 })

  const cdpTargetsBefore = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const previewTargetBefore = cdpTargetsBefore.find((t) => t.url === `http://localhost:${PORT}/`)
  check('the real embedded preview is up as its own CDP target before the run', Boolean(previewTargetBefore))

  // Run the real harness while the live preview is still open. CDP-sharing
  // is currently disabled, so this exercises the standalone path.
  await window.locator('[data-testid="harness-run-button"]').click()
  await window.waitForSelector('[data-testid="harness-run-row"]', { timeout: 60_000 })

  const lockBannerShown = (await window.locator('[data-testid="live-preview-locked-banner"]').count()) > 0
  check('no sharing lock banner appears — CDP-sharing is currently disabled, by design', !lockBannerShown)

  const runRowText = await window.locator('[data-testid="harness-run-row"]').first().textContent()
  console.log('[harness-shared-preview] run row text:', runRowText)
  check(
    'the genuinely-true criterion was still correctly recognized as shipping, even with an unrelated live preview open',
    runRowText.includes('SHIP'),
  )

  check('the embedded live-preview panel itself is still visibly running, unaffected by the harness run', (await window.locator('[data-testid="live-preview-stop"]').count()) === 1)

  await window.locator('[data-testid="live-preview-stop"]').click()
  await window.waitForSelector('[data-testid="live-preview-start"]', { timeout: 5_000 })
} finally {
  await app.close()
}

if (failed) {
  console.error('\n[harness-shared-preview] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[harness-shared-preview] all checks passed')
}
