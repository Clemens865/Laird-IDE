import * as yaml from 'js-yaml'

/**
 * Parses the YAML frontmatter block (`---\n...\n---`) at the top of a real
 * Claude Code `SKILL.md` or custom-agent `.md` file. Returns null if the
 * file has no frontmatter block at all (malformed/not a real skill file) —
 * callers should skip it, not guess at a name.
 */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  try {
    const parsed = yaml.load(match[1])
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch (err) {
    console.error('[frontmatter] failed to parse YAML block, falling back to a line-based extraction', err)
    return extractNameAndDescriptionLoosely(match[1])
  }
}

/**
 * Real fallback, not theoretical: several of this machine's own installed
 * skills have a plain (unquoted) one-line `description:` containing a
 * `": "` sequence (e.g. "Trigger words: ..."), which is genuinely illegal
 * YAML for a plain scalar — js-yaml correctly rejects it as a malformed
 * nested mapping (confirmed live during Workstream C chunk 4). Rather than
 * silently dropping those real skills from the UI, recover just the two
 * fields Laird actually reads, by line, ignoring YAML scalar semantics.
 */
function extractNameAndDescriptionLoosely(block: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {}
  for (const key of ['name', 'description']) {
    const line = block.split(/\r?\n/).find((l) => l.startsWith(`${key}:`))
    if (!line) continue
    const value = line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
    if (value) result[key] = value
  }
  return Object.keys(result).length > 0 ? result : null
}
