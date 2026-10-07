// Embedded live-preview panel verification (observability-trust-and-
// harness.md's "embedded, live, user-interactive PiP window," user-directed
// follow-up 2026-10-07) — free, no real `claude` CLI call: a real dev
// server, a real embedded `WebContentsView`, and the real
// `--remote-debugging-port` CDP exposure the harness's own browser-driven
// reviewer pass will later share. Run via `node e2e/preview-panel.mjs`
// after `npm run build`.
//
// DOM-level checks alone can't see the embedded native view at all (it's a
// separate compositor layer) — a real OS-level screenshot was used during
// manual verification to actually confirm pixels render; this file instead
// verifies the real, checkable side effects: the real dev server comes up,
// the real CDP endpoint lists it as its own target, and it's genuinely torn
// down on stop.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const CDP_PORT = 9335
const PORT = 48178

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[preview-panel-e2e] PASS: ${name}`)
  } else {
    console.error(`[preview-panel-e2e] FAIL: ${name}`)
    failed = true
  }
}

async function portIsOpen(port) {
  try {
    await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) })
    return true
  } catch {
    return false
  }
}

const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-preview-panel-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-preview-panel-e2e-project-'))
  writeFileSync(
    path.join(scratchDir, 'server.js'),
    `require('http').createServer((req, res) => { res.writeHead(200); res.end('ok') }).listen(${PORT}, '127.0.0.1')`,
  )
  writeFileSync(path.join(scratchDir, 'package.json'), JSON.stringify({ name: 'scratch', scripts: { dev: 'node server.js' } }))

  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(scratchDir)
  await window.locator('[data-testid="confirm-add-project"]').click()
  await window.waitForSelector('[data-testid="project-status"]', { timeout: 10_000 })

  await window.locator('[data-testid="toggle-harness-button"]').click()
  await window.waitForSelector('[data-testid="harness-view"]', { timeout: 10_000 })

  check(
    'the live preview panel shows "not configured" before a UI preview command exists',
    (await window.locator('[data-testid="live-preview-not-configured"]').count()) === 1,
  )

  await window.locator('[data-testid="harness-preview-command"]').fill('node server.js')
  await window.locator('[data-testid="harness-preview-port"]').fill(String(PORT))
  await window.locator('[data-testid="harness-preview-save"]').click()
  await window.waitForFunction(
    (port) => document.querySelector('[data-testid="harness-preview-status"]')?.textContent?.includes(`on port ${port}`),
    PORT,
    { timeout: 5_000 },
  )

  check('nothing was started just by confirming the preview command', !(await portIsOpen(PORT)))

  await window.locator('[data-testid="live-preview-start"]').click()
  await window.waitForSelector('[data-testid="live-preview-stop"]', { timeout: 15_000 })

  check('the real dev server actually started listening', await portIsOpen(PORT))

  const cdpTargets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  check(
    'the embedded preview page is a real, independent CDP target — the harness can later drive the exact same visible panel',
    cdpTargets.some((t) => t.url === `http://localhost:${PORT}/`),
  )

  await window.locator('[data-testid="live-preview-stop"]').click()
  await window.waitForSelector('[data-testid="live-preview-start"]', { timeout: 5_000 })
  await new Promise((r) => setTimeout(r, 1_000))

  check('the real dev server was torn down on stop — no orphaned process left listening', !(await portIsOpen(PORT)))
} finally {
  await app.close()
}

if (failed) {
  console.error('\n[preview-panel-e2e] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[preview-panel-e2e] all checks passed')
}
