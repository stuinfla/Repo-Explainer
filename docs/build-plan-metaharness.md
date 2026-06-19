# Build Plan — MetaHarness (`agent-harness-generator`) Primer

Updated: 2026-06-19 | Version 1.0.0
Created: 2026-06-19

**Single binding source of truth:** `docs/adr/0001-repo-primer-pipeline.md` (Part I + Part II) and `docs/ddd/repo-primer-domain-model.md`.
**Target #1 (and only, until ≥98 + sign-off):** `ruvnet/agent-harness-generator` — "MetaHarness" [D16, Constraint L].
**Live artifacts:** GitHub `stuinfla/ruv-explainer-agent-harness-generator` (public) · Vercel `ruv-explainer-agent-harness-generator` (scope `sikerr-6092`) · `https://ruv-explainer-agent-harness-generator.vercel.app` [D17].

This plan merges four inputs (newcomer content draft, KB-build+grader plan, site+deploy plan, and the binding contract) into ONE ordered implementation plan. Every step is traced to a binding requirement. Toolchain verified present 2026-06-19: `git`, `gh` v2.89 (authed `stuinfla`), `vercel` v54.11.1 (`~/.npm-global/bin/vercel`), Node v22.13.1, `zip`/`unzip`. Prototype scripts confirmed at `/Users/stuartkerr/Code/Cognitum Sensor Primer/cognitum-one-sensor-primer/kb/`.

---

## 0. Two hero artifacts, both gated [D11]

| Artifact | What it is | Gate it must pass |
|---|---|---|
| **ExplainerSite** (HERO #1) | Foundry/mint-themed static site, 7 arc-question sections + Use-Case Gallery (≥5) + Drop-in | Gate (B) ComprehensionAudit + (C) Consistency |
| **Drop-in Smart Zip** (HERO #2) | `kb/` with `for-ai/` + `for-humans/`, runnable | Gate (A) KB grading + (C) drop-in dry-run |

Neither is optional. Both feed one Score ≥98 [D15, §6]. Build ONE repo, prove it, get owner sign-off, THEN scale [L].

**Critical reconciliation note enforced throughout:** the canonical CLI is `npx metaharness` (README header). Older doc sections show `npx create-agent-harness` (internal package `packages/create-agent-harness/`). They are the same tool. All on-page commands and all KB `mustContain` facts use `metaharness` as primary, note `create-agent-harness` as alias. The live MCP tool family is `mcp__ruflo__metaharness_*` (verified available: `_score`, `_genome`, `_mcp_scan`, `_threat_model`, `_oia_audit`, `_similarity`, `_drift_from_history`, `_audit_list`, `_audit_trend`).

---

## 1. PHASED TASK DAG — what, in what order, what parallelizes

Notation: `P#` = phase; `[∥]` = runs in parallel with siblings; `→` = hard dependency. Per the Ruflo-first mandate, register the work via `swarm_init` + `agent_spawn` (visible IDs), run all file-editing/build steps through Claude Code Task executors (`agent_execute` cannot touch files), and use `agent_execute` only for the optional held-out LLM-judge tier (gate A) and the independent ComprehensionAudit reviewer (gate B).

```
P0  SCAFFOLD + SCOPE LOCK  (foundation — blocks everything)
 ├─ P0.1  Clone target shallow → record HEAD sha               [Constraint A, B, E]
 ├─ P0.2  Confirm NO .gitmodules (force-walk case) + scopeExclude set   [A]
 └─ P0.3  Author kb.config.mjs AHG entry (repoDir, exts, componentRoots, include rules)  [D10]
                                   │
        ┌──────────────────────────┴───────────────────────────┐
        ▼                                                        ▼
P1  KB ENGINE (generalize prototype)              P2  SITE SKELETON + DESIGN LOCK  [∥ with P1]
 ├─ P1.1 build-kb.mjs + corpus-rules.mjs (NEW)     ├─ P2.1 styles.css :root foundry tokens (NO cyan) [K]
 ├─ P1.2 generalize build-big-variant/ask-kb/      ├─ P2.2 index.html IA skeleton, native <details>
 │       guard-check/index-primer/mcp-server/      │       9 sections (01–07 = 7 questions, 08 gallery,
 │       make-bundles/resolve-deps (EDIT)          │       09 drop-in)  [D12, INV-10]
 └─ P1.3 grade-kb.mjs + gate.mjs (NEW)             └─ P2.3 self-host 5 woff2 fonts (zero CDN)
        │                                                        │
        ▼                                                        ▼
P3  KB FORCE-WALK + BUILD  (depends P1)            P4  SITE CONTENT  (depends P2, newcomer draft)
 ├─ P3.1 build SMALL .rvf + passages + ids  [D2,F] ├─ P4.1 write 01–09 copy from 7-arc draft  [D12]
 ├─ P3.2 write primer.md (7 arc ## sections)       ├─ P4.2 Use-Case Gallery 5+ full scenarios  [J,INV-11]
 ├─ P3.3 index-primer → small  (reconcile)         ├─ P4.3 Drop-in §09 + CLAUDE.md gate + .mcp.json
 ├─ P3.4 build BIG .rvf (re-embed SAME passages)[F] │       + confirm-it-works query  [D12, D13]
 └─ P3.5 guard-check (parity/trunc/live)  [D6, D]  └─ P4.4 honest-limits block  [D12, Constraint E]
        │                                                        │
        ▼                                          P5  GRAPHICS  [∥ with P4 once P2.1 palette locked]
P6a  GATE (A) KB GRADING  (depends P3)              ├─ P5.1 G1–G6 PNG via image-generation skill [INV-12,K]
 ├─ author tuned + heldout question sets            └─ P5.2 favicon.svg hand-authored 'MH' coin
 ├─ grade-kb BOTH variants, BOTH sets  [D15-A]              │
 └─ <98 → diagnose(R/C/O) → fix → re-grade loop             ▼
        │                                          P6b  GATE (B) SITE AUDIT  (depends P4+P5)
        │                                           ├─ render site locally
        │                                           ├─ independent reviewer agent (agent_execute) as
        │                                           │   NonTechnicalClaudeCodeUser  [D15-B, INV-10]
        │                                           └─ <bar → revise → re-audit loop
        └───────────────────────────┬──────────────────────────┘
                                     ▼
P7  GATE (C) CONSISTENCY + DROP-IN DRY-RUN  (depends P3,P4,P6a)
 ├─ claims grounded (no invented APIs); all 7 stages; ≥5 use cases; links resolve  [D15-C]
 ├─ assemble metaharness-dropin.zip; npm i; load .mcp.json; real query → grounded answer  [D13]
 └─ Smart Zip bundle (for-ai/ + for-humans/ + README + manifest)  [D13]
                                     ▼
P8  SCORE + EVIDENCE  (depends P6a,P6b,P7)
 ├─ compute 0–100; require (A)+(B)+(C) green AND score ≥98  [D15, §6]
 └─ record evidence in manifest  [I]
                                     ▼
P9  DEPLOY  (depends P8 green)
 ├─ git init + gh repo create stuinfla/ruv-explainer-agent-harness-generator (public)
 ├─ loose .rvf committed to git (source of truth, <100MB)  [H]
 ├─ bundle zip → GitHub Release kb-latest --clobber (binaries NOT in git)  [H]
 ├─ vercel link + deploy --prod (scope sikerr-6092)  [D17]
 └─ post-deploy PROVE-IT verification (live URL, fonts, images, zip 200)  [E]
                                     ▼
P10 EVERGREEN  (depends P9; change-based)
 ├─ daily-bump.yml: poll upstream SHA; gh workflow run only if moved  [B]
 ├─ rebuild-kb.yml (small auto) + rebuild-kb-big.yml (manual dispatch)  [F]
 ├─ commit steps: git pull --rebase --autostash + retry ×3  [C]
 └─ build+guard BEFORE publish (fail-safe)  [D]
                                     ▼
P11 OWNER SIGN-OFF on #1 BEFORE any scaling  [D16, L]
                                     ▼
P12 NOTEBOOKLM STUDIO BUILDOUT — own notebook + sources; OPTIMIZED studio prompts; gate (D) grades each output (clarity/comfort/confidence/completeness/effectiveness); layered AFTER heroes, never blocks them  [D14, D18, gate D, INV-14, N]
```

**What parallelizes:** P1 (KB engine) ∥ P2 (site skeleton). P4 (site content) ∥ P5 (graphics) once the P2.1 palette is locked. P6a (KB grade) ∥ P6b (site audit). Everything converges at P7→P8. P12 is fully decoupled and may run any time after P9.

**Critical path:** P0 → P1 → P3 → P6a → P7 → P8 → P9. The KB grading loop (P6a) is the schedule risk because the ≥98 deterministic bar requires verified `mustContain` facts.

---

## 2. EXACT FILE LIST TO CREATE

### 2a. KB engine + grader (under `kb/` of this repo's KB workspace)
NEW unless marked EDIT. All generalize the proven Cognitum prototype; mechanics preserved, repo-shape becomes data.

| File | New/Edit | Purpose | Binding |
|---|---|---|---|
| `kb/kb.config.mjs` | NEW | Config registry; AHG target entry (repoDir, scopeExclude, codeExt/fullTextExt/templateExt, componentRoots, componentWord synonym, productNames, primerSlugs:auto, include rules, 7 verificationQueries, bundle blurb/questions) | D10, A |
| `kb/build-kb.mjs` | NEW | Generic config-driven corpus builder (replaces `build-ruview-kb.mjs` + `.build-ruvector-kb/build.mjs`); reads `config.include` rules | D5 |
| `kb/corpus-rules.mjs` | NEW | Rule-type impls: `mdSweepFullText`, `componentManifests`, `componentLead`, `sourceBodies`, `docCommentSweep`, `literalFiles`, `htmlText`, `templates` | D5 |
| `kb/build-big-variant.mjs` | EDIT | STORES ← config registry; bge-768 cls re-embed of SAME passages | D2, F |
| `kb/ask-kb.mjs` | EDIT | Per-store metaName/primerSlugs/productNames/componentRoots/componentWord/disambiguation/offtopicMagnets from config; "crate"→"component" synonym group injected into intent regexes | D2 |
| `kb/guard-check.mjs` | EDIT | STORES + guardQuery ← config; parity + anti-truncation + live-query | D6, D |
| `kb/index-primer.mjs` | EDIT | STORES + primerPath/chunkStyle ← config; appends `PRIMER#` orientation docs preserving reconcile | INV-08 |
| `kb/kb-mcp-server.mjs` | EDIT | enum + serverName + toolDescription ← config | D13 |
| `kb/make-bundles.mjs` | EDIT | BUNDLES + canon/release URLs ← config | D7, H |
| `kb/resolve-deps.mjs` | EDIT | `configureModel(T, cache, modelName)` parameterized so big-variant cache check works | — |
| `kb/grade-kb.mjs` | NEW | Dual-metric grader (M1 retrieval + M2 correctness), per-stage + overall 0–100, exit 1 below threshold; generalizes `_probe-eval.mjs` | D15-A, §6 |
| `kb/gate.mjs` | NEW | build→guard→grade→diagnose(R/C/O)→fix→re-grade orchestrator, iteration cap ≤5, persists loop state to `ruflo memory` | D15, I |
| `kb/questions/agent-harness-generator.tuned.jsonl` | NEW | ~21–28 Q (3–4/stage) with `wantPaths`+`mustContain`+`forbidden` | D15-A |
| `kb/questions/agent-harness-generator.heldout.jsonl` | NEW | disjoint ~21 Q, never consulted while tuning (overfit-proof) | D15-A |
| `kb/package.json` | EDIT | generic `build`/`build:big`/`guard`/`grade`/`gate` scripts taking `--target` | — |
| `kb/stores/agent-harness-generator/agent-harness-generator-primer.md` | NEW | 7 `##` sections = 7 arc stages, synthesized from OVERVIEW/ARCHITECTURE/ADR-003/README | INV-08 |
| `kb/stores/agent-harness-generator/*-kb.small.rvf` | BUILD | 384-dim MiniLM HNSW | D2, F |
| `kb/stores/agent-harness-generator/*-kb.big.rvf` (+`.embed.json`) | BUILD | 768-dim bge-base, SAME passages | D2, F |
| `kb/stores/agent-harness-generator/*-kb.passages.jsonl` | BUILD | full untruncated chunk text, shared | D13 |
| `kb/stores/agent-harness-generator/*-kb.ids.json` + `.idmap.json` | BUILD | per-id kind/preview + store-internal map | — |
| `kb/.last-built.json` + `kb/SOURCE.json` | BUILD | provenance (HEAD sha, build date, models) | D8, E |

No new npm deps — reuse pinned `@ruvector/rvf` ^0.2.2 + `@xenova/transformers` ^2.17.2 (both MiniLM-384 and bge-768 download via transformers.js). `close()` is the only RVF persist path.

### 2b. ExplainerSite (repo `ruv-explainer-agent-harness-generator/`)
```
ruv-explainer-agent-harness-generator/
├── index.html                # single page; 9 collapsible numbered sections
├── styles.css                # foundry/mint tokens (NO cyan), @font-face, prefers-reduced-motion
├── main.js                   # <6KB: collapsibles + drag-to-mint + drop-in drag (click/kbd fallback)
├── vercel.json               # cleanUrls, /assets cache, zip Content-Type
├── package.json              # metadata only — "scripts": {} — NO build, NO deps
├── README.md
├── .gitignore                # binaries/bundles gitignored  [H]
├── favicon.svg               # hand-authored stamped 'MH' coin
├── robots.txt
├── assets/img/               # G1 hero-stamp · G2 mint-factory-line · G3 model-router-cost-curve
│                             # · G4 darwin-loop · G5 one-download-two-halves · G6 og-card (1200×630)
├── assets/fonts/             # BigShouldersDisplay-{SemiBold,Black} · IBMPlexSans-{Regular,Medium}
│                             # · IBMPlexMono-Regular  (all woff2, self-hosted)
└── downloads/
    └── metaharness-dropin.zip  # the AI half (4 files: .mcp.json · CLAUDE.md gate · README · .claude/settings.json)
```

### 2c. Drop-in Smart Zip contents [D13] — `kb/` folder, two halves, self-contained + runnable
```
metaharness-dropin/  (zipped)
├── README                                  # bundle root
├── manifest.json                           # provenance + gate evidence  [I]
├── for-ai/
│   ├── agent-harness-generator-kb.big.rvf      # 768-dim  [F]
│   ├── agent-harness-generator-kb.small.rvf    # 384-dim  [F]
│   ├── agent-harness-generator-kb.passages.jsonl
│   ├── ask-kb.mjs                              # single retrieval brain
│   ├── kb-mcp-server.mjs                       # MCP server exposing the KB
│   └── summary                                 # notebook/KB summary
└── for-humans/
    ├── agent-harness-generator-primer.md       # the MetaHarness primer markdown
    └── (optional NotebookLM media)             # enhancement only, layered after  [D14]
```
Requirement: `npm i` + a real query → grounded answer. The site's `downloads/metaharness-dropin.zip` is the agent-install convenience copy (.mcp.json + CLAUDE.md gate); the full Smart Zip ships on the GitHub Release [H].

### 2d. Workflows + config
| File | Purpose | Binding |
|---|---|---|
| `.github/workflows/daily-bump.yml` | Change-based poll; `gh workflow run` dispatch only if upstream SHA moved; token `actions: write` | B |
| `.github/workflows/rebuild-kb.yml` | small (384) auto rebuild + guard + bundle + publish; build/guard BEFORE publish; commit step `git pull --rebase --autostash` + retry ×3 | C, D, F |
| `.github/workflows/rebuild-kb-big.yml` | manual `workflow_dispatch` 768-dim rebuild (CI cost) | F |
| `config/repos/agent-harness-generator.json` | per-target config (submodule/clone url, embed_models, exclude_paths, notebook_id) — mirrors `kb.config.mjs` AHG entry | D10 |

---

## 3. THE SELF-EVALUATING QUALITY GATE — how it runs, how we iterate to ≥98 [D15, §6]

`Score = weighted combine of (A) + (B) + (C). Done = (A)+(B)+(C) all green AND Score ≥ 98 AND evidence recorded in manifest.` [§6, I]. The gate runs on the REAL artifacts (real `.rvf`, rendered site, real `.mcp.json` dry-run) — PROVE, don't assert [E].

### (A) KB Answer-Quality Grading — dual metric, tuned + held-out [D15-A]
- Query the **real `.rvf` BOTH variants** (small + big) through the **same `searchKb()`** the CLI/MCP use (grade the real door).
- **Tuned set** (used while tuning the reranker) + **held-out set** (never consulted during tuning → overfit-proof).
- **M1 retrieval relevance (0–1):** `0.6·[top-1 path ∈ wantPaths] + 0.4·[any top-k ∈ wantPaths]`.
- **M2 answer correctness/completeness (0–1):** assemble top-k full docs (the `fullText` ask-kb returns); `coverage = |mustContain ∩ answer| / |mustContain|`; `M2 = clamp(0.85·coverage + 0.15·niceToHave − 0.5·penaltyFrac, 0, 1)`. `forbidden` tokens (proposal-as-reality, wrong product, invented API) → penalty. Deterministic, offline, CI-repeatable — primary grader.
- **Optional held-out judge tier:** route (question, assembled answer, source passages) to `mcp__ruflo__agent_execute` for an LLM correctness cross-check — used to CROSS-CHECK the deterministic score, **never to inflate** it [Rule 9].
- **Per-question** = `100·(0.4·M1 + 0.6·M2)`; **stage** = mean; **overall** = mean. **Gate A passes when overall ≥98 AND every stage ≥95 on BOTH sets.**
- Never ship an un-graded KB [INV-09 — un-graded RVFs cost 4–5 regen cycles].

### The fail-below-98 → diagnose → rebuild → re-grade loop (`gate.mjs`)
1. build small → index primer → build big → **guard** (hard gate; any FAIL aborts) [D6].
2. grade tuned + held-out. Both pass thresholds → write `.last-built.json` + `SOURCE.json` → continue to bundle.
3. else **diagnose each failing question into one bucket** (the actionable output):
   - **R-fail** (wrong doc, M1 low): retrieval/reranker → add `disambiguation`/`offtopicMagnet`/`primerSlug` route or `componentRoots` fix in `ask-kb` config. **No rebuild.**
   - **C-fail** (right doc, M2 low — fact missing from corpus): ingestion gap → add/adjust an `include` rule (e.g. a package README un-swept, a `.ts` body out of `sourceInScope`) → **rebuild that store.**
   - **O-fail** (orientation/synthesis gap): thin/missing primer section → edit the arc-stage section of `agent-harness-generator-primer.md` → re-run `index-primer`.
4. apply smallest fix for dominant bucket → re-grade. Loop ≤5 iterations; log per-iteration per-stage delta; persist loop state to `ruflo memory` between iterations (survives compact).

### Question-set outline — 3–4 per arc stage, both sets (verify each fact exists in source BEFORE authoring) [risk: 98 + deterministic M2 ⇒ `mustContain` must be from verified text, not guessed]
The 7 arc stages map 1:1 onto the prototype archetype machinery; Stage 4 doubles as coverage of the repo's OWN composer 7-stage flow (ADR-003).

| # | Arc stage | Sample Q (tuned) | `wantPaths` | `mustContain` (verified facts) |
|---|---|---|---|---|
| 1 | What is it | "What is metaharness?" | `README.md`,`docs/OVERVIEW.md` | "factory for agent frameworks", "harness is the product", "npx metaharness" |
| 2 | Capabilities | "What can the tool do to a repo?" | `README.md`,`docs/USAGE.md` | "score", "genome", "mcp-scan", "threat-model", "sign/verify witness", "router", "Darwin" |
| 3 | Inventory/components | "What packages make up metaharness?" | `packages\|crates`,`docs/ARCHITECTURE.md` | "kernel", "host-claude-code", "router", "darwin", three-layer |
| 4 | How each works (composer) | "How does the composer scaffold a harness?" | `docs/adrs/ADR-003`,`docs/ARCHITECTURE.md` | composer 7 stages (Identity→Hosts→Primitives→Agents→Skills→Plugins→Features), default-deny MCP |
| 5 | Maturity | "Is this production-ready?" | `README.md`,`docs/USERGUIDE.md` | "v0.1.x beta", tests passing, "never executes your code", honest caveats |
| 6 | Docs/where things live | "Where do I read about the architecture?" | `docs/ARCHITECTURE.md`,`docs/adrs/` | ARCHITECTURE.md, OVERVIEW.md, USERGUIDE.md, ADR index |
| 7 | End-to-end usage | "How do I start the fastest?" | `README.md`,`docs/USAGE.md` | "npx metaharness --wizard", "--template", "--host", "npm install", "npx my-bot --help" |
Held-out = disjoint phrasings of the same 7 stages (e.g. "mint a bot for my repo", "is this zip safe to run?", "cut my model bill") with their own verified `wantPaths`/`mustContain`. `forbidden` examples: surfacing a Proposed ADR as reality; "9 hosts" stated as long-stable (it's 6 stable + Copilot/OpenCode/GitHub-Actions newer); test count asserted as a single fixed number (568 vs 605 doc lag).

### (B) Site Comprehension Audit [D15-B, INV-10]
- Render the site locally. An **independent reviewer agent** (`mcp__ruflo__agent_execute`) role-plays the **NonTechnicalClaudeCodeUser** [M] and reads the RENDERED site.
- Reviewer MUST: **state what it is**, **name 3 concrete uses**, **recite the exact first command** (`npx metaharness --wizard`), and **confirm every hard concept has a visual** (G1–G6 cover hero/mint-line/cost-curve/darwin/two-halves).
- Scores **clarity / compelling / ease (1–5 each)** + `arcStagesCovered` + `reviewerVerdict` → `AuditResult`.
- Below ClarityRubric bar → **revise → re-audit** loop.

### (C) Consistency & Completeness + Drop-in dry-run [D15-C]
- Claims **grounded in source — NO invented APIs** (every on-page command traces to README/USAGE; the `metaharness`/`create-agent-harness` alias is stated, not hidden).
- **All 7 arc sections present** (01–07); **≥5 full use cases** (08 gallery, each situation→command→does→get→visual) [J, INV-11]; **links resolve**.
- **Drop-in dry-run:** `unzip metaharness-dropin.zip`; load `.mcp.json`; run the confirm-it-works query → grounded answer. Full Smart Zip: `npm i` in `for-ai/` + a real `ask-kb.mjs` query → grounded answer [D13].

### (D) NotebookLM Studio-Output Grading [D18, gate D, INV-14, N]
- P12 builds the studio set in its OWN NotebookLM notebook (sources = the canonical content + key repo docs via `nlm source add`). Each artifact (audio overview via `nlm audio create`, report, + video/slides where the UI allows) is produced by an **OptimizedStudioPrompt** explicitly tuned for clarity / understanding / intention / education / comfort / confidence.
- **Grade the OUTCOME, not the run:** read the report / transcribe the audio+video; grade completeness + effectiveness — does it actually teach a true beginner? Below bar → refine the prompt → regenerate → re-grade. Save each optimized prompt per repo (reusable + auditable).
- Studio layers AFTER the heroes pass (A)+(B)+(C) + ≥98, but it carries its own bar.

### (E) Visual-Asset Grading [D19, gate E, INV-15, O]
- After P5 generates G1–G6, **each graphic gets a vision check** (a reviewer inspects the rendered PNG against its intended concept/caption), scoring clarity, communicative effectiveness, friendliness, approachability. Below bar → refine the image-generation prompt → regenerate → re-grade; save the prompts beside the assets.
- Constraint **O** spans P4 copy + P5 imagery: plain-language, human-problem-first, no jargon walls — the page must read approachable to a non-technical Claude-Code user.
- **The repo is fully done only when (A)+(B)+(C)+(D)+(E) are all green.**

### Score → ≥98 [§6]
Compute 0–100 from (A)+(B)+(C). All three green AND ≥98 → "done". Evidence (per-stage KB scores both sets, AuditResult, consistency checklist, dry-run transcript) recorded in `manifest.json` and surfaced. Below 98 → loop the relevant gate. Honest scoring per Rule 9: list each deduction with evidence; known doc-lag flaws (568 vs 605, 6 vs 9 hosts) are disclosed on-page as honest limits, not hidden.

---

## 4. RISKS + how the plan satisfies Operating Constraints A–M

### Top risks (with mitigation)
1. **"crate" hard-coded across `ask-kb.mjs` intent layers** (FIX A/C/D, archetypes, `crateTokenSet`). AHG is npm-package-based (`packages/<name>`, not `crates/<name>`). Shallow synonyming → Stage-3/4 retrieval under-fires. **Mitigation:** treat the `componentWord` synonym group (`crate|package|module|component`) as a first-class config knob injected into every intent regex; verify Stage-3/4 retrieval explicitly in gate A.
2. **`.tmpl` templates (294 files)** are the bulk of "what does a generated harness contain" but are neither prose nor runnable source. **Mitigation:** index first-40-lines + path as `kind:'template'`; Stage-4/7 fact coverage may depend on them — decided IN, not skipped.
3. **≥98 with deterministic M2 is a very high bar.** `mustContain` lists guessed (not from verified source) → false C-fails. **Mitigation:** author every `mustContain` token from text actually read in the repo; budget the question-set curation as the real work of gate A; held-out set prevents reranker overfit.

Secondary risks: NotebookLM availability (P12 is decoupled, never blocks [D14]); `@ruvector/rvf` `close()` semantics (pin ^0.2.2); CI minute budget for big variant (manual dispatch only [F]); doc inconsistencies in the source repo (disclosed as honest limits, never asserted as a single fact).

### Constraint A–M satisfaction (one line each)
- **A — Scope boundary:** clone ONLY `agent-harness-generator`'s own tree; read `.gitmodules` (confirmed ABSENT → force-walk no-op, the intended case); `scopeExclude=[node_modules,target,dist,build,.git,pkg,.next,coverage,.vite]`; never index a vendor tree.
- **B — Evergreen triggering:** `daily-bump.yml` polls upstream SHA (`git diff --quiet`); dispatches rebuild only on change via explicit `gh workflow run`; token has `actions: write` — never relies on `on: push`.
- **C — Concurrency on commit:** every CI commit step does `git pull --rebase --autostash` then push with retry ×3.
- **D — Fail-safe ordering:** P10 workflows build+guard BEFORE publish; guard red = stop; a broken rebuild never clobbers the live Release.
- **E — Prove-it, never assert:** gates run on real `.rvf`/rendered site/real `.mcp.json` dry-run; P9 post-deploy hits the live URL, checks fonts/images/zip-200/provenance timestamp; unverified = stated as unverified.
- **F — Two-variant tradeoff:** both small (384 MiniLM, evergreen) and big (768 bge, manual) ship in every bundle; big re-embeds the SAME passages so content can't drift; neither dropped.
- **G — Simplicity for human half:** any NotebookLM slides ship as native PDF — no OCR/conversion; the human on-ramp stays one-download-then-unzip.
- **H — Distribution split:** loose `<100MB .rvf` committed to git as source of truth; bundle zip → GitHub Release `kb-latest --clobber`; the page downloads from the Release; binaries gitignored, never in git.
- **I — Done = proven-good:** no KB/site declared done without running gate D15 and recording evidence in `manifest.json`.
- **J — Concrete use cases:** §08 Use-Case Gallery ships ≥5 FULL scenarios (situation→command→does→get→visual); capability lists / "anything you like" treated as a defect.
- **K — Distinct aesthetic per repo:** "Foundry/Mint" warm-charcoal + molten-amber/copper, Big Shoulders industrial type, explicit zero-cyan — deliberately NOT the cognitum cool-cyan reference; reusing a prior look would be a defect.
- **L — One-at-a-time until proven:** only `agent-harness-generator` is built; no batching of the top-5 until #1 scores ≥98 + owner sign-off.
- **M — Audience = non-technical Claude-Code user:** site built for exactly that persona; gate (B) reviewer role-plays them; if a true beginner can't understand and use it, the primer failed.

---

## 5. DEFINITION OF DONE — instantiated for MetaHarness [Part II DoD]
- [ ] All **7 questions** answered as ordered sections 01–07 (why-built → what-problem → why-now → how-it-solves → solved-state → how-to-implement → how-to-start) [D12].
- [ ] **≥5 full use-case scenarios** in §08, each situation→command→does→get, **each with a visual** [J, INV-11].
- [ ] **Every hard concept has a figure** (G1–G6); **sections collapse**; **distinct foundry/mint aesthetic** (zero cyan) [INV-10/12, K].
- [ ] **Smart Zip runnable**: `npm i` in `for-ai/` + a real `ask-kb.mjs` query → grounded answer; drop-in `.mcp.json` + `CLAUDE.md` gate dry-run returns a grounded answer [D13].
- [ ] **KB graded (A)** ✓ on tuned + held-out (overall ≥98, every stage ≥95, BOTH variants); **Site audited (B)** ✓ (reviewer states what-it-is + 3 uses + first command + all visuals, clarity/compelling/ease ≥ bar); **Consistent (C)** ✓ (grounded claims, all 7 stages, ≥5 use cases, links resolve, drop-in dry-run grounded) — **evidence recorded in manifest** [D15, I].
- [ ] **Score ≥ 98/100** [§6].
- [ ] **Honest limits** (v0.1.x beta; 568-vs-605 test-count doc lag; 6-vs-9 host count; router/Darwin experimental-caveat; analysis never executes code; not a chatbot/no-code) + **real provenance** (HEAD sha, build date in `.last-built.json` shown on page); **secrets gitignored** [E, H].
- [ ] **Owner sign-off on #1** (`agent-harness-generator`) BEFORE scaling to the top-5 [D16, L].
- [ ] Deployed: own GitHub repo `stuinfla/ruv-explainer-agent-harness-generator` + own Vercel site `ruv-explainer-agent-harness-generator.vercel.app` [D17].

---

## 6. Execution order (linear checklist the build runs on itself)
1. `swarm_init` + `agent_spawn` (visible IDs); recall prior state from `ruflo memory`.
2. P0: `git clone --depth 1 https://github.com/ruvnet/agent-harness-generator <ROOT>/agent-harness-generator`; record HEAD sha; confirm no `.gitmodules`; author `kb.config.mjs`.
3. P1 ∥ P2: build KB engine (generic builder + corpus rules + generalized edits + grader + gate) ∥ site skeleton + foundry tokens + fonts.
4. P3: build SMALL → write primer.md (7 `##`) → index-primer → build BIG (SAME passages) → guard-check (must PASS).
5. P4 ∥ P5: site content 01–09 + gallery + drop-in/CLAUDE.md gate + honest limits ∥ G1–G6 graphics + favicon.
6. P6a ∥ P6b: author tuned+heldout question sets → grade BOTH variants/sets → fail<98 loop; render site → independent reviewer audit → fail<bar loop.
7. P7: consistency check + assemble Smart Zip + drop-in dry-run grounded answer.
8. P8: compute score; require (A)+(B)+(C) green + ≥98; record evidence in manifest.
9. P9: git/gh repo + commit loose `.rvf` + Release bundle + `vercel deploy --prod` + PROVE-IT post-deploy checks.
10. P10: install evergreen workflows (change-based, fail-safe, concurrency-guarded).
11. P11: owner sign-off BEFORE scaling. 12. P12: NotebookLM media enhancement (decoupled).
Persist decisions + failing-question diagnoses to `ruflo memory` between gate iterations so a compact never loses loop state.
