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
  grades it on real pixels against the exemplar bar (mean >= 90, min >= 85, six operator-YES) with a surgical refine
  loop (a below-bar page still ships, with its weakest axis disclosed), ships a downloadable AI knowledge pack, and
  deploys to a live URL. Do
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

Authoritative sources (read them if anything here is ambiguous): `tools/CONTRACT.md` (the tool law and the
slot shapes), `skills/explainmyrepo/TOOLS-CONTRACT.md` (every tool's own header: flags, env, gotchas),
`src/stations.mjs` (the station order and which door runs what), and the newest ADRs 0011-0016 in `docs/adr/`.
`docs/adr/0005-skill-based-explainer-recipe.md` is the founding record and
`docs/ddd/explainmyrepo-recipe-domain.md` the historical domain model; where they conflict with the code or a newer ADR,
**the code and the newer ADR govern.**

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
4. **Aim for the exemplar bar, and never lie about where you landed (INV-05).** The target the refine
   loop climbs to is, on BOTH mobile (390px) and desktop (1440px), **mean ≥ 90 AND min axis ≥ 85 AND all
   six operator questions YES** (anchored to the owner's own example sites — a literal "95 on every axis"
   is unreachable by an honest grader; every page reports its honest mean). The
   page must be live (200 unauthenticated) and the AI pack must ship. **Delivery is gated only on
   integrity (ADR-0011), not on the score:** a page below the bar still ships, with its weakest axis
   named to the requester. Refine, or flag honestly. Never ship slop and call it done.
5. **The submitted repo IS the identity (INV-21).** You build an explainer of the EXACT
   repo the human submitted — nothing else, ever. If it cannot be cloned (private,
   deleted, typo) or its clone is broken, STOP with an honest, actionable reason ("we
   can't access this repo — if it's private, share it with our GitHub account or make it
   public, then rebuild"). NEVER search for, substitute, or reconstruct a similar-looking
   repo or its README: an explainer of the wrong repo is fabrication, the one unforgivable
   output — worse than shipping nothing (incident 2026-07-08). The boundary tools enforce
   the pin mechanically: `clone-repo` and `deploy` refuse any `repo.url` that doesn't match
   `EXPLAINER_SUBMITTED_REPO` when the harness sets it.

6. **Credit the PERSON behind the repo.** `clone-repo` resolves the owner's public GitHub
   profile into `repo.author` (real name, bio, company, blog). When it's a real person (not
   an org), the page's attribution names them, and your copy should give the author honest
   props where it's natural — people build these things, not handles. Use only what their
   public profile says; never speculate about who someone is.

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

### Tool roster

The station order, and which door runs each station, is `src/stations.mjs`. **You are the HOSTED door**:
the table below is exactly the stations of that file whose doors include `hosted`, in the order you meet them.
The harness, not you, does the clone, the concept tournament, the notify email and the advisory claims check.
The stations that run on the local door only (`make-ask`, `publish-repo`, `repo-seo`, `readme-enhance`,
`make-overview` and its `redeploy` / `republish`) are not yours: never run them.

| Station | Tool | Fills slot | Who runs it |
|---|---|---|---|
| 0–1 | `tools/clone-repo.mjs` | `repo` (+ `buildId`) | the harness already did it for you |
| 1 | `tools/build-kb.mjs` | `understanding`, `kb` | you |
| 2 | `tools/concept-tournament.mjs` | `concept` (seeds it) | the harness, BEFORE you start; advisory |
| 3 | `tools/check-claims.mjs` | `claims` | the harness, AFTER you finish; advisory |
| 4 | `tools/generate-image.mjs` | `visuals.hero` / `visuals.sections[]` (one call, all rungs) | you |
| 4 | `tools/make-favicon.mjs` | `brand.favicon` | you |
| 4 | `tools/make-social-card.mjs` | `brand.socialCard` (required; a missing or unreadable card stops the build) | you |
| 4 | `tools/make-diagrams.mjs` | `visuals.architectureDiagram` / `.flowDiagram` / `.bigIdeaDiagram` / `.insightDiagram` / `.heroAnim` | you |
| 6 | `tools/assemble-page.mjs` | `page` (+ SEO/social `<head>`, sitemap/robots/llms.txt) | you |
| 6 | `tools/make-pack.mjs` | `pack` | you |
| 7 | `tools/quality-grade.mjs` | `quality` (two scorecards) | you |
| 8 | `tools/deploy.mjs` | `publish.liveUrl` / `.http200` and the below-bar disclosure | you |
| 9 | `tools/notify.mjs` | `notify` | the runner sends it, not you |

`concept` (Station 2, when no tournament ran) and `content` (Station 3) have **no tool** — you fill them
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

Critical path: **S1 → S2 → S3 → S4(slowest visual) → S6 → S7(may loop) → S8.**
Parallelize off-path (see "Parallelism" at the end): raster rungs fire together;
the diagram rows are authored during S3; favicon + social card start the moment the hero
returns; the AI pack builds as soon as S1's KB exists. Optional, local-door-only extras
(README outreach, the video overview) never sit on the path.

### Station 0 — VALIDATE
- **Do:** Confirm the repo URL is reachable (supports private + the owner's own
  repos via the env token).
- **Tool:** `node tools/clone-repo.mjs <build-dir>` (this also clones in S1).
- **Cue:** `repo.reachable === true`. If unreachable/unauthorized, **stop with a
  clear human reason** — not a stack trace.

### Station 1 — UNDERSTAND (read the repo deeply; this is where grounding is earned)
1. **Clone** (the `clone-repo` call above leaves the working tree at
   `<build-dir>/repo/`).
2. **Register the target** in `kb/kb.config.mjs` (`kb:register` in the station table) with an
   **`embed` block** (model + dimension; registered targets use `Xenova/bge-small-en-v1.5`, 384-dim) and its
   `repoDir` pointing at the clone. `kb/build-kb.mjs` **refuses a target with no `embed` block** (there is no
   default embedder), writes `<slug>-kb.rvf`, and records the model it used in `<slug>-kb.rvf.embed.json`;
   that sidecar, not this document, is what governs queries and what `kb/index-primer.mjs` checks (it throws
   if the sidecar is missing or names a different model than `ids.json`).
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
   `tools/make-pack.mjs` fails with `missing required input: …<slug>-primer.md`
   if absent. Never let a tool fake it.
6. **Index the authored primer:** `node kb/index-primer.mjs <slug>` (a write/index
   step — it consumes the primer you wrote; it does not create it).
- **Cue:** the KB answers **"what is this repo?" correctly**, the repo is **named
  correctly**, the **three structured JSONs exist**, and **`<slug>-primer.md`
  exists**. A failed RVF build **hard-fails honestly** — there is **no** fallback to
  a JSON-only analysis (that re-introduces the fake-KB defect, INV-06). Retry once,
  then stop with an honest reason.

### Station 2 — CONCEIVE (pure judgment — the art-direction brief; no tool)

**IF `concept.tournament` EXISTS (2026-07-13 build economics):** the concept was chosen by the
pre-agent text-mode tournament — three models competed, a judge ranked them, and the winner is
already seeded in `build.json.concept`. Your Station-2 job becomes VALIDATE, not invent:
check the winning spec against the full KB (the tournament only saw the README + tree). Keep it
unless the KB contradicts it — if a claim is wrong (the metaphor hinges on a capability the code
doesn't have), fix the minimum and record why in `concept.tournamentOverride`. Fill any missing
fields (e.g. `rejectedDirections` from the tournament's losing candidates). Do NOT discard a
validated winner to invent your own — the premium judgment already happened, in text, at text
prices. Skip the three-directions step below; the tournament WAS it.

Otherwise (no tournament ran — it fails open), before any rendering, invent **THIS repo's**
brief and write it into the `concept` slot of `build.json`. Each explainer is **unique by default, reliable by
construction** — never cookie-cutter, never templated (a templated look is a Gate-B
failure). The brief, grounded in what the KB revealed:

- **`metaphor`** — a visual metaphor that genuinely fits this repo (PhotonLayer →
  prism; ruvn → evidence dossier; ruqu → Bloch-sphere orb). A stranger should nod.
- **`palette`** — colours that fit the metaphor, as an **object of knobs** (`{ "accent": "#…", "bg": "#…", … }`),
  never prose: `assemble-page` reads it as an object and **fails loud** otherwise. These are the
  **design-system expression knobs**; `assemble-page` compiles them into the page's per-repo theme
  layer over the shared `assets/design-system/design-system.css` skeleton. This —
  the palette + type knobs you set here — **is** the page's "theme.css": the
  invariants (responsive, accessible, the required sections) live in the shared
  skeleton; the **expression** is what you set in `concept`. (The concept tournament already emits
  this object shape, so a tournament winner renders as is.)
- **`typePersonality`** — an object (`{ "display", "sans", "mono", … }`): a display + body + mono pairing
  that carries the metaphor's voice.
- **`heroConcept`** — the single emotional opening-image idea.
  - **THE HERO PROMPT MUST *BE* THE METAPHOR.** `visuals.hero.prompt` renders `concept.metaphor` literally and
    concretely; a generic glowing network or constellation is the tell that you stopped thinking (ADR-0008).
- **`copyVoice`** — the tone/register for all authored text.
- **`tagline`** — the one line baked into the social card + `og:description`.

- **THREE DIRECTIONS, THEN A VERDICT.** Author three genuinely divergent art directions (different metaphor
  family, palette temperature and layout rhythm, one line each on why it fits THIS repo), then commit to ONE.
  The house look never wins by default, and never open another build's `build.json` or page for direction
  (the exemplar bar is a quality bar, not a style guide). Record the two rejected directions in
  `concept.rejectedDirections`.
- **Cue:** the brief is **specific to THIS repo** and the **metaphor genuinely
  fits**. A generic brief is a failure **here**, not at the gate.

### Station 2b — THE STORY SPEC (do this BEFORE authoring a single section)
**Write the thesis and the arc FIRST, then write sections to serve them.** An insider-ordered story cannot be
rescued by better sentences (ADR-0006).

Write into `concept.story` before Station 3:
- **`thesis`** — ONE plain sentence a stranger understands, that the whole page proves. Zero jargon.
  Not "a 1.58-bit quantized embedding engine" — *"a 4.6 MB file, loaded into a web page like an
  image, that can tell which sentences mean the same thing — with no server and nothing leaving
  your computer."*
- **`arc`** — the beats, and they open in **THE READER'S WORLD**, not the machine's. The winning
  shape, every time: **a pain they have personally shipped** (a search box that returns nothing for
  "my card got declined" when the article says "payment failed") → **the fix they'd reach for and
  hate** (rent a hosted AI: a key, a bill, their users' text leaving the box) → **the artifact**
  (a 4.6 MB file you ship with your page) → **and ONLY THEN the trick**, which now arrives as the
  ANSWER to a question they are already asking ("how can that possibly be small enough?").
  Trick-as-payoff, never trick-as-premise.
- **`closeTheLoop`** — the concrete example from the opening beat MUST reappear at the end of the
  flow diagram. The reader verifies their own comprehension against the pain they were shown 30
  seconds earlier instead of taking the payoff on trust. ("Nearest point wins — finds *payment
  failed*.")
- **Cue:** if your opening beat would mean nothing to someone who has never heard of this field,
  you have written an insider story. Start again.

**When the repo is genuinely hard to frame, run the bake-off:** author 3 story angles in parallel
(subtraction / reader's-world / one-physical-object are good seeds), judge them with 3 distinct
lenses (zero-knowledge reader · skeptical editor · art director), and take the winner. It cost 4
minutes and beat an hour of hand-patching.

### Station 3 — AUTHOR (pure judgment — the content; no tool)
Write the content along the **comprehension arc** into the `content` slot. The
reader asks a sequence of questions; every section answers the **next** one as it
forms. **Never show a low-level detail before the high-level frame that makes it
legible.**

**THE COMPREHENSION LADDER (ADR-0006 v1.2.0 — altitude control).** The reader is a **curious
FIFTEEN-YEAR-OLD** (ADR-0006 D8; this replaced "a smart developer from a different domain"). They have never
built software. After rungs 1–4 they must be able to say, in their own words: what this is, what it
would do FOR THEM, why the trick is clever, and roughly how it works.

Three hard rules, two of them measured deterministically before any vision pass:
1. **SHAPE — INV-24 ReadsAtFifteen.** Flesch-Kincaid grade ≤ 9.5, no sentence over 30 words, average
   ≤ 22, over the rung-1-4 text. The pages that triggered this averaged 25 and 39 words per sentence
   and read at grade 11 and 16 — with every acronym correctly glossed. Vocabulary was never the whole
   problem; a three-clause sentence of common words defeats INV-20 completely.
2. **PLAIN WORDS OVER GLOSSED JARGON.** Prefer "the same login you already use" over "SSH session (a
   secure shell login)". A gloss keeps the jargon; plain words remove it. Insider nouns (protocol,
   endpoint, transport, runtime, schema, stateless, client, server) do not belong in rungs 1-4 at all
   unless the page collapses without them. No file paths, code identifiers or commands there either.
3. **LEAD WITH WHY IT EXISTS (D10).** Banned: naming the CATEGORY ("it is a virtual desktop") instead
   of the change it makes for the reader, and explaining the ENABLER as if it were the product. Read
   the repo's own README opening before fixing your thesis — if the project calls itself one thing and
   your page sells something smaller, your page is wrong. State the PRIMARY use case explicitly.

Sections 1–4 (hero, problem, whatItIs, insight) assume **zero** domain
knowledge: no acronym or term of art without a plain-words gloss at first use (INV-20
fails the build on violations, deterministically; the gloss must sit AT first use — an
appositive or dash form — not in a later sentence). The **problem section works from
first principles** — make the reader FEEL the pain in human, consequence terms BEFORE
any category vocabulary; never name the solution's category before the reader feels the
problem it kills. `howItWorks` may descend ONE technical level (terms still defined);
`useCases`/`getStarted` return to the reader's world — how THEY would use it and exactly
what the experience looks like. Grounding (INV-06) supplies the FACTS, not the
VOCABULARY: translate insider terms; cite the passage, don't parrot its jargon.

**SHOW, THEN SAY.** No section runs more than about 120 visible words before a visual, a code block, a real
artifact or a structural element carries the next beat; the page must beat the repo's own README on
scannability.

Author all eight sections:

| Reader's question | Section | Medium of its image |
|---|---|---|
| What world am I in? | `hero` | raster (the metaphor performed — every element maps to a named concept of THIS repo) |
| Why does this exist? | `problem` | raster (the pain shown through ITS OWN artifacts — the leaked token, the 47 configs, the tangled wiring — never a person reacting to it) |
| What does it actually do? | `whatItIs` | SVG (the big-idea, whole-thing diagram) |
| Why is it elegant/clever? | `insight` | SVG (the ONE clever move — the "aha") |
| How is it built / works? | `howItWorks` | SVG (**architecture + flow**, descend ONE level) |
| Could I use this? | `useCases` | **REAL ARTIFACT FIRST** (screenshot/capture of the repo's own UI, CLI, or output actually running — see the image contract below); generated raster only when the repo has no visible surface, and then it must teach |
| How do I start? | `getStarted` | SVG (quickstart path to first run) |
| (my AI gets it too) | `pack` | SVG (the dual-output: page for humans, KB for their AI) |

**Grounding is non-negotiable (INV-06).** Every claim must be traceable to a KB
passage retrieved via `node kb/ask-kb.mjs <slug> "…"`. Record `content.citations`
as `{ claim, passageId }`. **No invented capabilities, no "lorem", no "TODO", no
placeholder text.** As you author `howItWorks`, capture the architecture and flow as
`visuals.architectureDiagram.rows` / `visuals.flowDiagram.rows` (and `bigIdeaDiagram` / `insightDiagram`
rows): short concept-card labels, never ASCII art. `make-diagrams` draws them in S4.

- **Cue:** all arc questions answered, zero placeholder text, every claim traceable
  to a KB source. A4 specifically: the page explicitly answers **"how is this useful
  to YOU"** (cure engineer-blindness — never assume the reader already cares).

### Station 4 — VISUALIZE (feeling = raster, structure = SVG)

- **THE IMAGE CONTRACT (INV-22, ADR-0008 — every image must teach, or it must not exist).** Rules, in force
  for every raster on the page:
  1. **Every raster brief MUST carry a `takeaway:` line** — the one sentence a stranger should
     be able to say about THIS repo after looking at the finished image (not the caption — the
     pixels). No stateable takeaway → the image is decoration → do not generate it; give the
     section a diagram, a real artifact, or nothing.
  2. **The swap test kills generics:** if the finished image could ship unchanged on a
     DIFFERENT repo's page, it fails. A person at a laptop passes the swap test for every repo
     on earth — which is exactly why it is banned.
  3. **BANNED imagery (the AI-slop list — these have all shipped and all read as slop).**
     **NO ROOMS, NO PROPS, NO PEOPLE (ADR-0008 v1.1.0):** desks, offices, cafes, windows,
     plants, coffee cups, notebooks, pens, books, stray phones, sticky notes as set dressing, hands.
     Compose from the SUBJECT ITSELF — the screens, artifacts
     and objects the repo is about — filling the frame. Also banned:
     person at a laptop/desk/screen · hands typing · generic office or cafe scenes · glowing
     abstract networks/particles · fake UI floating on a fake device · concerned-developer
     stock moods. The model WILL drift back toward these under a vague brief; the brief is
     where you stop it.
  4. **REAL ARTIFACTS BEAT GENERATED SCENES.** The repo is cloned and on disk; playwright and
     a shell are right there. If the repo ships anything visible — a web UI, a TUI, CLI
     output, rendered artifacts — RUN IT and capture the real thing (compose/crop/annotate;
     dark-theme it to the page palette if its UI allows). An authentic screenshot with one
     annotation arrow teaches more than any generated scene, and it is the one image class no
     other repo's page can have. Generated rasters are for what cannot be photographed: the
     metaphor (hero) and the pain made visible (problem).
  5. **Metaphor discipline (before any raster brief):** name the visual metaphor AND write the
     element map — which visual element stands for which named concept of this repo. An
     element that maps to no concept is decoration; cut it. (This is the paperbanana
     discipline: find the real-world analogy first, then draw only its load-bearing parts.)
- **Precondition (probe, fail loud).** Before generating raster, the
  `generate-image` tool probes the **verified primary `gpt-image-2.5-flare`**
  (Images 2.5, confirmed by a real 1536×1024 generation 2026-09-17). Only if that
  build-time probe **fails** does it fall back to `gpt-image-2`; `grok-imagine-image-2.0`
  covers a missing OpenAI key. Never proceed on an unverified ID; if the whole chain
  fails, **stop loud** with the failing ID.
- **Raster rungs (emotional) — `generate-image`, ONE call, no rung argument:**
  the tool reads every declared rung (`visuals.hero` + `visuals.sections[]`) from
  `build.json` itself and generates all of them internally with bounded
  concurrency (never one process per rung: there is no per-rung CLI argument). Covers the
  **hero (1536×1024)**, the **problem (1024×1024)**, and the **use-case scenario
  (1024×1024)** at quality `xhigh` (see the QUALITY comment in `tools/generate-image.mjs`). Valid sizes: `1024×1024`,
  `1024×1536`, `1536×1024`, `auto` (the DALL·E-3 `1792×1024` is rejected — never use it).
- **STRUCTURAL RUNGS ARE DRAWN BY `make-diagrams` FROM WHAT YOU AUTHOR (INV-23: rails on truth,
  never on form).** You do **not** hand-write the architecture, flow, big-idea or insight SVGs: you
  author the *content* (`visuals.<slot>.rows`, and the optional story slots below) and `make-diagrams`
  draws each slot, then checks it. The only SVG you may author yourself is the hero scene
  (`visuals.heroAnim.sceneSvg`, below). What `make-diagrams` guarantees, so you do not have to:
  1. **Distinct forms.** Each slot gets its own form family (`vertical-stack`, `horizontal-run`,
     `radial`, `containment`, `grid`; concept variants `column` / `ribbon` / `orbit` / `strata` / `grid`),
     chosen by what the slot says; two diagrams on one page never share a family, and a collision
     fails loudly before any file is written (INV-23). Nested frames (`strata`) are only used when your
     own text says one thing is inside another.
  2. **Drawn twice, from one model.** A wide canvas plus a 360-wide portrait **phone twin**
     (`assets/<name>.m.svg`, recorded as `mobileSvgPath`). The page swaps them with `<picture>`.
     `make-diagrams` measures the smallest text on the phone twin and **fails the step** if any label is
     under 11 px on a 390 px phone (`mobileLabelPx`). Keep labels short; a long label is the usual cause.
  3. **Craft and validity.** Real `<text>`, `<title>` + `<desc>` accessible text, a `viewBox`, the
     palette from `concept`, `xmllint --noout` on every file, labels checked for overlap.
  4. **The flow diagram must SHOW the thesis, not name stages.** For a repo whose trick is spatial
     ("the key never leaves the vault"), author rows (or a `decision` story, below) that make the
     invariant visible. If a stranger cannot see the trick happen, it is a list of stages.
  Banned as "performance": a dot moving along a path, pulsing glows, crawling dashes: motion must
  change something the argument depends on. **Style micro-labels in sentence case** (ALL-CAPS words
  such as DISK or AGENT trip the INV-20 acronym gate).
- **What is drawn, per slot** (the first that applies wins): a verified story diagram (`systemMap` ->
  architecture slot, `decision` -> flow slot); else for architecture a **radial hub-and-spokes
  dependency map** from the real dep-graph, and for flow a vertical build-lifecycle stack from the real
  entrypoints (skipped for a library with none); else the **authored concept diagram** from
  `visuals.<slot>.rows`. The big-idea and insight slots are always authored concept diagrams.
  The **two diagrams that are MANDATORY on every explainer (INV-18 — the three questions every
  developer asks):**
  1. an **ARCHITECTURE diagram** (*how is it constructed*), built from `<slug>-dep-graph.json` +
     `<slug>-symbols.json`, and
  2. a **PROCESS / DATA-FLOW diagram** (*how does it work*), built from `<slug>-entrypoints.json`.

  Both are **grounded in the repo's REAL structure, never invented.** You author the rows (they fell out
  of S3); `make-diagrams` draws crisp, accessible, xmllint-clean SVGs. **These SVGs are emitted once and
  reused by both the page AND the README PR (S8b, local door)** — author once, share.

- **A DIAGRAM MUST CARRY INFORMATION, OR IT MUST NOT BE DRAWN.** A truthful picture of an empty graph
  ("N modules, 0 internal links") is a defect. Two rules enforced in `make-diagrams`:
  1. **Trivial dep-graph (0 internal edges) → the dependency map is not drawn.** `make-diagrams`
     draws your authored concept instead, or **fails loud** if you wrote none. Author
     **`visuals.architectureDiagram.rows`**: the *concept* of how the thing is
     built — the 3-4 parts a reader must hold in their head — not the package wiring.
  2. **The flow diagram is the RUNTIME data-flow** — *what happens to the reader's data* —
     authored as `visuals.flowDiagram.rows`. If you leave it unauthored, the tool falls back
     to the install→build→run→test model and **honestly retitles it "Build & run lifecycle"**,
     because that is what it is. Shipping a build lifecycle captioned "Data-flow pipeline" is a
     lie the vision grader has caught repeatedly. Author the real flow.

  **`rows` shape (a footgun — read this):** a connecting arrow is drawn **only between items *within
  the same row***. So a connected chain is **ONE row of N items**, not N rows of one item (that renders
  as floating cards with no arrows — a bulleted list, not a structure). The resolver then picks the
  chain's shape (a short chain may become a ribbon; a long one a column) so it stays legible on a phone:
  `"rows": [{ "items": ["your sentence", "tokenizer", "add · skip · subtract", "384 numbers"], "connect": true }]`

- **STORY DIAGRAMS (`visuals.systemMap`, `visuals.decision`) — answer the questions a reader
  actually has (ADR-0014).** The dependency graph says how the code is arranged; it cannot say
  *what this plugs into*, *what it works with*, or *how it decides*. Author these two when the repo
  has a real answer, and OMIT them when it does not:
  - `systemMap` → replaces the architecture slot: inputs → one engine (2–4 steps) → the surfaces that
    drive it (with their real commands) + a **works-with** strip + **runs-on**. Include the hosts,
    editors and platforms a reader would WONDER about (does it work with Codex? Windows?), each as
    `yes`/`partial` with `file` + a VERBATIM `quote`, or `no` with `terms` to search.
  - `decision` → replaces the flow slot, for repos that CHOOSE among candidates by a rule (pickers,
    routers, schedulers, rankers): 2–6 candidates as gauges against a threshold, one picked, one
    skipped for a stated reason, and `rule: { file, quote }` pointing at the source line that
    defines it.
  **You do not get to assert these.** `make-diagrams` checks every quote against the cloned repo and
  runs the "no" searches itself; whatever it cannot confirm is dropped, and if nothing survives the
  slot keeps the grounded graph diagram. So quote, do not paraphrase, and prefer fewer true claims.
  Shapes are in `src/story-diagrams.mjs` (`validateSystemMap`, `validateDecision`) and a worked
  example is `tests/fixtures/story-claude-swap.mjs`. Story diagrams get the same phone twin and the
  same 11 px floor as every other slot (ADR-0014).

- **THE HERO ANIMATION (`visuals.heroAnim`) — motion that PERFORMS the argument.** Author this for
  every repo that has a "trick" (almost all of them do). It renders above the fold as a short loop
  and it is the only motion on the page. **Animate the ARGUMENT, never the chrome** (crawling dashed lines and
  pulsing dots are decoration). What earns its place is the project's one idea, *performed*: for ternlight, the
  model's messy decimal weights (`0.0731`, `−1.24`) **snap** to exactly `0` / `−1` / `+1`; as each
  lands, the word beneath it appears — **skip · subtract · add**; then the multiply sign is struck
  through and goes dark: **never used**.

  The shape is deliberately generic — a **BEFORE → AFTER transformation, plus the cost it kills** —
  because that is the shape of most interesting repos' tricks, not a ternary-specific one:
  ```json
  "heroAnim": {
    "label":   "The numbers inside the model",
    "chips":   [{ "before": "0.0731", "after": "0",  "op": "skip",     "kind": "zero" },
                { "before": "−1.24",  "after": "−1", "op": "subtract", "kind": "neg"  },
                { "before": "3.90",   "after": "+1", "op": "add",      "kind": "pos"  }],
    "verdict": { "label": "The one expensive move", "symbol": "×", "dead": "never used" },
    "kicker":  "it never multiplies — and that is why it fits in 4.6 MB"
  }
  ```
  Rules: 3–6 chips. `kind` ∈ `zero|neg|pos` (drives colour). **Sentence case, never ALL-CAPS** — the
  deterministic INV-20 acronym gate reads an uppercase word as an acronym and will fail the build
  before the vision pass. **No `heroAnim` → no animation band**, and the tool will NEVER substitute
  another repo's (this content is per-repo and lives in `build.json`, never in the tool).

  **THE CHIPS BAND IS THE FLOOR, NOT THE CEILING.** For any repo whose trick is spatial or mechanical (most),
  author a **bespoke animated SVG SCENE** instead (`visuals.heroAnim.sceneSvg` → `assets/hero-scene.svg`, same
  in-SVG CSS/SMIL, no external JS, a `viewBox`, real `<text>` and `<title>`/`<desc>`).
  One validator (`tools/diagrams/scene.mjs`) decides: a root `<svg>` with its own `id` and a `viewBox`; real
  animation AND a `prefers-reduced-motion` static end state; every CSS selector, keyframe name and inner id
  scoped under the root id (the SVG is inlined into the page); no script, `foreignObject`, event handler or
  external reference; smallest text >= 11 px at phone width; xmllint-clean; at most 25 KB. `make-diagrams`
  refuses an invalid scene loudly. **When a valid scene exists, `generate-image` does not draw the raster hero**
  (`visuals.hero.rasterSkipped: "scene"`, `cost.heroRasterSkipped`): the scene IS the hero, so **author
  `heroAnim.sceneSvg` before you run `generate-image`**. A static backdrop (`assets/hero-scene-static.png`,
  not shipped in the site) feeds the favicon and share card. On the local door the brain authors the scene
  itself (`heroAnim.sceneMarkup`), gets one repair pass, and otherwise falls back to the raster hero and records
  `visuals.heroAnimSkipped.reason`. Scenes have not yet been run against a live model at scale. **Labels inside a scene are page copy**
  and obey the ladder: plain words, sentence case (ALL-CAPS reads as an acronym to INV-20).
  **OPTIONAL 3D (`visuals.hero3d`)**: an authored ES module mounted OVER the flat scene only when the
  viewer has WebGL and has not asked for reduced motion; the scene stays in the DOM as the fallback
  and the 3D layer fades it rather than double-drawing. Use 3D only when the subject is genuinely
  spatial — it earns nothing on the vision gate, which scores still screenshots: a 6–10s loop in which the mechanism VISIBLY HAPPENS — for
  a credential broker, the request plug travels the switchboard and returns with a result
  while the key never crosses the vault line; for a quantizer, the messy weights snap to
  three states. The chips band is the fallback for repos whose trick is genuinely abstract.
  Banned as "performance": a dot moving along a path, pulsing glows, crawling dashes — motion
  must CHANGE something the argument depends on (a value, a position across a boundary, a
  state), not merely travel.
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
- **Cue:** **valid favicon files** AND a **valid 1200×630 social card**. The card is **required and
  verified** on both doors (`make-social-card` is fatal and no `--no-*` flag skips it): the card
  legibility gate (WCAG 4.5:1 ink on the backdrop) must pass, and `src/site-check.mjs` then checks the
  assembled page: a 1200×630 card under 1.5 MB, `og:image` and `twitter:image` the same absolute https
  file on the deploy host, `og:title` at most 70 characters, plus a live fetch after deploy. A missing
  or unreadable card **stops the build loud** — never substitute a default. The card's delight + craft
  are judged at the gate (B5).

### Station 6 — ASSEMBLE + PACK (the page is rendered ONCE)
- **Precondition (fail loud).** `<slug>-primer.md` AND the three structured JSONs
  MUST already exist (S1). If the primer is missing, **stop loud** and return to
  Station 1 — never synthesize a placeholder to get past `make-pack`'s
  `missing required input` check.
- **Do (a) — render the page once:** `node tools/assemble-page.mjs <build-dir>`.
  This composes `concept` + `content` + `visuals` + `brand` onto the shared
  `assets/design-system/design-system.css` skeleton + the per-repo theme, wires the
  full **SEO + social `<head>`** (`<title>`, meta description, canonical, JSON-LD
  `SoftwareApplication`/`SoftwareSourceCode`, favicon links, OG + Twitter
  `summary_large_image` pointing at the S5 card), emits root-level **`sitemap.xml`,
  `robots.txt`, and `llms.txt`**, links the primer in the download block (the primer itself ships inside the pack zip), and
  injects the **mandatory ISOvision attribution + CTA footer verbatim** (see below).
  **No string markers** (INV-10).
- **Do (b) — build the AI pack:** `node tools/make-pack.mjs <build-dir>`. `make-pack` is a **port**
  of the old drop-in packer (it no longer wraps another tool), and it writes the one slot
  `pack = { zipPath }`. The zip ships the `for-ai/` half (the single-store `<slug>-kb.rvf` + idmap +
  `.passages.jsonl` + `.ids.json` + the **three structured JSONs** + the `kb/` engine files
  `ask-kb.mjs`, `kb-mcp-server.mjs`, `resolve-deps.mjs` + a generated single-store `kb.config.mjs` +
  a `package.json` whose `@ruvector/rvf` and `@xenova/transformers` ranges are copied from this
  repo's own `package.json`) and the `for-humans/` half (the authored primer).
- **Cue:** **zero dangling refs or unresolved tokens** in the page; the **pack opens,
  the KB loads, and `node ask-kb.mjs <slug> "…"` returns real passage TEXT** (not
  `{id,distance}`); **the MCP server's `lookup_symbol`, `get_entrypoints`,
  `get_dep_graph` each return real data** (proving the three JSONs shipped); **the
  primer is present in `for-humans/`**; and the **SEO presence check** passes
  (`<title>` + meta description + canonical + JSON-LD + OG/Twitter + favicon links +
  `sitemap.xml` + `robots.txt` + `llms.txt` all present + well-formed) — or the
  station **stops loud**. The AI pack is a hard deliverable (INV-07).

> **The ISOvision footer is mandatory on EVERY explainer.** `assemble-page` injects
> it (design-system §16b). In order: (1) the credit "Explainer page created by
> **Stuart Kerr** at **ISOvision**" (Stuart Kerr links to his card, ISOvision to
> `https://isovision.ai`), with a small line crediting the open-source explainmyrepo engine
> and inviting a star or an issue; (2) the CTA "Would you like your own repo explainer
> page? **Generate one here**" -> `https://explainmyrepo.isovision.ai`. Semantic
> `<footer role="contentinfo">`, real `<a>` links, on-brand tokens, AA contrast,
> responsive. If it is missing, the page is not done.

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

  **The OPERATOR QUALITATIVE GATE — six YES/NO questions (the owner's words), ALL must be YES or you
  loop:** (1) Would this make me believe I understand this? (2) Would this make it approachable?
  (3) Would this explain it for somebody who doesn't understand it? (4) Would it give me confidence I
  understand the architecture? (5) Does it make me smile — "oh, that's cool"? (6) Could someone who
  knows nothing about this domain read the first four sections and explain the problem and the
  solution back to me? (ADR-0006 v1.2.0 — the critic answers (6) role-playing a **curious
  fifteen-year-old**, not a developer.) These are independent of the numeric axes; a page can clear the
  numbers and still fail one of these. Two deterministic, FREE gates run before the vision pass:
  **INV-20** — any acronym in the first four sections without a plain-words gloss AT first use; and
  **INV-24 ReadsAtFifteen** — those sections must measure Flesch-Kincaid grade ≤ 9.5, no sentence over
  30 words, average ≤ 22. Either failure costs zero tokens, charges no grading iteration, and returns
  the measured numbers for the refine loop to fix.

- **The bar + the loop (non-negotiable — iteration over a few revs is EXPECTED, not a failure):**
  - **TWO TIERS (`tools/quality-grade.mjs`).** **EXEMPLARY** (`evaluatePass`): on **BOTH** devices,
    **mean ≥ 90 AND min axis ≥ 85 AND all six operator questions YES** (11 axes × 2 devices); the
    **min ≥ 85 is the anti-slop floor**. **SHIP** (`evaluateShipworthy`): **mean ≥ 82 AND min ≥ 70 AND
    the five ship operators YES** (`architectureConfidence` is informational) AND the INV-18 diagrams
    present. Aim for EXEMPLARY; a page that is SHIP-worthy but not exemplary is delivered with an honest
    note; every page reports its honest mean.
    A device whose mean lands within 82±3 is graded a second time and the two samples merged.
  - **`headlineScore` = the MINIMUM across all axes** (the anti-slop floor); **`meanScore` = the mean**
    (the "as good as the examples" measure). Both are reported; the mean is not ignored.
  - **RUN THE REFINE LOOP:** any axis below the bar OR any operator NO → the gate **names the exact
    weakness** (which criterion / which question, which device, what it saw) → you **refine just
    that, surgically** (a B1 typography miss re-opens `page`; an A4 "not useful to me" miss re-opens
    `content`; an A6 / B5 / diagram miss re-opens `visuals`) → **re-assemble** (`assemble-page`) →
    **re-grade** (`quality-grade`) → **LOOP** until it clears on both devices. Touch **only** the named
    weakness — never a broad reflow that could regress a passing axis.
  - If the grader returns malformed / missing / non-per-criterion scores, the gate
    **stops loud and does not pass** — a broken grader is never a silent green.
  - **At the cap: DEPLOY AND FINISH (ADR-0011).** The tool enforces a hard cap of 3
    quality-grade calls. When you reach it, run `deploy` and you are done — whatever the score says.
    Delivery is no longer conditional on quality: `deploy` refuses only on **integrity** (a page that
    did not assemble, a source-identity violation, or a missing scorecard), never on a low grade. A
    below-bar page ships to its live URL and the requester receives an honest note naming its weakest
    axis in plain words, plus an offer to re-run (ADR-0011 explains why a binary rail was removed).
    *Do not end a run hoping to be rescued by a later re-grade: ship it and disclose.*
  - **The scorecard is DISCLOSURE, not a gate.** It is sent to the requester verbatim. That means
    there is nothing to gain by making the page look better to the grader than it is — grade-chasing
    and cosmetic rubric-pleasing are now pure waste and actively dishonest. Spend the effort on what
    genuinely helps a stranger understand the repo, and let the number land where it honestly lands.
    (The runner still classifies a non-deploying ending deterministically and may run one bounded
    cure cycle with an **independent** cure agent.)
- **Honesty escape hatch:** if a repo **genuinely** cannot reach the bar on some axis,
  **flag it honestly** in the result and the email. **Never ship slop and call it
  done.** Two pre-ship eyes gate S7: the **vision model** and **you** (the
  operator), viewing the **same screenshots**, both agreeing; the target is the EXEMPLARY bar (**mean ≥ 90,
  min ≥ 85, all six operator questions YES**) on both devices. The **owner is the post-delivery third eye** (S9) —
  owner rejection re-opens this same surgical loop.
- **Cue:** the **EXEMPLARY bar (mean ≥ 90, min ≥ 85, six YES) on BOTH devices**, or an honest flag.
  Below the bar the page still ships once the cap is reached, with its scorecard disclosed.

### Station 8 — DEPLOY (local door: + publish the explainer repo)
- **Do (both doors):** deploy the graded page to its **own per-build URL**.
- **Tools:**
  - `node tools/deploy.mjs <build-dir>` — **both doors.** Deploys to `{repo}-explainer.netlify.app` on
    **Netlify**, the only provider; there is no provider switch. Deploy **advises, never refuses on score**; it refuses
    only on integrity (unassembled page, source-identity violation, site-integrity failure, no scorecard with no
    recorded reason).
  - `node tools/publish-repo.mjs <build-dir>` and `node tools/repo-seo.mjs <build-dir>` — **local
    door only.** They create the explainer GitHub repo (named `{owner}-{name}-explainer`, or
    `{owner}--{name}-explainer` when the names are not plain alphanumeric), mark it with
    `.explainmyrepo.json`, invite the owner, and set topics + a description on the **explainer** repo
    (suggestions for the **source** repo are offered, never set directly — INV-16). **You skip both**; do not run them.
- **Cue:** **live URL returns 200 unauthenticated**. On the local door also: the **repo is public**,
  the **owner is invited**, and the **explainer repo has topics + a description set** (verified via
  the GitHub API). A failed collaborator invite is a warning (`ownerInvited: false`); a failed `publish-repo` or `repo-seo`
  stops the local build (both are fatal there) but never un-deploys a page that is already live.

### Station 8b — README OUTREACH (local door in practice — the hosted agent does not run it)
- **Do:** `node tools/readme-enhance.mjs <build-dir>` is **on by default** on the local door and **issue-first**
  (ADR-0015): it opens an **issue** on the source repo offering the explainer. The station table lists it for the
  local door only; the hosted agent never runs it. A pull request is opened only through
  `explainmyrepo outreach open-pr <owner/name>` after a yes (it needs a matching prior issue on record), or when the
  operator sets `README_OUTREACH=pr` explicitly. It reuses the shared S4 diagrams; `explainmyrepo outreach followup`
  posts one check-in 7 days later; a maintainer-email draft goes to the **owner only**, never to the maintainer.
- **Cue:** **nothing reaches the source repo except an issue or a PR** (never a direct push — INV-16).
  It is **off the critical path** and **NEVER blocks the core ship**; a failure is a warning only.

### Station 9 — NOTIFY
- **Do (local door):** `node tools/notify.mjs <build-dir>` — return the result inline **and**
  email the owner the **scorecard + both screenshots + links** (live URL, explainer
  repo, pack) plus, when present, the **README-PR link** and the **suggested
  source-repo topics/description**, so the owner can act on the optional offers and
  be the third eye. **Hosted door: do not run `notify`.** Sending the submitter's email is handled
  outside your process; your job ends once `quality-grade` + `deploy` are done and `publish.liveUrl` is set.
- **Cue:** **send confirmed (SMTP 250).** A notify failure degrades to a warning —
  it never inverts a live, graded, deployed build (INV-04).

---

## Parallelism (speed without coupling)

Scheduling only — it never lets one station read another's files; everything lands
in its `BuildContext` slot.

- **S4 raster images all fire at once** — internally, inside ONE `generate-image`
  call (bounded concurrency in the tool itself, not multiple parallel processes —
  see Station 4 above).
- **The diagram rows are authored during S3** (they fall out of authoring) and
  `make-diagrams` draws them in parallel with the raster generation — not after it.
- **Favicon + the 1200×630 social card (S5) start the moment the hero returns**,
  overlapping the rest of S4.
- **The AI pack builds as soon as S1's KB exists** — it overlaps S2 + S3.
- **The README outreach (S8b) and the video overview are quarantined** (INV-03): local door only,
  off the critical path, after deploy, never block the core ship.

---

## Invariants you personally enforce

- **INV-04 Never-fail-silently** — every station has a loud cue; no placeholder,
  default, or stub past a failure.
- **INV-05 Aim-for-the-exemplar-bar, disclose the rest** — on both devices, mean ≥ 90 AND min axis ≥ 85
  AND all six operator questions YES is the EXEMPLARY target; the SHIP tier (mean ≥ 82, min ≥ 70, five
  ship operators) is what delivery is judged against. Below the exemplar bar, refine within the cap,
  then ship and disclose honestly (ADR-0011).
- **INV-06 Grounded-in-KB** — no claim without a real RVF KB passage; never a JSON
  stand-in.
- **INV-07 Ships-the-pack** — every explainer ships the downloadable AI pack
  (`.passages.jsonl` present so search returns text; the three structured JSONs
  present so all four MCP tools return data).
- **INV-08 Two brains, held in step by tests** — the hosted door follows this skill; the local door authors
  through `src/brain.mjs`. They share the tools and the station table (`src/stations.mjs`) and are pinned to
  the same reader standard and image rules by `tests/two-doors-conform.test.mjs`, not by sharing one brain.
- **INV-16 Source-repo-via-issue-or-PR-only** — any touch to the source repo (README
  enhancement, SEO suggestions) is delivered ONLY as an issue or a pull request, never a direct push.
- **INV-18 Architecture + flow diagrams mandatory** — every explainer ships both
  an architecture diagram and a process/data-flow diagram, as crisp SVGs grounded
  in the repo's real structure; missing either means the build is not done.
- **INV-19 Implementation-experience present** — the Get-Started section shows the command, what the
  reader will SEE when they run it, the steps, what they get, what's next, and prerequisites — never a
  bare "just run this." Scored as A6.
- **INV-21 Source-identity** — the explainer describes the exact submitted repo; an
  inaccessible repo stops the build loudly with an actionable message. Never a substitute,
  never a lookalike, never content reconstructed from search results or a remote README.
- **Mandatory ISOvision footer** — the credit + "create one" CTA footer ships on
  every page, verbatim.

**"Done" = real screenshots; the page graded on both devices with the scorecard disclosed (EXEMPLARY is
mean ≥ 90, min ≥ 85, six YES; SHIP is mean ≥ 82, min ≥ 70); the page is live; and the AI pack ships.
If a stranger doesn't smile — or a newcomer can't follow the first four sections — it isn't finished.**
