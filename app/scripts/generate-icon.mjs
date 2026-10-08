// One-off icon generation (Workstream K — distribution) — rasterizes the
// real brand mark (design/assets/surfboard-side-outline.svg, also
// BoardFlip.tsx's own source) onto a 1024x1024 canvas using the app's own
// primary accent color (--codex, #2d9d8f). Not part of the build pipeline:
// run once, check the resulting build/icon.png into the repo as a static
// asset — electron-builder auto-derives .icns (macOS) and .ico (Windows)
// from a single adequately-sized PNG, confirmed in its own docs, so no
// separate icon-conversion dependency is needed.
//
// Run with: node scripts/generate-icon.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const svgSource = readFileSync(join(root, '../design/assets/surfboard-side-outline.svg'), 'utf8')
// Re-stroke the mark white-on-accent for contrast and thicken it — the
// source SVG's own #111111/3px stroke is tuned for a large, light paper
// background, not a flat icon that also needs to read at 16-32px.
const iconSvg = svgSource.replace('stroke="#111111"', 'stroke="#ffffff"').replace('stroke-width="3"', 'stroke-width="9"')

const html = `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; }
  .icon { width: 1024px; height: 1024px; background: #2d9d8f; display: flex; align-items: center; justify-content: center; border-radius: 180px; }
  svg { width: 880px; height: auto; }
</style></head>
<body><div class="icon">${iconSvg}</div></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await page.setContent(html)
const outPath = join(root, 'build/icon.png')
await page.locator('.icon').screenshot({ path: outPath })
await browser.close()

console.log(`[generate-icon] wrote ${outPath}`)
