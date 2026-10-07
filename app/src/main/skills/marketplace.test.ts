import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { browsePlugins, listMarketplaces, parsePluginDetails, scanForSecrets } from './marketplace'

describe('parsePluginDetails', () => {
  // Real captured `claude plugin details` output (Workstream E live spike) — not synthesized.
  it('parses a plugin with skills, agents, and a real token cost', () => {
    const text = `agent-sdk-dev
  Description: Development kit for working with the Claude Agent SDK
  Source: agent-sdk-dev@claude-plugins-official

Component inventory
  Skills (1)  new-sdk-app
  Agents (2)  agent-sdk-verifier-ts, agent-sdk-verifier-py
  Hooks (0)
  MCP servers (0)
  LSP servers (0)

Projected token cost
  Always-on:   ~233 tok   added to every session
`
    const details = parsePluginDetails(text)
    expect(details).toMatchObject({
      description: 'Development kit for working with the Claude Agent SDK',
      skillsCount: 1,
      skillNames: ['new-sdk-app'],
      agentsCount: 2,
      agentNames: ['agent-sdk-verifier-ts', 'agent-sdk-verifier-py'],
      hooksCount: 0,
      mcpServersCount: 0,
      lspServersCount: 0,
      alwaysOnTokenCost: 233,
    })
  })

  it('parses a plugin with an MCP server, stripping the trailing explanatory note from its name', () => {
    const text = `playwright
  Description: Browser automation and end-to-end testing MCP server by Microsoft.
  Source: playwright@claude-plugins-official

Component inventory
  Skills (0)
  Agents (0)
  Hooks (0)
  MCP servers (1)  playwright  (tool schemas resolved at runtime; not counted)
  LSP servers (0)

Projected token cost
  Always-on:   ~0 tok   added to every session
`
    const details = parsePluginDetails(text)
    expect(details.mcpServersCount).toBe(1)
  })

  it('never throws on unparseable text — safe zeros/nulls instead', () => {
    expect(() => parsePluginDetails('garbage, not the expected format at all')).not.toThrow()
    const details = parsePluginDetails('garbage')
    expect(details).toMatchObject({ skillsCount: 0, agentsCount: 0, hooksCount: 0, mcpServersCount: 0, alwaysOnTokenCost: null })
  })
})

describe('scanForSecrets', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'laird-secret-scan-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reports clean for a directory with no secret-shaped strings', () => {
    writeFileSync(join(root, 'README.md'), '# A perfectly normal plugin\n\nNothing to see here.')
    const result = scanForSecrets(root)
    expect(result).toEqual({ clean: true, findings: [] })
  })

  it('flags a real AWS-access-key-shaped string, by label and path, never the value itself', () => {
    writeFileSync(join(root, 'config.js'), 'const key = "AKIAABCDEFGHIJKLMNOP"')
    const result = scanForSecrets(root)
    expect(result.clean).toBe(false)
    expect(result.findings).toEqual([{ label: 'AWS access key', path: 'config.js' }])
    expect(JSON.stringify(result)).not.toContain('AKIAABCDEFGHIJKLMNOP')
  })

  it('flags a private key block nested in a subdirectory', () => {
    mkdirSync(join(root, 'certs'), { recursive: true })
    writeFileSync(join(root, 'certs', 'id_rsa'), '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----')
    const result = scanForSecrets(root)
    expect(result.clean).toBe(false)
    expect(result.findings[0]).toMatchObject({ label: 'private key block', path: join('certs', 'id_rsa') })
  })

  it('skips .git and node_modules entirely', () => {
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'dep', 'index.js'), 'const key = "AKIAABCDEFGHIJKLMNOP"')
    const result = scanForSecrets(root)
    expect(result.clean).toBe(true)
  })
})

// Free, read-only, no API cost — same policy as discovery.ts's own listGlobalPlugins test.
describe('listMarketplaces / browsePlugins (real CLI calls, free — no API cost)', () => {
  it('runs the real `claude plugin marketplace list --json` and returns a parsed array', async () => {
    const marketplaces = await listMarketplaces()
    expect(Array.isArray(marketplaces)).toBe(true)
    if (marketplaces.length > 0) {
      expect(marketplaces[0]).toHaveProperty('name')
      expect(marketplaces[0]).toHaveProperty('installLocation')
    }
  })

  it('runs the real `claude plugin list --available --json` and returns the real catalog', async () => {
    const result = await browsePlugins()
    expect(Array.isArray(result.installedIds)).toBe(true)
    expect(Array.isArray(result.available)).toBe(true)
    if (result.available.length > 0) {
      expect(result.available[0]).toHaveProperty('pluginId')
      expect(result.available[0]).toHaveProperty('name')
    }
  })
})
