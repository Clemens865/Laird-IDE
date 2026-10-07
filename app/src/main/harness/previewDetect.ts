import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../shared/types'

const FRAMEWORK_PORTS: Array<{ dep: string; port: number }> = [
  { dep: 'vite', port: 5173 },
  { dep: 'next', port: 3000 },
  { dep: 'react-scripts', port: 3000 },
  { dep: '@vue/cli-service', port: 8080 },
]

/**
 * Cheap, read-only, non-executing proposal of a project's own dev
 * command/port (observability-trust-and-harness.md's "detect a likely dev
 * command ... show it to the user as a proposed, editable setting" — same
 * "read a project, never run it" discipline as `skills/recommend.ts`'s
 * `detectStackSignals`). Returns `null` when nothing recognizable is found
 * — never guesses a command blindly.
 */
export function detectPreviewCommand(projectPath: string): Project['uiPreview'] | null {
  const pkgPath = join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) return null

  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }

  const scripts = pkg.scripts ?? {}
  const scriptName = scripts.dev ? 'dev' : scripts.start ? 'start' : null
  if (!scriptName) return null

  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const framework = FRAMEWORK_PORTS.find((f) => deps[f.dep])

  return {
    command: scriptName === 'start' ? 'npm start' : 'npm run dev',
    port: framework?.port ?? null,
  }
}
