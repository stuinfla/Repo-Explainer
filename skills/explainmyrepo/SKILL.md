---
name: explainmyrepo
description: >-
  Turn any GitHub repo into a bespoke, art-directed explainer site that takes a
  stranger from "never seen this" to "oh, that's really cool — and I'm ready to
  implement it." Use this when the user gives a GitHub URL (public, private, or
  their own) and wants an explainer / landing page / "explain this repo" /
  "make a page that sells this repo." This skill is THE BRAIN: it reads the repo
  deeply via a real RVF knowledge base, conceives a one-of-a-kind visual
  metaphor, authors the content along a comprehension arc grounded in the KB,
  generates feeling (raster) + structure (SVG) imagery, assembles one page,
  grades it on real pixels to the exemplar-anchored bar (mean >= 90, min >= 85, five operator-YES) with a surgical refine
  loop, ships a downloadable AI knowledge pack, and deploys to a live URL. Do
  NOT use for generic "build me a website" requests with no repo to explain.
---

# explainmyrepo — THE BRAIN

You are the brain of the explainer recipe. **You decide; the tools do.** Your job
is judgment — understand, conceive, author, judge. The tools in `tools/*` are pure
mechanics — embed, call an image API, render a diagram, screenshot, zip, deploy,
email. You never let a tool think, and a tool never decides "good enough."

> **The mission (this is the completion bar, not a slogan).** Take someone from
> "I've never seen this before" to "Oh, I get **why** this was created, the problem
> it solves, what it does, why it's elegant, how it works — and I'm ready to go
> implement it." The **minimum bar is blunt and non-negotiable: a stranger looks
> at the result and smiles — "that's really cool."** If a build cannot clear that
> bar, it is **not done and not acceptable.** Every station below exists to serve
> that one sentence.

Authoritative sources (read them if anything here is ambiguous):
`docs/adr/0005-skill-based-explainer-recipe.md` (the decision),
`tools/CONTRACT.md` (the tool law), `docs/ddd/explainmyrepo-recipe-domain.md`
(the domain model). Where they conflict, **ADR-0005 governs.**

---

## The four laws (violating any of these is what killed the prior pipeline)

1. **Brain decides, tools do.** You own all judgment (CONCEIVE, AUTHOR, the
   primer, JUDGE-quality, decide-refine). Tools own all mechanics. A tool is pure:
   clear input → clear output → `{ ok | loud failure }`.
2. **`BuildContext` is the ONLY contract.** Everything cross-station lives in one
   file: `<build-dir>/build.json`. Each station fills its **own slot**. There are
   **no string-coupled HTML markers** — that exact coupling killed generation 2.
   The page is rendered **ONCE**, never mutated incrementally.
3. **Never fail silently (INV-04).** Every station has a loud postcondition (its
   "cue"). A tool that fails **exits non-zero** with a human reason and never
   writes a placeholder, default asset, stub, or `TODO` to limp past a failure.
   You read the **exit code first**, then the JSON. A failed cue stops the build
   with an honest reason — never a stack trace, never a silent green.
4. **Never ship below the exemplar bar (INV-05).** "Done" = on BOTH mobile (390px) and desktop
   (1440px) the scorecard's **mean ≥ 90 AND min axis ≥ 85 AND all five operator questions YES**
   (anchored to the owner's own example sites — a literal "95 on every axis" is unreachable by an
   honest grader; a build that clears this bar is **reported as a normalized 95**). The two pre-ship
   eyes (vision model + you) agree, the page is live (200 unauthenticated), and the AI pack ships.
   Below the bar: **refine, or flag honestly.** Never ship slop and call it done.

---

## How to run a tool (the uniform convention)

Every tool is one file, invoked the same way, with one positional argument — the
build directory:

```bash
node tools/<name>.mjs <build-dir>
```

The tool reads `<build-dir>/build.json`, takes **only its declared slice**, does its
one mechanical job, writes its outputs under `<build-dir>/`, **merges only its own
slot** back into `build.json`, and prints **exactly one JSON object** to stdout:

```jsonc
{ "ok": true,  "outputs": { "...": "paths + the slot it merged" }, "error": null }
{ "ok": false, "outputs": {}, "error": "clear, human-readable reason" }   // exits non-zero
```

After every tool call: **check the exit code (0 ⇔ ok), then parse stdout.** If
`ok:false` or non-zero, **stop the station and surface the reason** — do not push
forward on a failed cue. Secrets (GitHub token, OpenAI key, deploy token, SMTP
creds) come from the **environment**, never from `build.json`.

### Tool roster (14 pure tools)

| Station | Tool | Fills slot |
|---|---|---|
| 0–1 | `clone-repo` | `repo` (+ `buildId`) |
| 1 | `build-kb` | `understanding`, `kb` |
| 4 | `generate-image` | `visuals.hero` / `visuals.sections[]` (one rung per call) |
| 4 | `make-diagrams` | `visuals.architectureDiagram` / `.flowDiagram` / `.bigIdeaDiagram` / `.insightDiagram` |
| 5 | `make-favicon` | `brand.favicon` |
| 5 | `make-social-card` | `brand.socialCard` |
| 6 | `assemble-page` | `page` (+ SEO/social `<head>`, sitemap/robots/llms.txt) |
| 6 | `make-pack` | `pack` |
| 7 | `quality-grade` | `quality` (two scorecards) |
| 8 | `deploy` | `publish.liveUrl` / `.http200` |
| 8 | `publish-repo` | `publish.explainerRepoUrl` / `.ownerInvited` |
| 8 | `repo-seo` | `publish.repoTopics` / `.repoDescription` / `.sourceRepoSeoSuggested` |
| 8b | `readme-enhance` | `readmePr` (optional, PR-only) |
| 9 | `notify` | `notify` |

`concept` (Station 2) and `content` (Station 3) have **no tool** — you fill them
directly. So does the **primer** (Station 1). That is the judgment that is yours.

The KB engine has direct CLIs you call yourself for **reading + grounding** (not
tools — they are how the brain thinks): `node kb/ask-kb.mjs <slug> "question" [k]`
(HNSW retrieval, returns full passage TEXT) and `node kb/index-primer.mjs <slug>`
(indexes the primer **you** authored).

---

## Setup (before Station 0)

1. Make a fresh build directory (one self-contained dir per build), e.g.
   `mkdir -p build/<repo>-<shortid>` with subdirs `assets/`, `site/`. The tools
   create what they need; you just hand each tool the build dir.
2. Seed `<build-dir>/build.json` with the target URL:
   `{ "repo": { "url": "https://github.com/owner/name" } }`. `clone-repo` sets the
   `buildId` (the correlation + idempotency key) first.
3. Confirm the env has what the run needs: GitHub token (private/own repos +
   publish), OpenAI key (raster images), the deploy-provider token (Netlify by
   default), SMTP creds (notify). Missing creds for a station is a loud stop at
   that station, not a silent skip.

---

## The stations (run them in order; each cue fails loud)

Critical path: **S1 → S2 → S3 → S4(slowest visual) → S6 → S7(may loop) → S8 → S9.**
Parallelize off-path (see "Parallelism" at the end): raster rungs fire together;
the SVGs are authored during S3; favicon + social card start the moment the hero
returns; the AI pack builds as soon as S1's KB exists; the README PR (S8b) is
optional and quarantined.

### Station 0 — VALIDATE
- **Do:** Confirm the repo URL is reachable (supports private + the owner's own
  repos via the env token).
- **Tool:** `node tools/clone-repo.mjs <build-dir>` (this also clones in S1).
- **Cue:** `repo.reachable === true`. If unreachable/unauthorized, **stop with a
  clear human reason** — not a stack trace.

### Station 1 — UNDERSTAND (read the repo deeply; this is where grounding is earned)
1. **Clone** (the `clone-repo` call above leaves the working tree at
   `<build-dir>/repo/`).
2. **Register the target** in `kb/kb.config.mjs` with an **explicit `embed` block**
   (`Xenova/bge-small-en-v1.5`, 384-dim) and its `repoDir` pointing at the clone.
   This is required: on the bare MiniLM default, `build-kb.mjs` writes
   `<slug>-kb.small.rvf`, which the Station-6 pack builder globs for `<slug>-kb.rvf`
   and **cannot find**. The `build-kb` tool **fails loud** if the target is
   unregistered or writes a `.small.rvf`.
3. **Build the KB + structured indexes:** `node tools/build-kb.mjs <build-dir>`.
   This runs the real engine: `kb/build-kb.mjs` (the RVF store, local embeddings,
   self-reconciling) **plus** `extract-symbols.mjs`, `dep-graph.mjs`,
   `entrypoints.mjs` → `<slug>-symbols.json` / `<slug>-dep-graph.json` /
   `<slug>-entrypoints.json`. These three JSONs are **build-step outputs, not
   optional reading**: they are Station-6 pack prerequisites and are exactly what
   the MCP server's `lookup_symbol` / `get_dep_graph` / `get_entrypoints` read, and
   they ground the mandatory architecture + flow diagrams (S4).
4. **Read the repo deeply** — this is judgment. Use `node kb/ask-kb.mjs <slug>
   "what is this repo?"` (and more questions: what problem, what's the clever move,
   how is it built, how do you run it) plus the three structured JSONs for exact
   lookups. Form an honest understanding.
5. **AUTHOR the primer (REQUIRED deliverable, your judgment):** write
   `kb/stores/<slug>/<slug>-primer.md` — a natural-language top-down orientation
   (what it is / its concepts / how each works / maturity / where the docs are /
   how to use it end-to-end). This is a **hard prerequisite of Station 6**:
   `kb/make-dropin.mjs` line 79 `must()`s it and throws `missing: <slug>-primer.md`
   if absent. Never let a tool fake it.
6. **Index the authored primer:** `node kb/index-primer.mjs <slug>` (a write/index
   step — it consumes the primer you wrote; it does not create it).
- **Cue:** the KB answers **"what is this repo?" correctly**, the repo is **named
  correctly**, the **three structured JSONs exist**, and **`<slug>-primer.md`
  exists**. A failed RVF build **hard-fails honestly** — there is **no** fallback to
  a JSON-only analysis (that re-introduces the fake-KB defect, INV-06). Retry once,
  then stop with an honest reason.

### Station 2 — CONCEIVE (pure judgment — the art-direction brief; no tool)
Before any rendering, invent **THIS repo's** brief and write it into the `concept`
slot of `build.json`. Each explainer is **unique by default, reliable by
construction** — never cookie-cutter, never templated (a templated look is a Gate-B
failure). The brief, grounded in what the KB revealed:

- **`metaphor`** — a visual metaphor that genuinely fits this repo (PhotonLayer →
  prism; ruvn → evidence dossier; ruqu → Bloch-sphere orb). A stranger should nod.
- **`palette`** — colours that fit the metaphor. These are the **design-system
  expression knobs**; `assemble-page` compiles them into the page's per-repo theme
  layer over the shared `assets/design-system/design-system.css` skeleton. This —
  the palette + type knobs you set here — **is** the page's "theme.css": the
  invariants (responsive, accessible, the required sections) live in the shared
  skeleton; the **expression** is what you set in `concept`.
- **`typePersonality`** — a display + body + mono pairing that carries the
  metaphor's voice.
- **`layoutRhythm`** — the ordered section archetypes (the page's cadence).
- **`heroConcept`** — the single emotional opening-image idea.
- **`copyVoice`** — the tone/register for all authored text.
- **`tagline`** — the one line baked into the social card + `og:description`.

- **Cue:** the brief is **specific to THIS repo** and the **metaphor genuinely
  fits**. A generic brief is a failure **here**, not at the gate.

### Station 3 — AUTHOR (pure judgment — the content; no tool)
Write the content along the **comprehension arc** into the `content` slot. The
reader asks a sequence of questions; every section answers the **next** one as it
forms. **Never show a low-level detail before the high-level frame that makes it
legible.** Author all eight sections:

| Reader's question | Section | Medium of its image |
|---|---|---|
| What world am I in? | `hero` | raster (metaphor, emotional, HIGH) |
| Why does this exist? | `problem` | raster (a human, relatable problem) |
| What does it actually do? | `whatItIs` | SVG (the big-idea, whole-thing diagram) |
| Why is it elegant/clever? | `insight` | SVG (the ONE clever move — the "aha") |
| How is it built / works? | `howItWorks` | SVG (**architecture + flow**, descend ONE level) |
| Could I use this? | `useCases` | raster (someone like the reader succeeding) |
| How do I start? | `getStarted` | SVG (quickstart path to first run) |
| (my AI gets it too) | `pack` | SVG (the dual-output: page for humans, KB for their AI) |

**Grounding is non-negotiable (INV-06).** Every claim must be traceable to a KB
passage retrieved via `node kb/ask-kb.mjs <slug> "…"`. Record `content.citations`
as `{ claim, passageId }`. **No invented capabilities, no "lorem", no "TODO", no
placeholder text.** As you author `howItWorks`, the **ASCII for the architecture +
flow diagrams falls out naturally** — capture it now so S4 can convert it in
parallel.

- **Cue:** all arc questions answered, zero placeholder text, every claim traceable
  to a KB source. A4 specifically: the page explicitly answers **"how is this useful
  to YOU"** (cure engineer-blindness — never assume the reader already cares).

### Station 4 — VISUALIZE (feeling = raster, structure = SVG)
- **Precondition (probe, fail loud).** Before generating raster, the
  `generate-image` tool probes the **verified primary `gpt-image-2`**
  (`GET /v1/models/gpt-image-2` → expected HTTP 200, confirmed 2026-06-28). Only if
  that build-time probe **fails** does it fall back to `gpt-image-1` (then the
  deeper `imagen-3` → `gemini-2.x-image`). Never proceed on an unverified ID; if the
  whole chain 404s, **stop loud** with the failing ID.
- **Raster rungs (emotional) — `generate-image`, one call per rung, fired in
  parallel:** the **hero (1536×1024)**, the **problem (1024×1024)**, and the
  **use-case scenario (1024×1024)** at quality `high`. Valid `gpt-image-2` sizes:
  `1024×1024`, `1024×1536`, `1536×1024`, `auto` (the DALL·E-3 `1792×1024` is
  rejected — never use it).
- **Structural rungs (explanatory) — `make-diagrams`, vector SVG via the
  `ascii-to-svg` skill, NEVER raster:** the big-idea diagram, the "aha" insight,
  and the **two diagrams that are MANDATORY on every explainer (INV-18 — the three
  questions every developer asks):**
  1. an **ARCHITECTURE diagram** (*how is it constructed* — modules / components /
     dependencies), built from `<slug>-dep-graph.json` + `<slug>-symbols.json`, and
  2. a **PROCESS / DATA-FLOW diagram** (*how does it work* — the runtime flow),
     built from `<slug>-entrypoints.json`.

  Both are **grounded in the repo's REAL structure, never invented.** You author the
  ASCII (it already fell out of S3); `make-diagrams` converts to crisp, accessible,
  xmllint-clean SVGs. **These SVGs are emitted once and reused by both the page AND
  the README (S8b)** — author once, share.
- **Cue:** every raster image is **valid + HTTP 200**, every structural SVG
  **renders crisp with its accessible text fallback**, and **each visual answers its
  assigned arc question** at the right altitude (high → low). A visual that is
  pretty but answers nothing fails Gate B5 later — catch it here. **If either the
  architecture or the flow diagram is missing, the build is not done** (INV-18).

### Station 5 — BRAND & SOCIAL (starts the moment the hero returns)
- **Do:** From the **hero's visual identity** (same metaphor/palette) produce the
  brand kit: (a) a **full favicon set** (hero-derived favicon + `apple-touch-icon`
  + standard sizes), (b) a designed **1200×630 social card** with the authored
  **tagline baked in** (drives OG/Twitter `summary_large_image` and `og:description`).
- **Tools:** `node tools/make-favicon.mjs <build-dir>` and
  `node tools/make-social-card.mjs <build-dir>` (both run alongside the rest of S4).
- **Cue:** **valid favicon files** AND a **valid 1200×630 social card**. A missing
  or invalid favicon **or** social card **stops the build loud** — never substitute
  a default. The card's delight + craft are judged at the gate (B5).

### Station 6 — ASSEMBLE + PACK (the page is rendered ONCE)
- **Precondition (fail loud).** `<slug>-primer.md` AND the three structured JSONs
  MUST already exist (S1). If the primer is missing, **stop loud** and return to
  Station 1 — never synthesize a placeholder to get past `make-dropin.mjs`'s
  line-79 `must()`.
- **Do (a) — render the page once:** `node tools/assemble-page.mjs <build-dir>`.
  This composes `concept` + `content` + `visuals` + `brand` onto the shared
  `assets/design-system/design-system.css` skeleton + the per-repo theme, wires the
  full **SEO + social `<head>`** (`<title>`, meta description, canonical, JSON-LD
  `SoftwareApplication`/`SoftwareSourceCode`, favicon links, OG + Twitter
  `summary_large_image` pointing at the S5 card), emits root-level **`sitemap.xml`,
  `robots.txt`, and `llms.txt`**, inlines the primer in the download section, and
  injects the **mandatory ISOvision attribution + CTA footer verbatim** (see below).
  **No string markers** (INV-10).
- **Do (b) — build the AI pack:** `node tools/make-pack.mjs <build-dir>`. This wraps
  `kb/make-dropin.mjs` via its **`--no-studio`** variant (studio-less first — the one
  acknowledged engine change; studio media re-packs later, INV-03). The pack ships
  the `for-ai/` half (`<slug>-kb.rvf` + idmap + embed sidecar + `.passages.jsonl` +
  `.ids.json` + the **three structured JSONs** + `ask-kb.mjs` + `kb-mcp-server.mjs`
  + `package.json` declaring `@ruvector/rvf@^0.2.2` + `@xenova/transformers@^2.17.2`)
  and the `for-humans/` half (the authored primer).
- **Cue:** **zero dangling refs or unresolved tokens** in the page; the **pack opens,
  the KB loads, and `node ask-kb.mjs <slug> "…"` returns real passage TEXT** (not
  `{id,distance}`); **the MCP server's `lookup_symbol`, `get_entrypoints`,
  `get_dep_graph` each return real data** (proving the three JSONs shipped); **the
  primer is present in `for-humans/`**; and the **SEO presence check** passes
  (`<title>` + meta description + canonical + JSON-LD + OG/Twitter + favicon links +
  `sitemap.xml` + `robots.txt` + `llms.txt` all present + well-formed) — or the
  station **stops loud**. The AI pack is a hard deliverable (INV-07).

> **The ISOvision footer is mandatory on EVERY explainer.** `assemble-page` injects
> it verbatim (design-system §16b). Two lines, always, in order: (1) "Built by
> **Stuart Kerr** at **ISOvision.ai**" (`ISOvision.ai` → `https://isovision.ai`);
> (2) the CTA "Want an explainer for your own repo? **Create one →**" →
> `https://repoexplainer.isovision.ai`. Semantic `<footer role="contentinfo">`,
> real `<a>` links, on-brand tokens, AA contrast, responsive. If it is missing, the
> page is not done.

### Station 7 — QUALITY GATE ⟲ (the completion criterion — judged on real pixels)
- **Do:** `node tools/quality-grade.mjs <build-dir>`. It renders the **assembled
  site LOCALLY** in a real browser (Playwright — live pixels, **not** a deployed
  URL; there is **no pre-grade deploy**), takes **full-page screenshots at 390px
  (mobile) and 1440px (desktop)**, and vision-scores them against the **verbatim
  Gate A/B rubric as a harsh critic**, returning two scorecards with per-criterion
  rationales citing what it SAW.

  **Gate A — "do they actually get it?" (substance, each 0–100):** A1 visual
  effectiveness · A2 storytelling · A3 clueless→convinced · A4 usefulness-to-ME ·
  A5 arc completeness · A6 implementation-confidence (knows what to run, what they'll
  SEE, the steps, what's next — INV-19).
  **Gate B — "did someone who gives a shit make this?" (craft / anti-slop, each
  0–100):** B1 typography & hierarchy · B2 alignment & grid · B3 spacing & rhythm ·
  B4 strength & polish (vs generic AI slop) · B5 imagery craft — **including the
  structural SVGs (crisp, legible, genuinely explanatory) and the 1200×630 social
  card (on-brand, inviting, tagline legible).**

  **The OPERATOR QUALITATIVE GATE — five YES/NO questions (the owner's words), ALL must be YES or you
  loop:** (1) Would this make me believe I understand this? (2) Would this make it approachable?
  (3) Would this explain it for somebody who doesn't understand it? (4) Would it give me confidence I
  understand the architecture? (5) Does it make me smile — "oh, that's cool"? These are independent of
  the numeric axes; a page can clear the numbers and still fail one of these.

- **The bar + the loop (non-negotiable — iteration over a few revs is EXPECTED, not a failure):**
  - **BAR:** on **BOTH** devices, **mean ≥ 90 AND min axis ≥ 85 AND all five operator questions YES**
    (11 axes × 2 devices). The **min ≥ 85 is the anti-slop floor** — a single slop axis (a raw-ASCII
    diagram, a pretty-but-empty image) scores ≈50 and fails the build. Anchored to the owner's own
    example sites (~88 headline / ~92 mean); a build that clears the bar is reported as a normalized **95**.
  - **`headlineScore` = the MINIMUM across all axes** (the anti-slop floor); **`meanScore` = the mean**
    (the "as good as the examples" measure). Both gate; the mean is not ignored.
  - **RUN THE REFINE LOOP:** any axis below the bar OR any operator NO → the gate **names the exact
    weakness** (which criterion / which question, which device, what it saw) → you **refine just
    that, surgically** (a B1 typography miss re-opens `page`; an A4 "not useful to me" miss re-opens
    `content`; an A6 / B5 / diagram miss re-opens `visuals`) → **re-assemble** (`assemble-page`) →
    **re-grade** (`quality-grade`) → **LOOP** until it clears on both devices. Touch **only** the named
    weakness — never a broad reflow that could regress a passing axis.
  - If the grader returns malformed / missing / non-per-criterion scores, the gate
    **stops loud and does not pass** — a broken grader is never a silent green.
- **Honesty escape hatch:** if a repo **genuinely** cannot reach the bar on some axis,
  **flag it honestly** in the result and the email. **Never ship slop and call it
  done.** Two pre-ship eyes gate S7: the **vision model** and **you** (the
  operator), viewing the **same screenshots**, both agreeing, with **mean ≥ 90, min ≥ 85, and all
  five operator questions YES** on both devices. The **owner is the post-delivery third eye** (S9) —
  owner rejection re-opens this same surgical loop.
- **Cue:** **mean ≥ 90 AND min axis ≥ 85 AND all five operator questions YES on BOTH devices**, or an
  honest flag. Only an **already-great** page proceeds to deploy.

### Station 8 — PUBLISH / DEPLOY (+ repo SEO) — the FIRST and only deploy
- **Do:** Create the dedicated **explainer GitHub repo** (public), invite the owner
  as a collaborator (best-effort), and deploy the already-passed page to its **own
  per-build URL**.
- **Tools (run all three):**
  - `node tools/publish-repo.mjs <build-dir>` — creates the explainer repo +
    invites the owner.
  - `node tools/deploy.mjs <build-dir>` — deploys to its own per-build URL.
    **Default provider: Netlify** (clean auto `{repo}-explainer.netlify.app` URL,
    zero DNS work, git-connected auto-redeploy so the owner's later edits redeploy
    themselves). The adapter is provider-agnostic — Vercel is a one-line swap.
  - `node tools/repo-seo.mjs <build-dir>` — sets **GitHub topics + a strong
    description** on the **explainer** repo (GitHub is the new AI-world social
    media), and emits **suggested** topic/description improvements for the **source**
    repo (offered, never set directly — INV-16).
- **Cue:** **live URL returns 200 unauthenticated**, the **repo is public**, the
  **owner is invited**, and the **explainer repo has topics + a description set**
  (verified via the GitHub API). An invite/SEO failure degrades to a warning — it
  never inverts a live, graded build.

### Station 8b — README ENHANCEMENT (OPTIONAL — offered, source-repo PR only)
- **Do:** **Offer** to enhance the **source** repo's README via
  `node tools/readme-enhance.mjs <build-dir>` (wraps the `readme-enhance` skill): an
  architectural explanation, the **shared Station-4 SVG diagrams** (reused, not
  re-authored), and an **explainer badge** linking to the live explainer. May also
  carry the Station-8 source-repo topic/description suggestions.
- **Cue:** **delivered ONLY as a PULL REQUEST** on the source repo (never a direct
  push — INV-16); the author merges or skips. It is **OPTIONAL, off the critical
  path, quarantined (INV-03), and NEVER blocks the core ship.** If declined, it is a
  clean no-op; a failure is a warning only.

### Station 9 — NOTIFY
- **Do:** `node tools/notify.mjs <build-dir>` — return the result inline **and**
  email the owner the **scorecard + both screenshots + links** (live URL, explainer
  repo, pack) plus, when present, the **README-PR link** and the **suggested
  source-repo topics/description**, so the owner can act on the optional offers and
  be the third eye.
- **Cue:** **send confirmed (SMTP 250).** A notify failure degrades to a warning —
  it never inverts a live, graded, deployed build (INV-04).

---

## Parallelism (speed without coupling)

Scheduling only — it never lets one station read another's files; everything lands
in its `BuildContext` slot.

- **S4 raster images all fire at once** (parallel `generate-image` calls).
- **The structural SVGs are authored during S3** (their ASCII falls out of
  authoring) and converted in parallel with the raster generation — not after it.
- **Favicon + the 1200×630 social card (S5) start the moment the hero returns**,
  overlapping the rest of S4.
- **The AI pack builds as soon as S1's KB exists** — it overlaps S2 + S3.
- **The README PR (S8b) and any studio/long-async step are quarantined** (INV-03):
  optional, off the critical path, after deploy, never block the core ship.

---

## Invariants you personally enforce

- **INV-04 Never-fail-silently** — every station has a loud cue; no placeholder,
  default, or stub past a failure.
- **INV-05 Never-ship-below-the-exemplar-bar** — on both devices, mean ≥ 90 AND min axis ≥ 85 AND all
  five operator questions YES IS the completion criterion (a clearing build is reported as a normalized
  95); below it, refine or flag honestly.
- **INV-06 Grounded-in-KB** — no claim without a real RVF KB passage; never a JSON
  stand-in.
- **INV-07 Ships-the-pack** — every explainer ships the downloadable AI pack
  (`.passages.jsonl` present so search returns text; the three structured JSONs
  present so all four MCP tools return data).
- **INV-08 One-source-of-truth** — this skill is the only brain; the plugin, npx
  CLI, and website all run the identical core.
- **INV-16 Source-repo-via-PR-only** — any touch to the source repo (README
  enhancement, SEO suggestions) is offered and delivered ONLY as a pull request.
- **INV-18 Architecture + flow diagrams mandatory** — every explainer ships both
  an architecture diagram and a process/data-flow diagram, as crisp SVGs grounded
  in the repo's real structure; missing either means the build is not done.
- **INV-19 Implementation-experience present** — the Get-Started section shows the command, what the
  reader will SEE when they run it, the steps, what they get, what's next, and prerequisites — never a
  bare "just run this." Scored as A6.
- **Mandatory ISOvision footer** — the credit + "create one" CTA footer ships on
  every page, verbatim.

**"Done" = real screenshots; on both devices mean ≥ 90, min axis ≥ 85, and all five operator questions
YES (reported as a normalized 95); the two pre-ship eyes agree; the page is live; and the AI pack ships.
If a stranger doesn't smile, it isn't finished.**
