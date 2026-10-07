import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import type { HarnessCriterionResult, Project } from '../../shared/types'

const DEFAULT_TIMEOUT_MS = 2 * 60_000
const MAX_OUTPUT_CHARS = 4_000

function hasFile(projectPath: string, file: string): boolean {
  return existsSync(join(projectPath, file))
}

/**
 * Cheap, read-only proposal of a project's own test command — same
 * "detect, propose, never silently run" discipline as `previewDetect.ts`.
 * Returns `null` when nothing recognizable is found; never guesses blindly.
 */
export function detectTestCommand(projectPath: string): Project['testCommand'] | null {
  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
      if (pkg.scripts?.test) return { command: 'npm test' }
    } catch {
      // Falls through to the other-language checks below.
    }
  }
  if (hasFile(projectPath, 'pytest.ini') || hasFile(projectPath, 'pyproject.toml')) return { command: 'pytest' }
  if (hasFile(projectPath, 'Cargo.toml')) return { command: 'cargo test' }
  if (hasFile(projectPath, 'go.mod')) return { command: 'go test ./...' }
  return null
}

export interface TestRunResult {
  exitCode: number | null
  output: string
  timedOut: boolean
}

/**
 * Actually runs a project's own, already-confirmed test command — a real,
 * bounded process execution. Never called without an explicit
 * `Project.testCommand` the user already confirmed (same discipline as
 * `uiPreview`). A hard timeout kills a hung suite rather than blocking a
 * harness run forever; output is truncated, never unbounded.
 */
export function runTestCommand(
  projectPath: string,
  command: string,
  opts: { spawnFn?: typeof spawn; timeoutMs?: number } = {},
): Promise<TestRunResult> {
  const spawnFn = opts.spawnFn ?? spawn
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise((resolve) => {
    const child = spawnFn(command, { cwd: projectPath, shell: true, stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcess
    let output = ''
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    timer.unref()

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: null, output: `${output}\n${err.message}`.trim().slice(0, MAX_OUTPUT_CHARS), timedOut })
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: code, output: output.slice(0, MAX_OUTPUT_CHARS), timedOut })
    })
  })
}

/** Maps a real test-run outcome to a harness result — exit code 0 is the only "ship," never a guess. */
export function testRunToCriterionResult(criterion: string, command: string, result: TestRunResult): HarnessCriterionResult {
  if (result.timedOut) {
    return {
      criterion,
      disposition: 'unverifiable',
      evidenceTier: 'STATED',
      rationale: `The real test command (\`${command}\`) timed out without finishing.`,
    }
  }
  if (result.exitCode === 0) {
    return {
      criterion,
      disposition: 'ship',
      evidenceTier: 'VERIFIED',
      rationale: `The real test command (\`${command}\`) ran and exited successfully (code 0).`,
    }
  }
  return {
    criterion,
    disposition: 'rework',
    evidenceTier: 'VERIFIED',
    rationale: `The real test command (\`${command}\`) failed (exit code ${result.exitCode ?? 'null'}).`,
  }
}
