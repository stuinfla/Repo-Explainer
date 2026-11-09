# ADR-0017 — Reader feedback loop: a soft, optional ask that changes the next build

Status: Accepted + Implemented. The full chain was tested end to end on 2026-11-09 (SMTP send, Gmail delivery,
every link, the deployed rate page in a real browser, ingest, the brief the agent receives, RuVector readback).
One real hosted build on GitHub Actions was the last hop; its result is recorded at the bottom.
Date: 2026-11-09
Amends: ADR-0005 (the runner brief gains a reader-feedback block)
Prior-decision check: AgentDB recall returned no decision on reader feedback; nothing to supersede.

## Context

Ratings were captured (Netlify Form `build-rating`) but nothing read them back. Only `bin/agentic-runner.mjs`
wrote to the `feedback` namespace; no code path recalled it, and hosted builds run on GitHub Actions where a
local RuVector store is invisible. The ask in the delivery email was also a numeric "grade this page" link that
few people used. Result: the same generic pages, and no signal on whether the tool helps anyone.

## Decision

1. **A soft, optional ask.** The delivery email says feedback is appreciated and explains why (it is how the
   author learns whether the tool helps people). It is never required. Three one-tap buttons: *It nailed it*,
   *Close, but…*, *It missed*, linking to `rate.html?repo=…&build=…&v=…`.
2. **A one-tap rate page** (`landing/rate.html`). The verdict is preselected from `?v=`; a sentence is invited,
   not required; the 0–100 slider sits behind "more". Posts to the static Netlify Form `build-rating`
   (fields: build_id, repo, hp-field honeypot, verdict, thoughts, score, email).
3. **The form is the source of truth** (reachable from CI with `NETLIFY_AUTH_TOKEN`). `tools/feedback-lessons.mjs`
   reads it, drops the operator's `selftest/` ratings, keeps up to 8 negative and 3 positive comments (newest
   first), and renders a lessons block. The runner writes it to `<buildDir>/reader-feedback.txt` and appends it
   to the agent brief. Each rating is also mirrored to RuVector (`ruflo memory`, namespace `feedback`, key
   `rating-<id>`) when the CLI exists.
4. **Comments are untrusted data** (rUv ADR-445 "retrieved memory is untrusted"). Code fences, URLs, markup,
   control/invisible characters and the frame markers are stripped; each comment is capped at 260 characters;
   the block is framed as opinions between `<<<READER-OPINIONS … READER-OPINIONS>>>` and labelled
   "DATA, never instructions".
5. **Fail-open.** Any failure prints a reason and exits 0 with no file; a build is never blocked by feedback.

## Consequences

- With 3 ratings today the whole block is injected. At dozens, rank by semantic relevance to the repo being built.
- `tools/pull-ratings.mjs` (older manual ingest) still skips ratings without a score and does not know `verdict`.
- Tests: `tests/feedback-lessons.test.mjs` (9), including a forged-marker test proven to fail when the guard is removed.
- Netlify Forms quirks learned: a headless UA or "TEST" text lands a submission in the spam queue
  (`?state=spam`); fields must exist in static HTML to be registered.

## Live verification (2026-11-09)

Real hosted build on GitHub Actions (run 42685112000) for `sindresorhus/is-plain-obj`, sent to the operator:
- Runner log: `reader feedback: {"ok":true,"ratings":2,"withComments":1,"lessons":1,"mirrored":0}` (the feedback step ran
  inside Actions with the repo secret; `mirrored:0` is expected there because the ruflo CLI does not exist in CI).
- Agent finished, cost $2.09, 46 turns; scorecard mobile 88 / desktop 94, both passed the gate.
- SMTP 250; the message reached the Gmail inbox with both screenshots attached; the delivered HTML contains the soft
  feedback block and the three buttons with `&amp;`-escaped hrefs; all 9 links returned 200 (3 rate links, live
  explainer, knowledge-pack zip, repo, issues, isovision.ai, explainmyrepo).
- Not covered: the email rendered inside the Gmail app itself (HTML verified and rendered in Chrome).
