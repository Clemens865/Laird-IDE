// Workstream G chunk 3 verification — the real, billed visual-evidence
// path: a real dev server, a real fresh-context `claude -p` reviewer given
// real Playwright MCP browser tools, genuinely navigating and clicking a
// real page (not a static screenshot). Calls `runReviewer` directly,
// bypassing Electron/UI — the thing this chunk needs verified for real is
// the main-process wiring (dev-server lifecycle + real browser tool use),
// not React rendering, same rationale as e2e/subagent-live-status.ts.
//
// Gated behind LAIRD_E2E_REAL_SESSION=1 — makes a real billed API call and
// a real `npx @playwright/mcp@latest` invocation. The Jev *routing* call
// itself is faked (no real TypeSafe key exists in this environment) —
// only the genuinely new mechanism this chunk adds (real browser-driven
// reviewing) is exercised for real. Run with:
//   LAIRD_E2E_REAL_SESSION=1 npx tsx e2e/harness-ui-reviewer.ts

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReviewer } from '../src/main/harness/reviewer'
import { waitForPort } from '../src/main/harness/devServer'
import type { Project } from '../src/shared/types'

if (process.env.LAIRD_E2E_REAL_SESSION !== '1') {
  console.log('[harness-ui-reviewer] skipped — set LAIRD_E2E_REAL_SESSION=1 to run (makes a real billed API call + real npx playwright/mcp)')
  process.exit(0)
}

let failed = false
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`[harness-ui-reviewer] PASS: ${name}`)
  } else {
    console.error(`[harness-ui-reviewer] FAIL: ${name}`)
    failed = true
  }
}

const PORT = 48174
const projectPath = mkdtempSync(join(tmpdir(), 'laird-ui-reviewer-e2e-'))
writeFileSync(
  join(projectPath, 'server.js'),
  `const http = require('http')
const html = '<!doctype html><html><body><h1 id="status">Not clicked</h1><button id="btn" onclick="document.getElementById(\\'status\\').textContent = \\'Clicked!\\'">Click me</button></body></html>'
http.createServer((req, res) => { res.writeHead(200, {'Content-Type': 'text/html'}); res.end(html) }).listen(${PORT}, '127.0.0.1')
`,
)
writeFileSync(join(projectPath, 'package.json'), JSON.stringify({ name: 'scratch-ui', scripts: { dev: 'node server.js' } }))

const trueCriterion = 'Clicking the "Click me" button changes the status text to "Clicked!"'
const falseCriterion = 'Clicking the "Click me" button changes the status text to "Goodbye!"'

const project: Project = {
  id: 'p1',
  name: 'UI reviewer check',
  path: projectPath,
  colorToken: '#D97757',
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  enabledGlobalSkillIds: [],
  permissionTier: 'write',
  approvalMode: 'auto',
  autonomyRevoked: false,
  harnessCriteria: [trueCriterion, falseCriterion],
  uiPreview: { command: 'node server.js', port: PORT },
  testCommand: undefined,
  jevGuardEnabled: false,
  jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
}

// Fakes ONLY the Jev routing call (no real TypeSafe key exists in this
// environment) — routes both criteria to ui_interaction so the real
// browser-driven reviewer pass actually runs. Everything downstream
// (the dev server, the real `claude -p` call, the real Playwright MCP
// browser) is 100% real, nothing else mocked.
const fakeFetch = (async () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ answers: { c0: { type: 'choice', choice: 'ui_interaction' }, c1: { type: 'choice', choice: 'ui_interaction' } } }),
    text: async () => '',
  }) as unknown as Response) as unknown as typeof fetch

const run = await runReviewer(project, { jevApiKey: 'fake-not-a-real-key', fetchFn: fakeFetch })

console.log('[harness-ui-reviewer] full run:', JSON.stringify(run, null, 2))

check('both criteria got a real result, not the honest "no preview configured" placeholder', run.perCriterionResult.length === 2)
check(
  'neither result is the "no UI preview configured" fallback — a real attempt was genuinely made',
  run.perCriterionResult.every((r) => !r.rationale.includes('no UI preview command is configured')),
)

const trueResult = run.perCriterionResult.find((r) => r.criterion === trueCriterion)!
const falseResult = run.perCriterionResult.find((r) => r.criterion === falseCriterion)!

check('the genuinely-true criterion was recognized as shipping', trueResult.disposition === 'ship')
check('the genuinely-false criterion was NOT falsely reported as shipping', falseResult.disposition !== 'ship')

// devServer.stop() sends SIGTERM and returns without waiting for the real
// OS process to actually finish exiting — the same grace period the unit
// tests give it (devServer.test.ts) before checking the port is free.
await new Promise((resolve) => setTimeout(resolve, 1_000))
const stillUp = await waitForPort(PORT, { timeoutMs: 1_000, intervalMs: 200 })
check('the real dev server was torn down after the run — no orphaned process left listening', !stillUp)

if (failed) {
  console.error('\n[harness-ui-reviewer] one or more checks failed')
  process.exit(1)
} else {
  console.log('\n[harness-ui-reviewer] all checks passed')
}
