import { chromium, type Browser, type Page } from 'playwright-core'

/**
 * Record-once, replay-deterministic for UI checks (observability-trust-
 * and-harness.md's own research: Playwright's 2026 "Test Agents"
 * planner/generator/healer pattern, applied to Laird's own click-through
 * evidence). A successful browser-driven reviewer pass can report the
 * real steps it took; replaying them later needs no LLM at all — free,
 * fast, fully deterministic — and only falls back to a fresh LLM-driven
 * pass again if the saved script actually breaks (the page changed
 * shape), never silently trusting a stale recording.
 *
 * Locators are deliberately restricted to what `@playwright/mcp`'s own
 * accessibility-tree view actually gives the reviewer — it never sees raw
 * CSS, so asking for CSS selectors would just invite hallucination.
 * `role`+`name` matches Playwright's own recommended, most resilient
 * locator strategy directly. Assertions are deliberately coarse (does the
 * *page* now contain this text, not "does this specific element") to
 * sidestep a real, unsolved targeting problem: the one element whose text
 * changed is usually also the one whose accessible *name* just changed,
 * so a role/name locator can't reliably re-find it after the fact.
 */
export type LocatorStrategy = { kind: 'role'; role: string; name: string } | { kind: 'text'; text: string } | { kind: 'testId'; testId: string }

export type RecordedStep = { action: 'click'; locator: LocatorStrategy } | { action: 'fill'; locator: LocatorStrategy; value: string }

export type RecordedAssertion = { kind: 'containsText'; expected: string } | { kind: 'notContainsText'; expected: string }

export interface RecordedScript {
  url: string
  steps: RecordedStep[]
  assertions: RecordedAssertion[]
  recordedAt: string
}

export interface ReplayResult {
  success: boolean
  error?: string
}

function resolveLocator(page: Page, strategy: LocatorStrategy) {
  if (strategy.kind === 'role') return page.getByRole(strategy.role as never, { name: strategy.name })
  if (strategy.kind === 'text') return page.getByText(strategy.text)
  return page.getByTestId(strategy.testId)
}

/**
 * Replays a previously-recorded script against the project's real page —
 * no `claude -p` call, no MCP, just a real headless browser launched
 * directly. Never throws: any failure (element not found, assertion
 * mismatch, navigation timeout) comes back as `{success: false, error}`
 * so the caller can honestly fall back to a fresh LLM-driven check rather
 * than crash the harness run.
 */
export async function replayScript(
  script: RecordedScript,
  opts: { launchFn?: typeof chromium.launch; timeoutMs?: number } = {},
): Promise<ReplayResult> {
  // `chromium.launch` is a bound method — extracting it as a bare
  // reference (`chromium.launch` instead of `chromium.launch.bind(...)`)
  // silently loses its `this`, breaking at runtime with an opaque
  // "Cannot read properties of undefined (reading '_playwright')" rather
  // than a clear error. Confirmed live by the real unit tests below.
  const launchFn = opts.launchFn ?? chromium.launch.bind(chromium)
  const timeoutMs = opts.timeoutMs ?? 15_000
  let browser: Browser | undefined
  try {
    browser = await launchFn({ headless: true })
    const page = await browser.newPage()
    await page.goto(script.url, { timeout: timeoutMs })

    for (const step of script.steps) {
      const locator = resolveLocator(page, step.locator)
      if (step.action === 'click') {
        await locator.click({ timeout: timeoutMs })
      } else {
        await locator.fill(step.value, { timeout: timeoutMs })
      }
    }

    const bodyText = await page.locator('body').innerText({ timeout: timeoutMs })
    for (const assertion of script.assertions) {
      const contains = bodyText.includes(assertion.expected)
      if (assertion.kind === 'containsText' && !contains) {
        return { success: false, error: `Expected the page to contain "${assertion.expected}" after replay, but it didn't.` }
      }
      if (assertion.kind === 'notContainsText' && contains) {
        return { success: false, error: `Expected the page NOT to contain "${assertion.expected}" after replay, but it did.` }
      }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await browser?.close().catch(() => {})
  }
}
