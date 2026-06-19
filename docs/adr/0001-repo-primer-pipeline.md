# ADR-0001: Repo-Primer Pipeline Architecture

**Version:** 1.4.0  
**Created:** 2026-06-19  
**Last updated:** 2026-06-19  
**Status:** Accepted · Partially Implemented — the core pipeline (dual-half bundle, RVF KB, scope-boundary via `.gitmodules`, change-based evergreen CI, guard-before-publish) is BUILT and live on RuView + ruvector. Generalized per-repo scripts, delta-highlighting, full ≥5-strategy force-walk, comprehension-arc coverage check, and the multi-repo repo are NOT yet implemented. (see Implementation Status table; see Post-Review Addendum)  
**Working name:** "Repo-Primer Pipeline" (subject to rename — note that this name is not yet canonical)  
**Domain model:** [repo-primer-domain-model](../ddd/repo-primer-domain-model.md)

> **This ADR is the single binding end-to-end guideline (one ADR ⇄ one DDD).** It has two parts. **Part I** (immediately below) — the pipeline architecture (dual-half bundle, RVF variants, scope boundary, evergreen, distribution), proven on RuView + ruvector. **Part II** (at the end of this file) — the **Explainer Website** (co-equal hero artifact), **concrete use-case galleries**, and the **Self-Evaluating Quality Gate** (*"done = proven-good, with evidence"* — the cure for the un-graded-KB / 4–5-regeneration failure). *(Part II was briefly drafted as ADR-0002 on 2026-06-19, then merged here so there is exactly one ADR paired with one DDD.)* This repo covers **brand-new repos only**, one at a time.

---

## Context

Reuven Cohen ("ruv") ships new repos at high velocity. They are powerful, often novel, and consistently under-explained — "power tools without handles." Newcomers are handed an artefact they cannot orient to, so the tool goes unused even when it would be exactly right for their problem.

This happened concretely with RuView and ruvector. Stuart built a downloadable explainer/proof-point bundle for each, proved the approach works end-to-end (live at <https://cognitum-sensor-primer.vercel.app>), and now wants to:

1. Canonicalize the full optimized process as a durable record (this ADR).
2. Generalize it into a separate reusable repo that runs the same process on ~6 additional ruv repos.

The ADR covers the two-repo prototype (accepted state) and the generalized repo (committed next step). Decisions here are binding constraints for the generalized implementation.

### Implementation Status

| BUILT & PROVEN (live, RuView + ruvector) | DESIGNED — NOT YET BUILT |
|---|---|
| Dual-half bundle (`for-humans/` + `for-ai/`) | Delta-highlighting (surface what's new each refresh) |
| Prototype (RuView + ruvector) built with OLD dual-variant approach: 384-dim MiniLM-small (auto) + 768-dim bge-base (manual, carried-forward) — **superseded design, historical only** | Full ≥5-strategy force-walk (currently: source tree + deep-docs + crate-src; missing API/exports, examples, changelog passes) |
| | Single-384-dim bge-small-en-v1.5 variant per new repo (current design — NOT YET BUILT; no generalized build script exists) |
| Change-based evergreen trigger (cron polls; dispatches rebuild only when upstream SHA moved) | Comprehension-arc coverage check in the guard |
| Guard: anti-truncation + parity + live-query (non-empty result; does NOT yet verify all 7 arc stages are covered) | Generalized multi-repo repo |
| Rolling GitHub Release `kb-latest` (--clobber) | Automated NotebookLM authoring (today: manual source curation + Studio pull via `nlm` CLI) |
| Loose <100 MB KB files committed; bundles gitignored | |
| Live page provenance from `/kb/.last-built.json` | |
| Scope-boundary exclusion via `.gitmodules` | |

---

## Decision Drivers

1. **Comprehension arc** — an artifact only succeeds if it delivers all 7 stages for a newcomer who has never seen the repo: (1) What is this concept? (2) What can you do with it? (3) Why was it built? (4) What problems does it solve? (5) One concrete end-to-end example. (6) 3–4 other application areas. (7) How exactly do I implement it (concrete path)? After the human half a newcomer must be able to answer all 7. An agent loaded with the AI half must be able to start using the tool on a real task. If either test fails, the primer failed. **Guard requirement (target — not yet implemented):** the guard must verify that the HumanHalf + primer passages cover all 7 stages; today's live-query check only confirms non-empty results.
2. **Dual audience** — humans need orienting narrative; AI agents need a queryable, dense, correct knowledge base. Serving both from one bundle multiplies value without proportional cost.
3. **Evergreen currency** — a stale primer is worse than no primer: it teaches wrong things with confidence. The pipeline must stay current automatically.
4. **Simplicity over cleverness** — every step that requires expert intervention is a step that won't happen for the sixth repo. Choices must be reproducible by someone new to the project.
5. **Proof-point as artifact** — the AI half (queryable RVF KB) is not just a tool asset; it is a demonstration that the repo is real, working, and usable. This doubles its value.

---

## Decision

### D1 — Dual-half bundle: one download, two audiences

Each target repo ships as a single zip with two clearly-labeled halves:

- **`for-humans/`** — NotebookLM Studio outputs: explainer video (mp4 ~37 MB), audio overview (mp3 ~41 MB), slide deck (native PDF ~19 MB — no OCR), infographic PNGs (process diagram + concept diagram). (Figures measured, RuView build, June 2026.) Teaches orientation, motivation, and use cases. **Note: the human half is authored manually — sources are hand-curated into NotebookLM and Studio outputs pulled via `nlm` CLI; it is NOT generated from the force-walk passages.**
- **`for-ai/`** — an RVF knowledge base (`.rvf` — RuVector Format, single-file HNSW vector DB) of the repo's own code and docs, plus Whisper transcripts (audio/video), a notebook summary, and a README. Enables agents to actually use the tool on a real task.

**Rationale:** This is the sharpest decision in the ADR. Each audience alone produces a one-dimensional artifact. Combined, the bundle is simultaneously the explanation (human half teaches) and the proof point (AI half is a working queryable artifact). The bundle size — approximately 138 MB (measured, RuView build, June 2026) — is manageable as a Release asset and is a one-time download, not streamed.

### D2 — RVF for the AI half (ONE desktop variant: 384-dim) — revised v1.3.1

The AI half ships **a single RVF file** built with `@ruvector/rvf` (Node), embedded with **`Xenova/bge-small-en-v1.5` (384-dim)** — a strong retrieval model (instruction-prefixed BGE family) and the best quality-per-byte/ms point for **running on a desktop/laptop**, which is the only place these brand-new repos' KBs will run. One embedding pass, one file: lightest, fastest to build, simplest to drop in. `close()` is the only persist path — never hold a partial-write RVF open across an error boundary.

**Why one, not two (revised 2026-06-19):** The prototype shipped a 384-dim `all-MiniLM-L6-v2` "small" variant alongside a 768-dim `bge-base` "big" one — that dual approach is superseded for new repos. The 384-dim small variant exists **only** to run on constrained edge hardware (the Cognitum-1 Seed); new repos run on desktops. The 768-dim big variant adds a second embed pass, a second file, parity-guard complexity, and a manual rebuild step for marginal desktop gain. Drop both; standardize on the single **384-dim `bge-small-en-v1.5`** variant.

- **Best dimension = 384** (`bge-small-en-v1.5`): per the Ruflo embedding assessment, at this corpus size (2k–8k passages) the retrieval-quality gap between 384 and 768 is empirically negligible — the lever is *model quality + structure-aware chunking* (D5), not raw dimension. `bge-small-en-v1.5` is a strong retrieval model (beats the old `all-MiniLM-L6-v2`); 768 (`bge-base`) and 1024 (`bge-large`) cost ~2–3× the file/build/RAM for ≈1–2 MTEB points that don't move the needle on a single small repo. PROVE-IT: #1 (MetaHarness) passed Gate A at 99.9 on an even-weaker 384 model.
- **Heavier step-up (only if needed):** if a given repo genuinely can't clear Gate A ≥95 at 384, step that repo up to 768 `bge-base-en-v1.5`. Default for all targets is single-384.

### D3 — Scope boundary: one KB per repo, no cross-repo or vendored content

Each KB indexes **only the target repo's own authored tree.** Build scripts read `.gitmodules` at build time and exclude every nested submodule path. Vendored dependency trees (e.g. `vendor/`) are excluded by pattern. Cross-tool content belongs in the other tool's primer.

**Rationale:** RuView vendored the entire ruvector engine under `vendor/`. Recursive indexing produced ~44 k chunks, overwhelmed `RvfDatabase.close()`/persist on a 2-core CI runner (manifested as `ManifestNotFound`), and would have taught a newcomer about ruvector internals inside a RuView primer — wrong tool, wrong audience. Tight scope boundaries prevent both the technical failure and the comprehension failure.

### D4 — Evergreen automation: change-based cron poll → explicit workflow_dispatch

The daily scheduled workflow is a **change-based poll**, not a blind rebuild trigger:
1. Checks whether the upstream submodule SHA moved (`git diff --quiet` on the submodule pointer).
2. If changed: commits the updated pointer, then explicitly calls `gh workflow run` to dispatch the rebuild workflow.
3. If unchanged: exits without committing or dispatching — no unnecessary CI spend.

The dispatch step requires `actions: write` permission in the token.

**Why not rely on the push event?** A `GITHUB_TOKEN` push does NOT trigger `on: push` workflows — GitHub's anti-recursion guard. Silent failure: the auto-update looked wired but never fired for days. The explicit `gh workflow run` dispatch is mandatory.

### D5 — Multi-walk KB construction: force-walk SEVERAL DIFFERENT WAYS (target architecture)

**Current state (built):** the build walks source tree + deep-docs + crate-src.

**Target state (not yet implemented):** each rebuild indexes the repo across ≥5 traversal axes:
- Source tree (all authored code files) ✓ built
- Deep-docs / ADRs / design notes ✓ built
- Crate-src (Rust crate source) ✓ built
- Public API surface (exports, re-exports, public types) — follow-up
- Examples and integration tests — follow-up
- Changelog and release notes — follow-up

Additionally, each rebuild must produce a **delta layer** (follow-up — not yet implemented) that explicitly surfaces what is new in this version — new functions, new capabilities, changed APIs — on top of the baseline passages. This makes the KB delta-aware, not a flat re-dump.

**Rationale:** A single flat file walk misses things a newcomer most needs: "what can I do with this?" is answered by examples and public APIs, not source internals. "What changed since I last looked?" is answered only by explicit delta extraction.

**Structure-aware chunking (binding — added v1.3.0, per the Ruflo embedding assessment):** chunk at **code/document structure boundaries**, not fixed token windows — split at function/class/method boundaries, keep a doc-comment attached to the symbol it documents, and split prose/README at heading boundaries; target ≤512 tokens/chunk. At this corpus size, **chunking quality dominates retrieval quality more than the embedding model or dimension does** — naive fixed-window chunking with a strong model loses to structure-aware chunking with a smaller one. Implemented in `kb/corpus-rules.mjs`; the build must verify it (not assume it).

**`source_type` tagging + tests/examples inclusion (binding — added v1.4.0):** every Passage MUST carry a `source_type` tag — one of `src | test | example | doc | config` — and the ForceWalk MUST INCLUDE the repo's **tests and examples**, not just `src`. Tests and examples are the single best *usage* documentation a repo has ("how do I actually call this?" is answered by an example, not by source internals); excluding them strips the KB of exactly the passages a newcomer's agent needs most. The `source_type` tag also lets retrieval bias toward the right kind of passage (an API question hits `src`, a usage question hits `example`/`test`) and feeds the coverage gate (D27/D-coverage) and the AI-comprehension deep-dive (D26). Implemented in `kb/corpus-rules.mjs` (`testsAndExamples` rule); the build must verify the tag is present on every passage and that ≥1 `test`/`example` passage exists where the repo has them.

### D6 — Guard before publish: anti-truncation + parity + live-query

The following checks run after the RVF build and before any publish step:

1. **Anti-truncation (built):** chunk count must meet a minimum threshold; a build that indexes zero or near-zero chunks is a silent failure. An upper-bound check (catches accidental over-ingestion re-adds) is a follow-up item.
2. **Parity (built, revised v1.3.0):** the single RVF variant must be present and non-zero. *(The old both-variants parity check is dropped with the single-variant decision — D2/F.)*
3. **Live query (built):** execute at least one comprehension-arc query against the RVF and confirm a non-empty result set is returned. **Note: today's live-query check only confirms non-empty results — it does NOT verify coverage of all 7 arc stages. A stage-coverage check is a follow-up item.**

Red on any check → stop; do not publish. Never clobber the live, correct download with a broken rebuild.

### D7 — Distribution split: Release for binaries, git for loose KB files

- Bundles (zip, all media, single RVF file) → GitHub Release tagged `kb-latest` (--clobber, permanent URL). Binaries are gitignored; they exceed GitHub's 100 MB/file limit as a combined bundle.
- Loose KB files (individual `.rvf` files, each under 100 MB) → committed to git as source of truth.
- The static page downloads from the Release URL, not from the Vercel deploy.

**Rationale:** Git is not a binary store. Keeping the loose `.rvf` in git ensures the KB is always recoverable, versionable, and diffable by byte count. The bundle's combined size forces the Release path; co-locating the download URL on the Release gives a permanent, stable link that survives repo forks.

### D8 — Surfacing: static page with live provenance

A Vercel-hosted static page (git-connected, auto-deploy on push) shows:
- Visual two-halves layout (generated images, file directory per half, friendly 3-step install).
- Off-page links open in new tabs.
- **Live provenance:** the page fetches `/kb/.last-built.json` at load time to show rebuild date and submodule SHAs. This is not decorative — it lets a user verify they have the current build before trusting the content.

**Concrete newcomer on-ramp (3-step install):**
```
1. Download the bundle zip from the GitHub Release page.
2. Unzip it — you get for-humans/ and for-ai/ side by side.
3. Point your agent at the AI half:
   const db = new RvfDatabase("for-ai/<repo>-kb.small.rvf");
   const hits = await db.query(queryVec, 10);
```

**Example agent query against the shipped `.rvf`:**
```js
// After loading for-ai/ruvector-kb.small.rvf:
const results = await db.query(embed("How do I build an HNSW index from my own vectors?"), 5);
// Returns ranked passages from ruvector's own source tree and docs
```

### D9 — Concurrency guard on CI commit steps

Any CI step that commits back to the repo must:
1. `git pull --rebase --autostash` before push.
2. Retry up to 3 times on push rejection.

**Rationale:** A concurrent commit landing mid-build (e.g., a submodule bump concurrent with a rebuild) will reject the push. Without the retry loop, the rebuild completes but never republishes, silently leaving the stale Release.

### D10 — Generalization: parameterize per target repo, shared scripts

The generalized repo exposes a per-target config (TOML or JSON):

```toml
[repo.ruvector]
submodule = "repos/ruvector"
notebook_id = "<notebooklm-id>"
embed_model = "bge-small-en-v1.5"  # 384-dim; step up to bge-base-en-v1.5 (768) only if Gate A < 95
exclude_paths = ["vendor/", ".git/", "node_modules/"]
```

GitHub Actions workflows, RVF build/guard/bundle scripts, and the static surfacing page are shared. Only the per-target config and the NotebookLM notebook (authored manually) differ between repos.

---

## Considered Alternatives

### Alt 1 — README / markdown docs only

**What it costs:** Purely static text cannot demonstrate query-ability. There is no proof-point artifact. The human on-ramp is text-dense with no orientation arc. Docs go stale silently.

**Why rejected:** Fails the comprehension arc test for both audiences. Does not produce a working AI-half artifact.

### Alt 2 — Hosted wiki / docs site

**What it costs:** Requires ongoing hosting, maintenance, and authoring discipline. Does not produce a downloadable, self-contained artifact. The AI half does not exist. Provenance is implicit.

**Why rejected:** The bundle is self-contained and offline-capable. A hosted wiki is a second piece of infrastructure that can go down, go stale, or be sunsetted when ruv moves on.

### Alt 3 — Dump the raw repo into an LLM context window on demand

**What it costs:** No persistent KB; re-embedding on every query is expensive and slow. Large repos exceed context limits. No orientation arc for humans. No proof-point. A newcomer loading a repo cold still has no "what is this?" layer.

**Why rejected:** Cannot scale to 6+ repos. Does not serve the human audience at all. Does not produce a durable, queryable artifact.

### Alt 4 — Video-only or slides-only explainer

**What it costs:** Loses the AI half entirely. A video alone is not queryable. Slides alone lack narrative. Neither produces a proof-point artifact or serves agents.

**Why rejected:** Single-medium artifacts serve one audience and one moment. The dual-half is specifically valuable because it simultaneously teaches (human half) and enables (AI half).

### Alt 5 — Single-audience (human-only OR AI-only)

**What it costs:** Human-only: agents still have no KB; proof-point function is lost. AI-only: newcomers still have no orientation arc; the tool remains esoteric.

**Why rejected:** The problem being solved is the esoteric-tool gap — that gap has two sides. Serving only one side halves the value and leaves the other side unsolved.

### Alt 6 — Static one-time snapshot vs evergreen auto-refresh

**What it costs:** A one-time snapshot goes stale. A stale primer actively misleads: it describes a version that no longer exists, teaches APIs that changed, omits new capabilities. The trust cost of a wrong primer is higher than no primer.

**Why rejected:** Evergreen automation is not optional. The comprehension arc must always describe the current tool.

### Alt 7 — One giant combined KB across all repos vs one-primer-per-repo

**What it costs:** A combined KB blurs tool boundaries. A query about ruvector returns results about RuView. The newcomer cannot tell which tool to reach for. More concretely: RuView already accidentally indexed ruvector internals (via `vendor/`) and produced a broken, bloated KB.

**Why rejected:** Tight scope boundaries are a forcing function for correctness. One primer per repo means each KB can be evaluated independently, the comprehension arc is coherent, and a failure in one rebuild does not corrupt all the others.

---

## Consequences

### Positive

- A newcomer who has never seen the repo can, after the human half, pass the comprehension arc test.
- An agent loaded with the AI half has a queryable, dense, correct KB of the tool's own code and docs, and can start using it on a real task.
- The bundle is simultaneously the explainer and the proof-point: showing it to a skeptic proves the tool is real and usable, not vaporware.
- The evergreen loop means the primer always describes the current version of the tool.
- Parameterized config + shared scripts means the sixth repo costs a fraction of the first.

### Negative

- NotebookLM authoring is **partially automatable** — *corrected by [ADR-0002 D4]*. The authenticated `nlm` CLI scripts audio overviews, reports, quizzes, sources, notebooks, and pipelines; only video-overview / slide-deck generation may still need the NotebookLM UI (then `nlm download`). The manual residue is an acknowledged, shrinking cost — not a hard ceiling.
- ~~The big (768-dim) RVF variant requires a manual `workflow_dispatch` per rebuild.~~ **Superseded (v1.3.1):** new repos ship a single 384-dim `bge-small-en-v1.5` variant (D2/F); there is no manual big-variant step. A conditional step-up to 768 `bge-base` applies only if a specific repo can't clear Gate A at 384.
- The bundle download is ≈138 MB (measured, RuView build, June 2026), which is non-trivial on slow connections. This is a distribution characteristic, not a defect.

### Risks

- **NotebookLM availability:** if Google sunsets or changes Studio output access/format, the human half authoring step breaks. Mitigation: the outputs are pulled once and stored; a format change only affects new authoring runs.
- **`@ruvector/rvf` API stability:** if `close()` semantics change, the persist path breaks. Mitigation: pin the rvf version in the generalized repo; upgrade intentionally.
- **CI minute budget:** the daily change-based rebuild (single 384-dim variant) plus submodule bump uses CI minutes. On GitHub's free tier this is material for 6+ repos. Mitigation: stagger cron schedules; move to a paid or self-hosted runner if budget exhausts.
- **Scope creep in the KB:** future contributors may widen exclude patterns incorrectly (e.g., accidentally including `vendor/` again). Mitigation: the guard's chunk-count floor catches catastrophic over-ingestion; add an upper-bound check as well.

---

## Operating Constraints (Binding)

These are not recommendations. Each was learned from a real failure in the two-repo prototype. Treat any design that violates them as broken until proven otherwise.

**A — Scope boundary (most critical):** Index ONLY the target repo's own authored tree. At build time, read `.gitmodules` and exclude every nested submodule path. Keep authored crates. Never recurse into `vendor/` or equivalent. Two independent failure modes if violated: (a) **Technical:** RuView's vendor tree contained the full ruvector engine; recursive indexing produced 44,083 chunks / 4,135 segments (before fix: 6,772 chunks / 637 segments after), overwhelmed `RvfDatabase.close()` on a 2-core runner, manifested as `ManifestNotFound`. (b) **Comprehension:** a RuView primer that teaches ruvector internals fails the comprehension arc — wrong tool, wrong audience. Both failures are caused by the same boundary violation. (Figures measured, RuView build, June 2026.)

**B — Evergreen triggering (change-based):** The daily cron is a **poll**, not a blind dispatch. It dispatches a rebuild ONLY when the upstream submodule SHA changed (`git diff --quiet`). A `GITHUB_TOKEN` push does NOT trigger `on: push` workflows — GitHub's anti-recursion guard — so dispatch must be via explicit `gh workflow run`. The dispatching workflow must have `actions: write` in its token permissions. (Silent failure: the auto-update looked wired and never fired for days — the SHA-check was missing AND the push-trigger was relied on without knowing about the anti-recursion guard.)

**C — Concurrency on CI commit steps:** Any CI step that commits back must `git pull --rebase --autostash` before push, with retry ×3. (A concurrent commit mid-build rejects the push; without the retry the rebuild completes but never publishes.)

**D — Fail-safe ordering:** Build and guard run before publish. A broken rebuild must never clobber the live, correct download. Guard red = stop; do not proceed.

**E — Prove-it, never assert:** Verify against the real artifact in use. Open the actual `.rvf`, hit the real Release URL, check the live page provenance timestamp. False-confidence claims ("it's working", "you're all set") without running real commands are explicitly unacceptable. If not verified, say so.

**F — Single desktop variant, 384-dim (revised v1.3.1):** Ship ONE RVF per repo — **384-dim `Xenova/bge-small-en-v1.5`** (one embed pass, one file: lightest + fastest). Per the Ruflo embedding assessment, dimension barely matters at 2k–8k passages — model quality + structure-aware chunking are the real levers, and `bge-small` is a strong retrieval model (#1 passed Gate A 99.9 on a 384 model). Step a specific repo up to 768 `bge-base` ONLY if it genuinely can't clear Gate A at 384. [D2]

**G — Simplicity for the human half:** Slides ship as native PDF — no OCR, no conversion pipeline. Keep the human on-ramp low-friction. Every added step is a step that fails silently for the sixth repo.

**H — Distribution split:** Bundles on GitHub Release (permanent URL, `--clobber` tag). Loose individual `.rvf` files committed to git as source of truth. The page downloads from the Release. Binaries never go in git.

---

## Generalization Plan

The generalized repo (separate from this primer) implements the following:

1. **One config file per target repo** (TOML/JSON) specifying: submodule path, NotebookLM notebook ID, embed models, scope exclusion patterns.
2. **Shared GitHub Actions workflows:** `daily-bump.yml` (submodule bump → dispatch), `rebuild-kb.yml` (build + guard + bundle + publish). No routine big-variant workflow — the conditional 768 `bge-base` step-up is triggered only for repos that fail Gate A at 384, not a standing workflow.
3. **Shared Node scripts:** `build-kb.mjs` (RVF force-walk, multi-axis, delta layer), `guard-kb.mjs` (anti-truncation + parity + live query), `make-bundles.mjs` (zip both halves, dedup media).
4. **NotebookLM authoring playbook:** a documented human-authored step (not automatable) covering: notebook creation, source upload, Studio output generation, pull via `nlm` CLI (CDP re-auth from running Chrome).
5. **Surfacing page:** one static page per repo (or a single page listing all repos) fetching `/kb/.last-built.json` for live provenance.

The first three target repos for the generalized run (order TBD): ruvector, RuView (already done — port config), plus ~4 additional ruv repos selected by ruv or Stuart.

---

## Validation / Proof Points

The following were verified against real artifacts before this ADR was accepted:

- Live page: <https://cognitum-sensor-primer.vercel.app> — visual two-halves layout, live provenance, off-page links.
- Download: GitHub Release `kb-latest` ships a zip with `for-humans/` and `for-ai/` halves for both RuView and ruvector.
- RVF build: **the prototype (RuView + ruvector) was built with the OLD dual-variant approach** — a 384-dim `all-MiniLM-L6-v2` (auto) and a 768-dim `bge-base-en-v1.5` (manual, carried-forward with originating SHA in manifest). Both prototype variants were built, closed, and queried successfully. **This dual approach is superseded.** The current design — single 384-dim `bge-small-en-v1.5` — is NOT yet implemented; no generalized build script exists.
- Guard: anti-truncation and live-query checks run in CI before publish; a failed build did NOT clobber the live Release (observed in the ManifestNotFound incident).
- Evergreen: change-based cron fires daily, checks whether upstream SHA moved, commits the bump and dispatches rebuild only when changed. Confirmed by provenance timestamp on live page updating when the upstream repo changes.
- The ManifestNotFound failure was reproduced, root-caused (vendor/ over-ingestion → 44,083 chunks / 4,135 segments → `close()` OOM on 2-core runner — measured, RuView build June 2026), and fixed (exclude nested submodules at build time → 6,772 chunks / 637 segments). Fix is verified in current CI.

What was NOT tested: the 768-dim rebuild on a fresh runner with no npm cache (prototype build, warm cache only — and the 768-dim step is now the conditional fallback, not the default). The single-384-dim `bge-small` generalized build, delta layer, full ≥5-strategy force-walk, and comprehension-arc coverage guard are designed but not yet implemented — see Follow-ups.

---

## Follow-ups

| # | Item | Owner | Priority |
|---|------|-------|----------|
| 1 | Implement delta layer (D5) — explicit "what's new" surface per version | Stuart | High |
| 2 | Add upper-bound chunk-count check to guard (catches accidental over-ingestion re-adds) | Stuart | High |
| 3 | Add comprehension-arc coverage check to guard — verify all 7 stages are covered, not just non-empty results | Stuart | High |
| 4 | Extend force-walk to ≥5 strategies: add API/exports, examples, changelog passes (D5 target state) | Stuart | High |
| 5 | Parameterize generalized repo for ruvector config (port from prototype) | Stuart | High |
| 6 | Select + prioritize ~4 additional ruv repos for generalized run | ruv/Stuart | Medium |
| 7 | Rename "Repo-Primer Pipeline" to a canonical name once agreed | Stuart | Low |
| 8 | Stress-test the conditional 768 `bge-base` step-up build on a cold runner (no npm cache; step-up path only — routine builds are single-384) | Stuart | Medium |
| 9 | Document NotebookLM authoring playbook (not automatable; must be written down) | Stuart | Medium |
| 10 | Evaluate CI minute budget for 6+ repos on daily cadence; plan for paid/self-hosted runner if needed | Stuart | Medium |

---

# Part II — Explainer Website & Self-Evaluating Quality Gate

> *Added 2026-06-19 (briefly drafted as ADR-0002, then merged here so there is exactly one ADR ⇄ one DDD). Part I is the engine; Part II is the experience + the proof-of-quality. Both are binding. Applies to ruv's **brand-new** repos only — established concepts live in a separate explainer.*
>
> **Changelog — v1.4.0 (2026-06-19):** **AI-comprehension is now the primary acceptance test, plus the structured for-ai contract, the coverage gate, and the every-build RVF lifecycle rule.** Folds in every enhancement proven this session (ruqu 60.7→98, photonlayer 89→97.3/95, ruvn 98/95). **NEW: (1) D26 / constraint CC / INV-25 — AI-Comprehension Gate:** grade from the AI's seat — an AI querying ONLY the drop-in scores 8 dimensions (onboarding, what-is, architecture, capabilities, usage, best-practices/gotchas, deep-dive over 3 RANDOM buried files, extensibility); composite = the **weakest dimension, MUST be ≥95**; validated by a cross-judge spot-check + a discrimination control (empty context must score low). Script `kb/grade-ai-comprehension.mjs` + `kb/questions/<repo>.aiq.jsonl`. **(2) D27 / constraint EE / INV-26 — RVF STORED/USED/TESTED/VERIFIED every build:** no build is done until all four pass with journal evidence — *"None of these steps are done until each is tested and verified."* **(3) D28 / constraint FF / INV-27 — Gate B Source-Coverage, runs BEFORE Gate A:** `indexed/authored ≥0.92` (fail <0.85), ≥3 passages/component, 20 random files retrievable, passage/source ratio ≥4.0, public-API symbols present; `kb/coverage-gate.mjs`. **(4) D29 — primer template expanded 7→9 sections** (add §8 Extensibility + §9 Performance/memory/gotchas, grounded in real source). **UPDATED: D13 / constraint DD / INV-28 — enriched `for-ai/` contract** (ships `<repo>-symbols.json` + `<repo>-dep-graph.json` + `<repo>-entrypoints.json` + embed.json sidecar + `source_type`-tagged passages; MCP exposes `lookup_symbol`/`get_entrypoints`/`get_dep_graph`; guard asserts before zipping). **D5 — `source_type` tagging (src|test|example|doc|config) + mandatory tests/examples inclusion.** **D15 — expanded to a 7-gate gate** referencing the Coverage gate + the AI-comprehension gate, with test order coverage→answer-quality→AI-comprehension. **DoD checklist + paired DDD (INV-25/26/27/28 + terms + §5/§6)** updated. Paired DDD bumped to v1.4.0.
>
> **Changelog — v1.3.1 (2026-06-19):** **Embedding dimension finalized at 384.** After the Ruflo assessment (dimension barely matters at 2k–8k passages; model quality + structure-aware chunking are the real levers; `bge-small` is a strong retrieval model; #1 passed Gate A 99.9 on a 384 model), Stuart's final call is the lighter **384-dim `Xenova/bge-small-en-v1.5`** as the single variant (was 768 `bge-base` in v1.3.0). Revised D2, constraint F, DDD INV-05 + terms. 768 `bge-base` remains the documented step-up if a specific repo genuinely can't clear Gate A at 384. File name `<repo>-kb.rvf` unchanged (model-agnostic).
>
> **Changelog — v1.3.0 (2026-06-19):** **Single desktop-optimized embedding variant.** Dropped the dual-variant (384 "small" + 768 "big") design for new repos and standardized on **ONE 768-dim `bge-base-en-v1.5`** RVF per repo. Rationale: the 384-dim small variant existed only for **Cognitum-1 Seed** edge hardware; these brand-new repos run on **desktops**, so the small variant is dead weight (second embed pass, second file, parity-guard complexity) for zero desktop benefit. One embed pass, one file — lighter, faster, simpler to drop in. 768 chosen over 1024 (`bge-large`): ~3× cost for marginal gain on small corpora. Revised **D2**, constraint **F**, guard parity in **D6**; DDD **INV-05** + variant terms. (Also resolves the recipe-auditor's flagged D2 manual-step tension — no manual big-variant step remains.) Edge exception: re-add a 384 variant only for a repo that must run on the Seed.
>
> **Changelog — v1.2.0 (2026-06-19):** Scale-phase additions, learned while completing #1 (MetaHarness, live as `metaharness-explainer.vercel.app`) and starting the parallel fan-out (repos 2–5). **(1) Intelligent deployment naming** — corrected **D17**: each site's GitHub repo == Vercel subdomain, function-clear, with an `-explainer` suffix (e.g. `metaharness-explainer`, `photonlayer-explainer`) — NOT the old `ruv-explainer-<repo>` scheme (superseded; the proven #1 already shipped this way); the suffix also signals a third-party explainer and reduces brand-impersonation false-positives (the Malwarebytes phishing flag #1 hit). New constraint **X**. **(2) Capacity-aware parallel-swarm orchestration** — once #1 is proven, repos 2–5 run in PARALLEL, one swarm per repo, with the orchestrator monitoring CPU + memory and adapting concurrency (5 default; up to 10 if CPU<50%; down to 3 if CPU>75%; gate on the memory compressor/swap, not "unused"). Build agents must be **action-first** (execute with tools immediately, not just plan — a fan-out launch once no-op'd at 0 tool-calls when prompts read as "plan"). New **D23**, constraint **Y**, DDD **INV-21**. **(3) Repo-name ↔ shipped-brand reconciliation** — the explainer must explicitly reconcile the GitHub repo name with the tool's shipped CLI/brand name when they differ (e.g. repo `agent-harness-generator` ships as `metaharness`/`create-agent-harness`); a newcomer browsing ruv's repos can't otherwise tell they're the same tool. New **D24**, constraint **Z**, DDD **INV-22**. Paired DDD bumped to v1.2.0.
>
> **Changelog — v1.1.1 (2026-06-19):** Added the **image-first ordering** rule — every section, use-case, and process must START with its image/visual FIRST, then the words (more approachable; a section that opens with text before its visual is a defect). Encoded inside **D22** (section-layout bullet), as new constraint **W**, and as a Definition-of-Done checklist item. Paired with DDD **INV-19** + the `ImageFirstOrdering` term. No prior decision changed; surgical addition only.

## Context (Part II)

Two reframes since Part I, now binding:
1. **The explainer website is a co-equal HERO artifact** — not a NotebookLM by-product. Ruv ships brilliant but dense, deeply technical READMEs that don't meet newcomers where they live. The website's job: bridge that gap for a **non-technical person who already uses Claude Code**, so they grasp *what the tool is* and *what to do with it*, then copy the KB to their machine and use it immediately.
2. **"Done" means "proven good," not "files exist."** On the prototype, RVFs shipped un-graded → 4–5 regeneration cycles. Banned by process: the build must **evaluate its own output** (KB and site) and only declare done when it passes, with evidence.

Two hero artifacts per repo: **(1) ExplainerSite**, **(2) Drop-in Smart Zip** (the KB bundle). Cadence: build ONE, evaluate against this Part II until it genuinely passes, get owner sign-off — then scale to the top-5 of the new-repo batch. First target: `agent-harness-generator` (MetaHarness).

## Decisions (Part II)

**D11 — Two hero artifacts, both gated.** Every primer ships an ExplainerSite AND a Drop-in Smart Zip; neither optional; both must pass the Quality Gate (D15).

**D12 — ExplainerSite design contract.** Built for one persona — the **NonTechnicalClaudeCodeUser**. Must:
- **Open with a captivating HERO visual** — see **D21**. A text-only hero is a defect.
- Answer the **seven questions, in order**, each as its own section: (1) Why was it built? (2) What problem does it solve? (3) Why is that a problem *now*? (4) How does it solve it? (5) What does a *solved state* look like? (6) How would you implement it? (7) How do you start?
- Carry **dual-level visuals in EVERY section** — see **D22**. A text-only section is a defect ("a glorified pretty README," the exact failure we exist to prevent).
- Ship a **Use-Case Gallery of ≥5 *full* concrete scenarios**, and **each scenario MUST be shown VISUALLY** (a problem → command → what-it-looks-like → result diagram) — *examples rendered as dense prose are a defect ("garbage"), not coverage.* The lead example must be **relatable to a non-technical person** (a named, ordinary persona with a real before→after), not an engineer-only abstraction. The gallery is a **series of collapsible items — each opens to its OWN visual + concept + what-it-does.** **Sequence the education deliberately** per **D20/constraint R**: one concrete grounding example that makes the reader *"oh, that's what it's for"* → the collapsible gallery of varied real-world uses → *then* how to implement. **Understanding before implementation** — never implementation steps before the reader even grasps why they'd want it.
- Be **collapsible**: numbered sections (orienting open, deep collapsed), so the page orients fast yet rewards depth.
- **On-page provenance & attribution (Cognitum pattern, mandatory):** credit the original author (e.g. **Reuven Cohen / @ruvnet**), link to the **source repo**, and show a **live provenance line** — last-updated date + the source repo's latest version + HEAD sha — so a visitor can tell whether it's current. (Modeled on cognitum-sensor-primer; omitting it is a defect — see constraint Q.)
- **Differentiate from what the visitor already has** — see **D20** (final bullet): answer "I already use Claude Code / a big harness like Ruflo — why this too?" head-on, with a before→after-on-your-own-codebase comparison.
- Have a **distinct aesthetic per repo** (cloning a prior site = defect — see constraint K).
- Surface the **Smart Zip** with exact drop-in steps (unzip → `.mcp.json` → `CLAUDE.md` gate) + a confirm-it-works query — see **D13**.
- State **honest limits**; **end in action** (usable in Claude Code/Codex immediately).

**D13 — Drop-in Smart Zip contract (enriched for-ai/ — expanded v1.4.0).** One `kb/` folder, two halves: **`for-ai/`** (the single `<repo>-kb.rvf` 384-dim + its **`<repo>-kb.rvf.embed.json` sidecar — REQUIRED so `ask-kb` embeds queries with `bge-small`, not the MiniLM default; without it the drop-in mismatches the store (dry-run distance ~1.63 vs ~0.32) and silently returns wrong answers** + `<repo>-kb.passages.jsonl` + ids/idmap + `ask-kb.mjs` + `kb-mcp-server.mjs` + `kb.config.mjs` + `package.json`) and **`for-humans/`** (`<repo>-primer.md` **AND a `studio/` folder containing the NotebookLM studio media — the audio overview + the report (+ the optimized prompt)**), plus README + manifest. Self-contained, runnable.

**The `for-ai/` half MUST also ship structured machine artifacts (binding — added v1.4.0):** semantic retrieval alone is not enough for an AI to *use* a repo — it needs exact, lookup-able structure. So `for-ai/` additionally ships:
- **`<repo>-symbols.json`** — exact symbol → signature → file:line for the repo's public API (struct fields + impl methods expanded; rustdoc-json per crate with a ripgrep fallback; npm export scan). Lets an agent answer "what's the exact signature of `X`?" deterministically, not by guessing from a passage.
- **`<repo>-dep-graph.json`** — the internal module/crate/package dependency graph (cargo metadata + npm import scan).
- **`<repo>-entrypoints.json`** — how to build / test / run / install the repo (commands + bin targets, from `Cargo.toml`/`package.json`/README).
- the **`<repo>-kb.rvf.embed.json` sidecar** (above) and **`source_type`-tagged passages** (D5).

And the **`kb-mcp-server.mjs` MUST expose three structured lookup tools** alongside semantic search: **`lookup_symbol`** (→ symbols.json), **`get_entrypoints`** (→ entrypoints.json), **`get_dep_graph`** (→ dep-graph.json); `ask-kb.mjs` gains the matching **`--symbol` / `--entrypoints` / `--deps`** flags. A **guard asserts all of these structured files exist (and parse) before zipping** — a `for-ai/` half missing symbols/dep-graph/entrypoints, or an MCP server missing the three lookup tools, is a defect. Generated by `kb/extract-symbols.mjs`, `kb/dep-graph.mjs`, `kb/entrypoints.mjs`. See constraint **DD** + INV-28.

**STUDIO MUST BE IN THE ZIP (added v1.3.1 — was being dropped).** The NotebookLM audio overview + report are *helpful tools a downloader will otherwise never find*. They ship **inside** the downloadable zip's `for-humans/studio/` — not only on the site. A zip whose `for-humans/` half is just the primer (studio left out) is a **defect**. (Concretely: #1 shipped with a 3 MB zip containing only the primer while its 32 MB audio + report sat unreferenced on the site — exactly the miss this rule prevents.)

**The Drop-in section's visual must SHOW what is actually inside the zip** — an annotated *file-tree* of each half (every file + a plain-English "what this is"), modeled on the Cognitum "one download, two halves" contents diagram — NOT an abstract/pretty two-halves picture, **and it must explicitly LIST AND HIGHLIGHT the `studio/` media** (e.g. "🎧 audio overview — play this first", "📄 report") so a downloader cannot miss them. The README's 3-step setup points the human at the studio files first. A visual that doesn't reveal the real contents, or that hides/omits the studio media, is a defect.

**D14 — NotebookLM is FULLY scriptable (corrects Part I + the earlier "UI-only" caveat — verified 2026-06-19).** The authenticated `nlm` CLI creates the **entire** studio set headlessly: `audio`, `report`, **`video`** (`--format explainer|brief|cinematic`), **`slides`** (`--format detailed_deck|presenter_slides` = the "PowerPoint"), **`infographic`** (`--style professional|editorial|…` = NotebookLM images), `mindmap`, `quiz`, `flashcards` — and **`nlm share public <notebook>`** makes a notebook publicly linkable; **`nlm download`** pulls artifacts. There is **no** UI-only step (the old caveat caused the first fan-out to skip video/slides — a real miss). Studio media is layered after the site + zip pass (never blocks them), but the *full* set is now required (D18).

**D15 — The Self-Evaluating Quality Gate (the heart) — expanded v1.4.0 to a 7-gate gate.** Before "done," the build runs and PASSES, recording evidence in the manifest. **Test ORDER matters: source-coverage (Gate B) → answer-quality (Gate A) → AI-comprehension — coverage first, because Gate A is meaningless if the deep code isn't even indexed** (a KB can answer its tuned questions perfectly while 30% of the source is missing). The gates:
- **(Coverage / Gate B — runs FIRST; added v1.4.0)** — source-coverage assertion (see **D27**): `indexed_source_files / authored_non_excluded_source_files ≥ 0.92` (hard fail < 0.85, any repo); ≥3 passages per crate/package/component; 20 random source files each retrievable via `ask-kb`; passage / source-file ratio ≥ 4.0; public-API symbols present. Below bar → fix the walk (missing pass, over-aggressive exclude, truncation) → re-index → re-cover. **Gate A does not run until Gate B is green.** Script: `kb/coverage-gate.mjs`.
- **(A) KB answer-quality grading** — query the real `.rvf` (the single 384-dim variant) with a fixed question set **plus a held-out set**; grade on a dual metric (retrieval relevance + answer correctness/completeness vs source). Below threshold → diagnose (truncation / scope bleed / embedding mismatch / missing pass) → rebuild → re-grade. *Never ship an un-graded KB.*
- **(AI-Comprehension Gate — the PRIMARY acceptance test; added v1.4.0)** — graded from the AI's seat (see **D26**): an AI querying ONLY the drop-in scores **8 dimensions** (onboarding, what-it-is, architecture/elements, capabilities, usage/how-to, best-practices/gotchas, deep-dive over 3 RANDOM buried files, extensibility); composite = the **weakest dimension**, which MUST be **≥95**. Validated with a **cross-judge spot-check** + a **discrimination control** (a deliberately-vague/empty context must score low). Loop: enrich → grade → diagnose weakest dim → improve → re-grade until ≥95. Script: `kb/grade-ai-comprehension.mjs` + `kb/questions/<repo>.aiq.jsonl`.
- **(B) Site comprehension *and desire* audit** — an independent reviewer **actually renders the site and walks it as a real visitor** (via a browser, not by reading source), role-played as the NonTechnicalClaudeCodeUser. They must (i) state what it is, name 3 concrete uses, recite the exact first command, confirm every hard concept has a visual; **and (ii) answer three FELT questions honestly: "Does this impress me? Does it invite me in? Does it make me want to work with this tool?"** A "no" on any felt question is a **FAIL**, not a nitpick. Scores clarity/compelling/ease (1–5). Below bar or any felt-"no" → **enhance the site → re-audit**, looping until all three felt questions are "yes." **The reviewer must ALSO be able to answer, in plain words after reading: "What does it actually DO? Why do I care? Why do I need it?" — if they still can't, that is a FAIL (the explanation is too abstract/ethereal) [D20].**
- **(C) Consistency & completeness** — claims grounded in source (no invented APIs); all 7 stages present; ≥5 full use cases; links resolve; drop-in dry-run (load `.mcp.json`, run a real query, get a grounded answer).
- **(D) NotebookLM studio-output quality grading** — every studio artifact produced for the human half (audio overview; report; and video/slides/infographics where the tooling/UI allows) is graded by **reading/transcribing the actual output** (never assuming it ran) for: clarity, understanding, intention, education, comfort, confidence, completeness, and effectiveness. Below bar → **refine the optimized studio-creation prompt** → regenerate → re-grade. (See D18.)
- **(E) Visual-asset quality grading** — every generated image/graphic is graded with a **vision check** for: **clarity, communicative effectiveness, friendliness, and approachability** — never decorative-only, never cold tech-speak. Below bar → refine → regenerate → re-grade; prompts saved per repo. **Visuals MUST span two tiers:** **(1)** a friendly raster *on-ramp* (approachable first impression — the metaphor that makes a newcomer comfortable), AND **(2)** accurate, labeled **ARCHITECTURAL / explanatory diagrams — authored as crisp SVG, not AI raster** — that reveal the real mechanics under the covers: *what is actually happening, why it matters, and what it does for you.* Tier 2 must be **true to the source** (no invented architecture) and is graded not just for clarity but for **belief/conviction** — does a technical-but-new viewer come away trusting *how it works*? **A site that is friendly-but-not-explanatory FAILS (E):** it meets the newcomer at the surface but never earns their trust. (See D19.)
- **Scoring:** each primer is graded **0–100** across the five gates. **≥98 is the standard bar** to be "done" and move to the next repo. **Under genuine time pressure ≥95 is an acceptable pass**; ≥98 remains the target to restore when time allows. Scoring is honest (global Rule 9): report the *real* score and list every deduction with evidence — never inflate to clear the bar. A loop may apply **multiple fixes at once** (don't single-step). The relaxation applies to every gate A–E; it never excuses a hard defect (a missing hero visual, a text-only section, an un-graded KB, an invented API). **Grading mechanics (so the gate is mechanically decidable):** the **Coverage gate (B)** is scored numerically by `kb/coverage-gate.mjs` (deterministic; ratio ≥0.92, fail <0.85) and runs FIRST; gate (A) is scored numerically by `kb/grade-kb.mjs` + `kb/gate.mjs` on the tuned + held-out sets (deterministic; ≥95 on BOTH); the **AI-comprehension gate** is scored numerically by `kb/grade-ai-comprehension.mjs` (a real LLM judge over the drop-in's output; weakest-of-8 ≥95, cross-judge + discrimination-control validated — D26); the site/studio/visual gates (renamed for the website experience) are scored by a reviewer agent that **renders/transcribes the real artifact** and rates it against this section's rubric; the consistency gate is pass/fail (claims grounded + links resolve + drop-in dry-run returns a grounded answer). **Each gate must independently clear its bar; the headline 0–100 is the *lowest* gate — a primer is only as done as its weakest gate.** Each gate's score + evidence is written to the repo's build journal (D25).
- **Done = Coverage (B) ≥0.92 + KB answer-quality (A) ≥95 on tuned+held-out + AI-comprehension weakest-of-8 ≥95 (cross-judge + discrimination control) + site/consistency/studio/visual gates green + score ≥98 (≥95 under time pressure) + evidence shown.** Extends Part I's "PROVE, don't assert" from *existence* to *quality*. **None of these steps are done until each is tested and verified** (see D27/RVF lifecycle).

**D16 — Scope & cadence.** Brand-new repos only; **one at a time**; nail #1 (≥98 standard, ≥95 acceptable under time pressure — D15) + owner sign-off before scaling; top-5 of the new batch; #1 = `agent-harness-generator`. **This ADR + the DDD are the COMPLETE, run-once RECIPE:** once #1 passes all gates (A–E) and is signed off, repos 2–5 **replay the identical pipeline** — only the per-repo config, the canonical content, and the aesthetic theme change. **#1 (`agent-harness-generator` → `metaharness-explainer`) is DONE and signed off — the proving run is complete; repos 2–5 now run in PARALLEL (one capacity-aware swarm per repo — see D23), no longer one-at-a-time.** Nothing about the *process* should need re-deciding; if it does, fix the recipe here first.

**D17 — Deployment (intelligent, function-clear naming).** Each primer gets **its own dedicated public GitHub repo** and **its own Vercel site**, named so it is **immediately clear what the tool does** — *not* the opaque raw repo name and *not* a generic `ruv-explainer-<repo>` prefix (superseded). **Convention: GitHub repo name == Vercel subdomain, function-clear, with an `-explainer` suffix** (proven on #1: repo `stuinfla/metaharness-explainer` + `metaharness-explainer.vercel.app`; fan-out: `photonlayer-explainer`, `ruqu-explainer`, `ruvn-explainer`). The `-explainer` suffix also signals a **third-party explainer**, which reduces brand-impersonation false-positives (e.g. the Malwarebytes phishing flag #1 hit on a brand-named free-host domain). Each deploy must be **public** (disable Vercel Deployment Protection / `ssoProtection` so visitors aren't blocked) and **PROVE-IT verified** — `curl -sI` returns HTTP 200 on the real domain. **Verify the actual served artifact, not just the page:** `curl -sI` the **download URL** and confirm its `content-length` matches the new zip (a stale alias/CDN can serve the OLD file at HTTP 200 — "200" alone is not proof the fix shipped). **Alias gotcha (learned on #1):** `vercel --prod` deploys but does NOT automatically re-point a *custom* alias — if a site uses a named alias different from the project's default domain, move it explicitly (`vercel alias set <deployment> <alias>`). See constraint **X**.

**D18 — NotebookLM studio buildout per repo (optimized prompts + graded outcomes).** Every repo gets **its own NotebookLM notebook**: create it, load its sources (the auto-drafted comprehension-arc doc + key repo docs via `nlm source add`), then build the **FULL studio set, all CLI-scriptable** (D14): **audio overview** (`nlm audio create`), **report**, **video overview** (`nlm video create`), **slide deck / "PowerPoint"** (`nlm slides create`), and **infographic(s)** (`nlm infographic create`). Then **make the notebook PUBLIC** (`nlm share public`) and **surface its public link prominently** — a "Studio" section on the explainer site AND a link on the Ruv-Explainer README/overview — as a one-click gateway to all the explainer media (audio, video, slides, infographics). For **each** artifact:
- **Construct an OPTIMIZED studio-creation prompt** — explicitly tuned for *clarity, understanding, intention, education, comfort, and confidence* for the NonTechnicalClaudeCodeUser. Generic prompts are a defect.
- **Verify the produced outcome** (gate D): read the report / transcribe the audio+video and grade it for completeness and effectiveness — does it actually teach a true beginner? If not, refine the prompt and regenerate.
The optimized prompts are saved per repo (so they're reusable and auditable). Studio media remains layered after the two heroes pass (A)+(B)+(C), but it now carries its own bar (D) — it is not "ship and forget."

**D19 — Approachability & visual grading (text *and* imagery).** The whole primer — copy AND images — must read **friendly and approachable to a non-technical person**, never as a jargon wall or "super tech-speak." Concretely: (a) **plain-language voice** — lead with the human problem, not the architecture; define any necessary term in-line; (b) **every generated graphic** is produced by an OPTIMIZED image-generation prompt and graded by gate (E) — a vision check that it is clear, communicative, friendly, and approachable, and matches its concept/caption; weak → refine prompt → regenerate → re-grade; (c) **text and imagery are judged together** for one consistent warm, confident tone. Decorative-but-uninformative images, or correct-but-cold tech-speak, are defects.

**D20 — Resonant comprehension: make a non-technical person GET it and CARE.** The single biggest failure mode is describing the tool in an *ethereal, abstract* way ("a factory for agent frameworks") so the reader nods but never grasps what it DOES or why they'd want it. This is forbidden. Every primer must, early and in plain, visceral language:
- **Translate the abstraction down to earth.** "Meta"/abstract tools especially must be re-stated in concrete everyday terms a non-technical person *feels* — what it literally does for *you*.
- **Answer the stakes explicitly:** *What does it actually do? Why do I care? Why do I need this? Why is it important?* If a reader can still ask "…but what does it actually do and why would I want it?", the primer **FAILED**.
- **Anchor with ONE concrete, RELATABLE example** — a named, ordinary persona with a real *before → after* (the pain without the tool → the exact thing they run → how their day is better). An abstract or engineer-only scenario does not satisfy this; the example must make a non-technical reader go "oh — *that's* what it's for." *(Worked example for #1 `agent-harness-generator`: **Maya**, who runs a small online shop on her own codebase — see [`content/agent-harness-generator.resonance.md`](../../content/agent-harness-generator.resonance.md), the canonical resonance standard for this primer.)*
The job: carry the reader from non-technical zero → conceptual grasp → architectural understanding → genuine *confidence and "I want this."* A nice-but-ethereal intro that doesn't land is a defect.
- **Differentiate from what they already have.** If the audience plausibly already uses an adjacent tool — the host (Claude Code / Codex) or a big existing harness (e.g. Ruflo) — the page MUST answer head-on: *"I already have X — why do I need this too?"* Name the real difference and why it is **not** "just another thing piled on." Pair it with a **before → after on *your own codebase*** comparison (a side-by-side table or diagram) showing what changes when you run it. Failing to answer "why this on top of what I already have?" is a defect.

**D21 — Captivating HERO visual (a text-only hero is a defect).** The first screen must *grab a newcomer immediately* and make them want to read on. It MUST lead with a **captivating visual** — the friendly tier-1 on-ramp metaphor of **D22** — paired with the one plain-language sentence that says what the tool does (the resonance lead, D20). The hero's single job: in one glance, a non-technical visitor *feels* "this looks interesting and I get the gist," before reading any prose. A hero that is text/headline only — or a generic stock decoration that explains nothing — **fails** and is graded by gate (E) like every other visual. The hero is what separates "I'll keep reading" from "I'll close the tab."

**D22 — DUAL-LEVEL visuals in EVERY section (the advantage over a README).** Every section — and every named *process* (e.g. a multi-stage pipeline like the composer's stages) — carries **two complementary visuals, not one**:
- **(1) A precise TECHNICAL SVG diagram** that explains the concept/architecture accurately and is *true to the source* (no invented architecture) — authored as crisp **SVG, not AI raster**. This is the tier-2 explanatory diagram graded by gate (E) for clarity **and belief/conviction** (does a technical-but-new viewer trust *how it works*?).
- **(2) A simple, approachable illustration** — the friendly tier-1 raster on-ramp: an interesting, compelling metaphor that makes the concept feel inviting and human. Graded by gate (E) for clarity, friendliness, and approachability.

**This dual-level pairing is THE reason the primer beats a plain README:** the README has one register; the primer meets a newcomer with the *approachable* illustration AND earns a technical reader's trust with the *precise* diagram, in the same section. A section with neither, or with only a friendly picture and no explanatory diagram (or vice-versa), is a **defect** — friendly-but-not-explanatory fails (E), and explanatory-but-cold fails constraint O. *(Tiers 1 and 2 are the same two tiers gate (E) enforces; D22 makes "both, in every section" the binding rule.)*

**Image-first ordering (section layout — binding):** every section MUST **start with its image/visual FIRST, then the words.** The visual leads; the prose follows it. This is more approachable — a non-technical newcomer sees the inviting picture before any text. A section that opens with a wall of text *before* its visual is a **defect** (see constraint **W**). This applies to every section, every use-case scenario, and every named *process* (e.g. the composer's 9 stages), on #1 (`agent-harness-generator`) and all fan-out repos 2–5.

**D23 — Capacity-aware parallel-swarm orchestration (the scale phase).** #1 is built one-at-a-time to prove the recipe (constraint L). Once it passes and is signed off, repos 2–5 are built **in parallel — one swarm per repo** — and the orchestrator **actively monitors the Mac's CPU + memory and adapts concurrency to saturate available capacity without thrashing**: default 5 concurrent agents; scale UP toward 10 when CPU < 50%; drop to 3 when CPU > 75%; gate on the **memory compressor/swap**, not the misleading "unused" figure (on macOS most RAM shows as file-cache "used"). Orchestration is registered through Ruflo (`swarm_init` + `agent_spawn`, cost-attributed, visible) and executed by hands-on coding agents (Claude Code Task) — the Ruflo agents track; the coding agents touch files/deploy. **Build agents must be ACTION-FIRST**: their prompt must make them execute with tools immediately, not return a plan — a fan-out launch once no-op'd (0 tool-calls) because the prompt read as "describe" rather than "do." See constraint **Y** + DDD INV-21.

**D24 — Repo-name ↔ shipped-brand reconciliation.** When a repo's GitHub name differs from the tool's shipped CLI/brand name, the explainer MUST reconcile them explicitly and early, so a newcomer browsing ruv's repo list can tell they're the same thing. Canonical example: repo `agent-harness-generator` ships as `metaharness` (`== create-agent-harness`) and is branded **MetaHarness** — the site states this plainly (and the honest-limits section names the alias). Leaving the reader unable to map the repo they found to the brand the docs use is a defect. See constraint **Z**.

**D25 — Per-repo build journal (record the walk).** Each repo's build **records its process as it goes** into `docs/build-journal/<repo>.md`: the config used, KB build + grade (A) evidence, each gate (B/C/D/E) score and any fixes applied, the optimized prompts, and the deploy proof (live URL + HTTP 200). This is the **per-repo path made auditable** — the ADR Definition-of-Done is the checklist; the journal is the filled-in record that proves the checklist was walked for *this* repo. A deployed primer with no journal is incomplete. See constraint **AA** + DDD INV-23.

**D26 — The AI-Comprehension Gate (the PRIMARY acceptance test).** The whole point of the drop-in is to let an AI (Claude Code / Codex) **fully understand and use the repo**. So the binding measure of "done" is graded **from the AI's seat, not a human's**: an AI agent that can query *only the drop-in* (its `ask-kb` retrieval + the shipped primer + the structured `symbols.json`/`dep-graph.json`/`entrypoints.json` + `source_type`-tagged passages) is scored across **8 dimensions**:
1. **onboarding** — can it get started from zero,
2. **what-it-is** — can it state what the tool is,
3. **architecture / elements** — can it name the real components,
4. **capabilities** — can it list what the tool can do,
5. **usage / how-to** — can it produce a correct invocation,
6. **best-practices / gotchas** — does it know the pitfalls,
7. **deep-dive** — can it explain **3 RANDOM buried source files** (seeded, auto-selected — *cannot* be tuned to in advance),
8. **extensibility** — can it find the extension points + stable-API rules.

**Composite = the WEAKEST dimension (weakest-link), which MUST be ≥95.** A real LLM judge (Anthropic Messages API, default `claude-sonnet-4-5`, temp 0) grades each dimension grounded ONLY in the drop-in's output. **Calibration:** the judge is told the AI *has* the full `passages.jsonl` + `symbols.json`, so a *derivable* detail is NOT a gap, and an opaque Rust struct's methods ARE its public API — only deduct for substantive, truly-absent facts. **Two validation controls are mandatory:**
- **(a) Cross-judge spot-check** — re-grade with a second, stricter judge (e.g. Sonnet *and* a stricter Opus judge); the score must hold up under both.
- **(b) Discrimination control** — feed the judge a deliberately-vague / empty context; it MUST score that **low** (0–15/100). If the empty control scores high, the judge is rubber-stamping and the gate is invalid.

**Loop:** enrich → grade → diagnose the weakest dimension → improve that dimension → re-grade, until weakest-of-8 ≥95. **PROVEN this session:** ruqu 60.7 → 98; photonlayer 89 → 97.3 (Sonnet) / 95 (Opus); ruvn 98 (Sonnet) / 95 (Opus). Script: `kb/grade-ai-comprehension.mjs` + per-repo `kb/questions/<repo>.aiq.jsonl`. See constraint **CC** + INV-25.

**D27 — RVF lifecycle: STORED / USED / TESTED / VERIFIED correctly, EVERY build (Stuart's binding rule).** No build is "done" until ALL FOUR pass with evidence in the build journal — run **every time, for every repo**, not once:
- **STORED correctly** — a valid single-file `.rvf` (HNSW) whose `close()` actually persisted; the `<repo>-kb.rvf.embed.json` sidecar is present AND matches the embedding model (so `ask-kb` uses `bge-small`, not a silent MiniLM fallback); passage ↔ id parity holds; no truncation (the anti-truncation chunk-count floor is met).
- **USED correctly** — `ask-kb` AND the MCP server actually retrieve from the **SHIPPED** `.rvf` (embedding dims match; the `--symbol`/`--entrypoints`/`--deps` flags and the `lookup_symbol`/`get_entrypoints`/`get_dep_graph` MCP tools all return correct results from the shipped structured artifacts).
- **TESTED correctly** — **Gate B (coverage) → Gate A (answer-quality) → AI-comprehension gate, in that order** (coverage first — Gate A is meaningless if the deep code isn't even indexed; see D15/D28/D26).
- **VERIFIED correctly** — a drop-in **dry-run from the SHIPPED zip** (unzip → `npm i` → a real query → a grounded answer); the **served zip's md5 == the local md5**; the live URL returns HTTP 200.

**None of these steps are done until each is tested and verified.** This is binding constraint **EE**.

**D28 — Gate B: Source-Coverage gate (runs BEFORE Gate A).** Answer-quality means nothing if the deep source was never indexed, so before grading answers the build asserts the KB actually *covers the source*:
- `indexed_source_files / authored_non_excluded_source_files ≥ 0.92` (**hard fail < 0.85**, any repo);
- **≥3 passages per crate / package / component** (no component silently absent);
- **20 random source files**, each retrievable via `ask-kb`;
- **passage / source-file ratio ≥ 4.0** (catches under-chunking / truncation);
- **public-API symbols present** (cross-checked against `symbols.json` — D13).

Below bar → diagnose (missing walk pass, over-aggressive exclude, truncation) → re-index → re-cover; **Gate A does not run until Gate B is green.** Script: `kb/coverage-gate.mjs`. See constraint **FF** + INV-27.

**D29 — Primer template: 9 sections (expanded v1.4.0 from 7).** The shipped `<repo>-primer.md` (and the comprehension-arc source the studio half is authored from) follows a **9-section** template, every section **grounded in real source** (no invented architecture):
1. **What is this?** — what the tool is, in plain terms.
2. **What can you do with it?** — capabilities.
3. **Why was it built / what problem does it solve?**
4. **Architecture & elements** — the real components.
5. **Usage / how-to** — concrete invocations (drawn from the `example`/`test` passages — D5).
6. **A concrete end-to-end example** — one full before→after.
7. **Other application areas.**
8. **Extensibility (added v1.4.0)** — the real **extension points** + the **stable-API rules** (what's safe to depend on vs. internal). Grounded in `symbols.json` + the public-API walk pass. Feeds the AI-comprehension *extensibility* dimension (D26 #8).
9. **Performance / memory / gotchas (added v1.4.0)** — the real performance characteristics, memory behavior, and known pitfalls, drawn from source + docs. Feeds the AI-comprehension *best-practices/gotchas* dimension (D26 #6).

§§1–7 map to the seven-stage ComprehensionArc (§2 of the DDD); §§8–9 are the new depth the AI-comprehension gate exercises. A primer missing §8 or §9, or whose §8/§9 invent facts not in the source, is a defect.

## Definition of Done — the checklist the build runs on itself
- [ ] **Hero opens with a captivating visual** (D21) — not headline-only, not generic decoration; graded by (E).
- [ ] All 7 questions answered as ordered sections.
- [ ] **Primer is 9 sections** (D29): §§1–7 (the comprehension arc) **plus §8 Extensibility** (extension points + stable-API rules) **and §9 Performance/memory/gotchas**, all grounded in real source (no invented facts).
- [ ] **Every section carries DUAL-LEVEL visuals** (D22): a precise technical SVG diagram **and** a simple approachable illustration. No text-only section.
- [ ] **Image-first ordering** (W/D22): every section, use-case, and process opens with its visual FIRST, then the words. A section that opens with text before its visual is a defect.
- [ ] ≥5 full use-case scenarios, each with its own visual; lead example is a relatable named persona.
- [ ] **Educational sequencing** (R): grounding example → collapsible gallery → then implement. Sections collapse; distinct aesthetic (K).
- [ ] **Resonance** (D20): abstraction translated to plain stakes (what-does-it-do / why-care / why-need / why-important) + one named before→after.
- [ ] **Differentiation** (D20): "why this vs the host / a big harness I already use?" answered, with a before→after-on-your-own-codebase comparison.
- [ ] **Drop-in visual is an annotated file-tree** of the real zip contents (D13), Cognitum-style — not an abstract two-halves picture; it **lists + highlights the `for-humans/studio/` media** (audio overview + report) so downloaders find them. **Studio media is actually IN the zip** (verify `unzip -l`). Smart Zip runnable (`npm i` + a real query → grounded answer).
- [ ] **Source-coverage Gate B passed FIRST** (D28): `indexed/authored ≥ 0.92` (fail <0.85); ≥3 passages/component; 20 random source files retrievable; passage/source ratio ≥4.0; public-API symbols present. **Coverage runs before answer-quality.**
- [ ] KB graded (A) ✓ on tuned + held-out; Site audited ✓ incl. the three FELT questions; Consistent ✓ — evidence recorded.
- [ ] **AI-Comprehension Gate ≥95** (D26): an AI querying ONLY the drop-in scores the 8 dimensions (onboarding/what-is/architecture/capabilities/usage/best-practices/deep-dive-3-RANDOM-buried-files/extensibility); composite = **weakest dimension ≥95**; validated by a **cross-judge spot-check** AND a **discrimination control** (vague/empty context scores low). Loop until weakest ≥95.
- [ ] **RVF STORED/USED/TESTED/VERIFIED — every build** (D27): STORED (valid `.rvf` persisted via `close()`, embed.json sidecar matches the model, parity, no truncation); USED (`ask-kb` + MCP retrieve from the SHIPPED `.rvf`, dims match, `--symbol`/`--entrypoints`/`--deps` + `lookup_symbol`/`get_entrypoints`/`get_dep_graph` work); TESTED (Gate B → Gate A → AI-comprehension, in order); VERIFIED (dry-run from SHIPPED zip; served md5 == local md5; live URL HTTP 200). **None done until each is tested and verified.**
- [ ] **Structured `for-ai/` artifacts shipped** (D13): `<repo>-symbols.json` + `<repo>-dep-graph.json` + `<repo>-entrypoints.json` + embed.json sidecar + `source_type`-tagged passages; MCP exposes `lookup_symbol`/`get_entrypoints`/`get_dep_graph`; the guard asserts they exist + parse before zipping.
- [ ] **FULL** NotebookLM studio per repo (own notebook + sources): **audio + report + video + slide deck + infographic** (all via `nlm`), each from an optimized prompt, outputs graded (D). Notebook made **PUBLIC** (`nlm share public`) and its **public link surfaced** on the site's Studio section AND the README/overview.
- [ ] Every generated image graded (E) ✓ — vision-checked for clarity/effectiveness/friendliness/approachability and that it matches its concept; image prompts optimized & saved.
- [ ] Voice is plain-language & approachable throughout (no jargon walls / tech-speak); text + imagery share one warm, confident tone [O].
- [ ] **Prominent first-screen attribution** (Q): the first screen makes clear this is **Reuven Cohen's (@ruvnet)** tech and an **independent explainer to help implement it**; upstream repo `ruvnet/<repo>` linked AND the **Ruv-Explainer project** (`stuinfla/Ruv-Explainer`) credited + linked; live date + version + sha shown.
- [ ] **Human visual sign-off** (BB): orchestrator screenshotted the live site and looked at it (hero, attribution, every section's formatting + visual, favicon, drop-in); fixed what looked wrong; re-screenshotted to confirm.
- [ ] **Repo↔brand reconciliation** (Z): if the repo name ≠ the shipped CLI/brand name, the site reconciles them explicitly + early.
- [ ] **Intelligent, function-clear deploy name** (X): own public GitHub repo == Vercel subdomain, `-explainer` suffix; deploy is public (no ssoProtection) and PROVE-IT verified (HTTP 200).
- [ ] **Build journal recorded** (AA): `docs/build-journal/<repo>.md` captures config, KB grade-(A) evidence, gate B/C/D/E scores + fixes, and deploy proof for this repo.
- [ ] **Score ≥ 98/100** (≥ 95 acceptable under genuine time pressure; real score + deductions reported honestly).
- [ ] Honest limits shown; secrets gitignored.
- [ ] Owner sign-off on #1 before scaling.

## Operating Constraints (Part II — additive to A–H)
- **I — Done = proven-good.** Never declare a KB/site done without running the gate (D15) and showing evidence. (Exists because un-graded RVFs cost 4–5 regen cycles.)
- **J — Concrete use cases.** ≥5 full scenarios; "anything you like" is a defect.
- **K — Distinct aesthetic per repo.** Reusing a prior look is a defect.
- **L — One-at-a-time until proven.** No batching until #1 passes (≥98 standard; ≥95 acceptable under time pressure) + owner sign-off.
- **M — Audience = non-technical Claude-Code user.** If a true beginner can't understand and use it, the primer failed.
- **N — Studio outputs are optimized & graded, not assumed.** Each repo gets its own NotebookLM notebook and a full, *checked* studio buildout. Generic studio prompts, or shipping studio media without verifying the outcome teaches, are defects.
- **O — Approachable, never tech-speak.** Copy AND imagery must meet a non-technical person where they live — plain language, human-problem-first, terms defined in-line; every graphic *communicates* (graded by E), not decorates. Jargon walls and cold/decorative visuals are defects.
- **P — Resonance over abstraction.** A primer that leaves a non-technical reader still asking "but what does it DO and why do I care?" has failed, however polished. Translate every abstraction into plain stakes + a relatable, named before→after example [D20].
- **Q — Provenance & attribution, PROMINENT on the first screen.** The very first screen must make abundantly clear, in plain sight (not buried in a footer): **this is Reuven Cohen's (@ruvnet) technology, and this is an *independent explainer* built to help people implement his work.** Name Reuven Cohen / @ruvnet up-front; link the **upstream source repo** (`github.com/ruvnet/<repo>`); AND credit + link the **Ruv-Explainer project** (`github.com/stuinfla/Ruv-Explainer`, public) that built it ("built with the Repo-Primer Pipeline"). Also show a live updated-date + version + sha. A site where a newcomer can't immediately tell *whose* tech it is and that this exists to help them adopt it is a defect [D12].
- **R — Educational sequencing.** Order the page as a learning arc: grounding example → collapsible gallery of varied real-world uses (each with its own visual) → how to implement. Never put implementation steps before the reader understands *why they'd want it* [D20].
- **S — Captivating hero.** The first screen leads with a visual that grabs a non-technical newcomer at a glance and makes them want to read on. A text-only or generically-decorated hero is a defect [D21].
- **T — Dual-level visuals everywhere.** Every section pairs a precise technical SVG diagram with a simple approachable illustration. One register only — or a text-only section — is a defect; the dual register is the README-beating advantage [D22].
- **U — Differentiate, don't pile on.** Answer "I already use the host / a big harness — why this too?" with a real difference and a before→after-on-your-own-codebase comparison. Leaving "why on top of what I have?" unanswered is a defect [D20].
- **V — Drop-in shows real contents, studio highlighted.** The Drop-in visual is an annotated file-tree of the actual zip (every file + plain-English "what this is"), not an abstract two-halves picture — and it must explicitly LIST AND HIGHLIGHT the `for-humans/studio/` media (audio overview + report) so a downloader discovers these helpful tools. The studio media must actually BE in the zip (not only on the site). Omitting studio from the zip, or from the file-tree, is a defect [D13].
- **W — Image-first ordering.** Every section, use-case, and process starts with its image/visual FIRST, then the words. The visual leads; the prose follows. A section that opens with text before its visual is a defect [D21/D22].
- **X — Intelligent, function-clear deployment naming.** Each site gets its own public GitHub repo == Vercel subdomain, named so it's clear what the tool does, with an `-explainer` suffix (e.g. `metaharness-explainer`, `photonlayer-explainer`); never the opaque raw repo name alone, never the old `ruv-explainer-<repo>` prefix. Deploy public (disable `ssoProtection`) and verify HTTP 200. The suffix also mitigates brand-impersonation false-positives [D17].
- **Y — Capacity-aware parallel orchestration (scale phase).** After #1 is proven (L), repos 2–5 build in parallel, one swarm per repo, with live CPU+memory monitoring driving adaptive concurrency (5 default; ↑10 if CPU<50%; ↓3 if CPU>75%; gate on compressor/swap, not "unused"). Register via Ruflo (`swarm_init`+`agent_spawn`); execute via action-first coding agents that use tools immediately (never a plan-only no-op) [D23].
- **Z — Repo↔brand reconciliation.** When the repo name ≠ the shipped CLI/brand name (e.g. `agent-harness-generator` ships as `metaharness`/MetaHarness), the site must reconcile them explicitly and early. Leaving the reader unable to map repo→brand is a defect [D24].
- **AA — Record the walk (per-repo build journal).** Each repo writes `docs/build-journal/<repo>.md` as it goes — config, KB grade-(A) evidence, gate B/C/D/E scores + fixes, optimized prompts, deploy proof (HTTP 200). The ADR DoD is the checklist; the journal is the proof it was walked for this repo. A deployed primer with no journal is incomplete [D25].
- **BB — Stare at it like a human (visual sign-off, added v1.3.1).** Building is not done. Before sign-off the **orchestrator must VISUALLY INSPECT the rendered live site** — screenshot it and *look at the pixels*, not read the code and assume. Check: hero, attribution prominence (Q), every section's formatting + that its visual actually renders, the favicon (meaningful + legible small), and the drop-in. **Fix what looks wrong, then re-screenshot to confirm.** A primer signed off from code or agent-reports alone — without a human-eye look at the live page — is **not** signed off. (Learned 2026-06-19: agents reported "96/100, gates pass" while the hero still failed the attribution test that's only visible by looking.) Extends **E** (PROVE-IT) and gate **B** from "rendered by a reviewer agent" to "looked at by the orchestrator."
- **CC — AI-comprehension is the primary acceptance test (added v1.4.0).** Grade from the AI's seat: an AI querying ONLY the drop-in scores 8 dimensions (onboarding / what-is / architecture / capabilities / usage / best-practices / deep-dive over 3 RANDOM buried files / extensibility); the composite is the **weakest dimension and MUST be ≥95**. It is only valid when a **cross-judge spot-check** (a second, stricter judge agrees) AND a **discrimination control** (a deliberately-vague/empty context scores low) both hold — a judge that rubber-stamps an empty context is rejected. Loop enrich → grade → fix-weakest → re-grade until ≥95. A drop-in that hasn't cleared this gate is not done [D26].
- **DD — Enriched `for-ai/` contract (added v1.4.0).** The `for-ai/` half ships, beyond the `.rvf`: `<repo>-symbols.json` (exact symbol→signature→location), `<repo>-dep-graph.json`, `<repo>-entrypoints.json` (build/test/run/install), the `<repo>-kb.rvf.embed.json` sidecar, and `source_type`-tagged passages — and the MCP server exposes `lookup_symbol` / `get_entrypoints` / `get_dep_graph` (with matching `--symbol`/`--entrypoints`/`--deps` on `ask-kb`). A guard asserts these exist and parse before zipping. A `for-ai/` half that is semantic-search-only, or an MCP server missing the structured lookups, is a defect [D13].
- **EE — RVF STORED/USED/TESTED/VERIFIED, every build (added v1.4.0).** Run all four EVERY time for EVERY repo, with evidence in the build journal: **STORED** (valid persisted `.rvf`, embed.json sidecar matches the model so there's no silent MiniLM fallback, passage↔id parity, no truncation); **USED** (`ask-kb` + MCP retrieve from the SHIPPED `.rvf`, dims match, structured lookups work); **TESTED** (Gate B coverage → Gate A answer-quality → AI-comprehension, in that order); **VERIFIED** (dry-run from the SHIPPED zip; served md5 == local md5; live URL HTTP 200). **None of these steps are done until each is tested and verified** [D27].
- **FF — Coverage before answer-quality (added v1.4.0).** Gate B (source-coverage — `indexed/authored ≥0.92`, fail <0.85; ≥3 passages/component; 20 random files retrievable; passage/source ratio ≥4.0; public-API symbols present) runs and passes BEFORE Gate A. Grading answer-quality on a KB that never indexed the deep source is a false pass; coverage is the precondition [D28].

---

## Post-Review Addendum — Improvement Pass (2026-06-19)

> Follow-ups and open challenges from an adversarial design + turnkey-readiness review. NOT yet-applied decisions. **VERIFY-THEN-APPLY** items are gated on measurement. **CONFIRMED** items survived the challenge — leave alone.

### Open Challenge — Human-Half Staleness (highest leverage)

The AI half auto-refreshes on every upstream SHA change; the hand-authored human half never does. The TEACHING half silently goes stale while the PROOF half stays current. The `ProvenanceMarker` (`.last-built.json`) has no `humanHalfSha` — a visitor sees a current date but cannot tell if the explainer video describes the same version. This directly contradicts Driver 3 ("a stale primer is worse than no primer") for the half that matters most.

**Mitigation path (follow-up — not yet implemented):** Track `humanHalfSha` (the submodule SHA at last human-half authoring) alongside `aiHalfSha` in `.last-built.json`; expose a staleness flag on the live page when they diverge. Auto-draft a 7-stage arc-script from the AI half on each rebuild so re-authoring is cheap — the human still authors, but the script hands them the current content.

### VERIFY-THEN-APPLY Items (decision-grade, pending measurement)

**1 — Measure 768-dim build time before keeping any multi-variant design.** The ">1h" big-variant estimate is unmeasured on the real ~6,772-passage corpus. If the actual build time is minutes (plausible — see D2's single-variant decision), the auto/manual split, parity-guard, carry-forward SHA, and manual dispatch are all unnecessary complexity. Action: measure on the actual corpus before re-introducing any dual-variant design on a new repo.

**2 — Evaluate a code-aware embedding model vs general-text models on a grader.** BGE and MiniLM are general-text models. For symbol-level queries ("how do I call `RvfDatabase::query`?"), code-aware models (`nomic-embed-code`, `codesage`) may meaningfully outperform them. Action: build a 5–10-query grader with ground-truth passages; compare recall@5. Adopt on measured recall — not assumption.

### Turnkey Follow-Ups (run on every new repo)

Gaps found stress-testing the pipeline against a second operator starting from scratch. Concrete deliverables, not discussion points.

| # | Item | Gate |
|---|------|------|
| 1 | `docs/RUNBOOK.md` — operator guide: new-repo-URL → shipped-bundle, step by step | Before first new-repo run |
| 2 | `repos.config.json` + refactor the 4 identity-hardcoded scripts (`guard-check`, `index-primer`, `make-bundles`, `update-readme-pins`) to read from it | Before first new-repo run |
| 3 | Generic `build-kb.mjs <repoId>` that reads per-repo config (no hardcoded repo identity) | Before first new-repo run |
| 4 | `docs/NOTEBOOKLM-AUTHORING.md` — the human-authored step written down (source curation → Studio outputs → `nlm` pull → CDP re-auth) | Before first new-repo run |
| 5 | Config-driven GitHub Actions workflows (repo identity from `repos.config.json`, not hardcoded) | Before first new-repo run |
| 6 | `scripts/scaffold-repo.mjs <repoId>` — scaffold a new target's directory structure + config from the template | Before second new-repo run |
| 7 | Arc-coverage guard: extend the live-query check to verify all 7 comprehension-arc stages are covered, not just non-empty results | High priority (currently designed only) |
| 8 | `scripts/preflight.mjs` — check prerequisites (Node version, `nlm` auth, `gh` login, runner minutes remaining) before a build run starts | Before first new-repo run |

### Enrichment — Do After Turnkey Is Solid

Do NOT gate turnkey readiness on these. Add after the pipeline runs on a second repo.

- **Symbol-diff DeltaSet:** reuse the API-export pass to diff exported symbols between versions; surface "new in this version" as first-class KB passages.
- **Tag passages by source-strategy + arc-stage:** metadata per passage (which traversal axis + which of the 7 arc stages). Enables the arc-coverage guard and richer provenance.
- **Whisper transcript handling:** tag transcripts of NotebookLM-generated audio as `source: nlm-studio`, not ground-truth repo content. Agents querying for an API should hit source-code passages, not audio paraphrases.
- **Optional `kb-previous` rollback release:** retain the prior `kb-latest` as `kb-previous` (one extra tag) for comparison.

### Explicitly NOT Doing

Considered and rejected as gold-plating: issues/PRs + CI-config walk passes; embedding novelty as primary delta; async big-variant rebuild; HumanHalf as DDD aggregate root; vector quantization / RaBitQ / hyperbolic embeddings; CDN for the bundle; the rename; a combined cross-repo KB.

### Confirmed Near-Optimal (survived the challenge — leave alone)

- Scope-boundary via `.gitmodules` — the one mechanical enforcement preventing both failure modes of Constraint A
- Change-based dispatch via `gh workflow run` — the only pattern that is evergreen AND immune to the GITHUB_TOKEN anti-recursion guard
- Guard-before-publish + fail-safe ordering + concurrency retry ×3 — all three independently necessary; removing any one recreates a known failure
- The dual-half teach+prove concept — neither half alone closes the esoteric-tool gap
- RVF single-file zero-server format — no daemon, no Docker, drops in anywhere; the format is what makes the AI half a proof point, not just a hosted service
