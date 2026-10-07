import type { HarnessCriterionResult } from '../../shared/types'

const JEV_API_URL = 'https://api.typesafe.ai/v1/systemone'

interface NoulAnswer {
  type: 'noul'
  noul: number
}

interface ChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

type AnyAnswer = NoulAnswer | ChoiceAnswer

/** How a given criterion should actually be checked — `classifyCriterionCheckMethod`'s own 3-way `choice`. */
export type CriterionCheckMethod = 'deterministic_test' | 'code_inspection' | 'ui_interaction'

/**
 * Opt-in TypeSafe/Jev assist for harness mode (user-directed addition,
 * 2026-10-07) — a cheap, fast, typed classifier (`noul`: probability of
 * yes/no over given state), NOT an agent: it cannot read files or use
 * tools, so it can never replace `reviewer.ts`'s fresh-context reviewer. Its
 * fit here is narrower: routing which criteria the reviewer should even
 * attempt, and a fast second opinion on whether the reviewer's own
 * rationale cites real evidence. A third-party, non-local, paid API — only
 * called when a project has explicitly opted in AND a key is configured
 * (`src/main/settings/typesafeKey.ts`), never ambient.
 *
 * Fails open everywhere: a missing key, a network error, or a malformed
 * response all degrade to "skip this enhancement," never to blocking or
 * crashing a harness run — this is strictly an optional quality layer on
 * top of the real reviewer, not a dependency it needs to function.
 */
async function callSystemOne(
  apiKey: string,
  state: unknown,
  questions: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<Record<string, AnyAnswer> | null> {
  try {
    const res = await fetchFn(JEV_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ state, model: 'jev-latest', questions }),
    })
    if (!res.ok) {
      console.error('[jev] systemOne request failed', res.status, await res.text().catch(() => '<no body>'))
      return null
    }
    const body = (await res.json()) as { answers?: Record<string, AnyAnswer> }
    return body.answers ?? null
  } catch (err) {
    console.error('[jev] systemOne request threw', err)
    return null
  }
}

/**
 * Criterion routing: a 3-way `choice` deciding how each criterion should
 * actually be checked, before any reviewer call runs. `deterministic_test`
 * lets `reviewer.ts` skip the reviewer entirely in favor of actually
 * running `Project.testCommand` (free, VERIFIED, no LLM judgment — the
 * strongest possible evidence where it applies). `ui_interaction`
 * short-circuits to an honest `unverifiable` (chunk 3's screenshot/browser
 * evidence path isn't built yet). Fails open to `code_inspection` — today's
 * existing reviewer path — on any error or a response Jev couldn't resolve
 * to one of the three options.
 */
export async function classifyCriterionCheckMethod(
  apiKey: string,
  criteria: string[],
  fetchFn: typeof fetch = fetch,
): Promise<CriterionCheckMethod[]> {
  if (criteria.length === 0) return []
  const questions: Record<string, unknown> = {}
  criteria.forEach((criterion, i) => {
    questions[`c${i}`] = {
      type: 'choice',
      instructions: `How should the following acceptance criterion actually be checked? Criterion: "${criterion}"`,
      criteria: {
        deterministic_test: 'This reduces to "the project\'s automated test suite should pass" — a real test command can check it directly, no judgment needed.',
        code_inspection: 'This can be checked by a reviewer reading the project\'s source code — no running UI or test suite needed.',
        ui_interaction: 'Checking this genuinely requires seeing or interacting with a rendered, running UI.',
      },
    }
  })

  const answers = await callSystemOne(apiKey, { criteria }, questions, fetchFn)
  if (!answers) return criteria.map(() => 'code_inspection')
  return criteria.map((_, i) => {
    const answer = answers[`c${i}`]
    if (answer?.type === 'choice' && (answer.choice === 'deterministic_test' || answer.choice === 'ui_interaction')) {
      return answer.choice
    }
    return 'code_inspection'
  })
}

/**
 * Criteria pre-filter: a cheap check at authoring time — before any run is
 * ever paid for — flagging wording too vague to check. Advisory only
 * (`HarnessView` shows it as a dismissible warning, never blocks adding the
 * criterion): a false positive here should never stop a user from recording
 * what they meant. Fails open to "clear" on any error.
 */
export async function classifyCriterionClarity(
  apiKey: string,
  criterion: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ clear: boolean; confidence: number }> {
  const answers = await callSystemOne(
    apiKey,
    {},
    {
      clarity: {
        type: 'noul',
        instructions: `Is the following acceptance criterion specific and concrete enough that someone could actually check whether it's satisfied — not vague, subjective-without-a-definition, or ambiguous? Criterion: "${criterion}"`,
        criteria: { true: 'Specific and checkable as written.', false: 'Too vague or ambiguous to check as written.' },
      },
    },
    fetchFn,
  )
  const answer = answers?.clarity
  const noul = answer?.type === 'noul' ? answer.noul : undefined
  if (typeof noul !== 'number') return { clear: true, confidence: 0 }
  return { clear: noul > 0.5, confidence: noul }
}

/**
 * Shortcut-detection: flags a reviewer rationale that doesn't cite concrete,
 * specific evidence. Returns a map of result-array-index -> the noul
 * probability of "yes it cites real evidence" being low (a flagged result).
 * Never called for already-`unverifiable` results — there's no confident
 * claim there to quality-check.
 */
export async function flagShortcutRationales(
  apiKey: string,
  results: HarnessCriterionResult[],
  fetchFn: typeof fetch = fetch,
): Promise<Map<number, number>> {
  const checkable = results.map((r, i) => ({ r, i })).filter(({ r }) => r.disposition !== 'unverifiable' && r.rationale)
  const flags = new Map<number, number>()
  if (checkable.length === 0) return flags

  const questions: Record<string, unknown> = {}
  checkable.forEach(({ r }, idx) => {
    questions[`q${idx}`] = {
      type: 'noul',
      instructions: `Does the following reviewer rationale cite concrete, specific evidence — a real file name, function, or quoted code — rather than a vague or generic restatement of the criterion? Rationale: "${r.rationale}"`,
      criteria: {
        true: 'Cites specific, checkable evidence (a real file, function, or quoted code).',
        false: 'Vague or generic — no specific evidence cited.',
      },
    }
  })

  const answers = await callSystemOne(apiKey, {}, questions, fetchFn)
  if (!answers) return flags
  checkable.forEach(({ i }, idx) => {
    const answer = answers[`q${idx}`]
    const noul = answer?.type === 'noul' ? answer.noul : undefined
    if (typeof noul === 'number' && noul < 0.5) flags.set(i, noul)
  })
  return flags
}
