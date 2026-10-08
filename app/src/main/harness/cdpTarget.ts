/**
 * Chrome's own CDP target listing normalizes a bare-origin URL with a
 * trailing slash (`http://localhost:48181/`) even when the page was
 * navigated to without one (`http://localhost:48181`) — confirmed live,
 * a real mismatch that silently broke every match until caught by a real
 * end-to-end run (unit tests alone never surfaced it, since they control
 * both sides of the fixture consistently). Comparing on the parsed `href`
 * normalizes both sides the same way the browser does, rather than a
 * fragile trailing-slash special case.
 */
function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href
  } catch {
    return a === b
  }
}

/**
 * Confirms a specific page is currently a real, open CDP target — an
 * existence check before attempting to share it, never a guess. (Does NOT
 * return that page's own `webSocketDebuggerUrl` — a single page's CDP
 * session only supports page-scoped domains, not target management, and
 * connecting Playwright to one directly fails outright with "Target.
 * createTarget: Not supported," confirmed live. See
 * `getBrowserCdpEndpoint` for what a real browser automation tool
 * actually needs.)
 */
export async function cdpTargetExists(cdpPort: number, pageUrl: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`http://127.0.0.1:${cdpPort}/json/list`)
    if (!res.ok) return false
    const targets = (await res.json()) as Array<{ url?: string }>
    return targets.some((t) => t.url && sameUrl(t.url, pageUrl))
  } catch (err) {
    console.error('[cdpTarget] failed to check the real CDP target list', err)
    return false
  }
}

/**
 * The real browser-level CDP endpoint — what Playwright's
 * `connectOverCDP` (and so `@playwright/mcp --cdp-endpoint`) actually
 * needs to manage targets at all. This one endpoint covers *every*
 * top-level WebContents under Laird's `--remote-debugging-port`,
 * including Laird's own chrome window — it doesn't scope access to just
 * the embedded preview by itself. The caller is responsible for steering
 * the reviewer to the right tab (`reviewer.ts`'s own shared-preview
 * prompt, via the real `browser_tabs` list/select tool) rather than
 * trusting whichever tab Playwright happens to default to.
 */
export async function getBrowserCdpEndpoint(cdpPort: number, fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`http://127.0.0.1:${cdpPort}/json/version`)
    if (!res.ok) return null
    const info = (await res.json()) as { webSocketDebuggerUrl?: string }
    return info.webSocketDebuggerUrl ?? null
  } catch (err) {
    console.error('[cdpTarget] failed to resolve the real browser-level CDP endpoint', err)
    return null
  }
}
