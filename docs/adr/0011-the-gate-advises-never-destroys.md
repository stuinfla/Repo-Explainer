# ADR-0011: The quality gate ADVISES — it never destroys a paid-for build

**Status**: Proposed (awaiting adversarial review round, Fable 5 vs GPT-5.6-Sol)
**Date**: 2026-08-06
**Updated**: 2026-08-06
**Authors**: Claude Code (Opus 5), directed by Stuart Kerr
**Prompted by**: Two consecutive hosted-build failures for `PolymathWizard/BHIL-Colophon-Spec`
(runs [30857458852](https://github.com/stuinfla/Repo-Explainer/actions/runs/30857458852),
[30865218481](https://github.com/stuinfla/Repo-Explainer/actions/runs/30865218481)) — $12.47 spent,
two complete pages rendered, **nothing delivered to the requester**
**Supersedes**: None
**Related ADRs**: ADR-0005 (Station recipe), ADR-0006 (comprehension ladder), ADR-0007 (source
identity invariant), ADR-0008 (every image teaches / INV-22)
**Code touchpoints**: `tools/deploy.mjs` (ship-bar rail), `bin/agentic-runner.mjs` (cure stage,
failure path), `tools/notify.mjs` / `tools/notify-failure.mjs` (delivery), `tools/quality-grade.mjs`
(scorecard is unchanged — only its *consequence* changes)

---

## Context

The ship-bar rail is binary. `tools/quality-grade.mjs:350` (`evaluateShipworthy`) returns
pass/fail on `mean >= 82 && min >= 70 && SHIP_OPERATORS.every(YES)`, and
`tools/deploy.mjs` refuses to publish on `false`. A refusal is terminal: the run exits 1,
the assembled page is uploaded as a private Actions artifact with 7-day retention, and the
requester receives a failure email containing no page and no link.

### Measured, this session — the cost of binary refusal

| Metric | Value | Source |
|---|---|---|
| Hosted builds, all time (from 2026-06-26) | 104 | `gh run list --workflow "Build Explainer"` |
| success / failure / cancelled | 42 / **56** / 6 | same |
| Cost per build (14 gist receipts carrying `costUsd`) | mean **$5.09**, median $4.62, range $2.92–$8.70 | build status gists |
| Distinct target repos with a receipt | 40 | build status gists |
| Distinct **external** owners served | 28 | build status gists |
| **Estimated spend on builds that delivered nothing** | **~$280** | 56 × ~$5 |

More than half of every dollar spent on this product has bought the requester nothing. The
page existed. It was rendered, graded, and thrown away.

### The refusals are not reliably correct

The Aug 4 build was killed by a single axis — **B5 (imagery craft) = 55 on desktop**, with
every other axis between 88 and 94 and a mean of 88. B5 was capped at 55 by the INV-22
raster rule, which fires only when a raster fails **both** the takeaway test *and* the swap
test (`tools/quality-grade.mjs:149`).

The raster in question (`assets/problem.png`, inspected directly) renders its brief
faithfully: labelled binders (`ACME-2026-Q3`, `RUBICON-2026-Q1`), a legible handwritten
sticky note reading *"Signal Decay Curve — worth keeping?"*, and **the same note, faded and
curling, fallen on the floor** — the project's thesis (a finding recorded, then lost) stated
in pixels. It passes the takeaway test plainly. The grader wrote *"nothing specific about
BHIL-Colophon-Spec is learned from the pixels alone"* and applied the both-tests cap anyway.

**A single stochastic vision call, with no second opinion and no appeal, is currently
authorised to destroy a paid-for artifact.** That is the defect this ADR addresses.

### Problem statement

The gate conflates two distinct questions:

1. *Is this page good enough that we are proud of it?* — a real, useful question the
   scorecard answers well.
2. *Should the customer receive the thing they paid for?* — a question the scorecard is not
   competent to answer, and currently answers "no" ~54% of the time.

Binding (2) to (1) means every grader miss, every stochastic wobble, and every structural
rubric cap converts directly into destroyed customer value and a support burden.

## Decision

**The quality gate advises. It never destroys.**

Any build that produces a complete, identity-verified page **ships to its live URL**, exactly
as a passing build does. The scorecard's role changes from *gatekeeper* to *disclosure*.

### D1 — Delivery is gated on integrity, not on quality

A build is delivered when **all** of the following hold:

- `site/index.html` exists and the page assembled without error
- the ADR-0007 source-identity invariant holds (the page is about the repo that was
  requested — this remains an absolute, non-negotiable refusal)
- the deploy itself succeeds and the live URL returns HTTP 200

Quality scores are **not** a delivery condition. There is no quality floor. A page that
renders is a page that ships.

### D2 — The score travels with the page, honestly

The delivery email states plainly where the build landed:

- **At or above the bar** — unchanged from today's behaviour.
- **Below the bar** — the email leads with the page and the live URL, then says in plain
  words that it came through below the level we hold ourselves to, names the weakest axis in
  human terms (not `B5`), and offers a re-run. The tone is a craftsperson's honest note, not
  an apology and not a disclaimer.

The **page itself carries no banner**. A quality caveat is a message between us and the
requester; a banner would degrade the artifact for every third party the owner shares it
with, which is a worse outcome than the problem it addresses.

### D3 — The scorecard remains fully honest

Nothing about grading is relaxed. Thresholds do not move, the rubric does not soften, and the
gist receipt continues to record the true scorecard. `quality.passed` keeps its exact present
meaning. We are changing what a `false` *causes*, not what it *means*. Rule 9 (no inflated
scores) is strengthened by this change, not weakened: the grader is now free to be strict
precisely because strictness no longer destroys value.

### D4 — Below-bar deliveries are tracked

Every below-bar delivery writes its weakest axis and score to the build registry, so the
distribution of *why* pages land below the bar is measurable rather than anecdotal. This is
the feedback signal that tells us which rubric axes are genuinely hard versus which are
mis-firing (as B5 did on 2026-08-04).

## Consequences

### Positive

- **~$280 of already-spent value stops being destroyed**, and the equivalent stops accruing.
- A grader miss becomes a *quality note*, not a *total loss* — the failure mode degrades
  gracefully instead of catastrophically.
- The requester decides whether the page is good enough for their purpose. They are better
  positioned to judge that than a vision model is.
- Support burden drops: "here it is, it's a bit below our bar" is a far better message than
  "your build failed", which invites a support conversation and offers nothing.

### Negative / risks

- **A genuinely poor page can now reach a customer.** Accepted deliberately: the owner's
  judgement is that a below-bar page the customer can see and re-run beats a $5 hole.
  Mitigated by D2's honesty — we never present a below-bar page as if it cleared the bar.
- **Brand exposure** — a weak page lives at a public `*-explainer.netlify.app` URL. Mitigated
  by the fact that these URLs are shared by the requester, not indexed as our showcase; the
  landing-page wall remains curated and only ever features passing builds.
- **The refine loop loses its teeth as a forcing function.** Mitigated by keeping the loop and
  its cap exactly as they are — the agent still tries just as hard; it simply no longer
  detonates the build when it falls short.

### Neutral

- Cost per build is unchanged by this ADR (addressed separately).
- `evaluateShipworthy` / `evaluatePass` keep their current signatures and thresholds; only
  their call site in `tools/deploy.mjs` changes behaviour.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Lower the ship bar** (e.g. `min >= 55`) | Dishonest — it renames failure as success and destroys the scorecard's diagnostic value. Rule 9 forbids it. Also fails to fix the real problem: *some* threshold still destroys value. |
| **Preview-only URL for below-bar builds** | The customer cannot share what they paid for, which is most of the value. Rejected by the owner. |
| **Quality banner on the page itself** | Degrades the artifact for every third party the owner shares it with. Rejected by the owner in favour of an honest email. |
| **Deliver only above a floor (mean ≥ 80)** | Keeps a category of paid-for-and-destroyed builds for no clear benefit. Rejected by the owner: deliver anything that renders. |
| **Retry until it passes** | Unbounded cost against a stochastic judge; already the failure mode the 3-call cap exists to prevent. |

## Verification

This ADR is satisfied when all of the following are demonstrated:

1. A build whose scorecard is below the bar deploys to its live URL and returns HTTP 200.
2. Its delivery email names the weakest axis in plain language and offers a re-run.
3. A build failing the **ADR-0007 identity invariant** still refuses absolutely and delivers
   nothing — proven by breaking it deliberately and watching it refuse.
4. `PolymathWizard/BHIL-Colophon-Spec` — the build that prompted this ADR — reaches Barry
   Hurd as a live URL.
5. A source-shape test pins the rule that `tools/deploy.mjs` never consults
   `quality.passed` as a delivery precondition, so this cannot silently regress.

> Per house rule: a test that cannot fail on broken code is not a test. Verification 3 must be
> proven by deliberately breaking the identity check and observing the refusal — not by
> asserting that the code path exists.
