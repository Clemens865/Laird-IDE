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
 * Resolves the real `webSocketDebuggerUrl` for a specific page among every
 * real CDP target Electron's `--remote-debugging-port` lists (every
 * top-level WebContents, including the embedded live-preview panel and
 * Laird's own chrome) — matched by the real URL it's showing, so the
 * harness's Playwright MCP server (`--cdp-endpoint`) attaches to the exact
 * right one, never guessing which target is which.
 */
export async function findCdpTargetUrl(cdpPort: number, pageUrl: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`http://127.0.0.1:${cdpPort}/json/list`)
    if (!res.ok) return null
    const targets = (await res.json()) as Array<{ url?: string; webSocketDebuggerUrl?: string }>
    const match = targets.find((t) => t.url && sameUrl(t.url, pageUrl))
    return match?.webSocketDebuggerUrl ?? null
  } catch (err) {
    console.error('[cdpTarget] failed to resolve the real CDP target', err)
    return null
  }
}
