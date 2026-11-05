# `tools/` CONTRACT — the anti-brittleness anchor

**Version:** 0.2.0
**Created:** 2026-06-28
**Updated:** 2026-11-05 — slots and roster brought back in line with the code (the station order is now
`src/stations.mjs`; the gate advises, ADR-0011; the Ask box, claims check and post-ship follow-ups exist).
**Paired ADR:** `docs/adr/0005-skill-based-explainer-recipe.md` (D4 — strict brain/tools split + one
`BuildContext`; read its banner, later ADRs supersede parts of it).
**Paired DDD:** `docs/ddd/explainmyrepo-recipe-domain.md` (historical; this file is the slot truth).

This file is **load-bearing**. Generation 2 of this project died because phases were coupled by
string-matched HTML markers — any phase that nudged a marker silently broke a later phase. This
contract is the rule set that makes that failure mode *structurally impossible* again. Every tool
author and the skill ("the brain") MUST obey it.

> **The one-sentence law:** the **brain decides, the tools do.** A tool never thinks, never decides
> "good enough," never reads another tool's files, and never reads the whole `BuildContext`. It
> takes a clear input, produces a clear output, and either succeeds or **fails loud**.

**Where the order lives.** The ordered list of stations, which are fatal, which run on which door
(`local` = the CLI, `hosted` = the website's agent) and the `--no-*` flags is **`src/stations.mjs`**. This file
says what each tool reads and writes; it does not repeat the order. Each tool's own header comment is the detail
reference and is collected verbatim in `skills/explainmyrepo/TOOLS-CONTRACT.md` (a test keeps the two in step).

---

## (a) The `BuildContext` — ONE contract (per ADR-0005 D4)

There is exactly **one** data contract for an entire build: the `BuildContext`, persisted on disk as
**`build.json`** inside the build directory. Each station fills **its own slot**. There are
**no string-coupled HTML markers** — the page is rendered **once** (INV-10) from typed slots, never
mutated incrementally.

```jsonc
{
  "buildId": "uuid-v4",                  // correlation key + idempotency key; set first (clone-repo)

  "repo": {                              // ← clone-repo
    "url": "https://github.com/owner/name", "owner": "owner", "name": "name",
    "slug": "name",                      // KB slug / repo key used by every kb/ script
    "private": false, "defaultBranch": "main",
    "clonePath": "<build-dir>/repo",     // where the working tree lives
    "sha": "HEAD sha of the clone",      // recorded so a pack/manifest names what was actually read
    "reachable": true,
    "author": { "...": "the owner's public GitHub profile (name, bio, company, blog); null for an org" }
  },

  "understanding": {                     // ← build-kb
    "repoName": "name", "summary": "indexed ... N passages, N components, ...", "passageCount": 0   // 0 hard-fails (INV-06)
  },

  "kb": {                                // ← build-kb (paths are repo-root-relative)
    "slug": "name", "storeDir": "kb/stores/name",
    "passagesPath": "kb/stores/name/name-kb.passages.jsonl",   // full text; an .rvf query returns only {id, distance}
    "idsPath": "kb/stores/name/name-kb.ids.json",
    "embedModel": "Xenova/bge-small-en-v1.5",                  // 384-dim
    "primerPath": "kb/stores/name/name-primer.md",             // authored by the brain, indexed by index-primer
    "symbolsPath": "...", "depGraphPath": "...", "entrypointsPath": "..."
  },

  "concept": {                           // ← concept-tournament (seeds) / the brain's `concept` station
    "metaphor": "...", "tagline": "the line baked into the share card + og:description",
    "palette": { "accent": "#...", "bg": "#...", "...": "knob-object, not prose" },   // assemble-page's expression knobs
    "typePersonality": { "display": "...", "sans": "...", "mono": "..." },
    "heroConcept": "...", "copyVoice": "...",
    "story": { "thesis": "...", "arc": ["..."], "closeTheLoop": "..." },
    "rejectedDirections": ["..."],
    "tournament": { "ranAt": "ISO", "winnerModel": "..." }   // present only when the tournament chose the concept
  },

  "content": {                           // ← the brain's `content` station
    "arc": [ { "question": "What world am I in?", "section": "hero", "altitude": "high" } ],
    "sections": { "hero": {}, "problem": {}, "whatItIs": {}, "insight": {}, "howItWorks": {}, "useCases": {}, "getStarted": {}, "pack": {} },
    "citations": [ { "claim": "...", "passageId": "..." } ]   // every claim traceable to a KB passage (INV-06)
  },

  "claims": {                            // ← check-claims (ADVISORY; written by the orchestrator, or by the runner on the hosted door)
    "advisory": true, "ok": false, "findings": 2,
    "citations": { "total": 2, "missing": [ { "passageId": 999 } ] },
    "commands": { "...": "install/step commands that appear nowhere in the KB (the bulky `checked` list is not stored)" }
    // when the checker itself throws: { "advisory": true, "ok": null, "error": "..." } — never thrown into the build
  },

  "visuals": {                           // ← the brain's `visual-brief`, then generate-image (raster) + make-diagrams (SVG)
    "hero":     { "role": "metaphor", "prompt": "...", "file": "<build-dir>/assets/hero.png", "px": "1536x1024",
                  "engine": "gpt-image-2.5-flare", "http200": true, "bytes": 0 },
    "sections": [ { "id": "problem", "role": "...", "prompt": "...", "file": "...", "px": "1024x1024", "engine": "...", "http200": true } ],
    "cost": { "...": "derived image spend written by generate-image (read by src/receipt.mjs); an unpriced engine is UNPRICED, never $0" },
    "architectureDiagram": { "svgPath": "<build-dir>/assets/architecture.svg", "mobileSvgPath": "<build-dir>/assets/architecture.m.svg",
                             "altText": "...", "asciiFallback": "...",
                             "form": "radial", "formVariant": "<variant name, or the story kind>", "mobileLabelPx": 11.2, "rows": [], "title": "..." },
    "flowDiagram":      { "...": "same keys; absent for a library with no entrypoints" },
    // every diagram is drawn twice: a wide svgPath and a 360-wide phone twin (mobileSvgPath); mobileLabelPx is the
    // smallest text on the twin and must be >= 11 (px on a 390px phone) or make-diagrams fails
    "bigIdeaDiagram":   { "...": "same keys; `rows` authored by the brain" },
    "insightDiagram":   { "...": "same keys; `rows` authored by the brain" },
    "systemMap": { "...": "authored (ADR-0014); replaces the architecture slot once make-diagrams has verified its quotes" },
    "decision":  { "...": "authored (ADR-0014); replaces the flow slot" },
    "heroAnim":  { "label": "...", "chips": [], "verdict": {}, "kicker": "...",
                   "sceneSvg": "optional file path (hosted agent)", "sceneMarkup": "optional inline SVG (local brain)" },
    "heroAnimSkipped": { "reason": "why the local brain shipped no scene (invalid after one repair pass, or none authored)" },
    // a valid scene REPLACES the raster hero: visuals.hero.rasterSkipped === "scene", cost.heroRasterSkipped is set, and
    // assets/hero-scene-static.png (not shipped in the site) is rendered from the scene for the favicon and share card.
    "hero3d":    "optional authored ES module (ADR-0013)"
  },

  "brand": {                             // ← make-favicon + make-social-card
    "favicon":    { "set": ["favicon-16.png", "favicon.ico"], "appleTouchIcon": "apple-touch-icon.png", "derivedFromHero": true },
    "socialCard": { "px": "1200x630", "file": "<build-dir>/assets/social-card.png", "tagline": "...",
                    "legibility": { "minContrast": 4.5, "measured": {}, "attempts": 1 } }
  },

  "page": {                              // ← assemble-page (rendered ONCE)
    "dir": "<build-dir>/site", "htmlPath": "<build-dir>/site/index.html", "cssPath": "...", "tokensUsed": ["--accent"],
    "seo": { "title": "...", "description": "...", "canonical": "https://...", "jsonLd": "...", "sitemap": "sitemap.xml", "robots": "robots.txt", "llmsTxt": "llms.txt" },
    "social": { "og": {}, "twitter": {} }
  },

  "pack": { "zipPath": "<build-dir>/site/name-knowledge-pack.zip" },   // ← make-pack (nothing else is stored)

  "ask": { "passages": 0, "sections": 0, "starters": [] },             // ← make-ask (LOCAL door only) — or { "skipped": "why" }

  "quality": {                           // ← quality-grade (DISCLOSURE, not a delivery gate — ADR-0011)
    "scorecard": [
      { "device": "mobile(390)", "gateA": { "A1": 0, "...": 0, "A6": 0 }, "gateB": { "B1": 0, "...": 0, "B5": 0 },
        "operatorQuestions": { "believeIUnderstand": true, "approachable": true, "explainsToNovice": true,
                               "architectureConfidence": true, "makesMeSmile": true, "zeroKnowledgeReader": true },
        "rationales": { "B1": "what the vision model SAW" },
        "inv18": { "architecturePresent": true, "architectureVisible": true, "architectureReadsClearly": true, "passed": true },
        "meanScore": 0, "headlineScore": 0,            // headline = MIN across the 11 axes, mean = their mean
        "passed": false,                               // SHIP tier on this device (mean>=82, min>=70, five ship operators, INV-18)
        "exemplary": false,                            // EXEMPLARY tier (mean>=90, min>=85, all six operators, INV-18)
        "samples": 1 },                                // 2 when the mean landed within 82+-3 and was graded twice
      { "device": "desktop(1440)", "...": "same shape" }
    ],
    "passed": false,                     // BOTH devices ship-worthy
    "exemplary": false,                  // BOTH devices exemplary
    "iterations": 0,                     // grading passes used; capped at MAX_QUALITY_ITERATIONS (3)
    "capReached": false,                 // set on the capped, no-cost return
    "visionModel": "gpt-5.6-sol", "screenshots": {}, "pageHeights": {}, "refineNotes": [], "gradedAt": "ISO",
    "cost": { "...": "vision spend; an unknown model is recorded UNPRICED, never $0" },
    "gateRefusal": "INV-24 reads above age 15: ...",   // only when a free pre-check refused: then scorecard is [] and no vision call ran
    "inv20": { "passed": true, "violations": [] }, "inv24": { "passed": true },
    "graderUnavailable": true, "graderError": "..."    // only when the grader itself failed: scorecard is [] and the page ships UNGRADED
  },

  "publish": {                           // ← publish-repo + deploy + repo-seo
    "explainerRepoUrl": "https://github.com/<explainer-owner>/<explainer-repo>",   // publish-repo (local door)
    "ownerInvited": true,
    "liveUrl": "https://name-explainer.netlify.app", "http200": true,              // deploy
    "belowBar": false,                   // quality.passed !== true, i.e. below the SHIP tier (82/70) — not the exemplary tier
    "graderUnavailable": false, "gateRefusal": null,
    "weakest": { "axis": "B5", "score": 0, "device": "mobile(390)", "label": "the diagrams and imagery" },
    "shareCardError": "only set when the live share-card check failed",
    "repoTopics": ["..."], "repoDescription": "...",                              // repo-seo (local door)
    "sourceRepoSeoSuggested": { "topics": ["..."], "description": "..." }          // SUGGESTED only, never forced (INV-16)
  },

  "readmePr": { "prUrl": "the issue or PR URL, or \"declined\" | \"skipped\" | \"dry-run\"", "kind": "issue | pr", "reason": "why skipped", "svgsShared": [] },   // ← readme-enhance (ADR-0015)

  "overview": { "path": "assets/overview.mp4", "durationSec": 74.2, "infographic": { "path": "assets/overview-infographic.jpg" }, "injected": true },   // ← make-overview (local, after delivery) — or { "skipped": "why" }

  "notify": { "emailSent": true, "smtp250": true, "inlineReturned": true }
}
```

**Slot ownership table** (who writes what — a tool writes **only** its own slot). Station ids are those of
`src/stations.mjs`.

| Slot | Written by (station id) |
|------|-------------------------|
| `repo` (+ `buildId`) | `clone-repo` |
| `understanding`, `kb` | `build-kb` |
| `concept` | `concept-tournament` seeds it; otherwise the brain's `concept` station (no tool) |
| `content` | the brain's `content` station (no tool) |
| `claims` | `check-claims` (the orchestrator on the local door, the runner on the hosted door; advisory, never blocks) |
| `visuals.hero`, `visuals.sections[]` (brief) | the brain's `visual-brief` |
| `visuals.hero`, `visuals.sections[]` (files) | `generate-image` |
| `visuals.architectureDiagram` / `.flowDiagram` / `.bigIdeaDiagram` / `.insightDiagram` / `.heroAnim` | `make-diagrams` |
| `brand.favicon` | `make-favicon` |
| `brand.socialCard` | `make-social-card` |
| `page` | `assemble-page` |
| `pack` | `make-pack` |
| `ask` | `make-ask` (local door only) |
| `quality` | `quality-grade` |
| `publish.liveUrl` / `.http200` / `.belowBar` / `.graderUnavailable` / `.gateRefusal` / `.weakest` / `.shareCardError` | `deploy` (and `redeploy`) |
| `publish.explainerRepoUrl` / `.ownerInvited` | `publish-repo` (local door; `republish` repeats it) |
| `publish.repoTopics` / `.repoDescription` / `.sourceRepoSeoSuggested` | `repo-seo` (local door) |
| `readmePr` | `readme-enhance` (advisory; ADR-0015: ON by default, issue first, ledger, daily cap; `README_ENHANCE=0` / `--no-readme-pr` turns it off) |
| `notify` | `notify` |
| `overview` | `make-overview` (local door, runs after `notify`; then `redeploy` and `republish` re-ship the page) |

`concept` and `content` are filled by the **brain** (pure judgment) — there is intentionally **no tool**
for them. Every other slot is filled by a pure tool below.

---

## (b) The UNIFORM tool invocation convention

Every tool is one file, invoked the **same way**, with **one** positional argument — the build
directory:

```bash
node tools/<name>.mjs <build-dir>
```

`<build-dir>` is a self-contained directory for **one** build. It holds:

```
<build-dir>/
  build.json        # the BuildContext (the ONLY cross-tool channel)
  repo/             # the cloned working tree (after clone-repo)
  assets/           # generated images, SVGs, favicons, social card
  site/             # the assembled page + the knowledge-pack zip
```

**Every tool, without exception, MUST:**

1. **Read** `<build-dir>/build.json` and take **only the slice it declares** (its inputs below).
   It MUST NOT read slots it does not declare, and MUST NOT read another tool's output files.
2. **Do its one mechanical job** — embed, call an image API, render a diagram, screenshot, zip,
   deploy, email. It never makes a judgment call and never decides "good enough."
3. **Write its outputs into `<build-dir>`** (under `assets/`, `site/`, or the kb store) — never
   outside the build dir, never into another tool's files.
4. **Merge ONLY its own slot** back into `build.json` (read-modify-write the single slot it owns;
   leave every other slot byte-for-byte untouched).
5. **Print a JSON result object to stdout** and nothing else of substance on stdout:

   ```jsonc
   { "ok": true,  "outputs": { "...": "paths + the slot it merged" }, "error": null }
   // or, on any failure:
   { "ok": false, "outputs": {}, "error": "clear, human-readable reason" }
   ```

6. **Exit code is the source of truth.** `process.exit(0)` **iff** `ok: true`. On **any** failure
   it **exits NON-ZERO** with a clear message (also surfaced in `error`). **Never** exit 0 on a
   partial/failed result. **Never** swallow an error. **Never** write a placeholder, a default
   asset, a stub file, or `"TODO"` to limp past a failure — a missing input is a **loud stop**, not
   a silent substitution (INV-04, Never-Fail-Silently). The brain reads the exit code first, then
   the JSON.

**Idempotency.** Re-running a tool on the same `<build-dir>` with the same inputs yields the same
observable result (INV-12). Re-running overwrites that tool's outputs + slot; it never appends.

**Logging.** Diagnostics go to **stderr**. **stdout carries the single JSON result object only**, so
the brain can `JSON.parse` stdout unconditionally.

---

## (c) Tools are PURE and individually testable

- **Pure.** A tool reads **only its declared inputs** (its slice of `build.json` + the named assets
  it owns) and writes **only its declared outputs** (its asset files + its one slot). It **never**
  reaches into another tool's internals, intermediate files, or slots (INV-09). The only channel
  between tools is the typed `build.json` slot — never a shared global, never a file path guessed
  from a sibling tool, never a parsed HTML marker (INV-10).
- **Individually testable.** Because a tool depends only on its declared slice, you can test it in
  isolation: hand-craft a minimal `build.json` containing just that tool's inputs, run
  `node tools/<name>.mjs <fixture-dir>`, and assert on (1) the exit code, (2) the stdout JSON, and
  (3) the files + slot it wrote. No other tool, no network of phases, no ordering needed. A tool
  that can only be tested "as part of the whole pipeline" is a contract violation.
- **No hidden ordering.** Ordering is the **brain's** responsibility (it runs the stations in order
  and checks each cue). A tool must not assume "the previous tool already ran" beyond the inputs it
  explicitly declares as present in `build.json`. If a declared input is absent, the tool **fails
  loud** (per (b)·6) — it does not invent it.

---

## (d) The tool roster — job · inputs · outputs

Every row is a file in `tools/`, invoked as `node tools/<name>.mjs <build-dir>` (exceptions are marked).
The detail for each (flags, env, gotchas) is its own header comment, collected in
`skills/explainmyrepo/TOOLS-CONTRACT.md`. **Door** says where the station runs (`src/stations.mjs`).

| Tool | Door | One-line job | Reads (declared inputs) | Writes (outputs) |
|---|---|---|---|---|
| **clone-repo** | both | Validate the URL is reachable and clone the repo (private/owner repos via token, never written into the clone's config). `EXPLAINER_SUBMITTED_REPO` pins the identity (INV-21). | `repo.url` (+ GitHub token from env) | `repo` slot, `buildId`; the working tree at `<build-dir>/repo/` |
| **build-kb** | both | Build the **real RVF KB** + symbols, dependency graph and entrypoints by running `kb/build-kb.mjs`, `kb/extract-symbols.mjs`, `kb/dep-graph.mjs`, `kb/entrypoints.mjs`. Hard-fails on a failed build (no JSON fallback, INV-06). The primer is authored later and indexed by the separate `index-primer` station (`kb/index-primer.mjs`, a library call, not a tool). | `repo.slug`, `repo.clonePath` | `understanding` + `kb` slots; `kb/stores/<slug>/` |
| **concept-tournament** | both (advisory) | Before any expensive work, models draft a concept as text, a judge ranks them, the winner seeds `concept` (palette and type as knob objects). Fails open with a SKIP when fewer than two models are reachable. | the repo's README + a file-tree digest (+ model keys from env) | `concept` slot (with `tournament`) |
| **check-claims** | both (advisory) | Compare the authored citations and install/step commands with the KB. A signal, never a gate. `node tools/check-claims.mjs <build.json>`. | `content`, `kb.passagesPath`, entrypoints | its result is stored in the `claims` slot by the one shared `recordClaims` (`src/claims-record.mjs`), used by both the orchestrator and the runner |
| **generate-image** | both | Generate the raster rungs (hero + sections) in ONE call with bounded concurrency. `gpt-image-2.5-flare` at `xhigh`, falling back to `gpt-image-2`; then Grok when there is no OpenAI key or the whole OpenAI chain fails. **Skips the hero raster when `visuals.heroAnim` holds a valid scene** (`hero.rasterSkipped: "scene"`). It writes only the PNG rungs; `assemble-page` later makes the responsive AVIF (480/960/1440) + JPEG fallbacks (`src/image-variants.mjs`, lowest quality in 50..80 with luma SSIM >= 0.98). Cost is derived into `visuals.cost` (read by `src/receipt.mjs`); an engine with no known rate (`gpt-image-2.5-flare`) is UNPRICED, never $0. | `visuals.hero` + `visuals.sections[]` briefs, `concept.palette` | the rungs' entries; `.png` files under `<build-dir>/assets/` |
| **make-diagrams** | both | Draw the page's SVGs deterministically (no model): architecture (a radial map from the real dependency graph) and flow (from the real entrypoints), plus the big-idea and insight diagrams from the brain's authored `rows`, verified story diagrams (`systemMap`, `decision`; claims are checked against the clone and unverifiable ones dropped) and the hero scene (`heroAnim.sceneMarkup` or `.sceneSvg`, validated by `tools/diagrams/scene.mjs`: viewBox, real animation, reduced-motion end state, scoped ids, no scripts or external refs, 11 px phone text floor, 25 KB cap). Every slot gets a distinct form, and a mobile label-size check runs. | `kb.depGraphPath` / `entrypointsPath` / `symbolsPath`, `concept.palette`, `repo.clonePath`, `visuals.<slot>.{rows,title,altText}`, `visuals.systemMap` / `.decision` / `.heroAnim` | `visuals.<slot>` entries; `.svg` files under `<build-dir>/assets/` (xmllint-clean, with a text fallback) |
| **make-favicon** | both | Derive the favicon set from the hero (ImageMagick). | `visuals.hero.file`, `concept.palette` | `brand.favicon`; favicon files under `assets/` |
| **make-social-card** | both | Render the 1200x630 share card (wordmark + tagline on solid-ish panels over the hero). A legibility gate measures contrast (4.5:1) and re-renders once; a second failure is fatal. | `visuals.hero.file`, `concept.tagline`, `concept.palette`, `repo.name` | `brand.socialCard`; `social-card.png` |
| **assemble-page** | both | Render the page **once** onto the shared design system from typed slots, wire SEO + social `<head>`, and emit `sitemap.xml` / `robots.txt` / `llms.txt`. No string markers (INV-10). Includes the required ISOvision footer. | `concept`, `content`, `visuals`, `brand`, `kb.primerPath` | `page` slot; `<build-dir>/site/` |
| **make-pack** | both | Build the downloadable **AI knowledge pack** zip. This is a port of the retired `kb/make-dropin` layout (not a wrapper): for-humans primer + for-ai KB and the kb/ engine that queries it. Fails loud on an empty pack, an unregistered store, or a zip that does not open. | `kb` slot, `repo.{slug,url,sha,clonePath}` | `pack` slot (`{ zipPath }`); `<build-dir>/site/<slug>-knowledge-pack.zip` |
| **make-ask** | **local** (advisory) | Add the "Ask this project" box: index the page's sections and the pack's passages into `<page>/ask/index.json`, ship `ask.js` / `ask.css`. The signed credential is added later by `deploy`; answers come from `ask-service/`. A thin KB skips the box. | `repo.owner/name`, `kb.passagesPath`, `page.dir` | `ask` slot; files under `<page>/ask/` |
| **quality-grade** | both | Render the assembled site locally (Playwright, 390 + 1440), run the free INV-20 / INV-24 pre-checks, grade with the vision model, build the two scorecards. A malformed grader reply is a loud failure, never a silent pass. It advises: see the tiers in the bar below. | `page`, `visuals.flowDiagram`, prior `quality` | `quality` slot; screenshots under `assets/` |
| **deploy** | both | Deliver the page to its **own Netlify site** (the only provider). Refuses on integrity only: unassembled page, source-identity mismatch (INV-21), broken site (a linked file it does not ship, a dead Ask box, a share-card failure), or no scorecard with no recorded reason. A low score is disclosed, never a refusal. Verifies 200 unauthenticated, then the live share card. | `page.dir`, `repo.*`, `quality` | `publish.liveUrl` / `.http200` / `.belowBar` / `.graderUnavailable` / `.gateRefusal` / `.weakest` |
| **publish-repo** | **local** | Create the explainer GitHub repo and invite the source owner (best-effort). Names: `{owner}-{name}-explainer` when both parts are plain alphanumerics, otherwise `{owner}--{name}-explainer`. An ownership marker file `.explainmyrepo.json` is pushed with the site, and an existing repo is overwritten only if it names this source. | `repo.*`, `page.dir` (+ GitHub token) | `publish.explainerRepoUrl` / `.ownerInvited` |
| **repo-seo** | **local** | Set topics + a description on the explainer repo; emit **suggested** improvements for the source repo (never set, INV-16). | `publish.explainerRepoUrl`, `concept`, `understanding.summary` | `publish.repoTopics` / `.repoDescription` / `.sourceRepoSeoSuggested` |
| **readme-enhance** | **local** (advisory) | Offer the source repo's maintainer a better README: **issue first** (their README as written + the explainer link + diagrams), a PR only after a yes (`explainmyrepo outreach open-pr`). One contact per repo, daily cap, additions only, every send in the ledger. ON by default. | `repo`, `publish.liveUrl`, `visuals.*Diagram` | `readmePr` slot; the outreach ledger |
| **notify** | both (advisory) | Email the requester the scorecard (or the plain note that it was below the bar or ungraded), both screenshots and the links. | `publish`, `quality`, `pack.zipPath`, `readmePr` (+ SMTP creds) | `notify` slot |
| **make-overview** | **local**, after delivery (advisory) | A short narrated video (hard cap 90 s, `src/overview-cap.mjs`) plus one infographic via NotebookLM, embedded in the page; deletes the notebook it created. An operator-supplied `OVERVIEW_NOTEBOOK` is reused for its sources but never deleted, and the video and infographic are still rendered fresh. `redeploy` and `republish` then re-ship the page. Nothing waits for it. | `repo`, `concept`, `page.dir`, `publish.liveUrl` | `overview` slot; files under `<page>/assets/` |
| *alert-owner*, *notify-failure* | hosted runner | Failure emails (to the owner, to the submitter) when a hosted build did not finish. Not stations; CLI args, not a build dir. | CLI args / env | none |
| *make-trailer*, *make-social-loop* | local, by hand | Alive Kit companions (ADR-0009); never run by the pipeline. | a finished build | files under the build dir |
| *pull-ratings* | local, by hand | Pull reader ratings (`npm run pull-ratings`) into the learning store. | Netlify form | learning store |

`explainmyrepo outreach followup` (not a tool or a station) sends the ONE check-in, `OUTREACH_FOLLOWUP_DAYS`
(default 7) after our last message, only while the issue is open and unanswered; it is recorded as a `followup`
ledger line so it can never post twice. A review copy of the maintainer email goes to `OUTREACH_REVIEW_TO`
(the owner), never to the maintainer.

### Secrets

Tools read credentials (GitHub token, OpenAI key, deploy token, SMTP creds) from the **environment** —
never from `build.json`, never hard-coded, never committed. `build.json` carries build state only.

### The bars

Two tiers, both pure functions in `tools/quality-grade.mjs` and both applied **per device** (a build needs both
devices), with INV-18 (architecture and flow diagrams present and visible) AND-ed in:

| Tier | Function | Rule |
|---|---|---|
| **Exemplary** (`quality.exemplary`) | `evaluatePass` | mean >= 90, min axis >= 85, **all six** operator questions YES |
| **Ships** (`quality.passed`) | `evaluateShipworthy` | mean >= 82, min axis >= 70, the **five** `SHIP_OPERATORS` YES (`architectureConfidence` is informational) |

"Mean" and "min" are over the 11 axes A1-A6 and B1-B5. The refine loop climbs toward exemplary and stops at
`MAX_QUALITY_ITERATIONS` (3) grading passes. **The score never gates delivery** (ADR-0011): `deploy` ships a
below-bar page with its weakest axis disclosed, and an ungraded one (grader down, or a free pre-check refused)
with that stated plainly. `publish.belowBar` means "below the **ships** tier". If a repo genuinely cannot reach
the bar, say so honestly — never present slop as done (INV-05). A literal "95 on every axis" is unreachable by an
honest grader and is not the bar.
