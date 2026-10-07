# Laird — Build phases and open technical questions

Part of the technical PRD. See `docs/prd/README.md` for the full index.

## Build phases (draft sequencing)

1. **Foundation**: single project, single session, structured SDK integration (`architecture-and-data.md`), activity stream rendering (text turns + file-change chips) — proves the core "never feels like a terminal" bet before anything else is built on top of it.
2. **Multi-project**: project registry, worktree-per-session isolation, tab bar with visual identity, grid view.
3. **Skills & subagents**: read Claude Code's real plugin/skill state, render skill cards/collections, subagent roster with live status (`skills-and-plugins.md`).
4. **Observability & trust**: per-session/per-project plain-language cost/time/outcome history, the `ActivityLogEntry` log, decorative-vs-signal labeling, and the tiered-permission/kill-switch guardrail layer (`observability-trust-and-harness.md`) — grouped into one phase, since all of it reads from the same log.
5. **Plugin marketplace browsing + install flow**, including the verify-before-install gate and honest unsandboxed-disclosure language (`skills-and-plugins.md`).
6. **Theming system**: formalize the token contract (`design-system-and-nfr.md`) from the explored mockups; ship with v9-signature as the default, keep the others as a proof the system is swappable.
7. **Harness mode**: implement the converged SHIP/HOLD/REWORK model (`observability-trust-and-harness.md`) — no longer a from-scratch design pass, but still its own implementation slice (criteria compilation, the reviewer subagent, evidence-tier plumbing), and still needs its own visual design pass first (see that file's "known gap" note).

**Known gap**: pillar 5, Finder-style file/document access, has no phase here at all — it's named in the product PRD but was dropped somewhere between drafts. Needs either its own phase or an explicit decision to fold it into phase 1 or 2.

## Backlog (deliberately deferred, not forgotten)

- **Adding a custom marketplace from Laird's own UI.** Workstream E's marketplace browser (`skills-and-plugins.md`) scoped to browsing/installing from marketplaces already configured on the machine; a "paste a repo URL to add a new marketplace source" control was explicitly deferred at the user's direction, not because it's hard — `claude plugin marketplace add <source>` already exists and is real, confirmed live.
- **Surfacing the `ruflo` marketplace specifically** in that same browser. Consistent with the earlier decision not to integrate Ruflo itself as a product feature (`docs/research/external-analysis/ruvnet-github.md` §5) — its plugins remain installable like any other marketplace entry, just not specially promoted.
- **A provider-agnostic plugin system** (supporting non-Claude-Code tools, e.g. Pi's own plugin mechanism, raised directly by the user). Technically plausible — the marketplace browser is already a thin adapter over one CLI; a second tool would need its own adapter behind a shared UI. Explicitly not pursued now: conflicts with the already-locked v1 non-goal of staying Claude-Code-first/single-provider, and no research has yet confirmed what Pi's (or any other tool's) real plugin mechanism actually looks like.

## Open technical questions

- Exact Claude Code SDK/headless integration surface for structured events — still needs a focused spike before Phase 1 starts to confirm the structured-event model against the *current* Claude Code SDK, though Convidence_AI's working adapter meaningfully de-risks the "is this even possible" question. **New, cheaper option to try first**: `docs/research/external-analysis/ruvnet-github.md` flags that ruflo ships its own cockpit UI (`plugins/ruflo-console`) showing workflows/agents/tokens/cost/logs/replay — if that console was built against Claude Code's structured/SDK event stream (not raw terminal output), reading its source could answer this question faster than a from-scratch spike. Worth a short look before committing spike time.
- Whether subagents ever need their own worktree (today assumed no — they operate within their parent session's worktree) — confirm this matches how Claude Code's subagent/Agent tool actually behaves before building the UI model around it.
- Local data store choice (SQLite assumed, not yet confirmed) and migration story as the schema evolves, now including the `ActivityLogEntry` table's growth rate (one row per tool call/file change/decision across every session — worth a retention/pruning policy once real usage data exists).
- Whether `open-claude-code`'s documented internals (25 tools, 4 MCP transports, 6 permission modes) are accurate enough to rely on even as *background reading* — it claims to nightly-sync against upstream, but that wasn't independently verified (`ruvnet-github.md`). Treat anything learned from it as a hypothesis to confirm against real Claude Code behavior, not a fact.
- No spec yet for Finder-style file/document access (pillar 5) — what "open a file" actually does (preview vs. edit, inside Laird or shelling out to an external editor, read-only or writable) has never been written down.
