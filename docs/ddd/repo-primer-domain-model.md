# Repo-Primer Pipeline — Domain Model

> **Related ADR:** [`0001` — Repo-Primer Pipeline · Part I (architecture) + Part II (Explainer Site + Self-Evaluating Quality Gate)](../adr/0001-repo-primer-pipeline.md) — *one ADR ⇄ one DDD*
> **Version:** 1.1.1 · **Status:** Living document. **Last updated:** 2026-06-19 (aligned to ADR-0001 v1.1.1: added **image-first ordering** [W/D22] — every section/use-case/process starts with its visual FIRST, then the words; added **INV-19** + the `ImageFirstOrdering` term + §6 table row + ExplainerSite invariant (13). Prior v1.1.0: captivating Hero [D21], dual-level visuals every section [D22], differentiation [D20], scoring relaxation ≥95 under time pressure [D15]; added INV-16/17/18, Hero/DualLevelVisual/Differentiation terms, gate-D/E + felt-question events; website is a co-hero; QualityGate replaces a bare Guard; "done = proven-good").

## Implementation Status Legend

- **[ENFORCED]** — built and running in CI today (RuView + ruvector prototype).
- **[MODELED — target]** — designed and correct; not yet enforced in code. Treat as a binding contract for the generalisation effort.

> **Term name note:** `TwoPartPrimer`, `On-Ramp Surface`, and `EvergreenOrchestrator` are provisional — pending the ADR rename decision. Ubiquitous-language stability is provisional until the ADR is ratified.

---

## 1. Purpose

The **Repo-Primer Pipeline** turns under-documented "power tool" repos into a **dual-audience, evergreen explainer + proof point**:

- **Human Half** — NotebookLM Studio outputs (video, audio overview, PDF, infographics) that teach a newcomer through the seven-stage ComprehensionArc. Sources are **hand-curated** into NotebookLM — NOT derived from ForceWalk Passages.
- **AI Half** — RVF (single-file vector database) knowledge base of the repo's own code + docs + Whisper transcripts, letting an agent answer from the real source.

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
| **Passage** | A paragraph-sized chunk of text extracted during a ForceWalk, suitable for embedding (converting to a vector for similarity search). |
| **HumanHalf** | NotebookLM Studio outputs: video, audio overview, PDF slide deck, infographics. Hand-curated; independent of the AIHalf build path. |
| **AIHalf** | The RVF vector knowledge base built from Passages, Whisper transcripts, and summary. |
| **TwoPartPrimer** | Aggregate containing one HumanHalf + one AIHalf for a TargetRepo. Name provisional. |
| **RVF** | `.rvf` binary — a single-file vector database using HNSW (Hierarchical Navigable Small World — a graph structure for fast approximate nearest-neighbour search). Exclusive format for embeddings here. No flat JSON, no pgvector. |
| **SmallVariant** | 384-dim RVF KB. Lighter, edge-suitable. Auto-rebuilt every RefreshRun. |
| **BigVariant** | 768-dim RVF KB. Sharper, Mac/PC-suitable. Manual trigger only; carried forward between rebuilds. |
| **KnowledgeBase** | Aggregate holding SmallVariant + BigVariant + Passages + provenance for one TargetRepo. |
| **ScopeBoundaryFilter** | ACL that strips vendored deps and nested submodules from ingestion by reading `.gitmodules`. |
| **Guard** | Post-build validation: anti-truncation, parity (both variants present), live-query. GuardPassed is mandatory before any publish. |
| **RefreshRun** | One rebuild cycle: trigger → ForceWalk → embed → Guard → bundle → publish. |
| **DeltaSet** | Net-new functionality vs. prior SubmodulePin. [MODELED — target] |
| **Bundle** | Self-contained zip: both RVF variants, Passages metadata, PrimerMarkdown, runtime tools, `SOURCE.json`. |
| **RollingRelease** | Single `kb-latest` GitHub Release, replaced in-place each successful run. |
| **Provenance** | Rebuild timestamp + upstream SHAs in `SOURCE.json`. Always read from the real artifact — never asserted. |
| **On-Ramp Surface** | Static `index.html` on Vercel presenting the TwoPartPrimer with live Provenance. Name provisional. |
| **EvergreensOrchestrator** | GitHub Actions cron + `workflow_dispatch` (a CI trigger) that fires **only** on SHA change. Name provisional. |
| **ComprehensionArc** | Fixed seven stages (canonical, verbatim): 1) What is this concept? 2) What can you do with it? 3) Why was it built? 4) What problems does it solve? 5) One concrete end-to-end example. 6) 3–4 other application areas. 7) How exactly do I implement it (concrete path)? |
| **ArcCoverage** | Guard sub-check verifying all seven ComprehensionArc stages in HumanHalf + PrimerMarkdown. [MODELED — target] |
| **Published Language** | DDD relationship: upstream publishes a stable interface; downstream conforms without negotiation. |
| **Conformist** | DDD relationship: downstream adapts to upstream rather than negotiating. |
| **ACL** | Anti-Corruption Layer — translation barrier preventing an external system's concepts from polluting the domain model. |
| **ExplainerSite** | **[ADR-0001 §II]** HERO artifact #1: the visual, collapsible, imagery-rich web page that takes a NonTechnicalClaudeCodeUser from "never heard of this" to "I know exactly what to do with it." Co-equal with the KB bundle, not a by-product of NotebookLM. |
| **DropInSmartZip** | **[ADR-0001 §II]** HERO artifact #2: the self-contained KB bundle (both RVF variants + passages + `ask-kb.mjs` + `kb-mcp-server.mjs` + primer + README) that makes the user's *AI* instantly expert. |
| **NonTechnicalClaudeCodeUser** | **[ADR-0001 §II]** The single target persona: someone who uses Claude Code but is *not* a deep engineer. If they can't understand and use the tool from the site, the primer failed. |
| **UseCaseGallery** | **[ADR-0001 §II]** ≥5 *full* concrete scenarios on the site, each = situation → exact command(s) → what the tool does → what you get, with a visual. The cure for "what can it do?" → "anything you like." |
| **QualityGate** | **[ADR-0001 §II]** Expanded Guard. **Five checks** that must pass (with recorded evidence) before done: (A) KB AnswerQualityGrade, (B) site ComprehensionAudit (incl. the three felt questions), (C) consistency/completeness, (D) StudioOutputGraded, (E) VisualAssetGraded — plus score ≥98 (≥95 under time pressure). "Done = proven-good." |
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

---

## 3. Bounded Contexts

### 3.1 Source Acquisition
Tracks TargetRepos as submodules; detects upstream SHA changes; maintains SubmodulePin. Emits: `UpstreamVersionDetected`, `RefreshTriggered`. External boundary: git/GitHub APIs (ACL wrapper).

### 3.2 Human Comprehension Authoring
Produces the HumanHalf via NotebookLM. Sources are **hand-curated uploads** — independent of the KB ForceWalk path. Currently human-triggered; artifacts committed to the repo. ACL: `nlm` CLI (downloads Studio outputs via `nlm pull`; re-auths via `nlm auth --cdp`, where CDP = Chrome DevTools Protocol). External boundary: NotebookLM.

### 3.3 Knowledge Base / RVF Build
ForceWalks the TargetRepo, embeds Passages into RVF files, builds both variants, runs the Guard. The ScopeBoundaryFilter (ACL-01) reads `.gitmodules` and excludes vendored paths before any Passage is created. Real impact: RuView over-ingested 44,083 chunks/4,135 segments before the fix; 6,772/637 after. Emits: `RepoForceWalked`, `KnowledgeBaseRebuilt`, `GuardPassed`, `GuardFailed`. Also emits `NewFunctionalityDetected` [MODELED — target].

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
**Root.** One per TargetRepo. Contains: `SmallVariant` entity (384-dim `.rvf`, auto-rebuilt); `BigVariant` entity (768-dim `.rvf`, manual, carried forward — its originating SHA recorded in ProvenanceMarker); `PassageSet` entity (scope-filtered Passages, replaced per ForceWalk); `GuardStatus` value object `{ status: "passed"|"failed"|"pending", checkedAt, details }`. Also: `ScopeBoundarySpec` value object (from `.gitmodules`); `EmbeddingConfig` value object `{ model, dims }`.

Invariants: (1) PassageSet contains ONLY own-tree Passages — no excluded paths. **[ENFORCED]** (2) GuardStatus must be "passed" before handing to Distribution. **[ENFORCED]** (3) Both variants must be present; BigVariant carries forward until manually rebuilt. **[ENFORCED]** (4) `EmbeddingConfig.dims` must match actual `.rvf` dimension count. **[ENFORCED]**

### 5.3 SourceRepo
**Root.** One per submodule. Contains: `SubmodulePin` value object `{ path, sha, pinnedAt }`; `ExclusionList` value object (parsed `.gitmodules`); `UpstreamTracker` entity (holds last-known UpstreamSHA).

Invariants: (1) SubmodulePin.sha must match checked-out HEAD at ForceWalk start. **[ENFORCED]** (2) ExclusionList re-read from `.gitmodules` each run; never cached. **[ENFORCED]**

### 5.4 RefreshRun
**Root.** One per trigger. Contains: `RunId` value object; `TriggerSource` value object (schedule/manual/upstream-detected); `ForceWalkManifest` entity (strategies + outcomes — today: source-tree, deep-docs, crate-src [ENFORCED]; full five-strategy sweep [MODELED — target]); `DeltaSet` entity [MODELED — target]; `Outcome` value object `{ status: "success"|"failed"|"partial", failedAt }`.

Invariants: (1) Multi-kind ForceWalk must complete before embedding. **[ENFORCED]** Full five-strategy sweep required before generalisation ships. **[MODELED — target]** (2) DeltaSet must be computed before emitting `NewFunctionalityDetected`. **[MODELED — target]** (3) Failed run must not trigger BundleRepublished; prior Distribution stays live. **[ENFORCED]**

### 5.5 Distribution
**Root.** One live per TargetRepo. Contains: `Bundle` entity (zip archive with both variants, Passages metadata, PrimerMarkdown, runtime tools, SOURCE.json); `RollingReleaseAsset` entity (kb-latest tag, replaced atomically); `ProvenanceMarker` value object `{ builtAt, targetRepoSha, smallVariantSha, bigVariantSha, primerSha }`.

Invariants: (1) Both variants must be in every bundle. **[ENFORCED]** (2) ProvenanceMarker read from SOURCE.json — never hard-coded. **[ENFORCED]** (3) RollingReleaseAsset replaced atomically (new upload complete before old deleted). **[ENFORCED]**

### 5.6 ExplainerSite  **[ADR-0001 §II — MODELED, target]**
**Root.** Hero artifact #1; one per TargetRepo. Contains: `HeroVisual` value object (the captivating opening visual + resonance lead — D21); `ResonanceLead` value object (plain-language stakes + named before→after persona — D20); `ArcSectionSet` entity (the 7 ordered sections — why-built / what-problem / why-now / how-it-solves / solved-state / how-to-implement / how-to-start); `SectionFigurePair` value object per section (the **DualLevelVisual**: one technical SVG diagram + one approachable illustration — D22); `UseCaseGallery` entity (≥5 full concrete scenarios, each a collapsible item with its own figure); `DifferentiationBlock` value object (the "why this vs what I already have?" answer + before→after-on-your-own-codebase comparison — D20); `FigureSet` entity (every generated graphic, each carrying its tier — tier-1 raster on-ramp or tier-2 explanatory SVG); `AestheticTheme` value object (per-repo visual identity — distinct, not cloned); `ProvenanceAttributionBlock` value object (author Reuven Cohen/@ruvnet + source-repo link + live date+version+sha — D12/constraint Q); `DropInSection` value object (annotated file-tree of the real zip contents + exact 3-step setup + confirm-it-works query — D13); `AuditResult` value object `{ clarity, compelling, ease (1–5 each), arcStagesCovered, feltImpress, feltInvite, feltWant, reviewerVerdict }`.

Invariants: (1) HeroVisual present and captivating — a text-only/generic hero fails (INV-16). (2) All 7 ArcSections present before publish. (3) Every section carries a DualLevelVisual (technical SVG + approachable illustration) — no text-only or single-register section (INV-17). (4) UseCaseGallery ≥5 full scenarios, each with its own visual — a capability list does not satisfy it. (5) Educational sequencing: grounding example → gallery → implement (R). (6) ResonanceLead present (INV-18). (7) DifferentiationBlock present when an adjacent tool plausibly overlaps (INV-18). (8) AestheticTheme is distinct from every prior ExplainerSite. (9) ProvenanceAttributionBlock present (INV-06 extends to the site). (10) DropInSection visual shows the real file-tree, not an abstract picture (D13). (11) ComprehensionAudit (AuditResult) must pass the ClarityRubric — including all three FELT questions = "yes" — before publish (INV-10). (12) Built for exactly one persona: NonTechnicalClaudeCodeUser. (13) Every section, use-case, and process is laid out **image-first** — its visual comes before its prose (INV-19); a section that opens with text before its visual is a defect.

---

## 6. Entities vs. Value Objects

| Name | Type | Key note |
|------|------|----------|
| TwoPartPrimer | Aggregate Root | Identity = TargetRepo slug |
| HumanHalf | Entity | Identity = TargetRepo + build date |
| AIHalf | Entity | Reference to KnowledgeBase |
| KnowledgeBase | Aggregate Root | Long-lived; rebuilt but not replaced |
| SmallVariant | Entity | Replaced each RefreshRun |
| BigVariant | Entity | Replaced on manual trigger; carried forward |
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
| ProvenanceMarker | Value Object | `{ builtAt, targetRepoSha, smallVariantSha, bigVariantSha, primerSha }` |
| TriggerSource | Value Object | Enum |
| Outcome | Value Object | Set once; immutable |
| ExplainerSite | Aggregate Root [MODELED] | Identity = TargetRepo slug; hero artifact #1 |
| ArcSectionSet | Entity [MODELED] | The 7 ordered sections |
| UseCaseGallery | Entity [MODELED] | ≥5 full collapsible scenarios |
| FigureSet | Entity [MODELED] | Each figure tagged tier-1 raster / tier-2 SVG |
| HeroVisual | Value Object [MODELED] | Captivating opening visual + resonance lead [D21] |
| DualLevelVisual / SectionFigurePair | Value Object [MODELED] | Technical SVG + approachable illustration per section [D22] |
| ImageFirstOrdering | Value Object [MODELED] | Section-layout rule: visual first, then prose [W/D22] |
| ResonanceLead | Value Object [MODELED] | Plain stakes + named before→after [D20] |
| DifferentiationBlock | Value Object [MODELED] | "Why this vs what I have?" + before→after-on-your-codebase [D20] |
| ProvenanceAttributionBlock | Value Object [MODELED] | Author/@ruvnet + repo link + live date+version+sha [Q] |
| DropInSection | Value Object [MODELED] | Real file-tree + 3-step setup + confirm query [D13] |
| AestheticTheme | Value Object [MODELED] | Distinct per repo [K] |
| AuditResult | Value Object [MODELED] | `{ clarity, compelling, ease, arcStagesCovered, feltImpress, feltInvite, feltWant, reviewerVerdict }` |

---

## 7. Domain Events

| Event | Status | Trigger | Key downstream |
|-------|--------|---------|----------------|
| `UpstreamVersionDetected` | [ENFORCED] | Cron finds new SHA vs. SubmodulePin | Emits `RefreshTriggered` via workflow_dispatch |
| `RefreshTriggered` | [ENFORCED] | UpstreamVersionDetected or manual dispatch | Creates RefreshRun; starts ForceWalk |
| `RepoForceWalked` | [ENFORCED] | ForceWalk strategies all complete | Embedding begins |
| `NewFunctionalityDetected` | [MODELED] | DeltaSet computed (even if empty) | On-Ramp renders delta callouts; PrimerMarkdown updated |
| `KnowledgeBaseRebuilt` | [ENFORCED] | SmallVariant written; BigVariant present (fresh or carried) | Guard begins |
| `GuardPassed` | [ENFORCED] | Anti-truncation + parity + live-query all pass; ArcCoverage [MODELED] | Distribution permitted |
| `GuardFailed` | [ENFORCED] | Any guard check fails | Run fails; prior Distribution stays live; CI alert |
| `BundleRepublished` | [ENFORCED] | Bundle uploaded to RollingRelease; requires GuardPassed same runId | Emits ProvenanceUpdated |
| `ProvenanceUpdated` | [ENFORCED] | SOURCE.json live in bundle | On-Ramp re-renders provenance |
| `SurfaceRefreshed` | [ENFORCED] | On-Ramp reloads SOURCE.json | RefreshRun.Outcome → success |
| `KbAnswerGraded` | [ADR-0001 §II — target] | QualityGate (A) grades the `.rvf` on tuned + held-out Qs | Below threshold → diagnose → rebuild → re-grade; at/above → gate (A) green |
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
No BundleRepublished without GuardPassed for the same runId. GuardFailed blocks unconditionally. Guard checks today: anti-truncation, parity, live-query.

**INV-03 — Multi-Pass ForceWalk [ENFORCED / MODELED]**
Minimum today [ENFORCED]: source-tree + deep-docs + crate-src. Full target [MODELED — target]: add `public-api-exports`, `examples`, `changelog`. Full sweep required before generalisation to new repos. Guard checks ForceWalkManifest completeness against whichever set is current.

**INV-04 — Delta Computation [MODELED — target]**
Every RefreshRun must compute DeltaSet (diff new SHA vs. prior SubmodulePin) before emitting `NewFunctionalityDetected`. Empty DeltaSet is valid (zero-delta); uncomputed DeltaSet is not.

**INV-05 — Variant Pairing [ENFORCED]**
Both SmallVariant (auto, 384-dim) and BigVariant (manual, 768-dim) must be in every Distribution. BigVariant carries forward from its last rebuild; ProvenanceMarker records each variant's originating SHA separately.

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

**INV-14 — Studio Outputs Optimized & Graded [ADR-0001 §II]**
Each repo has its own NotebookLM notebook and a full studio buildout (audio overview, report, and video/slides where tooling allows). Each studio artifact is produced by an **OptimizedStudioPrompt** (tuned for clarity/understanding/intention/education/comfort/confidence) and graded by **reading/transcribing the real output** (gate D) for completeness and effectiveness — does it actually teach a beginner? Generic prompts or un-checked outputs are defects, not done.

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

**Step 6 — Embedding [ENFORCED]**
SmallVariant (384-dim): Passages embedded via `Xenova/all-MiniLM-L6-v2`. BigVariant (768-dim): prior build from `xyz789` carried forward.
Event: `KnowledgeBaseRebuilt { smallVariantSha: "abc123", bigVariantSha: "xyz789" }`

**Step 7 — Guard [ENFORCED]**
Anti-truncation ✓, parity (both variants present) ✓, live-query ✓, scope-boundary ✓, dim-parity (384/768) ✓.
Event: `GuardPassed { checks: ["anti-truncation","parity","live-query","scope-boundary","dim-parity"] }`

**Step 8 — Bundle [ENFORCED]**
Zips both `.rvf` files, Passage metadata, `ruvector-primer.md`, runtime tools, `SOURCE.json` (builtAt=now, smallVariantSha=abc123, bigVariantSha=xyz789). Uploads to `kb-latest` Release atomically.
Event: `BundleRepublished { bundleUrl: "https://github.com/.../releases/download/kb-latest/ruvector-kb-bundle.zip" }`

**Step 9 — Provenance [ENFORCED]**
ProvenanceMarker read back from uploaded bundle to confirm match (PROVE-IT — real artifact, not asserted).
Event: `ProvenanceUpdated { builtAt: "2026-06-19T08:12:00Z", smallVariantSha: "abc123", bigVariantSha: "xyz789" }`

**Step 10 — Surface + agent query [ENFORCED]**
Vercel reads SOURCE.json; `index.html` displays verified build date + variant SHAs + download link. Run terminal.
Event: `SurfaceRefreshed` → `RefreshRun.Outcome = { status: "success" }`

**Concrete agent query (the "how to implement" arc stage):**
```js
import { RvfDatabase } from "@ruvector/rvf";
const db = RvfDatabase.open("./ruvector-kb.small.rvf");
const hits = db.query("how does HNSW index construction work", 10);
// hits: [{ passage: "...", score: 0.92 }, ...]
```
No server, no daemon, no external API — the single `.rvf` file is the complete knowledge base.

---

## Appendix — Open Modeling Questions

1. **HumanHalf entity vs. own Aggregate Root:** Currently an entity inside TwoPartPrimer. If authoring is automated (detecting arc drift → new studio session), promote to Aggregate Root with `HumanHalfRegenerated` event. Decide before generalising.

2. **BigVariant carry-forward vs. async rebuild:** Carry-forward is ENFORCED and practical; ProvenanceMarker exposes the SHA age gap. Async non-blocking rebuild is cleaner but adds CI complexity. Lock down before generalisation.
