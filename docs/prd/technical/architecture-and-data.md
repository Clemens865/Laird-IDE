# Laird — Architecture, desktop shell, session manager, data model

Part of the technical PRD. See `docs/prd/README.md` for the full index. Read `docs/prd/product/` first for the why.

## Architecture overview

Laird is a local-first desktop app that wraps one or more Claude Code sessions per project, renders their output as structured UI (never raw terminal text), and layers project identity, skills/subagents, observability, and a plugin system on top.

**Desktop shell** (Electron — see below), containing:

- **Renderer (UI)**: tab/grid view, the activity stream, skills/agents views, the theme engine (`design-system-and-nfr.md`)
- **Main process**: session manager and project registry (below), the plugin/skill bridge (`skills-and-plugins.md`), the observability store and harness runner (`observability-trust-and-harness.md`)

The main process drives **Claude Code (SDK/CLI)**, one process tree per project session, each in its own isolated git worktree.

Note: a "File/Finder service" appeared in earlier drafts of this diagram with no spec behind it — deliberately dropped here rather than left in uncorrected. Pillar 5 (Finder-style file access) is a known gap, not yet designed; see `roadmap-and-open-questions.md`.

## Desktop shell: Electron (decided)

**Electron**, over Tauri, for three reasons specific to this product rather than generic framework tradeoffs:

1. **Direct precedent to reuse.** Workspace-OS and TerminalOS in this user's own ecosystem are already Electron/`electron-vite` apps — build pipeline, release/code-signing process, IPC patterns, and native-module handling are already solved problems to lift, not reinvent. Given the product's core premise is still unvalidated (see the open risk in `docs/prd/product/market-and-risks.md`), speed to a testable v1 matters more right now than binary size.
2. **Rendering consistency matters more here than for a plainer app.** v9-signature's entire locked aesthetic depends on `backdrop-filter: blur/saturate`, SVG `feDisplacementMap` glass distortion, and `feTurbulence` grain — exactly the CSS/SVG features that render least consistently across engines. Electron ships one known Chromium version to every install. Tauri uses the OS's native webview instead (WKWebView on macOS, WebView2 on Windows), so the signature glass effect could genuinely render differently per OS or OS version, outside this project's control — a real risk for a product whose differentiation is visual craft, not theoretical.
3. **Tauri's efficiency argument is weaker than it sounds for Laird specifically.** The dominant resource cost of running multiple parallel sessions is the Claude Code child processes themselves — full OS processes regardless of what wraps the UI. Electron's ~100-200MB shell overhead is a rounding error next to that; Tauri would help if the *UI* were the bottleneck, and here it isn't.

**Revisit only if** Electron's baseline overhead is empirically shown to be the actual bottleneck with many concurrent sessions running (see the performance budget in `design-system-and-nfr.md`) — not preemptively, and not as an open blocker on starting work.

## Session manager — the core integration decision

**The most important technical choice in this whole product**: how Laird talks to Claude Code determines whether "never feels like a terminal" is actually achievable.

Two approaches:

1. **PTY + ANSI parsing** (what Conductor, Crystal, Warp effectively do): spawn Claude Code in a real pseudo-terminal, parse its terminal UI output. Fast to bootstrap, but fighting the grain of the requirement — Claude Code's own terminal UI is designed to be looked at directly, not reverse-engineered, and any upstream UI change breaks the parser.
2. **Structured SDK / headless mode** (recommended): drive Claude Code via its non-interactive / SDK mode, which emits structured events (`stream-json` style: tool-call start/end, file edits, text turns, cost/usage per turn) rather than rendered terminal frames. Laird's UI renders these events directly as message bubbles, file-change chips, and the plain-language cost footer — no parsing, no reverse-engineering, and it's the same data model as the structured activity stream already mocked up in `design/variations/`.

**Recommendation: build on the structured/SDK path from day one.** Reserve a raw-PTY "advanced terminal" view as an optional escape hatch per session (for the rare case a user genuinely wants to see raw shell output, e.g. debugging a build command), not as the primary surface.

**This is now partially de-risked, not just a plan.** `docs/research/external-analysis/convidence-ai.md` found a live, working example of exactly this approach: Convidence_AI's `AiDecisionPort` adapter drives headless Claude Code via `claude -p --output-format json`, with a real recorded run (12s, $0.18, correctly ignored an injected prompt-injection attempt) proving the structured-output path works today. Laird should build a comparably thin adapter seam between the session manager and "the thing that actually talks to Claude Code" — cheap to add, and it's the same seam that would let the PTY escape-hatch above sit behind the same interface.

**Every structured event this adapter emits is the write path into `ActivityLogEntry`** (below) — the session manager doesn't just render events for display, it durably logs them. That single log is what the cost footer, the harness-mode disposition, and the trust/guardrail action log all read from later (see `observability-trust-and-harness.md`).

Separately, `docs/research/external-analysis/ruvnet-github.md` flags `open-claude-code` (a decompiled, clean-room rebuild of Claude Code's internals — agent loop, 6 permission modes, hooks, settings chain) as useful *background reading* to understand Claude Code's real shape before the spike noted in `roadmap-and-open-questions.md` — but it must never be depended on, bundled, or vendored: it's built from decompiled proprietary source and carries real legal/reputational risk for a product whose value depends on a healthy relationship with Claude Code/Anthropic.

**Isolation**: one Claude Code session per project tab, each in its own git worktree (the pattern every fleet manager — Conductor, Crystal, Vibe Kanban — independently converged on). This gives: no file conflicts between parallel projects, a natural "diff to review" boundary, and cheap parallelism without a full repo clone per session. Subagents within one project session are a Claude Code concept (the `Agent` tool / subagent system) and are represented in the UI as the "Agent activity" panel, not as separate worktrees. **Verified, not just designed**: both the SDK-over-PTY bet and worktree-per-session isolation are now built and live-tested (Workstreams A and B) — including a real two-project run confirming no cross-contamination at either the filesystem or UI level.

**Two real reliability bugs found and fixed (Workstream D), both specifically about quitting the app while a session is still running — worth recording honestly rather than quietly patched.** Re-running Workstream A's own `hardening-kill-mid-run.mjs` regression after the trust-mechanism work above revealed it had silently started hanging — a prior pass through the implementation plan had wrongly logged it as "still green" without actually re-running it. (1) A real race in `claudeHeadlessTransport.ts`: the child's last buffered stdout chunk can arrive just after `stop()` sends SIGTERM, and `handleChunk` unconditionally re-armed a fresh, never-subsequently-cleared 2-minute idle timer — fixed with an explicit `stopped` guard, plus `.unref()` on every timer the class owns so none of them can single-handedly keep the process alive. (2) The real blocker, found only by instrumenting Electron's own quit lifecycle directly (its internal `'quit'` event fired in ~120ms every time — the hang was never actually inside Electron's own shutdown): quitting mid-session lets that session's eventual exit arrive *after* the window has already been destroyed, and `mainWindow?.webContents.send(...)` only guards `mainWindow` being `null` — calling `.send()` on an already-destroyed window's `webContents` throws synchronously, and Electron's default handling of an uncaught main-process exception is a **modal error dialog that blocks the app from quitting until a human clicks OK**. Invisible in an automated test's terminal output, and would do the same to a real user closing the app mid-session. Fixed with a `sendToMainWindow` helper that checks `isDestroyed()` on both the window and its `webContents` before sending. Both fixes are unit-tested directly (the exact late-chunk race, and that every timer is unref'd), and `hardening-kill-mid-run.mjs` now completes in seconds with no hang.

**A correction to an earlier correction — worth recording honestly.** Hardening initially found that the `system/init` event's `"skills"` list looked the same regardless of `--setting-sources project`, and concluded the flag doesn't scope skill visibility at all. That conclusion was wrong: the list in question (`loop`, `schedule`, `doctor`, `init`, etc.) is Claude Code's own **built-in** meta-skills, which ship with the CLI and were never going to be affected by this flag — it was never the user's personal skill library in the first place. Workstream C re-tested this properly, live, against a real personal global skill (`~/.claude/skills/phago-status`): a session started with `--setting-sources project` and asked directly whether it had access to that skill answered **"NO ACCESS."** The identical session, with that one skill symlinked into the worktree's own `.claude/skills/`, correctly quoted the skill's real description back verbatim. So: `--setting-sources project` **does** correctly exclude the user's real global skill library by default, exactly as originally assumed — and the symlink-based materialization mechanism in `skills-and-plugins.md` (built and tested in Workstream C, see `src/main/skills/materialize.ts`) is the confirmed, working way to grant a session access to one specific global skill without reopening the rest.

## Data model (draft)

| Entity | Key fields |
|---|---|
| `Project` | id, name, local path, git remote (optional), color/identity token, created/last-active |
| `Session` | id, projectId, worktree path, status (running/idle/needs-review), startedAt |
| `Turn` | id, sessionId, role (user/agent), content blocks: `text`, `fileChange {path, summary, diffStat}`, `toolCall {name, status}` |
| `Skill` | id, scope (core/project/community), name, description, icon ref, shortcut, enabled |
| `Subagent` | id, sessionId, name, role, status (active/idle/done), lastAction, **parentActivityLogEntryId** (the `Agent` tool-call that spawned it — added per `docs/research/observability-landscape-2026.md`, matching OpenInference's parent/child span-inheritance rule; built, Workstream F) |
| `UsageEvent` | id, sessionId, turnId, costUsd, durationMs, filesChanged, **inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens** (the real token breakdown the `claude` CLI already reports and this table previously discarded; `inputTokens`/`outputTokens` named to match OTel GenAI's `gen_ai.usage.*` directly — built, Workstream F) |
| `HarnessRun` | id, projectId, spec (numbered plain-language criteria), disposition (`ship`/`hold`/`rework`/**`unverifiable`** — the last added per `docs/research/harness-engineering-landscape-2026.md`, for a criterion that's ambiguous/impossible to check as written, distinct from the agent's work failing), perCriterionResult (pass/fail + evidence tier), linkedTurnId |
| `PluginInstall` | id, source (marketplace repo), name, components (commands/subagents/hooks/MCP servers), enabled |
| `ActivityLogEntry` | id, sessionId, turnId, kind (tool-call / file-change / decision / permission-prompt / kill-switch), payload, createdAt |

All of this is a local-first store (likely SQLite via the main process) — no cloud dependency for v1, consistent with the product PRD's local-first non-goal around remote/cloud agents.

**`ActivityLogEntry` added per `docs/research/external-analysis/convidence-ai.md`**: an append-only, one-row-per-event local log (no cryptographic hash-chaining — that's enterprise-compliance machinery Laird has no threat model for) that every other observability/trust surface *renders from* rather than re-derives. The plain-language cost/time footer, the harness mode disposition, and the trust/guardrail action log (all in `observability-trust-and-harness.md`) are all views over this one table, not three separate mechanisms. This directly answers "did the agent actually touch `Settings.tsx`?" with a query instead of a guess.
