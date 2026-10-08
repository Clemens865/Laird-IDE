import { describe, expect, it, vi } from 'vitest'
import { cdpTargetExists, getBrowserCdpEndpoint } from './cdpTarget'

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as typeof fetch
}

describe('cdpTargetExists', () => {
  it('finds a matching target by its real url', async () => {
    const fetchFn = fakeFetch(200, [
      { url: 'file:///app/index.html' },
      { url: 'http://localhost:48179/' },
    ])
    expect(await cdpTargetExists(9335, 'http://localhost:48179/', fetchFn)).toBe(true)
  })

  it('matches a bare-origin target even when Chrome normalizes it with a trailing slash the caller\'s own url lacks — a real mismatch found live', async () => {
    const fetchFn = fakeFetch(200, [{ url: 'http://localhost:48181/' }])
    expect(await cdpTargetExists(9335, 'http://localhost:48181', fetchFn)).toBe(true)
  })

  it('returns false when nothing matches, never guessing', async () => {
    const fetchFn = fakeFetch(200, [{ url: 'file:///app/index.html' }])
    expect(await cdpTargetExists(9335, 'http://localhost:48179/', fetchFn)).toBe(false)
  })

  it('returns false on a non-2xx response, never throwing', async () => {
    expect(await cdpTargetExists(9335, 'http://localhost:48179/', fakeFetch(500, {}))).toBe(false)
  })

  it('returns false when the request itself throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch
    expect(await cdpTargetExists(9335, 'http://localhost:48179/', fetchFn)).toBe(false)
  })
})

describe('getBrowserCdpEndpoint', () => {
  it('returns the real browser-level webSocketDebuggerUrl', async () => {
    const fetchFn = fakeFetch(200, { webSocketDebuggerUrl: 'ws://127.0.0.1:9335/devtools/browser/abc' })
    expect(await getBrowserCdpEndpoint(9335, fetchFn)).toBe('ws://127.0.0.1:9335/devtools/browser/abc')
  })

  it('returns null on a non-2xx response, never throwing', async () => {
    expect(await getBrowserCdpEndpoint(9335, fakeFetch(500, {}))).toBeNull()
  })

  it('returns null when the request itself throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch
    expect(await getBrowserCdpEndpoint(9335, fetchFn)).toBeNull()
  })
})
