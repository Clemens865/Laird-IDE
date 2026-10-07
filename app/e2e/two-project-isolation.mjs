// Workstream B, chunk 5: the core trust promise from the product PRD —
// "never possible to mistake which project you're acting in" — verified for
// real, not just unit-tested with fake transports. Opens two real projects,
// sends each a distinct real prompt, and confirms both UI state and the real
// OS filesystem stayed isolated between them.
//
// Gated behind LAIRD_E2E_REAL_SESSION=1 — makes two real, billed API calls.

import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

if (process.env.LAIRD_E2E_REAL_SESSION !== '1') {
  console.log('[isolation] skipped — set LAIRD_E2E_REAL_SESSION=1 to run (makes two real billed API calls)')
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[isolation] PASS: ${name}`)
  } else {
    console.error(`[isolation] FAIL: ${name}`)
    failed = true
  }
}

async function addProject(window, projectPath) {
  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(projectPath)
  await window.locator('[data-testid="confirm-add-project"]').click()
}

// Scoped by project id — with 2+ tabs, `[data-testid="project-status"]`
// alone is ambiguous (one exists per tab, all simultaneously in the DOM).
function statusLocator(window, projectId) {
  return window.locator(`[data-project-id="${projectId}"] [data-testid="project-status"]`)
}

async function runPromptAndWaitIdle(window, projectId, prompt) {
  await window.locator('[data-testid="composer-input"]').fill(prompt)
  await window.locator('[data-testid="composer-send"]').click()
  await statusLocator(window, projectId).filter({ hasText: 'running' }).waitFor({ timeout: 10_000 })
  await statusLocator(window, projectId).filter({ hasText: 'idle' }).waitFor({ timeout: 90_000 })
}

const dirA = mkdtempSync(path.join(tmpdir(), 'laird-isolation-a-'))
const dirB = mkdtempSync(path.join(tmpdir(), 'laird-isolation-b-'))

// Isolated per run — avoids cross-contamination with other local Electron
// apps sharing dev mode's default userData dir (see hardening-kill-mid-run.mjs).
const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  await addProject(window, dirA)
  await window.waitForSelector('[data-testid="project-tab"]', { timeout: 5_000 })
  await addProject(window, dirB)
  await window.waitForFunction(() => document.querySelectorAll('[data-testid="project-tab"]').length === 2, undefined, {
    timeout: 5_000,
  })

  const tabs = window.locator('[data-testid="project-tab"]')
  const tabAId = await tabs.nth(0).getAttribute('data-project-id')
  const tabBId = await tabs.nth(1).getAttribute('data-project-id')

  // Project A: select its tab (adding B auto-selected B, so be explicit) and run a real prompt.
  await tabs.nth(0).click()
  await runPromptAndWaitIdle(window, tabAId, 'Create a file named project-a-marker.txt containing exactly: A')

  // Project B: switch tabs and run a different real prompt.
  await tabs.nth(1).click()
  await runPromptAndWaitIdle(window, tabBId, 'Create a file named project-b-marker.txt containing exactly: B')

  // Real filesystem check: each prompt's file landed only in its own project's directory.
  check("project A's file was created in project A's directory", existsSync(path.join(dirA, 'project-a-marker.txt')))
  check("project B's file was NOT created in project A's directory", !existsSync(path.join(dirA, 'project-b-marker.txt')))
  check("project B's file was created in project B's directory", existsSync(path.join(dirB, 'project-b-marker.txt')))
  check("project A's file was NOT created in project B's directory", !existsSync(path.join(dirB, 'project-a-marker.txt')))

  // UI check: project B's tab is currently selected and showing only its own chip.
  const bChipCount = await window.locator('.chip', { hasText: 'project-b-marker.txt' }).count()
  const aChipLeakedIntoB = await window.locator('.chip', { hasText: 'project-a-marker.txt' }).count()
  check("project B's activity stream shows its own file-change chip", bChipCount >= 1)
  check("project A's chip did not leak into project B's activity stream", aChipLeakedIntoB === 0)

  // Switch back to project A and confirm the reverse.
  await tabs.nth(0).click()
  await window.waitForTimeout(200)
  const aChipCount = await window.locator('.chip', { hasText: 'project-a-marker.txt' }).count()
  const bChipLeakedIntoA = await window.locator('.chip', { hasText: 'project-b-marker.txt' }).count()
  check("project A's activity stream shows its own file-change chip after switching back", aChipCount >= 1)
  check("project B's chip did not leak into project A's activity stream", bChipLeakedIntoA === 0)

  check('the two project tabs have distinct ids', tabAId !== tabBId && Boolean(tabAId) && Boolean(tabBId))
} finally {
  await app.close()
}

if (failed) {
  console.error('\n[isolation] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[isolation] all checks passed')
}
