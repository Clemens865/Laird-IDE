import { describe, expect, it, vi } from 'vitest'
import { classifyCriterionCheckMethod, classifyCriterionClarity, flagShortcutRationales } from './jev'
import type { HarnessCriterionResult } from '../../shared/types'

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch
}

describe('classifyCriterionCheckMethod', () => {
  it('returns an empty array for no criteria without making a request', async () => {
    const fetchFn = vi.fn()
    const result = await classifyCriterionCheckMethod('key', [], fetchFn as unknown as typeof fetch)
    expect(result).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('maps each criterion to the choice Jev returned', async () => {
    const fetchFn = fakeFetch(200, {
      answers: {
        c0: { type: 'choice', choice: 'deterministic_test', probabilities: {}, confidence: 0.9 },
        c1: { type: 'choice', choice: 'ui_interaction', probabilities: {}, confidence: 0.8 },
        c2: { type: 'choice', choice: 'code_inspection', probabilities: {}, confidence: 0.7 },
      },
    })
    const result = await classifyCriterionCheckMethod(
      'key',
      ['the test suite should pass', 'looks right on mobile', 'rejects negative amounts'],
      fetchFn,
    )
    expect(result).toEqual(['deterministic_test', 'ui_interaction', 'code_inspection'])
  })

  it('sends the API key as a Bearer header and the real criteria as state', async () => {
    const fetchFn = fakeFetch(200, { answers: { c0: { type: 'choice', choice: 'code_inspection', probabilities: {}, confidence: 0.5 } } })
    await classifyCriterionCheckMethod('sk-real-key', ['one criterion'], fetchFn)
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer sk-real-key')
    expect(JSON.parse(init.body).state).toEqual({ criteria: ['one criterion'] })
  })

  it('falls back to code_inspection for a malformed/unrecognized choice, never guessing deterministic_test or ui_interaction', async () => {
    const fetchFn = fakeFetch(200, { answers: { c0: { type: 'choice', choice: 'something_unexpected', probabilities: {}, confidence: 0.5 } } })
    const result = await classifyCriterionCheckMethod('key', ['a'], fetchFn)
    expect(result).toEqual(['code_inspection'])
  })

  it('fails open to code_inspection for every criterion on a non-2xx response, never throwing', async () => {
    const fetchFn = fakeFetch(401, { error: 'unauthorized' })
    const result = await classifyCriterionCheckMethod('bad-key', ['a', 'b'], fetchFn)
    expect(result).toEqual(['code_inspection', 'code_inspection'])
  })

  it('fails open to code_inspection when the request itself throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const result = await classifyCriterionCheckMethod('key', ['a'], fetchFn)
    expect(result).toEqual(['code_inspection'])
  })
})

describe('classifyCriterionClarity', () => {
  it('reports clear for a high noul probability', async () => {
    const fetchFn = fakeFetch(200, { answers: { clarity: { type: 'noul', noul: 0.9 } } })
    const result = await classifyCriterionClarity('key', 'The signup form should work on mobile', fetchFn)
    expect(result).toEqual({ clear: true, confidence: 0.9 })
  })

  it('reports not-clear for a low noul probability', async () => {
    const fetchFn = fakeFetch(200, { answers: { clarity: { type: 'noul', noul: 0.1 } } })
    const result = await classifyCriterionClarity('key', 'It should be good', fetchFn)
    expect(result).toEqual({ clear: false, confidence: 0.1 })
  })

  it('fails open to clear on a request failure, never blocking the user from adding a criterion', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const result = await classifyCriterionClarity('key', 'anything', fetchFn)
    expect(result.clear).toBe(true)
  })
})

describe('flagShortcutRationales', () => {
  const baseResult = (overrides: Partial<HarnessCriterionResult> = {}): HarnessCriterionResult => ({
    criterion: 'A criterion',
    disposition: 'ship',
    evidenceTier: 'VERIFIED',
    rationale: 'Found it in src/a.ts.',
    ...overrides,
  })

  it('returns no flags when there is nothing checkable (all unverifiable)', async () => {
    const fetchFn = vi.fn()
    const flags = await flagShortcutRationales('key', [baseResult({ disposition: 'unverifiable' })], fetchFn as unknown as typeof fetch)
    expect(flags.size).toBe(0)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('flags a result whose rationale scores low on citing concrete evidence', async () => {
    const fetchFn = fakeFetch(200, { answers: { q0: { type: 'noul', noul: 0.2 } } })
    const flags = await flagShortcutRationales('key', [baseResult({ rationale: 'It looks fine overall.' })], fetchFn)
    expect(flags.get(0)).toBe(0.2)
  })

  it('does not flag a result whose rationale scores high on citing concrete evidence', async () => {
    const fetchFn = fakeFetch(200, { answers: { q0: { type: 'noul', noul: 0.9 } } })
    const flags = await flagShortcutRationales('key', [baseResult()], fetchFn)
    expect(flags.size).toBe(0)
  })

  it('fails open (no flags) on a request failure, never blocking the run', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const flags = await flagShortcutRationales('key', [baseResult()], fetchFn)
    expect(flags.size).toBe(0)
  })
})
