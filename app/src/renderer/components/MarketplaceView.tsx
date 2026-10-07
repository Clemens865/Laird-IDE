import { useEffect, useMemo, useState } from 'react'

interface AvailablePlugin {
  pluginId: string
  name: string
  description: string
  marketplaceName: string
  installCount?: number
}

interface PluginDetails {
  skillsCount: number
  agentsCount: number
  hooksCount: number
  mcpServersCount: number
  lspServersCount: number
  alwaysOnTokenCost: number | null
}

interface SecretScanResult {
  clean: boolean
  findings: Array<{ label: string; path: string }>
}

interface InstallResult {
  outcome: 'ok' | 'error'
  message: string
  details?: PluginDetails
  secretScan?: SecretScanResult
}

type RowState = { status: 'installing' } | { status: 'done'; result: InstallResult } | { status: 'error'; result: InstallResult }

const VISIBLE_CAP = 50

function VerifySummary({ result }: { result: InstallResult }) {
  if (result.outcome === 'error') {
    return (
      <div style={{ fontSize: 11.5, color: 'var(--state-danger)', marginTop: 6 }} data-testid="marketplace-verify-result">
        Install failed: {result.message}
      </div>
    )
  }
  const d = result.details
  const scan = result.secretScan
  return (
    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }} data-testid="marketplace-verify-result">
      {d && (
        <div className="mono">
          {d.skillsCount} skill{d.skillsCount === 1 ? '' : 's'} · {d.agentsCount} agent{d.agentsCount === 1 ? '' : 's'} ·{' '}
          {d.hooksCount} hook{d.hooksCount === 1 ? '' : 's'} · {d.mcpServersCount} MCP server{d.mcpServersCount === 1 ? '' : 's'}
          {d.alwaysOnTokenCost !== null && <> · ~{d.alwaysOnTokenCost} tok always-on</>}
        </div>
      )}
      {scan && (
        <div style={{ color: scan.clean ? 'var(--codex)' : 'var(--state-danger)', marginTop: 2 }} data-testid="marketplace-scan-result">
          {scan.clean
            ? 'Secret scan: nothing flagged (heuristic, not a security vetting).'
            : `Secret scan flagged ${scan.findings.length} possible issue${scan.findings.length === 1 ? '' : 's'}: ${scan.findings
                .map((f) => `${f.label} in ${f.path}`)
                .join('; ')}`}
        </div>
      )}
    </div>
  )
}

/**
 * A thin visual browser over Claude Code's own real plugin marketplace
 * mechanism (docs/prd/technical/skills-and-plugins.md) — browses/installs
 * from marketplaces already configured on this machine. Adding a brand-new
 * custom marketplace from Laird's own UI, and surfacing the `ruflo`
 * marketplace specifically, are deliberately out of scope here (backlogged,
 * see roadmap-and-open-questions.md), not forgotten.
 */
export function MarketplaceView() {
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState<AvailablePlugin[]>([])
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [rowState, setRowState] = useState<Record<string, RowState>>({})

  useEffect(() => {
    let cancelled = false
    window.laird.marketplace.browse().then((result) => {
      if (!cancelled) {
        setAvailable(result.available)
        setInstalledIds(new Set(result.installedIds))
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? available.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) : available
    return filtered.slice(0, VISIBLE_CAP)
  }, [available, query])

  async function handleInstall(pluginId: string) {
    setRowState((prev) => ({ ...prev, [pluginId]: { status: 'installing' } }))
    const result = await window.laird.marketplace.install({ pluginId })
    setRowState((prev) => ({ ...prev, [pluginId]: { status: result.outcome === 'ok' ? 'done' : 'error', result } }))
    if (result.outcome === 'ok') setInstalledIds((prev) => new Set(prev).add(pluginId))
  }

  async function handleUninstall(pluginId: string) {
    await window.laird.marketplace.uninstall({ pluginId })
    setInstalledIds((prev) => {
      const next = new Set(prev)
      next.delete(pluginId)
      return next
    })
    setRowState((prev) => {
      const next = { ...prev }
      delete next[pluginId]
      return next
    })
  }

  if (loading) {
    return (
      <div className="skills-view" data-testid="marketplace-view">
        <span className="mono" style={{ color: 'var(--muted)' }}>
          Loading…
        </span>
      </div>
    )
  }

  return (
    <div className="skills-view" data-testid="marketplace-view">
      <div
        className="skills-section-empty"
        data-testid="marketplace-disclosure"
        style={{ background: 'var(--state-warning-soft)', color: 'var(--ink-2)', borderRadius: 10, padding: '10px 12px', fontStyle: 'normal' }}
      >
        Installed plugins run with your account's permissions and are not sandboxed — review before installing.
      </div>

      <div className="skills-section">
        <div className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Plugin marketplace
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', fontStyle: 'normal' }}>
            {available.length} available
          </span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plugins by name or description…"
          data-testid="marketplace-search"
          style={{
            width: '100%',
            fontSize: 12.5,
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: '8px 11px',
            background: 'var(--surface-raised)',
            color: 'var(--ink)',
            marginBottom: 10,
          }}
        />
        {visible.length === 0 ? (
          <div className="skills-section-empty">No plugins match "{query}".</div>
        ) : (
          visible.map((plugin) => {
            const installed = installedIds.has(plugin.pluginId)
            const state = rowState[plugin.pluginId]
            return (
              <div className="row-card" key={plugin.pluginId} data-testid="marketplace-row" data-plugin-id={plugin.pluginId} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{plugin.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {plugin.description}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>
                      {plugin.marketplaceName}
                      {typeof plugin.installCount === 'number' && <> · {plugin.installCount.toLocaleString()} installs</>}
                    </div>
                  </div>
                  {installed ? (
                    <div
                      className="btn"
                      onClick={() => handleUninstall(plugin.pluginId)}
                      data-testid="marketplace-uninstall-button"
                      style={{ cursor: 'pointer', opacity: 0.8 }}
                    >
                      Remove
                    </div>
                  ) : (
                    <div
                      className="btn"
                      onClick={state?.status === 'installing' ? undefined : () => handleInstall(plugin.pluginId)}
                      data-testid="marketplace-install-button"
                      style={{ cursor: state?.status === 'installing' ? 'default' : 'pointer', opacity: state?.status === 'installing' ? 0.6 : 1 }}
                    >
                      {state?.status === 'installing' ? 'Installing…' : 'Install'}
                    </div>
                  )}
                </div>
                {state && state.status !== 'installing' && <VerifySummary result={state.result} />}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
