import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectTestCommand, runTestCommand, testRunToCriterionResult } from './testRunner'

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'laird-test-runner-'))
}

describe('detectTestCommand', () => {
  it('returns null when nothing recognizable is found', () => {
    expect(detectTestCommand(scratchDir())).toBeNull()
  })

  it('proposes "npm test" when package.json has a real test script', () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }))
    expect(detectTestCommand(dir)).toEqual({ command: 'npm test' })
  })

  it('proposes "pytest" for a pyproject.toml project', () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'pyproject.toml'), '[tool.pytest]')
    expect(detectTestCommand(dir)).toEqual({ command: 'pytest' })
  })

  it('proposes "cargo test" for a Cargo.toml project', () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'Cargo.toml'), '[package]')
    expect(detectTestCommand(dir)).toEqual({ command: 'cargo test' })
  })
})

describe('runTestCommand — real, free process execution (no mocking, no API cost)', () => {
  it('reports exit code 0 for a real passing command', async () => {
    const result = await runTestCommand(process.cwd(), 'exit 0')
    expect(result).toMatchObject({ exitCode: 0, timedOut: false })
  })

  it('reports a real non-zero exit code for a real failing command', async () => {
    const result = await runTestCommand(process.cwd(), 'exit 7')
    expect(result).toMatchObject({ exitCode: 7, timedOut: false })
  })

  it('captures real stdout/stderr output', async () => {
    const result = await runTestCommand(process.cwd(), 'echo hello-from-real-test-command')
    expect(result.output).toContain('hello-from-real-test-command')
  })

  it('kills a real hung command after the timeout and reports timedOut', async () => {
    const result = await runTestCommand(process.cwd(), 'sleep 60', { timeoutMs: 100 })
    expect(result.timedOut).toBe(true)
  }, 10_000)

  it('kills a real running command when the signal aborts, and reports canceled', async () => {
    const controller = new AbortController()
    const resultPromise = runTestCommand(process.cwd(), 'sleep 60', { signal: controller.signal })
    await new Promise((r) => setTimeout(r, 100))
    controller.abort()
    const result = await resultPromise
    expect(result).toMatchObject({ canceled: true, timedOut: false })
  }, 10_000)
})

describe('testRunToCriterionResult', () => {
  it('maps exit code 0 to ship/VERIFIED', () => {
    const result = testRunToCriterionResult('The tests should pass', 'npm test', { exitCode: 0, output: '', timedOut: false, canceled: false })
    expect(result).toMatchObject({ disposition: 'ship', evidenceTier: 'VERIFIED' })
  })

  it('maps a non-zero exit code to rework/VERIFIED, not a guess', () => {
    const result = testRunToCriterionResult('The tests should pass', 'npm test', { exitCode: 1, output: '', timedOut: false, canceled: false })
    expect(result).toMatchObject({ disposition: 'rework', evidenceTier: 'VERIFIED' })
  })

  it('maps a timeout to an honest unverifiable, not a guessed ship or rework', () => {
    const result = testRunToCriterionResult('The tests should pass', 'npm test', { exitCode: null, output: '', timedOut: true, canceled: false })
    expect(result).toMatchObject({ disposition: 'unverifiable', evidenceTier: 'STATED' })
  })

  it('maps a cancellation to an honest unverifiable, distinct from a timeout', () => {
    const result = testRunToCriterionResult('The tests should pass', 'npm test', { exitCode: null, output: '', timedOut: false, canceled: true })
    expect(result).toMatchObject({ disposition: 'unverifiable', evidenceTier: 'STATED' })
    expect(result.rationale).toContain('Canceled')
  })
})
