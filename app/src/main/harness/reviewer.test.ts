import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { runReviewer } from './reviewer'
import type { Project } from '../../shared/types'

function fakeFetch(answers: Record<string, { type: 'noul'; noul: number }>): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ answers }),
    text: async () => '',
  }) as unknown as typeof fetch
}

function fakeChoiceFetch(choices: Record<string, 'deterministic_test' | 'code_inspection' | 'ui_interaction'>): typeof fetch {
  const answers: Record<string, unknown> = {}
  for (const [key, choice] of Object.entries(choices)) {
    answers[key] = { type: 'choice', choice, probabilities: {}, confidence: 0.9 }
  }
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ answers }), text: async () => '' }) as unknown as typeof fetch
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    path: '/tmp/proj',
    colorToken: '#D97757',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    enabledGlobalSkillIds: [],
    permissionTier: 'write',
    approvalMode: 'auto',
    autonomyRevoked: false,
    harnessCriteria: [],
    jevFeatures: { criterionRouting: false, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    ...overrides,
  }
}

/** A real, harmless child process standing in for `claude` (no real CLI, no API cost) — writes canned NDJSON lines and exits. */
function spawnFakeReviewer(ndjsonLines: string[]): ReturnType<typeof spawn> {
  const script = `for (const line of ${JSON.stringify(ndjsonLines)}) process.stdout.write(line + '\\n')`
  return spawn(process.execPath, ['-e', script])
}

function assistantTextLine(text: string): string {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
}

describe('runReviewer', () => {
  it('parses a real-shaped reviewer response into per-criterion results and a worst-case overall disposition', async () => {
    const replyJson = JSON.stringify({
      results: [
        { criterion: 'Criterion A', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'Found it in src/a.ts.' },
        { criterion: 'Criterion B', disposition: 'rework', evidenceTier: 'CORROBORATED', rationale: 'Missing validation.' },
      ],
    })
    const project = makeProject({ harnessCriteria: ['Criterion A', 'Criterion B'] })

    const run = await runReviewer(project, { spawnFn: () => spawnFakeReviewer([assistantTextLine(replyJson)]) as never })

    expect(run.projectId).toBe('p1')
    expect(run.spec).toEqual(['Criterion A', 'Criterion B'])
    expect(run.perCriterionResult).toHaveLength(2)
    expect(run.perCriterionResult[0]).toMatchObject({ criterion: 'Criterion A', disposition: 'ship', evidenceTier: 'VERIFIED' })
    expect(run.perCriterionResult[1]).toMatchObject({ criterion: 'Criterion B', disposition: 'rework', evidenceTier: 'CORROBORATED' })
    expect(run.disposition).toBe('rework')
  })

  it('reports ship overall only when every criterion ships', async () => {
    const replyJson = JSON.stringify({
      results: [
        { criterion: 'A', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'ok' },
        { criterion: 'B', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'ok' },
      ],
    })
    const project = makeProject({ harnessCriteria: ['A', 'B'] })
    const run = await runReviewer(project, { spawnFn: () => spawnFakeReviewer([assistantTextLine(replyJson)]) as never })
    expect(run.disposition).toBe('ship')
  })

  it('falls back to an honest unverifiable/STATED result when the reviewer output is not valid JSON, rather than crashing or guessing', async () => {
    const project = makeProject({ harnessCriteria: ['Only criterion'] })
    const run = await runReviewer(project, { spawnFn: () => spawnFakeReviewer([assistantTextLine('not json at all')]) as never })

    expect(run.perCriterionResult).toEqual([
      { criterion: 'Only criterion', disposition: 'unverifiable', evidenceTier: 'STATED', rationale: expect.any(String) },
    ])
    expect(run.disposition).toBe('unverifiable')
  })

  it('fills in an honest result for a criterion the reviewer silently dropped from its response', async () => {
    const replyJson = JSON.stringify({
      results: [{ criterion: 'A', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'ok' }],
    })
    const project = makeProject({ harnessCriteria: ['A', 'B (dropped by the reviewer)'] })
    const run = await runReviewer(project, { spawnFn: () => spawnFakeReviewer([assistantTextLine(replyJson)]) as never })

    expect(run.perCriterionResult).toHaveLength(2)
    expect(run.perCriterionResult[1]).toMatchObject({ criterion: 'B (dropped by the reviewer)', disposition: 'unverifiable', evidenceTier: 'STATED' })
  })

  it('ignores a malformed entry (invalid disposition) rather than trusting it, falling back to unverifiable for that criterion', async () => {
    const replyJson = JSON.stringify({
      results: [{ criterion: 'A', disposition: 'definitely-ships', evidenceTier: 'VERIFIED', rationale: 'bad enum value' }],
    })
    const project = makeProject({ harnessCriteria: ['A'] })
    const run = await runReviewer(project, { spawnFn: () => spawnFakeReviewer([assistantTextLine(replyJson)]) as never })

    expect(run.perCriterionResult[0]).toMatchObject({ criterion: 'A', disposition: 'unverifiable', evidenceTier: 'STATED' })
  })

  it('reports every criterion as unverifiable/STATED with the real failure reason when the reviewer process itself fails to spawn', async () => {
    const project = makeProject({ harnessCriteria: ['A criterion'] })
    const run = await runReviewer(project, { spawnFn: () => spawn('/definitely/does/not/exist-binary-xyz') as never })

    expect(run.perCriterionResult).toHaveLength(1)
    expect(run.perCriterionResult[0].disposition).toBe('unverifiable')
    expect(run.perCriterionResult[0].evidenceTier).toBe('STATED')
    expect(run.perCriterionResult[0].rationale).toContain('reviewer run failed')
  })

  it('snapshots the project\'s current criteria onto the run\'s own spec', async () => {
    const project = makeProject({ harnessCriteria: ['Signup works on mobile'] })
    const run = await runReviewer(project, { spawnFn: () => spawn('/definitely/does/not/exist-binary-xyz') as never })
    expect(run.spec).toEqual(['Signup works on mobile'])
  })
})

describe('runReviewer — TypeSafe/Jev criterionRouting (opt-in)', () => {
  it('routes a UI-shaped criterion to an honest unverifiable WITHOUT ever sending it to the reviewer, while a code-shaped one still goes through', async () => {
    const replyJson = JSON.stringify({
      results: [{ criterion: 'The API should reject negative amounts', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'Found the check in src/api.ts.' }],
    })
    const spawnFn = vi.fn(() => spawnFakeReviewer([assistantTextLine(replyJson)]) as never)
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction', c1: 'code_inspection' })
    const project = makeProject({
      harnessCriteria: ['The signup form should look right on mobile', 'The API should reject negative amounts'],
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, { spawnFn, fetchFn, jevApiKey: 'sk-test' })

    expect(run.perCriterionResult[0]).toMatchObject({
      criterion: 'The signup form should look right on mobile',
      disposition: 'unverifiable',
      evidenceTier: 'STATED',
    })
    expect(run.perCriterionResult[0].rationale).toContain('no UI preview command is configured')
    expect(run.perCriterionResult[1]).toMatchObject({ criterion: 'The API should reject negative amounts', disposition: 'ship' })
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it('never invokes the reviewer at all when every criterion is routed as UI-shaped', async () => {
    const spawnFn = vi.fn(() => spawnFakeReviewer([]) as never)
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction' })
    const project = makeProject({
      harnessCriteria: ['Looks professional on mobile'],
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, { spawnFn, fetchFn, jevApiKey: 'sk-test' })

    expect(spawnFn).not.toHaveBeenCalled()
    expect(run.perCriterionResult[0].disposition).toBe('unverifiable')
  })

  it('routes a deterministic-test criterion to a real test-command run instead of the reviewer', async () => {
    const spawnFn = vi.fn(() => spawnFakeReviewer([]) as never)
    const fetchFn = fakeChoiceFetch({ c0: 'deterministic_test' })
    const project = makeProject({
      path: process.cwd(),
      harnessCriteria: ['The test suite should pass'],
      testCommand: { command: 'exit 0' },
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, { spawnFn, fetchFn, jevApiKey: 'sk-test' })

    expect(spawnFn).not.toHaveBeenCalled()
    expect(run.perCriterionResult[0]).toMatchObject({ disposition: 'ship', evidenceTier: 'VERIFIED' })
  })

  it('reports a real failing test command as rework/VERIFIED, not a guess', async () => {
    const fetchFn = fakeChoiceFetch({ c0: 'deterministic_test' })
    const project = makeProject({
      path: process.cwd(),
      harnessCriteria: ['The test suite should pass'],
      testCommand: { command: 'exit 1' },
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, { fetchFn, jevApiKey: 'sk-test' })

    expect(run.perCriterionResult[0]).toMatchObject({ disposition: 'rework', evidenceTier: 'VERIFIED' })
  })

  it('reroutes a deterministic-test classification to the reviewer when no test command is configured yet, rather than leaving it unchecked', async () => {
    const replyJson = JSON.stringify({
      results: [{ criterion: 'The test suite should pass', disposition: 'hold', evidenceTier: 'CORROBORATED', rationale: 'Found a test file but could not run it.' }],
    })
    const spawnFn = vi.fn(() => spawnFakeReviewer([assistantTextLine(replyJson)]) as never)
    const fetchFn = fakeChoiceFetch({ c0: 'deterministic_test' })
    const project = makeProject({
      harnessCriteria: ['The test suite should pass'],
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, { spawnFn, fetchFn, jevApiKey: 'sk-test' })

    expect(spawnFn).toHaveBeenCalledTimes(1)
    expect(run.perCriterionResult[0]).toMatchObject({ disposition: 'hold' })
  })

  it('runs the test command only once and reuses the result for every criterion routed to it', async () => {
    let runs = 0
    const testSpawnFn = ((...args: Parameters<typeof spawn>) => {
      runs += 1
      return spawn(...args)
    }) as typeof spawn
    const fetchFn = fakeChoiceFetch({ c0: 'deterministic_test', c1: 'deterministic_test' })
    const project = makeProject({
      path: process.cwd(),
      harnessCriteria: ['The unit tests should pass', 'The test suite should be green'],
      testCommand: { command: 'exit 0' },
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, { fetchFn, jevApiKey: 'sk-test', testSpawnFn })

    expect(runs).toBe(1)
    expect(run.perCriterionResult.every((r) => r.disposition === 'ship')).toBe(true)
  })
})

describe('runReviewer — TypeSafe/Jev shortcutDetection (opt-in)', () => {
  it('flags a ship/VERIFIED result whose rationale is vague, never silently changing the disposition', async () => {
    const replyJson = JSON.stringify({
      results: [{ criterion: 'A', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'It looks fine overall.' }],
    })
    const spawnFn = () => spawnFakeReviewer([assistantTextLine(replyJson)]) as never
    const fetchFn = fakeFetch({ q0: { type: 'noul', noul: 0.15 } })
    const project = makeProject({
      harnessCriteria: ['A'],
      jevFeatures: { criterionRouting: false, shortcutDetection: true, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, { spawnFn, fetchFn, jevApiKey: 'sk-test' })

    expect(run.perCriterionResult[0].disposition).toBe('ship')
    expect(run.perCriterionResult[0].evidenceQualityFlag).toMatchObject({ confidence: 0.15 })
  })

  it('never runs shortcut-detection on a deterministic test-command result — mechanical evidence, not a reviewer rationale to second-guess', async () => {
    const fetchFn = fakeChoiceFetch({ c0: 'deterministic_test' })
    const project = makeProject({
      path: process.cwd(),
      harnessCriteria: ['The test suite should pass'],
      testCommand: { command: 'exit 0' },
      jevFeatures: { criterionRouting: true, shortcutDetection: true, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, { fetchFn, jevApiKey: 'sk-test' })

    expect(fetchFn).toHaveBeenCalledTimes(1) // only the routing call
    expect(run.perCriterionResult[0].evidenceQualityFlag).toBeUndefined()
  })
})

describe('runReviewer — TypeSafe/Jev adaptiveMultiRun (opt-in)', () => {
  it('re-checks a weak-evidence result with a second independent reviewer pass, upgrading evidence tier on agreement', async () => {
    const firstReply = JSON.stringify({ results: [{ criterion: 'A', disposition: 'ship', evidenceTier: 'UNCORROBORATED', rationale: 'Seems fine.' }] })
    const secondReply = JSON.stringify({ results: [{ criterion: 'A', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'Confirmed in src/a.ts.' }] })
    let call = 0
    const spawnFn = vi.fn(() => {
      call += 1
      return spawnFakeReviewer([assistantTextLine(call === 1 ? firstReply : secondReply)]) as never
    })
    const project = makeProject({
      harnessCriteria: ['A'],
      jevFeatures: { criterionRouting: false, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: true },
    })

    const run = await runReviewer(project, { spawnFn, jevApiKey: 'sk-test' })

    expect(spawnFn).toHaveBeenCalledTimes(2)
    expect(run.perCriterionResult[0].disposition).toBe('ship')
    expect(run.perCriterionResult[0].evidenceTier).toBe('VERIFIED')
    expect(run.perCriterionResult[0].rationale).toContain('Confirmed by a second')
  })

  it('surfaces disagreement between two independent reviewer passes rather than silently picking one', async () => {
    const firstReply = JSON.stringify({ results: [{ criterion: 'A', disposition: 'ship', evidenceTier: 'UNCORROBORATED', rationale: 'Looks fine.' }] })
    const secondReply = JSON.stringify({ results: [{ criterion: 'A', disposition: 'rework', evidenceTier: 'VERIFIED', rationale: 'Actually broken, see src/a.ts.' }] })
    let call = 0
    const spawnFn = vi.fn(() => {
      call += 1
      return spawnFakeReviewer([assistantTextLine(call === 1 ? firstReply : secondReply)]) as never
    })
    const project = makeProject({
      harnessCriteria: ['A'],
      jevFeatures: { criterionRouting: false, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: true },
    })

    const run = await runReviewer(project, { spawnFn, jevApiKey: 'sk-test' })

    expect(run.perCriterionResult[0].disposition).toBe('rework')
    expect(run.perCriterionResult[0].rationale).toContain('disagreed')
  })

  it('does not re-check a result that already came back with strong (VERIFIED) evidence', async () => {
    const replyJson = JSON.stringify({ results: [{ criterion: 'A', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'Confirmed.' }] })
    const spawnFn = vi.fn(() => spawnFakeReviewer([assistantTextLine(replyJson)]) as never)
    const project = makeProject({
      harnessCriteria: ['A'],
      jevFeatures: { criterionRouting: false, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: true },
    })

    await runReviewer(project, { spawnFn, jevApiKey: 'sk-test' })

    expect(spawnFn).toHaveBeenCalledTimes(1)
  })
})

describe('runReviewer — Jev opt-in boundary', () => {
  it('does not call Jev at all when jevApiKey is not provided, even with every feature toggled on (opt-in, never ambient)', async () => {
    const fetchFn = vi.fn()
    const replyJson = JSON.stringify({ results: [{ criterion: 'A', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'ok' }] })
    const project = makeProject({
      harnessCriteria: ['A'],
      jevFeatures: { criterionRouting: true, shortcutDetection: true, criteriaPrefilter: true, adaptiveMultiRun: true },
    })
    await runReviewer(project, { spawnFn: () => spawnFakeReviewer([assistantTextLine(replyJson)]) as never, fetchFn: fetchFn as unknown as typeof fetch })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('runReviewer — chunk 3: UI-shaped criteria get a real browser-driven reviewer pass', () => {
  function spawnNoop(): ReturnType<typeof spawn> {
    return spawn(process.execPath, ['-e', ''])
  }

  it('reports an honest unverifiable, without starting any dev server, when no uiPreview is configured', async () => {
    const devServerSpawnFn = vi.fn(() => spawnNoop() as never)
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction' })
    const project = makeProject({
      harnessCriteria: ['The signup form should look right on mobile'],
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, { fetchFn, jevApiKey: 'sk-test', devServerSpawnFn })

    expect(devServerSpawnFn).not.toHaveBeenCalled()
    expect(run.perCriterionResult[0]).toMatchObject({ disposition: 'unverifiable', evidenceTier: 'STATED' })
    expect(run.perCriterionResult[0].rationale).toContain('no UI preview command is configured')
  })

  it('reports an honest unverifiable when the dev server never starts listening in time, and still tears it down', async () => {
    const devServerSpawnFn = vi.fn(() => spawnNoop() as never)
    const waitForPortFn = vi.fn().mockResolvedValue(false)
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction' })
    const project = makeProject({
      harnessCriteria: ['The signup form should look right on mobile'],
      uiPreview: { command: 'npm run dev', port: 5173 },
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, { fetchFn, jevApiKey: 'sk-test', devServerSpawnFn, waitForPortFn: waitForPortFn as never })

    expect(devServerSpawnFn).toHaveBeenCalledTimes(1)
    expect(waitForPortFn).toHaveBeenCalledWith(5173, expect.objectContaining({ timeoutMs: expect.any(Number) }))
    expect(run.perCriterionResult[0]).toMatchObject({ disposition: 'unverifiable', evidenceTier: 'STATED' })
    expect(run.perCriterionResult[0].rationale).toContain('didn’t start listening')
  })

  it('runs a real browser-reviewer pass against the dev server once it is ready, producing a genuine result', async () => {
    const replyJson = JSON.stringify({
      results: [{ criterion: 'Clicking login navigates to the dashboard', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'Navigated to /login, clicked Login, saw the dashboard.' }],
    })
    const devServerSpawnFn = vi.fn(() => spawnNoop() as never)
    const reviewerSpawnFn = vi.fn(() => spawnFakeReviewer([assistantTextLine(replyJson)]) as never)
    const waitForPortFn = vi.fn().mockResolvedValue(true)
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction' })
    const project = makeProject({
      harnessCriteria: ['Clicking login navigates to the dashboard'],
      uiPreview: { command: 'npm run dev', port: 5173 },
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, {
      fetchFn,
      jevApiKey: 'sk-test',
      devServerSpawnFn,
      waitForPortFn: waitForPortFn as never,
      spawnFn: reviewerSpawnFn,
    })

    expect(devServerSpawnFn).toHaveBeenCalledTimes(1)
    expect(run.perCriterionResult[0]).toMatchObject({ disposition: 'ship', evidenceTier: 'VERIFIED' })
    expect(run.perCriterionResult[0].rationale).toContain('Navigated to /login')
  })

  it('tears the dev server down even when the reviewer pass itself fails', async () => {
    const devServerSpawnFn = vi.fn(() => spawnNoop() as never)
    const waitForPortFn = vi.fn().mockResolvedValue(true)
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction' })
    const project = makeProject({
      harnessCriteria: ['Looks right on mobile'],
      uiPreview: { command: 'npm run dev', port: 5173 },
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, {
      fetchFn,
      jevApiKey: 'sk-test',
      devServerSpawnFn,
      waitForPortFn: waitForPortFn as never,
      spawnFn: () => spawn('/definitely/does/not/exist-binary-xyz') as never,
    })

    expect(devServerSpawnFn).toHaveBeenCalledTimes(1)
    expect(run.perCriterionResult[0].disposition).toBe('unverifiable')
    expect(run.perCriterionResult[0].rationale).toContain('UI reviewer run failed')
  })
})

describe('runReviewer — cancellation via AbortSignal', () => {
  function spawnHungProcess(): ReturnType<typeof spawn> {
    return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  }

  it('returns every criterion as honestly canceled, without starting anything, when the signal is already aborted', async () => {
    const spawnFn = vi.fn(() => spawnHungProcess() as never)
    const controller = new AbortController()
    controller.abort()
    const project = makeProject({ harnessCriteria: ['A', 'B'] })

    const run = await runReviewer(project, { spawnFn, signal: controller.signal })

    expect(spawnFn).not.toHaveBeenCalled()
    expect(run.perCriterionResult).toHaveLength(2)
    expect(run.perCriterionResult.every((r) => r.disposition === 'unverifiable' && r.rationale.includes('Canceled'))).toBe(true)
  })

  it('kills a real in-flight reviewer process when aborted mid-run, reporting an honest canceled result', async () => {
    const spawnFn = vi.fn(() => spawnHungProcess() as never)
    const controller = new AbortController()
    const project = makeProject({ harnessCriteria: ['A'] })

    const runPromise = runReviewer(project, { spawnFn, signal: controller.signal })
    await new Promise((r) => setTimeout(r, 100))
    controller.abort()

    const run = await runPromise
    expect(run.perCriterionResult[0]).toMatchObject({ disposition: 'unverifiable', evidenceTier: 'STATED' })
    expect(run.perCriterionResult[0].rationale).toContain('Canceled')
  })
})

describe('runReviewer — chunk 3 piece 3: sharing the embedded live-preview panel over CDP', () => {
  it('never starts or stops a dev server when a shared preview is provided — that real process belongs to the panel, not the harness', async () => {
    const replyJson = JSON.stringify({
      results: [{ criterion: 'Looks right on mobile', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'Navigated and saw it.' }],
    })
    const devServerSpawnFn = vi.fn(() => spawn(process.execPath, ['-e', '']) as never)
    const reviewerSpawnFn = vi.fn(() => spawnFakeReviewer([assistantTextLine(replyJson)]) as never)
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction' })
    const project = makeProject({
      harnessCriteria: ['Looks right on mobile'],
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    const run = await runReviewer(project, {
      fetchFn,
      jevApiKey: 'sk-test',
      devServerSpawnFn,
      spawnFn: reviewerSpawnFn,
      sharedPreview: { url: 'http://localhost:48179', cdpEndpoint: 'ws://127.0.0.1:9335/devtools/page/abc' },
    })

    expect(devServerSpawnFn).not.toHaveBeenCalled()
    expect(run.perCriterionResult[0]).toMatchObject({ disposition: 'ship' })
  })

  it('points the Playwright MCP server at the shared CDP endpoint instead of launching its own browser', async () => {
    const replyJson = JSON.stringify({ results: [{ criterion: 'A', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'ok' }] })
    let capturedArgs: string[] = []
    const reviewerSpawnFn = ((_cmd: string, args: string[]) => {
      capturedArgs = args
      return spawnFakeReviewer([assistantTextLine(replyJson)])
    }) as unknown as typeof spawn
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction' })
    const project = makeProject({
      harnessCriteria: ['A'],
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    await runReviewer(project, {
      fetchFn,
      jevApiKey: 'sk-test',
      spawnFn: reviewerSpawnFn,
      sharedPreview: { url: 'http://localhost:48179', cdpEndpoint: 'ws://127.0.0.1:9335/devtools/page/abc' },
    })

    const mcpConfigIndex = capturedArgs.indexOf('--mcp-config')
    const mcpConfig = JSON.parse(capturedArgs[mcpConfigIndex + 1])
    expect(mcpConfig.mcpServers.playwright.args).toEqual(['@playwright/mcp@latest', '--cdp-endpoint', 'ws://127.0.0.1:9335/devtools/page/abc'])
  })

  it('instructs the reviewer to explicitly select the matching tab and never guess, since a shared browser-level endpoint also covers Laird\'s own window', async () => {
    const replyJson = JSON.stringify({ results: [{ criterion: 'A', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'ok' }] })
    let capturedPrompt = ''
    const reviewerSpawnFn = (() => {
      const child = spawnFakeReviewer([assistantTextLine(replyJson)])
      const originalWrite = child.stdin!.write.bind(child.stdin)
      child.stdin!.write = ((chunk: unknown, ...rest: unknown[]) => {
        capturedPrompt += String(chunk)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalWrite as any)(chunk, ...rest)
      }) as typeof child.stdin.write
      return child
    }) as unknown as typeof spawn
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction' })
    const project = makeProject({
      harnessCriteria: ['A'],
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })

    await runReviewer(project, {
      fetchFn,
      jevApiKey: 'sk-test',
      spawnFn: reviewerSpawnFn,
      sharedPreview: { url: 'http://localhost:48179', cdpEndpoint: 'ws://127.0.0.1:9335/devtools/browser/abc' },
    })

    expect(capturedPrompt).toContain('shared browser')
    expect(capturedPrompt).toContain('Never create a new tab')
    expect(capturedPrompt).toContain('http://localhost:48179')
  })

  it('brackets the shared, input-contending window with onLockChange(true) then onLockChange(false)', async () => {
    const replyJson = JSON.stringify({ results: [{ criterion: 'A', disposition: 'ship', evidenceTier: 'VERIFIED', rationale: 'ok' }] })
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction' })
    const project = makeProject({
      harnessCriteria: ['A'],
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })
    const lockCalls: boolean[] = []

    await runReviewer(project, {
      fetchFn,
      jevApiKey: 'sk-test',
      spawnFn: () => spawnFakeReviewer([assistantTextLine(replyJson)]) as never,
      sharedPreview: {
        url: 'http://localhost:48179',
        cdpEndpoint: 'ws://127.0.0.1:9335/devtools/page/abc',
        onLockChange: (locked) => lockCalls.push(locked),
      },
    })

    expect(lockCalls).toEqual([true, false])
  })

  it('still releases the lock when the reviewer pass itself fails', async () => {
    const fetchFn = fakeChoiceFetch({ c0: 'ui_interaction' })
    const project = makeProject({
      harnessCriteria: ['A'],
      jevFeatures: { criterionRouting: true, shortcutDetection: false, criteriaPrefilter: false, adaptiveMultiRun: false },
    })
    const lockCalls: boolean[] = []

    await runReviewer(project, {
      fetchFn,
      jevApiKey: 'sk-test',
      spawnFn: () => spawn('/definitely/does/not/exist-binary-xyz') as never,
      sharedPreview: {
        url: 'http://localhost:48179',
        cdpEndpoint: 'ws://127.0.0.1:9335/devtools/page/abc',
        onLockChange: (locked) => lockCalls.push(locked),
      },
    })

    expect(lockCalls).toEqual([true, false])
  })
})
