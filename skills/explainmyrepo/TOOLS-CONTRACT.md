# TOOLS CONTRACT — the pipeline's toolbox, from each tool's own header

Generated 2026-07-13 from the first comment block of every tools/*.mjs (regenerate the same way after tool changes). Read THIS instead of tool source; open source only if this is ambiguous.

## tools/alert-owner.mjs
alert-owner.mjs — the hard failure-escalation valve (Stuart's mandate: "never fail silently").

Distinct from notify.mjs (which emails the SUBMITTER a successful build's scorecard/links).
This tool fires ONLY when a hosted build did not produce a working page — crash, timeout, or the
agent explicitly giving up — and emails the OWNER directly with full particulars so a human can
reach out to the affected person. It has no build.json dependency (a build.json may not even exist
yet, or may be mid-write, at the moment of failure) — every input comes from CLI args / env.

Uniform invocation:  node tools/alert-owner.mjs --repo <owner/name> [--submitter <email>]
                       [--build-id <id>] [--run-url <url>] [--reason <text>] [--elapsed-min <n>]

Env (SMTP creds — never from build.json):
  ALERT_TO (default stuart@isovision.ai) | SMTP_USER|GMAIL_USER | SMTP_PASS|GMAIL_APP_PASSWORD
  SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465)

FAIL-LOUD like every other tool (CONTRACT (b)·6): if creds are missing this exits non-zero with a
clear reason — the workflow treats that as non-blocking (an alert failure must never mask itself
as build success, but it also can't retroactively invert the failure it's reporting).

## tools/assemble-page.mjs
assemble-page.mjs — Station 6 (ADR-0005): THE central render.

Compose BuildContext.content + the per-repo theme (concept "expression knobs") + every asset path
onto the shared assets/design-system/design-system.css + its section archetypes -> ONE
self-contained, accessible site/ (index.html · styles.css · sitemap.xml · robots.txt · llms.txt).
Rendered ONCE from typed slots — no string-coupled HTML markers (INV-10). Pure + fail-loud
(tools/CONTRACT.md (a)/(b)/(c); ADR-0005 D4 / Station 6; DDD §8.6, INV-09/10/13/14/15).

  Usage:  node tools/assemble-page.mjs <build-dir>

  Reads  (declared inputs, read-only):
    <build-dir>/build.json  slices →  repo · concept · content · visuals · brand · kb.primerPath
                                      (+ pack.zipPath if present, for the download link only)
    assets/design-system/design-system.css   (the shared recipe stylesheet — fixed dependency)
    the asset files named in visuals.* / brand.* / kb.primerPath (copied into site/, never mutated)

  Writes (outputs):
    <build-dir>/site/{index.html, styles.css, sitemap.xml, robots.txt, llms.txt}
    <build-dir>/site/assets/*   (copies of the referenced images / SVGs / favicons / social card)
    merges ONLY the `page` slot back into build.json (every other slot byte-for-byte untouched)

  stdout: ONE JSON result object.  stderr: diagnostics.  exit 0 iff ok:true; any failure → exit!=0.

  ── content schema this renderer expects (the brain/render contract; missing essentials fail loud) ──
    concept:  { metaphor, tagline, copyVoice?, heroConcept?,

## tools/build-kb.mjs
build-kb.mjs — Station 1 (UNDERSTAND): build the REAL RVF KB + structured extraction.

Thin wrapper over the existing, already-working kb/ engine (ADR-0005 D3). It runs, in order:
  1. kb/build-kb.mjs       --target <slug>  -> the real RVF store (HNSW, local 384-dim embeds)
  2. kb/extract-symbols.mjs        <slug>   -> <slug>-symbols.json     (public API surface)
  3. kb/dep-graph.mjs              <slug>    -> <slug>-dep-graph.json   (component/dep graph)
  4. kb/entrypoints.mjs           <slug>     -> <slug>-entrypoints.json (build/test/run commands)
(2–4 feed the INV-18 architecture + flow diagrams and the Station-6 pack. The authored primer
and its index-primer step are a later, brain-owned deliverable — NOT this tool's job.)

Uniform tool convention (tools/CONTRACT.md §b): `node tools/build-kb.mjs <build-dir>`.
  reads  : <build-dir>/build.json -> repo.slug, repo.clonePath, repo.name
  writes : the `understanding` + `kb` slots; the real store files under kb/stores/<slug>/
  stdout : exactly ONE JSON result object; child engine output is routed to stderr; exit 0 iff ok.

PURE: reads only its declared build.json slice + its own freshly-produced outputs. FAIL LOUD: a
failed RVF build, a missing/empty store, or a non-canonical .small.rvf (a missing `embed` block)
all stop non-zero with a clear reason — NEVER a JSON-only fallback (INV-06) and never a placeholder.

## tools/clone-repo.mjs
clone-repo.mjs — Station 0–1 (VALIDATE + CLONE).

Validate that the target repo URL is reachable, then clone it into <build-dir>/repo. Supports
PUBLIC repos and PRIVATE / owner repos via a GitHub token supplied with the top-level
`git -c http.extraheader=...` option — which is process-scoped and is NEVER written into the
cloned repo's config (so no credentials are baked into the saved remote).

Uniform tool convention (tools/CONTRACT.md §b): `node tools/clone-repo.mjs <build-dir>`.
  reads  : <build-dir>/build.json -> repo.url   (+ GITHUB_TOKEN / GH_TOKEN from env for private)
  writes : the `repo` slot (owner/name/slug/private/defaultBranch/clonePath/reachable) and the
           top-level buildId (set first, here); the working tree at <build-dir>/repo/
  stdout : exactly ONE JSON result object; all diagnostics go to stderr; exit 0 iff ok:true.

PURE: reads only repo.url (its declared slice) + the env token; writes only the repo slot +
buildId + its own working tree. FAIL LOUD: any failure exits non-zero with a clear reason and
never writes a placeholder / partial clone past an error (tools/CONTRACT.md §b·6, INV-04).

## tools/concept-tournament.mjs
tools/concept-tournament.mjs — Stuart's build-economics directive (2026-07-13, see memory
"build-economics-text-first" + ADR-0008/INV-23 lineage):
  (1) concepts compete in TEXT mode across models — pennies, not builds;
  (2) a cheap judge grades the texts;
  (3) the winner is implemented ONCE by the low-cost executor.
Runs PRE-AGENT (needs only the clone): README + file-tree digest → one candidate concept
spec from each model → judged on a swap-test-first rubric → winner seeded into
build.json.concept with the full tournament record (scores, why, judge) for the registry.
The implementation agent's Station 2 then VALIDATES the winner against the full KB (truth
rails stay with the agent) — it refines with grounded specifics but does not re-invent.

Usage: node tools/concept-tournament.mjs <build-dir>
Env:   ANTHROPIC_API_KEY (or repo-root .env CLAUDE_API_KEY), OPENAI_API_KEY (or OPEN_AI_KEY)
Exit:  0 with concept seeded · 0 with "SKIPPED" if <2 candidates were reachable (the agent
       invents the concept itself, as before — the tournament degrades, never blocks a build)

## tools/deploy.mjs
deploy.mjs — Station 8 tool #10: deploy the already-passed page to its own per-build URL.

CONTRACT (tools/CONTRACT.md): node tools/deploy.mjs <build-dir>
  Reads (declared inputs):  page.dir, repo.slug   (+ deploy-provider token from env)
  Writes (own slot only):   publish.liveUrl, publish.http200
  stdout = ONE JSON result object; diagnostics → stderr; exit 0 iff ok:true, else non-zero.

Provider-agnostic adapter, DEFAULT NETLIFY (clean {slug}-explainer.netlify.app subdomain, zero
DNS work). Vercel is a one-line swap-in via the ADAPTERS map (DEPLOY_PROVIDER=vercel). The deploy
is a direct, atomic, immutable per-build upload — the owner can later git-connect the published
repo for auto-redeploy; that is a post-publish owner action, not this station's job.

FAIL LOUD: a missing token, a failed deploy, or a liveUrl that does not return 200 unauthenticated
is a non-zero exit with a clear message — never a placeholder URL, never a silent green.

## tools/generate-image.mjs
generate-image.mjs — Station 4 (VISUALIZE): generate the EMOTIONAL raster rungs.

One pure tool over a probed image engine. Reads the brain-authored emotional rungs from the
BuildContext (`visuals.hero` + every entry in `visuals.sections[]`), generates each as a real
raster image, and merges ONLY its own two slots back into build.json. The STRUCTURAL rungs
(architecture/flow/big-idea/insight SVGs) are make-diagrams' job, not this one.

Image engine (2026-07-11, real evidence — see the QUALITY comment below for the A/B numbers):
PRIMARY = grok-imagine-image-quality (xAI). Live-measured 5-10s/image vs gpt-image-2's 44-120s
(10-23x faster), same visual quality tier for this flat-illustrative content, verified once the
correct params were found (Grok takes `aspect_ratio`+`resolution`, NOT `size` — that's OpenAI's
shape and Grok hard-rejects it). Native output can exceed our target px by design (we request a
resolution tier >= target so we only ever downscale via sharp, never upscale-blur) — see
GROK_PX_MAP. FALLBACK (if the Grok key/probe is unavailable) = gpt-image-2, quality "medium",
then gpt-image-1 if THAT probe fails too. If everything 404s we STOP LOUD with the failing IDs —
never a silent substitution, never a placeholder.

Sizes: hero = 1536x1024; raster sections = 1024x1024 (valid sizes: 1024x1024, 1024x1536,
1536x1024, auto — the DALL·E-3 1792x1024 is rejected). `auto` has no Grok mapping (falls
through to OpenAI) since no rung in this pipeline actually declares it.

CONTRACT (tools/CONTRACT.md): pure (reads only `visuals` rungs + `concept.palette` + the
Grok/OpenAI keys from env), fail-loud (non-zero exit + clear message, NEVER a placeholder
asset), single JSON result object on stdout, diagnostics on stderr, merges ONLY visuals.hero +
visuals.sections[].

## tools/make-diagrams.mjs
make-diagrams.mjs — Station 4 structural-SVG rung (tools/ CONTRACT.md row 4)

JOB (ADR-0005 Station 4 + INV-18 + DDD §13 INV-15): produce the structural-diagram SVGs as REAL,
BEAUTIFUL vector diagrams — dark, layered/isometric, glassmorphic glowing cards on a dark gradient
canvas — NOT raw ASCII as <text>, and NOT a flat freshman wireframe. The MANDATORY architecture
diagram (grounded in the REAL kb dep-graph + symbols) is drawn as a LAYERED STACK (entry → core →
foundation → external) of glowing glass slabs with glowing connectors; the MANDATORY process/data-
flow diagram (grounded in the REAL kb entrypoints) is drawn as a STEPPED VERTICAL PATH with depth
and glowing arrows. big-idea & aha-insight diagrams are drawn from brain-authored structure.

STYLE (the fix for the owner's "flat boxes on light = garbage" note): dark gradient background
(#0b1018 → #070a10) with a soft top spotlight + faint dot grid; glassmorphic translucent cards
(semi-transparent fills + subtle light strokes + a glass sheen); colored glow via an SVG blur
filter (a blurred accent aura is drawn behind each lit element); vibrant accent colours pulled from
the brain's concept.palette (accent / accent-2 / accent-3) that read well on dark; white/light text;
monospace technical eyebrow + caption. Methodology mirrors the ascii-to-svg skill (parse → elements
→ pixel positions → render shapes then connectors → xmllint validate) with a custom dark/glow style.

ACCESSIBILITY: every SVG keeps an ASCII/textual fallback in <title>/<desc>, and build.json carries
altText + asciiFallback next to each rendered SVG — the ASCII source is a FEATURE (for humans AND AI).

CONTRACT: uniform `node tools/make-diagrams.mjs <build-dir>`; reads ONLY its declared slice
(kb.depGraphPath/.entrypointsPath/.symbolsPath + visuals.<key>.{ascii,altText} + concept.palette);
writes ONLY visuals.architectureDiagram/.flowDiagram/.bigIdeaDiagram/.insightDiagram + the four .svg;
PURE (no network); FAIL LOUD (non-zero + clear reason, never a silent placeholder); idempotent.

## tools/make-favicon.mjs
make-favicon.mjs — Station 5 (BRAND): derive the favicon set from the hero identity.

Conforms to tools/CONTRACT.md (the load-bearing anti-brittleness anchor):
  • Invoked uniformly:  node tools/make-favicon.mjs <build-dir>   (one positional arg).
  • PURE — reads ONLY its declared inputs from <build-dir>/build.json, writes ONLY its outputs.
  • FAIL LOUD — any problem prints { ok:false, … } to stdout AND exits non-zero. Never a silent
    placeholder / default asset (INV-04, Never-Fail-Silently).
  • Merges ONLY its own slot (brand.favicon) back into build.json; every other slot is untouched.
  • stdout carries ONLY the single JSON result object; all diagnostics go to stderr.

Declared inputs (read from build.json):
  visuals.hero.file   REQUIRED — the hero raster (Station 4). Favicons are CROPPED from it so the
                      icon carries the same metaphor/identity as the page ("hero-derived favicon").
  concept.palette     used-if-present — only as the (invisible, opaque-source) flatten backdrop for
                      the apple-touch-icon; no brand colour is invented if it is absent.

Outputs:
  brand.favicon slot  { set:[…png/ico…], appleTouchIcon:"apple-touch-icon.png", derivedFromHero:true }
  <build-dir>/assets/ favicon-16/32/48/192/512.png · apple-touch-icon.png (180) · favicon.ico (16/32/48)

Mechanics: shells out to ImageMagick (`magick`, v7 — `convert` v6 fallback), matching the kb/
engine's system-binary style (kb/make-dropin.mjs → `zip`). ImageMagick is required because it is
the tool that writes multi-resolution .ico natively. No npm install.

Idempotent: re-running overwrites these files + the brand.favicon slot; it never appends.

## tools/make-pack.mjs
make-pack.mjs — Station 6 (ASSEMBLE + PACK): build the downloadable AI knowledge pack.

This is the STUDIO-LESS variant of kb/make-dropin.mjs — the ONE acknowledged change to the
otherwise-reused kb/ engine (ADR-0005 D3 / Station 6 / INV-07). make-dropin.mjs carries a hard
D13/V guard (its lines 78–92) that THROWS "Refusing to build a studio-less drop-in" unless
for-humans/studio/ already holds both an audio overview AND a *report.md. Because the explainer
ships studio-less first (INV-03), this tool ports make-dropin's proven packing layout but RELAXES
that guard to optional: studio media rides in the zip when present, and is simply absent otherwise.

CONTRACT (tools/CONTRACT.md):
  invocation : node tools/make-pack.mjs <build-dir>          (one positional arg — the build dir)
  reads      : <build-dir>/build.json → kb slot + repo.slug  (ONLY its declared slice)
  writes     : <build-dir>/site/<slug>-knowledge-pack.zip    (the zip)
               merges ONLY the `pack` slot back into build.json
  stdout     : EXACTLY one JSON result object — { ok, outputs, error } — nothing else
  stderr     : all diagnostics
  exit code  : 0 iff ok:true; any failure → non-zero + a clear message (never a silent placeholder)

Fail-loud postconditions (INV-04, Never-Fail-Silently):
  - a missing required for-ai/for-humans input is a loud stop (the ported make-dropin must() checks)
  - an EMPTY pack (no passage text, or a zero-byte .rvf) is a loud stop — the pack would be useless
  - a zip that does not open / is missing the KB artifacts is a loud stop (never a silent green)

## tools/make-social-card.mjs
make-social-card.mjs — Station 5 (BRAND): the designed 1200×630 OG / Twitter social card.

Conforms to tools/CONTRACT.md (the load-bearing anti-brittleness anchor):
  • Invoked uniformly:  node tools/make-social-card.mjs <build-dir>   (one positional arg).
  • PURE — reads ONLY its declared inputs from <build-dir>/build.json, writes ONLY its outputs.
  • FAIL LOUD — any problem prints { ok:false, … } to stdout AND exits non-zero. Never a silent
    placeholder / default card (INV-04, Never-Fail-Silently).
  • Merges ONLY its own slot (brand.socialCard) back into build.json; every other slot untouched.
  • stdout carries ONLY the single JSON result object; all diagnostics go to stderr.

Declared inputs (read from build.json):
  visuals.hero.file       REQUIRED — the hero raster; used full-bleed as the card's brand backdrop.
  concept.tagline         REQUIRED — the one line baked into the card (= og:description).
  concept.palette         REQUIRED — needs ≥1 colour-like value; drives the legibility scrim + text.
  understanding.repoName  the display name baked in as the kicker (the JOB's "repo name");
    (or repo.name)        declared here so the card can satisfy "repo name + tagline baked in".
                          Best-effort: if neither is present the card ships with the tagline alone.

Outputs:
  brand.socialCard slot   { px:"1200x630", file:"<…>/assets/social-card.png", tagline:"…" }
  <build-dir>/assets/social-card.png  (exactly 1200×630, OG / Twitter summary_large_image)

Mechanics: shells out to ImageMagick (`magick`, v7 — `convert` v6 fallback), matching the kb/
engine's system-binary style (kb/make-dropin.mjs → `zip`). ImageMagick bakes the wrapped tagline +
kicker straight into the PNG (no browser, no npm install).

## tools/notify-failure.mjs
notify-failure.mjs — tells the SUBMITTER, by email, when their build didn't finish.

Owner mandate (2026-07-10): "if somebody goes to use it and there's no dollars left, don't
just fail silently — let them know [...] and point them at npx." Before this tool existed, a
failed build emailed ONLY the owner (alert-owner.mjs); the submitter's sole channel was their
own status page, which most people stop watching well before a 20-45 minute build finishes.

Distinct from notify.mjs (SUCCESS — full scorecard/links) and alert-owner.mjs (failure, but TO
THE OWNER with technical particulars). This is the honest, short, human failure message for
the person who submitted the repo. Zero-dep raw SMTP, same proven pattern as alert-owner.mjs.

Uniform invocation: node tools/notify-failure.mjs --repo <owner/name> --to <email> --message <text>

## tools/notify.mjs
notify.mjs — Station 9, tool #14 of tools/CONTRACT.md (the terminal step).

JOB (one mechanical thing): email the owner the SCORECARD + BOTH SCREENSHOTS + ALL LINKS (live URL,
explainer repo + collaborator-invite status, knowledge pack, and any optional README PR /
source-repo SEO suggestions); also return the same summary inline. Pure SMTP over implicit TLS,
zero npm dependencies — it absorbs the old `scripts/phase9-send-email.mjs` and adds multipart MIME
so the two screenshots ride along as attachments.

FAIL-LOUD: a genuine failure (no creds, no recipient, nothing meaningful to notify, SMTP refused)
exits NON-ZERO with a clear reason (per CONTRACT (b)·6) — it never writes a placeholder/partial
notify slot. Per ADR-0005 Station 9 / INV-04 the BRAIN treats that non-zero as a NON-BLOCKING
WARNING: "a notify failure degrades to a warning — it never inverts a live, graded, deployed
build." Notify failure never inverts a good build; it only ever fails to announce it.

Uniform invocation:  node tools/notify.mjs <build-dir>

Reads (declared inputs only — CONTRACT roster row 14):
  build.json: publish { liveUrl, http200, explainerRepoUrl, ownerInvited, repoTopics,
                        repoDescription, sourceRepoSeoSuggested },
              quality { scorecard[], passed } (+ the two screenshot paths recorded in that slot),
              pack.zipPath,
              readmePr { prUrl, svgsShared[] }
  env (SMTP creds + recipient — never from build.json):
    EMAIL_TO | NOTIFY_TO | OWNER_EMAIL          recipient (required)
    SMTP_USER | GMAIL_USER                      authenticated sender (required)

## tools/publish-repo.mjs
publish-repo.mjs — Station 8 tool #11: create the dedicated explainer GitHub repo + ship the site.

CONTRACT (tools/CONTRACT.md): node tools/publish-repo.mjs <build-dir>
  Reads (declared inputs):  repo.owner, repo.name, repo.slug, page.dir   (+ GitHub token from env)
  Writes (own slot only):   publish.explainerRepoUrl, publish.ownerInvited
  stdout = ONE JSON result object; diagnostics → stderr; exit 0 iff ok:true, else non-zero.

Creates  stuinfla/{slug}-explainer  (public; org overridable via GITHUB_EXPLAINER_OWNER) via `gh`,
pushes the assembled site to it, then invites the SOURCE repo owner as a collaborator (best-effort
per CONTRACT) and surfaces the invite link in stderr + outputs.

FAIL LOUD: the core job (create repo + push site) fails non-zero with a clear message on any error
— never a placeholder URL. The collaborator invite is best-effort: a failure is a WARNING that sets
ownerInvited:false, it never inverts a successfully-published repo.

## tools/quality-grade.mjs
quality-grade.mjs — STATION 7 tool: the dual-gate completion criterion.

CONTRACT: tools/CONTRACT.md (the one BuildContext, the uniform invocation/return
convention, PURE + FAIL-LOUD). Paired ADR-0005 Station 7 / "The QA System";
paired DDD §8.5 Scorecard + §12 (the QA dual-gate as first-class domain).

JOB (one mechanical job): render the ALREADY-ASSEMBLED site LOCALLY in a real
browser (Playwright) at 390px (mobile) + 1440px (desktop), then grade it on two
independent channels that DON'T fight each other:

  (1) INV-18 PRESENCE — a deterministic DOM check (NOT the vision model). Playwright
      asserts the ARCHITECTURE diagram AND the PROCESS/DATA-FLOW diagram elements
      exist and are actually visible (rendered box > 0, not display:none) inside the
      mandatory #how-it-works block. Present/absent is decided HERE, in the DOM — the
      vision model is never asked "is it there?", only "does it read clearly?".

  (2) CRAFT + SUBSTANCE — the GPT-4o vision grade against the VERBATIM Gate A/B
      rubric (A1..A5 substance + B1..B5 anti-slop, each 0–100), graded from a few
      FULL-RESOLUTION, viewport-height SECTION CROPS (hero · what-it-is · how-it-works
      · get-started · the-pack), NOT one giant full-page screenshot downscaled into
      mush. Each crop is capped at the device viewport so the model judges real,
      sharp pixels (typography, alignment, imagery craft, diagram legibility).

headlineScore = MIN across all 10 criteria. A device passes iff headlineScore >= 95
AND INV-18 is clean (both diagrams DOM-present + DOM-visible + vision says each reads

## tools/readme-enhance.mjs
readme-enhance.mjs — Station 8b, tool #13 of tools/CONTRACT.md (OPTIONAL, off the critical path).

JOB (one mechanical thing): OFFER to enhance the SOURCE repo's README — add an architectural
explanation + the SHARED Station-4 SVG diagrams (architecture + flow, authored once, reused here)
+ an explainer badge linking to the live explainer — and deliver it as a PULL REQUEST ONLY on the
source repo. NEVER a direct push, NEVER a push to the default branch (INV-16). This wraps the
`~/.claude/skills/readme-enhance` conventions (version-headerless, surgical, validate-against-repo)
and the `gh` CLI mechanically; it makes no judgment calls.

OPTIONAL / OFFERED. The offer is controlled by the brain via the environment: this tool only opens
a PR when README_ENHANCE is truthy (1/true/yes/on). Unset/false ⇒ a clean no-op that records
readmePr = { prUrl: "declined", svgsShared: [] } and exits 0. (Station 8b cue: "if declined, the
station is a clean no-op.")

FAIL-LOUD: when ENABLED and a declared input or a git/gh step genuinely fails, this tool exits
NON-ZERO with a clear reason (per CONTRACT (b)·6) — it never writes a placeholder PR. Per ADR-0005
Station 8b / INV-03 / INV-16 the BRAIN treats that non-zero as a NON-BLOCKING WARNING: a
readme-enhance failure is a warning, it never blocks, gates, or sinks the core ship.

Uniform invocation:  node tools/readme-enhance.mjs <build-dir>

Reads (declared inputs only — CONTRACT roster row 13):
  build.json: repo { owner, name, slug, clonePath, defaultBranch, url },
              publish.liveUrl,
              visuals.architectureDiagram { svgPath, altText },

## tools/repo-seo.mjs
repo-seo.mjs — Station 8 tool #12: make the explainer repo discoverable + suggest source-repo SEO.

CONTRACT (tools/CONTRACT.md): node tools/repo-seo.mjs <build-dir>
  Reads (declared inputs):  publish.explainerRepoUrl, concept, understanding.summary (+ GitHub token)
  Writes (own slot only):   publish.repoTopics, publish.repoDescription, publish.sourceRepoSeoSuggested
  stdout = ONE JSON result object; diagnostics → stderr; exit 0 iff ok:true, else non-zero.

Sets GitHub TOPICS + a strong description on the EXPLAINER repo via the GitHub API (GitHub is the
new AI-world social media). Topics/description are derived MECHANICALLY from the brain-authored
concept + understanding.summary — the tool never invents judgement. For the SOURCE repo it only
EMITS suggestions (offered, never set — INV-16).

FAIL LOUD: a missing input, a failed API write, or a write that does not persist (verified by a
read-back) is a non-zero exit with a clear message — never a silent green.
