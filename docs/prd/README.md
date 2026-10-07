# Laird — PRD index

Split 2026-10-07 from two single files (`product-prd.md`, `technical-prd.md`) into smaller, concern-based pieces for scannability. Status: draft throughout — several decisions are explicitly flagged open in the files themselves rather than implied settled.

**Design is locked**: `design/variations/v9-signature/` (liquid-glass mist/paper/ink material, the surfboard-flip activation toggle, per-project color identity) is the default direction.

**Research**: `docs/research/external-analysis/` holds four external-project analyses (Convidence_AI, ruvnet/metaharness, ruvnet's GitHub profile, BHIL-HELM-Sci-Fi-Visualizer) whose findings are folded into the files below, with inline pointers back to the source file wherever something changed as a result.

## Product PRD

Read in this order:

1. [`product/vision.md`](product/vision.md) — one-liner, who this is for, the problem, non-goals
2. [`product/pillars-and-experience.md`](product/pillars-and-experience.md) — the eight product pillars, the core experience from the mockups, the locked design language
3. [`product/market-and-risks.md`](product/market-and-risks.md) — success metrics, competitive landscape, open risks

## Technical PRD

Read in this order:

1. [`technical/architecture-and-data.md`](technical/architecture-and-data.md) — architecture overview, desktop shell decision, session manager, data model
2. [`technical/skills-and-plugins.md`](technical/skills-and-plugins.md) — skills, subagents, the plugin system
3. [`technical/observability-trust-and-harness.md`](technical/observability-trust-and-harness.md) — observability, trust & guardrails, harness mode (kept together — all three read from the same activity log)
4. [`technical/design-system-and-nfr.md`](technical/design-system-and-nfr.md) — theming engine, performance/motion/accessibility/security/telemetry/distribution
5. [`technical/roadmap-and-open-questions.md`](technical/roadmap-and-open-questions.md) — build phases, open technical questions

## Known gaps (tracked, not yet fixed)

- Harness mode has no visual design — see `technical/observability-trust-and-harness.md`.
- Finder-style file/document access (pillar 5) has almost no spec and no build phase — see `technical/roadmap-and-open-questions.md`.
- The original competitive-landscape research (product PRD's market context) was never saved to a file in this repo, unlike the later research round — see `product/market-and-risks.md`.
- Accessibility, telemetry stance, and app distribution/update story are all thin or unstated — see `technical/design-system-and-nfr.md`.
