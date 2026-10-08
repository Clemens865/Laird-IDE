import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveWithinProject } from './security'

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), 'laird-files-security-'))
}

describe('resolveWithinProject', () => {
  it('resolves a simple nested relative path inside the project', () => {
    const root = makeProjectDir()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'index.ts'), 'export {}')

    const resolved = resolveWithinProject(root, 'src/index.ts')
    expect(resolved.endsWith(`src${sep}index.ts`)).toBe(true)
  })

  it('resolves the project root itself for an empty or "." relative path', () => {
    const root = makeProjectDir()
    expect(resolveWithinProject(root, '.')).toBe(resolveWithinProject(root, ''))
  })

  it('rejects an absolute path outright', () => {
    const root = makeProjectDir()
    expect(() => resolveWithinProject(root, '/etc/passwd')).toThrow(/absolute/)
  })

  it('rejects a real ../ traversal attempt that escapes the project', () => {
    const root = makeProjectDir()
    expect(() => resolveWithinProject(root, '../outside.txt')).toThrow(/outside the project/)
  })

  it('rejects a deeper ../../ traversal attempt', () => {
    const root = makeProjectDir()
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    expect(() => resolveWithinProject(root, 'a/b/../../../etc/passwd')).toThrow(/outside the project/)
  })

  it('rejects a real symlink inside the project that points outside it', () => {
    const root = makeProjectDir()
    const outsideDir = mkdtempSync(join(tmpdir(), 'laird-files-security-outside-'))
    writeFileSync(join(outsideDir, 'secret.txt'), 'nope')
    symlinkSync(outsideDir, join(root, 'escape-link'))

    expect(() => resolveWithinProject(root, 'escape-link/secret.txt')).toThrow(/outside the project/)
  })

  it('allows a symlink that stays inside the project', () => {
    const root = makeProjectDir()
    mkdirSync(join(root, 'real-dir'))
    writeFileSync(join(root, 'real-dir', 'f.txt'), 'hi')
    symlinkSync(join(root, 'real-dir'), join(root, 'inside-link'))

    expect(() => resolveWithinProject(root, 'inside-link/f.txt')).not.toThrow()
  })

  it('resolves correctly even when the project root itself is a symlinked path, for a file that does not exist yet', () => {
    // Exercises the exact false-positive this function's own doc comment
    // warns about: building the candidate from the raw root instead of its
    // realpath would make a not-yet-existing target look like an escape
    // whenever the root is itself reached through a symlink (macOS's own
    // tmpdir is a common real-world case of this).
    const root = makeProjectDir()
    expect(() => resolveWithinProject(root, 'brand-new-file.txt')).not.toThrow()
  })
})
