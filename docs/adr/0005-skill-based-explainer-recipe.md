# ADR-0005: The Skill-Based Explainer Recipe — One Brain, Three Doors

Updated: 2026-06-29 10:40:00 EDT | Version 1.7.0
Created: 2026-06-28 00:00:00 EDT

> **v1.7.0 (2026-06-29) — quality-bar reconciliation + implementation-experience.** Owner-signed
> changes to the gate: (1) the literal "≥95 on every axis" floor is replaced by the
> **exemplar-anchored bar — mean ≥ 90 AND minimum axis ≥ 85 on both devices** — because an honest
> harsh grader puts the owner's own praised example sites at ~88 headline / ~92 mean, so a 95-on-every-
> axis floor is mathematically unreachable and would reject those exemplars; the **min ≥ 85 is the
> anti-slop floor** (a raw-ASCII diagram or pretty-but-empty image scores ≈50 and fails the build).
> (2) A new **operator qualitative gate** — five YES/NO questions (the owner's words), all must be YES.
> (3) A new scored axis **A6 Implementation-confidence** + invariant **INV-19 ImplementationExperiencePresent**
> (Get-Started must show the command, what you'll SEE, the steps, the outcome, and what's next).
> (4) **INV-18 ArchitectureAndFlowRequired** is now formally registered (DDD §13). Iteration over a
> few revs is expected by design.

**Status:** Accepted.

**Supersedes (the entire pipeline approach):** the GitHub-Actions phase pipeline modelled by
ADR-0002, ADR-0003, ADR-0004, and ADR-0004a. Specifically this ADR retires the
station-as-cloud-call / marker-coupled-HTML / deploy-then-grade architecture those four documents
describe and replaces it with a single Claude Code **skill** ("the brain") plus pure tools,
exposed through three thin adapters. Where this ADR conflicts with ADR-0002/0003/0004/0004a, **this
ADR governs.** ADR-0004a's `forge-ask.mjs`/`forge-mcp.mjs`/`scripts/phase2-build-rvf-kb.mjs` naming
is explicitly corrected to the real, already-working `kb/` engine names below.

**Confirms (carried forward unchanged):** ADR-0001's repo-primer KB recipe and the `kb/` engine it
produced; the `@ruvector/rvf` + `@xenova/transformers` 384-dim local-embedding toolchain;
**gpt-image-2 as the primary image engine — verified real + available in this project on 2026-06-28**
(`GET https://api.openai.com/v1/models/gpt-image-2` → HTTP 200 `{id: gpt-image-2, owned_by: system}`),
with **gpt-image-1 as the runtime fallback** used only if a build-time availability probe of
gpt-image-2 fails (deeper fallback `imagen-3` → `gemini-2.x-image`; see D7 / Station 4);
per-build deploy isolation; async + email completion.

**Depends-on:** ADR-0001 (the real KB engine: `kb/build-kb.mjs`, `kb/ask-kb.mjs`,
`kb/make-dropin.mjs`, `kb/kb-mcp-server.mjs`).

---

## The Mission (the soul — this is the completion bar, not a slogan)

> Take someone from "I've never seen this before" to "Oh, I get why this was created, the problem
> it solves, what it does, why it's elegant, how it works — and I'm ready to go implement it."

Most engineers ship things assuming people already know why they'd care. They don't. The
explainer's **precise job is to cure that**: show a newcomer why a repo matters and give real-world
examples that make them go "oh, that would be really cool." The **minimum bar** is blunt
and non-negotiable: *a stranger looks at the result and smiles — "that's really cool."* If a build
cannot clear that bar, **it is not done and is not acceptable.** Every decision, station, and gate
below exists to serve that one sentence. The QA system (§"The QA System") is how we prove it on real
pixels rather than asserting it.

---

## Context

### The two-generations problem

The repo carries **two generations of attempts to capture the same magic**, and neither one is the
magic itself:

1. **Generation 1 — the hand-built example sites.** `ruv-explainer-photonlayer/`,
   `ruv-explainer-ruqu/`, `ruv-explainer-ruvn/`, `ruv-explainer-agent-harness-generator/`,
   `ruv-explainer-rufield/`. These are *genuinely good* — each one is a bespoke, art-directed
   explainer with its own metaphor and its own `styles.css`. They are the proof that the magic
   exists. But the magic that produced them — **Claude Code reading a repo and authoring a bespoke,
   art-directed explainer** — was never captured as reusable code. It lived only in a chat session.

2. **Generation 2 — the GitHub-Actions phase pipeline.** `.github/workflows/build-explainer.yml`
   plus `scripts/phase2-build-kb.mjs`, `scripts/phase3-scaffold.mjs`,
   `scripts/phase4-author-content.mjs`, `scripts/phase5-generate-images.mjs`,
   `scripts/phase6-quality-gates.mjs`, `scripts/phase9-send-email.mjs`. This was an attempt to
   *automate* generation 1 by decomposing it into deterministic phases. It is a **brittle re-write
   of the judgment that lived in generation 1** — it tries to replace a thinking author with a chain
   of string-coupled scripts.

The core realization driving this ADR: **the brain (Claude Code authoring the explainer) was the
product all along.** Generation 2 tried to remove the brain and broke. The fix is not to repair the
pipeline; it is to *capture the brain as a skill* and give the tools back their proper, mechanical
role.

### The doubly-dead pipeline (audit findings)

The generation-2 pipeline is not merely fragile — it is dead in two independent ways:

- **Dead at the P2→P3 seam.** Nobody produces `repo-analysis.json` in the shape phases 3–6 expect;
  the downstream phases hard-exit without it. The pipeline cannot complete a single run end-to-end.
- **Dead at GitHub's own gate.** `build-explainer.yml` fails GitHub's workflow validation on every
  push, so even the broken pipeline never starts.
- **It never ships the KB pack.** The thing that makes an explainer special — the downloadable AI
  knowledge pack — is absent from the pipeline output.
- **String-coupled HTML.** P3 emitted `<!-- CONTENT:* -->` / `<!-- IMG:gallery -->` markers that
  P4/P5 had to match by exact string. This incremental-mutation-of-one-HTML-file coupling is the
  structural cause of the brittleness: any phase that changes a marker silently breaks a later phase.
- **A fake KB.** `scripts/phase2-build-kb.mjs` writes plain JSON with no embeddings while the README
  claims a "searchable vector database." The repo *already* has real RVF stores in
  `kb/stores/{photonlayer,ruqu,ruvn,agent-harness-generator}/` built by the `kb/` engine — the
  pipeline forked a worse, fake copy instead of reusing them.

### The other audit findings this ADR acts on

- **No shared design system.** Every example site ships its own `styles.css` with zero shared
  tokens. The audit counted (re-verified at edit time) **six bespoke explainer stylesheets** —
  `ruv-explainer-{photonlayer,ruqu,ruvn,agent-harness-generator,rufield}/styles.css` plus
  `explainer-agentic-qe/styles.css` — and `www/styles.css`, **zero shared tokens**. There is nothing
  to reuse, so every new explainer starts visual craft from scratch — a real source of both effort
  and inconsistency.
- **The real KB engine is excellent and underused.** `kb/build-kb.mjs` + `kb/ask-kb.mjs` +
  `kb/make-dropin.mjs` + `kb/kb-mcp-server.mjs` are working, config-driven, and already produced the
  shipped stores and drop-in zips. This is the engine to wrap, not rebuild.
- **Fictional packages litter the prior ADRs.** `@rvf/forge`, `@ruvector/search-cli`, and
  `@ruvector/mcp-server` all return **npm 404** (re-verified at edit time via `npm view`). Note
  `@ruvector/rvf-mcp-server` **is real** (npm `0.1.4`) but is **NOT used** here — the pack ships the
  in-repo `kb/kb-mcp-server.mjs`, so do not pull the published server in. `@ruvector/rvf` (`^0.2.2`,
  real, query side), its native binary `@ruvector/rvf-node`, and `@xenova/transformers` (`^2.17.2`,
  local ONNX embeddings) are the real packages we depend on. Any decision that names a fictional
  package is void.

---

## Decision

### D1 — ONE Claude Code skill is the single source of truth ("the brain")

The magic is **Claude Code reading a repo and authoring a bespoke, art-directed explainer**. We
capture that magic — for the first time — as **one skill**:

```
skills/repo-explainer/SKILL.md      ← THE BRAIN (judgment: understand, conceive, author, judge)
tools/*                              ← PURE TOOLS (mechanics: embed, image API, screenshot, zip, deploy)
assets/design-system/               ← the shared tokens + components + responsive skeleton
```

The skill owns all **judgment**. The tools own all **mechanics**. This split is the central
anti-brittleness decision (D4). There is exactly one brain; every distribution door (D9) executes
the *identical* skill. This is INV-08 (One-Source-of-Truth).

> **Path note (avoid a collision).** The shared design system lives specifically in the **new
> subdirectory** `assets/design-system/`. A root `assets/` **already exists** in the repo
> (`assets/diagrams/`, `assets/img/`, `assets/readme/`) and is **unrelated** — create
> `assets/design-system/` beside that content, do not overwrite it. (`.claude-plugin/`, `skills/`,
> and `tools/` are correctly absent today and are net-new.)

### D2 — Retire the generation-2 pipeline entirely

Delete / decommission the GitHub-Actions phase pipeline. It is a brittle re-write, broken at the
P2→P3 seam, failing GitHub validation on every push, never shipping the KB pack, and built on
string-coupled HTML markers. Concretely retired:

- `.github/workflows/build-explainer.yml` (the workflow itself)
- `scripts/phase2-build-kb.mjs` (fake JSON KB — duplicates `kb/build-kb.mjs`, worse)
- `scripts/phase3-scaffold.mjs` (emits the `<!-- CONTENT:* -->` markers — the coupling that broke)
- `scripts/phase4-author-content.mjs` (marker-matching author)
- `scripts/phase5-generate-images.mjs` (logic absorbed into a pure `tools/generate-image` tool)
- `scripts/phase6-quality-gates.mjs` (replaced by the dual-gate QA in §"The QA System")
- `scripts/phase9-send-email.mjs` (logic absorbed into a pure `tools/notify` tool)

We do not carry forward the station-as-cloud-call model from ADR-0004. Stations become **ordered
steps the brain runs**, each invoking pure tools — not eleven independently-deployed cloud services
wired by a Gist job record.

### D3 — Reuse the real KB engine; delete the duplicate fork

The KB is **not rebuilt**. The skill's KB tools **wrap the real, working `kb/` engine**:

- `node kb/build-kb.mjs --target <slug>` builds the RVF store. It reads the per-target entry in
  `kb/kb.config.mjs`, force-walks the target tree, chunks structure-aware, embeds every chunk with a
  **local 384-dim ONNX model**, and writes into `kb/stores/<slug>/`:
  - `<slug>-kb.rvf` (+ `.rvf.idmap.json` written by RVF on `close()` — the only persist path)
  - `<slug>-kb.passages.jsonl` (full untruncated chunk text — **required**; an `.rvf` query returns
    only `{id, distance}`, the text lives here)
  - `<slug>-kb.ids.json` (per-id kind/preview index)
  - `<slug>-kb.rvf.embed.json` (embedder sidecar so the *query* uses the same model as the corpus)
  - Build self-reconciles: `chunks == vectors == passages == ids` or it `exit(1)`s.
- **Embedder — explainer targets MUST set an `embed` block (the MiniLM default is *not* the
  operative path here).** The engine's bare default is `Xenova/all-MiniLM-L6-v2` (384-dim) — but on
  that default `build-kb.mjs` (`RVF_SUFFIX = target.embed ? '.rvf' : '.small.rvf'`, line 244) writes
  `<slug>-kb.`**`small`**`.rvf`, while `kb/make-dropin.mjs` globs the literal `<slug>-kb.rvf`; so a
  default-embedder target produces a store the pack builder cannot find and the pack's `must()` check
  fails. Every shipped store is therefore built with an explicit `embed` block
  (`Xenova/bge-small-en-v1.5`: 384-dim, mean-pooled, asymmetric query prefix) so build-kb writes the
  canonical un-suffixed `<slug>-kb.rvf`. **Register a bge-small (or any) `embed` block in
  `kb/kb.config.mjs` for every explainer target.** Both models are 384-dim and cached at
  `kb/models-cache/` so CI never cold-downloads.
- `node kb/ask-kb.mjs <slug> "question" [k]` is the real search CLI. It joins `.rvf` hits to
  `.passages.jsonl` by id and prints **full passages** through an intent-routing + rerank layer.
- `node kb/make-dropin.mjs <slug> <out.zip>` builds the downloadable AI pack (see Station 6 —
  ASSEMBLE + PACK, and INV-07).
- `kb/kb-mcp-server.mjs` is the real MCP server. It exposes **four** tools: `search_kb`,
  `lookup_symbol`, `get_entrypoints`, `get_dep_graph`, returning `content:[{type:'text', text:…}]`.

**Delete the duplicate fork.** `scripts/phase2-build-kb.mjs` is deleted (D2). **Delete
`scripts/knowledge-pack-assets/`** — the real directory holding the misnamed
`forge-ask.mjs` / `forge-mcp.mjs` / `resolve-deps.mjs` / `bundle-package.json` / `README.template.md`
fork that ADR-0004a referenced. It is superseded by the kb/ engine: those forge-* names are corrected
to `kb/ask-kb.mjs` / `kb/kb-mcp-server.mjs`, and the canonical pack builder is `kb/make-dropin.mjs`.
**Never reference** `@rvf/forge`, `@ruvector/search-cli`,
or `@ruvector/mcp-server` — they are npm 404. (`@ruvector/rvf-mcp-server` is real — npm `0.1.4` — but
deliberately **not used**: the pack ships the in-repo `kb/kb-mcp-server.mjs` instead.) The pack's `package.json`
declares exactly `@ruvector/rvf@^0.2.2` + `@xenova/transformers@^2.17.2` (native `@ruvector/rvf-node`
arrives transitively), as `kb/make-dropin.mjs` already does.

### D4 — Anti-brittleness: strict brain/tools split + one BuildContext contract

State it explicitly, because violating it is what killed generation 2:

- **Brain = judgment.** Understand the repo, conceive the art direction, author the content, judge
  the quality. The brain is the only component that "thinks."
- **Tools = mechanics.** Embed, call an image API, screenshot a page, zip a pack, deploy a site,
  send an email. Each tool is **pure and independently testable**: clear input → clear output →
  `{ ok | loud failure }`. A tool never thinks; it never decides "good enough."
- **ONE in-memory data contract = `BuildContext`, owned solely by the brain.** Each station fills
  its own slot. Tools receive **only the args they need** and **never** read another tool's files or
  the whole context. There are **no string-coupled HTML markers** — that coupling is precisely what
  broke the old pipeline (P3's markers that P4/P5 matched by exact string).
- **The page is rendered ONCE** from a component system at assembly time — never mutated
  incrementally by many phases.

`BuildContext` (illustrative shape — owned by the skill, filled station by station):

```
BuildContext {
  repo:        { url, owner, name, private, defaultBranch, clonePath }   // S0–S1
  kb:          { slug, storeDir, rvfPath, passagesPath, embedModel,
                 primerPath }  // S1 — primerPath = the authored <slug>-primer.md (make-dropin must()s it)
  brief:       ArtDirectionBrief  // metaphor, palette, type, layout-rhythm, hero, voice  // S2
  content:     { sections: { hero, problem, whatItIs, insight, howItWorks,
                             useCases, getStarted, pack }, citations[] }  // S3
  visuals:     ImageLadder  // { id, role, prompt, file, dims, status } per arc question  // S4
  brand:       { faviconSet, appleTouchIcon,
                 socialCard: { px, url },         // the 1200×630 S5 card (tagline baked in)
                 og, twitter }                                           // S5 (mirrors DDD §8.6 brand slot)
  site:        { dir, html, css, tokensUsed, packZipPath }               // S6
  scorecard:   Scorecard  // gateA[A1..A5], gateB[B1..B5], per-device, per-iteration  // S7
  publish:     { repoUrl, liveUrl, ownerInvited }                        // S8
  readmePr:    { url, declined } | null                                  // S8b (optional — offered; null when declined)
  notify:      { emailSent, smtpCode }                                   // S9
}
```

Each station has a **loud postcondition** (the "cue"). A station that cannot record its evidence has
not passed (INV-04, Never-Fail-Silently).

> **One contract, two views.** This shape is **illustrative**; it and the DDD's `BuildContext`
> (`docs/ddd/repo-explainer-recipe-domain.md` §8.6) are **the same single contract** modelled under
> two naming conventions — the ADR names slots by station artefact (`repo`/`kb`/`brief`/`content`/
> `visuals`/`brand`/`site`/`scorecard`/`publish`/`readmePr`/`notify`), the DDD names them by domain
> concern (`validation`/`understanding`/`page`+`pack`/`deployment`/`readmePr`/`notification`). Neither
> adds nor drops data versus the other; the `brand` slot and the optional `readmePr?` slot above exist
> in both.

### D5 — Authoring model: "concept-then-render" (the decided fork)

Each explainer is **unique by default, reliable by construction**. Not cookie-cutter, not fully
unconstrained. Two beats:

1. **CONCEIVE (judgment).** Before any rendering, the brain invents *this repo's*
   **art-direction brief**: a **visual metaphor** (PhotonLayer → prism; ruvn → evidence dossier;
   ruqu → Bloch-sphere orb), a **palette + type personality** that fits the metaphor, a **layout
   rhythm** composed from section archetypes, a **hero concept**, and a **copy voice**.
2. **RENDER (mechanics).** Compose that brief onto a **shared design system** — tokens + components +
   responsive skeleton + the required sections + built-in QA.

**Split invariants from expression:**

| | Always true (in code) | Always differs (art-directed) |
|---|---|---|
| **Invariants** | responsive (mobile+desktop), accessible (contrast/alt/semantics), has the answers (what/why/how), grounded in the KB (no invented claims), ships the AI pack, passes the quality gate | — |
| **Expression** | — | metaphor, palette, type, layout rhythm, hero, imagery, copy voice |

Invariants are guaranteed by the design system and the gate. Expression is the brain's job and
**must differ every time** — a templated look is a Gate B failure (anti-slop).

### D6 — The comprehension arc drives sections AND image order

The reader asks a **sequence** of questions; every section and every image answers the **next** one
as it forms in the reader's mind. **Never show a low-level detail before the high-level frame that
makes it legible.**

| Reader's question | Section | Image job (altitude) |
|---|---|---|
| What world am I in? | Hero | The metaphor — emotional, gorgeous, **HIGH** level |
| Why does this exist? | The problem | A relatable problem illustration (human, not schematic) |
| What does it actually do? | What it is | The big-idea diagram — whole thing in one friendly picture |
| Why is it elegant/clever? | The insight | Conceptual diagram of the ONE clever move (the "aha") |
| How is it built / works? | How it works | Architecture/flow diagram — descend **ONE** level, clean + labeled |
| Could I use this? | Use cases | A scenario picture — someone like the reader succeeding |
| How do I start? (and what will I SEE?) | Get started | A quickstart visual — the command, what the run looks like, the steps, what you get, what's next (INV-19) |
| (my AI gets it too) | The pack | The dual-output diagram (page for humans, KB for their AI) |

### D7 — The image ladder: beautiful AND explanatory, high → low (raster feeling + vector structure)

Pictures must be **both beautiful and explanatory** — structure/flow diagrams that pull it together.
Never pretty-but-useless; never geeky-low-level-first. The ladder descends in altitude exactly with
the arc (D6): hero metaphor (highest) → problem → whole-thing diagram → the one clever move →
architecture one level down → use-case scenario → quickstart → the dual-output pack diagram.

**Two render paths, split by rung type (the division of labour):**

- **Emotional / illustrative rungs → raster (`gpt-image-2`).** The hero, the problem illustration, and
  the use-case scenario carry *feeling and metaphor* — they are generated as raster images.
- **Structural / explanatory rungs → vector SVG (the `ascii-to-svg` skill).** The big-idea diagram, the
  "aha" insight, the architecture / how-it-works diagram, and any flow are authored as ASCII first, then
  converted to crisp, professional, accessible SVGs via the `ascii-to-svg` skill
  (`~/.claude/skills/ascii-to-svg`, verified present) — **not** raster. Vector = maximum clarity,
  scalable, never "AI slop"; this is what turns a loose idea into a real, legible solution and fulfils
  the "explanatory pictures, not just pretty pictures" bar. **The same SVGs are shared by the page AND
  the README** (Station 8b) — authored once, reused in both.

**Image engine (raster path) — primary = `gpt-image-2`, VERIFIED real + available:**

- **`gpt-image-2` (OpenAI), quality `high`, is the primary, verified default.** It was confirmed real
  and available in this project on **2026-06-28** via `GET https://api.openai.com/v1/models/gpt-image-2`
  → **HTTP 200** `{id: gpt-image-2, owned_by: system}` — this matches the owner's explicit requirement
  to use gpt-image-2 at max quality. **Hero = 1536×1024; raster section images = 1024×1024.**
  `gpt-image-2`'s valid sizes are **`1024×1024`, `1024×1536`, `1536×1024`, `auto`** (the DALL·E-3
  `1792×1024` is rejected — never use it).
- **Fallback = `gpt-image-1` (OpenAI), used ONLY if a build-time availability probe of `gpt-image-2`
  fails.** `gpt-image-1` is OpenAI's prior shipped model and is the safety net, **not** the default —
  do **not** make it primary. On the expected path the probe of `gpt-image-2` succeeds and the build
  uses `gpt-image-2`; only on a probe failure does it drop to `gpt-image-1` at the same quality/sizes.
- **Deeper fallback order (only if both OpenAI IDs fail):** `imagen-3` → `gemini-2.x-image` (all support
  1536×1024) — re-verify via the same Station 4 probe.
- Each raster image **answers its assigned arc question** — a Gate B5 criterion, not decoration; each
  structural SVG must likewise be crisp and genuinely explanatory.

### D8 — Build ONE shared design system (a real station of the work)

There is no shared design system today — six bespoke explainer stylesheets
(`ruv-explainer-{photonlayer,ruqu,ruvn,agent-harness-generator,rufield}` plus `explainer-agentic-qe`)
plus `www/styles.css`, zero shared tokens. Building
**one coherent design system, distilled from the best of the example sites**, is real work and ships
in `assets/design-system/`: color/space/type tokens, a component set (hero, section, callout,
figure, code block, download CTA, footer), a responsive skeleton verified at 390px and 1440px, the
required arc sections, and built-in QA hooks. Expression (D5) is composed *onto* this system; the
system guarantees the invariants so the brain can spend its judgment on art direction, not on
re-deriving responsive grid math every build.

### D9 — Three thin doors over the one core (plugin first)

Three adapters, all executing the **identical** skill (INV-08). No adapter contains explainer logic
of its own:

1. **Claude Code plugin — BUILD FIRST.** `.claude-plugin/plugin.json` +
   `commands/repo-explainer.md` + `skills/repo-explainer/SKILL.md` (the brain) + `tools/*` (pure
   tools) + `assets/design-system/`.
2. **npx Agent-SDK CLI.** A thin Agent-SDK shell that loads the same skill, points at the user's
   GitHub, and lists their repos.
3. **Hosted website.** `www/` becomes a **thin door**: validate input, then either run the core or
   dispatch a job whose only step runs the core. No explainer logic lives in `www/`.

---

## The Build Recipe — Stations 0–9 (anyone can follow this)

Each station has a **checkpoint cue** that fails **loud**, never silent (INV-04). The brain runs the
stations in order, filling `BuildContext` slot by slot; the tools do the mechanics.

> **Note on station ordering vs ADR-0004.** ADR-0004/0004a insisted DEPLOY < QUALITY because its
> grader screenshotted the *deployed* URL. This ADR supersedes that: because the skill assembles the
> **complete** page in one shot (D4, no incremental deploy-mutate loop), the gate renders and judges
> the page on **real pixels served locally** (Playwright against the assembled site) and only
> **deploys an already-great page**. QUALITY (S7) therefore precedes PUBLISH/DEPLOY (S8). "Render the
> LIVE page" means a real browser rendering the real assembled page — live pixels — not the
> production URL.
>
> **This ADR is canonical on how the gate gets its pixels.** There is **no pre-grade ("scratch")
> deploy** and **no `gradingDeploy` `BuildContext` slot**: the page is rendered **once** (D4) and
> graded on a **locally-served Playwright render** of the assembled site. The **only** deploy is the
> single Station 8 deploy of the already-passed page. Any DDD modelling of an earlier grading-deploy
> (a `gradingDeploy` slot, a transient scratch LIVE URL, a per-iteration re-deploy) is **superseded by
> this render-once / judge-before-deploy decision** and must conform — where the DDD conflicts, this
> ADR governs.

### Station 0 — VALIDATE
- **Do:** Parse the repo URL; confirm the repo is reachable. Support private repos and the owner's
  own repos via authenticated access.
- **Tool:** `tools/validate-repo` (pure: URL/token in → `{reachable, owner, name, private}` out).
- **Cue:** repo is reachable, or **stop with a clear, human reason** (not a stack trace).

### Station 1 — UNDERSTAND
- **Do:** Clone the repo. Run the **real** `kb/` engine to build the RVF KB:
  `node kb/build-kb.mjs --target <slug>` (after registering the target in `kb/kb.config.mjs`
  **with an `embed` block** — see D3; without it build-kb writes `<slug>-kb.small.rvf`, which the
  Station 6 pack builder cannot find). Then **run the structured-extraction build step** —
  `node kb/extract-symbols.mjs <slug>`, `node kb/dep-graph.mjs <slug>`,
  `node kb/entrypoints.mjs <slug>` — which is a **REQUIRED build step, not optional reading**: its
  `<slug>-symbols.json` / `<slug>-dep-graph.json` / `<slug>-entrypoints.json` outputs are
  **prerequisites of the Station 6 pack** and are exactly what the MCP server's `lookup_symbol` /
  `get_dep_graph` / `get_entrypoints` tools read. The brain then reads the repo deeply — using
  `node kb/ask-kb.mjs <slug> "what is this repo?"` and those three structured indexes for exact
  lookups. **AUTHOR the for-humans primer (REQUIRED deliverable).** The brain writes
  `kb/stores/<slug>/<slug>-primer.md` — the natural-language top-down orientation (what it is / its
  concepts / how each works / maturity / where the docs are / how to use it end-to-end). This is a
  **hard prerequisite of the Station 6 pack**: `kb/make-dropin.mjs` line 79 `must()`s
  `<slug>-primer.md` and **throws `missing: <slug>-primer.md`** if it is absent. Only **after** the
  primer is authored does `node kb/index-primer.mjs <slug>` run — it **indexes the authored primer
  into the RVF store** (a write/index step; it *consumes* the existing `<slug>-primer.md`, it does
  **not** create it) so the top-down orientation questions return a synthesized section rather than a
  raw fragment.
- **Tools:** `tools/clone-repo`, `tools/build-kb` (wraps `kb/build-kb.mjs`),
  `tools/extract-structured` (wraps `kb/extract-symbols.mjs` / `kb/dep-graph.mjs` /
  `kb/entrypoints.mjs`), `tools/ask-kb` (wraps `kb/ask-kb.mjs`), `tools/index-primer` (wraps
  `kb/index-primer.mjs` — indexes the authored primer; authoring the primer itself is judgment).
- **Cue:** the KB answers **"what is this repo?" correctly**, the repo is **named correctly**, the
  three structured JSONs (`-symbols.json` / `-dep-graph.json` / `-entrypoints.json`) **exist**, and
  **the authored `kb/stores/<slug>/<slug>-primer.md` exists** (without it the Station 6 pack builder
  hard-fails at its line-79 `must()`). A failed RVF build **hard-fails honestly** — there is **no**
  fallback to a JSON-only analysis (that re-introduces the fake-KB defect; INV-06). Retry once, then
  stop with an honest reason.

### Station 2 — CONCEIVE
- **Do:** The brain writes the **art-direction brief** (D5): metaphor, palette, type personality,
  layout rhythm, hero concept, copy voice — grounded in what the KB revealed about the repo.
- **Tool:** none — this is **pure judgment**, written into `BuildContext.brief`.
- **Cue:** the brief is **specific to THIS repo** and the **metaphor genuinely fits** (a stranger
  would nod). A generic brief is a failure here, not at the gate.

### Station 3 — AUTHOR
- **Do:** Write the content along the comprehension arc (D6), grounded in the KB. Every claim is
  traceable to a passage retrieved via `kb/ask-kb.mjs`.
- **Tool:** `tools/ask-kb` for grounding retrieval; authoring itself is judgment.
- **Cue:** **all arc questions answered, zero placeholder text, every claim traceable** to a KB
  source (INV-06, Grounded-in-KB). No "lorem", no "TODO", no invented capabilities. **The Get-Started
  section is a hard sub-cue (INV-19, ImplementationExperiencePresent): it must show the command, what
  the reader will SEE when they run it, the step-by-step, what they get at the end, what's next, and the
  prerequisites — never a bare "just run this."** A page that explains but leaves the reader unsure what
  to do or what will happen fails A6.

### Station 4 — VISUALIZE (raster feeling + vector structure)
- **Precondition (model-ID probe — fail loud).** Before generating anything, probe the **primary
  verified ID `gpt-image-2`** against this project's live keys (`GET /v1/models/gpt-image-2`) — it is
  **expected to pass** (confirmed HTTP 200 on 2026-06-28). If — and only if — that probe **fails at
  build time**, fall back to **`gpt-image-1`** (then the deeper `imagen-3` → `gemini-2.x-image`). Never
  proceed against an unverified ID and never silently substitute; if even the fallback chain **404s**,
  **stop loud** with the failing ID.
- **Do:** Generate the image ladder + hero (D7), **all visuals in parallel**, on **two render paths**:
  - **Raster (`gpt-image-2`)** for the *emotional* rungs — hero, problem, use-case scenario. **Hero
    1536×1024; raster sections 1024×1024** (valid `gpt-image-2` sizes: `1024×1024`, `1024×1536`,
    `1536×1024`, `auto`).
  - **Vector SVG via the `ascii-to-svg` skill** (`~/.claude/skills/ascii-to-svg`) for the *structural*
    rungs — the big-idea diagram (*"what does it do"*), the "aha" insight, and **two diagrams that are
    MANDATORY on every explainer (INV-18 — the three questions every developer asks):**
    1. an **ARCHITECTURE diagram** (*"how is it constructed"* — modules / components / dependencies), and
    2. a **PROCESS / DATA-FLOW diagram** (*"how does it work"* — the runtime flow).
    Both are **grounded in the repo's REAL structure, not invented**: the architecture diagram is built
    from `kb/dep-graph.mjs` + `kb/extract-symbols.mjs`, the flow from `kb/entrypoints.mjs`. Author the
    ASCII, then convert to crisp accessible SVGs. **These SVGs are emitted once and reused by both the
    page and the README** (Station 8b). This is **REQUIRED**, not optional — structural rungs ship as
    vector, never raster, and the gate (Station 7) **fails/refines** if either the architecture diagram
    or the flow diagram is missing or does not read clearly on **both** devices.
- **Tools:** `tools/generate-image` (pure: prompt + dims + engine → image file or **loud** failure; no
  silent placeholder), `tools/ascii-to-svg` (wraps the `ascii-to-svg` skill: ASCII diagram → accessible
  SVG; pure, **loud-fail** on malformed output).
- **Cue:** **every raster image is valid and HTTP 200**, **every structural SVG renders crisp with its
  accessible text fallback**, and **each visual answers its assigned arc question** (D6/D7). A visual
  that is pretty but answers nothing fails B5 later — catch it here.

### Station 5 — BRAND & SOCIAL
- **Do:** From the **hero's visual identity** (same metaphor/palette) produce the full brand kit:
  (a) a **full favicon set** — the clever hero-derived favicon + `apple-touch-icon` + the standard
  sizes; (b) a dedicated, designed **1200×630 social card** with the authored **tagline baked in**,
  on-brand and inviting, to serve as the Open Graph / Twitter `summary_large_image`. The authored
  tagline drives both the card copy and `og:description`. (The `<head>` Open Graph + Twitter Card meta
  themselves — plus the favicon `<link>`s — are wired at assembly, Station 6.)
- **Tools:** `tools/make-favicon` (full set; runs **right after the hero**, in parallel with the rest
  of S4), `tools/make-social-card` (pure: hero identity + tagline → the 1200×630 card; runs alongside
  the favicon).
- **Cue:** **valid favicon files** (correct dimensions + formats) AND a **valid 1200×630 social card**
  produced; a missing or invalid favicon **or** social card **stops the build loud** (INV-04), never
  substituting a default. The card must look **cool + inviting** when forwarded — its delight + craft
  are judged at the gate (Gate B5).

### Station 6 — ASSEMBLE + PACK
- **Precondition (fail loud).** The authored `kb/stores/<slug>/<slug>-primer.md` (the Station 1
  deliverable) AND the three structured JSONs (`-symbols.json` / `-dep-graph.json` /
  `-entrypoints.json`) MUST already be present — `kb/make-dropin.mjs` line 79 `must()`s the primer and
  **throws `missing: <slug>-primer.md`** if it is absent. If the primer is missing, **stop loud** and
  return to Station 1; never synthesize a placeholder to get past the `must()`.
- **Do:** (a) **Render the page once** onto the shared design system (D8) — compose the brief +
  content + visuals into the component skeleton. (b) Build the **AI knowledge pack** with the
  studio-less pack builder (see the deviation note below):
  `node kb/make-dropin.mjs <slug> <site>/<repo>-knowledge-pack.zip`. The pack ships the
  `for-ai/` half — `<slug>-kb.rvf` + `<slug>-kb.rvf.idmap.json` + `<slug>-kb.rvf.embed.json` +
  `<slug>-kb.passages.jsonl` + `<slug>-kb.ids.json` + **`<slug>-symbols.json` + `<slug>-dep-graph.json`
  + `<slug>-entrypoints.json`** + `ask-kb.mjs` + `kb-mcp-server.mjs` + `kb.config.mjs` +
  `resolve-deps.mjs` + `package.json` declaring `@ruvector/rvf` + `@xenova/transformers` — and the
  `for-humans/` half (the primer +, when present, studio media). The three structured JSONs are the
  Station 1 build-step outputs and are what the MCP server's `lookup_symbol` / `get_dep_graph` /
  `get_entrypoints` tools read; **without them three of the four advertised MCP tools return
  nothing.** The for-humans primer is **also rendered inline** in the page's download section,
  visible without downloading. (c) **Wire the on-page SEO + social head** into the rendered page:
  `<title>`, meta description, canonical URL, semantic HTML landmarks, JSON-LD structured data
  (schema.org `SoftwareApplication` / `SoftwareSourceCode`), the full favicon `<link>`s (Station 5),
  and the **Open Graph + Twitter Card** meta (`og:title`/`og:description`/`og:image`/`og:url` +
  `twitter:card = summary_large_image`, pointing `og:image`/`twitter:image` at the Station 5 social
  card). Emit the site-level **`sitemap.xml`, `robots.txt`, and an `llms.txt`** machine-readable
  summary so AI crawlers find and represent the explainer correctly. *Premise: GitHub — and now the
  open web's AI crawlers — are the new social media for the AI world; few repos are SEO/AI-enabled, so
  this is a real edge.*
- **Deliberate deviation from "carried forward unchanged."** `kb/make-dropin.mjs` as it stands
  carries a hard **D13/V studio guard** (lines 78–92) that `throw`s *"Refusing to build a
  studio-less drop-in"* unless `for-humans/studio/` already contains **both** an audio overview
  **and** a `*report.md`. Because this ADR ships **studio-less first** (INV-03; Runtime parallelism),
  `tools/build-pack` MUST invoke a **studio-less variant** of the pack builder — pass a `--no-studio`
  flag the explainer adds to `make-dropin.mjs`, or fork it to relax the D13/V guard to a warning.
  This is the **one** acknowledged change to the otherwise-reused `kb/` engine; studio media, when it
  later exists, is re-packed on the studio follow-up (INV-03). (Resolves the otherwise-fatal
  contradiction between "reuse make-dropin unchanged," "studio optional," and "ship the pack every
  build.")
- **Tools:** `tools/assemble-page` (component render — one shot, no markers), `tools/build-pack`
  (wraps `kb/make-dropin.mjs` via the studio-less variant above), `tools/seo-head` (pure: brief +
  content + Station 5 social card → `<head>` SEO + JSON-LD + OG/Twitter meta and the `sitemap.xml` /
  `robots.txt` / `llms.txt` files).
- **Cue:** **zero dangling refs or unresolved tokens** in the page; the **pack opens, the KB loads,
  and `node ask-kb.mjs <slug> "…"` returns real passage TEXT** (not `{id,distance}`); **the MCP
  server's `lookup_symbol`, `get_entrypoints`, and `get_dep_graph` each return real data, not empty**
  (proving the three structured JSONs shipped); **and the authored `<slug>-primer.md` is present in
  the pack's `for-humans/` half** (proving the line-79 `must()` was satisfied by a real primer). An
  **SEO presence check** is part of this cue: `<title>`, meta description, canonical, JSON-LD
  `SoftwareApplication`, OG + Twitter `summary_large_image` meta, the favicon `<link>`s, and
  `sitemap.xml` / `robots.txt` / `llms.txt` are all present and well-formed, or the station **stops
  loud**. The AI pack is a hard deliverable (INV-07, Ships-the-Pack).

### Station 7 — QUALITY GATE ⟲ (the completion criterion)
- **Do:** Render the **live page** in a real browser (Playwright), screenshot **full-page at 390px
  (mobile) and 1440px (desktop)**, vision-score against **both rubrics** (Gate A + Gate B), and
  **refine-loop** until passing. See §"The QA System" for the full machinery.
- **Tools:** `tools/screenshot` (Playwright, pure), `tools/vision-grade` (a vision model prompted
  with the **verbatim Gate A/B rubric** as a harsh critic — **Claude with vision by default, or any
  vision model the operator configures**; pure: screenshot + rubric → per-criterion scores +
  rationale. **Loud-fail postcondition:** malformed, missing, or non-per-criterion scores → **stop,
  do not pass** — a grader that cannot return a complete per-criterion scorecard is a build failure,
  never a silent pass), `tools/refine` (judgment-driven: fix the *named* weakness only).
- **Cue:** on BOTH devices, **mean ≥ 90 AND min axis ≥ 85 AND all five operator qualitative questions
  YES** (§"The QA System"). If a repo genuinely cannot reach the bar, **flag it honestly** — never ship
  slop and call it done (INV-05, INV-02). Iteration is expected: loop until it clears.

### Station 8 — PUBLISH / DEPLOY (+ repo SEO)
- **Do:** Create the dedicated **explainer GitHub repo** (the owner is invited as a collaborator),
  and deploy the (already-great) page to its **own URL** with per-build isolation (INV-01). **Set the
  explainer repo's GitHub TOPICS + a strong description** (via the GitHub API) so it is discoverable —
  *GitHub is the new AI-world social media* — and **prepare suggested topic/description improvements
  for the SOURCE repo** (offered, never forced — delivered in the Station 8b README PR and/or the
  Station 9 email).
- **Tools:** `tools/publish-repo`, `tools/deploy` (pure wrapper over `gh` + the deploy provider —
  **default Netlify**, chosen for its clean auto `{repo}-explainer.netlify.app` URL with **zero DNS
  work** and first-class git-connected auto-deploy so the owner's later edits redeploy themselves;
  the adapter is **provider-agnostic**, so Vercel is a one-line swap-in and there is no lock-in; a
  **per-build site** so builds never collide), `tools/repo-seo` (pure: sets the explainer-repo topics +
  description via the GitHub API; emits the source-repo suggestions).
- **Cue:** **live URL returns 200 unauthenticated**, the **repo is public**, the **owner is invited**,
  and the **explainer repo has topics + a description set** (verified via the GitHub API).

### Station 8b — README ENHANCEMENT (OPTIONAL — offered, source-repo PR only)
- **Do:** **Offer** to enhance the source repo's README via the `readme-enhance` skill
  (`~/.claude/skills/readme-enhance`, verified present): a clear architectural explanation, the
  **shared Station 4 SVG diagrams** (authored once, reused here), and an **explainer badge** linking to
  the live explainer. **Delivered ONLY as a PULL REQUEST** on the source repo — never a direct push;
  the author merges or skips. May also carry the Station 8 source-repo topic/description suggestions.
- **Tools:** `tools/readme-enhance` (wraps the `readme-enhance` skill), `tools/open-pr` (pure `gh`
  wrapper: branch + commit + PR; **never pushes to a default branch**).
- **Cue:** if the owner accepted, a **PR exists on the source repo** (URL returned) carrying the
  architectural explanation + the shared SVGs + the explainer badge; if declined, the station is a
  clean no-op. It is **OPTIONAL and off the critical path** (INV-03) and **never blocks the core
  ship.**

### Station 9 — NOTIFY
- **Do:** Return the result inline **and** email the owner the scorecard + both screenshots + links —
  including, when present, the **Station 8b README-PR link** and the **suggested source-repo
  topics/description** (Station 8), so the owner can act on the optional offers.
- **Tool:** `tools/notify` (pure SMTP; absorbs the old `phase9-send-email.mjs`).
- **Cue:** **send confirmed (SMTP 250).** A notify failure degrades to a warning — it never inverts a
  live, graded, deployed build (INV-04).

### Runtime parallelism (speed without coupling)

The critical path is **S1 → S2 → S3 → S4(slowest image) → S6 → S7(maybe loops) → S8 → S9**. To make
it fast:

- **S4 raster images all fire at once** (parallel `tools/generate-image` calls).
- **The structural SVGs (`ascii-to-svg`) are authored during S3** (their ASCII falls out of the
  authoring) and converted in parallel with the S4 raster generation — not serialized after it.
- **Favicon AND the 1200×630 social card (S5) start the moment the hero returns**, overlapping the
  rest of S4.
- **The AI pack builds as soon as S1's KB exists** — it overlaps S2 and S3 entirely.
- **The README-enhancement PR (S8b) is OPTIONAL and quarantined** (INV-03): off the critical path,
  after deploy, and it **never blocks the core ship**.
- **Studio / any long-async step is quarantined** (INV-03): optional, off the critical path, and it
  **never blocks the core ship**. The page ships studio-less first; studio (if any) re-assembles,
  re-grades, and follows up.

---

## The QA System (the heart — judged on real pixels, not code passing)

The gate (Station 7) renders the **live page** with Playwright at **390px (mobile)** and **1440px
(desktop)**, takes **full-page screenshots**, and scores them with a vision model — **Claude with
vision by default, or any vision model the operator configures** — **prompted with the verbatim
Gate A/B rubric as a harsh critic**. If the grader returns malformed or missing per-criterion scores,
the gate **stops loud and does not pass** (a broken grader is never a silent green). There are **two
independent gates**, because *"they don't get it"* and *"jangly AI slop"* are different failures and a
build can pass one while failing the other.

### Gate A — "Do they actually get it?" (substance) — each criterion 0–100

- **A1 — Visual effectiveness:** compelling vs flat/forgettable.
- **A2 — Storytelling:** tells a story vs lists facts.
- **A3 — Clueless → convinced:** zero knowledge → why it matters → real examples → "oh, cool."
- **A4 — Usefulness-to-ME:** explicitly answers "how is this useful to **YOU**" (cures
  engineer-blindness — the assumption the reader already cares).
- **A5 — Completeness of the arc:** never-seen → ready to implement.
- **A6 — Implementation confidence:** the reader knows **exactly what to do next**. The Get-Started
  section shows the command, **what they'll SEE when they run it**, the step-by-step, what they get at
  the end, and what's next — with prerequisites stated. A5 ("ready to implement") is *understanding*;
  A6 is *knowing how to act on it.* A bare "just run this," with no sense of what happens or what comes
  next, fails A6 (INV-19).

### Gate B — "Did someone who gives a shit make this?" (craft / anti-slop) — each criterion 0–100

- **B1 — Typography & hierarchy:** intentional, readable, ranked vs jangly.
- **B2 — Alignment & grid:** aligned vs subtly-off / amateur.
- **B3 — Spacing & rhythm:** breathes, consistent vs cramped / random.
- **B4 — Strength & polish:** cohesive, deliberate vs generic AI-template slop.
- **B5 — Imagery craft:** beautiful + explanatory + sequenced high → low vs pretty-but-useless —
  **including the structural SVG diagrams (crisp, legible, genuinely explanatory) and the 1200×630
  social card (on-brand, inviting, tagline legible)**, both judged for delight + craft.

### The bar and the loop (non-negotiable — iteration is EXPECTED, not a failure)

The gate is a **loop you are expected to go around more than once.** A first pass rarely passes; that
is the design. Going through a few revs to get there **is the point of the process** — it is how a
build iterates to genuinely high quality. The page is **done** only when, on **BOTH** devices, **all**
of the following hold at once:

- **NUMERIC BAR — anchored to the owner's own praised examples (owner-signed 2026-06-29):** the
  scorecard's **mean ≥ 90 AND its minimum axis ≥ 85.** This is pinned to the level of the six
  `ruv-explainer-*` example sites (~88 headline / ~92 mean on the honest grader). A literal "95 on
  every axis" is mathematically unreachable by an honest harsh critic — it would reject even those
  exemplars — so the bar is **"at least as good as the examples,"** not impossible perfection. **The
  minimum-axis ≥ 85 is the anti-slop floor: a single slop axis — a raw-ASCII diagram, a pretty-but-
  empty image — scores ≈50 and fails the whole build,** exactly as it must.
- **OPERATOR QUALITATIVE GATE — five YES/NO questions, ALL must be YES (verbatim, the owner's words).**
  The operator, looking at the real screenshots, must be able to answer YES to every one:
  1. **Would this make me believe I understand this?**
  2. **Would this make it approachable?**
  3. **Would this explain it for somebody who doesn't understand it?**
  4. **Would it give me confidence I understand the architecture?**
  5. **Does it make me smile — "oh, that's cool"?**
  A single NO is a fail: name what's missing, refine, re-render, re-grade. The numeric bar and these
  five questions are **independent gates — both must pass.** A page can clear the numbers and still
  fail a question (and vice-versa); neither is waved through.
- **THE REFINE LOOP.** Any axis below the bar OR any operator NO → the gate **names the exact weakness**
  (which criterion / which question, which device, what was seen) → the brain **refines just that** (an
  A4 "not useful to me" reopens `content`; an A6 / B5 / diagram miss reopens `visuals`; a B1 typography
  miss reopens `page`) → **re-render → re-grade → LOOP.** Refinement is surgical — touch only the named
  weakness, never a broad reflow that regresses a passing axis.
- **Honesty escape hatch:** if a repo genuinely cannot reach the bar on some axis, **flag it honestly**
  in the result and the email. **Never ship slop and call it done** (INV-02, INV-05).

### Three sets of eyes on the actual pixels — every time

1. **The vision model** scores each criterion 0–100 with a **written rationale citing what it SEES**.
2. **The operator (Claude)** views the **same screenshots** and must answer **YES to all five
   qualitative questions** above **before** declaring the gate passed — a real read, not a glance.
3. **The owner** receives the **scorecard + the mobile AND desktop screenshots** (at Station 9) and
   judges by eye.

**What gates Station 7 are the two pre-ship eyes** — the vision model **and** the operator — **both
agreeing**, with **mean ≥ 90 AND min axis ≥ 85 on both devices AND all five operator questions YES.**
That is `BuildPassed`; the owner does **not** gate S7 (they have not seen it yet). The **owner is the
post-delivery third eye**: they see the result at Station 9, and an **owner rejection re-opens the
same surgical refine / rebuild back-edge** — it reopens the loop, it does not block the original gate.

"**Done**" = real screenshots; on both devices **mean ≥ 90, min axis ≥ 85, and all five operator
questions answered YES**; the two pre-ship eyes agree; and the post-delivery third eye (the owner)
does not reject. Anything less is not done — and getting there over a few revs is expected.

---

## Invariants

These are always-true properties, enforced in code (design system + tools) and at the gate. The DDD
(`docs/ddd/repo-explainer-recipe-domain.md`) models them as first-class domain concepts.

> **This register is an intentional subset.** INV-01..08 below are the eight cross-cutting invariants
> and match the DDD §13 numbering **exactly**. The DDD §13 carries the **full INV-01..19 set**: it
> elevates to numbered invariants four PLUS additions — **INV-13 SEO-present, INV-14 ships-social-card,
> INV-15 structural-diagrams-as-SVG, INV-17 verified-image-primary** — plus brain/tools-split,
> render-once, arc-altitude, and idempotency. This ADR carries those four-plus as **narrative
> decisions** (D4 brain/tools-split + render-once, D6 arc-altitude, D7 verified-image-primary + SVG,
> Station 5/6 SEO + social card), not as numbered invariants. **Cross-references to INV-09..19 resolve
> in the DDD §13**, not here — including **INV-18 ArchitectureAndFlowRequired** (architecture + flow
> diagrams mandatory, Station 4) and **INV-19 ImplementationExperiencePresent** (the Get-Started
> experience, Station 3 / A6).

- **INV-01 — Build isolation.** Each build is self-contained with its own per-build deploy target;
  builds never collide.
- **INV-02 — Responsive-great-verified.** The page clears the bar on **both** viewports (mean ≥ 90,
  min axis ≥ 85, and all five operator questions YES) on real screenshots — verified, not assumed.
- **INV-03 — Async steps never block the core.** Studio / long-async steps are quarantined and
  optional; the core ship is independent of them.
- **INV-04 — Never fail silently.** Every station has a **loud postcondition** (its cue). A station
  that cannot record evidence has not passed.
- **INV-05 — Never ship below the exemplar bar.** "Done" = on BOTH devices the scorecard's **mean ≥ 90
  AND its minimum axis ≥ 85** (anchored to the owner's own praised example sites at ~88 headline / ~92
  mean; a literal "95 on every axis" is unreachable by an honest grader and would reject those
  exemplars) **AND** the operator answers YES to all five qualitative questions (§"The QA System"). A
  single slop axis (≈50) fails hard via the ≥85 minimum. Below the bar: refine and re-grade (iteration
  is expected), or flag honestly. Never ship-and-claim.
- **INV-06 — Grounded-in-KB.** No claim without a KB source. The KB is the **real RVF store**, never
  a JSON stand-in.
- **INV-07 — Ships-the-pack.** Every explainer includes the downloadable AI knowledge pack built by
  `kb/make-dropin.mjs` (its **studio-less variant** — see Station 6; studio is optional per INV-03),
  with `.passages.jsonl` present so search returns text and the `<slug>-symbols.json` /
  `<slug>-dep-graph.json` / `<slug>-entrypoints.json` present so all four MCP tools return data.
- **INV-08 — One-source-of-truth.** All three distribution adapters call the **identical** skill /
  core. No adapter forks explainer logic.

---

## Alternatives considered

### Authoring model — fully-bespoke vs fixed-template vs the chosen hybrid

- **Fully-bespoke (regenerate everything every time, no shared system).** This is what generation 1
  did by hand. It produces beautiful one-offs but is *unreliable by construction*: every build
  re-derives responsive math, accessibility, and the required sections, so the invariants are only
  ever as good as that run's luck. Six bespoke explainer stylesheets and zero shared tokens is the evidence.
  **Rejected** — too much craft spent re-earning the floor; inconsistent guarantees.
- **Fixed-template (one design, fill the blanks).** Maximally reliable, trivially cookie-cutter. It
  would pass Gate A's substance for easy repos but **fails Gate B4 (anti-slop) by definition** — a
  templated look is the exact "generic AI-template slop" the gate exists to reject. It also cannot
  express a repo-specific metaphor (D6/D7). **Rejected** — violates the soul (unique by default).
- **Chosen — concept-then-render hybrid (D5).** Conceive a bespoke art-direction brief (expression),
  render it onto a shared design system that guarantees the invariants. **Unique by default, reliable
  by construction.** This is the only option that satisfies both gates *and* the mission.

### Knowledge base — rebuild-KB vs reuse-kb

- **Rebuild-KB (the generation-2 path: `scripts/phase2-build-kb.mjs`, plus the fictional
  `@rvf/forge`).** Writes plain JSON with no embeddings while claiming a "searchable vector
  database." It is slower to maintain, factually a defect (INV-06), and the headline packages it
  leaned on (`@rvf/forge`, `@ruvector/search-cli`, `@ruvector/mcp-server`) **do not exist on npm**.
  **Rejected.**
- **Chosen — reuse the real `kb/` engine (D3).** `kb/build-kb.mjs` + `kb/ask-kb.mjs` +
  `kb/make-dropin.mjs` + `kb/kb-mcp-server.mjs` already built the shipped stores in `kb/stores/*` and
  the drop-in zips. Real packages (`@ruvector/rvf@^0.2.2`, `@xenova/transformers@^2.17.2`), local
  embeddings, self-reconciling builds, intent-aware search. The skill **wraps** these; it does not
  re-implement them.

### The pipeline — keep-and-fix vs retire

- **Keep-and-fix the GitHub-Actions phase pipeline (ADR-0002/0003/0004/0004a).** Even fully repaired,
  its architecture is the problem: string-coupled HTML markers, eleven independently-deployed cloud
  stations wired by a Gist job record, and a deploy-then-grade order that screenshots production
  before it is good. ADR-0004a itself left two stations "designed-not-built" and carried fictional
  package names into the fixes. Repairing it re-commits to the brittleness. **Rejected.**
- **Chosen — retire it (D2) and capture the brain as a skill (D1).** Replace the marker-coupled
  phase chain with one judgment-bearing skill + pure tools + a single `BuildContext`. The page is
  rendered once; quality is judged on real pixels before deploy; the KB pack always ships.

---

## Consequences

### What we delete / retire

- `.github/workflows/build-explainer.yml` — the phase workflow (broken at P2→P3, fails GitHub
  validation, never ships the pack). Retired.
- `scripts/phase2-build-kb.mjs` (fake JSON KB), `scripts/phase3-scaffold.mjs` (marker emitter),
  `scripts/phase4-author-content.mjs`, `scripts/phase5-generate-images.mjs`,
  `scripts/phase6-quality-gates.mjs`, `scripts/phase9-send-email.mjs` — deleted or absorbed into pure
  `tools/*`.
- **Delete `scripts/knowledge-pack-assets/`** — the `forge-ask.mjs` / `forge-mcp.mjs` duplicate fork
  (plus `resolve-deps.mjs`, `bundle-package.json`, `README.template.md`), superseded by
  `kb/ask-kb.mjs` / `kb/kb-mcp-server.mjs` and the canonical `kb/make-dropin.mjs`.
- The string-coupled HTML marker contract (`<!-- CONTENT:* -->`, `<!-- IMG:gallery -->`) — gone; the
  page is rendered once from components.
- Any reference to `@rvf/forge`, `@ruvector/search-cli`, `@ruvector/mcp-server` — purged (npm 404,
  fictional). (`@ruvector/rvf-mcp-server` is real — npm `0.1.4` — but intentionally unused; the pack
  ships the in-repo `kb/kb-mcp-server.mjs`.)
- The ADR-0004 deploy-then-grade ordering and the eleven-cloud-station job-record model — superseded.

### What we gain

- **The magic is captured for the first time** — Claude Code's repo-reading, art-directing judgment
  lives in `skills/repo-explainer/SKILL.md`, reusable and versioned, not trapped in a chat session.
- **Anti-brittleness by construction** — strict brain/tools split, one `BuildContext`, render-once,
  pure independently-testable tools. The failure mode that killed generation 2 cannot recur.
- **A real shared design system** (`assets/design-system/`) — invariants guaranteed once, so judgment
  is spent on art direction, not on re-earning responsive/accessible basics each build.
- **A genuine quality bar** — the exemplar-anchored dual gate (mean ≥ 90, min axis ≥ 85, and the five
  operator questions YES on both devices) with a surgical refine loop and three sets of eyes on real
  pixels. "Done" means a stranger smiles.
- **The AI pack always ships** — `kb/make-dropin.mjs` output (with `.passages.jsonl`) is a hard
  deliverable, so every explainer hands the reader's *AI* a working, searchable KB too.
- **Three doors, one brain** — plugin (first), npx CLI, and hosted website all run the identical
  core, so there is one thing to improve and it improves everywhere at once.

### What we accept as cost

- We must **build the shared design system and the plugin scaffold** (`.claude-plugin/plugin.json`,
  `commands/repo-explainer.md`, `skills/repo-explainer/SKILL.md`, `tools/*`,
  `assets/design-system/`) — none of these exist yet. (`assets/design-system/` is a **new subdir**
  under the pre-existing, **unrelated** root `assets/`; see the D1 path note — do not collide with
  it.) This is real, deliberate work, not a port.
- `www/` must be **reduced to a thin door** (validate + run/dispatch the core), shedding any
  explainer logic it accreted under the pipeline model.
- The owner-facing SLA is honest: the **core explainer always ships**; any **studio** asset is
  best-effort and quarantined (INV-03).

---

## Appendix — facts (verified where stated; gpt-image-2 verified available 2026-06-28 — see the image-engine row)

| Thing | Verified reality |
|---|---|
| KB builder | `node kb/build-kb.mjs --target <slug>` → `kb/stores/<slug>/<slug>-kb.rvf` (+ `.rvf.idmap.json`, `.passages.jsonl`, `.ids.json`, `.rvf.embed.json`); `close()` is the only persist path; self-reconciles or `exit(1)`. **Suffix rule (line 244):** the canonical `<slug>-kb.rvf` is written **only** when the target has an `embed` block; the bare MiniLM default writes `<slug>-kb.small.rvf` — which `make-dropin.mjs` (it globs `<slug>-kb.rvf`) will **not** find. Explainer targets MUST set an `embed` block |
| Search CLI | `node kb/ask-kb.mjs <slug> "question" [k]` — joins `.rvf` hits to `.passages.jsonl` by id; intent-routing + rerank |
| Pack builder | `node kb/make-dropin.mjs <slug> <out.zip>` — `for-ai/` + `for-humans/`; declares `@ruvector/rvf@^0.2.2` + `@xenova/transformers@^2.17.2` |
| MCP server | `kb/kb-mcp-server.mjs` — four tools: `search_kb`, `lookup_symbol`, `get_entrypoints`, `get_dep_graph`. The latter three READ `<slug>-symbols.json` / `<slug>-entrypoints.json` / `<slug>-dep-graph.json` (produced by `kb/extract-symbols.mjs` / `kb/entrypoints.mjs` / `kb/dep-graph.mjs`) — these MUST be in the pack or three of the four tools return nothing |
| Embedders | `Xenova/all-MiniLM-L6-v2` (384-dim, engine default → writes `.small.rvf`) or `Xenova/bge-small-en-v1.5` (384-dim, the explainer's **required** `embed` override → canonical `.rvf`) — both cached at `kb/models-cache/` |
| Real packages | `@ruvector/rvf@^0.2.2` (query), `@ruvector/rvf-node` (native, transitive), `@xenova/transformers@^2.17.2` (local ONNX) |
| Fictional (npm 404) | `@rvf/forge`, `@ruvector/search-cli`, `@ruvector/mcp-server` — never reference (re-verified via `npm view` at edit time) |
| Real but NOT used | `@ruvector/rvf-mcp-server` (npm `0.1.4`, real) — deliberately not pulled in; the pack ships the in-repo `kb/kb-mcp-server.mjs` instead |
| Image engine (primary = `gpt-image-2`, VERIFIED) | **Primary `gpt-image-2`** (OpenAI), quality `high`, hero 1536×1024, raster sections 1024×1024 — **verified real + available in this project 2026-06-28** via `GET /v1/models/gpt-image-2` → **HTTP 200** `{id: gpt-image-2, owned_by: system}`. Valid sizes: `1024×1024`, `1024×1536`, `1536×1024`, `auto` (DALL·E-3 `1792×1024` rejected). **Fallback = `gpt-image-1`**, used ONLY if a build-time probe of `gpt-image-2` fails; deeper fallback `imagen-3` → `gemini-2.x-image`. Station 4 probes `gpt-image-2` first and **fails loud only if the whole chain 404s** |
| SVG diagram skill | `~/.claude/skills/ascii-to-svg` (verified present) — the structural rungs (big-idea, "aha" insight, architecture, flow) authored ASCII → crisp accessible SVG; the **same SVGs shared by page + README** (Station 4 / 8b) |
| README enhancement skill | `~/.claude/skills/readme-enhance` (verified present) — **OPTIONAL** source-repo enhancement, **delivered as a PR only** (architectural explanation + shared SVGs + explainer badge); Station 8b |
| Social card + favicons | designed **1200×630** social card (tagline baked in) → OG / Twitter `summary_large_image`; full favicon set (hero-derived + `apple-touch-icon` + standard sizes) — Station 5 (Brand & Social) |
| Page SEO / AI-discoverability | `<title>` + meta description + canonical + JSON-LD `SoftwareApplication`/`SoftwareSourceCode` + OG/Twitter meta + `sitemap.xml` + `robots.txt` + **`llms.txt`** (AI crawlers); explainer-repo GitHub topics + description set via API (Station 6 / 8) |
| Built stores today | `kb/stores/{photonlayer,ruqu,ruvn,agent-harness-generator}/` |
| Example sites (gen-1) | `ruv-explainer-{photonlayer,ruqu,ruvn,agent-harness-generator,rufield}/` **plus `explainer-agentic-qe/`** (a sixth explainer-family dir) — each a bespoke `styles.css`, zero shared tokens. (`www/styles.css` is the hosted-door stylesheet, not an example site.) |
| Superseded ADRs | `docs/adr/0002-repo-explainer-architecture.md`, `0003-async-build-and-real-quality-gates.md`, `0004-cloud-build-engine.md`, `0004a-gap-resolutions.md` (pipeline approach) |
| Companion DDD | `docs/ddd/repo-explainer-recipe-domain.md` (Build aggregate, BuildContext, the dual-gate + exemplar bar (mean≥90/min≥85) + five operator questions + three eyes as first-class domain concepts) |
