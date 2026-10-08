import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { shell } from 'electron'

/** Dominates any real listing with noise if left in — not real `.gitignore` parsing (a deliberate v1 scope cut; see the plan), just the common offenders. */
const NOISE_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '__pycache__',
  'venv',
  '.venv',
  '.laird-worktrees',
])

const MAX_DIRECTORY_ENTRIES = 2_000
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'])
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}
const BINARY_EXTENSIONS = new Set([
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf',
  '.mp3', '.mp4', '.mov', '.wav', '.avi',
  '.wasm', '.node', '.db', '.sqlite',
])

export type FileKind = 'markdown' | 'image' | 'text' | 'binary'

export interface FileEntry {
  name: string
  isDirectory: boolean
  sizeBytes: number | null
}

export interface DirectoryListing {
  entries: FileEntry[]
  truncated: boolean
}

export type FilePreview =
  | { kind: 'markdown' | 'text'; content: string; sizeBytes: number }
  | { kind: 'image'; content: string; sizeBytes: number }
  | { kind: 'binary'; sizeBytes: number }
  | { kind: 'too-large'; sizeBytes: number }

/** Extension-only, no content sniffing — simple and predictable, matches `classifyFile`'s own doc intent in the plan. */
export function classifyFile(name: string): FileKind {
  const ext = extname(name).toLowerCase()
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (BINARY_EXTENSIONS.has(ext)) return 'binary'
  return 'text'
}

/**
 * One directory level only — a lazily-expanding tree, not a recursive
 * dump, so cost stays bounded regardless of the noise-dir filter's own
 * limits. `absoluteDir` must already be containment-checked by the caller
 * (`security.ts`'s `resolveWithinProject`) — this function trusts it.
 */
export function listDirectory(absoluteDir: string): DirectoryListing {
  const names = readdirSync(absoluteDir, { withFileTypes: true })
    .filter((d) => !NOISE_DIR_NAMES.has(d.name))
    .map((d) => {
      const isDirectory = d.isDirectory()
      let sizeBytes: number | null = null
      if (!isDirectory) {
        try {
          sizeBytes = statSync(`${absoluteDir}/${d.name}`).size
        } catch {
          sizeBytes = null
        }
      }
      return { name: d.name, isDirectory, sizeBytes }
    })

  names.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const truncated = names.length > MAX_DIRECTORY_ENTRIES
  return { entries: truncated ? names.slice(0, MAX_DIRECTORY_ENTRIES) : names, truncated }
}

/**
 * Always returns an honest `kind` rather than guessing — a caller never
 * has to infer "previewable or not" from a thrown error. `absolutePath`
 * must already be containment-checked by the caller.
 */
export function readFilePreview(absolutePath: string): FilePreview {
  const stat = statSync(absolutePath)
  if (stat.size > MAX_PREVIEW_BYTES) {
    return { kind: 'too-large', sizeBytes: stat.size }
  }

  const kind = classifyFile(absolutePath)
  if (kind === 'binary') {
    return { kind: 'binary', sizeBytes: stat.size }
  }
  if (kind === 'image') {
    const ext = extname(absolutePath).toLowerCase()
    const mime = IMAGE_MIME_BY_EXT[ext] ?? 'application/octet-stream'
    const base64 = readFileSync(absolutePath).toString('base64')
    return { kind: 'image', content: `data:${mime};base64,${base64}`, sizeBytes: stat.size }
  }
  return { kind, content: readFileSync(absolutePath, 'utf8'), sizeBytes: stat.size }
}

export function pathExists(absolutePath: string): boolean {
  return existsSync(absolutePath)
}

/**
 * Thin, injectable wrapper around `shell.openPath` — same DI seam as
 * `spawnFn`/`waitForPortFn`/`launchFn` elsewhere in this codebase, so the
 * real v1 "edit" path (open in the user's own default app) is unit-
 * testable without ever launching a real OS process.
 */
export async function openExternal(
  absolutePath: string,
  opts: { openPathFn?: (path: string) => Promise<string> } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const openPathFn = opts.openPathFn ?? shell.openPath
  const result = await openPathFn(absolutePath)
  // Electron's own contract: resolves with an empty string on success, or
  // a human-readable error message on failure — never rejects.
  return result ? { ok: false, message: result } : { ok: true }
}
