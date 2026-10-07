/**
 * The four per-project identity colors used throughout every design mockup
 * (Claude/Codex/Workspace-OS/Atelier tabs) — a deliberately different
 * concept from the theme's own single `--accent` token (see tokens.css):
 * this palette cycles per project for *identity*, not theme state. Shared
 * between main (`project/registry.ts`, assigning a new project's color) and
 * renderer (`SubagentRoster.tsx`, coloring live subagent glyphs) so the two
 * never drift out of sync with each other — they used to be two separate
 * hardcoded copies of the same four hex values.
 */
export const ACCENT_PALETTE = ['#D97757', '#2D9D8F', '#8D7AD1', '#C15C82'] as const
