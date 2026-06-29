# Repo Explainer (Recipe) — Domain-Driven Design Model

**Version:** 1.1.0
**Created:** 2026-06-28
**Updated:** 2026-06-28 (ADR-0005 alignment: local-render quality gate before deploy; primer +
structured-extraction outputs + studio-less make-dropin in the pack; embed-block prerequisite;
build-time image probe + raster-size wording)
**Status:** Accepted — authoritative for the converged "one-brain skill" architecture.
**Paired ADR:** `docs/adr/0005-skill-based-explainer-recipe.md` (the converged decision).
**Supersedes (the pipeline approach only):** the multi-phase GitHub-Actions / `scripts/phase*.mjs`
model described in ADR-0002 / 0003 / 0004 / 0004a and in `docs/ddd/repo-explainer-domain.md`
v2.1.0. Vocabulary that is still true (TargetRepo, ExplainerRepo, BuildId, RVF KB,
AIKnowledgePack, StudioQuarantine) is carried forward verbatim; the brittle, string-coupled,
phase-handoff mechanics are retired and replaced by the **Build aggregate owning a single
in-memory `BuildContext`**.

---

## 0. Mission & Soul (the thing every model element serves)

> Take someone from "I've never seen this before" to "Oh, I get **why** this was created, the
> problem it solves, what it does, why it's elegant, how it works — and I'm ready to go
> implement it." Most engineers ship things assuming people know why they'd care; they don't.
> The explainer's precise job is to cure that: show a newcomer **why it matters** and give real
> real-world examples that make them go "oh, that would be really cool."

The **minimum bar** is a domain fact, not a slogan: a stranger looks at the result and smiles —
*"that's really cool."* If a Build cannot clear that bar, it is **not done and not acceptable**.
This is why Quality is a first-class bounded context (§6.5) and why the `Scorecard` value
object (§8.5) is the literal completion criterion of the `Build` aggregate — not a report
written after the fact.

---

## 1. How to Read This Document

- **§2–§4** are the architecture contract: the one brain, the brain/tools split, and the single
  `BuildContext` that replaces every string-coupled handoff.
- **§5** is the vocabulary contract (ubiquitous language).
- **§6** maps the eight bounded contexts and their relationships.
- **§7** defines the `Build` aggregate root and the rules it enforces.
- **§8** defines the six value objects, including the load-bearing `Scorecard` and `BuildContext`.
- **§9** is the comprehension arc and image ladder (concept-then-render; invariants vs expression).
- **§10** is the Build state machine: the ten stations (0–9), the optional README-PR station
  (8b), and the refine-loop back-edge.
- **§11** is the domain-event catalogue.
- **§12** models the QA dual-gate as first-class domain concepts.
- **§13** is the numbered invariant register (INV-01..).
- **§14** is Distribution: the three thin adapter doors over the one core.
- **§15** is the target layout and the real file paths the model wraps.

---

## 2. Architectural Pillars (the decisions the model encodes)

**P1 — One brain, one source of truth.** A single Claude Code **Skill** (`skills/repo-explainer/SKILL.md`)
*is* the system. The magic — Claude Code reading a repo and authoring a bespoke, art-directed
explainer — was never captured as reusable code before; this model captures it. All three
distribution doors (§14) execute the *identical* skill. There is no second implementation.

**P2 — Retire the phase pipeline.** The GitHub-Actions phase pipeline
(`.github/workflows/build-explainer.yml` + `scripts/phase*.mjs`) is retired, not carried forward.
It was a brittle re-write: broken at the P2→P3 seam (nobody produced `repo-analysis.json`;
phases 3–6 hard-exited without it), it never shipped the KB pack, and it failed GitHub's own
workflow validation on every push.

**P3 — Reuse the real KB engine.** The working KB engine already exists and is wrapped, not
rebuilt: `kb/build-kb.mjs` (builds the RVF KB), the structured-extraction scripts
`kb/extract-symbols.mjs` / `kb/dep-graph.mjs` / `kb/entrypoints.mjs` (+ `kb/index-primer.mjs`),
`kb/ask-kb.mjs` (HNSW retrieval CLI), `kb/make-dropin.mjs` (assembles the downloadable AI pack),
`kb/kb-mcp-server.mjs` (MCP server over the KB). The duplicate `scripts/phase2-build-kb.mjs` and the
`scripts/knowledge-pack-assets/` fork are deleted. The Understanding/Assembly tools are thin wrappers
over these files — reused as-is save **one** acknowledged change: the pack builder is invoked with a
`--no-studio` relaxation of `make-dropin.mjs`'s studio guard (§6.5), so a studio-less ship does not
throw.

**P4 — Brain = judgment, Tools = mechanics (strict split).** The Brain decides: understand,
conceive, author, judge quality. Tools execute mechanics: embed, call the image API, screenshot,
zip, deploy. A tool is pure and independently testable: clear input → clear output →
`{ ok | loud failure }`. A tool NEVER reads another tool's files and NEVER reads the whole
`BuildContext` — it receives only the args it needs.

**P5 — One in-memory contract: `BuildContext`.** All cross-station state lives in a single
in-memory object owned solely by the Brain (§8.6). Each station fills its own slot. There are
**no string-coupled HTML markers** — the old `<!-- CONTENT:* -->` / `<!-- IMG:gallery -->`
markers that P3 emitted and P4/P5 had to match by exact string are the precise coupling that
broke the pipeline. The page is rendered **once** from a component system (§9), never mutated
incrementally by many phases.

---

## 3. Concept-Then-Render (the authoring model)

Each explainer is **unique by default, reliable by construction** — not cookie-cutter, not fully
unconstrained. Authoring is a two-beat move:

1. **CONCEIVE (judgment).** Before any rendering, the Brain invents this repo's
   `ArtDirectionBrief` (§8.1): a visual metaphor (PhotonLayer→prism, ruvn→evidence dossier,
   ruqu→Bloch-sphere orb), a palette + type personality fitting that metaphor, a layout rhythm
   composed from section archetypes, a hero concept, and a copy voice.
2. **RENDER (mechanics).** Compose the brief onto a shared `DesignSystem` (§8.4): tokens +
   components + a responsive skeleton + the required sections + built-in QA affordances.

This is enforced by splitting **invariants** (always true, in code) from **expression** (always
differs, art-directed) — see §9.3. There is **no shared design system today** (the audit found
6 example sites, 6 bespoke `styles.css`, zero shared tokens). Distilling **one** coherent
`DesignSystem` from the best of those 6 examples is a real station of the work, not a given.

---

## 4. The Brain / Tools / BuildContext Triangle

```
                        ┌─────────────────────────────────────────┐
                        │              THE BRAIN (Skill)            │
                        │  judgment: understand · conceive ·        │
                        │  author · judge-quality · decide-refine   │
                        │  SOLE owner of the Build aggregate +      │
                        │  the in-memory BuildContext               │
                        └───────────────┬───────────────────────────┘
              args in (only what's needed) │ ▲ result out { ok | loud failure }
                        ┌───────────────────▼─┴───────────────────┐
                        │                 TOOLS                    │
                        │ pure · independently testable · mechanics│
                        │ buildKb · askKb · genImage · asciiToSvg ·│
                        │ makeSocialCard · screenshot · scoreVision·│
                        │ makeDropin · zip · deploy · sendEmail ·   │
                        │ cloneRepo · createRepo · inviteCollab ·   │
                        │ setRepoSeo · openReadmePr  (github.* triad│
                        │ S0/S1 clone + S8 repo-create/topics/invite│
                        │ + optional 8b README PR)                  │
                        │            (NEVER read each other / ctx)  │
                        └──────────────────────────────────────────┘

   BuildContext (one object, slot-per-station, Brain-owned):
   { validation, understanding(KB handle), brief, content,
     visuals(raster rungs + svg rungs), brand(faviconSet + socialCard + og/twitter),
     page(+ seo head/JSON-LD/sitemap/robots/llms.txt), pack, scorecard[],
     deployment(+ repoTopics/description), readmePr?(optional), notification }
```

The Brain is the only component that holds the whole picture. Tools are leaves. `BuildContext`
is the trunk. This triangle is the anti-brittleness architecture made concrete.

---

## 5. Ubiquitous Language

| Term | Definition |
|------|------------|
| **Brain** | The single Claude Code Skill (`skills/repo-explainer/SKILL.md`) that holds all judgment. The one source of truth; every adapter runs it. |
| **Tool** | A pure, independently-testable mechanic. Receives only the args it needs; returns `{ ok \| loud failure }`. Never reads the `BuildContext` or another tool's files. |
| **Build** | One end-to-end execution of the explainer recipe. The central **aggregate root**. Identified by **BuildId**. Owns the `BuildContext` through its whole lifecycle. |
| **BuildId** | A UUID generated at Validate (Station 0). The correlation key across stations and async boundaries; also the IdempotencyKey. |
| **BuildContext** | The one in-memory data contract (§8.6), owned solely by the Brain. Each station fills its own slot. Replaces every string-coupled handoff. |
| **Station** | One named step (0–9) of the recipe. Each station has a single **checkpoint cue** — a loud postcondition that either proves the slot is filled or stops the Build with a clear reason. |
| **Checkpoint cue** | A station's loud, positive postcondition (e.g. "every image valid + HTTP 200"). A station that advances without satisfying its cue is a defect (INV-04). |
| **TargetRepo** | The GitHub repository submitted for explanation (`{owner}/{repo}`). May be public, private, or the owner's own — authenticated access is supported. |
| **TargetOwner** | The GitHub user/org that owns the TargetRepo. Invited as a collaborator on the ExplainerRepo (best-effort). |
| **ExplainerRepo** | The new repo created to host the explainer. Distinct from TargetRepo — never conflate. |
| **RVF KB** | The RuVector/RVF binary vector knowledge base built from the TargetRepo by `kb/build-kb.mjs`. The ONLY knowledge artifact; all grounding flows through HNSW retrieval against it (never invented claims, never flat JSON). |
| **AIKnowledgePack** | The downloadable bundle assembled by the **studio-less** `kb/make-dropin.mjs` (§6.5). Its **for-AI** half: the `.rvf` binary (+ `.rvf.idmap.json` + `.rvf.embed.json`), the `.passages.jsonl` sidecar, the `.ids.json` index, the **three structured indexes** `<slug>-symbols.json` / `<slug>-dep-graph.json` / `<slug>-entrypoints.json` (without them three of the MCP server's four tools return nothing), the `ask-kb.mjs` search CLI, and the `kb-mcp-server.mjs` MCP server. Its **for-humans** half: the authored **`<slug>-primer.md`** (a hard `make-dropin` line-79 `must()` prerequisite). Every explainer ships one (INV-07). |
| **ArtDirectionBrief** | Value object (§8.1): the conceived, repo-specific creative direction — metaphor, palette, type personality, layout rhythm, hero concept, copy voice. The output of CONCEIVE. |
| **ComprehensionArc** | Value object (§8.2): the ordered sequence of reader questions that drives BOTH section order and image order. |
| **ImageLadder** | Value object (§8.3): the ordered set of rungs, each bound to one arc question, ordered high-level → low-level (altitude descends). Each rung is rendered by one of two media: **structural/explanatory rungs as SVG** (big-idea, the "aha" insight, architecture, flow — authored as ASCII then converted by `ascii-to-svg`), **emotional/illustrative rungs as raster** (hero, problem, scenario — via gpt-image-2). |
| **ascii-to-svg** | The skill/tool (`~/.claude/skills/ascii-to-svg`) that converts ASCII diagrams into crisp, accessible, scalable SVGs. The renderer for the structural rungs of the `ImageLadder`. Vector = maximum clarity, never "AI slop". The same SVGs are shared by the Page AND the optional README PR. |
| **SVGDiagram** | A structural rung produced by `ascii-to-svg`: an `.svg` asset (+ ASCII fallback) authored from the architecture/flow/big-idea/insight of the repo. Shared verbatim by Page and README. |
| **DesignSystem** | Value object (§8.4): the shared tokens + components + responsive skeleton + required sections + built-in QA (incl. SEO + social affordances), distilled from the best of the 6 example sites. The render target. |
| **Scorecard** | Value object (§8.5): the dual-gate QA result — A1–A5 + B1–B5, per device, with rationales. Its `headlineScore` (the MIN) is the literal completion criterion. |
| **Page** | The single, once-rendered ExplainerSite (HTML/CSS/JS + images + SVG diagrams + the pack download section). Rendered once from the DesignSystem; never mutated incrementally. Its `<head>` carries the full **SEO surface** + **social/brand meta** (§6.5). |
| **BrandKit** | The Brand & Social output of Station 5: the full **favicon set** (hero-derived favicon + apple-touch-icon + standard sizes) PLUS the designed **SocialCard**. Wired into `<head>` at Assembly. |
| **SocialCard** | The dedicated, designed **1200×630** share image (on-brand, the authored tagline baked in) used as `og:image` / `twitter:image`. Makes a link forwarded to Twitter/LinkedIn/WhatsApp/Discord render as a rich, inviting preview. The tagline also drives `og:description`. |
| **SEOSurface** | The page-discoverability bundle baked into the Page (REQUIRED): `<title>`, meta description, canonical URL, semantic HTML, JSON-LD `schema.org SoftwareApplication`, `sitemap.xml`, `robots.txt`, and `llms.txt`. Premise: GitHub/the open web is the new AI-world social media — most repos never SEO/AI-enable, so this is a real edge. |
| **llms.txt** | The machine-readable summary shipped at site root so AI crawlers + retrieval find and represent the explainer correctly. Part of the SEOSurface. |
| **RepoSEO** | GitHub **topics** + a strong **description** set on the ExplainerRepo (via API). The build also **suggests** topic/description improvements for the TargetRepo (in the README PR or the notify email) — never sets them directly. |
| **ReadmePR** | The OPTIONAL Publishing-context concern (Station 8b): an offer to enhance the TargetRepo's README via `~/.claude/skills/readme-enhance` — an architectural explanation + the shared 11a SVG diagrams + an explainer badge — delivered ONLY as a **pull request** on the source repo (never a direct push). Off the critical path; never blocks the core. |
| **RefineLoop** | The Quality context's back-edge: grade → if any criterion < 95 on either device, name the exact weakness → refine just that → re-render → re-score → repeat until MIN ≥ 95. |
| **Three Eyes** | The mandatory triple verification on the actual pixels: (1) the vision model, (2) the operator (Claude), (3) the owner — all three see the same mobile + desktop screenshots. |
| **DeploymentURL / LiveURL** | The deployed URL of the Page. LiveURL is whatever resolves unauthenticated at Notify. |
| **StudioQuarantine** | The boundary isolating any long-async optional step (e.g. NotebookLM studio assets). It is optional and never blocks the core (INV-03). |
| **Adapter (Door)** | One of three thin shells over the one Brain: the Claude Code plugin, the npx Agent-SDK CLI, the hosted website. None contains explainer logic of its own. |

---

## 6. Bounded Contexts

Eight contexts. Each owns a clear slice of judgment + the tools that serve it. The Brain
orchestrates them; the `Build` aggregate sequences them.

### 6.1 Context Map

```
   [Distribution]  (3 doors: plugin · npx CLI · website — all run the same Brain)
        │ submit(TargetRepo, email)
        ▼
   [Understanding / KB] ──RepoUnderstood──▶ [Authoring]
        │  (kb/build-kb.mjs → RVF KB)            ├─ Concept  ──ConceptDrafted──▶
        │                                        └─ Content  ──ContentAuthored─▶
        │  (RVF KB ready → pack can build early)                │
        ▼                                                       ▼
   [Assembly] ◀────VisualsGenerated──── [Visual] ◀──(arc + brief)
        │  render Page once from DesignSystem; build AIKnowledgePack
        │  ──PageAssembled──▶
        ▼
   [Quality]  ⟲ RefineRequested (back-edge to Authoring/Visual/Assembly)
        │  render LIVE · screenshot 390 + 1440 · dual-gate · two eyes (vision + operator)
        │  ──QualityGraded── (min ≥ 95 both devices) ──BuildPassed──▶
        ▼
   [Publishing] ──Deployed──▶ [Notification] ──Notified──▶ (done)
```

### 6.2 Understanding / KB
Validates the URL and reachability (Station 0), clones the TargetRepo, and builds the **RVF KB**
via `kb/build-kb.mjs` (Station 1). Each explainer target MUST register an explicit **`embed` block**
in `kb/kb.config.mjs` so build-kb writes the canonical un-suffixed `<slug>-kb.rvf` — on the bare
MiniLM default it writes `<slug>-kb.`**`small`**`.rvf`, which `kb/make-dropin.mjs` (it globs
`<slug>-kb.rvf`) cannot find (per ADR-0005 D3 / Appendix). Station 1 then runs the
**structured-extraction build step** (`kb/extract-symbols.mjs` / `kb/dep-graph.mjs` /
`kb/entrypoints.mjs` → `<slug>-symbols.json` / `<slug>-dep-graph.json` / `<slug>-entrypoints.json`)
— these are **prerequisites of the Station 6 pack**, read by the MCP server's `lookup_symbol` /
`get_dep_graph` / `get_entrypoints` tools. The Brain reads the repo deeply, confirms the KB can
answer "what is this repo?" correctly and names the repo correctly, and **authors the for-humans
`<slug>-primer.md`** (a top-down orientation; a **hard Station-6 prerequisite** — `kb/make-dropin.mjs`
line 79 `must()`s it and throws `missing: <slug>-primer.md` if absent), after which
`kb/index-primer.mjs` indexes that authored primer into the store. Publishes `RepoUnderstood` with a
**KB handle** (path + passage count) into `BuildContext.understanding`. Downstream grounding uses
`kb/ask-kb.mjs` (HNSW retrieval) only — no invented claims (INV-06). Because the KB exists after
Station 1, the AIKnowledgePack build can start here and overlap Conceive + Author (§10.3).

### 6.3 Authoring [Concept + Content]
Two sub-capabilities, one context, both pure judgment:
- **Concept (Station 2).** The Brain writes the `ArtDirectionBrief` — specific to THIS repo,
  metaphor fits. Publishes `ConceptDrafted` into `BuildContext.brief`.
- **Content (Station 3).** The Brain authors copy along the `ComprehensionArc`, every claim
  grounded in retrieved KB passages (the retrieval log is the evidence). Zero placeholder text;
  all arc questions answered. Publishes `ContentAuthored` into `BuildContext.content`.

### 6.4 Visual
Produces the `ImageLadder` + hero (Station 4) across **two media**, by altitude/role (11a):

- **Structural / explanatory rungs → SVG via `ascii-to-svg`** (REQUIRED). The big-idea diagram,
  the "aha" insight, the architecture/how-it-works diagram, and the flow are authored as ASCII
  first, then converted to crisp, accessible, scalable SVGs by the `ascii-to-svg` skill
  (`~/.claude/skills/ascii-to-svg`) — never raster. Vector = maximum clarity, never "AI slop".
  These diagrams turn a loose idea into a real solution; the **same SVGs are shared verbatim by
  the Page AND the optional README PR** (§6.7 / 8b).
- **Emotional / illustrative rungs → raster via gpt-image-2** (the metaphor's feeling: hero,
  problem, scenario). **Image engine: `gpt-image-2` is the VERIFIED PRIMARY** — confirmed in this
  project on 2026-06-28 via `GET https://api.openai.com/v1/models/gpt-image-2` → HTTP 200
  `{id: gpt-image-2, owned_by: system}` (per ADR-0005 **D7** / **Station 4 (VISUALIZE)** / the
  Appendix image-engine row). Generate at **quality `high`**, **hero 1536×1024**, **raster
  section images 1024×1024** (gpt-image-2 valid sizes: `1024×1024`, `1024×1536`, `1536×1024`,
  `auto`). **`gpt-image-1` is the FALLBACK ONLY**, used solely if a **build-time availability
  probe** of `gpt-image-2` fails. Station 4 runs the **build-time availability probe**
  (`GET /v1/models/gpt-image-2`) and proceeds against it on 200 (the expected, verified path); on a
  probe failure it falls back loud to `gpt-image-1` — it never silently downgrades.

The two media split cleanly: **`ascii-to-svg` = structure/explanation; gpt-image-2 = feeling/
metaphor.** Raster rungs generate in parallel; the favicon **set** and the **social card** are
derived from the hero identity at **Station 5 (Brand & Social)**, modeled in this §6.4. Each rung must be valid +
HTTP 200 (raster) or valid SVG (xmllint-clean), and answer its assigned arc question at the right
altitude (§9). Imagery must be BOTH beautiful AND explanatory — never pretty-but-useless, never
geeky-low-level-first. Publishes `VisualsGenerated` into `BuildContext.visuals` (raster rungs +
svg rungs) and seeds `BuildContext.brand` from the hero.

### 6.5 Assembly
Renders the **Page once** from the `DesignSystem` + the `ArtDirectionBrief` + content + the
`ImageLadder` (raster rungs + SVG rungs) (Station 6), and builds the **AIKnowledgePack** via the
**studio-less variant** of `kb/make-dropin.mjs`. (`make-dropin.mjs` as it stands carries a hard
studio guard — lines 78–92 — that throws *"Refusing to build a studio-less drop-in"* unless studio
media exists; because this model ships **studio-less first** (INV-03), the pack builder is invoked
with a `--no-studio` relaxation of that guard. This is the **one** acknowledged change to the
otherwise-reused engine; studio media, when it later exists, is re-packed on the studio follow-up.
Mirrors ADR-0005 Station 6, jointly satisfying INV-03 + INV-07.) Assembly also bakes in two REQUIRED
surfaces and wires them into `<head>`:
- **SEO surface (11c).** `<title>`, meta description, canonical URL, semantic HTML, JSON-LD
  `schema.org SoftwareApplication`, plus root-level `sitemap.xml`, `robots.txt`, and **`llms.txt`**
  (machine-readable summary for AI crawlers). Premise: GitHub/the open web is the new AI-world
  social media — most repos never SEO/AI-enable, so this is a real edge.
- **Brand & social meta (11d).** Open Graph (`og:title/description/image/url`) + Twitter Card
  (`summary_large_image`) pointing at the **1200×630 SocialCard**, and the full favicon-set link
  tags (favicon + `apple-touch-icon` + standard sizes) from `BuildContext.brand`. The authored
  tagline drives `og:description` and the card copy.

The checkpoint cue is sharp: zero dangling refs/tokens; the pack opens, the KB loads, search
returns real passage TEXT; **the MCP server's `lookup_symbol` / `get_entrypoints` / `get_dep_graph`
each return real data** (proving the three structured JSONs shipped); **the authored
`<slug>-primer.md` is present in the pack's `for-humans/` half**; **and the SEO presence check
passes** (title + meta description + canonical + JSON-LD + `sitemap.xml` + `robots.txt` + `llms.txt`
+ OG/Twitter meta + favicon links all present). Publishes `PageAssembled` into `BuildContext.page`
(incl. `seo`) / `BuildContext.pack`. No string markers are matched here — the component system
consumes typed slots from `BuildContext`.

### 6.6 Quality (the heart — §12)
Renders the assembled Page **LIVE** in a real browser — Playwright against the **locally-served**
assembled site (live pixels, **not** a deployed URL; there is **no pre-quality deploy**) — at
390px (mobile) and 1440px (desktop), takes
full-page screenshots, and runs the **dual-gate** vision scoring (A1–A5 substance, B1–B5 craft)
as a harsh critic. The gate also judges the **SocialCard** and the **SVG diagrams** for delight +
craft (they fall under B4 polish / B5 imagery craft), and an **SEO-presence check** joins the
per-station cues (§12.3). Produces a `Scorecard` (`QualityGraded`). If any criterion < 95 on either
device, it emits `RefineRequested` naming the exact weakness and loops (Station 7). It is the
**completion authority**: only this context can emit `BuildPassed`, and only when MIN ≥ 95 on
both devices with the vision-model + operator (two eyes) agreeing; the owner is the post-delivery
**third eye** (§6.8 / §12.4), not a precondition of this S7 gate.

### 6.7 Publishing
Creates the ExplainerRepo, invites the TargetOwner as a collaborator (best-effort), deploys the
Page to its own URL, and sets **RepoSEO** on the ExplainerRepo — GitHub **topics** + a strong
**description** (via API), so the repo itself is discoverable (Station 8). Checkpoint cue: the
LiveURL returns 200 **unauthenticated**; repo is public; owner invited; **topics + description
set**. Publishes `Deployed` into `BuildContext.deployment` (incl. `repoTopics/description`).
(Quality grades the page on a LOCAL Playwright render of the assembled site — so Publishing is the
**FIRST and only** deploy, of an already-passed page: QUALITY (S7) precedes PUBLISH (S8), per
ADR-0005.)

**Station 8b — README PR (OPTIONAL, 11b).** If accepted, Publishing also offers to enhance the
**TargetRepo**'s README via `~/.claude/skills/readme-enhance` — a clear architectural explanation
+ the shared 11a **SVG diagrams** + an explainer **badge** — and **suggests** GitHub topic/
description improvements for the source repo. This is delivered **ONLY as a pull request** on the
source repo (never a direct push; the author merges or skips). It is off the critical path and is
**quarantined** like any optional step (INV-03): it NEVER blocks, gates, or sinks the core. Result
lands in `BuildContext.readmePr` (a PR URL or "declined/skipped"); failure is a warning only.

### 6.8 Notification
Returns the result inline AND by email (Station 9). Success: LiveURL + ExplainerRepo URL +
AIKnowledgePack link + the **Scorecard and both screenshots** (so the owner is the third eye).
Failure: an honest description of which station failed + a retry path. Checkpoint cue: send
confirmed (SMTP 250). Publishes `Notified`.

### 6.9 Distribution
Three thin doors over the one Brain (§14). Owns no explainer logic — only "validate input, then
run the core (or dispatch a job whose only step runs the core)".

### 6.10 Context Relationships

| Upstream | Downstream | Relationship |
|----------|------------|--------------|
| Distribution | Understanding | Customer-Supplier. `(TargetRepo, email)` is the handoff. |
| Understanding | Authoring | Published Language. RVF KB handle + retrieval interface. |
| Understanding | Assembly (KnowledgePack) | Published Language. RVF KB binary → `make-dropin`. |
| Authoring(Concept) | Visual | Published Language. `ArtDirectionBrief` drives image prompts/altitude. |
| Authoring(Content) | Assembly | Published Language. Arc-shaped content → typed `BuildContext` slots. |
| Visual | Assembly | Published Language. `ImageLadder` + favicon paths. |
| Assembly | Quality | Published Language. The once-rendered Page for LIVE grading. |
| Quality | Authoring/Visual/Assembly | **Refine back-edge** (`RefineRequested`, conformist: they fix exactly what Quality names). |
| Quality | Publishing | Gatekeeper. Only `BuildPassed` (MIN ≥ 95) opens this edge. |
| Publishing | Notification | Customer-Supplier. Outcome supplied; result returned + emailed. |
| GitHub API | Understanding/Publishing | ACL (clone, repo create, invite, set topics/description, open README PR on the source repo — 8b). |
| Image engine (gpt-image-2 primary → gpt-image-1 fallback) | Visual | ACL (ImageGenerationACL — **gpt-image-2 is the VERIFIED primary**: `GET /v1/models/gpt-image-2` → HTTP 200 on 2026-06-28; `gpt-image-1` is the fallback used only if a build-time probe of gpt-image-2 (at Station 4) fails; per ADR-0005 D7 / Station 4 / Appendix image-engine row). |
| ascii-to-svg skill | Visual | ACL (the structural-rung SVG renderer, `~/.claude/skills/ascii-to-svg`; ASCII → xmllint-clean SVG; shared by Page + README PR). |
| Playwright + Vision model | Quality | ACL (ScreenshotGradeACL). |
| RuVector / RVF (`kb/*`) | Understanding/Assembly | ACL (the four `kb/` scripts). |
| SMTP | Notification | ACL (EmailDeliveryACL). |

---

## 7. The Build Aggregate Root

`Build` is the single aggregate root. It owns one `BuildContext` instance for its entire
lifecycle and is the only object permitted to mutate it.

**Aggregate rules:**
1. **Sole owner of `BuildContext`.** Stations fill slots only through the aggregate; tools never
   touch it (P4/P5). This is the consistency boundary.
2. **Station ordering is the aggregate's responsibility.** It advances only on a satisfied
   checkpoint cue + a published domain event (§11). No cue → no advance (INV-04).
3. **Completion is gated by the `Scorecard`.** A `Scorecard` is per-device, and its
   `headlineScore` is the MIN of that device's ten criteria (A1–A5/B1–B5; §8.5). The aggregate
   holds two — mobile and desktop — and cannot reach `Passed` unless **both Scorecards'
   `headlineScore` are ≥ 95** — see INV-05. This binds the mission (§0) into the type system:
   "done" is a number, not a vibe.
4. **The refine loop is internal to the aggregate.** `RefineRequested` re-opens an earlier slot
   (content / visuals / page) and re-enters Quality; it does not create a new Build (state
   machine §10).
5. **Idempotent under BuildId.** Re-executing a station with the same BuildId + inputs yields the
   same observable outcome.
6. **Self-contained.** Each Build is isolated with its own deploy target (INV-01); two Builds
   never share mutable state.

**Invariants the aggregate personally enforces:** INV-01, INV-04, INV-05, INV-07, INV-08
(see §13). INV-13/INV-14/INV-15/INV-17 (SEO surface, social card + favicon set, structural-as-SVG,
verified image primary) are enforced as loud station cues (Assembly / Brand & Social / Visual).
Quarantine of optional async steps (INV-03) — and INV-16 (source-repo touches via PR only) — is
enforced at the context boundary, not inside the aggregate's critical path.

---

## 8. Value Objects

All six are immutable; a "change" produces a new instance. They are the typed slots of
`BuildContext`.

### 8.1 ArtDirectionBrief
The conceived, repo-specific creative direction (output of CONCEIVE, Station 2).
```
ArtDirectionBrief {
  metaphor:       VisualMetaphor      // e.g. "prism" (PhotonLayer), "evidence dossier" (ruvn)
  palette:        Palette             // colours chosen to fit the metaphor
  typePersonality:TypePersonality     // type that carries the metaphor's voice
  layoutRhythm:   SectionArchetype[]  // ordered archetypes → the page's cadence
  heroConcept:    HeroConcept         // the single emotional opening image idea
  copyVoice:      CopyVoice           // tone/register for all authored text
}
```
Validity: metaphor is specific to THIS repo (not generic); every field is filled. Drives both
the `ImageLadder` prompts and the `DesignSystem` token overrides.

### 8.2 ComprehensionArc
The ordered reader-question sequence that drives section AND image order (§9.1). Immutable for a
given Build; its order is law (INV: never show a low-level detail before its high-level frame).
```
ComprehensionArc {
  steps: ArcStep[]   // ordered; each = { question, section, imageJob, altitude }
}
```

### 8.3 ImageLadder
The ordered rungs, each bound to one `ArcStep`, ordered high-level → low-level (altitude
descends as the reader descends). Each rung carries a `medium`: **`svg`** (structural/explanatory
rungs — big-idea, the "aha" insight, architecture, flow — authored ASCII → `ascii-to-svg`) or
**`raster`** (emotional rungs — hero, problem, scenario — via gpt-image-2). The `svg` rungs are
shared verbatim with the optional README PR (11a / §6.7).
```
ImageLadder {
  rungs: ImageRung[]   // each = { arcStep, medium: "svg"|"raster", prompt|ascii,
                       //          altitude, sizePx, url|svgPath, http200?, xmllintOK?, visionOK }
}
```
Validity: every raster rung valid + HTTP 200; every svg rung valid (xmllint-clean) with an ASCII
fallback; each answers its assigned arc question; the sequence is monotonic in altitude (high→low).
Imagery is beautiful AND explanatory (INV-11 / craft, B5).

### 8.4 DesignSystem
The shared render target distilled from the best of the 6 example sites. The invariants live
here in code; expression (§8.1) is composed onto it.
```
DesignSystem {
  tokens:           DesignTokens        // colour/space/type scales (brief overrides a subset)
  components:       Component[]          // hero, problem, what-it-is, insight, how, usecases, start, pack
  responsiveSkeleton:Skeleton           // mobile + desktop, no horizontal overflow by construction
  requiredSections: SectionId[]         // the arc's sections — all must be present
  seoHead:          SEOSurface          // title, meta desc, canonical, JSON-LD SoftwareApplication,
                                        //   sitemap.xml, robots.txt, llms.txt (11c)
  socialMeta:       SocialMeta          // OG + Twitter Card (summary_large_image) → 1200×630 card,
                                        //   favicon-set link tags (11d)
  builtInQA:        QAAffordance[]      // contrast, alt-text, semantics, tap-targets, SEO-presence baked in
}
```

### 8.5 Scorecard  ← load-bearing (the completion criterion)
The dual-gate QA result. First-class because "done" is defined by it (§0, §12).
```
Scorecard {
  device: "mobile(390)" | "desktop(1440)"
  gateA: {  // substance — "do they actually get it?"
    A1_visualEffectiveness: Score   // compelling vs flat/forgettable
    A2_storytelling:        Score   // tells a story vs lists facts
    A3_cluelessToConvinced: Score   // zero-knowledge → why → examples → "oh, cool"
    A4_usefulnessToMe:      Score   // explicitly answers "how is this useful to YOU"
    A5_arcCompleteness:     Score   // never-seen → ready-to-implement
  }
  gateB: {  // craft — "did someone who gives a shit make this?"
    B1_typographyHierarchy: Score   // intentional, ranked vs jangly
    B2_alignmentGrid:       Score   // aligned vs subtly-off/amateur
    B3_spacingRhythm:       Score   // breathes vs cramped/random
    B4_strengthPolish:      Score   // cohesive/deliberate vs generic AI slop
    B5_imageryCraft:        Score   // beautiful + explanatory + high→low vs pretty-but-useless
  }
  rationales: Map<criterion, string>  // each cites what the vision model SAW
  headlineScore: int                  // = MIN across all 10 criteria (only as good as worst line)
  passed: bool                        // headlineScore >= 95
}
```
A Build holds **two** Scorecards (one per device); it passes only when BOTH `passed` are true.
`Score` ∈ [0,100]. `headlineScore` is the MINIMUM, never the mean — see §12 / INV-05.

### 8.6 BuildContext  ← the one in-memory contract
The single object the Brain owns; one slot per station; the death of string-coupled markers (P5).
```
BuildContext {
  buildId:        BuildId
  validation:     { url, reachable, authMode }            // Station 0
  understanding:  { repoName, kbHandle, passageCount }    // Station 1  (RVF KB handle)
  brief:          ArtDirectionBrief                        // Station 2
  content:        { arc: ComprehensionArc, sections }     // Station 3
  visuals:        ImageLadder                              // Station 4 (raster rungs + svg rungs)
  brand:          { faviconSet[], appleTouchIcon,         // Station 5 (Brand & Social)
                    socialCard: { px: "1200x630", url },  //   designed share card, tagline baked in
                    og, twitter, derivedFromHero: true }
  page:           Page                                     // Station 6 (incl. seo: SEOSurface +
                                                           //   social meta wired into <head>)
  pack:           AIKnowledgePack                          // Station 6 (overlaps from S1)
  scorecard:      Scorecard[]                              // Station 7 (mobile + desktop, history;
                                                           //   graded on a LOCAL Playwright render
                                                           //   of the assembled site — no deploy)
  deployment:     { explainerRepoUrl, liveUrl, http200,   // Station 8 (the FIRST + only deploy)
                    repoTopics[], repoDescription }        //   RepoSEO on the ExplainerRepo
  readmePr?:      { prUrl | "declined", svgsShared[],     // Station 8b (OPTIONAL; never blocks core)
                    sourceRepoSeoSuggested }
  notification:   { emailSent, smtp250, inlineReturned }  // Station 9
}
```
Each tool receives ONLY its slice (e.g. `genImage` gets a rung's prompt, not the whole context).

---

## 9. The Comprehension Arc & Image Ladder

### 9.1 The arc drives sections AND image order
The reader asks a **sequence** of questions; every section/image answers the NEXT one as it
forms. **Never show a low-level detail before the high-level frame that makes it legible.**

| Reader's question | Section | Image job (altitude) | Medium |
|---|---|---|---|
| What world am I in? | Hero | The metaphor — emotional, gorgeous, HIGH | **raster** (gpt-image-2) |
| Why does this exist? | The problem | A relatable problem illustration (human, not schematic) | **raster** (gpt-image-2) |
| What does it actually do? | What it is | The big-idea diagram — whole thing in one friendly picture | **SVG** (ascii-to-svg) |
| Why is it elegant/clever? | The insight | Conceptual diagram of the ONE clever move (the "aha") | **SVG** (ascii-to-svg) |
| How is it built / works? | How it works | Architecture/flow diagram — descend ONE level, clean+labeled | **SVG** (ascii-to-svg) |
| Could I use this? | Use cases | A scenario picture — someone like the reader succeeding | **raster** (gpt-image-2) |
| How do I start? | Get started | A quickstart visual — path to first run (flow) | **SVG** (ascii-to-svg) |
| (my AI gets it too) | The pack | The dual-output diagram (page for humans, KB for their AI) | **SVG** (ascii-to-svg) |

**Medium rule (11a):** structural/explanatory rungs (big-idea, insight, architecture, flow,
quickstart, pack) render as crisp **SVG** via `ascii-to-svg` (vector clarity, shared with the
README PR); emotional/illustrative rungs (hero, problem, scenario) render as **raster** via
gpt-image-2 (feeling/metaphor).

### 9.2 Imagery rules (encoded in `ImageLadder` validity + B5)
Pictures must be BOTH beautiful AND explanatory (structure/flow diagrams that pull it together)
— never pretty-but-useless, never geeky-low-level-first. **High level → down.** The ladder's
altitude sequence is monotonic; a rung that breaks the order fails B5 and triggers `RefineRequested`.

### 9.3 Invariants vs Expression (the reliability/uniqueness split)
| | Invariants (always true, in code — `DesignSystem` + INV-* + QA) | Expression (always differs, art-directed — `ArtDirectionBrief`) |
|---|---|---|
| Responsive | mobile + desktop, no overflow | — |
| Accessible | contrast, alt, semantics | — |
| Has the answers | what / why / how present | — |
| Grounded | no claim without a KB source | — |
| Ships the pack | AIKnowledgePack always included | — |
| SEO present | title · meta · canonical · JSON-LD · sitemap.xml · robots.txt · llms.txt always present | — |
| Ships social card | OG + Twitter meta · 1200×630 card · full favicon set always present | — |
| Structural diagrams | the structural rungs are SVG (ascii-to-svg), shared page + README | — |
| Passes the gate | MIN ≥ 95 both devices (social card + SVGs judged too) | — |
| Metaphor | — | prism / dossier / orb … |
| Palette · Type | — | fitted to the metaphor |
| Layout rhythm | — | composed from archetypes |
| Hero · Imagery | — | bespoke per repo |
| Social card design | — | bespoke (tagline baked in, on-brand) |
| Copy voice | — | bespoke per repo |

Reliability comes from the left column (construction); uniqueness comes from the right
(judgment). Neither is optional.

---

## 10. The Build State Machine (Stations 0–9 + the refine back-edge)

Every transition is triggered by a domain event and committed only after the station's
checkpoint cue is satisfied with positive evidence (fail loud, never silent — INV-04).

### 10.1 States and checkpoint cues

| # | State (Station) | Checkpoint cue (loud postcondition) |
|---|---|---|
| 0 | `Validating` | URL parsed; TargetRepo reachable (incl. private/own, authenticated) — or stop with a clear reason. |
| 1 | `Understanding` | `kb/build-kb.mjs` wrote the canonical `<slug>-kb.rvf` (explicit `embed` block set — not `.small.rvf`); it answers "what is this repo?" correctly; repo named correctly; the three structured JSONs (`-symbols.json` / `-dep-graph.json` / `-entrypoints.json`) exist; **the authored `<slug>-primer.md` exists** (without it the S6 pack builder hard-fails at its line-79 `must()`). |
| 2 | `Conceiving` | `ArtDirectionBrief` is specific to THIS repo; the metaphor fits. |
| 3 | `Authoring` | All arc questions answered; zero placeholder text; every claim traceable to a KB passage. |
| 4 | `Visualizing` | Every raster rung valid + HTTP 200 (gpt-image-2, the verified primary); every structural rung valid SVG (ascii-to-svg, xmllint-clean); each answers its arc question at the right altitude. |
| 5 | `Brand & Social` | Full favicon set (hero-derived) + a designed 1200×630 social card (tagline baked in) + OG/Twitter meta ready. |
| 6 | `Assembling` | Page rendered once; zero dangling refs/tokens; pack opens, KB loads, search returns hits; SEO surface present (title · meta · canonical · JSON-LD · sitemap.xml · robots.txt · llms.txt) + social/favicon links wired. |
| 7 | `QualityRefining` ⟲ | Every criterion ≥ 95 on BOTH devices, social card + SVGs judged too (else loop). |
| 8 | `Publishing` | Live URL 200 unauthenticated; repo public; owner invited; GitHub topics + description set. |
| 8b | `ReadmePR` (optional) | If accepted: a PR is opened on the SOURCE repo (architectural explanation + shared SVGs + explainer badge); never a direct push; NEVER blocks the core. |
| 9 | `Notifying` | Inline result returned AND email send confirmed (SMTP 250). |
| ✓ | `Passed` (terminal) | MIN ≥ 95 both devices; vision-model + operator agree; live + delivered. |
| ✗ | `Failed` (terminal) | A cue failed; reason surfaced inline + by email; never silent. |

### 10.2 Transitions

```
Validating
  -- RepoReachable --> Understanding
  -- Unreachable / unauthorized --> Failed (clear reason)

Understanding
  -- RepoUnderstood (RVF KB built; passages > 0; named correctly) --> Conceiving
  -- CloneFailed / KBFailed --> Failed
        (side-effect: AIKnowledgePack build MAY start now and overlap S2+S3)

Conceiving
  -- ConceptDrafted (ArtDirectionBrief specific + metaphor fits) --> Authoring
  -- ConceiveFailed --> Failed

Authoring
  -- ContentAuthored (arc complete; no placeholders; claims grounded) --> Visualizing
  -- AuthoringFailed --> Failed

Visualizing
  -- VisualsGenerated (raster rungs 200 via gpt-image-2; structural rungs valid SVG via
        ascii-to-svg; all on-altitude) --> Brand & Social
  -- AllImagesFailed --> Failed
        (single rung soft-fail: regenerate that rung; never sink the Build)
        (gpt-image-2 build-time-probe fail: fall back loud to gpt-image-1; never silent)

Brand & Social
  -- BrandAssembled (full favicon set + 1200×630 social card + OG/Twitter meta) --> Assembling
  -- BrandPartial --> Assembling (warning; default icon / skip card — never sinks the Build)

Assembling
  -- PageAssembled (zero dangling refs; pack opens + loads + searches; SEO surface present:
        title/meta/canonical/JSON-LD/sitemap/robots/llms.txt + social/favicon links) --> QualityRefining
  -- AssemblyFailed --> Failed

QualityRefining   [LOOP — the back-edge]
  (renders the assembled page LIVE in a real browser — Playwright against the LOCALLY-served
   assembled site (live pixels), NOT a deployed URL; no deploy happens until S8 — see §12.1)
  -- QualityGraded(min >= 95 both devices, two eyes: vision + operator) == BuildPassed --> Publishing
  -- RefineRequested(criterion C, device D, "what it saw") -->
        re-open the smallest responsible slot (content | visuals | page),
        apply the named fix, re-render, re-score, --> QualityRefining   [loop back]
  -- RefineLimitExceeded (cannot reach 95) --> Failed (FLAG honestly; never ship slop)

Publishing
  -- Deployed (live 200 unauth; repo public; owner invited; topics + description set) --> Notifying
  -- PublishFailed --> Failed
  -- CollaboratorInviteFailed --> Notifying (warning only)
  -- RepoSeoFailed --> Notifying (warning only)
        (optional side-branch, 8b: if the owner accepts, openReadmePr → ReadmePrOpened
         (PR on the SOURCE repo: explanation + shared SVGs + badge; + source-repo SEO
         suggestions). Best-effort, quarantined (INV-03): ReadmePrFailed / declined never
         blocks — it only adds a note to the result.)

Notifying
  -- Notified (inline returned; SMTP 250) --> Passed
  -- NotificationFailed (SMTP error) --> Passed (delivery failure is NOT a Build failure;
        but the failure path ALWAYS attempts the failure email)

Failed (terminal): reason surfaced inline + by email; StudioQuarantine never reaches here.
```

### 10.3 Runtime parallelism (speed, without coupling)
The critical path is `S1→S2→S3→S4(slowest image)→S6→S7(maybe loops)→S8→S9`. S0 (validate) is
effectively instant and S5 (Brand & Social) runs parallel-off-path after the hero, so neither sits
on the critical line. Off the critical path, in parallel:
- **All raster rungs at once** (S4) — the ladder generates concurrently via gpt-image-2.
- **Structural SVG rungs** (S4) — drafted as ASCII during authoring (S3) and converted by
  `ascii-to-svg`; vector, fast, off the raster path.
- **Favicon set + social card right after the hero** (S5, Brand & Social).
- **The AIKnowledgePack builds as soon as S1's KB exists** — it overlaps S2 + S3.
- **The optional README PR** (8b) runs after Publish, fully off the critical path — quarantined,
  never blocks.

Parallelism is a scheduling optimisation only; it never lets one station read another's files —
all results land in their `BuildContext` slot (P5).

### 10.4 The refine back-edge (why it's a loop, not a gate)
`QualityRefining` is the only state with a self-edge. `RefineRequested` carries `(criterion,
device, what-it-saw)` and re-opens the **smallest** slot that can fix it — a B1 typography miss
re-opens `page`; an A4 "not useful to me" miss re-opens `content`; a B5 altitude miss re-opens
`visuals`. Re-render → re-score (locally, no deploy). The loop exits only on MIN ≥ 95 both devices, or
fails honestly at the refine limit. This is the mission's minimum bar made executable.

---

## 11. Domain Event Catalogue

The ten primary events (per the state machine §10; tabulated below) plus the loop/terminal events.
Each carries its BuildId and the StationEvidence that proves its checkpoint cue.

| Event | Emitted by | Payload / evidence | Advances to |
|---|---|---|---|
| **RepoUnderstood** | Understanding | RVF KB path, passageCount > 0, repoName | Conceiving |
| **ConceptDrafted** | Authoring(Concept) | ArtDirectionBrief (metaphor + palette + type + rhythm + hero + voice) | Authoring(Content) |
| **ContentAuthored** | Authoring(Content) | filled arc sections, retrieval log (grounding proof), zero placeholders | Visualizing |
| **VisualsGenerated** | Visual | ImageLadder (raster rungs url + 200 via gpt-image-2; svg rungs xmllint-clean via ascii-to-svg; altitude + visionOK) | Brand & Social |
| **BrandAssembled** | Visual (Brand & Social) | full favicon set (hero-derived) + 1200×630 social card + OG/Twitter meta | Assembling |
| **PageAssembled** | Assembly | Page (zero dangling refs) incl. SEO surface (title/meta/canonical/JSON-LD/sitemap/robots/llms.txt) + social/favicon links, AIKnowledgePack (opens/loads/searches) | QualityRefining |
| **QualityGraded** | Quality | two Scorecards (mobile + desktop), per-criterion rationales | (decision) |
| **RefineRequested** | Quality | criterion, device, "what it saw", target slot to re-open | QualityRefining (loop) |
| **BuildPassed** | Quality | MIN ≥ 95 both devices; two-eye (vision + operator) attestation | Publishing |
| **Deployed** | Publishing | explainerRepoUrl, liveUrl, http200-unauth, ownerInvited, repoTopics + description set | Notifying |
| **Notified** | Notification | inlineReturned, SMTP 250, payload (URL + repo + pack + scorecard + screenshots + social-card preview + any source-repo SEO suggestions) | Passed |

Supporting/terminal events: `RepoReachable`, `Unreachable`, `BrandPartial` (favicon/card
soft-fail → default icon), `ReadmePrOpened` (OPTIONAL 8b — PR on the source repo; `ReadmePrFailed`/
declined is a warning, never reaches Failed), `BuildFailed` (any cue failure → loud surfacing),
`StudioDeferred` (quarantine fallback; never reaches Failed).

---

## 12. The QA Dual-Gate as First-Class Domain (the heart)

QA is modeled, not bolted on: the `Scorecard` value object (§8.5) + the `QualityGraded` event +
the `RefineRequested` loop are the spine of completion. The rendered **result** is judged on real
pixels — not on "code passed."

### 12.1 How a grade is produced
1. The gate renders and judges the Page on **real pixels served LOCALLY** — Playwright drives a
   real browser against the **assembled site** (live pixels: a real browser rendering the real
   assembled page), **NOT** a deployed production URL. There is **no pre-quality deploy**: QUALITY
   (S7) precedes PUBLISH/DEPLOY (S8), and only an **already-passed** page is ever deployed. Each
   refine iteration re-renders locally and re-grades — nothing is deployed in the loop. Publishing
   (S8) is then the **FIRST and only** deploy: it provisions the PUBLIC deploy (new ExplainerRepo +
   its own URL) for the already-great page, recorded in `BuildContext.deployment`.
2. **Playwright** loads the locally-served page at **390px (mobile)** and **1440px (desktop)** and
   takes **full-page** screenshots.
3. A **vision model**, prompted as a **harsh critic**, scores each criterion 0–100 **with a
   written rationale citing what it SEES**, producing one `Scorecard` per device.

### 12.2 The two gates (exact criteria — both must be modeled, both scored 0–100)

**Gate A — "Do they actually get it?" (substance)**
- **A1 Visual effectiveness** — compelling vs flat/forgettable.
- **A2 Storytelling** — tells a story vs lists facts.
- **A3 Clueless→convinced** — zero knowledge → why it matters → real examples → "oh, cool".
- **A4 Usefulness-to-ME** — explicitly answers "how is this useful to YOU" (cures engineer-blindness).
- **A5 Completeness of the arc** — never-seen → ready to implement.

**Gate B — "Did someone who gives a shit make this?" (craft / anti-slop)**
- **B1 Typography & hierarchy** — intentional, readable, ranked vs jangly.
- **B2 Alignment & grid** — aligned vs subtly-off/amateur.
- **B3 Spacing & rhythm** — breathes, consistent vs cramped/random.
- **B4 Strength & polish** — cohesive, deliberate vs generic AI-template slop.
- **B5 Imagery craft** — beautiful + explanatory + sequenced high→low vs pretty-but-useless.
  **This includes the SVG diagrams (ascii-to-svg, crisp + labeled) AND the 1200×630 social card
  (delight + on-brand + tagline legible)** — both are judged here, not waved through.

Two gates exist because "they don't get it" (substance) and "jangly AI slop" (craft) are
**different failures**; a page can fully pass one and fail the other.

**SEO presence is a per-station cue, not a 0–100 craft line.** It is verified as a hard
postcondition at Assembly (S6: title · meta · canonical · JSON-LD · sitemap.xml · robots.txt ·
llms.txt · OG/Twitter · favicon links) and at Publish (S8: GitHub topics + description). A missing
SEO element fails the station cue (INV-04 / INV-13), exactly like any other loud postcondition.

### 12.3 The floor and the headline (INV-05)
- **Floor:** every criterion ≥ **95** on **BOTH** mobile AND desktop. Non-negotiable.
- **Headline score = the MINIMUM** across all criteria — the page is only as good as its worst
  line. The mean is never used.
- Below 95 on anything → the gate **names the exact weakness** (which criterion, which device,
  what it saw) → `RefineRequested` → refine just that → re-render → re-score → **LOOP** until
  MIN ≥ 95.
- If a repo genuinely cannot reach 95, the Build **FLAGS honestly** and fails — it never ships
  slop and calls it done (the mission's hard line).

### 12.4 Three eyes on the actual pixels (across the lifecycle)
1. **The vision model** scores each criterion with a written rationale citing what it sees (S7).
2. **The operator (Claude)** views the same screenshots before declaring done (S7).
3. **The owner** is the **post-delivery third eye**: at Notify (S9, §6.8) they receive the **same**
   `Scorecard` + the mobile AND desktop screenshots the gate used, and judge by eye. This is
   structurally downstream of `BuildPassed` (S7) and Publishing (S8) — the owner cannot attest at
   the moment `BuildPassed` is emitted. **Owner rejection re-opens a refine/rebuild** (the same
   back-edge as `RefineRequested`), so the third eye closes across the lifecycle.

The **S7 gate** (`BuildPassed`) requires **two eyes** — vision model + operator — plus MIN ≥ 95 on
both devices. "Done" across the full lifecycle = real screenshots, ≥ 95 on every line of both
rubrics, both devices, **all three eyes agree** (owner included, post-delivery). See INV-05 and §7
rule 3.

---

## 13. Numbered Invariants (INV register)

These hold for every Build. The aggregate (§7) or a context boundary enforces each.

- **INV-01 — Build isolation.** Each Build is self-contained with its own per-build deploy target;
  Builds never share mutable state.
- **INV-02 — Responsive-great-verified.** A Build passes only with both viewports (390 + 1440)
  graded ≥ 95 on real screenshots.
- **INV-03 — Quarantine of long-async/optional steps.** Studio (or any optional long-async step)
  is quarantined and optional; it NEVER blocks or sinks the core (StudioQuarantine).
- **INV-04 — Never fail silently.** Every station has a loud postcondition (its checkpoint cue);
  any failure surfaces inline AND by email. A station that advances without evidence is a defect.
- **INV-05 — Never ship below 95.** The dual-gate floor (MIN of A1–A5/B1–B5 ≥ 95 on BOTH devices,
  three eyes) is the completion criterion. It is the literal gate on `Build.Passed`.
- **INV-06 — Grounded-in-KB.** No claim without a KB source; all grounding flows through HNSW
  retrieval (`kb/ask-kb.mjs`) against the RVF KB. No invented claims; no flat-JSON embeddings.
- **INV-07 — Ships-the-pack.** Every explainer includes the downloadable AIKnowledgePack — the
  for-AI half (`.rvf` + `.passages.jsonl` + `.ids.json` + the three structured indexes
  `<slug>-symbols.json` / `<slug>-dep-graph.json` / `<slug>-entrypoints.json` so all four MCP tools
  return data, + `ask-kb.mjs` + `kb-mcp-server.mjs`) AND the for-humans half (the authored
  `<slug>-primer.md`) — built by the **studio-less** variant of `kb/make-dropin.mjs` (§6.5).
- **INV-08 — One-source-of-truth.** All three adapters call the identical Brain/Skill; no adapter
  contains explainer logic of its own.
- **INV-09 — Brain/Tools split.** Tools are pure, receive only their args, return
  `{ ok | loud failure }`, and never read the `BuildContext` or another tool's files.
- **INV-10 — Single render, no string coupling.** The Page is rendered once from the
  `DesignSystem` consuming typed `BuildContext` slots; no `<!-- MARKER -->` string handoffs.
- **INV-11 — Arc/altitude order.** No image or section appears before the higher-level frame that
  makes it legible; the `ImageLadder` altitude sequence is monotonic high→low.
- **INV-12 — Idempotent under BuildId.** Re-running a station with the same BuildId + inputs
  yields the same observable outcome.
- **INV-13 — SEOPresent.** Every Page ships the full SEO surface: `<title>`, meta description,
  canonical URL, semantic HTML, JSON-LD `schema.org SoftwareApplication`, `sitemap.xml`,
  `robots.txt`, and `llms.txt`. Verified as a hard cue at Assembly (S6).
- **INV-14 — ShipsSocialCard.** Every Page ships Open Graph + Twitter Card (`summary_large_image`)
  meta pointing at a designed **1200×630** social card (tagline baked in) plus the full favicon set
  (favicon + apple-touch-icon + standard sizes). Verified at Brand & Social (S5) + Assembly (S6).
- **INV-15 — StructuralDiagramsAsSVG.** The structural/explanatory ladder rungs (big-idea, the
  "aha" insight, architecture, flow, quickstart, pack) are SVG via `ascii-to-svg` (xmllint-clean,
  ASCII fallback) — never raster — and the SAME SVGs are shared by the Page and the README PR.
- **INV-16 — SourceRepoTouchedViaPROnly.** Any change to the TargetRepo (README enhancement +
  source-repo SEO suggestions) is OPTIONAL, offered, and delivered ONLY as a pull request — never
  a direct push. It is quarantined (INV-03) and NEVER blocks, gates, or sinks the core.
- **INV-17 — VerifiedImagePrimary.** Raster generation uses **`gpt-image-2` as the verified
  primary** (`GET /v1/models/gpt-image-2` → HTTP 200, confirmed 2026-06-28); **`gpt-image-1` is the
  fallback ONLY**, used solely if a **build-time availability probe** of `gpt-image-2` (at Station 4)
  fails. The build never silently downgrades and never treats gpt-image-2 as unproven.

---

## 14. Distribution — the three doors over one core

All three execute the **identical** Brain/Skill (INV-08). None holds explainer logic.

1. **Plugin (BUILD FIRST).** `.claude-plugin/plugin.json` + `commands/repo-explainer.md` +
   `skills/repo-explainer/SKILL.md` (the Brain) + `tools/*` (pure tools) +
   `assets/design-system/` (the `DesignSystem`). This is the canonical home of the core.
2. **npx CLI.** A thin Agent-SDK shell that loads the same skill, points at the user's GitHub,
   and lists their repos. No logic beyond "validate input → run the core."
3. **Website.** A hosted version of the same core. `www/` becomes a thin door: validate, then run
   the core (or dispatch a job whose only step runs the core). No explainer logic of its own.

```
            ┌───────────┐   ┌───────────┐   ┌───────────┐
            │  plugin   │   │  npx CLI  │   │  website  │   (3 thin doors)
            └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
                  └───────────────┼───────────────┘
                                  ▼
                       ONE Brain / Skill (the core)
                       skills/repo-explainer/SKILL.md
```

---

## 15. Target Layout & the Real Files This Model Wraps

```
.claude-plugin/plugin.json
commands/repo-explainer.md
skills/repo-explainer/SKILL.md          ← THE BRAIN (one source of truth)
tools/                                   ← pure tools (mechanics only)
  buildKb.* askKb.* genImage.* asciiToSvg.* makeSocialCard.*
  screenshot.* scoreVision.* makeDropin.* zip.* deploy.* sendEmail.*
  cloneRepo.* createRepo.* inviteCollaborator.* setRepoSeo.* openReadmePr.*
                                                  ← the github.* triad + SEO/PR
                                                    (S0/S1 clone · S8 repo-create/topics · invite
                                                     · optional 8b README PR on the source repo)
assets/design-system/                    ← the DesignSystem (tokens + components + skeleton
                                            + SEO head + social/favicon meta)

kb/                                       ← REUSED, NOT REBUILT (P3) — one guard change (§6.5)
  build-kb.mjs        → Understanding (Station 1): builds the RVF KB (canonical .rvf via embed block)
  extract-symbols.mjs → Station 1: writes <slug>-symbols.json     (pack prerequisite)
  dep-graph.mjs       → Station 1: writes <slug>-dep-graph.json   (pack prerequisite)
  entrypoints.mjs     → Station 1: writes <slug>-entrypoints.json (pack prerequisite)
  index-primer.mjs    → Station 1: indexes the authored <slug>-primer.md into the store
  ask-kb.mjs          → grounding retrieval (INV-06)
  make-dropin.mjs     → Assembly (Station 6): builds the AIKnowledgePack via its --no-studio variant (INV-07)
  kb-mcp-server.mjs   → the MCP server shipped inside the pack (4 tools; 3 read the structured JSONs)

www/                                      ← thin website door (validate → run core)

DELETED (retired with the pipeline, P2):
  .github/workflows/build-explainer.yml
  scripts/phase*.mjs            (incl. the duplicate scripts/phase2-build-kb.mjs)
  scripts/knowledge-pack-assets/  (the fork of kb/)
```

**Externals:** raster generation uses **`gpt-image-2` as the VERIFIED PRIMARY** — confirmed in
this project on 2026-06-28 via `GET https://api.openai.com/v1/models/gpt-image-2` → HTTP 200
`{id: gpt-image-2, owned_by: system}` (per ADR-0005 **D7** / **Station 4 (VISUALIZE)** / the
Appendix image-engine row). Generate at **quality `high`**, **hero 1536×1024**, **raster
section images 1024×1024** (gpt-image-2 valid sizes: `1024×1024`, `1024×1536`, `1536×1024`,
`auto`). **`gpt-image-1` is the FALLBACK ONLY**, used solely if a **build-time availability probe**
(at Station 4) of `gpt-image-2` fails — the build never makes gpt-image-1 the default and never
treats gpt-image-2 as unproven. Structural/explanatory rungs are **not** raster at all: they render as SVG via the
`ascii-to-svg` skill (`~/.claude/skills/ascii-to-svg`). The optional README PR (8b) uses
`readme-enhance` (`~/.claude/skills/readme-enhance`). QA screenshots via **Playwright** at 390px +
1440px; grading by a **vision model** as a harsh critic. The four `kb/*.mjs` files are the real,
working KB engine the model wraps — no second implementation exists.

---

*End of model. The through-line, start to finish: one Brain authors a bespoke, art-directed
explainer; pure Tools do the mechanics; one `BuildContext` carries the work; the dual-gate QA at
≥ 95 on both devices with three eyes is the definition of done. If a stranger doesn't smile,
it isn't finished.*
