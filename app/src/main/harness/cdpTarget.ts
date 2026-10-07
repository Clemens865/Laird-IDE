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
    const match = targets.find((t) => t.url === pageUrl)
    return match?.webSocketDebuggerUrl ?? null
  } catch (err) {
    console.error('[cdpTarget] failed to resolve the real CDP target', err)
    return null
  }
}
