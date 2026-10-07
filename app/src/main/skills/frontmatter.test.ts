import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from './frontmatter'

describe('parseFrontmatter', () => {
  it('parses name and description from a real SKILL.md-shaped frontmatter block', () => {
    const content = `---
name: phago-status
description: "Visualize Phago's colony health. Use when the user asks 'show phago'."
---

# Phago Status

Body content here.`
    const result = parseFrontmatter(content)
    expect(result).toMatchObject({ name: 'phago-status', description: "Visualize Phago's colony health. Use when the user asks 'show phago'." })
  })

  it('parses an unquoted description', () => {
    const content = `---
name: Marlow — Trip Planner
description: Turns a rough trip idea into a fully sourced plan.
wos_mode: full
---
body`
    const result = parseFrontmatter(content)
    expect(result).toMatchObject({ name: 'Marlow — Trip Planner', description: 'Turns a rough trip idea into a fully sourced plan.' })
  })

  it('returns null for a file with no frontmatter block', () => {
    expect(parseFrontmatter('# Just a heading\n\nNo frontmatter here.')).toBeNull()
  })

  it('falls back to a line-based extraction of name/description when the YAML itself is malformed', () => {
    // Real shape, not synthesized: this machine's own installed skills have
    // a plain (unquoted) description containing a `": "` sequence (e.g.
    // "Trigger words: ..."), which js-yaml correctly rejects as malformed
    // YAML for a plain scalar — confirmed live during Workstream C chunk 4.
    const content = `---\nname: scroll-cinematic\ndescription: Build a site. Trigger words: 3D scroll, scroll animation.\n---\nbody`
    const result = parseFrontmatter(content)
    expect(result).toMatchObject({ name: 'scroll-cinematic', description: 'Build a site. Trigger words: 3D scroll, scroll animation.' })
  })

  it('returns null when nothing usable can be recovered from a malformed block', () => {
    const content = `---\njust: [unterminated and no name or description line\n---\nbody`
    expect(parseFrontmatter(content)).toBeNull()
  })
})
