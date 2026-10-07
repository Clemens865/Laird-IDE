# External analysis: ruvnet/metaharness

Source: https://github.com/ruvnet/metaharness (cloned shallow, inspected locally; MIT license). Evaluated against Laird's `docs/prd/product-prd.md`, `docs/prd/technical-prd.md` (especially §7 "Harness mode," flagged there as the least-specified pillar), and the locked v9 design direction.

## 1. What it is

A large, mature (2,254 tests, dozens of ADRs), Rust+TypeScript open-source project that bills itself as "not another agent framework — a factory for agent frameworks." Given a GitHub URL (or a blank slate), it generates a branded, repo-aware **agent harness**: a CLI, a local MCP server, project-scoped memory, skills inferred from the actual file layout, a governance/permission policy, and release/provenance verification — packaged as a downloadable, npm-publishable `.zip`. It targets 10 different agent hosts (Claude Code, Codex, pi.dev, Hermes, OpenClaw, Prime Agent, GitHub Copilot, GitHub Actions, OpenCode, RVM). Architecture is a strict three-layer stack: a Rust kernel (crates/kernel, compiled to WASM and NAPI) that owns claims/hooks/memory/routing/witness logic, a TS adapter layer per host, and a CLI/plugin surface on top. It ships its own Claude Code plugin (`.claude-plugin/`) with 14 skills (`create-harness`, `score-harness`, `verify-witness`, `repo-genome`, `compare-harnesses`, etc.).

**Critical semantic finding — read before anything else**: this project's word "harness" does **not** mean what Laird's technical-prd.md §7 means by "harness mode." MetaHarness's harness = a repo-scoped **agent scaffold/wrapper** (brand + skills + MCP server + memory + governance). Laird's harness mode = **plain-language acceptance criteria checked against an agent's work** (an eval/test harness). The name match is a false cognate. This repo is not prior art for Laird's eval-harness gap — it's much stronger prior art for a different, arguably more foundational part of Laird's technical PRD: §5, the skill/subagent/plugin system.

## 2. Specific patterns found, relevant to Laird

- **`docs/USERGUIDE.md`** is genuinely plain-language and non-engineer-friendly ("You don't write code. You don't deploy anything... That's the whole pitch"), in sharp contrast to the main README, which is extremely dense (badges, ADR citations, benchmark-claim hedging). The project deliberately maintains two separate documentation registers for two separate audiences.
- **The "Repo → Harness" Studio flow**: paste a GitHub URL → it analyzes the repo via GitHub's public API (no code execution) → shows recommended agents/skills (user can edit before generating) → download. A concrete, working onboarding pattern for "what skills/subagents should this project have," not a blank-slate "create a skill" form.
- **`metaharness score <repo>`**: reads a repo (never runs it) and prints a one-screen report card — harness fit, build likelihood, tool safety, rough cost-per-run — *before* anything is generated or executed.
- **The "Verify" flow**: checks a harness/plugin `.zip` someone hands you, without unzipping or running it — structure, host/kernel version compatibility, MCP permission risk, accidentally-embedded secrets.
- **`repo-genome` skill**: generates a fingerprint/"genome" of a repo. Independently validates the per-project generated-fingerprint metaphor Laird already explored in design direction v6 ("Generative Seed") — useful external confirmation that the idea has real precedent, not just internal novelty.

## 3. Adopt

- **Auto-recommend skills/subagents from repo analysis, as a first-run experience.** Reuse the *idea*, not the code: when a project is added to Laird, scan its file layout/stack and propose a starter set of skills/subagents (editable before accepting), instead of today's PRD'd blank "create a new skill" flow. This directly strengthens technical-prd.md §5 and is a much better onboarding moment for a non-engineer.
- **A pre-flight "fit/cost" card before an agent runs**, modeled on `metaharness score`: a one-screen, plain-language estimate (rough cost, what it's about to touch) shown *before* a session starts, not just the after-the-fact cost/time footer already specified in technical-prd.md §6. Cheap to build, directly reinforces Laird's trust/observability pillar.
- **A "verify before install" step for the plugin marketplace** (technical-prd.md §5): check a community plugin's permissions/MCP footprint and scan for embedded secrets before install, surfaced in plain language, mirroring MetaHarness's Verify tab. This is a concrete answer to a gap technical-prd.md left open (the marketplace browser was specified without a safety gate).
- **Deliberately maintain two documentation registers**, the way this project does: a precise technical PRD (ours already exists) and a genuinely separate, plain-language user guide tested against non-engineers — don't let the two bleed into one register.

## 4. Don't adopt

- **The Rust-kernel / three-layer / 10-host-adapter architecture.** Wrong scale and wrong stack entirely — Laird's technical PRD specifies a local Electron+TS app wrapping Claude Code specifically (§2–3); there is no reason to introduce a compiled Rust kernel, WASM/NAPI targets, or multi-host abstraction for a product whose technical PRD explicitly scopes out multi-provider support for v1.
- **Darwin Mode, field-memory, weight-EFT, AVO ("governed autonomous variation").** Self-mutating config evolution, packed-attractor memory layers, LoRA distillation routing, autonomous branching/reverting loops — all explicitly flagged *by the project's own ADRs* as experimental, unproven, or claim-gated pending benchmarks. Enormous scope and risk for a non-engineer-facing v1 product that hasn't even validated its core premise yet (per product-prd.md §10).
- **Witness-signed provenance, hash-chained receipts, IPFS-pinnable marketplace entries.** Supply-chain-security-grade machinery solving a problem Laird doesn't have at this stage; would add real complexity for zero near-term user value.
- **The main README's communication style itself.** Badge-dense, ADR-citation-heavy, hedged benchmark claims — this is close to the opposite of the plain-language, trust-first tone Laird's product PRD calls for. Useful as a negative example, not a template.
- **Multi-host targeting (10 agent hosts).** technical-prd.md already correctly scopes Laird to Claude Code only for v1 — this repo's breadth is not a reason to revisit that, it's a reminder of how much scope that discipline is avoiding.

## 5. Open questions

- Whether Laird should literally depend on any `@metaharness/*` npm package for the repo-analysis/skill-suggestion feature, or just reimplement the much smaller slice natively. Given MIT licensing isn't a blocker but the dependency is enormous relative to the one feature Laird wants, **reimplementing natively is the better call** — don't pull in the package.
- Did not deeply inspect `kimi-k3-harness/`, `experiments/`, or `services/` — these read as model-specific research experiments, unlikely to be relevant, excluded from scope given time-boxing.
