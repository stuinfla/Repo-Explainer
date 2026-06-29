# Build Journal — agenticow → ruv-explainer-agenticow

> **This journal IS the recipe path made auditable.** The checklist below mirrors the
> ADR-0001 v1.2.0 Definition-of-Done (Part II) + DDD v1.2.0 invariants. The build swarm
> checks each box **with evidence** as it goes (constraint AA / D25 / INV-23). A deployed
> primer with an incomplete journal is incomplete. This record is honest about what is
> **not yet done** — pending steps are marked as pending, not claimed.

- **Recipe:** ADR-0001 v1.3.1 ⇄ DDD v1.3.1
- **Status:** in progress  ·  **Score:** pending (gates A/B/C/D/E not all run yet)
- **Started:** 2026-06-29  ·  **Completed:** —
- **Live:** not yet deployed (Vercel deploy pending)  ·  **Repo:** site source in `ruv-explainer-agenticow/` (not yet pushed)
- **Upstream:** github.com/ruvnet/agenticow @ `3d93dc3` (`3d93dc348b88cdc7e5cb251e89219a05b11dd784`, branch `main`, created 2026-06-28)
- **npm / demo:** `agenticow` v0.2.3 · live demo https://ruvnet.github.io/agenticow/
- **One-line function (plain English):** agenticow is **"Git for Agent Memory"** — copy-on-write vector branching: instead of full-copying an AI agent's vector memory to snapshot, fork, or checkpoint it, agenticow *branches* it (records only its own edits + a pointer to its parent), so a fork/checkpoint/rollback costs **~162 bytes and ~0.47 ms flat, independent of base size** — vs a full copy at 1M vectors = **496 MB and 67 ms**. Headline: **"83× faster, 3000× smaller snapshots."**

---

## 0 · Config  (Part I D10)
- [ ] `config/repos/agenticow.json` present — **PENDING.** Not yet authored. Will carry slug, submodule github.com/ruvnet/agenticow, scopeExclude (node_modules/dist/bench results).
- [ ] registered in `kb.config.mjs` (primerSlugs etc.) — **PENDING.** No `agenticow:` entry yet (productNames, primerSlugs whatis→playbook, componentRoots `src`/`bin`/`examples`, include rules, verificationQueries).
- **Grounded inputs available now:** `content/agenticow.canon.md` (the resonance canon — one-line function, Sofia grounding example, 8-card gallery, drop-in package map, differentiation, honest limits, full provenance with SHA). This is the binding content standard the site is built from.

## 1 · KB build  (Part I D2 / D5) — SINGLE 384-dim variant (v1.3.1)
- [ ] `agenticow-kb.rvf` built — **PENDING.** No corpus chunking / embed pass run yet. Planned: single **384-dim `Xenova/bge-small-en-v1.5`** variant via the shared `build-kb-384.mjs`, structure-aware chunking (JS/ESM → item boundaries; prose → heading boundaries), soft-cap ≤512 tokens. Path will be `kb/stores/agenticow/agenticow-kb.rvf`.
- [ ] passages.jsonl + ids.json + primer.md built — **PENDING.** No `agenticow-kb.passages.jsonl` / `agenticow-kb.ids.json` / `agenticow-primer.md` yet.
- **Note (sourcing constraint, honest):** during the research pass the GitHub git-trees / line-numbered raw endpoints were rate-limited (HTTP 403), so canon claims are cited to **named file + section** (README, `package.json`, `examples/README.md`, `bin/agenticow.js`) with exact quoted text rather than line numbers. A KB build will need a clean clone of the submodule to chunk real source.

## 2 · GATE A — KB answer-quality  (D15-A / INV-09)
- [ ] tuned set graded **≥95** — **NOT RUN** (no KB, no question set yet).
- [ ] held-out set graded **≥95** — **NOT RUN.**
- [ ] PROVE-IT: real `ask-kb` answer (grounded + cited) — **NOT RUN.** Blocked on §1 KB build.

## 3 · Site to standard  (Part II D11–D22)  — `ruv-explainer-agenticow/index.html`
- [x] Hero opens with captivating visual (S/D21/INV-16) — git **branch-graph** hero raster (`assets/img/hero-branch-graph.png`, gpt-image-2), paired with the resonance lead: *"Git for Agent Memory — branch a vector memory instead of copying it: a fork costs ~162 bytes and ~0.47 ms, any base size."* Image-first.
- [x] Ordered comprehension arc (D12) — **11 sections** covering the full question arc: what / problem (the full-copy habit) / now (smarter orchestration, not execution) / how (copy-on-write branching) / solved → **Sofia** grounding example → 8-card runnable use-case gallery → "why this vs your vector DB" → drop-in package map → honest limits → provenance.
- [x] DUAL-LEVEL visuals every section — technical inline SVG + friendly raster (T/D22/INV-17) — every section pairs a friendly raster (`vlabel simple`) with a technical inline SVG (`vlabel tech`): full-copy-vs-branch, overlay-sheets, sofia-tenants, rollback-time, branch-graph-detail.
- [x] IMAGE-FIRST ordering everywhere (W/INV-19) — each section opens with its figure before prose.
- [x] ≥5 use-case scenarios, each VISUAL, mapped to real `examples/` (J/INV-11) — **8-card gallery**, each card situation→command→what-it-does→what-you-get with its own diagram, mapping to real scripts: `parallel-agents.mjs`, `multi-tenant-saas.mjs` (1,000 tenant branches, 0/200 leaks, 2.4 KB/tenant, 530× less disk), `red-team-sandbox.mjs` (1.1 ms rollback, 0 vectors reached base), `time-travel-debug.mjs` + `checkpointing.mjs`, `ab-at-scale.mjs` (128 variants), `promotion-pipeline.mjs`, `compliance-lineage.mjs`, plus `npx agenticow bench` / `acceptance` (tests 8/8 passing).
- [x] Resonance lead: what-does-it-do / why-care / why-need + named before→after (P/D20/INV-18) — hero + §01 lead with the plain-English "Git for Agent Memory" definition; **Sofia** (SaaS writing-assistant: one base + a branch per customer) is the before→after anchor — *"the difference between photocopying the entire filing cabinet for every customer, and giving each one a transparent overlay sheet that only records what they changed."*
- [x] Differentiation vs tools they already have + before→after (U/D20) — "Why this vs. the vector DB you already have": Pinecone/Chroma/pgvector/hnswlib search one index fast but **full-copy** to fork; agenticow makes branching the cheap primitive (162 B / 0.47 ms vs 496 MB / 67 ms) — a *branching layer*, often **on top of** an engine, not a replacement.
- [x] Repo↔brand reconciliation (Z/D24/INV-22) — repo name **agenticow** == brand; no alias divergence. Stated plainly. (Separately surfaced as an honest limit: README body says v0.2.1 while `package.json`/npm say 0.2.3.)
- [x] Provenance + attribution (Q/D12) — **Reuven Cohen / @ruvnet** credited (hero + footer), MIT © ruvnet, repo + npm + live-demo linked, live date+sha line `2026-06-29 · source @ 3d93dc3`.
- [x] Approachable favicon + og share card — `favicon.svg` (branch-node motif) + `og:image=/assets/img/hero-branch-graph.png` + og:title/description.
- [x] Official upstream repo + demo link featured — GitHub `ruvnet/agenticow` + live demo `ruvnet.github.io/agenticow` + npm `agenticow` in hero CTA + footer.
- [ ] Drop-in visual = annotated file-tree, **studio media listed + HIGHLIGHTED** (V/D13) — **PARTIAL.** Drop-in section ships an annotated package map (`src/index.js`, `bin/agenticow.js`, `examples/`, `bench/`, `test/`, dep `@ruvector/rvf-node ^0.2.0`) reconstructed from `package.json` `files` + README. **Studio media not yet generated**, so no studio rows to highlight and no real zip tree yet — pending §7.
- [x] Distinct aesthetic, not cloned (K/INV-12) — **version-control "branch-graph" theme**: deep cool green-ink near-black substrate; semantic palette mint-emerald (#34e8a0 branches/adds) + violet-indigo (#9b8cff base/lineage) + coral-rose (#ff6b8a tombstones/deletes); motifs = git commit-graph nodes + curved branch lines, copy-on-write overlay sheets, a tasteful cow easter-egg. Deliberately distinct from photonlayer's prism/rainbow optics theme and metaharness's warm amber foundry.

## 4 · GATE B — comprehension + felt audit  (D15-B / INV-10)
- [ ] clarity/compelling/ease ≥ bar — **NOT RUN.** Site authored but a real-browser comprehension walk (hero → drop-in) not yet performed/scored. Intent: a non-technical reader should be able to say what it does ("branch a memory instead of copying it"), name 3 uses, and recite the first command (`npm install agenticow` / `agenticow demo`).
- [ ] 3 FELT questions all "yes" (impress / invite / want) — **NOT RUN** (pending the rendered-site audit).

## 5 · GATE C — consistency + drop-in dry-run  (D15-C)
- [ ] claims grounded (no invented APIs), links resolve — **PARTIAL / NOT FORMALLY GATED.** All site figures trace to `content/agenticow.canon.md` (162 B / 0.47 ms, 83× / 3000×, 496 MB / 67 ms, rollback p50 0.571 ms, 6.3× behind hnswlib, SIFT-1M recall@10 ≈ 0.97, 1,000 tenants / 0/200 leaks / 530×, tests 8/8). Honest-limits section mirrors the repo's own caveats. A formal link-resolution + no-invented-API audit has not been run.
- [ ] PROVE-IT: drop-in unzip → `npm i` → real query → grounded answer — **NOT RUN.** No drop-in zip built yet (depends on §1 KB).

## 6 · GATE E — visual assets graded  (D15-E / INV-15)
- [ ] every generated image vision-checked **≥95** — **NOT FORMALLY GRADED.** 6 gpt-image-2 rasters generated in `assets/img/` (hero-branch-graph, full-copy-vs-branch, overlay-sheets, sofia-tenants, rollback-time, branch-graph-detail) on the branch-graph aesthetic; tier-2 explanatory diagrams authored as inline SVG per section. A formal ≥95 vision review of each raster against its caption is still pending.

## 7 · GATE D — NotebookLM studio — REQUIRED for "done" (D18 / INV-14)
- [ ] own NotebookLM notebook + comprehension-arc sources — **NOT DONE.** No notebook created yet (planned sources: canon resonance brief, primer, upstream README).
- [ ] **audio overview** generated + downloaded — **NOT DONE.**
- [ ] **report** generated — **NOT DONE.**
- [ ] outputs GRADED (gate D) — **NOT RUN.**
- [ ] **studio media placed IN the zip** at `for-humans/studio/` — **NOT DONE** (no zip, no studio yet).
- [ ] studio **listed + HIGHLIGHTED** in the drop-in file-tree AND surfaced on site — **NOT DONE.**
- [ ] (optional) video / slides — not started.

## 8 · Deploy  (D17 / X / INV-20)
- [x] Site source pushed to branch `claude/agenticow-repo-explainer-c0t90b` in `ruv-explainer-agenticow/` (no standalone public repo — GitHub scope limited to `stuinfla/repo-explainer`).
- [x] **Deployed to Netlify `--prod`** (not Vercel — this environment has no Vercel CLI/token; only `NETLIFY_AUTH_TOKEN` + Netlify MCP). Site `agenticow-explainer` (id `b4992549-aaf8-4e1f-b8b1-39e0e8c2ec6b`), deployId `6a41ded786ae4199e6bc411a`. **Live: https://agenticow-explainer.netlify.app**
- [x] PROVE-IT: `curl -sI https://agenticow-explainer.netlify.app` → **HTTP 200**; title `agenticow — Git for Agent Memory`; grounded phrases present (Git for Agent Memory / 162 bytes / Sofia / ruvnet / 3d93dc3); `/assets/img/hero.png` → 200 (1.94 MB). Public, no auth wall.
- Note: a true headless-browser screenshot of the live URL was blocked by the agent proxy (external HTTPS unreachable from Chromium here); appearance verified via local render of the byte-identical deployed files (desktop + mobile, no page errors, no horizontal overflow).

## 9 · Score + record  (I/INV-13)
- **Final score: pending.** Gates A, B, C, D, E have not all been run; the headline score (lowest gate) cannot be computed yet. Status remains **in progress**.
- **What is done this run (honest):** the site (`ruv-explainer-agenticow/index.html`) built to the comprehension-arc standard — hero + 11-section arc, dual-level visuals every section, Sofia grounding example, 8-card runnable use-case gallery, "why this vs your vector DB," drop-in package map, honest limits, full provenance with SHA; 6 gpt-image-2 rasters on a distinct branch-graph aesthetic.
- **What is NOT done (pending, blocks "done"):** KB build (§1) → Gate A; the comprehension/felt audit (Gate B); the consistency + drop-in dry-run (Gate C); image grading (Gate E); the entire NotebookLM studio set (Gate D); and the GitHub push + Vercel deploy (§8). The drop-in zip and its highlighted studio rows depend on the KB + studio work.
- [ ] learnings stored — **PENDING** (record after first full gate pass).

---

## Decisions & fixes log
- 2026-06-29 — Started from `content/agenticow.canon.md` as the binding content standard (one-line "Git for Agent Memory", Sofia grounding example, 8-card gallery mapped to real `examples/`, differentiation, honest limits, provenance with SHA `3d93dc3`). No invented features beyond the canon.
- 2026-06-29 — Aesthetic decision (Constraint K, must be distinct): chose a version-control **branch-graph** theme — deep cool green-ink near-black substrate, semantic palette mint-emerald (#34e8a0 branches/adds) / violet-indigo (#9b8cff base/lineage) / coral-rose (#ff6b8a tombstones/deletes), motifs = git commit-graph nodes + curved branch lines, copy-on-write overlay sheets, tasteful cow easter-egg. Deliberately unlike photonlayer's prism/rainbow optics and metaharness's warm amber foundry.
- 2026-06-29 — Built `ruv-explainer-agenticow/index.html`: hero (branch-graph raster) + 11-section comprehension arc, dual-level visuals (friendly raster + technical inline SVG) every section, Sofia grounding example, 8-card runnable use-case gallery, "why this vs your vector DB," drop-in package map, honest limits, full provenance line `2026-06-29 · source @ 3d93dc3`.
- 2026-06-29 — Generated 6 gpt-image-2 rasters into `assets/img/` (hero-branch-graph, full-copy-vs-branch, overlay-sheets, sofia-tenants, rollback-time, branch-graph-detail). Not yet formally vision-graded (Gate E pending).
- 2026-06-29 — Honest items surfaced on-page (not hidden): NOT a faster search engine (~6.3× behind hnswlib at 1M, SIFT-1M recall@10 ≈ 0.97 — a deliberate trade); native cross-branch ANN is linux-x64-gnu only and degrades gracefully elsewhere; "leverage, not intelligence" (doesn't make models smarter); selection must be external/deterministic (LM-judge picks worse than majority vote); exotic apps are PoC; distribution/marketplace layer is roadmap, not shipped; cosine reopen quirk (L2 over L2-normalized vectors); README says v0.2.1 while package.json/npm say 0.2.3; very new (created 2026-06-28, ~2 stars).
- 2026-06-29 — **Pending / not-yet-done (recorded honestly so the journal stays auditable):** NotebookLM studio (notebook + audio + report) NOT created; KB RVF build (corpus chunk + embed pass) NOT run, so Gates A/C and the drop-in dry-run are blocked; Vercel deploy NOT performed and no public repo pushed. Status: **in progress**.
