# ADR-0016 — "Ask this project": a written, cited answer box on every explainer

Status: Accepted + Implemented (station, central service, deploy gate, tests). **Answer quality at scale is
not yet measured** — it was checked on one repo (REA) with 11 reader-style questions, not across repos.
Date: 2026-10-16
Amends: ADR-0005 (adds Station 6c `make-ask`; `deploy` gains a site-integrity gate)
Version: ships in 3.0.0
Prior-decision check: the recorded-decision recall timed out, so that history is UNKNOWN. Reading `docs/adr/`
0005–0015 and searching them for an on-page chat or ask box found nothing to conflict with or supersede.

## Context

An explainer answers the questions its author anticipated. A reader's next question — "does it work with X?",
"what does it store about me?" — had nowhere to go. The knowledge pack's question tool is a command-line / MCP
tool for the reader's *AI*; it needs Node, native vector libraries and a downloaded model, so it cannot run in
a static page. A first prototype (search only) gave junk answers: lexical lookup returns passages, not answers.
A second (function + key on every explainer site) was reviewed by an independent Opus pass, which found the
endpoint was an open proxy on the key (the page supplied its own excerpts).

## Decision

1. **Cheapest rung first, in the browser:** BM25 over the page's own sections, then the repo's passages
   (`ask/index.json`, ~1 MB gzipped, loaded on first focus, indexed in slices so phones are not blocked).
2. **A small model writes the answer**, from numbered notes, with citations that link to the exact files.
   If the service fails, the box shows the closest passages and says so — it never fakes an answer.
3. **One central service** (`ask-service/`, its own Netlify site), not a function per explainer. The browser
   sends only a question and passage ids. The service verifies an HMAC token for the site's host
   (`src/ask-token.mjs`), fetches that site's own `ask/index.json`, and builds the notes itself, so it cannot be
   used to push arbitrary text through the model. Per-site and global daily caps use compare-and-set on the
   counter and **fail closed**.
4. Explainers stay **pure static zip deploys**. `make-ask` leaves a credential placeholder; `deploy` fills it
   once the final Netlify host is known. With no `ASK_SIGNING_SECRET` the box ships in closest-passages mode.
5. **`deploy` refuses a broken page** (`src/site-check.mjs`): a linked local file that is not shipped, a link to
   localhost, a dead Ask box. Metadata gaps are advisory only. Checked against all 18 existing builds first.
6. The page's section starter questions are authored to be things the page does **not** already answer.

## Considered and cut (review verdict, 2026-10-16)

Three-lens tabs (restated the page and pushed the story down ~1,300px), a "newer version" polling banner, a
Save-as-PDF dialog (browser print + a print stylesheet suffice), accounts/invites, the fleet security scan,
view analytics (a beacon already exists), a hosted MCP builder (deferred until asked for).

## Consequences / open

- Needs, outside the repo: the ask service site with `OPENROUTER_API_KEY` and `ASK_SIGNING_SECRET`, and the same
  `ASK_SIGNING_SECRET` on every build machine (including the hosted runner's secrets). **Give the service its own
  OpenRouter key with a spend limit — that limit is the real backstop.**
- A page summary can overclaim relative to the repo; the service prompt says to trust the repo's files when they
  disagree, but the page itself is not corrected by this.
- Cost per question is estimated at roughly $0.001 (one tiny sample measured at $0.0001); not yet measured at volume.
