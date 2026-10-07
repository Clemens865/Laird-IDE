// Chunk 3-4 (Workstream B) boot-smoke + real-session e2e test (Workspace-OS's
// e2e/*.mjs pattern: Playwright's _electron API against the real built app,
// hand-rolled assertions, no Jest/Mocha runner). Run via `npm run e2e`
// (builds first) or directly with `node e2e/smoke.mjs` after a `npm run build`.

import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[e2e] PASS: ${name}`)
  } else {
    console.error(`[e2e] FAIL: ${name}`)
    failed = true
  }
}

async function addProject(window, projectPath) {
  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(projectPath)
  await window.locator('[data-testid="confirm-add-project"]').click()
}

// Isolated per run — avoids cross-contamination with other local Electron
// apps sharing dev mode's default userData dir (see hardening-kill-mid-run.mjs).
const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-e2e-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  check('window title is Laird', (await window.title()) === 'Laird')
  check('app root rendered', (await window.locator('[data-testid="app-root"]').count()) === 1)

  const bridgeExists = await window.evaluate(() => typeof window.laird?.session?.ping === 'function')
  check('window.laird.session.ping is exposed', bridgeExists)

  const pingResult = await window.evaluate(() => window.laird.session.ping())
  check('ping round-trip through real IPC succeeded', pingResult?.ok === true)

  check('empty state shown with no projects yet', (await window.locator('[data-testid="empty-state"]').count()) === 1)

  // Workstream D, decorative-vs-signal rule: exactly the two known-ambient
  // layers (grain, mist) carry the structural marker — nothing that's real
  // status (there's no project yet to check project-status against, but the
  // marker's own absence from the rest of #app-root is the real assertion).
  check('exactly the grain and mist layers are marked decorative', (await window.locator('[data-decorative="true"]').count()) === 2)
  check('nothing marked decorative is also aria-visible by accident', (await window.locator('[data-decorative="true"][aria-hidden="true"]').count()) === 2)

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-e2e-'))
  // A real stack signature (chunk 5) — guarantees `detectStackSignals` finds
  // something real to propose against, deterministic regardless of this
  // machine's own global skill library.
  writeFileSync(path.join(scratchDir, 'tsconfig.json'), '{}')
  writeFileSync(path.join(scratchDir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }))
  await addProject(window, scratchDir)

  await window.waitForSelector('[data-testid="project-tab"]', { timeout: 5_000 })
  check('project tab renders with idle status initially', (await window.locator('[data-testid="project-status"]').textContent()) === 'idle')
  check(
    'real status (project-status) is never marked decorative — the decorative-vs-signal rule',
    (await window.locator('[data-testid="project-status"][data-decorative]').count()) === 0,
  )

  await window.locator('[data-testid="toggle-view-button"]').click()
  await window.waitForSelector('[data-testid="grid-view"]', { timeout: 5_000 })
  check('grid view shows the project as a card', (await window.locator('[data-testid="project-card"]').count()) === 1)

  await window.locator('[data-testid="project-card"]').click()
  check('clicking a grid card returns to tab view', (await window.locator('[data-testid="grid-view"]').count()) === 0)

  await window.locator('[data-testid="toggle-skills-button"]').click()
  await window.waitForSelector('[data-testid="skills-view"]', { timeout: 5_000 })
  // skills.list() awaits a real `claude plugin list` subprocess — wait for
  // at least one real card, not just the view's own (instant) container.
  await window.waitForSelector('[data-testid="skills-view"] [data-testid="skill-card"]', { timeout: 10_000 })
  // This machine's real global skill library (~/.claude/skills, installed
  // plugins) is the natural fixture here — proves discovery really walked
  // the real filesystem and ran the real `claude plugin list`, not a stub.
  const globalSkillCount = await window.locator('[data-testid="skills-view"] [data-testid="skill-card"]').count()
  check('skills view renders real global skills discovered from this machine', globalSkillCount > 0)

  // The real checkbox is deliberately visually hidden (opacity:0) by the
  // real v9-signature toggle-switch CSS — a real user clicks the visible
  // track/label, which the browser's native label-for-input association
  // forwards to the input; `isChecked()` still reads the real DOM state
  // regardless of visibility.
  const firstToggle = window.locator('[data-testid="skill-toggle-input"]').first()
  const firstToggleLabel = window.locator('[data-testid="skill-toggle"]').first()
  check('a global skill starts off (disabled) by default', !(await firstToggle.isChecked()))
  await firstToggleLabel.click()
  check('toggling a global skill on is reflected immediately', await firstToggle.isChecked())

  // Chunk 5: the real stack scan + recommendation IPC call, through the real bridge.
  const projectId = (await window.evaluate(() => window.laird.project.list())).at(-1).id
  const recommendResult = await window.evaluate((id) => window.laird.skills.recommend({ projectId: id }), projectId)
  check('a brand-new project with no sessions yet is reported as first run', recommendResult.isFirstRun === true)
  check(
    'the real stack scan detected typescript, react, and node from the real fixture files',
    ['typescript', 'react', 'node'].every((tag) => recommendResult.signals.includes(tag)),
  )

  if (recommendResult.recommended.length > 0) {
    // Opportunistic — depends on whether any of this machine's own real
    // global skills happen to mention typescript/react/node, same policy as
    // the "real global skills" check above.
    await window.waitForSelector('[data-testid="suggested-skills"]', { timeout: 5_000 })
    const suggestedCount = await window.locator('[data-testid="suggested-skill-row"]').count()
    check('the suggested-skills banner lists exactly the recommended skills', suggestedCount === recommendResult.recommended.length)

    await window.locator('[data-testid="suggested-skills-apply"]').click()
    await window.waitForFunction(
      () => document.querySelector('[data-testid="suggested-skills"]') === null,
      undefined,
      { timeout: 3_000 },
    )
    check('applying suggestions dismisses the banner', true)

    const firstRecommendedId = recommendResult.recommended[0].id
    const appliedToggle = window.locator(`[data-skill-id="${firstRecommendedId}"] [data-testid="skill-toggle-input"]`)
    check('the applied suggestion shows as enabled in the main global-skills list', await appliedToggle.isChecked())
  } else {
    console.log('[e2e] skipping suggested-skills UI check — no real global skill on this machine matched typescript/react/node')
  }

  // "Create a new skill" — a real guided form writing a real Claude Code
  // skill file (not a Laird-specific format), per docs/prd/technical/
  // skills-and-plugins.md. Name chosen to be unique across repeated runs.
  const skillName = `e2e-ship-checklist-${Date.now()}`
  const skillDescription = 'Use before marking any e2e task done: walks through the pre-ship checklist.'
  await window.locator('[data-testid="new-skill-button"]').click()
  await window.locator('[data-testid="create-skill-name"]').fill(skillName)
  await window.locator('[data-testid="create-skill-description"]').fill(skillDescription)
  await window.locator('[data-testid="create-skill-body"]').fill('1. Run tests.\n2. Confirm the build.')
  await window.locator('[data-testid="create-skill-submit"]').click()
  await window.waitForFunction(
    () => document.querySelector('[data-testid="create-skill-form"]') === null,
    undefined,
    { timeout: 5_000 },
  )
  check('creating a skill closes the form on success', true)

  const createdCard = window.locator(`[data-testid="skill-card"][data-skill-id*="${skillName}"]`)
  check("the newly created skill appears in \"This project's skills\"", (await createdCard.count()) === 1)

  const skillFilePath = path.join(scratchDir, '.claude', 'skills', skillName, 'SKILL.md')
  check('a real SKILL.md was written to disk at the real project path', existsSync(skillFilePath))
  const skillFileContent = existsSync(skillFilePath) ? readFileSync(skillFilePath, 'utf8') : ''
  check(
    'the real file contains the real name and description',
    skillFileContent.includes(`name: ${skillName}`) && skillFileContent.includes(skillDescription),
  )

  // Duplicate-name rejection, through the real form, surfaced as a real inline error from the main process.
  await window.locator('[data-testid="new-skill-button"]').click()
  await window.locator('[data-testid="create-skill-name"]').fill(skillName)
  await window.locator('[data-testid="create-skill-description"]').fill('dup')
  await window.locator('[data-testid="create-skill-submit"]').click()
  await window.waitForSelector('[data-testid="create-skill-error"]', { timeout: 5_000 })
  check('creating a duplicate-named skill surfaces a real inline error from the main process', true)
  await window.locator('[data-testid="create-skill-cancel"]').click()

  await window.locator('[data-testid="toggle-skills-button"]').click()
  check('clicking Skills & agents again returns to tab view', (await window.locator('[data-testid="skills-view"]').count()) === 0)

  // Workstream F: the second theme — proves the token contract actually
  // decouples visuals from logic, not just that the attribute flips.
  const bgBefore = await window.locator('[data-testid="app-root"]').evaluate((el) => getComputedStyle(el.parentElement ?? el).backgroundColor)
  await window.locator('[data-testid="theme-toggle-button"]').click()
  await window.waitForFunction(() => document.documentElement.dataset.theme === 'midnight', undefined, { timeout: 3_000 })
  check('toggling the theme sets the real data-theme attribute', true)
  const topbarBg = await window.locator('.topbar').evaluate((el) => getComputedStyle(el).backgroundColor)
  check('a real computed style actually changed under the dark theme, not just the attribute', topbarBg !== bgBefore)
  await window.locator('[data-testid="theme-toggle-button"]').click()
  await window.waitForFunction(() => document.documentElement.dataset.theme !== 'midnight', undefined, { timeout: 3_000 })
  check('toggling back restores the default theme', true)

  // Gated behind an explicit opt-in: makes a real, billed `claude` API call.
  // Not run by default (cost + flakiness), per the approved Foundation plan.
  if (process.env.LAIRD_E2E_REAL_SESSION === '1') {
    await window.locator('[data-testid="composer-input"]').fill(
      'Create a file named chunk4.txt containing exactly this text with no trailing newline: chunk 4 works',
    )
    await window.locator('[data-testid="composer-send"]').click()

    await window.waitForFunction(
      () => document.querySelector('[data-testid="project-status"]')?.textContent === 'running',
      undefined,
      { timeout: 10_000 },
    )
    check('session status shows running while the session is active', true)

    await window.waitForFunction(
      () => document.querySelector('[data-testid="project-status"]')?.textContent === 'idle',
      undefined,
      { timeout: 90_000 },
    )

    const fileOk =
      existsSync(path.join(scratchDir, 'chunk4.txt')) &&
      readFileSync(path.join(scratchDir, 'chunk4.txt'), 'utf8').trim() === 'chunk 4 works'
    check('a real prompt typed in the v9 UI produced the expected real file', fileOk)

    // Not necessarily the first `.chip` — a generic ToolCallChip (e.g. an
    // exploratory Read/Glob before the real Write) also uses class "chip",
    // showing a tool name instead of a path. Find the one with our filename.
    const fileChipCount = await window.locator('.chip', { hasText: 'chunk4.txt' }).count()
    check('a real file-change chip rendered with the real filename', fileChipCount >= 1)

    const costText = await window.locator('[data-testid="cost-footer"] .mono').first().textContent()
    check('the cost footer rendered a real, non-zero cost', /¤0\.0[1-9]/.test(costText ?? '') || /¤0\.[1-9]/.test(costText ?? ''))

    // Workstream D: the always-visible action log, pushed live from the
    // real ActivityLogEntry writes a real session actually produced.
    await window.waitForSelector('[data-testid="action-log"]', { timeout: 5_000 })
    const actionLogRowCount = await window.locator('[data-testid="action-log-row"]').count()
    check('the action log rendered real entries from the real session', actionLogRowCount > 0)
    const actionLogText = await window.locator('[data-testid="action-log"]').textContent()
    check(
      'the action log is in plain language, not a raw payload dump',
      (actionLogText ?? '').includes('Used Write') || (actionLogText ?? '').includes('Turn finished'),
    )

    // Workstream D: per-project session history — the real, just-completed
    // session should now show up with its real cost/outcome, not a stub.
    await window.locator('[data-testid="toggle-history-button"]').click()
    await window.waitForSelector('[data-testid="history-view"]', { timeout: 5_000 })
    await window.waitForSelector('[data-testid="history-row"]', { timeout: 5_000 })
    const historyRowCount = await window.locator('[data-testid="history-row"]').count()
    check('the completed real session appears in the project\'s history', historyRowCount === 1)
    const historyRowText = await window.locator('[data-testid="history-row"]').first().textContent()
    check('the history row shows the real prompt text', (historyRowText ?? '').includes('chunk4.txt'))
    check('the history row shows a real non-zero cost', /¤0\.0[1-9]/.test(historyRowText ?? '') || /¤0\.[1-9]/.test(historyRowText ?? ''))
    const historyStatus = await window.locator('[data-testid="history-row-status"]').first().textContent()
    check('the history row shows the real completed outcome', historyStatus === 'completed')
    await window.locator('[data-testid="toggle-history-button"]').click()

    // The plan's own bar for "create skill": verified by having Claude Code
    // itself report the skill, not just by Laird's own UI showing it. This
    // session runs in a brand-new worktree (chunk-4's own live finding: a
    // bare `git worktree add` only checks out HEAD) — the skill created a
    // few steps above was never committed, so this also proves the
    // materializeSkills broadening actually works for real, not just in a
    // unit test.
    await window.locator('[data-testid="composer-input"]').fill(
      `Do you have access to a skill named "${skillName}"? If yes, reply with exactly its description and nothing else. If no, reply with exactly: NO ACCESS`,
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
    const skillCheckText = await window.locator('.turn-body').last().textContent()
    check(
      'a real session in a fresh, uncommitted-skill-aware worktree confirmed real access and quoted the real description',
      (skillCheckText ?? '').includes(skillDescription),
    )
  } else {
    console.log('[e2e] skipping real-session check (set LAIRD_E2E_REAL_SESSION=1 to run it — makes a real billed API call)')
  }
} finally {
  await app.close()
}

if (failed) {
  console.error('\n[e2e] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[e2e] all checks passed')
}
