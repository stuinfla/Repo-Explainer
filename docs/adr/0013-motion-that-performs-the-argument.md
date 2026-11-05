# ADR-0013 — Motion that performs the argument (the hero scene, and where 3D belongs)

Status: Accepted + Implemented, including the local door authoring the scene (3.0.1); not yet validated against a live model at scale.
Date: 2026-09-17
Updated: 2026-11-05
Amends: ADR-0005 (skill-based recipe), ADR-0008 (every image teaches)

> **Note (3.0.1, 2026-11-05).** Verified: `tools/make-diagrams.mjs` installs `visuals.heroAnim.sceneSvg` and refuses
> it without a `viewBox`, real animation or a `prefers-reduced-motion` end state, and it checks the scene's
> phone layout against the 11px floor. The scene is still **optional**: a build that authors none gets the chips
> band or no band on the hosted door. **On the local door the brain now authors the scene** (`src/brain.mjs`
> `settleHeroScene`): it is validated by `tools/diagrams/scene.mjs` (viewBox, real animation, reduced-motion
> end state, scoped ids, no scripts or external refs, 11px phone text floor, xmllint, 25 KB), gets ONE repair
> pass, and otherwise falls back with `visuals.heroAnimSkipped.reason`. A valid scene replaces the raster hero
> (`hero.rasterSkipped: 'scene'`; `generate-image` skips it, a static backdrop feeds the favicon and share card).
> Both routes meet the same strict contract: `sceneMarkup` (the local brain, inline) and `sceneSvg` (a file the hosted agent writes) are checked by the same validator in `make-diagrams`.
> The scene is the only SVG the brain still authors; the four diagram slots are drawn by `make-diagrams` (ADR-0012, ADR-0014).

## Context

The owner asked for "a little bit of a flourish" and, twice, specifically about Three.js. Measured on
the live ruos-explainer before this ADR: the page's only motion was `hero-aura`, `hero-breathe`,
`hero-enter` and `prov-pulse` in the stylesheet, plus `flow-dash` and `node-pulse` inside **all four**
diagrams — i.e. an ambient glow and marching dashed lines, the exact decoration ADR-0008 and INV-23
call banned. There was no hero animation at all, because the only implemented form was the "chips"
band (a before → after value flip), and ruOS's trick is spatial, not numeric. INV-23 has specified an
authored animated SCENE since 2026-07-13 — `visuals.heroAnim.sceneSvg` — and **no code path existed
for it**: `tools/make-diagrams.mjs` built chips or nothing. The documented standard and the code had
disagreed for two months.

## Decision

**D1 — The authored scene is the primary flourish, and it is now implemented.**
`visuals.heroAnim.sceneSvg` installs as `assets/hero-scene.svg` and becomes the hero band, with alt
text read from the scene's own `<desc>`. Guards, because this reaches every build: the file must
exist, carry a `viewBox`, carry real animation (`@keyframes` or `<animate>`), and honour
`prefers-reduced-motion` with a static end state. Each failure is a loud stop. Chips remain the
fallback for genuinely abstract tricks; no `heroAnim` still means no band.

**D2 — Motion must change something the argument depends on.** A value, a position across a boundary,
or a state — never mere travel. ruOS's scene: a request crosses the login boundary, the desktop's own
cursor presses a button, the progress bar completes, a picture returns, and the port badge stays
struck through for the whole loop. A dot sliding along a dotted line is decoration in motion.

**D3 — Plain words inside the artwork too.** The first cut of that scene labelled its boundary
"SSH SESSION" — jargon the owner immediately caught, in a page otherwise rewritten for a
fifteen-year-old (ADR-0006 v1.2.0). Labels inside scenes and diagrams are page copy and obey the same
rule: "THE SAME LOGIN YOU USE", "NOTHING IS LEFT OPEN TO THE INTERNET".

**D4 — 3D (`visuals.hero3d`) is an opt-in ENHANCEMENT, never the page.** Implemented in
`tools/assemble-page.mjs`: an authored ES module is copied beside the page and mounted over the flat
scene **only** when the viewer has WebGL and has not asked for reduced motion, inside a try/catch. The
SVG scene stays in the DOM underneath. Rationale, measured rather than assumed: the quality gate
scores still screenshots, so 3D contributes nothing to the score; WebGL costs battery on phones; and a
blocked CDN must not blank the hero. 3D earns its place only where the subject is genuinely spatial —
RuView (a room sensed through walls by WiFi) qualifies; a CLI tool does not.

## Consequences

- Every repo whose trick is spatial or mechanical can now get real motion, not value-flip chips.
- A build that authors no scene is unchanged: no band, no 3D, no regression.
- Tests: `tests/hero-scene.test.mjs` (scene installs; unanimated scene refused; missing file loud;
  no heroAnim = no band) and `tests/hero-3d.test.mjs` (3D absent unless authored; flat scene stays in
  the DOM; reduced-motion and WebGL probes present; missing module fails loud).
