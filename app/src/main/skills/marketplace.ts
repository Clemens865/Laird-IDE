import { execFile } from 'node:child_process'
import { readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * A thin UI over Claude Code's own real plugin marketplace mechanism — per
 * docs/prd/technical/skills-and-plugins.md, Laird never reinvents this, it
 * shells out to the exact same `claude plugin` CLI a user would type
 * themselves, confirmed live command-by-command (Workstream E). Scoped
 * deliberately: browsing/installing from marketplaces already configured on
 * this machine, not adding a brand-new custom marketplace from Laird's own
 * UI — that, and surfacing the `ruflo` marketplace specifically, are
 * backlogged (see roadmap-and-open-questions.md), not forgotten.
 */

export interface MarketplaceEntry {
  name: string
  source: string
  url?: string
  repo?: string
  installLocation: string
}

export interface AvailablePlugin {
  pluginId: string
  name: string
  description: string
  marketplaceName: string
  installCount?: number
}

export interface BrowseResult {
  installedIds: string[]
  available: AvailablePlugin[]
}

export interface PluginDetails {
  description: string
  skillsCount: number
  skillNames: string[]
  agentsCount: number
  agentNames: string[]
  hooksCount: number
  mcpServersCount: number
  lspServersCount: number
  /** `null` when the CLI's own text output couldn't be parsed — never fabricated. */
  alwaysOnTokenCost: number | null
}

export interface SecretScanResult {
  clean: boolean
  /** A label + relative path per finding — never the matched secret value itself. */
  findings: Array<{ label: string; path: string }>
}

export interface InstallResult {
  outcome: 'ok' | 'error'
  message: string
  details?: PluginDetails
  secretScan?: SecretScanResult
}

export interface UninstallResult {
  outcome: 'ok' | 'error'
  message: string
}

/** `claude plugin marketplace list --json` — free, no API cost. */
export async function listMarketplaces(): Promise<MarketplaceEntry[]> {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'marketplace', 'list', '--json'])
    return JSON.parse(stdout) as MarketplaceEntry[]
  } catch (err) {
    console.error('[marketplace] failed to list marketplaces', err)
    return []
  }
}

/**
 * `claude plugin list --available --json` — the real catalog across every
 * configured marketplace (thousands of entries on a machine with the
 * official marketplace added; confirmed live). `maxBuffer` raised well past
 * Node's 1MB default since this payload is genuinely large.
 */
export async function browsePlugins(): Promise<BrowseResult> {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'list', '--available', '--json'], {
      maxBuffer: 1024 * 1024 * 32,
    })
    const parsed = JSON.parse(stdout) as {
      installed: Array<{ id: string }>
      available: Array<{ pluginId: string; name: string; description?: string; marketplaceName?: string; installCount?: number }>
    }
    return {
      installedIds: parsed.installed.map((p) => p.id),
      available: parsed.available.map((p) => ({
        pluginId: p.pluginId,
        name: p.name,
        description: p.description ?? '',
        marketplaceName: p.marketplaceName ?? '',
        installCount: p.installCount,
      })),
    }
  } catch (err) {
    console.error('[marketplace] failed to browse available plugins', err)
    return { installedIds: [], available: [] }
  }
}

/**
 * `claude plugin details <id>` — real, but plain text, not `--json` (the
 * CLI doesn't offer one for this command, confirmed live). Parsed
 * defensively: a field this can't find stays at a safe zero/null rather
 * than throwing, since this text format isn't a stable contract. Only
 * works on an *installed* plugin — the CLI has no pre-install manifest
 * fetch, confirmed live (`details` on a merely-available plugin errors
 * "not found"), which is why this is called right after install, not before.
 */
export function parsePluginDetails(text: string): PluginDetails {
  const match = (re: RegExp): RegExpMatchArray | null => text.match(re)

  const description = match(/^\s*Description:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const skills = match(/^\s*Skills \((\d+)\)\s*(.*)$/m)
  const agents = match(/^\s*Agents \((\d+)\)\s*(.*)$/m)
  const hooks = match(/^\s*Hooks \((\d+)\)/m)
  const mcp = match(/^\s*MCP servers \((\d+)\)/m)
  const lsp = match(/^\s*LSP servers \((\d+)\)/m)
  const tokenCost = match(/Always-on:\s*~?([\d,]+)\s*tok/)

  const parseNames = (raw?: string): string[] =>
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().split(/\s{2,}/)[0]) // drop a trailing explanatory note, e.g. "playwright  (tool schemas resolved...)"
      .filter(Boolean)

  return {
    description,
    skillsCount: skills ? Number(skills[1]) : 0,
    skillNames: parseNames(skills?.[2]),
    agentsCount: agents ? Number(agents[1]) : 0,
    agentNames: parseNames(agents?.[2]),
    hooksCount: hooks ? Number(hooks[1]) : 0,
    mcpServersCount: mcp ? Number(mcp[1]) : 0,
    lspServersCount: lsp ? Number(lsp[1]) : 0,
    alwaysOnTokenCost: tokenCost ? Number(tokenCost[1].replace(/,/g, '')) : null,
  }
}

async function getPluginDetails(pluginId: string): Promise<PluginDetails | undefined> {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'details', pluginId])
    return parsePluginDetails(stdout)
  } catch (err) {
    console.error('[marketplace] failed to read plugin details', err)
    return undefined
  }
}

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { label: 'private key block', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'Slack token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: 'generic API key/secret assignment', pattern: /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i },
]
const SCAN_SKIP_DIRS = new Set(['.git', 'node_modules'])
const SCAN_MAX_FILES = 500
const SCAN_MAX_FILE_BYTES = 256 * 1024

/**
 * A heuristic, not a real security vetting — the honest limitation this
 * project already applies consistently elsewhere (see permissions.ts's own
 * denylist caveat). Flags a label and relative path only, never the
 * matched text itself, so a real secret is never echoed back into Laird's
 * own UI/logs.
 */
export function scanForSecrets(rootDir: string): SecretScanResult {
  const findings: SecretScanResult['findings'] = []
  let filesScanned = 0

  function walk(dir: string): void {
    if (filesScanned >= SCAN_MAX_FILES) return
    let entries: Dirent<string>[]
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }
    for (const entry of entries) {
      if (filesScanned >= SCAN_MAX_FILES) return
      if (SCAN_SKIP_DIRS.has(entry.name)) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      try {
        if (statSync(fullPath).size > SCAN_MAX_FILE_BYTES) continue
        const content = readFileSync(fullPath, 'utf8')
        filesScanned++
        for (const { label, pattern } of SECRET_PATTERNS) {
          if (pattern.test(content)) {
            findings.push({ label, path: fullPath.slice(rootDir.length + 1) })
          }
        }
      } catch {
        // Unreadable or binary — skip, don't fail the whole scan over one file.
      }
    }
  }

  walk(rootDir)
  return { clean: findings.length === 0, findings }
}

async function findInstallPath(pluginId: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'list', '--json'])
    const installed = JSON.parse(stdout) as Array<{ id: string; installPath: string }>
    return installed.find((p) => p.id === pluginId)?.installPath
  } catch (err) {
    console.error('[marketplace] failed to resolve the installed plugin\'s path', err)
    return undefined
  }
}

function lastJsonLine(stdout: string): { outcome?: string; message?: string } {
  const lines = stdout.trim().split('\n')
  try {
    return JSON.parse(lines[lines.length - 1] ?? '{}')
  } catch {
    return {}
  }
}

/**
 * Installs via the real CLI, then immediately verifies: real component
 * inventory + token cost (`details`) and a real heuristic secret scan over
 * the real installed files — surfaced together so a user sees what they
 * actually got before they've used it in a real session, with an easy way
 * to remove it again if something looks wrong (see `uninstallPlugin`).
 */
export async function installPlugin(pluginId: string): Promise<InstallResult> {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'install', pluginId, '-y', '--json'])
    const result = lastJsonLine(stdout)
    if (result.outcome !== 'ok') {
      return { outcome: 'error', message: result.message ?? 'Install did not report success.' }
    }

    const details = await getPluginDetails(pluginId)
    const installPath = await findInstallPath(pluginId)
    const secretScan = installPath ? scanForSecrets(installPath) : undefined

    return { outcome: 'ok', message: result.message ?? `Installed ${pluginId}.`, details, secretScan }
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr
    return { outcome: 'error', message: stderr || (err instanceof Error ? err.message : String(err)) }
  }
}

export async function uninstallPlugin(pluginId: string): Promise<UninstallResult> {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'uninstall', pluginId, '-y', '--json'])
    const result = lastJsonLine(stdout)
    return { outcome: result.outcome === 'ok' ? 'ok' : 'error', message: result.message ?? '' }
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr
    return { outcome: 'error', message: stderr || (err instanceof Error ? err.message : String(err)) }
  }
}
