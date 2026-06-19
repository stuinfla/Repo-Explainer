# ADR-0001: Repo-Primer Pipeline Architecture

**Status:** Accepted — pattern proven on RuView + ruvector and live in production. Delta-highlighting, full ≥5-strategy force-walk, comprehension-arc coverage check, and the generalized multi-repo repo are committed follow-ups NOT yet implemented.  
**Date:** 2026-06-19  
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
| Both RVF variants ship (small 384-dim auto; big 768-dim manual, carried-forward between manual runs; each variant's originating SHA in bundle manifest) | Full ≥5-strategy force-walk (currently: source tree + deep-docs + crate-src; missing API/exports, examples, changelog passes) |
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

### D2 — RVF for the AI half (two variants: small=evergreen, big=manual)

The AI half ships two RVF files built with `@ruvector/rvf` (Node):

| Variant | Model | Dimensions | Build time | Refresh cadence |
|---------|-------|-----------|-----------|-----------------|
| Small   | `Xenova/all-MiniLM-L6-v2` | 384 | ~minutes on CI free runner | Automatic (change-based) |
| Big     | `Xenova/bge-base-en-v1.5`  | 768 | >1 h CPU (estimated, free 2-core runner) | Manual / `workflow_dispatch` |

Both variants always ship; `big` is carried forward between manual runs, with each variant's originating submodule SHA recorded in the bundle manifest. `close()` is the only persist path — never hold a partial-write RVF open across an error boundary.

**Rationale:** 384-dim stays evergreen at zero cost. 768-dim gives higher recall for semantic queries but cannot run daily on a free runner without exhausting minutes. Shipping both ensures agents get the best available KB without blocking the daily refresh on an expensive rebuild.

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

### D6 — Guard before publish: anti-truncation + parity + live-query

The following checks run after the RVF build and before any publish step:

1. **Anti-truncation (built):** chunk count must meet a minimum threshold; a build that indexes zero or near-zero chunks is a silent failure. An upper-bound check (catches accidental over-ingestion re-adds) is a follow-up item.
2. **Parity (built):** both small and big variants must be present and non-zero.
3. **Live query (built):** execute at least one comprehension-arc query against the RVF and confirm a non-empty result set is returned. **Note: today's live-query check only confirms non-empty results — it does NOT verify coverage of all 7 arc stages. A stage-coverage check is a follow-up item.**

Red on any check → stop; do not publish. Never clobber the live, correct download with a broken rebuild.

### D7 — Distribution split: Release for binaries, git for loose KB files

- Bundles (zip, all media, both RVF variants together) → GitHub Release tagged `kb-latest` (--clobber, permanent URL). Binaries are gitignored; they exceed GitHub's 100 MB/file limit as a combined bundle.
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
embed_models = ["all-MiniLM-L6-v2", "bge-base-en-v1.5"]
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
- The big (768-dim) RVF variant requires a manual `workflow_dispatch` per rebuild due to CI runner cost. It will trail the small variant between manual runs.
- The bundle download is ≈138 MB (measured, RuView build, June 2026), which is non-trivial on slow connections. This is a distribution characteristic, not a defect.

### Risks

- **NotebookLM availability:** if Google sunsets or changes Studio output access/format, the human half authoring step breaks. Mitigation: the outputs are pulled once and stored; a format change only affects new authoring runs.
- **`@ruvector/rvf` API stability:** if `close()` semantics change, the persist path breaks. Mitigation: pin the rvf version in the generalized repo; upgrade intentionally.
- **CI minute budget:** the daily small-variant rebuild plus daily submodule bump uses CI minutes. On GitHub's free tier this is material for 6+ repos. Mitigation: stagger cron schedules; move to a paid runner or a self-hosted runner if budget exhausts.
- **Scope creep in the KB:** future contributors may widen exclude patterns incorrectly (e.g., accidentally including `vendor/` again). Mitigation: the guard's chunk-count floor catches catastrophic over-ingestion; add an upper-bound check as well.

---

## Operating Constraints (Binding)

These are not recommendations. Each was learned from a real failure in the two-repo prototype. Treat any design that violates them as broken until proven otherwise.

**A — Scope boundary (most critical):** Index ONLY the target repo's own authored tree. At build time, read `.gitmodules` and exclude every nested submodule path. Keep authored crates. Never recurse into `vendor/` or equivalent. Two independent failure modes if violated: (a) **Technical:** RuView's vendor tree contained the full ruvector engine; recursive indexing produced 44,083 chunks / 4,135 segments (before fix: 6,772 chunks / 637 segments after), overwhelmed `RvfDatabase.close()` on a 2-core runner, manifested as `ManifestNotFound`. (b) **Comprehension:** a RuView primer that teaches ruvector internals fails the comprehension arc — wrong tool, wrong audience. Both failures are caused by the same boundary violation. (Figures measured, RuView build, June 2026.)

**B — Evergreen triggering (change-based):** The daily cron is a **poll**, not a blind dispatch. It dispatches a rebuild ONLY when the upstream submodule SHA changed (`git diff --quiet`). A `GITHUB_TOKEN` push does NOT trigger `on: push` workflows — GitHub's anti-recursion guard — so dispatch must be via explicit `gh workflow run`. The dispatching workflow must have `actions: write` in its token permissions. (Silent failure: the auto-update looked wired and never fired for days — the SHA-check was missing AND the push-trigger was relied on without knowing about the anti-recursion guard.)

**C — Concurrency on CI commit steps:** Any CI step that commits back must `git pull --rebase --autostash` before push, with retry ×3. (A concurrent commit mid-build rejects the push; without the retry the rebuild completes but never publishes.)

**D — Fail-safe ordering:** Build and guard run before publish. A broken rebuild must never clobber the live, correct download. Guard red = stop; do not proceed.

**E — Prove-it, never assert:** Verify against the real artifact in use. Open the actual `.rvf`, hit the real Release URL, check the live page provenance timestamp. False-confidence claims ("it's working", "you're all set") without running real commands are explicitly unacceptable. If not verified, say so.

**F — Two-variant tradeoff:** Small (384-dim) = evergreen/automatic. Big (768-dim) = manual (cost). Keep both present in every bundle. Do not drop either.

**G — Simplicity for the human half:** Slides ship as native PDF — no OCR, no conversion pipeline. Keep the human on-ramp low-friction. Every added step is a step that fails silently for the sixth repo.

**H — Distribution split:** Bundles on GitHub Release (permanent URL, `--clobber` tag). Loose individual `.rvf` files committed to git as source of truth. The page downloads from the Release. Binaries never go in git.

---

## Generalization Plan

The generalized repo (separate from this primer) implements the following:

1. **One config file per target repo** (TOML/JSON) specifying: submodule path, NotebookLM notebook ID, embed models, scope exclusion patterns.
2. **Shared GitHub Actions workflows:** `daily-bump.yml` (submodule bump → dispatch), `rebuild-kb.yml` (build + guard + bundle + publish), `rebuild-kb-big.yml` (manual 768-dim rebuild).
3. **Shared Node scripts:** `build-kb.mjs` (RVF force-walk, multi-axis, delta layer), `guard-kb.mjs` (anti-truncation + parity + live query), `make-bundles.mjs` (zip both halves, dedup media).
4. **NotebookLM authoring playbook:** a documented human-authored step (not automatable) covering: notebook creation, source upload, Studio output generation, pull via `nlm` CLI (CDP re-auth from running Chrome).
5. **Surfacing page:** one static page per repo (or a single page listing all repos) fetching `/kb/.last-built.json` for live provenance.

The first three target repos for the generalized run (order TBD): ruvector, RuView (already done — port config), plus ~4 additional ruv repos selected by ruv or Stuart.

---

## Validation / Proof Points

The following were verified against real artifacts before this ADR was accepted:

- Live page: <https://cognitum-sensor-primer.vercel.app> — visual two-halves layout, live provenance, off-page links.
- Download: GitHub Release `kb-latest` ships a zip with `for-humans/` and `for-ai/` halves for both RuView and ruvector.
- RVF build: **both** the small (384-dim, auto/evergreen) and big (768-dim, manual) variants ship. The big variant is carried forward between manual runs; each variant's originating submodule SHA is recorded in the bundle manifest so provenance is explicit. Both variants were built, closed, and queried successfully against comprehension-arc questions.
- Guard: anti-truncation and live-query checks run in CI before publish; a failed build did NOT clobber the live Release (observed in the ManifestNotFound incident).
- Evergreen: change-based cron fires daily, checks whether upstream SHA moved, commits the bump and dispatches rebuild only when changed. Confirmed by provenance timestamp on live page updating when the upstream repo changes.
- The ManifestNotFound failure was reproduced, root-caused (vendor/ over-ingestion → 44,083 chunks / 4,135 segments → `close()` OOM on 2-core runner — measured, RuView build June 2026), and fixed (exclude nested submodules at build time → 6,772 chunks / 637 segments). Fix is verified in current CI.

What was NOT tested: the 768-dim rebuild on a fresh runner with no npm cache (only verified with warm cache). The delta layer, full ≥5-strategy force-walk, and comprehension-arc coverage guard are designed but not yet implemented — see Follow-ups.

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
| 8 | Stress-test 768-dim rebuild on a cold runner (no npm cache) | Stuart | Medium |
| 9 | Document NotebookLM authoring playbook (not automatable; must be written down) | Stuart | Medium |
| 10 | Evaluate CI minute budget for 6+ repos on daily cadence; plan for paid/self-hosted runner if needed | Stuart | Medium |

---

# Part II — Explainer Website & Self-Evaluating Quality Gate

> *Added 2026-06-19 (briefly drafted as ADR-0002, then merged here so there is exactly one ADR ⇄ one DDD). Part I is the engine; Part II is the experience + the proof-of-quality. Both are binding. Applies to ruv's **brand-new** repos only — established concepts live in a separate explainer.*

## Context (Part II)

Two reframes since Part I, now binding:
1. **The explainer website is a co-equal HERO artifact** — not a NotebookLM by-product. Ruv ships brilliant but dense, deeply technical READMEs that don't meet newcomers where they live. The website's job: bridge that gap for a **non-technical person who already uses Claude Code**, so they grasp *what the tool is* and *what to do with it*, then copy the KB to their machine and use it immediately.
2. **"Done" means "proven good," not "files exist."** On the prototype, RVFs shipped un-graded → 4–5 regeneration cycles. Banned by process: the build must **evaluate its own output** (KB and site) and only declare done when it passes, with evidence.

Two hero artifacts per repo: **(1) ExplainerSite**, **(2) Drop-in Smart Zip** (the KB bundle). Cadence: build ONE, evaluate against this Part II until it genuinely passes, get owner sign-off — then scale to the top-5 of the new-repo batch. First target: `agent-harness-generator` (MetaHarness).

## Decisions (Part II)

**D11 — Two hero artifacts, both gated.** Every primer ships an ExplainerSite AND a Drop-in Smart Zip; neither optional; both must pass the Quality Gate (D15).

**D12 — ExplainerSite design contract.** Built for one persona — the **NonTechnicalClaudeCodeUser**. Must:
- Answer the **seven questions, in order**, each as its own section: (1) Why was it built? (2) What problem does it solve? (3) Why is that a problem *now*? (4) How does it solve it? (5) What does a *solved state* look like? (6) How would you implement it? (7) How do you start?
- Ship a **Use-Case Gallery of ≥5 *full* concrete scenarios**, and **each scenario MUST be shown VISUALLY** (a problem → command → what-it-looks-like → result diagram) — *examples rendered as dense prose are a defect ("garbage"), not coverage.* The lead example must be **relatable to a non-technical person** (a named, ordinary persona with a real before→after), not an engineer-only abstraction. The gallery is a **series of collapsible items — each opens to its OWN visual + concept + what-it-does.** **Sequence the education deliberately:** one concrete grounding example that makes the reader *"oh, that's what it's for"* → the collapsible gallery of varied real-world uses → *then* how to implement. **Understanding before implementation** — never implementation steps before the reader even grasps why they'd want it.
- Be **collapsible & visual**: numbered sections (orienting open, deep collapsed). **EVERY section — and every named *process* (e.g. a multi-stage pipeline like the composer's 9 stages) — carries an explanatory visual** that shows the mechanics, not decoration. **A text-only section is a defect: it is "a glorified pretty README," the exact failure we exist to prevent.**
- **On-page provenance & attribution (Cognitum pattern, mandatory):** credit the original author (e.g. **Reuven Cohen / @ruvnet**), link to the **source repo**, and show a **live provenance line** — last-updated date + the source repo's latest version + HEAD sha — so a visitor can tell whether it's current. (Modeled on cognitum-sensor-primer; omitting it is a defect.)
- Have a **distinct aesthetic per repo** (cloning a prior site = defect).
- Surface the **Smart Zip** with exact drop-in steps (unzip → `.mcp.json` → `CLAUDE.md` gate) + a confirm-it-works query.
- State **honest limits**; **end in action** (usable in Claude Code/Codex immediately).

**D13 — Drop-in Smart Zip contract.** One `kb/` folder, two halves: `for-ai/` (`*.big.rvf` 768-dim + `*.small.rvf` 384-dim + `*.passages.jsonl` + `ask-kb.mjs` + `kb-mcp-server.mjs` + summary) and `for-humans/` (`<repo>-primer.md` + optional NotebookLM media), plus README + manifest. Self-contained, runnable. **The Drop-in section's visual must SHOW what is actually inside the zip — an annotated *file-tree* of each half (every file + a plain-English "what this is"), modeled on the Cognitum "one download, two halves" contents diagram — NOT an abstract/pretty two-halves picture. A visual that doesn't reveal the real contents is a defect.**

**D14 — NotebookLM is scriptable (corrects Part I).** The authenticated `nlm` CLI scripts audio overviews, reports, quizzes, sources, notebooks, and pipelines; video-overview / slide-deck may still need the UI (then `nlm download`). Studio media is an *enhancement* layered after the site + zip pass — it never blocks them.

**D15 — The Self-Evaluating Quality Gate (the heart).** Before "done," the build runs and PASSES, recording evidence in the manifest:
- **(A) KB answer-quality grading** — query the real `.rvf` (both variants) with a fixed question set **plus a held-out set**; grade on a dual metric (retrieval relevance + answer correctness/completeness vs source). Below threshold → diagnose (truncation / scope bleed / embedding mismatch / missing pass) → rebuild → re-grade. *Never ship an un-graded KB.*
- **(B) Site comprehension *and desire* audit** — an independent reviewer **actually renders the site and walks it as a real visitor** (via a browser, not by reading source), role-played as the NonTechnicalClaudeCodeUser. They must (i) state what it is, name 3 concrete uses, recite the exact first command, confirm every hard concept has a visual; **and (ii) answer three FELT questions honestly: "Does this impress me? Does it invite me in? Does it make me want to work with this tool?"** A "no" on any felt question is a **FAIL**, not a nitpick. Scores clarity/compelling/ease (1–5). Below bar or any felt-"no" → **enhance the site → re-audit**, looping until all three felt questions are "yes." **The reviewer must ALSO be able to answer, in plain words after reading: "What does it actually DO? Why do I care? Why do I need it?" — if they still can't, that is a FAIL (the explanation is too abstract/ethereal) [D20].**
- **(C) Consistency & completeness** — claims grounded in source (no invented APIs); all 7 stages present; ≥5 full use cases; links resolve; drop-in dry-run (load `.mcp.json`, run a real query, get a grounded answer).
- **(D) NotebookLM studio-output quality grading** — every studio artifact produced for the human half (audio overview; report; and video/slides/infographics where the tooling/UI allows) is graded by **reading/transcribing the actual output** (never assuming it ran) for: clarity, understanding, intention, education, comfort, confidence, completeness, and effectiveness. Below bar → **refine the optimized studio-creation prompt** → regenerate → re-grade. (See D18.)
- **(E) Visual-asset quality grading** — every generated image/graphic is graded with a **vision check** for: **clarity, communicative effectiveness, friendliness, and approachability** — never decorative-only, never cold tech-speak. Below bar → refine → regenerate → re-grade; prompts saved per repo. **Visuals MUST span two tiers:** **(1)** a friendly raster *on-ramp* (approachable first impression — the metaphor that makes a newcomer comfortable), AND **(2)** accurate, labeled **ARCHITECTURAL / explanatory diagrams — authored as crisp SVG, not AI raster** — that reveal the real mechanics under the covers: *what is actually happening, why it matters, and what it does for you.* Tier 2 must be **true to the source** (no invented architecture) and is graded not just for clarity but for **belief/conviction** — does a technical-but-new viewer come away trusting *how it works*? **A site that is friendly-but-not-explanatory FAILS (E):** it meets the newcomer at the surface but never earns their trust. (See D19.)
- **Scoring:** each primer is graded **0–100**; **≥98 required** to be "done" and to move to the next repo.
- **Done = (A)+(B)+(C)+(D)+(E) green + score ≥98 + evidence shown.** Extends Part I's "PROVE, don't assert" from *existence* to *quality*.

**D16 — Scope & cadence.** Brand-new repos only; **one at a time**; nail #1 (≥98) + owner sign-off before scaling; top-5 of the new batch; #1 = `agent-harness-generator`. **This ADR + the DDD are the COMPLETE, run-once RECIPE:** once #1 passes all gates (A–E) and is signed off, repos 2–5 **replay the identical pipeline** — only the per-repo config, the canonical content, and the aesthetic theme change. Nothing about the *process* should need re-deciding; if it does, fix the recipe here first.

**D17 — Deployment.** Each primer gets **its own GitHub repo** and **its own Vercel site** named `ruv-explainer-<repo>.vercel.app` — one page per repo.

**D18 — NotebookLM studio buildout per repo (optimized prompts + graded outcomes).** Every repo gets **its own NotebookLM notebook**: create it, load its sources (the auto-drafted comprehension-arc doc + key repo docs via `nlm source add`), then build the full studio set we built for RuView — **audio overview** (`nlm audio create`), **report**, and **video / slides / infographics** where the tooling or UI allows. For **each** artifact:
- **Construct an OPTIMIZED studio-creation prompt** — explicitly tuned for *clarity, understanding, intention, education, comfort, and confidence* for the NonTechnicalClaudeCodeUser. Generic prompts are a defect.
- **Verify the produced outcome** (gate D): read the report / transcribe the audio+video and grade it for completeness and effectiveness — does it actually teach a true beginner? If not, refine the prompt and regenerate.
The optimized prompts are saved per repo (so they're reusable and auditable). Studio media remains layered after the two heroes pass (A)+(B)+(C), but it now carries its own bar (D) — it is not "ship and forget."

**D19 — Approachability & visual grading (text *and* imagery).** The whole primer — copy AND images — must read **friendly and approachable to a non-technical person**, never as a jargon wall or "super tech-speak." Concretely: (a) **plain-language voice** — lead with the human problem, not the architecture; define any necessary term in-line; (b) **every generated graphic** is produced by an OPTIMIZED image-generation prompt and graded by gate (E) — a vision check that it is clear, communicative, friendly, and approachable, and matches its concept/caption; weak → refine prompt → regenerate → re-grade; (c) **text and imagery are judged together** for one consistent warm, confident tone. Decorative-but-uninformative images, or correct-but-cold tech-speak, are defects.

**D20 — Resonant comprehension: make a non-technical person GET it and CARE.** The single biggest failure mode is describing the tool in an *ethereal, abstract* way ("a factory for agent frameworks") so the reader nods but never grasps what it DOES or why they'd want it. This is forbidden. Every primer must, early and in plain, visceral language:
- **Translate the abstraction down to earth.** "Meta"/abstract tools especially must be re-stated in concrete everyday terms a non-technical person *feels* — what it literally does for *you*.
- **Answer the stakes explicitly:** *What does it actually do? Why do I care? Why do I need this? Why is it important?* If a reader can still ask "…but what does it actually do and why would I want it?", the primer **FAILED**.
- **Anchor with ONE concrete, RELATABLE example** — a named, ordinary persona with a real *before → after* (the pain without the tool → the exact thing they run → how their day is better). An abstract or engineer-only scenario does not satisfy this; the example must make a non-technical reader go "oh — *that's* what it's for."
The job: carry the reader from non-technical zero → conceptual grasp → architectural understanding → genuine *confidence and "I want this."* A nice-but-ethereal intro that doesn't land is a defect.
- **Differentiate from what they already have.** If the audience plausibly already uses an adjacent tool — the host (Claude Code / Codex) or a big existing harness (e.g. Ruflo) — the page MUST answer head-on: *"I already have X — why do I need this too?"* Name the real difference and why it is **not** "just another thing piled on." Pair it with a **before → after on *your own codebase*** comparison (a side-by-side table or diagram) showing what changes when you run it. Failing to answer "why this on top of what I already have?" is a defect.

## Definition of Done — the checklist the build runs on itself
- [ ] All 7 questions answered as sections.
- [ ] ≥5 full use-case scenarios, each with a visual.
- [ ] Every hard concept has a figure; sections collapse; distinct aesthetic.
- [ ] Smart Zip runnable (`npm i` + a real query → grounded answer).
- [ ] KB graded (A) ✓ on tuned + held-out; Site audited (B) ✓; Consistent (C) ✓ — evidence recorded.
- [ ] NotebookLM studio built per repo (own notebook + sources); studio-creation prompts optimized & saved; outputs graded (D) for clarity/comfort/confidence/completeness/effectiveness.
- [ ] Every generated image graded (E) ✓ — vision-checked for clarity/effectiveness/friendliness/approachability and that it matches its concept; image prompts optimized & saved.
- [ ] Voice is plain-language & approachable throughout (no jargon walls / tech-speak); text + imagery share one warm, confident tone [O].
- [ ] Score ≥ 98/100.
- [ ] Honest limits + real provenance shown; secrets gitignored.
- [ ] Owner sign-off on #1 before scaling.

## Operating Constraints (Part II — additive to A–H)
- **I — Done = proven-good.** Never declare a KB/site done without running the gate (D15) and showing evidence. (Exists because un-graded RVFs cost 4–5 regen cycles.)
- **J — Concrete use cases.** ≥5 full scenarios; "anything you like" is a defect.
- **K — Distinct aesthetic per repo.** Reusing a prior look is a defect.
- **L — One-at-a-time until proven.** No batching until #1 scores ≥98 + sign-off.
- **M — Audience = non-technical Claude-Code user.** If a true beginner can't understand and use it, the primer failed.
- **N — Studio outputs are optimized & graded, not assumed.** Each repo gets its own NotebookLM notebook and a full, *checked* studio buildout. Generic studio prompts, or shipping studio media without verifying the outcome teaches, are defects.
- **O — Approachable, never tech-speak.** Copy AND imagery must meet a non-technical person where they live — plain language, human-problem-first, terms defined in-line; every graphic *communicates* (graded by E), not decorates. Jargon walls and cold/decorative visuals are defects.
- **P — Resonance over abstraction.** A primer that leaves a non-technical reader still asking "but what does it DO and why do I care?" has failed, however polished. Translate every abstraction into plain stakes + a relatable, named before→after example [D20].
- **Q — Provenance & attribution on the page.** Credit the original author (Reuven Cohen / @ruvnet), link the source repo, and show a live updated-date + version + sha. Omitting attribution/provenance is a defect [D12].
- **R — Educational sequencing.** Order the page as a learning arc: grounding example → collapsible gallery of varied real-world uses (each with its own visual) → how to implement. Never put implementation steps before the reader understands *why they'd want it* [D20].
