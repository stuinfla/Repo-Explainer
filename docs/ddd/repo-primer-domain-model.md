# Repo-Primer Pipeline — Domain Model

> **Related ADR:** [`0001` — Repo-Primer Pipeline · Part I (architecture) + Part II (Explainer Site + Self-Evaluating Quality Gate)](../adr/0001-repo-primer-pipeline.md) — *one ADR ⇄ one DDD*
> **Created:** 2026-06-19 · **Last updated:** 2026-06-19
> **Status:** Accepted · Partially Implemented — core bounded contexts are ENFORCED in the prototype (RuView + ruvector); several invariants/events are MODELED (not yet in code) — see the Implementation Status legend below.
> **Version:** 1.4.0 · _(version history — aligned to ADR-0001 **v1.4.0**: **AI-comprehension is now the primary acceptance test.** Added **AICompComprehensionGate** [CC/D26] (weakest-of-8 dimensions ≥95, cross-judge + discrimination control; INV-25), **RvfLifecycleVerified** [EE/D27] (STORED/USED/TESTED/VERIFIED every build; INV-26), **CoverageGate / Gate B** [FF/D28] (indexed/authored ≥0.92, runs before Gate A; INV-27), **EnrichedForAi** [DD/D13] (ships symbols.json + dep-graph.json + entrypoints.json + embed.json + source_type-tagged passages; MCP lookup_symbol/get_entrypoints/get_dep_graph; INV-28), the 9-section primer template [D29], and `source_type` tagging + tests/examples inclusion [D5] — with §5 KnowledgeBase/ExplainerSite invariants, §6 rows, and domain events. Prior aligned to ADR-0001 **v1.3.1**: **single 384-dim desktop variant** `Xenova/bge-small-en-v1.5` — Stuart's final call per the Ruflo assessment (dimension barely matters at 2k–8k passages; bge-small is a strong retrieval model; #1 passed Gate A 99.9 on a 384 model; 768 `bge-base` is the step-up if a repo can't clear Gate A at 384); revised **INV-05** + terms + KnowledgeBase aggregate. Prior v1.3.0: single 768-dim variant. Prior aligned to ADR-0001 **v1.2.0**: added the scale-phase model — **IntelligentSiteName** [X/D17] (repo == Vercel subdomain, function-clear, `-explainer` suffix; supersedes `ruv-explainer-<repo>`), **CapacityAwareSwarm** [Y/D23] (parallel fan-out, one swarm/repo, CPU+memory-adaptive concurrency, action-first agents), **RepoBrandReconciliation** [Z/D24] (reconcile repo name vs shipped CLI/brand) — with **INV-20/21/22**, §6 rows, and ExplainerSite invariants (14)–(15). Prior aligned to ADR-0001 v1.1.1: added **image-first ordering** [W/D22] — every section/use-case/process starts with its visual FIRST, then the words; added **INV-19** + the `ImageFirstOrdering` term + §6 table row + ExplainerSite invariant (13). Prior v1.1.0: captivating Hero [D21], dual-level visuals every section [D22], differentiation [D20], scoring relaxation ≥95 under time pressure [D15]; added INV-16/17/18, Hero/DualLevelVisual/Differentiation terms, gate-D/E + felt-question events; website is a co-hero; QualityGate replaces a bare Guard; "done = proven-good").

## Implementation Status Legend

- **[ENFORCED]** — built and running in CI today (RuView + ruvector prototype).
- **[MODELED — target]** — designed and correct; not yet enforced in code. Treat as a binding contract for the generalisation effort.

> **Term name note:** `TwoPartPrimer`, `On-Ramp Surface`, and `EvergreenOrchestrator` are provisional — pending the ADR rename decision. Ubiquitous-language stability is provisional until the ADR is ratified.

---

## 1. Purpose

The **Repo-Primer Pipeline** turns under-documented "power tool" repos into a **dual-audience, evergreen explainer + proof point**:

- **Human Half** — NotebookLM Studio outputs (video, audio overview, PDF, infographics) that teach a newcomer through the seven-stage ComprehensionArc. Sources are **hand-curated** into NotebookLM — NOT derived from ForceWalk Passages.
- **AI Half** — RVF (single-file vector database) knowledge base of the repo's own code + docs + Whisper transcripts, **plus structured machine artifacts** (`symbols.json`, `dep-graph.json`, `entrypoints.json`) and `source_type`-tagged passages — letting an agent answer from the real source AND look up exact structure. The binding measure of success is the **AIComprehensionGate** (INV-25): an AI querying only this half scores ≥95 on its weakest of 8 dimensions.

Both halves derive independently from the same TargetRepo (a repo embedded inside this one as a git submodule); they converge only at Bundle & Distribution. The pipeline rebuilds automatically whenever upstream SHA changes — never unconditionally.

**Proven prototype:** RuView + ruvector, live at <https://cognitum-sensor-primer.vercel.app>. Goal: generalise to ~6 more repos.

**How to read:** §2 glossary → §3 bounded contexts → §5 aggregates → §8 invariants → §10 walkthrough.

---

## 2. Ubiquitous Language

| Term | Definition |
|------|------------|
| **TargetRepo** | The upstream repo being "primered" (e.g. `ruvector`, `RuView`). |
| **SubmodulePin** | The git commit SHA (unique snapshot fingerprint) at which a TargetRepo is checked out as a git submodule — _a repo embedded inside another_. |
| **ForceWalk** | Multi-pass traversal of a TargetRepo using distinct traversal kinds. Today: multi-kind (source-tree + deep-docs + crate-src) [ENFORCED]. Full five-strategy sweep [MODELED — target]. A single linear pass is NOT a ForceWalk. |
| **Passage** | A paragraph-sized chunk of text extracted during a ForceWalk, suitable for embedding (converting to a vector for similarity search). **[ENFORCED — v1.4.0] Each Passage carries a `source_type` tag — `src \| test \| example \| doc \| config`** — and the ForceWalk MUST include `test` + `example` passages (the best usage docs); see EnrichedForAi / D5. [MODELED — target] Each Passage will additionally carry a `sourceStrategy` tag (source/docs/api/example/changelog) and an `arcStageHint` (one of the 7 ComprehensionArc stages), enabling intent-aware retrieval and making ArcCoverage concretely assertable (≥N passages per arc stage). |
| **HumanHalf** | NotebookLM Studio outputs: video, audio overview, PDF slide deck, infographics. Hand-curated; independent of the AIHalf build path. |
| **AIHalf** | The RVF vector knowledge base built from Passages, Whisper transcripts, and summary. |
| **TwoPartPrimer** | Aggregate containing one HumanHalf + one AIHalf for a TargetRepo. Name provisional. |
| **RVF** | `.rvf` binary — a single-file vector database using HNSW (Hierarchical Navigable Small World — a graph structure for fast approximate nearest-neighbour search). Exclusive format for embeddings here. No flat JSON, no pgvector. |
| **SmallVariant** | *(legacy — revised v1.3.1)* The old 384-dim `all-MiniLM-L6-v2` KB. Superseded: the default variant is now itself 384-dim (`bge-small-en-v1.5`, a stronger retrieval model). Historical note only. |
| **KbVariant** *(default; was "BigVariant")* | **The single default RVF KB (revised v1.3.1): 384-dim `Xenova/bge-small-en-v1.5`, desktop.** One embed pass, one file, lightest. Strong retrieval model; step up to 768 `bge-base` ONLY if a repo can't clear Gate A at 384. (The "Big" name is legacy from the dual-variant era.) |
| **KnowledgeBase** | Aggregate holding the single KbVariant (384-dim bge-small) + Passages + provenance for one TargetRepo. |
| **ScopeBoundaryFilter** | ACL that strips vendored deps and nested submodules from ingestion by reading `.gitmodules`. |
| **Guard** | Post-build validation: anti-truncation, single variant present + non-zero, live-query. GuardPassed is mandatory before any publish. |
| **RefreshRun** | One rebuild cycle: trigger → ForceWalk → embed → Guard → bundle → publish. |
| **DeltaSet** | Net-new **capabilities** vs. prior SubmodulePin — computed as a diff of the public symbol set (exports, public types, CLI commands, MCP tools) between SHAs, reusing the API-export walk pass and enriched with changelog lines. NOT raw git diff or embedding novelty. [MODELED — target] |
| **Bundle** | Self-contained zip: single KbVariant RVF, Passages metadata, PrimerMarkdown, runtime tools, `SOURCE.json`. |
| **RollingRelease** | Single `kb-latest` GitHub Release, replaced in-place each successful run. |
| **Provenance** | Rebuild timestamp + upstream SHAs (AI half) in `SOURCE.json`. Always read from the real artifact — never asserted. See also `humanHalfSha` in ProvenanceMarker [MODELED — target]. |
| **On-Ramp Surface** | Static `index.html` on Vercel presenting the TwoPartPrimer with live Provenance. Name provisional. |
| **EvergreensOrchestrator** | GitHub Actions cron + `workflow_dispatch` (a CI trigger) that fires **only** on SHA change. Name provisional. |
| **ComprehensionArc** | Fixed seven stages (canonical, verbatim): 1) What is this concept? 2) What can you do with it? 3) Why was it built? 4) What problems does it solve? 5) One concrete end-to-end example. 6) 3–4 other application areas. 7) How exactly do I implement it (concrete path)? |
| **ArcCoverage** | Guard sub-check verifying all seven ComprehensionArc stages in HumanHalf + PrimerMarkdown. [MODELED — target] |
| **Published Language** | DDD relationship: upstream publishes a stable interface; downstream conforms without negotiation. |
| **Conformist** | DDD relationship: downstream adapts to upstream rather than negotiating. |
| **ACL** | Anti-Corruption Layer — translation barrier preventing an external system's concepts from polluting the domain model. |
| **ExplainerSite** | **[ADR-0001 §II]** HERO artifact #1: the visual, collapsible, imagery-rich web page that takes a NonTechnicalClaudeCodeUser from "never heard of this" to "I know exactly what to do with it." Co-equal with the KB bundle, not a by-product of NotebookLM. |
| **DropInSmartZip** | **[ADR-0001 §II; enriched v1.4.0]** HERO artifact #2: the self-contained KB bundle (single KbVariant RVF + embed.json sidecar + `source_type`-tagged passages + **`symbols.json` + `dep-graph.json` + `entrypoints.json`** + `ask-kb.mjs` (with `--symbol`/`--entrypoints`/`--deps`) + `kb-mcp-server.mjs` (with `lookup_symbol`/`get_entrypoints`/`get_dep_graph`) + the 9-section primer + README) that makes the user's *AI* instantly expert. Its acceptance test is the AIComprehensionGate (INV-25). |
| **NonTechnicalClaudeCodeUser** | **[ADR-0001 §II]** The single target persona: someone who uses Claude Code but is *not* a deep engineer. If they can't understand and use the tool from the site, the primer failed. |
| **UseCaseGallery** | **[ADR-0001 §II]** ≥5 *full* concrete scenarios on the site, each = situation → exact command(s) → what the tool does → what you get, with a visual. The cure for "what can it do?" → "anything you like." |
| **QualityGate** | **[ADR-0001 §II; expanded v1.4.0]** Expanded Guard. The checks that must pass (with recorded evidence) before done, **in order**: **CoverageGate (Gate B)** → **KB AnswerQualityGrade (A)** → **AIComprehensionGate (weakest-of-8 ≥95, the primary acceptance test)** → site ComprehensionAudit (incl. the three felt questions) → consistency/completeness → StudioOutputGraded → VisualAssetGraded — plus the **RvfLifecycle** (STORED/USED/TESTED/VERIFIED) and score ≥98 (≥95 under time pressure). "Done = proven-good." |
| **AnswerQualityGrade** | **[ADR-0001 §II]** Dual-metric grade (retrieval relevance + answer correctness/completeness vs source) of the actual `.rvf`, on tuned **and** held-out questions. Below threshold → diagnose → rebuild → re-grade. The cure for the un-graded-KB / 4–5-regeneration failure. |
| **ComprehensionAudit** | **[ADR-0001 §II]** An independent reviewer agent role-played as the NonTechnicalClaudeCodeUser reads the *rendered* site and must state what it is, name 3 concrete uses, recite the first command, and confirm every hard concept has a visual; scores clarity/compelling/ease 1–5. |
| **ClarityRubric** | **[ADR-0001 §II]** The scored bar the ComprehensionAudit applies; also the Definition-of-Done checklist in ADR-0001 §II. |
| **StudioBuildout** | **[ADR-0001 §II]** The per-repo NotebookLM notebook + its full studio set (audio overview, report, video/slides/infographics where the tooling allows). Mandatory; graded by gate (D). |
| **OptimizedStudioPrompt** | **[ADR-0001 §II]** A studio-creation prompt deliberately tuned for clarity/understanding/intention/education/comfort/confidence — saved per repo, auditable, and judged by the *outcome* it produces, not by whether it ran. |
| **GateD / StudioOutputGraded** | **[ADR-0001 §II]** The quality check that reads/transcribes each studio artifact and grades whether it actually teaches the NonTechnicalClaudeCodeUser. |
| **VisualAsset** | **[ADR-0001 §II]** A generated image/graphic (hero, concept diagram, infographic). Produced by an optimized, saved image prompt; must communicate a specific concept, not decorate. |
| **GateE / ImageGrade** | **[ADR-0001 §II]** The vision-check grade of each VisualAsset for clarity, communicative effectiveness, friendliness, and approachability + concept match. Below bar → refine prompt → regenerate → re-grade. |
| **ApproachabilityBar** | **[ADR-0001 §II]** Constraint O: copy + imagery together must read friendly/plain-language to a non-technical person — human-problem-first, terms defined in-line. Jargon walls and cold/decorative visuals fail it. |
| **HeroVisual** | **[ADR-0001 §II D21 / constraint S]** The captivating opening visual on the first screen of an ExplainerSite — the tier-1 on-ramp metaphor paired with the resonance lead sentence. Its job: grab a non-technical newcomer at a glance and make them want to read on. A text-only or generically-decorated hero is a defect. |
| **DualLevelVisual** | **[ADR-0001 §II D22 / constraint T]** The required pairing in *every* section: (1) a precise **technical SVG** diagram (true-to-source architecture, graded for clarity + belief) **and** (2) a simple approachable illustration (tier-1 raster on-ramp). The two-register pairing is the README-beating advantage; a single register, or a text-only section, is a defect. |
| **ImageFirstOrdering** | **[ADR-0001 §II D22 / constraint W]** The section-layout rule: every section, use-case, and process MUST start with its image/visual **first**, then the words — the visual leads, the prose follows (more approachable for a non-technical newcomer). A section that opens with text before its visual is a defect. |
| **Differentiation** | **[ADR-0001 §II D20 / constraint U]** The on-page answer to "I already use the host (Claude Code/Codex) or a big harness (e.g. Ruflo) — why this too?", paired with a before→after-on-your-own-codebase comparison. Leaving it unanswered is a defect. |
| **ResonanceLead** | **[ADR-0001 §II D20 / constraint P]** The plain, visceral opening that translates the abstraction to everyday terms and answers what-it-does / why-care / why-need / why-important, anchored by ONE named before→after persona (canonical for #1: **Maya**, `content/agent-harness-generator.resonance.md`). If the reader can still ask "but what does it DO and why would I want it?", it failed. |
| **IntelligentSiteName** | **[ADR-0001 §II D17 / constraint X]** Each ExplainerSite's deploy identity: its own public GitHub repo == Vercel subdomain, named function-clear with an `-explainer` suffix (e.g. `metaharness-explainer`). Supersedes the `ruv-explainer-<repo>` scheme; the suffix also mitigates brand-impersonation false-positives. |
| **CapacityAwareSwarm** | **[ADR-0001 §II D23 / constraint Y]** The scale-phase build unit: one parallel swarm per repo (repos 2–5), orchestrated via Ruflo, with the orchestrator monitoring CPU + memory and adapting concurrency (5 default; ↑10 if CPU<50%; ↓3 if CPU>75%; gate on compressor/swap). Agents are action-first (use tools immediately, never plan-only). |
| **RepoBrandReconciliation** | **[ADR-0001 §II D24 / constraint Z]** The site's explicit, early mapping of the GitHub repo name to the tool's shipped CLI/brand name when they differ (e.g. `agent-harness-generator` ships as `metaharness`/MetaHarness). Omitting it is a defect. |
| **BuildJournal** | **[ADR-0001 §II D25 / constraint AA]** The per-repo running record of the recipe walk — config, KB build+grade evidence, each gate's score + fixes, deploy proof (HTTP 200) — written to `docs/build-journal/<repo>.md` as the swarm progresses. The audit trail that proves the path was followed. |
| **AIComprehensionGate** | **[ADR-0001 §II D26 / constraint CC]** The PRIMARY acceptance test, graded from the AI's seat: an AI querying ONLY the DropInSmartZip scores **8 dimensions** (onboarding, what-is, architecture/elements, capabilities, usage, best-practices/gotchas, deep-dive over 3 RANDOM buried files, extensibility). Composite = the **weakest dimension, which MUST be ≥95**. Validated by a cross-judge spot-check + a discrimination control (an empty/vague context MUST score low). Script `kb/grade-ai-comprehension.mjs` + `kb/questions/<repo>.aiq.jsonl`. |
| **CoverageGate** *(Gate B)* | **[ADR-0001 §II D28 / constraint FF]** The source-coverage gate, run **before** the answer-quality gate: `indexed_source_files / authored_non_excluded_source_files ≥ 0.92` (hard fail < 0.85); ≥3 passages per crate/package/component; 20 random source files each retrievable; passage/source-file ratio ≥4.0; public-API symbols present. Answer-quality is meaningless if the deep source was never indexed. Script `kb/coverage-gate.mjs`. |
| **RvfLifecycle** | **[ADR-0001 §II D27 / constraint EE]** The four-part "is this build actually done?" check, run EVERY build for EVERY repo with journal evidence: **STORED** (valid persisted `.rvf`, embed.json sidecar matches the model, parity, no truncation), **USED** (`ask-kb` + MCP retrieve from the SHIPPED `.rvf`; structured lookups work), **TESTED** (CoverageGate → AnswerQualityGrade → AIComprehensionGate, in that order), **VERIFIED** (dry-run from the SHIPPED zip; served md5 == local md5; live URL HTTP 200). *"None of these steps are done until each is tested and verified."* |
| **StructuredForAiArtifacts** | **[ADR-0001 §II D13 / constraint DD]** The exact-lookup machine files shipped in `for-ai/` beyond the `.rvf`: `<repo>-symbols.json` (symbol→signature→location), `<repo>-dep-graph.json`, `<repo>-entrypoints.json` (build/test/run/install), the `<repo>-kb.rvf.embed.json` sidecar, and `source_type`-tagged passages. The MCP server (`kb-mcp-server.mjs`) exposes `lookup_symbol` / `get_entrypoints` / `get_dep_graph`; `ask-kb` gains `--symbol`/`--entrypoints`/`--deps`. A guard asserts these exist + parse before zipping. Generated by `kb/extract-symbols.mjs`, `kb/dep-graph.mjs`, `kb/entrypoints.mjs`. |
| **PrimerTemplate (9 sections)** | **[ADR-0001 §II D29]** The shipped `<repo>-primer.md` structure: §§1–7 = the ComprehensionArc, **+ §8 Extensibility** (extension points + stable-API rules, grounded in `symbols.json`) **+ §9 Performance/memory/gotchas** (real perf/memory/pitfalls from source). §§8–9 feed the AIComprehensionGate's *extensibility* and *best-practices/gotchas* dimensions. Inventing facts in any section is a defect. |
| **SourceType** | **[ADR-0001 §II D5]** The per-Passage provenance tag — `src \| test \| example \| doc \| config` — required on every Passage. Drives intent-aware retrieval (API→`src`, usage→`example`/`test`), the CoverageGate, and the AIComprehensionGate deep-dive. The ForceWalk MUST include `test` + `example` passages. |

---

## 3. Bounded Contexts

### 3.1 Source Acquisition
Tracks TargetRepos as submodules; detects upstream SHA changes; maintains SubmodulePin. Emits: `UpstreamVersionDetected`, `RefreshTriggered`. External boundary: git/GitHub APIs (ACL wrapper).

### 3.2 Human Comprehension Authoring
Produces the HumanHalf via NotebookLM. Sources are **hand-curated uploads** — independent of the KB ForceWalk path. Currently human-triggered; artifacts committed to the repo. ACL: `nlm` CLI (downloads Studio outputs via `nlm pull`; re-auths via `nlm auth --cdp`, where CDP = Chrome DevTools Protocol). External boundary: NotebookLM.

### 3.3 Knowledge Base / RVF Build
ForceWalks the TargetRepo, embeds Passages into the single RVF variant, runs the Guard. The ScopeBoundaryFilter (ACL-01) reads `.gitmodules` and excludes vendored paths before any Passage is created. Real impact: RuView over-ingested 44,083 chunks/4,135 segments before the fix; 6,772/637 after. Emits: `RepoForceWalked`, `KnowledgeBaseRebuilt`, `GuardPassed`, `GuardFailed`. Also emits `NewFunctionalityDetected` [MODELED — target].

### 3.4 Bundle & Distribution
Packages KnowledgeBase + HumanHalf into a Bundle; publishes to the RollingRelease. No publish without GuardPassed. Emits: `BundleRepublished`, `ProvenanceUpdated`. External boundary: GitHub Releases API.

### 3.5 On-Ramp Surface
Presents the TwoPartPrimer on a static Vercel page with Provenance read from `SOURCE.json` — never hard-coded. Emits: `SurfaceRefreshed`. Consumes: `ProvenanceUpdated`, `BundleRepublished`.

### 3.6 Evergreen Orchestration
Runs a daily cron; fires `RefreshTriggered` via `workflow_dispatch` **only** when the TargetRepo SHA has moved. Owns RefreshRun lifecycle, SHA-change detection, failure/retry. Consumes: `UpstreamVersionDetected`.

---

## 4. Context Map

```
         ┌─────────────────────────────────────────┐
         │       Evergreen Orchestration            │
         │  daily cron → fires ONLY on SHA change  │
         └────┬────────────────────────┬────────────┘
              │ RefreshTriggered       │ consumes UpstreamVersionDetected
              ▼                        ▼
  ┌──────────────────┐     ┌───────────────────────┐
  │ Source Acq.      │─PL─▶│ KB / RVF Build        │
  │ (submodule pin)  │     │ (ForceWalk + embed)   │
  └──────────────────┘     └──────────┬────────────┘
   upstream/downstream                │ GuardPassed
   (KB Build conforms)                ▼
  ┌──────────────────┐     ┌───────────────────────┐
  │ Human Authoring  │────▶│ Bundle & Distribution │
  │ (NLM / nlm CLI) │     │ (zip + RollingRel.)   │
  │ INDEPENDENT of  │     └──────────┬────────────┘
  │ KB ForceWalk    │               │ BundleRepublished
  └──────────────────┘               ▼
                          ┌───────────────────────┐
                          │ On-Ramp Surface       │
                          │ (Vercel static page)  │
                          └───────────────────────┘
```

| Upstream | Downstream | Type |
|----------|-----------|------|
| Source Acquisition | KB / RVF Build | Published Language |
| Source Acquisition | Evergreen Orchestration | Conformist |
| KB / RVF Build | Bundle & Distribution | Customer / Supplier (GuardPassed = contract) |
| Bundle & Distribution | On-Ramp Surface | Published Language |
| Human Authoring | Bundle & Distribution | Conformist |
| NotebookLM (ext.) | Human Authoring | ACL (nlm CLI) |
| TargetRepo FS (ext.) | KB / RVF Build | ACL (ScopeBoundaryFilter) |

---

## 5. Aggregates & Aggregate Roots

### 5.1 TwoPartPrimer
**Root.** One per TargetRepo. Contains: `HumanHalf` entity (Studio files, hand-curated, independent of ForceWalk); `AIHalf` entity (reference to KnowledgeBase); `ComprehensionArc` value object (seven stages, immutable); `ArcCoverage` value object [MODELED — target]; `PrimerMarkdown` value object (replaced each run).

Invariants: (1) Both HumanHalf and AIHalf must be non-empty before distribution. (2) ComprehensionArc order is fixed; reordering requires a `ComprehensionArcRevised` event.

### 5.2 KnowledgeBase
**Root.** One per TargetRepo. Contains: the single **384-dim** RVF variant (`Xenova/bge-small-en-v1.5`, desktop; originating SHA in ProvenanceMarker — revised v1.3.1; step up to 768 `bge-base` only if a repo can't clear Gate A at 384); `PassageSet` entity (scope-filtered Passages, replaced per ForceWalk — **each Passage carries a `source_type` tag**, v1.4.0); `GuardStatus` value object `{ status: "passed"|"failed"|"pending", checkedAt, details }`. Also: `ScopeBoundarySpec` value object (from `.gitmodules`); `EmbeddingConfig` value object `{ model, dims }`; **`EmbedSidecar` value object** (`<repo>-kb.rvf.embed.json` — must match the embedding model so `ask-kb` doesn't silently fall back to MiniLM); **`StructuredForAiArtifacts` value object** (`symbols.json` + `dep-graph.json` + `entrypoints.json`); **`CoverageReport` value object** `{ indexedRatio, perComponentPassages, randomSpotChecks, passageRatio, publicApiPresent }` (v1.4.0).

Invariants: (1) PassageSet contains ONLY own-tree Passages — no excluded paths. **[ENFORCED]** (2) GuardStatus must be "passed" before handing to Distribution. **[ENFORCED]** (3) The single 384-dim `bge-small-en-v1.5` variant is the target design (dual-variant retired); step up to 768 `bge-base` only if a repo can't clear Gate A at 384. **[MODELED — target]** _(the prototype used the superseded dual-variant approach)_ (4) `EmbeddingConfig.dims` must match actual `.rvf` dimension count. **[ENFORCED]** (5) **Every Passage carries a `source_type` tag (`src|test|example|doc|config`); `test`+`example` passages are included where the repo has them (INV-28/D5).** **[MODELED — target]** (6) **`EmbedSidecar` is present and matches the embedding model — no silent MiniLM fallback (INV-26).** **[MODELED — target]** (7) **`StructuredForAiArtifacts` (symbols/dep-graph/entrypoints) exist + parse before zipping (INV-28).** **[MODELED — target]** (8) **CoverageReport must clear the CoverageGate (indexedRatio ≥0.92, fail <0.85) BEFORE the AnswerQualityGrade runs (INV-27).** **[MODELED — target]**

### 5.3 SourceRepo
**Root.** One per submodule. Contains: `SubmodulePin` value object `{ path, sha, pinnedAt }`; `ExclusionList` value object (parsed `.gitmodules`); `UpstreamTracker` entity (holds last-known UpstreamSHA).

Invariants: (1) SubmodulePin.sha must match checked-out HEAD at ForceWalk start. **[ENFORCED]** (2) ExclusionList re-read from `.gitmodules` each run; never cached. **[ENFORCED]**

### 5.4 RefreshRun
**Root.** One per trigger. Contains: `RunId` value object; `TriggerSource` value object (schedule/manual/upstream-detected); `ForceWalkManifest` entity (strategies + outcomes — today: source-tree, deep-docs, crate-src [ENFORCED]; full five-strategy sweep [MODELED — target]); `DeltaSet` entity [MODELED — target]; `Outcome` value object `{ status: "success"|"failed"|"partial", failedAt }`.

Invariants: (1) Multi-kind ForceWalk must complete before embedding. **[ENFORCED]** Full five-strategy sweep required before generalisation ships. **[MODELED — target]** (2) DeltaSet must be computed before emitting `NewFunctionalityDetected`. **[MODELED — target]** (3) Failed run must not trigger BundleRepublished; prior Distribution stays live. **[ENFORCED]**

### 5.5 Distribution
**Root.** One live per TargetRepo. Contains: `Bundle` entity (zip archive with KB variant, Passages metadata, PrimerMarkdown, runtime tools, SOURCE.json); `RollingReleaseAsset` entity (kb-latest tag, replaced atomically); `ProvenanceMarker` value object `{ builtAt, targetRepoSha, kbVariantSha, primerSha, humanHalfSha [MODELED — target] }`. `humanHalfSha` records the TargetRepo SHA the hand-authored HumanHalf was produced against; when a material DeltaSet is detected and `humanHalfSha ≠ targetRepoSha`, the system raises a "human half may be stale — re-author" flag.

Invariants: (1) Bundle contains exactly one KbVariant RVF (384-dim `bge-small-en-v1.5`); dual-variant bundles are retired. **[MODELED — target]** _(prototype shipped dual variants; single-variant generalized build not yet implemented)_ (2) ProvenanceMarker read from SOURCE.json — never hard-coded. **[ENFORCED]** (3) RollingReleaseAsset replaced atomically (new upload complete before old deleted). **[ENFORCED]**

### 5.6 ExplainerSite  **[ADR-0001 §II — MODELED, target]**
**Root.** Hero artifact #1; one per TargetRepo. Contains: `HeroVisual` value object (the captivating opening visual + resonance lead — D21); `ResonanceLead` value object (plain-language stakes + named before→after persona — D20); `ArcSectionSet` entity (the 7 ordered sections — why-built / what-problem / why-now / how-it-solves / solved-state / how-to-implement / how-to-start); `SectionFigurePair` value object per section (the **DualLevelVisual**: one technical SVG diagram + one approachable illustration — D22); `UseCaseGallery` entity (≥5 full concrete scenarios, each a collapsible item with its own figure); `DifferentiationBlock` value object (the "why this vs what I already have?" answer + before→after-on-your-own-codebase comparison — D20); `FigureSet` entity (every generated graphic, each carrying its tier — tier-1 raster on-ramp or tier-2 explanatory SVG); `AestheticTheme` value object (per-repo visual identity — distinct, not cloned); `ProvenanceAttributionBlock` value object (author Reuven Cohen/@ruvnet + source-repo link + live date+version+sha — D12/constraint Q); `DropInSection` value object (annotated file-tree of the real zip contents + exact 3-step setup + confirm-it-works query — D13); `AuditResult` value object `{ clarity, compelling, ease (1–5 each), arcStagesCovered, feltImpress, feltInvite, feltWant, reviewerVerdict }`.

Invariants: (1) HeroVisual present and captivating — a text-only/generic hero fails (INV-16). (2) All 7 ArcSections present before publish. (3) Every section carries a DualLevelVisual (technical SVG + approachable illustration) — no text-only or single-register section (INV-17). (4) UseCaseGallery ≥5 full scenarios, each with its own visual — a capability list does not satisfy it. (5) Educational sequencing: grounding example → gallery → implement (R). (6) ResonanceLead present (INV-18). (7) DifferentiationBlock present when an adjacent tool plausibly overlaps (INV-18). (8) AestheticTheme is distinct from every prior ExplainerSite. (9) ProvenanceAttributionBlock present (INV-06 extends to the site). (10) DropInSection visual shows the real file-tree, not an abstract picture (D13). (11) ComprehensionAudit (AuditResult) must pass the ClarityRubric — including all three FELT questions = "yes" — before publish (INV-10). (12) Built for exactly one persona: NonTechnicalClaudeCodeUser. (13) Every section, use-case, and process is laid out **image-first** — its visual comes before its prose (INV-19); a section that opens with text before its visual is a defect. (14) Deploys under an **IntelligentSiteName** — own public GitHub repo == Vercel subdomain, function-clear + `-explainer` suffix, public (no `ssoProtection`), HTTP-200 verified (INV-20). (15) If the repo name ≠ the shipped CLI/brand name, the site carries a **RepoBrandReconciliation** — explicit, early (INV-22).

---

## 6. Entities vs. Value Objects

| Name | Type | Key note |
|------|------|----------|
| TwoPartPrimer | Aggregate Root | Identity = TargetRepo slug |
| HumanHalf | Entity | Identity = TargetRepo + build date |
| AIHalf | Entity | Reference to KnowledgeBase |
| KnowledgeBase | Aggregate Root | Long-lived; rebuilt but not replaced |
| KbVariant | Entity [MODELED] | Single 384-dim bge-small RVF; replaced each RefreshRun. Supersedes SmallVariant+BigVariant. |
| PassageSet | Entity | Identity = (TargetRepo, SubmodulePin.sha) |
| UpstreamTracker | Entity | Holds mutable lastKnownSHA |
| SourceRepo | Aggregate Root | Identity = submodule path |
| ForceWalkManifest | Entity | Mutable during a run |
| DeltaSet | Entity [MODELED] | Immutable after computation |
| RefreshRun | Aggregate Root | Terminal after Outcome set |
| Distribution | Aggregate Root | One live per TargetRepo |
| Bundle | Entity | Replaced per successful run |
| RollingReleaseAsset | Entity | Replaced in-place |
| SubmodulePin | Value Object | Equality = SHA |
| ExclusionList | Value Object | Equality = set of excluded paths |
| ComprehensionArc | Value Object | Fixed 7-stage sequence |
| ArcCoverage | Value Object [MODELED] | Set of covered stages |
| PrimerMarkdown | Value Object | Equality = file content |
| ScopeBoundarySpec | Value Object | Derived from ExclusionList |
| EmbeddingConfig | Value Object | `{ model, dims }` |
| GuardStatus | Value Object | `{ status, checkedAt, details }` |
| ProvenanceMarker | Value Object | `{ builtAt, targetRepoSha, kbVariantSha, primerSha, humanHalfSha [MODELED] }` |
| TriggerSource | Value Object | Enum |
| Outcome | Value Object | Set once; immutable |
| ExplainerSite | Aggregate Root [MODELED] | Identity = TargetRepo slug; hero artifact #1 |
| ArcSectionSet | Entity [MODELED] | The 7 ordered sections |
| UseCaseGallery | Entity [MODELED] | ≥5 full collapsible scenarios |
| FigureSet | Entity [MODELED] | Each figure tagged tier-1 raster / tier-2 SVG |
| HeroVisual | Value Object [MODELED] | Captivating opening visual + resonance lead [D21] |
| DualLevelVisual / SectionFigurePair | Value Object [MODELED] | Technical SVG + approachable illustration per section [D22] |
| ImageFirstOrdering | Value Object [MODELED] | Section-layout rule: visual first, then prose [W/D22] |
| IntelligentSiteName | Value Object [MODELED] | Own repo == Vercel subdomain, function-clear + -explainer suffix [X/D17] |
| CapacityAwareSwarm | Orchestration policy [MODELED] | Parallel swarm/repo; CPU+mem-adaptive concurrency; action-first [Y/D23] |
| RepoBrandReconciliation | Value Object [MODELED] | Reconcile repo name vs shipped brand [Z/D24] |
| BuildJournal | Entity [MODELED] | Per-repo recipe-walk record at docs/build-journal/<repo>.md [AA/D25] |
| ResonanceLead | Value Object [MODELED] | Plain stakes + named before→after [D20] |
| DifferentiationBlock | Value Object [MODELED] | "Why this vs what I have?" + before→after-on-your-codebase [D20] |
| ProvenanceAttributionBlock | Value Object [MODELED] | Author/@ruvnet + repo link + live date+version+sha [Q] |
| DropInSection | Value Object [MODELED] | Real file-tree + 3-step setup + confirm query [D13] |
| AestheticTheme | Value Object [MODELED] | Distinct per repo [K] |
| AuditResult | Value Object [MODELED] | `{ clarity, compelling, ease, arcStagesCovered, feltImpress, feltInvite, feltWant, reviewerVerdict }` |
| AIComprehensionGate | Value Object [MODELED] | Weakest-of-8-dimensions ≥95; cross-judge + discrimination control [CC/D26] |
| CoverageReport / CoverageGate | Value Object [MODELED] | `{ indexedRatio, perComponentPassages, randomSpotChecks, passageRatio, publicApiPresent }`; runs before Gate A [FF/D28] |
| RvfLifecycle | Value Object [MODELED] | STORED/USED/TESTED/VERIFIED, every build [EE/D27] |
| StructuredForAiArtifacts | Value Object [MODELED] | symbols.json + dep-graph.json + entrypoints.json [DD/D13] |
| EmbedSidecar | Value Object [MODELED] | `<repo>-kb.rvf.embed.json`; must match embedding model [EE/D27] |
| SourceType | Value Object [MODELED] | Per-Passage tag `src\|test\|example\|doc\|config` [D5] |
| PrimerTemplate | Value Object [MODELED] | 9-section primer (§§1–7 arc + §8 Extensibility + §9 Perf/gotchas) [D29] |

---

## 7. Domain Events

| Event | Status | Trigger | Key downstream |
|-------|--------|---------|----------------|
| `UpstreamVersionDetected` | [ENFORCED] | Cron finds new SHA vs. SubmodulePin | Emits `RefreshTriggered` via workflow_dispatch |
| `RefreshTriggered` | [ENFORCED] | UpstreamVersionDetected or manual dispatch | Creates RefreshRun; starts ForceWalk |
| `RepoForceWalked` | [ENFORCED] | ForceWalk strategies all complete | Embedding begins |
| `NewFunctionalityDetected` | [MODELED] | DeltaSet computed (even if empty) | On-Ramp renders delta callouts; PrimerMarkdown updated |
| `KnowledgeBaseRebuilt` | [ENFORCED] | Single 384-dim KbVariant written to disk | Guard begins |
| `GuardPassed` | [ENFORCED] | Anti-truncation + single variant present + live-query all pass; ArcCoverage [MODELED] | Distribution permitted |
| `GuardFailed` | [ENFORCED] | Any guard check fails | Run fails; prior Distribution stays live; CI alert |
| `BundleRepublished` | [ENFORCED] | Bundle uploaded to RollingRelease; requires GuardPassed same runId | Emits ProvenanceUpdated |
| `ProvenanceUpdated` | [ENFORCED] | SOURCE.json live in bundle | On-Ramp re-renders provenance |
| `SurfaceRefreshed` | [ENFORCED] | On-Ramp reloads SOURCE.json | RefreshRun.Outcome → success |
| `CoverageGatePassed` | [ADR-0001 §II — target] | CoverageGate (Gate B) confirms indexed/authored ≥0.92 (fail <0.85), ≥3 passages/component, 20 random files retrievable, ratio ≥4.0, public-API present | **Gate A may now run** (coverage is the precondition); below bar → fix walk → re-index → re-cover |
| `KbAnswerGraded` | [ADR-0001 §II — target] | QualityGate (A) grades the `.rvf` on tuned + held-out Qs (only after CoverageGatePassed) | Below threshold → diagnose → rebuild → re-grade; at/above → gate (A) green |
| `AiComprehensionGraded` | [ADR-0001 §II — target] | AIComprehensionGate scores the drop-in on 8 dimensions (weakest = composite); cross-judge + discrimination control applied | Weakest <95 → enrich → fix-weakest → re-grade; weakest ≥95 + controls hold → primary acceptance test green |
| `RvfLifecycleVerified` | [ADR-0001 §II — target] | All four of STORED/USED/TESTED/VERIFIED pass with journal evidence | Build may be declared done; any one failing → not done, fix + re-run |
| `SiteComprehensionAudited` | [ADR-0001 §II — target] | Reviewer agent (NonTechnicalClaudeCodeUser) **renders & walks** the site; scores ClarityRubric **+ the three FELT questions** (impress/invite/want) | Below bar or any felt-"no" → enhance → re-audit; all pass → gate (B) green |
| `StudioOutputGraded` | [ADR-0001 §II — target] | QualityGate (D) reads/transcribes each studio artifact | Below bar → refine OptimizedStudioPrompt → regenerate → re-grade; pass → gate (D) green |
| `VisualAssetGraded` | [ADR-0001 §II — target] | QualityGate (E) vision-checks each image incl. hero + the per-section dual-level pair | Below bar → refine image prompt → regenerate → re-grade; pass → gate (E) green |
| `QualityGatePassed` | [ADR-0001 §II — target] | (A)+(B)+(C)+(D)+(E) all green; score ≥98 (≥95 under time pressure); evidence recorded in manifest | Publish permitted; primer is "done" |
| `QualityGateFailed` | [ADR-0001 §II — target] | Any of (A)/(B)/(C)/(D)/(E) below bar | Publish blocked; loop on the failing check; prior live artifact stays up |

---

## 8. Invariants & Policies

**INV-01 — Scope Boundary [ENFORCED]**
A KnowledgeBase indexes ONLY the TargetRepo's own tree. ScopeBoundaryFilter reads `.gitmodules` fresh each run, builds exclusion prefixes, skips matching files during ForceWalk, and never adds excluded Passages to PassageSet. Guard re-validates. Real impact: RuView 44,083 → 6,772 chunks after fix.

**INV-02 — Guard-Before-Publish [ENFORCED]**
No BundleRepublished without GuardPassed for the same runId. GuardFailed blocks unconditionally. Guard checks today: anti-truncation, single variant present + non-zero, live-query.

**INV-03 — Multi-Pass ForceWalk [ENFORCED / MODELED]**
Minimum today [ENFORCED]: source-tree + deep-docs + crate-src. Full target [MODELED — target]: add `public-api-exports`, `examples`, `changelog`. Full sweep required before generalisation to new repos. Guard checks ForceWalkManifest completeness against whichever set is current.

**INV-04 — Delta Computation [MODELED — target]**
Every RefreshRun must compute DeltaSet (diff new SHA vs. prior SubmodulePin) before emitting `NewFunctionalityDetected`. Empty DeltaSet is valid (zero-delta); uncomputed DeltaSet is not.

**INV-05 — Single Desktop Variant, 384-dim [revised v1.3.1; supersedes "Variant Pairing"]**
Each Distribution ships **one** RVF: the **384-dim `Xenova/bge-small-en-v1.5`** desktop variant. Per the Ruflo embedding assessment, dimension barely moves retrieval at 2k–8k passages — model quality + structure-aware chunking (D5) are the levers, and `bge-small` is a strong retrieval model (#1 passed Gate A 99.9 on an even-weaker 384 model). Step a specific repo up to 768 `bge-base` ONLY if it genuinely can't clear Gate A at 384. The old "both variants present" pairing rule is retired (ADR D2/F). One embed pass, one file: lightest, fastest, simplest drop-in.

**INV-06 — Provenance is Verified Truth [ENFORCED]**
Provenance on the On-Ramp Surface is read from SOURCE.json in the live Bundle — never hard-coded. Vercel deployment fails if SOURCE.json is absent or malformed.

**INV-07 — Pin-Walk Consistency [ENFORCED]**
SubmodulePin.sha must match the checked-out submodule HEAD at ForceWalk start. Source Acquisition runs `git submodule update --init` then verifies. Mismatch aborts the run.

**INV-08 — Arc Coverage [MODELED — target]**
HumanHalf + PrimerMarkdown must cover all seven canonical ComprehensionArc stages (§2). ArcCoverage value object feeds the Guard once authoring is automated. Today: manual editorial responsibility.

**INV-09 — KB Answer-Quality Graded [ADR-0001 §II — target]**
No KnowledgeBase is "done" until QualityGate (A) grades the actual `.rvf` on tuned **and** held-out questions and both metrics (retrieval relevance + answer correctness/completeness) clear threshold. Below threshold blocks publish unconditionally. *This invariant exists because shipping un-graded RVFs cost 4–5 regeneration cycles on the prototype.*

**INV-10 — Site Comprehension Audited [ADR-0001 §II — target]**
No ExplainerSite is "done" until the ComprehensionAudit (reviewer **renders & walks the live page as a NonTechnicalClaudeCodeUser**) passes the ClarityRubric: all 7 arc stages answered, ≥3 concrete uses nameable, exact first command recitable, every hard concept visually supported, clarity/compelling/ease ≥ bar — **AND the three FELT questions all answered "yes": Does it impress me? Does it invite me in? Does it make me want to work with this tool?** Any felt-"no" = fail → enhance → re-audit until all three are "yes."

**INV-11 — Concrete Use-Case Minimum [ADR-0001 §II]**
Every ExplainerSite ships ≥5 *full* UseCaseGallery scenarios (situation → command → effect → result). A capability list or "anything you like" is a defect, not coverage.

**INV-12 — Distinct Aesthetic [ADR-0001 §II]**
Every ExplainerSite has its own AestheticTheme. Cloning a prior site's visual identity is a defect.

**INV-13 — Done = Proven-Good [ADR-0001 §II]**
`QualityGatePassed` requires (A)+(B)+(C)+(D)+(E) all green, **score ≥98 (≥95 acceptable under genuine time pressure)**, **with evidence recorded in the manifest**. Scoring is honest (global Rule 9): the real score and every deduction are reported; the relaxation never excuses a hard defect (missing hero visual, text-only section, un-graded KB, invented API). "Files exist" is not "done." Extends INV-06 (provenance is verified truth) from existence to quality.

**INV-14 — Studio Outputs Optimized, Graded, Public & Linked [ADR-0001 §II; expanded v1.3.1]**
Each repo has its own NotebookLM notebook and the **FULL** studio buildout — **audio overview + report + video + slide deck + infographic** (all CLI-scriptable via `nlm`, D14). Each artifact is produced by an **OptimizedStudioPrompt** (tuned for clarity/understanding/intention/education/comfort/confidence) and graded by reading/transcribing the real output (gate D). The notebook is made **PUBLIC** (`nlm share public`) and its public link is **surfaced prominently on the explainer site AND the README/overview** (a one-click gateway to all the media). Generic prompts, un-checked outputs, a missing artifact type, or a non-public / un-linked notebook are defects, not done.

**INV-15 — Visual Assets Graded & Approachable [ADR-0001 §II]**
Every generated image (hero, concept diagrams, infographics) is produced by an optimized image-generation prompt (saved per repo) and graded by **gate (E)** — a vision check for clarity, communicative effectiveness (does it explain its concept?), friendliness, and approachability. Combined with constraint **O**: copy AND imagery must read approachable to a non-technical person — no jargon walls, no decorative-only or cold/tech-speak visuals. Weak image → refine prompt → regenerate → re-grade. Decorative-but-uninformative images or jargon-wall text are defects.

**INV-16 — Captivating Hero [ADR-0001 §II D21 / constraint S]**
Every ExplainerSite opens with a **HeroVisual** that grabs a non-technical newcomer at a glance and makes them want to read on, paired with the ResonanceLead sentence. A text-only hero, or a generic stock decoration that explains nothing, is a defect; the hero is graded by gate (E) like every other visual. (The first screen is the difference between "I'll keep reading" and "I'll close the tab.")

**INV-17 — Dual-Level Visuals in Every Section [ADR-0001 §II D22 / constraint T]**
Every section — and every named process — carries a **DualLevelVisual**: (1) a precise **technical SVG** diagram (true-to-source, graded for clarity *and* belief/conviction) **and** (2) a simple approachable illustration (tier-1 raster on-ramp). The two-register pairing is the README-beating advantage. A text-only section is a defect; a single-register section (friendly-but-not-explanatory, or explanatory-but-cold) is also a defect — it fails gate (E) or constraint O respectively.

**INV-18 — Resonance & Differentiation [ADR-0001 §II D20 / constraints P, U]**
Every ExplainerSite carries a **ResonanceLead** (abstraction translated to plain stakes — what-it-does / why-care / why-need / why-important — anchored by ONE named before→after persona) and, when an adjacent tool plausibly overlaps (the host Claude Code/Codex, or a big harness like Ruflo), a **DifferentiationBlock** answering "why this *too*?" with a before→after-on-your-own-codebase comparison. A primer that leaves the reader asking "but what does it DO and why do I need it on top of what I have?" has failed, however polished.

**INV-19 — Image-First Section Ordering [ADR-0001 §II D22 / constraint W]**
Every section — and every use-case and every named process (e.g. the composer's 9 stages) — MUST present its image/visual **first**, then the words (**ImageFirstOrdering**): the visual leads, the prose follows it. This is the more-approachable layout for a NonTechnicalClaudeCodeUser — they meet the inviting picture before any text. A section that opens with a wall of text *before* its visual is a defect. Complements INV-16 (the Hero opens with a visual) and INV-17 (every section carries a DualLevelVisual); INV-19 fixes the *order* within each section.

**INV-20 — Intelligent, Function-Clear Deploy Name [ADR-0001 §II D17 / constraint X]**
Every ExplainerSite deploys to its own dedicated **public** GitHub repo whose name == its Vercel subdomain, named so a stranger can tell what the tool does, with an `-explainer` suffix (e.g. `metaharness-explainer`, `photonlayer-explainer`). The opaque raw repo name alone, or the superseded `ruv-explainer-<repo>` prefix, is a defect. Deployment Protection (`ssoProtection`) is disabled so the public can view, and the live domain is PROVE-IT verified (HTTP 200). The `-explainer` suffix also signals a third-party explainer, mitigating brand-impersonation false-positives (the Malwarebytes flag on #1).

**INV-21 — Capacity-Aware Parallel Swarm (Scale Phase) [ADR-0001 §II D23 / constraint Y]**
#1 is built one-at-a-time to prove the recipe (constraint L). Thereafter repos 2–5 build **in parallel, one CapacityAwareSwarm per repo**, registered through Ruflo (`swarm_init` + `agent_spawn`, cost-attributed) and executed by hands-on coding agents. The orchestrator monitors CPU + memory and adapts concurrency (5 default; ↑10 if CPU<50%; ↓3 if CPU>75%; gate on the memory compressor/swap, not "unused"). Build agents are **action-first** — they must execute with tools immediately; a plan-only agent that emits 0 tool-calls is a failure mode to design against (observed once).

**INV-22 — Repo↔Brand Reconciliation [ADR-0001 §II D24 / constraint Z]**
When a repo's GitHub name differs from the tool's shipped CLI/brand name, the ExplainerSite must reconcile them explicitly and early (e.g. repo `agent-harness-generator` ships as `metaharness`/`create-agent-harness`, branded MetaHarness). A newcomer must be able to map the repo they found to the brand the docs use; failing that is a defect.

**INV-23 — Per-Repo Build Journal [ADR-0001 §II D25 / constraint AA]**
Every repo's build writes a **BuildJournal** to `docs/build-journal/<repo>.md` as it walks the recipe — recording the config, KB build + grade (A) evidence, each gate (B/C/D/E) score and any fixes applied, and the deploy proof (live URL + HTTP 200). The journal is the audit trail that the ADR/DDD path was actually followed for that repo; a deployed primer with no journal is incomplete.

**INV-24 — Human Half Staleness Detection [MODELED — target]**
The AI half auto-refreshes on every SHA change; the hand-authored HumanHalf does not. **Known gap:** Provenance currently tracks only the AI-half SHA. When implemented: `ProvenanceMarker.humanHalfSha` records the TargetRepo SHA against which the HumanHalf was authored. On any RefreshRun where the DeltaSet is non-empty and material, the pipeline MUST compare `humanHalfSha` to the new `targetRepoSha` and raise a "human half may be stale — re-author" flag (surfaced in the On-Ramp Surface and the BuildJournal). This flag is advisory until HumanHalf authoring is automated; it is a hard block once it is.

**INV-25 — AI-Comprehension Graded (PRIMARY acceptance test) [ADR-0001 §II D26 / constraint CC — target]**
No DropInSmartZip is "done" until the **AIComprehensionGate** grades it from the AI's seat: an AI querying ONLY the drop-in scores the **8 dimensions** (onboarding, what-is, architecture/elements, capabilities, usage, best-practices/gotchas, deep-dive over **3 RANDOM buried files**, extensibility), and the **composite — the WEAKEST dimension — is ≥95.** The grade is only valid when **(a) a cross-judge spot-check** (a second, stricter judge agrees) **and (b) a discrimination control** (a deliberately-vague/empty context scores low, 0–15/100) both hold — a judge that rubber-stamps an empty context is rejected. Below 95 → enrich → diagnose weakest dim → improve → re-grade. *This is the binding measure of "the AI can fully understand and use the repo," PROVEN this session (ruqu 60.7→98, photonlayer 89→97.3/95, ruvn 98/95).*

**INV-26 — RVF Lifecycle Verified, Every Build [ADR-0001 §II D27 / constraint EE — target]**
No build is "done" until the **RvfLifecycle** passes all four parts with journal evidence, run EVERY build for EVERY repo: **STORED** (valid persisted single-file `.rvf` via `close()`; `EmbedSidecar` present + matching the model so there's no silent MiniLM fallback; passage↔id parity; no truncation), **USED** (`ask-kb` AND the MCP server retrieve from the SHIPPED `.rvf`; dims match; `lookup_symbol`/`get_entrypoints`/`get_dep_graph` + `--symbol`/`--entrypoints`/`--deps` work), **TESTED** (CoverageGate → AnswerQualityGrade → AIComprehensionGate, **in that order**), **VERIFIED** (dry-run from the SHIPPED zip — unzip → `npm i` → real query → grounded answer; served md5 == local md5; live URL HTTP 200). **None of these steps are done until each is tested and verified.**

**INV-27 — Source-Coverage Gate Before Answer-Quality [ADR-0001 §II D28 / constraint FF — target]**
No AnswerQualityGrade runs until the **CoverageGate (Gate B)** is green: `indexed_source_files / authored_non_excluded_source_files ≥ 0.92` (**hard fail < 0.85**, any repo); ≥3 passages per crate/package/component; 20 random source files each retrievable via `ask-kb`; passage/source-file ratio ≥4.0; public-API symbols present. Answer-quality on a KB that never indexed the deep source is a false pass; coverage is the precondition. Below bar → fix the walk (missing pass / over-aggressive exclude / truncation) → re-index → re-cover.

**INV-28 — Enriched for-ai/ Contract [ADR-0001 §II D13 / constraint DD — target]**
Every DropInSmartZip's `for-ai/` half ships, beyond the `.rvf`: **`<repo>-symbols.json`** (exact symbol→signature→location), **`<repo>-dep-graph.json`**, **`<repo>-entrypoints.json`** (build/test/run/install), the **`<repo>-kb.rvf.embed.json` sidecar**, and **`source_type`-tagged passages** — and the MCP server exposes **`lookup_symbol` / `get_entrypoints` / `get_dep_graph`** (with matching `--symbol`/`--entrypoints`/`--deps` on `ask-kb`). A **guard asserts all of these exist and parse before zipping.** A semantic-search-only `for-ai/` half, or an MCP server missing the structured lookups, is a defect — an AI needs exact, lookup-able structure, not just nearest-neighbor passages.

---

## 9. Anti-Corruption Layers

**ACL-01 — ScopeBoundaryFilter [ENFORCED]**
Prevents upstream vendored submodule content from polluting the KnowledgeBase. Reads `.gitmodules`, builds exclusion path set, filters ForceWalk, guards PassageSet. Evidence: RuView 44,083 → 6,772 chunks after application.

**ACL-02 — `nlm` CLI [ENFORCED]**
Isolates the domain from NotebookLM's session model. `nlm pull` downloads Studio outputs; `nlm auth --cdp` re-authenticates via a running Chrome session (CDP = Chrome DevTools Protocol). Domain receives files in `studio/` only — never calls NotebookLM APIs directly.

---

## 10. Walkthrough — One Evergreen Refresh

> **Numbers:** Passage counts below are ILLUSTRATIVE (hypothetical). Real RuView figures after ACL-01: 6,772 chunks / 637 segments (down from 44,083 / 4,135 before the scope fix).

**Step 1 — Upstream detected [ENFORCED]**
Cron fetches `ruvector` HEAD; finds new SHA `abc123` ≠ stored `xyz789`. Fires `workflow_dispatch`. If SHA unchanged → cron exits silently, no build.
Event: `UpstreamVersionDetected { priorSha: "xyz789", newSha: "abc123" }`

**Step 2 — RefreshRun created [ENFORCED]**
Event: `RefreshTriggered { runId: "ruvector-2026-06-19T08:00:00Z", triggerSource: "upstream-detected" }`

**Step 3 — Submodule updated [ENFORCED]**
`git submodule update --init ruvector` → verifies HEAD = `abc123`. ExclusionList re-parsed from `.gitmodules` (e.g. `ruvector/vendor/` excluded).

**Step 4 — ForceWalk [ENFORCED — multi-kind]**
Walks source-tree + deep-docs + crate-src, skipping excluded paths. Hypothetical: ~2,550 Passages.
Event: `RepoForceWalked { strategies: ["source-tree","deep-docs","crate-src"], passageCount: 2550 }` _(count ILLUSTRATIVE)_

**Step 5 — Delta computation [MODELED — target]**
Not yet run in CI. When implemented: diff `abc123` vs `xyz789` → populate DeltaSet.
Event: `NewFunctionalityDetected { deltaItems: [...] }` _(future)_

**Step 6 — Embedding [ENFORCED — prototype used dual-variant; single bge-small build is MODELED — target]**
_(Prototype reality: dual-variant — old MiniLM-384 + bge-768. Target: single 384-dim `bge-small-en-v1.5`.)_ Target walkthrough: Passages embedded into one `ruvector-kb.rvf` (384-dim bge-small).
Event: `KnowledgeBaseRebuilt { kbVariantSha: "abc123", passageCount: 2550 }`

**Step 7 — Guard [ENFORCED] + Coverage/structured checks [MODELED — target]**
Anti-truncation ✓, single variant present + non-zero ✓, live-query ✓, scope-boundary ✓, dims = 384 ✓; **[v1.4.0 target] embed.json sidecar matches model ✓, structured for-ai/ artifacts (symbols/dep-graph/entrypoints) exist + parse ✓, every passage `source_type`-tagged ✓, CoverageGate indexed/authored ≥0.92 ✓ (runs before answer-quality).**
Event: `GuardPassed { checks: ["anti-truncation","variant-present","live-query","scope-boundary","dim-check","embed-sidecar","structured-artifacts","source-type","coverage>=0.92"] }`

**Step 8 — Bundle [ENFORCED]**
Zips `ruvector-kb.rvf`, Passage metadata, `ruvector-primer.md`, runtime tools, `SOURCE.json` (builtAt=now, kbVariantSha=abc123). Uploads to `kb-latest` Release atomically.
Event: `BundleRepublished { bundleUrl: "https://github.com/.../releases/download/kb-latest/ruvector-kb-bundle.zip" }`

**Step 9 — Provenance [ENFORCED]**
ProvenanceMarker read back from uploaded bundle to confirm match (PROVE-IT — real artifact, not asserted).
Event: `ProvenanceUpdated { builtAt: "2026-06-19T08:12:00Z", kbVariantSha: "abc123" }`

**Step 10 — Surface + agent query [ENFORCED]**
Vercel reads SOURCE.json; `index.html` displays verified build date + kbVariantSha + download link. Run terminal.
Event: `SurfaceRefreshed` → `RefreshRun.Outcome = { status: "success" }`

**Concrete agent query (the "how to implement" arc stage):**
```js
import { RvfDatabase } from "@ruvector/rvf";
const db = RvfDatabase.open("./ruvector-kb.rvf");
const hits = db.query("how does HNSW index construction work", 10);
// hits: [{ passage: "...", score: 0.92 }, ...]
```
No server, no daemon, no external API — the single `.rvf` file is the complete knowledge base.

---

## Appendix — Open Modeling Questions

1. **HumanHalf entity vs. own Aggregate Root — RESOLVED:** Keep as an entity inside TwoPartPrimer until NotebookLM authoring is actually automated. Promotion to Aggregate Root (with `HumanHalfRegenerated` event) is the right move once automation lands — but not before; premature promotion adds lifecycle complexity with no current benefit.

2. **Single variant vs. step-up to 768 — RESOLVED (v1.3.1):** INV-05 now mandates the single 384-dim `bge-small-en-v1.5` desktop variant. The old dual-variant (SmallVariant + BigVariant) rule is retired. **Action before locking in a 768-dim step-up for any repo:** measure actual `bge-768` build time on that repo's passage corpus (~6,772 passages for RuView/ruvector) — at 2k–8k passages, dimension barely moves retrieval quality; model choice and structure-aware chunking are the real levers. Only step up if a repo genuinely can't clear Gate A at 384.

3. **Human half staleness (open):** Tracked as INV-24 [MODELED — target]. The `humanHalfSha` field in ProvenanceMarker closes the provenance gap once implemented. The flag is advisory until automation is in place.
