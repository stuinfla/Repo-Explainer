# ADR-0006: The Comprehension Ladder — First-Principles Altitude Control

Updated: 2026-07-03 13:20:00 EDT | Version 1.1.0
Created: 2026-07-03 12:05:00 EDT

> **v1.1.0 (2026-07-03) — proof-run findings folded in.** Rebuilding lattice under v1.0.0
> surfaced four refinements, all implemented: (1) **D1 gains the CONCEPT BUDGET** — a gloss is
> not a free pass; rungs 1–4 may introduce at most THREE domain concepts total (the critic
> correctly held a page whose first four sections glossed ten terms: glossing ≠ scaffolding).
> (2) **INV-20 recognizes natural gloss grammar** — appositive ("…, or GDN state"), dash and
> comma-appositive forms, not only parentheses; the linter was rejecting genuinely good copy.
> (3) **The refine loop now shows the reviser its previous version** (src/brain.mjs) — a blind
> rewrite cannot "keep what works" and played acronym whack-a-mole (fixing RAM reintroduced KV);
> with the prior content in-prompt, violations fell monotonically. (4) **Best-iteration restore
> tie-breaks on fewest INV-20 violations** (src/orchestrator.mjs) — when every iteration has
> mean 0 (no vision pass ran), "best" must be the closest-to-clean, not the first. Also:
> RAM/GB/MB/TB joined the whitelist (universal units); KB deliberately did NOT (this product
> uses KB = knowledge base). Live validation: all three previously-shipped pages (lattice,
> hono, video-sync) FAIL the new gate on exactly the terms the first real reader complained
> about; the ladder-authored rebuild passes INV-20 and is held only by the (correctly) stricter
> beginner-persona operators — the gate now refuses what it used to ship.

**Status:** Proposed — awaiting owner sign-off (D4 changes the operator gate, which is
owner-signed by ADR-0005 convention; everything else is ready to implement on approval).

**Amends:** ADR-0005 (Station 3 AUTHOR, Station 6 ASSEMBLE, Station 7 QUALITY GATE / The QA
System). Does **not** supersede it — the one-brain/three-doors architecture, the stations, the
image ladder, and the exemplar-anchored bar all stand. This ADR fixes the one thing ADR-0005
never encoded: **who the reader is allowed to be.**

---

## The Mission (the owner's words, 2026-07-03 — this is the completion bar)

> "Take somebody from not knowing anything about it, to not caring about it, all the way up to
> a deep level of understanding and a high degree of confidence."

The reader must leave understanding, in this order: **what the issue is → how it solves it →
why it's elegant → why it's clever → how they would use it → what the experience would look
like.** Start at first principles. Don't start deep into an assumed knowledge base. The page
must still look world-class — the visual bar is unchanged; this ADR is about *effectiveness*.

## Context

### The evidence (first real readers, 2026-07-03)

- Mondweep Chakravorty (first external user, the lattice explainer): *"the current explanation
  is rather advanced — e.g. lots of acronyms and assumptions the reader understands them …
  currently the explanation is rather technical; so not necessarily useful for many."*
- Independent verification on `hono-explainer.netlify.app` found the identical defect: **JSX,
  SSG, KV, R2, ESM, CJS all used with no definition**, and section 03 assumes familiarity with
  router internals and performance profiling.

### Why the simplest-first thread was lost (mechanism, not vibes)

The comprehension arc (ADR-0005 D6) orders the reader's *questions* simplest-first — but nothing
constrains the *vocabulary or assumed knowledge* used to answer them. Three concrete mechanisms:

1. **The voice spec writes for a peer.** The content author's system prompt casts "a senior
   technical writer" and the voice default is "clear, confident, technical-but-human"
   (`src/brain.mjs:116`). A senior technical writer writing for their peer produces exactly
   what Mondweep read.
2. **INV-06 grounding pulls insider vocabulary in.** Every claim must trace to a KB passage —
   and the KB is the repo's own docs and source, written in the project's insider dialect. The
   most "traceable" words are precisely the acronyms.
3. **No beginner sits on the jury.** The vision critic and the five operator questions judge
   approachability — but the judge is an expert model that already knows what SSG means. An
   expert grading "approachable" never trips on jargon it understands. The gate *cannot* catch
   this failure class as constituted.

### Ecosystem precedent (grounded in rUv's real source)

- rUv's own documentation pattern ships **layered audience tiers** — a Beginner → Intermediate →
  Advanced learning path over one set of progressively deeper documents, not parallel rewrites
  (`agentic-flow/examples/climate-prediction/DOCUMENTATION_INDEX.md`).
- SONA's first design principle — "learn from every interaction; no query is wasted; all become
  training signal" (`ruvector/examples/ruvLLM/docs/SONA/00-OVERVIEW.md`) — names the loop this
  product currently runs open: twelve pages shipped before the first reader could say "too
  technical."

## Decision

### D1 — The Comprehension Ladder: every section gets an altitude limit

The eight sections keep their ADR-0005 order; they gain an explicit **altitude** — the maximum
knowledge the copy may assume. The ladder maps the owner's six outcomes one-to-one:

| Rung | Section | Owner's outcome | Altitude (assumed knowledge) |
|---|---|---|---|
| 1 | `hero` | (hook — make them care) | **Zero.** Human terms only. |
| 2 | `problem` | *what the issue is* | **Zero.** First principles (D2). |
| 3 | `whatItIs` | *how it solves it* | **Zero.** Plain-language mechanism. |
| 4 | `insight` | *why it's elegant / why it's clever* | **Zero.** The "aha" in plain words. |
| 5 | `howItWorks` | (descend ONE level) | General developer; every term defined. |
| 6 | `useCases` | *how they would use it* | Reader's own world, their words. |
| 7 | `getStarted` | *what the experience would look like* | Command + what they'll SEE (A6/INV-19). |
| 8 | `pack` | (their AI reaches full depth) | Deep — this is where expertise lives. |

**The reader model for rungs 1–4 is fixed: "a smart developer from a *different* domain."**
Smart — so the copy never condescends. Different domain — so nothing domain-specific may go
undefined. Altitude may only *increase* down the page, one level per rung, never skipping.

### D2 — The first-principles problem law

The `problem` section must make the reader **feel the pain in human-consequence terms before any
category vocabulary appears**. Rule of thumb, enforced in the Station 3 spec: *never name the
solution's category before the reader feels the problem it kills.* ("Your build breaks at 2am
and the log says nothing" comes before any mention of "observability.") The hero may intrigue;
the problem must teach from zero.

### D3 — The vocabulary law + INV-20 UnexplainedAcronymZero (deterministic, free)

- **Define at first use, everywhere:** any acronym or term of art gets a plain-words gloss the
  moment it first appears, at every altitude.
- **INV-20 (new invariant):** a *mechanical* linter runs over the rendered copy of rungs 1–4
  before the expensive vision pass: any token matching an acronym pattern (2–6 uppercase chars)
  that is not on the small owner-tunable whitelist (`AI, API, CLI, URL, GitHub`-class terms)
  and not immediately followed by a gloss **fails the build** — same class as INV-18, caught
  for zero tokens. Deterministic first, model judgment second.

### D4 — A beginner joins the jury (owner-signed gate change)

1. **Beginner persona pass in the grader:** the vision critic is additionally instructed to
   role-play the D1 reader (smart, different domain) reading rungs 1–4 on the real screenshots,
   and must **list every sentence it could not follow and every term it had to already know**.
   A non-empty list is a named weakness; unexplained acronyms are an INV-20 confirmation.
2. **Sixth operator question** (joins the five of ADR-0005, all must be YES on both devices):
   > **O6 — "Could someone who knows nothing about this domain read the first four sections and
   > explain the problem and the solution back to me?"**

   This encodes the owner's standing teaching — *start from the simplest version* — in the one
   place owner judgment is enforceable. The exemplar-anchored bar (mean ≥ 90 / min ≥ 85) is
   unchanged.

### D5 — Progressive disclosure: one page, "go deeper" — not three variants

Mondweep's beginner/intermediate/advanced ask is honored as **layers, not forks**:

- The **default page IS the beginner path** (rungs 1–4 at altitude zero — the owner's
  "start from the simplest version," made structural).
- Sections from `whatItIs` onward may carry a **"go deeper" expander**: a collapsed, KB-grounded
  technical layer (citations required, same INV-06 rules) holding what the current pages put
  inline. Depth is opt-in by the reader, exactly one interaction away.
- **Rejected alternative — three separate builds per repo:** ~3× authoring + grading cost, three
  URLs splitting shares and SEO, three pages to hold at the bar. The layered pattern is also
  the ecosystem precedent (climate-docs learning path, above).

### D6 — Close the reader-feedback loop (Phase 3, SONA principle)

Every generated page carries a one-tap signal — **"Clear" / "Too technical"** (+ optional
"I'm new to this / I work in this domain") — posting to the existing build registry. The
Station 3 prompt consumes accumulated signals the same way it consumes `refineNotes`, so every
reader reaction becomes next-build training signal instead of a message the owner has to relay.
Deferred until the widget's visual treatment is owner-approved (it must not cheapen the page).

### D7 — Confidence is the top rung (no new machinery)

The ladder's completion state is the existing **A6 Implementation-confidence / INV-19** bar,
now explicitly tied to the mission: the reader leaves knowing *what to run and what they will
see* — the owner's "high degree of confidence." A page that teaches but doesn't instill the
"I could do this now" feeling has not finished the climb.

## Consequences

- **Cost:** INV-20 linter and the O6/persona instructions are ~free (text rules in existing
  calls). D5 expanders add roughly 10–30% content-authoring tokens per build (Phase 2 only).
- **Risk — over-simplification for genuinely expert repos:** mitigated by D5 (depth is one tap
  away, and `howItWorks`/`pack` keep full technical altitude) and by the unchanged craft bar.
- **Risk — INV-20 false positives** (product names in caps, e.g. RVF in our own pack copy):
  whitelist is per-build extendable by the brain *only* with an inline gloss recorded.
- **Existing pages:** the ten shipped explainers predate this ADR; rebuild opportunistically
  (lattice first — its reader asked).

## Implementation plan (on owner sign-off)

- **Phase 1 (same day):** D1–D4 — Station 3 spec + `src/brain.mjs` voice, INV-20 linter,
  RUBRIC + O6 in `tools/quality-grade.mjs`, tests in the ADR-0005 conformance style. Rebuild
  lattice; send to Mondweep for the group call.
- **Phase 2 (this week):** D5 expanders in `tools/assemble-page.mjs` + Station 3 authoring of
  the deep layer.
- **Phase 3 (after widget design approval):** D6 feedback loop.
