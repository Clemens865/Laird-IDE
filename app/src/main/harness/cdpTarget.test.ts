import { describe, expect, it, vi } from 'vitest'
import { findCdpTargetUrl } from './cdpTarget'

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as typeof fetch
}

describe('findCdpTargetUrl', () => {
  it('finds the matching target by its real url and returns its webSocketDebuggerUrl', async () => {
    const fetchFn = fakeFetch(200, [
      { url: 'file:///app/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9335/devtools/page/laird' },
      { url: 'http://localhost:48179/', webSocketDebuggerUrl: 'ws://127.0.0.1:9335/devtools/page/preview' },
    ])
    const result = await findCdpTargetUrl(9335, 'http://localhost:48179/', fetchFn)
    expect(result).toBe('ws://127.0.0.1:9335/devtools/page/preview')
  })

  it('matches a bare-origin target even when Chrome normalizes it with a trailing slash the caller\'s own url lacks — a real mismatch found live', async () => {
    const fetchFn = fakeFetch(200, [{ url: 'http://localhost:48181/', webSocketDebuggerUrl: 'ws://127.0.0.1:9335/devtools/page/preview' }])
    const result = await findCdpTargetUrl(9335, 'http://localhost:48181', fetchFn)
    expect(result).toBe('ws://127.0.0.1:9335/devtools/page/preview')
  })

  it('returns null when nothing matches, never guessing a wrong target', async () => {
    const fetchFn = fakeFetch(200, [{ url: 'file:///app/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9335/devtools/page/laird' }])
    const result = await findCdpTargetUrl(9335, 'http://localhost:48179/', fetchFn)
    expect(result).toBeNull()
  })

  it('returns null on a non-2xx response, never throwing', async () => {
    const fetchFn = fakeFetch(500, {})
    const result = await findCdpTargetUrl(9335, 'http://localhost:48179/', fetchFn)
    expect(result).toBeNull()
  })

  it('returns null when the request itself throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch
    const result = await findCdpTargetUrl(9335, 'http://localhost:48179/', fetchFn)
    expect(result).toBeNull()
  })
})
