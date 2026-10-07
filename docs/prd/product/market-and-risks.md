# Laird — Success metrics, market context, open risks

Part of the product PRD. See `docs/prd/README.md` for the full index.

## Success metrics (draft — needs real targets)

- A user can run 3+ projects in parallel without ever acting on the wrong one (near-zero "wrong project" incidents — the core promise).
- Time-to-trust: a new, non-engineer user can look at an agent's activity stream and correctly describe what happened, without reading raw logs.
- Skill/subagent adoption: % of sessions that use at least one custom skill or subagent, as a proxy for whether the visual skill system is actually discoverable and used (vs. staying CLI-only in practice).

Still placeholder-vague — no numeric targets or timeframe yet. Needs a real pass before these are load-bearing.

## Market context

The competitive landscape splits into: minimal CLI agents (Claude Code, Codex, Pi, Hermes), parallel-session fleet managers for engineers (Conductor.build, Crystal, CWT, Vibe Kanban, Terragon, Warp ADE, Cursor 3's Agents Window), AI-native IDEs (Cursor, Windsurf, Zed, Kiro), no-code app builders ($4.7B market, 63% non-developer users — Lovable, Bolt, Replit, v0), autonomous cloud agents (Devin, Factory.ai), and observability/eval tooling (Langfuse, Braintrust, Grafana). The open gap: nobody has combined the fleet-manager mechanic (real parallel agents, real worktrees) with a genuinely non-engineer-friendly visual/trust layer, integrated observability in plain language, and in-workspace harness building. "Mission Control" as a name is already used by two other projects (Builderz Labs, GitHub) — avoid for branding.

**Known gap**: this research (the original idea-scout competitive pass) was never saved to a file in this repo — unlike the later round in `docs/research/external-analysis/`, it only exists in this project's conversation history. This section currently depends on research that isn't independently durable or re-checkable from the repo alone.

A later, separate research round looked at adjacent agent-orchestration tooling (ruflo/claude-flow, metaharness, Convidence_AI, BHIL-HELM) for architecture/pattern borrowing rather than competitive landscape — see `docs/research/external-analysis/` and the technical PRD, which is where those findings actually changed anything.

## Open questions and risks

- **Unvalidated core assumption**: does the target user actually want to *see* multiple parallel shells (even beautifully packaged), or would they prefer the agent work hidden entirely, the way Lovable/Replit's majority non-developer audience does? This is the single biggest risk to the whole premise and needs real user input, not more internal design work, to resolve.
- **Visual-identity-per-project is a thin moat** on its own — any competitor (Conductor, Cursor) could ship colored tabs in a sprint. The real differentiation has to be the trust/observability/guardrail layer, not the color palette — which is now substantially more concrete after the later research round (tiered permissions, a kill switch, evidence-tier labeling, a SHIP/HOLD/REWORK harness verdict; see the technical PRD's `observability-trust-and-harness.md`), closing much of this gap.
- **"Mission Control" branding collision** — avoid that name.
- **Scope breadth**: eight pillars (`pillars-and-experience.md`) is still a lot for a v1, now with more concrete mechanisms behind several of them rather than fewer pillars — the technical PRD's phased build sequence (`roadmap-and-open-questions.md`) is how this gets tamed, not a reduction in pillars.
- **A tension between the locked aesthetic and the trust layer**: v9's locked design is deliberately atmospheric (drifting mist, film grain, a slow idle brand animation) at the same time the trust layer demands that anything decorative be clearly marked as non-signal. The current mockup already keeps these separate structurally (status lives in tab text and the flip's state, not in the mist), but this needs to stay a deliberate design rule as the theming system grows, not an accident of the current build.
