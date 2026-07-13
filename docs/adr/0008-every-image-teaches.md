# ADR-0008 — Every image teaches (INV-22): the image contract

Status: Accepted + Implemented
Date: 2026-07-13
Amends: ADR-0005 (skill-based recipe), ADR-0006 (comprehension ladder)

## Context

The 2026-07-13 open-connector build passed the gate (mobile 88–98) and the owner graded it
4/10: "generic drivel… what am I supposed to take away from this image? Their README is
better than this page." He was right, and the cause was in the spec, not the execution:

1. `SKILL.md`'s ladder table briefed the `problem` and `useCases` rasters as *"a human,
   relatable problem"* / *"someone like the reader succeeding"* — literal briefs for stock
   photography. Every build produced the same person-at-laptop scene because every build was
   told to.
2. The gate graded beauty, coherence, and text comprehension — no criterion demanded that an
   image carry information specific to this repo, so a zero-payload photo scored 91.
3. Each recent fix narrowed the recipe (ladder order, image types per rung, exemplar bar),
   raising the floor and lowering the ceiling: the agent consulted the previous build as its
   reference, converging the whole wall on one house style.

## Decision

1. **INV-22 — every raster must teach.** Every raster brief carries a `takeaway:` (what a
   stranger learns about THIS repo from the pixels alone). No takeaway → no image.
2. **The swap test.** An image that could ship unchanged on another repo's page fails.
   Explicit ban list: person at laptop/desk, hands typing, generic offices, glowing abstract
   networks, fake UI on fake devices.
3. **Real artifacts first.** If the repo ships a visible surface (web UI, TUI, CLI output),
   capture the real thing running and art-direct it. Generated rasters only for what cannot
   be photographed (hero metaphor, problem-made-visible).
4. **Gate enforcement.** B5 now runs a per-image interrogation (takeaway + swap test); a
   raster failing both caps B5 at 55 and sets makesMeSmile=false.
5. **Three divergent concept directions** authored and judged per build; the house look is
   never the default; reading a prior build's `build.json` for creative direction is banned
   (the exemplar bar is a quality bar, not a style guide). Rejected directions recorded in
   `concept.rejectedDirections`.
6. **Show, then say.** ~120 visible words max per section before a visual/code/structural
   element carries the next beat.
7. **Creative engine.** The runner's default model is `claude-fable-5` (verified live
   2026-07-13) — the product is creative judgment, so the top-tier model is the correct spend.

## Consequences

- Per-build cost rises (Fable 5 + real-artifact capture time); the $ budget cap governs.
- Pages diverge in style by construction; the wall stops looking like one page in costumes.
- Some sections will ship with no raster at all — by design: absence over decoration.
- Existing wall pages predate INV-22 and will fail the new B5 if re-graded; regrade only on
  rebuild.
