# External analysis: BHIL-HELM-Sci-Fi-Visualizer

Repo: https://github.com/PolymathWizard/BHIL-HELM-Sci-Fi-Visualizer (MIT + CC BY 4.0). Analyzed via shallow clone, 2026-10-07.

## 1. What it is

Not a visualizer app — a **Claude Code subagent/prompt framework ("HELM" = Heuristic Engine for Layered Mockups)** that turns a client's data and a style brief into a single-file HTML sci-fi-styled command-center dashboard. Pipeline: 10 numbered sub-prompts (SP-01 data deconstruction → SP-03 style-language selection → SP-06 functional mockup build → SP-08 accessibility/fidelity QA → SP-10 terminal gate), 4 subagents (`helm-profiler`, `helm-stylist`, `helm-builder`, `helm-qa`), 6 slash commands (`/helm`, `/restyle`, `/rebind`, `/add-panel`, `/snapshot`, `/gate`). Ships a catalog of 15 original (non-franchise) sci-fi design languages (Tactical HUD, Neon Grid, Industrial Terminal, NASA Utilitarian, etc.), each as a documented CSS token set. Target audience: intelligence analysts, fractional CDOs, ops leaders — a professional, "cinematic where it serves the decision" temperament, explicitly willing to "pay a narrative tax" for stylistic impact.

## 2. Functional patterns found (separated from visual skin)

- **Adversarial QA subagent**: `helm-qa` "did not build this artifact and does not fix it" — runs in a fresh context, never the builder's, and only logs findings + issues a disposition.
- **Terminal gate**: a formal `SHIP / HOLD / REWORK` disposition from numbered check failures (contrast, fidelity-vs-data, alert-states-without-color, keyboard/focus, reduced-motion, IP cleanliness, decorative-vs-signal audit).
- **Fidelity table**: every rendered number is checked against a `register.json` of real/declared values — "expected, rendered, match."
- **Evidence classification on every data claim**: `VERIFIED / CORROBORATED / UNCORROBORATED / INFERENCE / STATED` — no claim ships unlabeled.
- **Decorative-vs-signal audit**: any purely ambient/stylistic element must carry `data-decorative="true"` so it can never be mistaken for real information; a test enforces this is never presented as signal.
- **"No silent correction"** principle: gaps, contradictions, and contrast failures surface in the QA log rather than being quietly patched.
- **Regenerability contract**: every shipped artifact includes `REGENERATE.md`, `CLAUDE.md`, and a skill file so the artifact can be extended without the framework in the loop.
- **Design-language catalog as data**: 15 languages stored in `data/canonical/catalog.json` + JSON schemas, with generated docs and generated CSS token files (`tokens/<language>.css`) — a clean, versioned token-set schema (bg layers, text tiers, accent, four semantic alert states, border/radius, a single glow token, font-display/body/mono, spacing scale, motion durations with a `prefers-reduced-motion` override block).
- **IP-safety mechanism**: a "lineage register" records what each style is *studying* (a decade/genre convention) versus what it must never reproduce (franchise names, logos, specific screen frames), enforced by both an agent rule and an automated test (`test_ip_cleanliness_no_franchise_names_in_shipped_files`).

## 3. Adopt

- **Fresh-context adversarial QA pattern** → directly answers Laird's underspecified harness mode (technical-prd.md §7). A reviewer subagent that never built the work, runs separately, and emits a structured disposition is a stronger, more concrete model than the "Reviewer subagent checks a list a human wrote in English" sketch currently in the PRD.
- **SHIP / HOLD / REWORK as the harness-run outcome vocabulary**, with numbered failing checks — gives harness mode a decisive, non-mushy output shape instead of a vague pass/fail.
- **Decorative-vs-signal labeling** → should become a hard rule in Laird's observability pillar: anything in the activity stream or sidebar that is ambient/illustrative (not an actual fact about what the agent did) must be visually and structurally distinguishable from real status. Directly protects the "never feels like a terminal, but never lies either" promise.
- **Evidence-tier labeling** (VERIFIED/CORROBORATED/.../STATED) → a genuinely new idea worth adding to Laird's product PRD trust pillar: an agent's claims about its own work ("tests passed," "file updated") could carry a confidence/verification tag, not just be printed as flat fact.
- **The token-set schema shape** (not its sci-fi values) → validates and sharpens Laird's technical-prd.md §8 theming engine: adopt this project's concrete category list (bg tiers, text tiers, one accent pair, four *semantic* alert states, one glow token, display/body/mono font slots, a spacing scale, motion durations with a reduced-motion override block) as the literal token contract shape for v9 and any future theme.
- **"No silent correction" + regenerability contract** → worth stating explicitly as engineering principles in the technical PRD, independent of this framework's domain.

## 4. Don't adopt

- **The visual language itself.** Every one of the 15 catalog styles (Tactical HUD, Neon Grid, Sonar Surveillance, etc.) is a dense, glowing, HUD/command-console aesthetic — the deliberate opposite of Laird's locked v9 direction (calm mist/paper/glass, Newsreader + Inter, restrained motion). None of the actual CSS/tokens/components should be ported.
- **The target temperament.** HELM's operating principle is "pay the narrative tax knowingly" for a professional analyst audience that wants cinematic density. Laird's audience and stated goal are the opposite: reduce cognitive load for non-engineers, never add stylized tension. Do not import "narrative tax," glow-heavy chrome, or boot-up/alert theatrics as goals.
- **Heavy single-file-HTML-with-embedded-everything delivery model.** HELM ships one big self-contained HTML artifact per engagement; Laird is a persistent desktop app with a real data layer (technical-prd.md §4), not a one-off generated artifact — don't adopt the delivery mechanic, only the QA/token patterns above.
- **WebGL/shader dependency** is not actually present here (this repo is HTML/CSS/Python, no WebGL despite the "visualizer" name) — so there's no performance conflict to flag against xyz's guardrails; that concern from the original task framing doesn't apply to this repo.

## 5. Open questions

- Whether Laird should ever expose a "generate a one-off dashboard from my data" feature at all (HELM's core use case) — nothing in Laird's current PRD calls for this; flag as out-of-scope unless the user wants to discuss it, don't infer it as a new pillar.
- The exact mechanics of `tools/contrast.py` and `tools/validate.py` (stdlib-only Python validators) weren't read in depth — worth a closer look if/when Laird's harness mode moves from PRD to implementation, since they're a working, minimal example of the "machine-checkable validator" half of a harness.

## Most important finding

HELM is not useful to Laird as a visual reference (its entire catalog is the aesthetic Laird is explicitly not building) — but it is a genuinely strong, concrete architectural model for Laird's weakest-specified pillar, harness mode: a fresh-context adversarial QA subagent that never builds, only checks, and issues a SHIP/HOLD/REWORK disposition against numbered, partly machine-checkable criteria (contrast, fidelity-vs-data, decorative-vs-signal labeling, evidence tiers on every claim). Recommend folding this pattern into the technical PRD's harness-mode section directly.
