import { randomUUID } from 'node:crypto'
import type { spawn } from 'node:child_process'
import { ClaudeHeadlessTransport } from '../session/claudeHeadlessTransport'
import { classifyCriterionCheckMethod, flagShortcutRationales } from './jev'
import { runTestCommand, testRunToCriterionResult } from './testRunner'
import { startDevServer, waitForPort } from './devServer'
import { replayScript, type RecordedAssertion, type RecordedScript, type RecordedStep } from './recordedScript'
import type { EvidenceTier, HarnessCriterionResult, HarnessDisposition, HarnessRun, Project } from '../../shared/types'

/**
 * The real, official Playwright MCP server — confirmed live during the
 * PRD's own research pass to give a headless `claude -p` session genuine
 * interactive browser tools (navigate/click/type/screenshot), not just a
 * static image. Specified explicitly here rather than depending on whatever
 * plugins happen to be installed on a given machine — same "explicit, never
 * ambient" discipline as everything else this transport configures.
 *
 * `cdpEndpoint`, when provided, points the MCP server at an already-running
 * browser target over Chrome DevTools Protocol instead of letting it launch
 * its own — the embedded live-preview panel's own page
 * (`previewPanel.ts`/`cdpTarget.ts`), so the harness drives the exact
 * surface the user is already watching rather than a second, invisible
 * browser.
 */
function playwrightMcpServers(cdpEndpoint?: string): Record<string, unknown> {
  return {
    playwright: {
      command: 'npx',
      args: cdpEndpoint ? ['@playwright/mcp@latest', '--cdp-endpoint', cdpEndpoint] : ['@playwright/mcp@latest'],
    },
  }
}
/** Read-only + the Playwright MCP tools — still a checker, never a fixer, just like the ordinary `read`-tier reviewer. */
const UI_REVIEWER_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'mcp__playwright__*']
const DEV_SERVER_READY_TIMEOUT_MS = 20_000

/**
 * "The reviewer must be a different model than the builder, at minimum a
 * different size" (observability-trust-and-harness.md) — Laird's own
 * builder sessions have no model picker yet and fall through to
 * `ClaudeHeadlessTransport`'s own default (haiku, chosen for routine-task
 * cost), so the reviewer explicitly uses a larger model rather than
 * silently defaulting to the same one and losing the "independent judge"
 * property entirely. A hardcoded v1 default, not a settings UI — exactly
 * the still-open product decision the PRD names, deliberately not resolved
 * here beyond "pick something sensible and be explicit about it."
 */
const REVIEWER_MODEL = 'claude-sonnet-5'

const DISPOSITION_RANK: Record<HarnessDisposition, number> = {
  ship: 0,
  unverifiable: 1,
  hold: 2,
  rework: 3,
}

const VALID_DISPOSITIONS = new Set<HarnessDisposition>(['ship', 'hold', 'rework', 'unverifiable'])
const VALID_EVIDENCE_TIERS = new Set<EvidenceTier>(['VERIFIED', 'CORROBORATED', 'UNCORROBORATED', 'INFERENCE', 'STATED'])
const WEAK_EVIDENCE_TIERS = new Set<EvidenceTier>(['UNCORROBORATED', 'INFERENCE', 'STATED'])

function buildReviewerPrompt(criteria: string[]): string {
  const numbered = criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
  return `You are a fresh, independent reviewer. You have no prior conversation or context about how this project was built — you may only use your Read/Glob/Grep tools to inspect the real, current state of the project at this working directory. You never fix, edit, or suggest edits — you only check and report.

Check each numbered acceptance criterion below against what you actually find in the real codebase. For each one, decide exactly one disposition:
- "ship": the codebase genuinely satisfies this criterion as written, and you found real evidence of it.
- "hold": partially met, or a minor issue remains.
- "rework": clearly not met.
- "unverifiable": the criterion is too ambiguous as written, or nothing you can inspect with Read/Glob/Grep lets you check it (e.g. it requires actually running or visually inspecting a live UI, which you cannot do).

For each one also give an evidenceTier — exactly one of:
- "VERIFIED": you directly read the exact file(s)/code that prove this.
- "CORROBORATED": you found real supporting evidence, but not a complete direct proof.
- "UNCORROBORATED": you looked, but found no real evidence either way.
- "INFERENCE": you are guessing from indirect signals (e.g. a plausible-sounding file name you didn't open).
- "STATED": you have no way to check this at all.

Never guess a "ship"/"hold"/"rework" disposition without real Read/Glob/Grep evidence backing it — if you didn't actually check, the disposition must be "unverifiable" and the evidenceTier must be "STATED" or "UNCORROBORATED", not a confident-sounding guess.

Criteria:
${numbered}

Respond with ONLY a single JSON object and nothing else — no markdown code fences, no prose before or after — in exactly this shape:
{"results":[{"criterion":"<the exact criterion text, verbatim>","disposition":"ship|hold|rework|unverifiable","evidenceTier":"VERIFIED|CORROBORATED|UNCORROBORATED|INFERENCE|STATED","rationale":"<one or two plain-language sentences, citing the real file path(s) you checked if any>"}]}`
}

function buildUiReviewerPrompt(criteria: string[], url: string, opts: { sharedBrowser?: boolean } = {}): string {
  const numbered = criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
  const sharedBrowserPreamble = opts.sharedBrowser
    ? `IMPORTANT — you are connected to a shared browser that may have other, unrelated tabs open (including the host application's own UI), not just the one you need. Before doing anything else, call the tab-listing tool to see every open tab, find the one whose URL is exactly ${url}, and select it. Never create a new tab, and never interact with any tab other than the one at this exact URL. If you cannot find a tab at exactly that URL, stop — do not guess from any other tab — and report every criterion below as disposition "unverifiable" with evidenceTier "STATED", explaining that the expected tab wasn't found.\n\n`
    : ''
  return `${sharedBrowserPreamble}You are a fresh, independent reviewer checking a real, running web UI. You have no prior conversation or context about how this project was built. You have browser tools (navigate, click, type, read page state, take a screenshot) — use them to actually visit and interact with the real page at ${url}. You never fix, edit, or suggest edits — you only check and report.

Check each numbered acceptance criterion below against what you actually see or do in the real running UI. For each one, decide exactly one disposition:
- "ship": you directly navigated to/interacted with the real UI and it genuinely satisfies this criterion.
- "hold": partially met, or a minor issue remains.
- "rework": clearly not met.
- "unverifiable": the criterion is too ambiguous as written, or your browser tools genuinely can't check it.

For each one also give an evidenceTier — exactly one of "VERIFIED" (you directly navigated/interacted and saw the real result), "CORROBORATED" (strong supporting evidence, not a complete direct check), "UNCORROBORATED" (you looked but found no real evidence either way), "INFERENCE" (guessing from indirect signals), "STATED" (no way to check at all). Never claim VERIFIED without genuinely using your browser tools to look — if you didn't actually navigate and look, say so honestly rather than guessing.

Criteria:
${numbered}

In your rationale, briefly describe what you actually did (e.g. "navigated to /signup, clicked Submit, saw a validation error") so a human can tell you genuinely checked rather than guessed.

If you reach "ship" or "hold" based on genuine, direct interaction (evidenceTier "VERIFIED" or "CORROBORATED"), you may ALSO include a "recording" field on that result describing the exact real steps you took, so this exact check can be replayed later by a plain script with no AI at all:
{"steps":[{"action":"click","locator":{"kind":"role","role":"button","name":"<the exact accessible name you used>"}}],"assertions":[{"kind":"containsText","expected":"<exact text now visible on the page that proves this>"}]}
Only include "recording" if you're confident the steps/assertions alone, with no AI judgment, would reliably reproduce this exact result — omit it entirely otherwise, there's no penalty for leaving it out. A locator's "kind" must be exactly one of "role" (role + the element's accessible name — only for an interactive element whose name does NOT itself change as a result of your actions, like a button's label), "text" (visible static text), or "testId" (only if you saw a real data-testid attribute). A step's "action" is "click" or "fill" (fill also needs a "value"). An assertion's "kind" is "containsText" or "notContainsText", and it's about the page's overall visible text, not one specific element — the one element whose text changed is usually also the one you can no longer reliably re-find by name.

Respond with ONLY a single JSON object and nothing else — no markdown code fences, no prose before or after — in exactly this shape:
{"results":[{"criterion":"<the exact criterion text, verbatim>","disposition":"ship|hold|rework|unverifiable","evidenceTier":"VERIFIED|CORROBORATED|UNCORROBORATED|INFERENCE|STATED","rationale":"<what you actually did and saw, plain language>","recording":{"steps":[...],"assertions":[...]}}]}`
}

/**
 * Defensive, never-throwing parse — matches "no silent correction": if the
 * reviewer's output doesn't parse or validate, every criterion falls back to
 * an honest `unverifiable`/`STATED` result explaining why, rather than
 * crashing the whole harness run or fabricating a confident-looking verdict
 * from garbage.
 */
function parseReviewerOutput(rawText: string, criteria: string[]): HarnessCriterionResult[] {
  const fallback = (reason: string): HarnessCriterionResult[] =>
    criteria.map((criterion) => ({ criterion, disposition: 'unverifiable', evidenceTier: 'STATED', rationale: reason }))

  const match = rawText.match(/\{[\s\S]*\}/)
  if (!match) return fallback('The reviewer’s response did not contain a parseable result.')

  let parsed: { results?: unknown }
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return fallback('The reviewer’s response was not valid JSON.')
  }

  if (!Array.isArray(parsed.results)) return fallback('The reviewer’s response had no results array.')

  const byCriterion = new Map<string, HarnessCriterionResult>()
  for (const entry of parsed.results as Array<Record<string, unknown>>) {
    const criterion = typeof entry.criterion === 'string' ? entry.criterion : null
    const disposition = entry.disposition as HarnessDisposition
    const evidenceTier = entry.evidenceTier as EvidenceTier
    if (!criterion || !VALID_DISPOSITIONS.has(disposition) || !VALID_EVIDENCE_TIERS.has(evidenceTier)) continue
    byCriterion.set(criterion, {
      criterion,
      disposition,
      evidenceTier,
      rationale: typeof entry.rationale === 'string' ? entry.rationale : '',
    })
  }

  // Matched by exact criterion text; any criterion the reviewer skipped or
  // mangled still gets an honest, explicit result rather than going missing.
  return criteria.map(
    (criterion) =>
      byCriterion.get(criterion) ?? {
        criterion,
        disposition: 'unverifiable',
        evidenceTier: 'STATED',
        rationale: 'The reviewer did not return a usable result for this criterion.',
      },
  )
}

const VALID_LOCATOR_KINDS = new Set(['role', 'text', 'testId'])
const VALID_STEP_ACTIONS = new Set(['click', 'fill'])
const VALID_ASSERTION_KINDS = new Set(['containsText', 'notContainsText'])

/**
 * Structural-only validation — a syntactically-valid-but-semantically-wrong
 * recording isn't dangerous on its own (a real `replayScript` attempt would
 * just fail and fall back honestly), so this only guards against malformed
 * shapes that would throw at replay time, not against bad locators/values.
 */
function parseRecordedSteps(raw: unknown): RecordedStep[] | null {
  if (!Array.isArray(raw)) return null
  const steps: RecordedStep[] = []
  for (const entry of raw as Array<Record<string, unknown>>) {
    const locator = entry.locator as Record<string, unknown> | undefined
    if (!locator || typeof locator.kind !== 'string' || !VALID_LOCATOR_KINDS.has(locator.kind)) return null
    if (locator.kind === 'role' && (typeof locator.role !== 'string' || typeof locator.name !== 'string')) return null
    if (locator.kind === 'text' && typeof locator.text !== 'string') return null
    if (locator.kind === 'testId' && typeof locator.testId !== 'string') return null
    if (typeof entry.action !== 'string' || !VALID_STEP_ACTIONS.has(entry.action)) return null
    if (entry.action === 'fill' && typeof entry.value !== 'string') return null
    steps.push(entry as unknown as RecordedStep)
  }
  return steps
}

function parseRecordedAssertions(raw: unknown): RecordedAssertion[] | null {
  if (!Array.isArray(raw)) return null
  const assertions: RecordedAssertion[] = []
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (typeof entry.kind !== 'string' || !VALID_ASSERTION_KINDS.has(entry.kind)) return null
    if (typeof entry.expected !== 'string') return null
    assertions.push(entry as unknown as RecordedAssertion)
  }
  return assertions
}

/**
 * Same defensive JSON extraction as `parseReviewerOutput`, plus an
 * optional, separately-validated `recording` per result — kept as its own
 * side channel (not part of `HarnessCriterionResult`, which stays a pure,
 * renderer-visible result) so a malformed recording never affects the
 * real disposition/evidenceTier/rationale a human sees.
 */
function parseUiReviewerOutput(
  rawText: string,
  criteria: string[],
): { results: HarnessCriterionResult[]; recordings: Map<string, { steps: RecordedStep[]; assertions: RecordedAssertion[] }> } {
  const recordings = new Map<string, { steps: RecordedStep[]; assertions: RecordedAssertion[] }>()
  const results = parseReviewerOutput(rawText, criteria)

  const match = rawText.match(/\{[\s\S]*\}/)
  if (!match) return { results, recordings }
  let parsed: { results?: Array<Record<string, unknown>> }
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return { results, recordings }
  }
  if (!Array.isArray(parsed.results)) return { results, recordings }

  for (const entry of parsed.results) {
    const criterion = typeof entry.criterion === 'string' ? entry.criterion : null
    const recording = entry.recording as Record<string, unknown> | undefined
    if (!criterion || !recording) continue
    const steps = parseRecordedSteps(recording.steps)
    const assertions = parseRecordedAssertions(recording.assertions)
    if (steps && assertions) recordings.set(criterion, { steps, assertions })
  }

  return { results, recordings }
}

function canceledResults(criteria: string[]): HarnessCriterionResult[] {
  return criteria.map((criterion) => ({
    criterion,
    disposition: 'unverifiable',
    evidenceTier: 'STATED',
    rationale: 'Canceled by the user before this criterion was checked.',
  }))
}

/** Matches `canceledResults`'s own honest-fallback shape — a budget limit is as real a reason to stop as a user cancellation, never silently worked around. */
function costCeilingResults(criteria: string[], ceilingUsd: number): HarnessCriterionResult[] {
  return criteria.map((criterion) => ({
    criterion,
    disposition: 'unverifiable',
    evidenceTier: 'STATED',
    rationale: `Skipped — this project's harness cost ceiling (¤${ceilingUsd.toFixed(2)}) was reached before this criterion could be checked.`,
  }))
}

function worstCaseDisposition(results: HarnessCriterionResult[]): HarnessDisposition {
  if (results.length === 0) return 'unverifiable'
  return results.reduce<HarnessDisposition>(
    (worst, r) => (DISPOSITION_RANK[r.disposition] > DISPOSITION_RANK[worst] ? r.disposition : worst),
    'ship',
  )
}

/**
 * One real, fresh-context `claude -p` reviewer invocation over a given set
 * of criteria — the shared core of both the first pass and adaptive
 * re-checks. `signal`, when aborted (the user canceling the in-flight
 * harness run), kills the real `claude` process via the same `stop()`
 * mechanism the kill switch already uses, rather than leaving it running
 * unobserved.
 */
async function runReviewerPass(
  project: Project,
  criteria: string[],
  opts: { spawnFn?: typeof spawn; signal?: AbortSignal; onCost?: (costUsd: number) => void },
): Promise<HarnessCriterionResult[]> {
  if (opts.signal?.aborted) return canceledResults(criteria)

  const transport = new ClaudeHeadlessTransport({ permissionTier: 'read', spawnFn: opts.spawnFn })
  const onAbort = () => transport.stop()
  opts.signal?.addEventListener('abort', onAbort)

  let fullText = ''
  transport.onEvent((e) => {
    if (e.kind === 'text') fullText += (e.payload as { text: string }).text
    if (e.kind === 'usage') {
      const costUsd = (e.payload as { costUsd?: unknown }).costUsd
      if (typeof costUsd === 'number') opts.onCost?.(costUsd)
    }
  })

  const exitInfo = await new Promise<{ code: number | null; failure?: { kind: string; message: string } }>((resolve) => {
    transport.onExit(resolve)
    transport.start({ cwd: project.path, prompt: buildReviewerPrompt(criteria), model: REVIEWER_MODEL })
  })
  opts.signal?.removeEventListener('abort', onAbort)

  if (opts.signal?.aborted) return canceledResults(criteria)

  return exitInfo.failure
    ? criteria.map((criterion) => ({
        criterion,
        disposition: 'unverifiable' as const,
        evidenceTier: 'STATED' as const,
        rationale: `The reviewer run failed before reporting a result: ${exitInfo.failure!.message}`,
      }))
    : parseReviewerOutput(fullText, criteria)
}

type UiReviewResult = { results: HarnessCriterionResult[]; recordings: Map<string, { steps: RecordedStep[]; assertions: RecordedAssertion[] }> }

/** The shared transport/prompt/parse core behind both the harness's own ephemeral browser and a shared embedded-panel one. */
async function runBrowserReviewerPass(
  project: Project,
  criteria: string[],
  url: string,
  mcpServers: Record<string, unknown>,
  opts: { spawnFn?: typeof spawn; signal?: AbortSignal; sharedBrowser?: boolean; onCost?: (costUsd: number) => void },
): Promise<UiReviewResult> {
  const transport = new ClaudeHeadlessTransport({
    spawnFn: opts.spawnFn,
    allowedToolsOverride: UI_REVIEWER_ALLOWED_TOOLS,
    mcpServers,
  })
  const onAbort = () => transport.stop()
  opts.signal?.addEventListener('abort', onAbort)

  let fullText = ''
  transport.onEvent((e) => {
    if (e.kind === 'text') fullText += (e.payload as { text: string }).text
    if (e.kind === 'usage') {
      const costUsd = (e.payload as { costUsd?: unknown }).costUsd
      if (typeof costUsd === 'number') opts.onCost?.(costUsd)
    }
  })

  const exitInfo = await new Promise<{ code: number | null; failure?: { kind: string; message: string } }>((resolve) => {
    transport.onExit(resolve)
    transport.start({
      cwd: project.path,
      prompt: buildUiReviewerPrompt(criteria, url, { sharedBrowser: opts.sharedBrowser }),
      model: REVIEWER_MODEL,
    })
  })
  opts.signal?.removeEventListener('abort', onAbort)

  if (opts.signal?.aborted) return { results: canceledResults(criteria), recordings: new Map() }

  if (exitInfo.failure) {
    return {
      results: criteria.map((criterion) => ({
        criterion,
        disposition: 'unverifiable' as const,
        evidenceTier: 'STATED' as const,
        rationale: `The UI reviewer run failed before reporting a result: ${exitInfo.failure!.message}`,
      })),
      recordings: new Map(),
    }
  }

  return parseUiReviewerOutput(fullText, criteria)
}

interface UiCriteriaOpts {
  spawnFn?: typeof spawn
  signal?: AbortSignal
  /** Reports each real reviewer call's `total_cost_usd` — see `runReviewer`'s own cost-ceiling accumulator. Never fires for a free replayed script. */
  onCost?: (costUsd: number) => void
  /** Record-once, replay-deterministic (observability-trust-and-harness.md's own research): a saved script from a past successful check, keyed by this exact criterion — see `recordedScript.ts`. All three injected by `index.ts`, kept out of this module to stay store-free and unit-testable. */
  getRecordedScript?: (criterion: string) => RecordedScript | undefined
  saveRecordedScript?: (criterion: string, script: RecordedScript) => void
  clearRecordedScript?: (criterion: string) => void
  /** Injectable for tests — never launches a real browser in the unit suite. */
  replayScriptFn?: typeof replayScript
}

/**
 * Replay-first: any criterion with an already-recorded, still-working
 * script is checked for free with no LLM at all, by actually replaying
 * the real steps against the real current page. Only criteria lacking a
 * script — or whose script just broke, a genuine sign the UI changed
 * shape — go to the real browser-driven reviewer; a fresh, confident
 * result that includes a `recording` is saved for next time.
 */
async function checkUiCriteriaAgainstUrl(
  project: Project,
  criteria: string[],
  url: string,
  mcpServers: Record<string, unknown>,
  opts: UiCriteriaOpts & { sharedBrowser?: boolean },
): Promise<HarnessCriterionResult[]> {
  const replay = opts.replayScriptFn ?? replayScript
  const resultByCriterion = new Map<string, HarnessCriterionResult>()
  const needsLlm: string[] = []

  for (const criterion of criteria) {
    const script = opts.getRecordedScript?.(criterion)
    if (!script) {
      needsLlm.push(criterion)
      continue
    }
    const replayed = await replay({ ...script, url })
    if (replayed.success) {
      resultByCriterion.set(criterion, {
        criterion,
        disposition: 'ship',
        evidenceTier: 'VERIFIED',
        rationale: 'Replayed a previously-recorded real interaction against the current page — it still matches, no AI judgment needed this time.',
      })
    } else {
      console.error(`[harness] recorded script for "${criterion}" no longer replays (${replayed.error}) — falling back to a fresh reviewer pass`)
      opts.clearRecordedScript?.(criterion)
      needsLlm.push(criterion)
    }
  }

  if (needsLlm.length === 0) return criteria.map((c) => resultByCriterion.get(c)!)

  const { results: llmResults, recordings } = await runBrowserReviewerPass(project, needsLlm, url, mcpServers, opts)
  for (const r of llmResults) {
    resultByCriterion.set(r.criterion, r)
    const recording = recordings.get(r.criterion)
    if (recording && opts.saveRecordedScript) {
      opts.saveRecordedScript(r.criterion, { url, steps: recording.steps, assertions: recording.assertions, recordedAt: new Date().toISOString() })
    }
  }

  return criteria.map((c) => resultByCriterion.get(c)!)
}

/**
 * Chunk 3's real visual-evidence path: starts the project's own confirmed
 * dev server, waits for it to actually come up, then gives a fresh-context
 * reviewer real Playwright MCP browser tools against the real running page
 * — never a screenshot-only/static check, the PRD's own research found a
 * reviewer can shortcut around a static image too easily. Always tears the
 * dev server back down (`finally`), regardless of outcome.
 *
 * `sharedPreview`, when provided (the embedded live-preview panel already
 * has this exact project's dev server up — `previewPanel.ts`/`cdpTarget.ts`
 * resolve this in `index.ts`, kept out of this module to stay
 * Electron-free and unit-testable), skips starting or stopping any dev
 * server at all — that real process is the panel's to own — and instead
 * points the reviewer's Playwright MCP server at the same app's real
 * *browser-level* CDP endpoint (`cdpEndpoint` — a single page's own CDP
 * session only supports page-scoped domains, not target management, and
 * fails outright with "Target.createTarget: Not supported" if handed a
 * page-level one instead, confirmed live). That one endpoint covers every
 * top-level view under Laird's own `--remote-debugging-port`, including
 * Laird's own chrome window — `buildUiReviewerPrompt`'s own shared-browser
 * preamble is what actually keeps the reviewer scoped to the right tab
 * (list tabs, select the one at the exact right URL, refuse rather than
 * guess if it's missing), this function alone does not. `onLockChange`
 * brackets that shared, input-contending window so the UI can show a
 * visible lock + reclaim affordance for exactly its duration.
 */
async function runUiReviewerPass(
  project: Project,
  criteria: string[],
  opts: UiCriteriaOpts & {
    devServerSpawnFn?: typeof spawn
    waitForPortFn?: typeof waitForPort
    sharedPreview?: { url: string; cdpEndpoint: string; onLockChange?: (locked: boolean) => void }
  },
): Promise<HarnessCriterionResult[]> {
  if (opts.signal?.aborted) return canceledResults(criteria)

  if (opts.sharedPreview) {
    const { url, cdpEndpoint, onLockChange } = opts.sharedPreview
    console.error(`[harness] UI reviewer: sharing the embedded live-preview panel via CDP (${cdpEndpoint})`)
    onLockChange?.(true)
    try {
      return await checkUiCriteriaAgainstUrl(project, criteria, url, playwrightMcpServers(cdpEndpoint), { ...opts, sharedBrowser: true })
    } finally {
      onLockChange?.(false)
    }
  }

  const uiPreview = project.uiPreview
  if (!uiPreview) {
    return criteria.map((criterion) => ({
      criterion,
      disposition: 'unverifiable',
      evidenceTier: 'STATED',
      rationale: 'This looks like it requires seeing or interacting with the running UI, and no UI preview command is configured yet for this project.',
    }))
  }
  if (uiPreview.port == null) {
    return criteria.map((criterion) => ({
      criterion,
      disposition: 'unverifiable',
      evidenceTier: 'STATED',
      rationale: 'A UI preview command is configured but no port was set, so Laird doesn’t know which real URL to check.',
    }))
  }

  console.error(`[harness] UI reviewer: starting its own ephemeral dev server (\`${uiPreview.command}\`) — no shared preview panel was active for this project`)
  const devServer = startDevServer(project.path, uiPreview.command, { spawnFn: opts.devServerSpawnFn })
  try {
    const waitFn = opts.waitForPortFn ?? waitForPort
    const ready = await waitFn(uiPreview.port, { timeoutMs: DEV_SERVER_READY_TIMEOUT_MS })
    if (opts.signal?.aborted) return canceledResults(criteria)
    if (!ready) {
      return criteria.map((criterion) => ({
        criterion,
        disposition: 'unverifiable',
        evidenceTier: 'STATED',
        rationale: `The configured preview command (\`${uiPreview.command}\`) didn’t start listening on port ${uiPreview.port} in time.`,
      }))
    }

    const url = `http://localhost:${uiPreview.port}`
    return await checkUiCriteriaAgainstUrl(project, criteria, url, playwrightMcpServers(), opts)
  } finally {
    devServer.stop()
  }
}

/** Agreement is stronger evidence than either pass alone; disagreement is surfaced honestly, never silently resolved. */
function mergeMultiRunResult(first: HarnessCriterionResult, second: HarnessCriterionResult): HarnessCriterionResult {
  if (first.disposition === second.disposition) {
    return {
      ...second,
      evidenceTier: first.evidenceTier === 'VERIFIED' || second.evidenceTier === 'VERIFIED' ? 'VERIFIED' : 'CORROBORATED',
      rationale: `Confirmed by a second, independent reviewer pass. ${second.rationale}`,
      evidenceQualityFlag: undefined,
    }
  }
  const worse = DISPOSITION_RANK[first.disposition] >= DISPOSITION_RANK[second.disposition] ? first : second
  return {
    ...worse,
    rationale: `Two independent reviewer passes disagreed — pass 1: ${first.disposition} ("${first.rationale}"); pass 2: ${second.disposition} ("${second.rationale}"). Reporting the more severe result pending human review.`,
    evidenceQualityFlag: undefined,
  }
}

/**
 * Harness mode's real reviewer pipeline (observability-trust-and-harness.md
 * / the implementation plan's Workstream G), with four independently
 * opt-in TypeSafe/Jev layers (`Project.jevFeatures`, user-directed addition
 * 2026-10-07) wrapped around the same fresh-context, `read`-tier-only core
 * reviewer call:
 *
 * 1. `criterionRouting` — a 3-way classification before any reviewer call:
 *    `deterministic_test` criteria skip the reviewer in favor of actually
 *    running `Project.testCommand` (free, VERIFIED, no LLM judgment);
 *    `ui_interaction` ones get a real browser-driven reviewer pass against
 *    the project's own confirmed `uiPreview` dev server (chunk 3) — or an
 *    honest `unverifiable` if no preview is configured; everything else
 *    goes to the ordinary source-reading reviewer.
 * 2. `shortcutDetection` — a fast second opinion flagging a reviewer
 *    rationale that doesn't cite concrete evidence. Applied to every real
 *    reviewer-produced result (source-reading or browser-driven), never to
 *    a mechanical test-run result or an already-honest `unverifiable`
 *    placeholder.
 * 3. `adaptiveMultiRun` — re-checks any reviewer-produced result with weak
 *    evidence (not VERIFIED/CORROBORATED, or flagged by shortcutDetection)
 *    with a second independent reviewer pass of the same kind (source
 *    review or browser-driven) that produced it, taking the worst case and
 *    surfacing any disagreement rather than silently picking one.
 * 4. `criteriaPrefilter` is authoring-time only (`jev.ts`'s
 *    `classifyCriterionClarity`, called from the IPC layer, not here).
 *
 * All four fail open — a Jev outage or missing key never blocks or
 * degrades a run, only forgoes that layer's enhancement.
 */
export async function runReviewer(
  project: Project,
  opts: {
    spawnFn?: typeof spawn
    jevApiKey?: string
    fetchFn?: typeof fetch
    testSpawnFn?: typeof spawn
    devServerSpawnFn?: typeof spawn
    waitForPortFn?: typeof waitForPort
    /** Aborting cancels the in-flight run — kills whatever real process (reviewer/dev-server/test command) is currently active and reports the remaining, not-yet-checked criteria honestly as canceled rather than guessing. */
    signal?: AbortSignal
    /** Set by `index.ts` when the embedded live-preview panel already has this exact project's dev server up — see `runUiReviewerPass`'s own doc comment. */
    sharedPreview?: { url: string; cdpEndpoint: string; onLockChange?: (locked: boolean) => void }
    /** Record-once, replay-deterministic for UI criteria — wired by `index.ts` to `MemoryStore`'s `getRecordedScript`/`setRecordedScript`/`clearRecordedScript`, scoped to this exact project. See `checkUiCriteriaAgainstUrl`. */
    getRecordedScript?: (criterion: string) => RecordedScript | undefined
    saveRecordedScript?: (criterion: string, script: RecordedScript) => void
    clearRecordedScript?: (criterion: string) => void
    replayScriptFn?: typeof replayScript
  } = {},
): Promise<HarnessRun> {
  const allCriteria = project.harnessCriteria
  const useJev = Boolean(opts.jevApiKey)

  if (opts.signal?.aborted) {
    return {
      id: randomUUID(),
      projectId: project.id,
      spec: [...allCriteria],
      disposition: 'unverifiable',
      perCriterionResult: canceledResults(allCriteria),
      createdAt: new Date().toISOString(),
      totalCostUsd: 0,
    }
  }

  // Cost ceiling (observability-trust-and-harness.md's "a cost ceiling per
  // run, matching `claude plugin eval`'s own `--max-cost-usd`"): checked at
  // phase boundaries, not mid-call — real cost is only known once a
  // `claude -p` reviewer call actually finishes, so this bounds how many
  // more reviewer phases get to start, not a single phase already running.
  // Once reached, every remaining live-reviewed phase (and any
  // adaptiveMultiRun re-check) is skipped outright, even one that might
  // have resolved for free via a replayed script — simpler and more
  // conservative than trying to prove in advance which phase would've
  // been free. Never counts a free test-command run or a free replay.
  const ceilingUsd = project.harnessCostCeilingUsd
  let totalCostUsd = 0
  let costCeilingHit = false
  const onCost = (costUsd: number) => {
    totalCostUsd += costUsd
  }
  const ceilingReached = () => ceilingUsd != null && totalCostUsd >= ceilingUsd

  const checkMethods =
    useJev && project.jevFeatures.criterionRouting
      ? await classifyCriterionCheckMethod(opts.jevApiKey!, allCriteria, opts.fetchFn)
      : allCriteria.map(() => 'code_inspection' as const)

  const resultByCriterion = new Map<string, HarnessCriterionResult>()
  const reviewerBoundCriteria: string[] = []
  const uiShapedCriteria: string[] = []
  const deterministicCriteria: string[] = []

  allCriteria.forEach((criterion, i) => {
    const method = checkMethods[i]
    if (method === 'ui_interaction') {
      uiShapedCriteria.push(criterion)
    } else if (method === 'deterministic_test' && project.testCommand) {
      deterministicCriteria.push(criterion)
    } else {
      // Either genuinely code-shaped, or classified deterministic_test with
      // no test command configured yet — rerouted to the reviewer rather
      // than left stranded with nothing checking it at all.
      reviewerBoundCriteria.push(criterion)
    }
  })

  if (deterministicCriteria.length > 0 && project.testCommand) {
    // One real run covers every criterion in this bucket — they all reduce
    // to the same real-world fact ("did the test command pass"), so running
    // it once and reusing the result is both cheaper and more honest than
    // re-running the same command per criterion.
    const testResult = await runTestCommand(project.path, project.testCommand.command, { spawnFn: opts.testSpawnFn, signal: opts.signal })
    for (const criterion of deterministicCriteria) {
      resultByCriterion.set(criterion, testRunToCriterionResult(criterion, project.testCommand.command, testResult))
    }
  }

  if (reviewerBoundCriteria.length > 0) {
    let reviewed: HarnessCriterionResult[]
    if (opts.signal?.aborted) {
      reviewed = canceledResults(reviewerBoundCriteria)
    } else if (ceilingReached()) {
      costCeilingHit = true
      reviewed = costCeilingResults(reviewerBoundCriteria, ceilingUsd!)
    } else {
      reviewed = await runReviewerPass(project, reviewerBoundCriteria, { ...opts, onCost })
    }
    for (const r of reviewed) resultByCriterion.set(r.criterion, r)
  }

  if (uiShapedCriteria.length > 0) {
    // One dev-server start/stop cycle and one browser-reviewer pass covers
    // every UI-shaped criterion together — same "run once, reuse" economy
    // as the deterministic-test bucket.
    let uiReviewed: HarnessCriterionResult[]
    if (opts.signal?.aborted) {
      uiReviewed = canceledResults(uiShapedCriteria)
    } else if (ceilingReached()) {
      costCeilingHit = true
      uiReviewed = costCeilingResults(uiShapedCriteria, ceilingUsd!)
    } else {
      uiReviewed = await runUiReviewerPass(project, uiShapedCriteria, { ...opts, onCost })
    }
    for (const r of uiReviewed) resultByCriterion.set(r.criterion, r)
  }

  const liveReviewedCriteria = [...reviewerBoundCriteria, ...uiShapedCriteria]

  if (!opts.signal?.aborted && useJev && project.jevFeatures.shortcutDetection && liveReviewedCriteria.length > 0) {
    const reviewerResults = liveReviewedCriteria.map((c) => resultByCriterion.get(c)!)
    const flags = await flagShortcutRationales(opts.jevApiKey!, reviewerResults, opts.fetchFn)
    flags.forEach((confidence, i) => {
      const r = reviewerResults[i]
      resultByCriterion.set(r.criterion, {
        ...r,
        evidenceQualityFlag: { confidence, note: 'TypeSafe/Jev flagged this rationale as not citing specific, checkable evidence.' },
      })
    })
  }

  if (!opts.signal?.aborted && useJev && project.jevFeatures.adaptiveMultiRun) {
    const isWeak = (criterion: string) => {
      const r = resultByCriterion.get(criterion)!
      return r.disposition !== 'unverifiable' && (WEAK_EVIDENCE_TIERS.has(r.evidenceTier) || Boolean(r.evidenceQualityFlag))
    }

    const weakCodeCriteria = reviewerBoundCriteria.filter(isWeak)
    if (weakCodeCriteria.length > 0 && ceilingReached()) {
      costCeilingHit = true
    } else if (weakCodeCriteria.length > 0) {
      const secondPass = await runReviewerPass(project, weakCodeCriteria, { ...opts, onCost })
      for (const second of secondPass) {
        resultByCriterion.set(second.criterion, mergeMultiRunResult(resultByCriterion.get(second.criterion)!, second))
      }
    }

    const weakUiCriteria = uiShapedCriteria.filter(isWeak)
    if (weakUiCriteria.length > 0 && ceilingReached()) {
      costCeilingHit = true
    } else if (weakUiCriteria.length > 0) {
      const secondPass = await runUiReviewerPass(project, weakUiCriteria, { ...opts, onCost })
      for (const second of secondPass) {
        resultByCriterion.set(second.criterion, mergeMultiRunResult(resultByCriterion.get(second.criterion)!, second))
      }
    }
  }

  const perCriterionResult = allCriteria.map((c) => resultByCriterion.get(c)!)

  return {
    id: randomUUID(),
    projectId: project.id,
    spec: [...allCriteria],
    disposition: worstCaseDisposition(perCriterionResult),
    perCriterionResult,
    createdAt: new Date().toISOString(),
    totalCostUsd,
    costCeilingHit: costCeilingHit || undefined,
  }
}
