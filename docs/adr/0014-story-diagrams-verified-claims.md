# ADR-0014 — Story diagrams: the architecture and flow slots answer the reader's real questions, with claims the tool verifies

Status: Accepted + Implemented (renderers, verifier, `make-diagrams` wiring, brain schema, tests); **not yet validated across a corpus of real builds** — see Consequences.
Date: 2026-10-10
Amends: ADR-0005 (Station 4), ADR-0012 (grounded radial architecture), INV-23 (every image teaches)

## Context

The owner reviewed the architecture and flow graphics the pipeline produced for `realiti4/claude-swap`
(the page, and the README PR) and called them "vanilla … not particularly interesting, nor even
particularly helpful". Two specific misses:

1. The flow diagram said "pick account with most quota left" as one box in a five-box vertical list.
   It never showed *which* account would be picked, or that the choice is made among several — the
   one thing a reader needs to see.
2. The owner asked, in conversation, "does this work for Claude and Codex?" — and the explainer could
   not answer. Nothing in the pipeline extracts *what it works with*.

Root cause, from `tools/make-diagrams.mjs`: `buildArchModel` and `buildFlowModel` lay out the
dependency graph and the entrypoints mechanically. They describe *how the code is arranged*. A repo
with one module and zero internal edges (claude-swap: "1 module, 0 internal edges") falls back to the
authored 3–5 card concept row — the vertical list. The renderers have no vocabulary for a *choice* or
for *compatibility*, so no prompt can make them show either.

The owner then reviewed two hand-authored graphics and said: "these should be the default … this is
the level and style I want associated with each one."

## Decision

Add two diagram types, drawn from small brain-authored models, that **replace** the architecture and
flow slots when present and verified (`src/story-diagrams.mjs`):

- **`visuals.systemMap`** → `architectureDiagram`. Inputs → one engine (2–4 steps) → surfaces with
  their real commands, plus a **WORKS WITH** strip and a **RUNS ON** row.
- **`visuals.decision`** → `flowDiagram`. Candidates drawn as gauges against a threshold; the active,
  skipped, picked and eligible ones marked; the handoff animated.

Same slots, same files (`assets/architecture.svg`, `assets/flow.svg`), same `build.json` keys — so
`assemble-page`, `readme-enhance`, the grader and the lightbox are unchanged.

### Claims are verified by the tool, never taken from the brain

This is the load-bearing rule. A picture of "works with Codex ✓" that the brain hallucinated is worse
than the vanilla one. So `make-diagrams` checks against the cloned repo (`repo.clonePath`):

| Claim | Brain supplies | The tool does |
|---|---|---|
| `yes` / `partial` | `file` + a verbatim `quote` | drops it unless the quote is really in that file |
| `no` | `terms` (1–5 words) | greps README + source itself; keeps a "no" only on **zero** matches, and records "searched … 0 matches" |
| decision rule | `rule: { file, quote }` | drops the whole decision unless the quote is in the file |

A "no" is therefore a *measurement the tool made*, not an assertion. A term that is mentioned drops
the pill — "unsupported" would be a guess. If nothing survives, the slot falls back to the grounded
graph diagram (ADR-0011: never fail a build for this). Evidence is recorded in `build.json`
(`visuals.<slot>.storyEvidence` / `.storyNotes`).

### Style

The reference is the owner-approved claude-swap pair (`tests/fixtures/story-claude-swap.mjs`): dark
card on any theme, real commands in monospace, numbers on the gauges, one idea per picture. Motion is
CSS only, gated on `prefers-reduced-motion`, and the **static state is the end of the story** so a
still image or a reduced-motion reader still gets all of it. No scripts, no `foreignObject`, no
external references.

## Consequences

- **Mobile legibility is the known weakness.** Both canvases are ~1100 px wide; on a 312 px column
  the 13 px labels render near 3.7 px. The page's tap-to-zoom lightbox covers it for now, and
  `legibilityOf` does not see CSS-sized text, so these report `null`. A portrait layout is the
  follow-up; do not claim mobile parity until it exists.
- **Not yet validated on a corpus.** Two repos' worth of evidence exists (claude-swap, hand-authored).
  Whether the brain authors good `systemMap` / `decision` models unprompted across many repos is
  unmeasured. The fallback keeps that safe; the gain is unproven until measured.
- **First tool→`src/` import.** Tools were self-contained; `make-diagrams` now imports
  `../src/story-diagrams.mjs`. Tests that copy the tool elsewhere must mirror `tools/` + `src/`
  (done in `diagram-form-diversity.test.mjs`).
- **`decision` fits choosing systems** (routers, pickers, schedulers); `systemMap` fits pipelines. A
  repo with neither should omit the keys — the prompt says so — and keeps the graph diagram.
- Numbers on the decision gauges are illustrative, and the diagram says so in its subtitle and
  `<desc>`; the *rule* is real and verified.

## Verification (2026-10-10)

- 23 unit tests (`tests/story-diagrams.test.mjs`): rendering, XML validity, no script/foreignObject,
  reduced-motion gating, scale of the gauges, truncation, escaping, and **guards proven by mutation**
  (removing the evidence/quote check fails 2 tests).
- End-to-end: `make-diagrams` on the claude-swap build with an injected fabricated claim — the
  fabricated "Cursor" pill was dropped (`quote not found in README.md`), the real claims and the
  zero-hit Codex search were kept, `xmllint` clean.
- Real brain run on claude-swap (`--only visual-brief`, then `make-diagrams`): the brain authored both
  models unprompted — including a Codex "no" — and the tool confirmed the quotes and a zero-hit search.
  The first run hit `max_tokens=6000` (the larger schema), so the visual-brief cap is now 10000.
- Full suite: 234 tests, 0 fail (dependencies installed).
