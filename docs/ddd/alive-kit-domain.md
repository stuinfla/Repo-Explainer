# DDD — The Alive Kit domain (companion artifacts)

**Paired ADR:** [ADR-0009](../adr/0009-alive-kit-local-companions.md)
**Status**: Accepted · **Date**: 2026-07-17 · **Updated**: 2026-07-17

## Bounded contexts

Two contexts, one direction of dependency:

- **Core Explainer Pipeline** (existing — `docs/ddd/explainmyrepo-recipe-domain.md`): produces
  the gated page. Owns the gate, the rail, the artifacts' truth.
- **Alive Kit** (this document): consumes a *finished* build and produces companions. It can
  never influence the core — no companion result feeds the gate, the rail, or the deploy.

**Anti-corruption layer**: the Alive Kit reads exactly one contract from the core — the
**BuildArtifacts** read-model: `build.json` (concept palette, story arc, quality scorecard,
publish.liveUrl) + `site/` + `assets/`. It treats them as immutable. Nothing in the Alive Kit
writes into a core slot; companion outputs land under the build dir's `renders/` and `deck/`.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **Companion** | An artifact derived from a gated build (trailer, deck, pr-video, social-loop) |
| **Capability** | A companion *kind*, with a lifecycle status in the registry |
| **Registry** | `capabilities.json` — the single truthful ledger of capability statuses |
| **Verification run** | One supervised end-to-end production of a real companion, receipts recorded |
| **Receipts** | Date, output properties, cost, duration of the verification run |
| **Local door** | A person who cloned the repo running a companion on their own machine |
| **Advertised** | Shown as available by `explainmyrepo capabilities` — requires `verified` |

## The aggregate: Capability

```
Capability {
  id: trailer | deck | pr-video | social-loop
  status: specified → built → verified      // one-way; demotion only by re-open (ADR-0009 §8)
  verifiedAt?: date
  receipts?: { output, durationS?, bytes?, costUsd, notes }
  entry?: tool path                          // present iff built or verified
}
```

**Invariants** (numbered continuing the core DDD's INV series, which ends at INV-23). Three are
mechanically enforced; two are conventions with a named human enforcement point — the doc set is
honest about which is which (the ADR's Consequences section says registry upkeep is a
discipline; these labels agree with it):

- **INV-24** `advertised ⇒ status == verified` — MECHANICAL: the CLI renders availability only
  from the registry (`bin/explainmyrepo.mjs`), so there is no second list to drift; the registry
  schema itself is checked by `tests/capabilities-registry.test.mjs`.
- **INV-25** `status == verified ⇒ receipts + verifiedAt present, entry exists` — MECHANICAL:
  `tests/capabilities-registry.test.mjs` fails the suite on violation, so a receipt-less
  promotion cannot land through a green build. Promotion and receipts land in the same commit.
- **INV-26** **hosted context never loads a companion** — MECHANICAL: every companion entry tool
  exits at startup when `CI`/`GITHUB_ACTIONS` is set, and the hosted runner has no invoking
  code path.
- **INV-27** **companions are fail-open** — CONVENTION, enforced by placement: no companion is
  wired between GRADE and SHIP, so a companion's non-zero exit cannot change the page, the
  verdict, or the deploy. Guarded at review time whenever the pipeline's station map changes.
- **INV-28** **read-only consumption** — CONVENTION, enforced at code review of each companion
  tool: a companion never mutates BuildArtifacts; outputs are additive (`trailer-project/`,
  `renders/`, `deck/`). Current tools honor it (`make-trailer.mjs` copies assets out and writes
  only its own project dir).

## Domain events

- `CapabilityVerified { id, receipts }` — the promotion moment; emitted as a registry commit.
- `CompanionProduced { id, buildSlug, output }` — a local production run succeeded.
- `CompanionFailed { id, buildSlug, reason }` — logged loudly in the build dir; core untouched.

## Domain services

- **Scaffolder** (per capability): pre-seeds the HyperFrames project from BuildArtifacts —
  the concept palette becomes the design tokens, the story arc becomes the storyboard skeleton,
  the gated assets become the asset inventory. This is the Alive Kit's core value move: the
  expensive creative truth is *reused*, not regenerated. (Deliberately distinct from the core
  DDD's INV-09, "tools never read the whole BuildContext mid-build": the Alive Kit reads a
  *finished, immutable* build post-hoc, outside the pipeline — the coupling INV-09 prevents
  cannot occur here.)
- **Verification protocol** (domain service, human-in-the-loop): run the capability end to end
  under supervision, eyeball the worst frames, record receipts, promote in the registry.

## What lives where (context map)

```
[ Core Explainer Pipeline ] --BuildArtifacts (read-only)--> [ Alive Kit ]
        owns: gate, rail, page                    owns: registry, scaffolders,
        never sees: companions                          companion outputs
```

The dependency arrow never reverses. That single sentence is most of this domain's design.
