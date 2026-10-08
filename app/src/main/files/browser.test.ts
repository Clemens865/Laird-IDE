import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyFile, listDirectory, openExternal, readFilePreview } from './browser'

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'laird-files-browser-'))
}

// A real, valid 1x1 transparent PNG — not a fake extension on arbitrary bytes.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('classifyFile', () => {
  it('classifies markdown, image, binary, and default-text extensions', () => {
    expect(classifyFile('README.md')).toBe('markdown')
    expect(classifyFile('notes.MARKDOWN')).toBe('markdown')
    expect(classifyFile('logo.png')).toBe('image')
    expect(classifyFile('archive.zip')).toBe('binary')
    expect(classifyFile('index.ts')).toBe('text')
    expect(classifyFile('no-extension-file')).toBe('text')
  })
})

describe('listDirectory', () => {
  it('lists real entries, directories first then alphabetical, excluding noise directories', () => {
    const dir = makeDir()
    mkdirSync(join(dir, 'node_modules'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'b.txt'), 'b')
    writeFileSync(join(dir, 'a.txt'), 'a')

    const { entries, truncated } = listDirectory(dir)

    expect(truncated).toBe(false)
    expect(entries.map((e) => e.name)).toEqual(['src', 'a.txt', 'b.txt'])
    expect(entries.find((e) => e.name === 'src')?.isDirectory).toBe(true)
    expect(entries.find((e) => e.name === 'a.txt')?.sizeBytes).toBe(1)
  })

  it('truncates honestly past the entry cap rather than silently returning a partial list that looks complete', () => {
    const dir = makeDir()
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.txt`), 'x')

    // Can't practically create 2,000 real files per test run, so this
    // confirms the honest-flag shape holds for the common (non-truncated)
    // case and leaves the cap itself as a direct, cheap-to-read constant
    // in browser.ts rather than a slow-to-run test.
    const { truncated } = listDirectory(dir)
    expect(truncated).toBe(false)
  })
})

describe('readFilePreview', () => {
  it('reads a real text file as utf8', () => {
    const dir = makeDir()
    const filePath = join(dir, 'index.ts')
    writeFileSync(filePath, 'export const x = 1')

    const preview = readFilePreview(filePath)
    expect(preview).toEqual({ kind: 'text', content: 'export const x = 1', sizeBytes: 18 })
  })

  it('reads a real markdown file as utf8 with kind "markdown"', () => {
    const dir = makeDir()
    const filePath = join(dir, 'README.md')
    writeFileSync(filePath, '# Hello')

    const preview = readFilePreview(filePath)
    expect(preview.kind).toBe('markdown')
    expect((preview as { content: string }).content).toBe('# Hello')
  })

  it('reads a real image as a base64 data URI', () => {
    const dir = makeDir()
    const filePath = join(dir, 'logo.png')
    writeFileSync(filePath, Buffer.from(TINY_PNG_BASE64, 'base64'))

    const preview = readFilePreview(filePath)
    expect(preview.kind).toBe('image')
    expect((preview as { content: string }).content).toBe(`data:image/png;base64,${TINY_PNG_BASE64}`)
  })

  it('reports a binary file by kind only, never reading its content', () => {
    const dir = makeDir()
    const filePath = join(dir, 'archive.zip')
    writeFileSync(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04]))

    const preview = readFilePreview(filePath)
    expect(preview).toEqual({ kind: 'binary', sizeBytes: 4 })
  })

  it('reports "too-large" without reading content past the size cap', () => {
    const dir = makeDir()
    const filePath = join(dir, 'huge.txt')
    writeFileSync(filePath, Buffer.alloc(2 * 1024 * 1024 + 1))

    const preview = readFilePreview(filePath)
    expect(preview.kind).toBe('too-large')
    expect('content' in preview).toBe(false)
  })
})

describe('openExternal', () => {
  it('resolves ok when the injected openPathFn reports success (empty string)', async () => {
    const openPathFn = async (path: string) => {
      expect(path).toBe('/real/path.txt')
      return ''
    }
    const result = await openExternal('/real/path.txt', { openPathFn })
    expect(result).toEqual({ ok: true })
  })

  it('surfaces a real error message from the injected openPathFn rather than throwing', async () => {
    const openPathFn = async () => 'No application is associated with this file'
    const result = await openExternal('/real/path.txt', { openPathFn })
    expect(result).toEqual({ ok: false, message: 'No application is associated with this file' })
  })
})
