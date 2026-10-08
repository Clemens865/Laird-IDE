import { describe, expect, it, vi } from 'vitest'
import { evaluateToolCall, type PreToolUseHookInput } from './jevGuard'

function makeInput(overrides: Partial<PreToolUseHookInput> = {}): PreToolUseHookInput {
  return {
    session_id: 's1',
    cwd: '/tmp/project',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
    tool_use_id: 't1',
    ...overrides,
  }
}

function fakeFetch(answers: Record<string, { type: 'noul'; noul: number }>): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ answers }),
    text: async () => '',
  }) as unknown as typeof fetch
}

describe('evaluateToolCall', () => {
  it('fails open (allows) when no API key is configured — never calls Jev at all', async () => {
    const fetchFn = vi.fn()
    const decision = await evaluateToolCall(makeInput(), undefined, fetchFn as unknown as typeof fetch)
    expect(decision).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('allows a call when every check comes back low-confidence', async () => {
    const fetchFn = fakeFetch({
      secretExposure: { type: 'noul', noul: 0.05 },
      destructiveAction: { type: 'noul', noul: 0.1 },
      exfiltration: { type: 'noul', noul: 0.02 },
    })
    const decision = await evaluateToolCall(makeInput(), 'sk-test', fetchFn)
    expect(decision).toBeNull()
  })

  it('denies a call when destructiveAction crosses the confidence threshold', async () => {
    const fetchFn = fakeFetch({
      secretExposure: { type: 'noul', noul: 0.1 },
      destructiveAction: { type: 'noul', noul: 0.92 },
      exfiltration: { type: 'noul', noul: 0.1 },
    })
    const decision = await evaluateToolCall(makeInput({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }), 'sk-test', fetchFn)
    expect(decision).toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
    })
    expect(decision!.hookSpecificOutput.permissionDecisionReason).toContain('destroy or irreversibly overwrite')
    expect(decision!.hookSpecificOutput.permissionDecisionReason).toContain('92%')
  })

  it('denies a call when secretExposure crosses the threshold, naming that specific concern', async () => {
    const fetchFn = fakeFetch({
      secretExposure: { type: 'noul', noul: 0.81 },
      destructiveAction: { type: 'noul', noul: 0.0 },
      exfiltration: { type: 'noul', noul: 0.0 },
    })
    const decision = await evaluateToolCall(makeInput({ tool_name: 'Read', tool_input: { file_path: '/project/.env' } }), 'sk-test', fetchFn)
    expect(decision!.hookSpecificOutput.permissionDecisionReason).toContain('expose a secret or credential')
  })

  it('does not deny right at the boundary just below the threshold', async () => {
    const fetchFn = fakeFetch({
      secretExposure: { type: 'noul', noul: 0.1 },
      destructiveAction: { type: 'noul', noul: 0.69 },
      exfiltration: { type: 'noul', noul: 0.1 },
    })
    const decision = await evaluateToolCall(makeInput(), 'sk-test', fetchFn)
    expect(decision).toBeNull()
  })

  it('fails open when the real API call fails (non-ok response)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' }) as unknown as typeof fetch
    const decision = await evaluateToolCall(makeInput(), 'sk-test', fetchFn)
    expect(decision).toBeNull()
  })

  it('fails open when the real API call throws (network error)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
    const decision = await evaluateToolCall(makeInput(), 'sk-test', fetchFn)
    expect(decision).toBeNull()
  })

  it('fails open when the response has no usable answers', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '' }) as unknown as typeof fetch
    const decision = await evaluateToolCall(makeInput(), 'sk-test', fetchFn)
    expect(decision).toBeNull()
  })
})
