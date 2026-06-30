# `tools/` CONTRACT — the anti-brittleness anchor

**Version:** 0.1.0
**Created:** 2026-06-28
**Paired ADR:** `docs/adr/0005-skill-based-explainer-recipe.md` (D4 — strict brain/tools split + one
`BuildContext`).
**Paired DDD:** `docs/ddd/explainmyrepo-recipe-domain.md` (§4 Brain/Tools/BuildContext triangle,
§8.6 BuildContext, INV-09/INV-10).

This file is **load-bearing**. Generation 2 of this project died because phases were coupled by
string-matched HTML markers — any phase that nudged a marker silently broke a later phase. This
contract is the rule set that makes that failure mode *structurally impossible* again. Every tool
author and the skill ("the brain") MUST obey it.

> **The one-sentence law:** the **brain decides, the tools do.** A tool never thinks, never decides
> "good enough," never reads another tool's files, and never reads the whole `BuildContext`. It
> takes a clear input, produces a clear output, and either succeeds or **fails loud**.

---

## (a) The `BuildContext` — ONE in-memory contract (per ADR-0005 D4 / DDD §8.6)

There is exactly **one** data contract for an entire build: the `BuildContext`, persisted on disk as
**`build.json`** inside the build directory. The brain owns it. Each station fills **its own slot**.
There are **no string-coupled HTML markers** — the page is rendered **once** (INV-10) from typed
slots, never mutated incrementally.

> **One contract, two views.** This is the *same single contract* the ADR (§D4) and the DDD (§8.6)
> model — here the slots are named for the foundation roster below. Neither view adds nor drops data.

```jsonc
{
  "buildId": "uuid-v4",                  // correlation key + idempotency key; set first (clone-repo)

  "repo": {                              // ← clone-repo   (Station 0–1: validate + clone)
    "url":           "https://github.com/owner/name",
    "owner":         "owner",
    "name":          "name",
    "slug":          "name",             // KB slug / repo key used by every kb/ script
    "private":       false,
    "defaultBranch": "main",
    "clonePath":     "<build-dir>/repo", // where the working tree lives
    "reachable":     true
  },

  "understanding": {                     // ← build-kb     (Station 1: the deep read)
    "repoName":      "name",             // named CORRECTLY (a Station-1 cue)
    "summary":       "what this repo is, in one honest paragraph",
    "passageCount":  0                   // > 0 or the build hard-fails (no fake KB — INV-06)
  },

  "kb": {                                // ← build-kb     (Station 1: the real RVF engine)
    "slug":            "name",
    "storeDir":        "kb/stores/name",
    "rvfPath":         "kb/stores/name/name-kb.rvf",          // canonical .rvf (embed block set — NOT .small.rvf)
    "passagesPath":    "kb/stores/name/name-kb.passages.jsonl",// full text — search returns TEXT, not {id,distance}
    "idsPath":         "kb/stores/name/name-kb.ids.json",
    "embedModel":      "Xenova/bge-small-en-v1.5",            // 384-dim; explainer targets MUST set an embed block
    "primerPath":      "kb/stores/name/name-primer.md",       // authored for-humans primer (make-dropin line-79 must())
    "symbolsPath":     "kb/stores/name/name-symbols.json",    // \
    "depGraphPath":    "kb/stores/name/name-dep-graph.json",  //  } pack prerequisites — 3 of 4 MCP tools read these
    "entrypointsPath": "kb/stores/name/name-entrypoints.json" // /
  },

  "concept": {                           // ← THE ART-DIRECTION BRIEF  (Station 2: pure JUDGMENT, brain-authored)
    "metaphor":        "the repo's visual metaphor (prism / dossier / orb …) — specific to THIS repo",
    "palette":         { "...": "colours chosen to fit the metaphor — DesignSystem expression knobs" },
    "typePersonality": "display + body + mono pairing that carries the metaphor's voice",
    "layoutRhythm":    ["heroArchetype", "problemArchetype", "..."],
    "heroConcept":     "the single emotional opening-image idea",
    "copyVoice":       "tone / register for all authored text",
    "tagline":         "the one line baked into the social card + og:description"
  },

  "content": {                           // ← author       (Station 3: pure JUDGMENT, brain-authored)
    "arc": [ { "question": "What world am I in?", "section": "hero", "altitude": "high" } ],
    "sections": {
      "hero": {}, "problem": {}, "whatItIs": {}, "insight": {},
      "howItWorks": {}, "useCases": {}, "getStarted": {}, "pack": {}
    },
    "citations": [ { "claim": "…", "passageId": "…" } ]   // every claim traceable to a KB passage (INV-06)
  },

  "visuals": {                           // ← generate-image (raster) + make-diagrams (SVG)  (Station 4)
    "hero":     { "role": "metaphor", "prompt": "…", "file": "<build-dir>/assets/hero.png",
                  "px": "1536x1024", "engine": "gpt-image-2", "http200": true },
    "sections": [ { "id": "problem",  "role": "problem illustration",
                    "file": "<build-dir>/assets/problem.png", "px": "1024x1024",
                    "engine": "gpt-image-2", "http200": true },
                  { "id": "useCase",  "role": "scenario", "file": "…", "px": "1024x1024",
                    "engine": "gpt-image-2", "http200": true } ],
    "architectureDiagram": { "ascii": "…", "svgPath": "<build-dir>/assets/architecture.svg",
                             "altText": "…", "xmllintOK": true },   // from dep-graph + symbols (REAL structure)
    "flowDiagram":         { "ascii": "…", "svgPath": "<build-dir>/assets/flow.svg",
                             "altText": "…", "xmllintOK": true },   // from entrypoints (REAL runtime flow)
    "bigIdeaDiagram":      { "ascii": "…", "svgPath": "<build-dir>/assets/big-idea.svg",
                             "altText": "…", "xmllintOK": true },
    "insightDiagram":      { "ascii": "…", "svgPath": "<build-dir>/assets/insight.svg",
                             "altText": "…", "xmllintOK": true }
  },

  "brand": {                             // ← make-favicon + make-social-card  (Station 5)
    "favicon":    { "set": ["favicon-16.png","favicon-32.png","favicon.ico"],
                    "appleTouchIcon": "apple-touch-icon.png", "derivedFromHero": true },
    "socialCard": { "px": "1200x630", "file": "<build-dir>/assets/social-card.png",
                    "tagline": "the tagline baked in" }
  },

  "page": {                              // ← assemble-page  (Station 6: rendered ONCE)
    "dir":        "<build-dir>/site",
    "htmlPath":   "<build-dir>/site/index.html",
    "cssPath":    "<build-dir>/site/styles.css",
    "tokensUsed": ["--accent", "--spectrum", "…"],
    "seo":   { "title": "…", "description": "…", "canonical": "https://…",
               "jsonLd": "SoftwareApplication", "sitemap": "sitemap.xml",
               "robots": "robots.txt", "llmsTxt": "llms.txt" },
    "social":{ "og": { "...": "og:title/description/image/url" },
               "twitter": { "card": "summary_large_image" } }
  },

  "pack": {                              // ← make-pack  (Station 6: studio-less make-dropin)
    "zipPath":   "<build-dir>/site/name-knowledge-pack.zip",
    "forAi":     ["name-kb.rvf","name-kb.passages.jsonl","name-symbols.json",
                  "name-dep-graph.json","name-entrypoints.json","ask-kb.mjs","kb-mcp-server.mjs"],
    "forHumans": ["name-primer.md"],
    "opens":     true,                   // zip opens, KB loads, ask-kb returns TEXT (Station-6 cue)
    "kbLoads":   true
  },

  "quality": {                           // ← quality-grade  (Station 7: the completion criterion)
    "scorecard": [
      { "device": "mobile(390)",  "gateA": { "A1":0,"A2":0,"A3":0,"A4":0,"A5":0 },
                                  "gateB": { "B1":0,"B2":0,"B3":0,"B4":0,"B5":0 },
        "rationales": { "B1": "what the vision model SAW" },
        "headlineScore": 0,              // = MIN across all 10 criteria (never the mean)
        "passed": false },               // headlineScore >= 95
      { "device": "desktop(1440)", "gateA": {}, "gateB": {}, "rationales": {},
        "headlineScore": 0, "passed": false }
    ],
    "passed":     false,                 // BOTH devices' headlineScore >= 95
    "iterations": 0                      // refine-loop count
  },

  "publish": {                           // ← publish-repo + deploy + repo-seo  (Station 8)
    "explainerRepoUrl":      "https://github.com/owner/name-explainer",
    "liveUrl":               "https://name-explainer.netlify.app",
    "http200":               true,       // returns 200 UNAUTHENTICATED
    "ownerInvited":          true,       // best-effort collaborator invite
    "repoTopics":            ["…"],      // RepoSEO on the EXPLAINER repo (via GitHub API)
    "repoDescription":       "…",
    "sourceRepoSeoSuggested":{ "topics": ["…"], "description": "…" }  // SUGGESTED only (offered, never forced)
  },

  "readmePr": {                          // ← readme-enhance  (Station 8b: OPTIONAL, off critical path, PR-only)
    "prUrl":      "https://github.com/owner/name/pull/N",  // or the string "declined"
    "svgsShared": ["architecture.svg","flow.svg"]          // the SAME Station-4 SVGs, reused
  },

  "notify": {                            // ← notify  (Station 9)
    "emailSent":      true,
    "smtp250":        true,              // send confirmed
    "inlineReturned": true
  }
}
```

**Slot ownership table** (who writes what — a tool writes **only** its own slot):

| Slot | Owning tool(s) | Station |
|------|----------------|---------|
| `repo` | `clone-repo` | 0–1 |
| `understanding`, `kb` | `build-kb` | 1 |
| `concept` | *(brain — pure judgment, no tool)* | 2 |
| `content` | *(brain — pure judgment, no tool)* | 3 |
| `visuals.hero`, `visuals.sections[]` | `generate-image` | 4 |
| `visuals.architectureDiagram` / `.flowDiagram` / `.bigIdeaDiagram` / `.insightDiagram` | `make-diagrams` | 4 |
| `brand.favicon` | `make-favicon` | 5 |
| `brand.socialCard` | `make-social-card` | 5 |
| `page` | `assemble-page` | 6 |
| `pack` | `make-pack` | 6 |
| `quality` | `quality-grade` | 7 |
| `publish.explainerRepoUrl` / `.ownerInvited` | `publish-repo` | 8 |
| `publish.liveUrl` / `.http200` | `deploy` | 8 |
| `publish.repoTopics` / `.repoDescription` / `.sourceRepoSeoSuggested` | `repo-seo` | 8 |
| `readmePr` (optional) | `readme-enhance` | 8b |
| `notify` | `notify` | 9 |

`concept` and `content` are filled by the **brain directly** (pure judgment, ADR-0005 S2/S3) — there
is intentionally **no tool** for them. Every other slot is filled by a pure tool below.

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

The recipe ships **the foundation roster below**. (The task brief enumerates these by name; note the
brief's count of "13" is a miscount — **14** tools are named, all listed here.) Several wrap the
real, already-working `kb/` engine (ADR-0005 D3) or a verified Claude Code skill — they do **not**
re-implement it. Each row: the tool's **one-line job**, the `build.json` slice + files it **reads**,
and the slot + files it **writes**.

| # | Tool (`node tools/<name>.mjs <build-dir>`) | One-line job | Reads (declared inputs) | Writes (outputs) |
|---|---|---|---|---|
| 1 | **clone-repo** | Validate the URL is reachable + clone the repo (supports private / owner repos via token). | `repo.url` (+ GitHub token from env) | `repo` slot (`owner/name/slug/private/defaultBranch/reachable`); working tree at `<build-dir>/repo/` |
| 2 | **build-kb** | Build the **real RVF KB** + structured indexes for the cloned repo — wraps `kb/build-kb.mjs` **and** `kb/extract-symbols.mjs` / `kb/dep-graph.mjs` / `kb/entrypoints.mjs` / `kb/index-primer.mjs`. Hard-fails on a failed RVF build (no JSON fallback — INV-06). | `repo.slug`, `repo.clonePath` (and the authored `kb/stores/<slug>/<slug>-primer.md` for the index-primer step) | `understanding` + `kb` slots; `kb/stores/<slug>/` (`.rvf`, `.rvf.idmap.json`, `.rvf.embed.json`, `.passages.jsonl`, `.ids.json`, `-symbols.json`, `-dep-graph.json`, `-entrypoints.json`) |
| 3 | **generate-image** | Generate **one** raster rung (hero or a section illustration) — probes + uses `gpt-image-2` (verified primary), falls back loud to `gpt-image-1` only on a build-time probe failure. One pure API call per invocation. | one rung's `{ role, prompt, px }` from `visuals` + `concept` palette (+ OpenAI key from env) | the rung's entry in `visuals.hero` / `visuals.sections[]`; the `.png` under `<build-dir>/assets/` (must be HTTP 200 / valid) |
| 4 | **make-diagrams** | Author the **structural SVG rungs** — big-idea, insight, architecture, flow — ASCII → crisp accessible SVG via the `ascii-to-svg` skill. Architecture/flow grounded in the REAL `kb/dep-graph` + `kb/entrypoints` (never invented). | the four diagrams' ASCII (brain-authored) + `kb.depGraphPath` / `kb.entrypointsPath` / `kb.symbolsPath` | `visuals.architectureDiagram` / `.flowDiagram` / `.bigIdeaDiagram` / `.insightDiagram`; the `.svg` files under `<build-dir>/assets/` (each xmllint-clean, with ASCII fallback) |
| 5 | **assemble-page** | Render the page **ONCE** onto the shared design system (`assets/design-system/`) from typed slots + wire the SEO/social `<head>` (title, meta, canonical, JSON-LD, OG/Twitter, favicon links) + emit `sitemap.xml` / `robots.txt` / `llms.txt`. No string markers (INV-10). Includes the required explainer **footer** (credit + "create one" CTA). | `concept`, `content`, `visuals`, `brand`, `kb.primerPath` | `page` slot (+ `page.seo`, `page.social`); `<build-dir>/site/` (`index.html`, `styles.css`, `sitemap.xml`, `robots.txt`, `llms.txt`) |
| 6 | **make-favicon** | From the hero's visual identity, produce the **full favicon set** (favicon + `apple-touch-icon` + standard sizes). Runs right after the hero. | `visuals.hero.file`, `concept.palette` | `brand.favicon` slot; favicon files under `<build-dir>/assets/` |
| 7 | **make-social-card** | From the hero identity + the authored tagline, render the designed **1200×630** social card (tagline baked in) for OG / Twitter `summary_large_image`. | `visuals.hero.file`, `concept.palette`, `concept.tagline` | `brand.socialCard` slot; `social-card.png` under `<build-dir>/assets/` |
| 8 | **make-pack** | Build the downloadable **AI knowledge pack** — wraps `kb/make-dropin.mjs` via its **`--no-studio`** variant (studio-less first; the one acknowledged engine change, ADR-0005 S6). Ships the for-AI half + the for-humans primer. | `kb` slot (store dir + the three structured JSONs + primer), `repo.slug` | `pack` slot; `<build-dir>/site/<slug>-knowledge-pack.zip` (opens, KB loads, `ask-kb` returns TEXT) |
| 9 | **quality-grade** | Render the **assembled site LOCALLY** in a real browser (Playwright), full-page screenshot at **390px + 1440px**, vision-score against the verbatim **Gate A/B** rubric as a harsh critic, return two scorecards. Malformed/missing per-criterion scores → **loud stop, never a silent pass**. | `page.dir` / `page.htmlPath` | `quality` slot (`scorecard[]` per device, `headlineScore` = MIN, `passed`); both screenshots under `<build-dir>/assets/` |
| 10 | **deploy** | Deploy the **already-passed** page to its **own per-build URL** (default Netlify, provider-agnostic — Vercel is a one-line swap). The FIRST + only deploy (QUALITY precedes PUBLISH). | `page.dir`, `repo.slug` (+ deploy-provider token from env) | `publish.liveUrl` / `publish.http200` (200 unauthenticated) |
| 11 | **publish-repo** | Create the dedicated **explainer GitHub repo** (public) and invite the owner as a collaborator (best-effort). | `repo.owner` / `repo.name` / `repo.slug`, `page.dir` (+ GitHub token from env) | `publish.explainerRepoUrl` / `publish.ownerInvited` |
| 12 | **repo-seo** | Set **GitHub topics + a strong description** on the explainer repo (via API) so it is discoverable; emit **suggested** topic/description improvements for the SOURCE repo (offered, never set directly — INV-16). | `publish.explainerRepoUrl`, `concept`, `understanding.summary` (+ GitHub token) | `publish.repoTopics` / `.repoDescription` / `.sourceRepoSeoSuggested` |
| 13 | **readme-enhance** | **OPTIONAL (Station 8b, off the critical path).** Offer to enhance the SOURCE repo's README via the `readme-enhance` skill — architectural explanation + the **shared Station-4 SVGs** + an explainer badge — delivered **ONLY as a pull request** (never a direct push — INV-16). Failure is a warning, never sinks the build. | `repo` slot, `publish.liveUrl`, `visuals.architectureDiagram` / `.flowDiagram` (the shared SVGs) | `readmePr` slot (a PR URL or `"declined"`) |
| 14 | **notify** | Email the owner the **scorecard + both screenshots + links** (live URL, explainer repo, pack, and any optional README-PR / source-repo SEO suggestions); also return inline. Pure SMTP (absorbs the old `phase9-send-email.mjs`). A notify failure degrades to a warning — it never inverts a live, graded, deployed build. | `publish` slot, `quality.scorecard`, the two screenshot paths, `pack.zipPath`, `readmePr` (+ SMTP creds from env) | `notify` slot (`emailSent` / `smtp250` / `inlineReturned`) |

### Secrets

Tools read credentials (GitHub token, OpenAI key, deploy-provider token, SMTP creds) from the
**environment** — never from `build.json`, never hard-coded, never committed. `build.json` carries
build state only, never secrets.

### The completion bar

A build is **done** only when the dual gate is satisfied: every Gate-A and Gate-B criterion **≥ 95
on BOTH mobile (390) and desktop (1440)**, the two pre-ship eyes (vision model + operator) agree,
the page is deployed (200 unauthenticated), and the AI pack ships. The mission, not a slogan: *a
stranger looks at the result and smiles — "that's really cool."* If a build cannot clear that bar,
**flag it honestly** — never ship slop and call it done (INV-05).
