# Laird — Vision, audience, scope

Part of the product PRD. See `docs/prd/README.md` for the full index.

## One-liner

A desktop workspace for people who build software by directing AI coding agents — not by writing code by hand — that makes running several projects and agents at once feel as calm, visual, and trustworthy as using a well-designed Mac app, never like a terminal.

## Who this is for

Not professional software engineers, and not the fully-abstracted "type a prompt, get a deployed app" crowd either (Lovable, Bolt, Replit Agent, v0). The target user already works with a real coding agent CLI — Claude Code primarily — because they want actual control over a real codebase, not a black box. What they don't have is a professional engineer's comfort with git worktrees, diffs, raw terminal output, or juggling several terminal windows without losing track of which project they're in.

In market terms (see `market-and-risks.md`): the gap sits between **fleet managers** (Conductor.build, Crystal, Cursor's Agents Window — built for engineers who already understand worktrees and diffs) and **no-code app builders** (Lovable, Bolt, Replit — built for people who want the terminal to not exist at all). Laird's bet is that a meaningful group of people want the real thing (a real agent working in a real codebase) presented in a way that never requires understanding the real thing's raw mechanics.

**This assumption is not yet validated** — see the open risks in `market-and-risks.md`.

## Problem

Today, running multiple Claude Code sessions in parallel means multiple terminal windows that look identical, scroll raw text, and offer no visual way to tell projects apart at a glance (the literal pain point: a reference screenshot of three near-identical terminal windows titled only by small text labels started this project). For someone who isn't a professional engineer, this is actively dangerous (easy to type into the wrong project) and unapproachable (raw logs don't build trust or understanding of what an agent actually did).

## Non-goals for v1

- Not a no-code app builder — Laird does not hide the fact that a real codebase and a real agent exist; it makes that approachable, not invisible.
- Not a multi-provider orchestration platform on day one — Claude Code is the primary, designed-for engine. Other agents (Codex, Gemini CLI) are a plausible later extension, not a launch requirement.
- Not a cloud/remote-agent service (unlike Terragon, Devin) — v1 is local-first, wrapping local Claude Code sessions.
- Not a replacement for Workspace-OS or any of the user's other projects — a distinct product.
