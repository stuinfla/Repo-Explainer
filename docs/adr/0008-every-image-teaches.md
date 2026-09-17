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

---

## v1.1.0 (2026-09-17) — no rooms, no props, no people

**Status: Accepted + Implemented.** Strengthens INV-22's banned list, and moves the rule UPSTREAM
from the gate into the brief.

Both pages shipped in this session needed a hand-fixed problem image, for the same reason. ruOS drew
a person at a desk with unrelated operating-system branding; mcp-studio drew a desk scene with a
plant, coffee, books and a phone, which the vision grader correctly capped at **B5 = 55**: *"a
generic desk/plant/binder scene does not teach a discernible fact ... could ship unchanged on many
software or office-product pages."* INV-22 already banned people and offices, but the rule lived in
the SKILL and the gate — not in the prompt that actually writes the brief, so the brief drifted every
time and the gate caught it only after the money was spent.

Now in `src/brain.mjs`'s visual-brief prompt: desks, offices, cafes, windows, plants, coffee cups,
notebooks, pens, books, stray phones, sticky notes as set dressing, hands and people are banned
outright from every raster. Compose from the SUBJECT ITSELF — the screens, artifacts and objects the
repo is about — filling the frame. Every raster brief must open with a `takeaway:` line, and legible
project-specific text inside the image is the cheapest way to pass the swap test.

Measured: the replacement problem images (ruOS's finished terminal beside an unpressed Next button;
mcp-studio's same dashboard rendered twice, one tile missing and the input clipped) both teach their
section's exact claim with no props in frame.
