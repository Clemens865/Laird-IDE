import { createServer, type Server } from 'node:http'
import { describe, expect, it, afterAll, beforeAll } from 'vitest'
import { replayScript, type RecordedScript } from './recordedScript'

/**
 * A real, local HTTP page — no mocking, the real downloaded Chromium
 * binary genuinely launches, navigates, clicks, and reads the real DOM.
 * Mirrors the real page shape used throughout this project's own real
 * e2e checks (a button whose click changes a status heading).
 */
let server: Server
let url: string

beforeAll(async () => {
  const html = `<!doctype html><html><body>
    <h1 id="status">Not clicked</h1>
    <button id="btn">Click me</button>
    <input id="name-input" data-testid="name-field" />
    <script>
      document.getElementById('btn').addEventListener('click', () => {
        document.getElementById('status').textContent = 'Clicked!'
      })
    </script>
  </body></html>`
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  url = `http://127.0.0.1:${port}`
}, 20_000)

afterAll(() => {
  server.close()
})

describe('replayScript — real headless browser, no mocking, no API cost', () => {
  it('replays a real click and confirms the real resulting text, by role/name locator', async () => {
    const script: RecordedScript = {
      url,
      steps: [{ action: 'click', locator: { kind: 'role', role: 'button', name: 'Click me' } }],
      assertions: [{ kind: 'containsText', expected: 'Clicked!' }],
      recordedAt: new Date().toISOString(),
    }
    const result = await replayScript(script)
    expect(result).toEqual({ success: true })
  }, 20_000)

  it('replays a real click by text locator', async () => {
    const script: RecordedScript = {
      url,
      steps: [{ action: 'click', locator: { kind: 'text', text: 'Click me' } }],
      assertions: [{ kind: 'containsText', expected: 'Clicked!' }],
      recordedAt: new Date().toISOString(),
    }
    expect(await replayScript(script)).toEqual({ success: true })
  }, 20_000)

  it('replays a real fill by testId locator', async () => {
    const script: RecordedScript = {
      url,
      steps: [{ action: 'fill', locator: { kind: 'testId', testId: 'name-field' }, value: 'hello' }],
      assertions: [],
      recordedAt: new Date().toISOString(),
    }
    expect(await replayScript(script)).toEqual({ success: true })
  }, 20_000)

  it('fails honestly when the assertion does not hold — the page genuinely does not contain the expected text', async () => {
    const script: RecordedScript = {
      url,
      steps: [],
      assertions: [{ kind: 'containsText', expected: 'This text is never on the page' }],
      recordedAt: new Date().toISOString(),
    }
    const result = await replayScript(script)
    expect(result.success).toBe(false)
    expect(result.error).toContain("didn't")
  }, 20_000)

  it('supports notContainsText — fails honestly when the forbidden text IS present', async () => {
    const script: RecordedScript = {
      url,
      steps: [],
      assertions: [{ kind: 'notContainsText', expected: 'Not clicked' }],
      recordedAt: new Date().toISOString(),
    }
    const result = await replayScript(script)
    expect(result.success).toBe(false)
  }, 20_000)

  it('fails honestly (not a crash) when the recorded locator no longer matches anything — a genuinely broken script', async () => {
    const script: RecordedScript = {
      url,
      steps: [{ action: 'click', locator: { kind: 'role', role: 'button', name: 'This button does not exist' } }],
      assertions: [],
      recordedAt: new Date().toISOString(),
    }
    const result = await replayScript(script, { timeoutMs: 2_000 })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  }, 20_000)

  it('fails honestly when the page itself is unreachable, never throwing', async () => {
    const script: RecordedScript = {
      url: 'http://127.0.0.1:1',
      steps: [],
      assertions: [],
      recordedAt: new Date().toISOString(),
    }
    const result = await replayScript(script, { timeoutMs: 2_000 })
    expect(result.success).toBe(false)
  }, 20_000)
})
