import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * The one new security-sensitive primitive this workstream adds — nothing
 * before it ever accepted a renderer-supplied path into a real file read
 * (every existing read, e.g. `skills/discovery.ts`, only ever builds its
 * own path from `project.path` plus a hardcoded filename). Rejects an
 * absolute input outright (a relative path is the only legitimate shape a
 * file-tree click should ever produce), then resolves *real* paths on both
 * sides — `realpathSync` follows symlinks, so a symlink inside the project
 * pointing outside it (a real, documented traversal vector, not a
 * theoretical one) is caught too, not just a literal `..` sequence.
 */
export function resolveWithinProject(projectRoot: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`Refusing an absolute path: ${relativePath}`)
  }

  // Resolve the root to its real path FIRST, then build the candidate
  // against that same real root — not the other way around. Building the
  // candidate from the raw `projectRoot` and only real-pathing it
  // afterwards would put the two sides of the later containment check in
  // different namespaces whenever `projectRoot` itself is a symlink (a
  // genuinely common case on macOS, where a temp dir is often one) and the
  // target file doesn't exist yet — `/tmp/x/new.txt` vs. the real
  // `/private/tmp/x`'s realpath would look like an escape even though it
  // isn't. Keeping both sides anchored to the same real root from the
  // start avoids that whole class of false positive.
  const realRoot = realpathSync(projectRoot)
  const candidate = resolve(realRoot, relativePath)
  // The candidate itself may not exist yet in every caller's use case
  // (e.g. `openExternal` is about to stat it) — real existence is
  // `browser.ts`'s problem, not this function's; here we only need path
  // *shape* containment, so a non-existent target falls back to the
  // already-real-rooted `candidate` computed above.
  const realCandidate = tryRealpath(candidate)

  const rel = relative(realRoot, realCandidate)
  const escapes = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  if (escapes) {
    throw new Error(`Refusing a path outside the project: ${relativePath}`)
  }

  return join(realRoot, rel)
}

function tryRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    // Doesn't exist (yet) or a broken symlink — fall back to the resolved
    // (non-real) path so the containment check still runs on *something*;
    // `browser.ts`'s own existsSync/statSync calls are what actually
    // surface a real "not found" to the caller.
    return path
  }
}
