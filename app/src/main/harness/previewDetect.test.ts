import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectPreviewCommand } from './previewDetect'

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'laird-preview-detect-'))
}

describe('detectPreviewCommand', () => {
  it('returns null when there is no package.json at all', () => {
    expect(detectPreviewCommand(scratchDir())).toBeNull()
  })

  it('returns null when package.json has neither a dev nor a start script', () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }))
    expect(detectPreviewCommand(dir)).toBeNull()
  })

  it('proposes "npm run dev" with the known vite port when a dev script exists and vite is a dependency', () => {
    const dir = scratchDir()
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } }),
    )
    expect(detectPreviewCommand(dir)).toEqual({ command: 'npm run dev', port: 5173 })
  })

  it('proposes "npm start" with the known create-react-app port when only a start script exists', () => {
    const dir = scratchDir()
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { start: 'react-scripts start' }, dependencies: { 'react-scripts': '5.0.1' } }),
    )
    expect(detectPreviewCommand(dir)).toEqual({ command: 'npm start', port: 3000 })
  })

  it('proposes a command with a null port when a dev script exists but the framework is unrecognized', () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'my-custom-runner' } }))
    expect(detectPreviewCommand(dir)).toEqual({ command: 'npm run dev', port: null })
  })

  it('returns null for unparseable JSON rather than throwing', () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'package.json'), 'not json')
    expect(detectPreviewCommand(dir)).toBeNull()
  })
})
