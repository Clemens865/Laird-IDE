# Design variations

Four visual directions for the Laird workspace concept — same screen (tab bar, project shells, non-terminal activity stream, skills sidebar), four different visual languages. Open any `index.html` directly in a browser.

Inspiration: `Workspace-OS` (`src/renderer/src/styles/tokens.css` — light, Finder-like, Hanken Grotesk) and `xyz` (`src/vendor/react-bits` — glass surfaces, aurora/gradient backgrounds, grain/noise textures).

## v1 — Studio Light
`variations/v1-studio-light/`
Light, calm, Apple/Finder-adjacent. Hanken Grotesk, soft white cards on `#F5F5F7`, generous radii, quiet shadows. The safest, most approachable direction — closest to how Workspace-OS already looks. Best fit if "never intimidating" is the top priority.

## v2 — Aurora Glass
`variations/v2-aurora-glass/`
Dark, frosted glass panels over a slow-drifting aurora gradient. Space Grotesk display + Manrope body. Highest "wow," most premium-feeling, most visually distinctive — but glass/blur effects are the most expensive to get pixel-perfect and performant in a real Electron/Tauri build.

## v3 — Ink & Paper
`variations/v3-ink-paper/`
Warm ivory, serif (Fraunces) headlines, fine-grain paper texture, muted earthy accents. Calm and editorial rather than "techy" — leans hardest into the trust/non-intimidating positioning, least like a conventional dev tool.

## v4 — Night Ops
`variations/v4-night-ops/`
True dark, dot-grid texture, restrained per-project glow, monospace used deliberately for data/shortcuts. The closest to a Linear/Raycast-style precision tool — appeals most to the "power user who wants control" end of the audience, while still avoiding a raw-terminal feel.

## v5 — Liquid Glass Landscape
`variations/v5-liquid-glass-landscape/`
Direct descendant of Workspace-OS's real "Landscape" shader system (`src/renderer/.../backdrop/shaders.ts`): mist/paper/ink materials, Newsreader + Inter, true SVG-refraction glass (feTurbulence/feDisplacementMap, not just `backdrop-filter: blur`), and the real provider-identity colors (Claude terracotta `#D97757`, Codex teal `#2D9D8F`) used for the agent badge instead of invented ones. The most legitimate, highest-craft direction — but also the most expensive to build well (a real WebGL lens, like the original, is a serious engineering investment; this mockup approximates it in CSS/SVG).

## v6 — Generative Seed
`variations/v6-generative-seed/`
Borrows xyz's "everything grows from a seed" idea, tamed: each project gets a deterministic generated texture (seeded SVG `feTurbulence`, unique per project name) shown as a small "fingerprint" swatch next to its tab — identity as organic texture, not just a color dot. Novel, memorable, but a texture-matching system needs real design QA so fingerprints stay legible and never clash.

## v7 — Command Deck
`variations/v7-command-deck/`
Physical cockpit metaphor: beveled panels (inset highlight/shadow like metal), LED status indicators, toggle switches for each project tab, circular gauge readouts for cost/time/files instead of plain numbers. Leans into "observability as a physical dial you can trust," distinct personality from Night Ops' flat minimalism — more tactile, more "mission control," higher visual complexity to keep clean at smaller sizes.

## v8 — Big Wave
`variations/v8-big-wave/`
Named for the project's namesake, big-wave surfer Laird Hamilton: a proposed real brand mark (a minimal single-fin surfboard glyph with a stringer line, replacing the placeholder triangle used elsewhere), deep-navy "night ocean" palette, a full-viewport film-grain overlay (SVG `feTurbulence`, low opacity, blend-mode overlay) for a premium, non-generic texture, and a low swell silhouette at the horizon. The only variation that addresses the logo/brand-mark question directly — worth deciding whether this mark should roll out across the other seven.

## v9 — Signature (the converged direction)
`variations/v9-signature/`
Built from direct feedback on v1–v8: v5's liquid-glass mist/paper/ink material as the base, plus a new brand mark and activation mechanic built from real vector assets (`design/assets/surfboard-side-outline.svg`, `surfboard-top-outline.svg`) rather than hand-approximated paths.

**The board itself is the toggle.** Each tab's surfboard glyph is a true CSS 3D flip (`perspective` + `rotateY` + `backface-visibility: hidden`) between the two real outlines: resting on its **side** = idle, laid flat **top-down** = active/running — so selecting a tab physically turns the board over, in that project's color, instead of a separate abstract switch. Click any tab to see it. The topbar brand mark runs the same flip as a slow, continuous idle animation (no user action needed) as a small ambient brand moment. This replaces v7's bevel-switch toggle entirely rather than placing it next to the logo — direct feedback was that the toggle itself should become the surfboard, not sit beside it.

**Grain fix, applied to both v8 and v9**: the original v8 grain was nearly invisible — the SVG noise was pre-converted to white-with-low-alpha via `feColorMatrix`, then additionally dimmed by a `0.05` CSS opacity on top, compounding to under 5% visible strength, and because it was pure white it could only ever lighten, never darken (not how real film grain reads). Fixed by dropping the `feColorMatrix` entirely — raw `feTurbulence` output is already a neutral mid-grey noise — and driving visibility with a single `mix-blend-mode: overlay` + opacity (~0.2–0.4) on that raw noise, which lightens *and* darkens per pixel like real grain and is now genuinely visible on screen, not just in the markup.

## Shared decisions across all eight
- Projects are always identified by a consistent color (tab dot, border/glow, avatar ring) — never by name alone.
- The "shell" renders as a structured activity stream (message bubbles, collapsible file-change chips, plain-language cost/time footer), never as scrolling raw text.
- Skills and subagents live in the same right-rail panel as the active project, with a dedicated full view one click away.
