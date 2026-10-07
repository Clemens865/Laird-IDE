import { randomUUID } from 'node:crypto'
import type { spawn } from 'node:child_process'
import { ClaudeHeadlessTransport } from '../session/claudeHeadlessTransport'
import { classifyCriterionCheckMethod, flagShortcutRationales } from './jev'
import { runTestCommand, testRunToCriterionResult } from './testRunner'
import { startDevServer, waitForPort } from './devServer'
import type { EvidenceTier, HarnessCriterionResult, HarnessDisposition, HarnessRun, Project } from '../../shared/types'

/**
 * The real, official Playwright MCP server — confirmed live during the
 * PRD's own research pass to give a headless `claude -p` session genuine
 * interactive browser tools (navigate/click/type/screenshot), not just a
 * static image. Specified explicitly here rather than depending on whatever
 * plugins happen to be installed on a given machine — same "explicit, never
 * ambient" discipline as everything else this transport configures.
 */
const PLAYWRIGHT_MCP_SERVERS = { playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } }
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

function buildUiReviewerPrompt(criteria: string[], url: string): string {
  const numbered = criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
  return `You are a fresh, independent reviewer checking a real, running web UI. You have no prior conversation or context about how this project was built. You have browser tools (navigate, click, type, read page state, take a screenshot) — use them to actually visit and interact with the real page at ${url}. You never fix, edit, or suggest edits — you only check and report.

Check each numbered acceptance criterion below against what you actually see or do in the real running UI. For each one, decide exactly one disposition:
- "ship": you directly navigated to/interacted with the real UI and it genuinely satisfies this criterion.
- "hold": partially met, or a minor issue remains.
- "rework": clearly not met.
- "unverifiable": the criterion is too ambiguous as written, or your browser tools genuinely can't check it.

For each one also give an evidenceTier — exactly one of "VERIFIED" (you directly navigated/interacted and saw the real result), "CORROBORATED" (strong supporting evidence, not a complete direct check), "UNCORROBORATED" (you looked but found no real evidence either way), "INFERENCE" (guessing from indirect signals), "STATED" (no way to check at all). Never claim VERIFIED without genuinely using your browser tools to look — if you didn't actually navigate and look, say so honestly rather than guessing.

Criteria:
${numbered}

In your rationale, briefly describe what you actually did (e.g. "navigated to /signup, clicked Submit, saw a validation error") so a human can tell you genuinely checked rather than guessed.

Respond with ONLY a single JSON object and nothing else — no markdown code fences, no prose before or after — in exactly this shape:
{"results":[{"criterion":"<the exact criterion text, verbatim>","disposition":"ship|hold|rework|unverifiable","evidenceTier":"VERIFIED|CORROBORATED|UNCORROBORATED|INFERENCE|STATED","rationale":"<what you actually did and saw, plain language>"}]}`
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

function canceledResults(criteria: string[]): HarnessCriterionResult[] {
  return criteria.map((criterion) => ({
    criterion,
    disposition: 'unverifiable',
    evidenceTier: 'STATED',
    rationale: 'Canceled by the user before this criterion was checked.',
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
  opts: { spawnFn?: typeof spawn; signal?: AbortSignal },
): Promise<HarnessCriterionResult[]> {
  if (opts.signal?.aborted) return canceledResults(criteria)

  const transport = new ClaudeHeadlessTransport({ permissionTier: 'read', spawnFn: opts.spawnFn })
  const onAbort = () => transport.stop()
  opts.signal?.addEventListener('abort', onAbort)

  let fullText = ''
  transport.onEvent((e) => {
    if (e.kind === 'text') fullText += (e.payload as { text: string }).text
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

/**
 * Chunk 3's real visual-evidence path: starts the project's own confirmed
 * dev server, waits for it to actually come up, then gives a fresh-context
 * reviewer real Playwright MCP browser tools against the real running page
 * — never a screenshot-only/static check, the PRD's own research found a
 * reviewer can shortcut around a static image too easily. Always tears the
 * dev server back down (`finally`), regardless of outcome.
 */
async function runUiReviewerPass(
  project: Project,
  criteria: string[],
  opts: { spawnFn?: typeof spawn; devServerSpawnFn?: typeof spawn; waitForPortFn?: typeof waitForPort; signal?: AbortSignal },
): Promise<HarnessCriterionResult[]> {
  if (opts.signal?.aborted) return canceledResults(criteria)

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
    const transport = new ClaudeHeadlessTransport({
      spawnFn: opts.spawnFn,
      allowedToolsOverride: UI_REVIEWER_ALLOWED_TOOLS,
      mcpServers: PLAYWRIGHT_MCP_SERVERS,
    })
    const onAbort = () => transport.stop()
    opts.signal?.addEventListener('abort', onAbort)

    let fullText = ''
    transport.onEvent((e) => {
      if (e.kind === 'text') fullText += (e.payload as { text: string }).text
    })

    const exitInfo = await new Promise<{ code: number | null; failure?: { kind: string; message: string } }>((resolve) => {
      transport.onExit(resolve)
      transport.start({ cwd: project.path, prompt: buildUiReviewerPrompt(criteria, url), model: REVIEWER_MODEL })
    })
    opts.signal?.removeEventListener('abort', onAbort)

    if (opts.signal?.aborted) return canceledResults(criteria)

    return exitInfo.failure
      ? criteria.map((criterion) => ({
          criterion,
          disposition: 'unverifiable' as const,
          evidenceTier: 'STATED' as const,
          rationale: `The UI reviewer run failed before reporting a result: ${exitInfo.failure!.message}`,
        }))
      : parseReviewerOutput(fullText, criteria)
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
    }
  }

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
    const reviewed = opts.signal?.aborted ? canceledResults(reviewerBoundCriteria) : await runReviewerPass(project, reviewerBoundCriteria, opts)
    for (const r of reviewed) resultByCriterion.set(r.criterion, r)
  }

  if (uiShapedCriteria.length > 0) {
    // One dev-server start/stop cycle and one browser-reviewer pass covers
    // every UI-shaped criterion together — same "run once, reuse" economy
    // as the deterministic-test bucket.
    const uiReviewed = opts.signal?.aborted ? canceledResults(uiShapedCriteria) : await runUiReviewerPass(project, uiShapedCriteria, opts)
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
    if (weakCodeCriteria.length > 0) {
      const secondPass = await runReviewerPass(project, weakCodeCriteria, opts)
      for (const second of secondPass) {
        resultByCriterion.set(second.criterion, mergeMultiRunResult(resultByCriterion.get(second.criterion)!, second))
      }
    }

    const weakUiCriteria = uiShapedCriteria.filter(isWeak)
    if (weakUiCriteria.length > 0) {
      const secondPass = await runUiReviewerPass(project, weakUiCriteria, opts)
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
  }
}
