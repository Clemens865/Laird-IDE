// Workstream I (product pillar 5) — Finder-style file/document access.
// Real, free (no `claude` calls) e2e check against the real built app: a
// real scratch project with real text/markdown/image/node_modules files on
// disk, browsed through the real Files view and real IPC — not mocked.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failed = false
function check(name, cond) {
  if (cond) {
    console.log(`[files-view] PASS: ${name}`)
  } else {
    console.error(`[files-view] FAIL: ${name}`)
    failed = true
  }
}

async function addProject(window, projectPath) {
  await window.locator('[data-testid="add-project-button"]').click()
  await window.locator('[data-testid="new-project-path-input"]').fill(projectPath)
  await window.locator('[data-testid="confirm-add-project"]').click()
}

// A real, valid 1x1 transparent PNG.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const userDataDir = mkdtempSync(path.join(tmpdir(), 'laird-e2e-files-userdata-'))
const app = await electron.launch({ args: [`--user-data-dir=${userDataDir}`, path.join(root, 'out/main/index.js')], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 10_000 })

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'laird-e2e-files-'))
  writeFileSync(path.join(scratchDir, 'README.md'), '# Hello from a real markdown file\n\nSome real body text.')
  writeFileSync(path.join(scratchDir, 'index.ts'), 'export const greeting = "hi"')
  writeFileSync(path.join(scratchDir, 'logo.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  mkdirSync(path.join(scratchDir, 'src'))
  writeFileSync(path.join(scratchDir, 'src', 'nested.ts'), 'export const nested = true')
  mkdirSync(path.join(scratchDir, 'node_modules', 'some-pkg'), { recursive: true })
  writeFileSync(path.join(scratchDir, 'node_modules', 'some-pkg', 'index.js'), '// should never be listed')

  await addProject(window, scratchDir)
  await window.waitForSelector('[data-testid="project-tab"]', { timeout: 5_000 })
  const projectId = await window.locator('[data-testid="project-tab"]').getAttribute('data-project-id')

  await window.locator('[data-testid="toggle-files-button"]').click()
  await window.waitForSelector('[data-testid="files-view"]', { timeout: 5_000 })
  await window.waitForSelector('[data-testid="files-tree-file"]', { timeout: 5_000 })

  const treeText = await window.locator('[data-testid="files-tree"]').innerText()
  check('tree shows real top-level files', treeText.includes('README.md') && treeText.includes('index.ts') && treeText.includes('logo.png'))
  check('tree shows the real subdirectory', treeText.includes('src'))
  check('node_modules is excluded from the real listing', !treeText.includes('node_modules'))

  check('no file selected yet shows the empty-state preview', (await window.locator('[data-testid="files-preview-empty"]').count()) === 1)

  await window.locator('[data-testid="files-tree-file"][data-path="README.md"]').click()
  await window.waitForSelector('[data-testid="files-preview-markdown"]', { timeout: 5_000 })
  const markdownText = await window.locator('[data-testid="files-preview-markdown"]').innerText()
  check('markdown file renders its real content', markdownText.includes('Hello from a real markdown file') && markdownText.includes('Some real body text'))

  await window.locator('[data-testid="files-tree-file"][data-path="index.ts"]').click()
  await window.waitForSelector('[data-testid="files-preview-text"]', { timeout: 5_000 })
  const textContent = await window.locator('[data-testid="files-preview-text"]').innerText()
  check('text file renders its real raw content', textContent === 'export const greeting = "hi"')

  await window.locator('[data-testid="files-tree-file"][data-path="logo.png"]').click()
  await window.waitForSelector('[data-testid="files-preview-image"]', { timeout: 5_000 })
  const imgSrc = await window.locator('[data-testid="files-preview-image"]').getAttribute('src')
  check('image file renders as a real base64 data URI', imgSrc?.startsWith('data:image/png;base64,') === true)

  // Expand the real subdirectory and select its real nested file.
  await window.locator('[data-testid="files-tree-dir"]', { hasText: 'src' }).click()
  await window.waitForSelector('[data-testid="files-tree-file"][data-path="src/nested.ts"]', { timeout: 5_000 })
  await window.locator('[data-testid="files-tree-file"][data-path="src/nested.ts"]').click()
  await window.waitForSelector('[data-testid="files-preview-text"]', { timeout: 5_000 })
  const nestedContent = await window.locator('[data-testid="files-preview-text"]').innerText()
  check('nested file under an expanded real subdirectory renders its real content', nestedContent === 'export const nested = true')

  // A real path-traversal attempt must be refused by the real main-process
  // handler, not silently normalized — exercised through the real IPC
  // bridge directly, since the UI itself never constructs such a path.
  const traversalResult = await window.evaluate(async (pid) => {
    try {
      await window.laird.files.read({ projectId: pid, relativePath: '../../etc/passwd' })
      return { threw: false }
    } catch (err) {
      return { threw: true, message: String(err?.message ?? err) }
    }
  }, projectId)
  check('a real ../ traversal attempt through the IPC bridge is refused, not silently normalized', traversalResult.threw && /outside the project/.test(traversalResult.message))

  await window.screenshot({ path: '/tmp/laird-files-view.png' })
  console.log('[files-view] screenshot saved to /tmp/laird-files-view.png')
} finally {
  await app.close()
}

process.exit(failed ? 1 : 0)
