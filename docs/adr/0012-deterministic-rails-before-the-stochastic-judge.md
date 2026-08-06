# ADR-0012: Decidable properties are decided in code, before the stochastic judge

**Status**: Proposed (awaiting adversarial review round, Fable 5 vs GPT-5.6-Sol)
**Date**: 2026-08-06
**Updated**: 2026-08-06
**Authors**: Claude Code (Opus 5), directed by Stuart Kerr
**Prompted by**: The INV-23 form collision that failed `PolymathWizard/BHIL-Colophon-Spec` twice —
discovered by a ~$0.30 vision call at the refine cap, when a 20-line function could have prevented it
for $0 before a single pixel rendered
**Supersedes**: None
**Related ADRs**: ADR-0005 (Station recipe), ADR-0008 (every image teaches / INV-22),
ADR-0011 (the gate advises, never destroys)
**Code touchpoints**: `tools/make-diagrams.mjs` (`FORM`, `resolveForms`, `flowRowsFromModel`),
`tools/quality-grade.mjs` (INV-20 acronym gate — the existing precedent), `tests/diagram-form-diversity.test.mjs`

---

## Context

The quality rubric mixes two kinds of criteria, and the pipeline currently pays the same price for both:

1. **Aesthetic judgements** — "is this typography intentional?", "does this image teach?". These
   genuinely need a vision model. They are irreducibly stochastic.
2. **Structural facts** — "do two diagrams share a layout form?", "is the architecture diagram
   present and visible?", "does a ladder rung contain an unglossed acronym?". These are *decidable*.
   Code can prove them, deterministically, for free.

INV-20 (the acronym gate) already establishes the right pattern: it runs **before** the vision pass,
costs nothing, and feeds the refine loop a note it can act on. Nothing generalised that precedent.

### The measured cost of judging a decidable property stochastically

INV-23 form diversity was left entirely to the vision grader. The consequences, all verified:

- **It is expensive.** The collision is only discovered after a full render + a vision call, and
  reacting to it costs a whole rebuild cycle. Grading iterations average **3.31** across shipped
  builds (some reach 6), and grading is ~33% of build time.
- **It is late.** The discovery frequently lands at or past the 3-call refine cap, where the only
  remaining move is a post-cap fix with a single verification grade.
- **It is unreliable in both directions.** The 2026-08-03 agent, told "your diagrams share a form",
  changed the flow diagram to a horizontal ribbon — the family the big-idea diagram already occupied.
  It optimised against a symptom it could not measure, and re-collided.
- **It is unnecessary.** The property is a pure function of which renderer each slot uses. Every
  input is known before rendering starts.

### Why the previous static fix did not hold

The 2026-07-18 work introduced four distinct concept archetypes, and 2026-07-30 swapped two of them.
Both were *static table edits* accompanied by a comment asserting "pairwise distinctness holds either
way". A static table cannot encode this property, because **which renderer a slot uses is decided at
runtime**: architecture demotes when its dep-graph has no edges, flow demotes when the brain authored
real rows, flow is skipped entirely for a library repo. The table was reasoning about four concept
variants while two *separate functions* — `renderArchitecture` and `renderFlow`, both emitting a
vertical card-stack since the portrait fix — sat outside it entirely.

The 2026-07-30 comment was demonstrably false at the moment it was written, and no test caught it.
Worse: `tests/diagrams.test.mjs` **was already failing** on its archetype-mapping assertion from that
commit onward, and shipped red.

## Decision

**A property that code can decide is decided in code, before the money is spent.**

### D1 — Every render path declares a FORM FAMILY

The coarse layout shape a vision grader actually compares, not the semantic name of the diagram:

| Family | Emitted by |
|---|---|
| `vertical-stack` | `renderArchitecture` · `renderFlow` · `conceptColumn` |
| `horizontal-run` | `conceptRibbon` |
| `radial` | `conceptOrbit` |
| `containment` | `conceptStrata` |

### D2 — Assignment is RESOLVED at runtime, never assumed

`resolveForms()` takes the slots that will actually render, each declaring whether it would render
grounded, and assigns families by priority against an ordered per-slot preference list:

- Grounded slots claim `vertical-stack` in table order — architecture wins the pin, because INV-18
  mandates a real dependency map and the portrait stack is the mobile-correct geometry.
- Every other slot takes the first family from its own preference list that is still free.
- A grounded slot that loses the race is **demoted for form**: it keeps its real, KB-derived model and
  changes only its layout. Grounding is never traded for shape.

### D3 — The emitted set is ASSERTED, and the assertion fails loud

After resolution, pairwise distinctness is asserted. A colliding set `die()`s with a named reason
rather than rendering. This is the tool contract's existing FAIL-LOUD rule applied to a property that
was previously only hoped for.

### D4 — The decision is recorded, so it is auditable

Each diagram carries `form` and `formVariant` in `build.json`. A grader verdict of "two same-form
diagrams" can then be checked against what was *actually drawn*, instead of being taken on faith.

### D5 — This generalises

INV-20 (acronyms) and INV-23 (form) are now both deterministic pre-gate rails. Any rubric criterion
that is decidable from the artifact should migrate to this pattern rather than being purchased from a
vision model every build. The vision grader's budget belongs to judgements only it can make.

## Consequences

### Positive

- The form collision is **structurally impossible** rather than merely discouraged.
- A vision round-trip and, frequently, an entire refine iteration are removed from the common path —
  directly serving the sub-$3 build target.
- The failure mode moves from "silent bad output discovered late" to "loud refusal at the earliest
  possible moment", which is the house FAIL-LOUD contract.
- Mis-directed agent fixes (2026-08-03's re-collision) become impossible: the agent no longer has to
  guess at a global property from a local symptom.

### Negative / risks

- **The family taxonomy is a judgement call.** If the vision grader lumps two families we consider
  distinct, the resolver will happily emit them and the cap can still fire. Mitigated by D4: the
  recorded forms let us detect exactly that disagreement and refine the taxonomy against evidence
  rather than opinion.
- **A demoted grounded flow loses detail** — the IN/OUT artifact annotations of the full `renderFlow`
  card are not present in a concept chain. Accepted: a legible distinct shape beats a richer duplicate
  one, and the stage names, source and result are preserved.
- **Preference lists are load-bearing and non-obvious.** Mitigated by tests covering all four
  reachable configurations plus a mutation test.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Another static table edit** | Exactly what failed twice (2026-07-18, 2026-07-30). A static table cannot express a runtime-dependent property. |
| **Tell the grader the forms are distinct** | Biases the judge and destroys the independent signal we rely on to detect taxonomy drift. |
| **Write a new serpentine renderer for flow** | Real work with real mobile-legibility risk, when demoting to an existing, tested archetype already yields a distinct family. Reconsider only if evidence shows the demoted chain grades worse. |
| **Relax the INV-23 cap** | Dishonest, and it does not address the cause. The cap is right; emitting collisions is wrong. |

## Verification

1. A fixture with a grounded architecture **and** a grounded flow (the exact BHIL-Colophon-Spec shape)
   emits four pairwise-distinct families. ✅ `tests/diagram-form-diversity.test.mjs`
2. Architecture and flow specifically never share a form. ✅
3. A flow demoted for form retains its real entrypoint-derived model. ✅
4. The property holds when architecture also demotes, and for a library repo with no flow. ✅
5. **Mutation proof** — with a slot stranded (no archetype available), the tool *fails loud* naming
   INV-23 rather than emitting a collision. ✅ A test that cannot fail on broken code is not a test.
6. The previously-red `tests/diagrams.test.mjs` archetype assertion is green again. ✅

> Caught during implementation by test 4: the first preference lists omitted `column` entirely, so
> when no slot was grounded the `vertical-stack` family went unused and the fourth slot starved. The
> resolver correctly refused rather than colliding — the guard worked before the code was right.
