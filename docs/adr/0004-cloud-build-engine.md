# ADR-0004: Cloud Build Engine — Authoritative Corrected Architecture

**Version:** 1.1.0
**Created:** 2026-06-26
**Updated:** 2026-06-26
**Status:** Accepted
**Supersedes (specific decisions):**
- ADR-0002 D4: self-hosted Mac runner for studio → Cloud Browser Worker (D4 here)
- ADR-0002 D5: gpt-image-1 as sole image engine → gpt-image-2 / imagen-4.0-ultra / gemini-3-pro-image (D3 here)
- ADR-0002 Alt 4: RVF KB deferred → required in Station 1 (D2 here)
- ADR-0003 Decision 2: hybrid GHA + self-hosted Mac studio job → ONE CLOUD ENGINE, no Mac in critical path (D1 here)
- ADR-0003 Decision 3 Gate G: single post-deploy screenshot → dual mobile+desktop screenshots with refine loop (D6 here)

**Depends-on:** ADR-0001 (manual KB/studio pipeline for ruv's own repos), ADR-0002 (code-grounded
reality of current pipeline), ADR-0003 (async+email primary, per-build Vercel isolation, durable
rate limit — those three decisions are confirmed here without change)

---

## Context

ADR-0002 documented the code-grounded reality of the 9-phase GitHub Actions pipeline and made
11 architecture decisions. ADR-0003 added five decisions: async+email primary, GHA+self-hosted
hybrid for studio, real quality gates, Gist-based durable rate limit, and per-build Vercel
isolation.

Three decisions in those two ADRs are now known wrong, and two required capabilities were never
decided:

**Wrong decisions (superseded here):**
1. ADR-0002 D4 / ADR-0003 Decision 2: NotebookLM studio on a self-hosted Mac runner. The Mac
   must not be in the critical path for any build. Any Mac-dependency violates "MUST work every
   time."
2. ADR-0002 D5: `gpt-image-1` as the primary (and only) image engine. `gpt-image-1` is retired.
   `gpt-image-2` (OpenAI), `imagen-4.0-ultra` (Google), and `gemini-3-pro-image` (Google) are
   all verified live on this project's keys.
3. ADR-0002 Alt 4: building a real RuVector/RVF knowledge base was "deferred." It is required.
   `scripts/phase2-build-kb.mjs` (lines 1–5, 84–87) writes plain JSON — this is a defect. The
   project already uses `kb/stores/*.rvf` and `rvf-kb-forge`; the same toolchain must power the
   automated pipeline.

**Missing capabilities (decided here for the first time):**
4. Downloadable AI Knowledge Pack embedded in the explainer page (Station 6 / D5).
5. Mobile AND desktop dual-screenshot vision-graded completion gate with a refine loop — build
   completes only when BOTH viewports pass "looks damn good" (Station 8 / D6).

This ADR is the single authoritative reference for the complete system. Where it conflicts with
ADR-0002 or ADR-0003, this ADR governs.

---

## The Station Pipeline

The build is a JOB flowing through 11 ordered stations. Each station is a cloud call. Each
station records pass/fail + positive evidence to ONE durable job record before the next station
starts. A station that cannot record evidence has not passed.

```
Station 1:  UNDERSTAND      → RuVector/RVF KB of the repo (not JSON)
Station 2:  AUTHOR          → OpenAI authors image-first content grounded in the KB
Station 3:  VISUALS         → hero + section images at MAX quality, widescreen
Station 4:  FAVICON         → icon derived from hero's visual identity
Station 5:  STUDIO          → NotebookLM via cloud browser worker (audio + video + slides) [quarantined]
Station 6:  ASSEMBLE+EMBED  → inline studio assets + downloadable AI knowledge pack
Station 7:  SEO             → page meta/OG/JSON-LD/sitemap/canonical + GitHub repo description/topics/README
Station 8:  DEPLOY          → per-build isolated Vercel project + {repo}.repoexplainer.isovision.ai
Station 9:  QUALITY+REFINE  → screenshot LIVE page at 390px + 1440px, vision-grade, loop until both pass
Station 10: PUBLISH         → dedicated explainer GitHub repo, owner=collaborator
Station 11: NOTIFY          → email: success (links) or failure (honest)
```

**Canonical station order rationale:** DEPLOY (Station 8) MUST precede QUALITY+REFINE (Station 9)
because Station 9 must screenshot the LIVE deployed page — not the local filesystem. Station 9's
refine loop re-deploys the SAME Vercel project after each CSS/content fix. PUBLISH (Station 10)
runs after quality is verified on the live page. NOTIFY (Station 11) always runs last.

**Durable job record schema** (one record per build, persisted in the active-builds Gist
established by ADR-0003 Decision 4):

```json
{
  "buildId": "uuid",
  "repo": "owner/repo",
  "submitterEmail": "user@example.com",
  "totalSteps": 11,
  "stations": {
    "1": { "status": "pass|fail|skip", "evidence": "...", "durationMs": 4200 },
    "2": { "status": "pass", "evidence": "9 sections authored, 11842 chars", "durationMs": 38000 },
    "3": { "status": "pass", "evidence": "hero 1536x1024 gpt-image-2, arch 1024x1024, use-case 1024x1024", "durationMs": 52000 },
    "5": { "status": "pass|skip", "evidence": "audio.mp3 22MB, slides.pdf 14MB, video release-url", "durationMs": 180000 }
  },
  "liveUrl": "https://...",
  "repoUrl": "https://github.com/stuinfla/...",
  "completedAt": "2026-06-26T..."
}
```

NOTE: `submitterEmail` MUST be persisted here at creation time (not only in GHA inputs). The
sweeper (see INV-02 enforcement below) reads this field to send failure emails when runner-death
or cancellation leaves a build in `running` state. A build gist with no `submitterEmail` cannot
be recovered by the sweeper.

The job record is written atomically per station via a PATCH to the per-build Gist (the same
Gist already used for `status.json` polling). The schema is additive: each station appends its
entry; prior entries are never mutated.

---

## Ten Decisions

---

### D1 — ONE CLOUD ENGINE: no local machine in the critical path

**Supersedes:** ADR-0002 D4 Path A (self-hosted Mac runner for studio), ADR-0003 Decision 2
(hybrid GHA ubuntu-latest + `runs-on: [self-hosted, macos]` studio job)

**Decision:** Every station runs in a cloud service. Stuart's Mac is not in the critical path
for any station.

ADR-0003 Decision 2 recommended adding a separate `studio:` GHA job with
`runs-on: [self-hosted, macos]`. That design is superseded. A Mac-dependent studio job
violates "MUST work every time":

- Mac asleep, restarting, or out of disk → every queued studio build fails simultaneously.
- Google Chrome session cookie expiry on the Mac → studio fails silently for all builds.
- Single-threaded: one Mac = one concurrent studio build; dozens of users queue indefinitely.
- The Mac is a single point of failure with no failover path.

The correct architecture: NotebookLM is driven by a **cloud browser worker** — a dedicated
headless-Chrome environment in the cloud with a persisted Google auth session. The worker is
quarantined behind its own retry/queue so studio failure never sinks the core build (see D4).

**Build jobs:**
- `build` job: `runs-on: ubuntu-latest` (current, unchanged). Stations 1–4, 6 (assembly), 7–11.
- `studio` job: `runs-on: ubuntu-latest` (NOT self-hosted). Calls the cloud browser worker
  service API for Station 5. The worker service owns Chrome, auth, and the `nlm` CLI.

**Consequence — what changes in current code:**
- `build-explainer.yml:39` `runs-on: ubuntu-latest` stays (no change).
- The `studio:` job proposed in ADR-0003 Decision 2 with `runs-on: [self-hosted, macos]` is
  NOT implemented. Instead the `studio:` job calls an external cloud worker API endpoint.
- Stuart's Mac is never registered as a GitHub Actions self-hosted runner.

---

### D2 — Station 1 (UNDERSTAND): RuVector/RVF knowledge base, not plain JSON

**Supersedes:** ADR-0002 Alt 4 (deferred), `scripts/phase2-build-kb.mjs:1–5` (comment: "Zero
npm dependencies — Node.js built-ins only"), `scripts/phase2-build-kb.mjs:84–87` (writes
`repo-analysis.json` — a plain JSON file).

**Decision:** Station 1 builds a real RuVector/RVF knowledge base of the cloned repo. The
JSON repo-analysis file is kept as a lightweight index (name, description, language, topics,
file tree) for downstream stations that need fast structured access. The RVF file is the
semantic layer that grounds the authoring step.

**Rationale:** The content authored in Station 2 must be grounded in real semantic retrieval
from the repo, not keyword matching against a flat excerpt list. An RVF KB enables semantic
queries ("explain the core innovation", "what problem does this solve for a developer")
that produce richer, more specific content than `slice(0, 200)` line excerpts. The project
already has working RVF KBs in `kb/stores/*.rvf`; the same toolchain (the `kb/` engine in
this repo) powers the automated pipeline.

**Current defect:** `scripts/phase2-build-kb.mjs:1–5` explicitly states "Zero npm dependencies
— Node.js built-ins only" and writes `kb-output/repo-analysis.json` with no embeddings. The
README claim "searchable vector database" (confirmed false in ADR-0002) remains false until
this station is rebuilt. ADR-0002 OC-C ("never claim vector database for what is a JSON file")
binds until this decision is implemented.

**Real KB toolchain (verified in this repo):** `@rvf/forge` returns HTTP 404 on npm — it does
not exist. `@ruvector/rvf@0.2.2` has no CLI (`bin: null`). The correct, already-working
toolchain is the `kb/` engine in this repo, invoked as `node kb/build-kb.mjs --target <slug>`.
The per-target slug is registered in `kb/kb.config.mjs`. The shipped stores in `kb/stores/`
were built with `Xenova/bge-small-en-v1.5` 384-dim (the per-target model is set in
`kb.config.mjs`). The model cache lives at `kb/models-cache/` and must be committed and
restored in CI so the runner does not cold-download per build.

**Implementation design:**

```yaml
# Station 1 — UNDERSTAND
- name: "Station 1: Build RuVector KB"
  run: |
    # Register the build target in kb/kb.config.mjs (add entry for $BUILD_ID)
    node scripts/register-kb-target.mjs "$BUILD_ID" target-repo/

    # Build RVF KB using this repo's own kb engine (NOT @rvf/forge — that package does not exist)
    cd kb && node build-kb.mjs --target "$BUILD_ID"
    cd ..

    # Outputs written to kb/stores/$BUILD_ID/:
    #   $BUILD_ID.rvf, .rvf.idmap.json, .rvf.embed.json, .passages.jsonl, .ids.json

    # Copy to kb-output/ for downstream stations
    cp -r kb/stores/"$BUILD_ID"/ kb-output/

    # Also write the lightweight JSON index for stations that need fast KV access
    node scripts/phase2-build-kb.mjs target-repo/ kb-output/

    # Record evidence: RVF file size + passage count
    RVF_SIZE=$(du -h "kb-output/${BUILD_ID}.rvf" | cut -f1)
    PASSAGE_COUNT=$(wc -l < "kb-output/${BUILD_ID}.passages.jsonl")
    echo "KB evidence: RVF ${RVF_SIZE}, ${PASSAGE_COUNT} passages" >> station-1.evidence
    echo "CURRENT_STATION=1-UNDERSTAND" >> "$GITHUB_ENV"
```

**KB failure policy:** If the RVF build fails, the station hard-fails with an honest email
("KB build failed — please retry"). There is NO fallback to JSON-only analysis. A JSON KB
violates INV-07 and ADR-0002 OC-C. Remove the "fallback to JSON analysis only" entry from
the failure table — it re-introduces the defect this decision exists to fix.

Station 2 (AUTHOR) queries the RVF semantically for each section:

```javascript
// In phase4-author-content.mjs — after this decision is implemented
import { RvfDatabase } from '@ruvector/rvf';
// Load .rvf and join with .passages.jsonl for text
const rvf = await RvfDatabase.open(`kb-output/${buildId}.rvf`);
const idmap = JSON.parse(fs.readFileSync(`kb-output/${buildId}.rvf.idmap.json`));
const passages = fs.readFileSync(`kb-output/${buildId}.passages.jsonl`, 'utf8')
  .trim().split('\n').map(JSON.parse);
const results = await rvf.query(sectionQuery, 5); // returns [{id, distance}]
const context = results.map(r => passages[idmap[r.id]]); // join ids → passage text
// Pass context to GPT-4o prompt alongside the JSON analysis
```

**Migration note:** `scripts/phase2-build-kb.mjs` is NOT deleted — its JSON output remains
needed by stations 3, 4, 6, 7 (which need fast structured field access: name, topics, language).
The script is kept but its role changes from "the KB" to "the structured index." The RVF is
the KB.

---

### D3 — Station 3 (VISUALS): gpt-image-2 primary; imagen-4.0-ultra and gemini-3-pro-image verified alternates; gpt-image-1 retired

**Supersedes:** ADR-0002 D5 ("keep OpenAI `gpt-image-1` as the primary image engine"),
`scripts/phase5-generate-images.mjs:2` (comment: "Generate explainer images via OpenAI
gpt-image-1"), `scripts/phase5-generate-images.mjs:43–59` (image definitions with
`size: '1536x1024'` at gpt-image-1 limits).

**Decision:** `gpt-image-1` is retired. The image engine is `gpt-image-2` (OpenAI) as
primary. `imagen-4.0-ultra` (Google) and `gemini-3-pro-image` (Google) are verified live
on this project's keys and are available as deterministic fallback in that order.

**Rationale:** ADR-0002 D5 wrote "gpt-image-1 is proven" at the time. It has since been
deprecated by OpenAI. `gpt-image-2` supersedes it with better quality. The Google engines
(`imagen-4.0-ultra`, `gemini-3-pro-image`) are verified working on this project's Google API
key. All three engines have been verified in the ruv-explainer catalog for this project.

**Hero dimension — 1536×1024 (verified):** gpt-image-2's supported landscape sizes are
1024×1024, 1024×1536, 1536×1024, and `auto`. **1792×1024 is a DALL·E-3 size and is rejected
by the Images API for gpt-image-2.** The existing pipeline (`scripts/phase5-generate-images.mjs`)
and every shipped `og:image` are built around 1536×1024. All three image engines support
this dimension. Note: 1536×1024 (1.5:1) is not the ideal 1.91:1 social-card ratio; if OG
preview quality matters, generate a dedicated 1200×630 crop alongside the hero.

**Image spec (widescreen, MAX quality):**

| Image | Dimensions | Engine (primary) | Fallback order |
|-------|-----------|-----------------|----------------|
| hero.png | 1536×1024 | gpt-image-2 | imagen-4.0-ultra → gemini-3-pro-image |
| architecture.png | 1024×1024 | gpt-image-2 | imagen-4.0-ultra → gemini-3-pro-image |
| use-case.png | 1024×1024 | gpt-image-2 | imagen-4.0-ultra → gemini-3-pro-image |
| favicon source | 1024×1024 | gpt-image-2 | imagen-4.0-ultra → gemini-3-pro-image |

**Fallback logic** (in `scripts/phase5-generate-images.mjs`):

```javascript
async function generateImage(def, apiKey, googleApiKey) {
  // Try gpt-image-2 first
  const result = await tryOpenAI(def, apiKey, 'gpt-image-2');
  if (result) return result;

  // Fallback: imagen-4.0-ultra
  const result2 = await tryImagen(def, googleApiKey, 'imagen-4.0-ultra');
  if (result2) return result2;

  // Fallback: gemini-3-pro-image
  const result3 = await tryGemini(def, googleApiKey, 'gemini-3-pro-image');
  if (result3) return result3;

  throw new Error(`All image engines failed for ${def.name}`);
}
```

The fallback is deterministic and ordered — not random. Each failure logs which engine was
tried and why it failed. A build that exhausts all three engines for a given image fails
that station with a specific error (not a silent placeholder).

**Secrets:** `OPENAI_API_KEY` (already in pipeline), `GOOGLE_API_KEY` (new secret required
on `stuinfla/Repo-Explainer`). Both must be present; Station 3 pre-flight checks both before
generating any image.

---

### D4 — Station 5 (STUDIO): cloud browser worker; quarantined; never sinks a build

**Supersedes:** ADR-0002 D4 Path A (self-hosted Mac runner) and Path B (cookie injection),
ADR-0003 Decision 2 (hybrid GHA + `runs-on: [self-hosted, macos]` studio job).

**Decision:** NotebookLM is driven by a cloud browser worker — a dedicated cloud service
running headless Chrome with a persisted Google auth session for `sikerr@gmail.com`. The
`nlm` CLI runs inside the worker service, not on the Mac and not via cookie injection.

**Why neither ADR-0002 path works at scale:**

| Path | Why rejected |
|------|-------------|
| Path A (Mac runner) | Mac in critical path; single failure point; single concurrency slot; violates D1 |
| Path B (cookie injection) | Cookies expire unpredictably; expiry = silent build failure for all users; no refresh mechanism |

**Cloud browser worker design:**

The worker is a separately deployed cloud service (small VM or container, e.g., Fly.io
`machines` or a dedicated GCP Cloud Run instance) with:
- Chrome + `nlm` CLI pre-installed.
- Google auth session persisted in the worker's storage (NOT GitHub Secrets; NOT env vars).
- A simple HTTP API: `POST /studio { notebookTitle, sourceUrl, sourceHtml }` →
  `{ audioUrl, slidesUrl, videoReleaseUrl, studioShareUrl }`.
- Auth session is refreshed proactively on a scheduled job (every 7 days) that logs in
  headlessly and stores the new session. Alert fires when refresh fails.

The GHA `studio:` job is async-after-deploy — it runs after the core build job has already
deployed, quality-graded, published, and emailed a working page. Studio NEVER gates the
first ship. The job MUST be gated on build success so "your explainer is live" is never
sent when no live page exists:

```yaml
studio:
  runs-on: ubuntu-latest        # NOT self-hosted
  needs: build
  if: needs.build.result == 'success'   # NOT if: always() — must have a live page first
  timeout-minutes: 15
  steps:
    - name: "Station 5: NotebookLM via cloud browser worker"
      env:
        STUDIO_WORKER_URL: ${{ secrets.STUDIO_WORKER_URL }}
        STUDIO_WORKER_KEY: ${{ secrets.STUDIO_WORKER_KEY }}
      run: |
        STUDIO_RESP=$(curl -sf -X POST "$STUDIO_WORKER_URL/studio" \
          -H "Authorization: Bearer $STUDIO_WORKER_KEY" \
          -H "Content-Type: application/json" \
          -d "{\"title\": \"${TARGET_REPO} Explainer\",
               \"sourceUrl\": \"https://github.com/${TARGET_OWNER}/${TARGET_REPO}\",
               \"sourceHtmlUrl\": \"${LIVE_URL}\"}" \
          --max-time 600) || true   # || true: worker failure is quarantined
        echo "STUDIO_RESP=$STUDIO_RESP" >> "$GITHUB_ENV"
```

**Quarantine protocol:** if the worker call fails (network error, auth error, timeout, or
NotebookLM API error), the studio job records `"status": "skip"` in the job record and
sends a follow-up email: "Your explainer is live — studio assets could not be generated
this time." The `build` job's Gist status is already `"done"` and the live URL is already
emailed. Studio failure is never surfaced as a build failure.

**Studio completion flow (async re-assemble + re-grade):** When studio artifacts ARE
produced successfully, the studio job MUST NOT silently append them to a live page without
re-verification. The required flow: (i) inject studio embeds into the already-published
ExplainerSite, (ii) re-deploy to the SAME per-build Vercel project, (iii) re-run the
dual-viewport vision grade on the re-deployed URL with `studioIncluded=true` asserted,
and only on pass (iv) update the job record and send a "studio now live" follow-up email.
If the re-grade fails, revert to the last passing (studio-less) deploy and send a honest
follow-up noting studio could not be embedded cleanly. The `studioIncluded` flag in
`Build.studioIncluded` (§5.2 of the DDD) governs whether "studio plays on both" is
asserted — it is NEVER asserted on the initial ship.

**Auth session management — UNPROVEN IN CLOUD (requires prototype):**

The only currently-verified working auth method is Mac-local CDP:
`nlm login --provider openclaw --cdp-url http://localhost:9222` against a running Chrome
on Stuart's Mac. Headless Google SSO in a cloud datacenter environment is NOT proven —
Google is known to block headless/datacenter-IP logins. The "self-refreshing headless
login" described below is aspirational; it MUST be validated in the chosen cloud container
before Phase 3 migration begins.

The proposed daily cron (inside the worker VM):
```bash
# daily session refresh — UNPROVEN; prototype required before committing
nlm login --check || (nlm login && echo "Session refreshed $(date)" >> /var/log/nlm-auth.log)
```

**Fallback (most likely required):** a long-lived authenticated VM with a one-time
interactive login (SSH-forwarded or VNC, `nlm login` builtin), persisted `--user-data-dir`
Chrome profile. Subsequent studio runs are headless non-interactive against the persisted
profile. Re-auth cadence must be measured (probe `nlm login --check` daily for a week).
Until one full studio is produced end-to-end from cloud, studio MUST be treated as
designed-not-built and scoped as best-effort per INV-09.

If `nlm login` refresh fails, an alert fires to Stuart's email. The quarantine wall
(INV-09) ensures the build pipeline is unaffected.

**Phase 5.5 script design** (`scripts/phase5.5-build-studio.mjs`):

This script runs INSIDE the worker service (not on the GHA runner). The GHA `studio:` job
calls the worker API; the worker calls this script:

```javascript
// Called by the worker service, not directly by GHA
const nbId = await nlm.notebookCreate(`${repoName} Explainer`);
await nlm.sourceAdd(nbId, { url: `https://github.com/${owner}/${repo}` });
await nlm.sourceAdd(nbId, { html: explainerHtml });

// These calls are async inside NotebookLM — poll for completion
await nlm.audioCreate(nbId);
await nlm.videoCreate(nbId);
await nlm.slidesCreate(nbId);
await pollUntilReady(nbId, { timeoutMs: 480_000 });

const [audioPath, slidesPath] = await Promise.all([
  nlm.download(nbId, { type: 'audio', output: 'studio/audio.mp3' }),
  nlm.download(nbId, { type: 'slides', output: 'studio/slides.pdf' }),
]);
// Video → GitHub Release (too large for Vercel static)
const videoPath = await nlm.download(nbId, { type: 'video', output: 'studio/video.mp4' });
const releaseUrl = await ghReleaseUpload(owner, repo, 'studio-latest', videoPath);
const shareUrl = await nlm.sharePublic(nbId);

return { audioPath, slidesPath, videoReleaseUrl: releaseUrl, shareUrl };
```

**Studio asset embedding** (Station 6 / D5 below handles the page assembly):

| Asset | Hosting | Embed |
|-------|---------|-------|
| audio.mp3 | Vercel static | `<audio controls src="/studio/audio.mp3">` |
| slides.pdf | Vercel static | PDF.js inline canvas |
| video.mp4 | GitHub Release asset | `<video controls src="{release-url}">` |
| NotebookLM share URL | Google-hosted | External link only (iframes blocked by `X-Frame-Options: DENY`) |

---

### D5 — Station 6 (ASSEMBLE+EMBED): downloadable AI knowledge pack + inline studio

**New decision — not in ADR-0002 or ADR-0003.**

**Decision:** Station 6 does two things:

**A. Inline studio embedding.** After Station 5 (studio), the explainer page embeds all
studio assets without the visitor leaving the page. Phase 3 scaffold includes these slots:

```html
<!-- STUDIO:audio   → <audio controls> if present; removed cleanly if absent -->
<!-- STUDIO:slides  → PDF.js canvas viewer if present; removed cleanly if absent -->
<!-- STUDIO:video   → <video controls src="{release-url}"> if present; removed cleanly if absent -->
```

Station 6 populates or cleanly removes these slots. The page is never shipped with empty
or broken studio slots.

**B. Downloadable AI Knowledge Pack.** The page includes a dedicated "Download" section
above the fold, with a clear download button. The pack is a zip file assembled at build
time and served as a static asset alongside the explainer.

The pack uses a two-half layout (verified in `kb/make-dropin.mjs`):

```
{repo}-knowledge-pack.zip
├── for-ai/
│   ├── {buildId}.rvf             # RuVector KB binary (from Station 1)
│   ├── {buildId}.rvf.idmap.json  # ID→index map (required for passage join)
│   ├── {buildId}.rvf.embed.json  # Query-side model config (must match build-time model)
│   ├── {buildId}.passages.jsonl  # Full passage text (REQUIRED — .rvf alone returns only {id,distance})
│   ├── {buildId}.ids.json        # ID list
│   ├── ask-kb.mjs                # Self-contained search CLI: node ask-kb.mjs <slug> "query" 5
│   ├── kb-mcp-server.mjs         # MCP server (raw JSON-RPC stdio, Node 18+, zero SDK dep)
│   ├── kb.config.mjs             # Per-target config (model, slug, paths)
│   ├── resolve-deps.mjs          # Dep resolver for end-user install
│   └── package.json              # Declares @ruvector/rvf + @ruvector/rvf-node + @xenova/transformers
└── for-humans/
    ├── {buildId}-primer.md       # Natural language primer (produced by kb/index-primer.mjs)
    └── studio/                   # Studio artifacts if present (audio.mp3, slides.pdf)
```

Key constraints (all verified against this repo's actual toolchain):
- `.passages.jsonl` MUST be included. A `.rvf` query returns `{id, distance}` only — text
  lives in the passages sidecar. Without it the pack cannot return text.
- `ask-kb.mjs` and `kb-mcp-server.mjs` are the real search/MCP tools from `kb/`. The
  packages `@ruvector/search-cli` and `@ruvector/mcp-server` do NOT exist on npm (HTTP 404).
  Do NOT reference them.
- The MCP server exposes 4 tools: `search_kb`, `lookup_symbol`, `get_entrypoints`,
  `get_dep_graph`. It returns `content:[{type:'text', text: <full passage>}]`.
- `@ruvector/rvf-node@^0.1.7` is the native binary dep pulled by `@ruvector/rvf` — it must
  be listed in `package.json` so end-users get it on `npm install`.

The zip is built using `kb/make-dropin.mjs` (already in this repo):

```bash
# In the build job, Station 6 (ASSEMBLE+EMBED)
node kb/make-dropin.mjs "$BUILD_ID" "explainer-site/${TARGET_REPO}-knowledge-pack.zip"
echo "CURRENT_STATION=6-ASSEMBLE" >> "$GITHUB_ENV"
```

**For-humans primer on page:** The primer (`for-humans/${buildId}-primer.md` inside the zip)
MUST also be rendered inline in the ExplainerSite's download section, visible to human
visitors without downloading. The `<!-- KPACK:download -->` ContentSlot must include both
the rendered primer text AND the download button:

```html
<section id="knowledge-pack" class="download-section">
  <div class="primer-text"><!-- primer rendered as HTML here --></div>
  <h2>AI Knowledge Pack</h2>
  <p>Drop this into Claude Code or any MCP client to ask questions about {repoName}.</p>
  <a href="/{TARGET_REPO}-knowledge-pack.zip" download class="btn-download">
    Download Knowledge Pack
  </a>
</section>
```

Gate F (deploy readiness) checks that `{TARGET_REPO}-knowledge-pack.zip` exists and is
> 10KB before deploy. Gate G (live-page screenshot) must see the download section in
the rendered page.

---

### D6 — Station 8 (QUALITY+REFINE): mobile + desktop dual screenshots, vision-graded, loop until both pass

**Supersedes:** ADR-0003 Decision 3 Gate G (single post-deploy screenshot at unspecified
viewport, no refine loop, score ≥ 75 = warn user, no CSS/content fix before ship).

**Decision:** The build completion criterion is: the LIVE deployed page must render "looks
damn good" at BOTH mobile (~390px viewport) AND desktop (~1440px viewport) as graded by
GPT-4o Vision. If either fails, REFINE (CSS/content/layout fixes) and re-check. LOOP until
BOTH pass. A build that ships a broken or ugly page is not done.

**Why ADR-0003 Gate G is insufficient:**

ADR-0003 Gate G ran a single screenshot at an unspecified viewport, required score ≥ 75
(starting estimate — not calibrated), and on failure set status `deployed_with_warnings`
and emailed the user a caveat. This design ships a known-bad page to the user. The six-
quality bar the spec requires cannot tolerate "here are warnings, please judge for yourself."

The correct model: refine the output until it passes, then ship. The user receives a URL
only when the page is great on both phone and laptop.

**Station 9 implementation (QUALITY+REFINE follows DEPLOY):**

The canonical execution order is: Station 8 (DEPLOY) → Station 9 (QUALITY+REFINE, grades
the LIVE page, re-deploys same project in loop) → Station 10 (PUBLISH) → Station 11 (NOTIFY).
Quality grading cannot precede deployment — it MUST screenshot the live URL. Re-deploys
within the loop target the SAME Vercel project (persistent via `vercel link` in Station 8).

Script: `scripts/phase8-quality-refine.mjs` (renamed from phase8.5 to match canonical numbering):

```javascript
const MOBILE_VIEWPORT  = { width: 390,  height: 844 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MIN_SCORE = 80;          // calibrate against 5 hand-curated examples before enforcing
const MAX_REFINE_ITERATIONS = 3;

// Two-tier gate:
// HARD gate (deterministic, non-LLM) — must pass before aesthetic loop even runs:
//   no horizontal overflow, hero image loaded (HTTP 200 + naturalWidth > 0),
//   all on-page links return 200, tap-target minimum 44px, download section present.
// A page failing the hard gate is genuinely broken and hard-fails with an honest email
// naming the specific failing check — this is the real "never ship broken" guarantee.
//
// SOFT gate (GPT-4o aesthetic score, advisory) — drives the refine loop.
// If not converged after MAX_REFINE_ITERATIONS, ship the highest-scoring iteration
// as Succeeded-with-caveat, not as Failed.
await runHardGate(LIVE_URL); // throws HardGateFailed if deterministic checks fail

let bestIteration = null;
for (let iteration = 0; iteration <= MAX_REFINE_ITERATIONS; iteration++) {
  // Take both screenshots
  const [mobileScreenshot, desktopScreenshot] = await Promise.all([
    screenshotPage(LIVE_URL, MOBILE_VIEWPORT),
    screenshotPage(LIVE_URL, DESKTOP_VIEWPORT),
  ]);

  // Vision-grade both (studioIncluded flag: assert studio only when studioIncluded=true)
  const [mobileGrade, desktopGrade] = await Promise.all([
    visionGrade(mobileScreenshot, repoName, 'mobile', { studioIncluded }),
    visionGrade(desktopScreenshot, repoName, 'desktop', { studioIncluded }),
  ]);

  recordEvidence(iteration, mobileGrade, desktopGrade);
  if (!bestIteration || avgScore(mobileGrade, desktopGrade) > avgScore(...bestIteration)) {
    bestIteration = [mobileGrade, desktopGrade];
  }

  if (mobileGrade.score >= MIN_SCORE && desktopGrade.score >= MIN_SCORE) {
    console.log(`Quality gate PASS — mobile ${mobileGrade.score}, desktop ${desktopGrade.score}`);
    break;
  }

  if (iteration === MAX_REFINE_ITERATIONS) {
    // Ship the best-scoring iteration as Succeeded-with-caveat (never hard-Fail on aesthetics).
    // A deployed, smoke-tested, hard-gate-passing page is a deliverable.
    // The notification email reports the actual scores honestly.
    console.log(`::warning::Aesthetic gate did not reach ${MIN_SCORE} after ${MAX_REFINE_ITERATIONS} refinements. Shipping best-of-3.`);
    break;
  }

  // Refine: call GPT-4o with the failing screenshot + specific failure reasons
  await refinePage(mobileGrade, desktopGrade, 'explainer-site/');
  await redeploy('explainer-site/', TARGET_REPO);  // re-deploy same project
}
```

Vision grading prompt for each viewport:

```
Grade this screenshot of a live explainer website at {viewport} viewport on 0–100.
Repo: {repoName}. Technologies: {topTechnologies}.
Score on:
  (a) correct render — no broken layout, no horizontal scroll, no error page, readable text (35pts)
  (b) images — hero visible, sections illustrated, no broken-icon placeholders (25pts)
  (c) mobile/desktop fit — text legible, tap targets ≥ 44px (mobile) / no cramped whitespace (desktop) (20pts)
  (d) professional appearance — matches quality bar of a polished developer explainer (20pts)
Return JSON: {"score": N, "failures": ["specific issue", ...], "fixes": ["suggested CSS/content fix", ...]}
```

Refinement call: the `fixes` array from the grading response is fed to a targeted GPT-4o
prompt that patches `styles.css` and `index.html`. Only the specific failing elements are
touched. After patching, the site is redeployed (same Vercel project, new production
deployment) and re-graded.

**Responsive integrity checks — the HARD gate** (run before the aesthetic grade loop):

```javascript
// Hard gate: deterministic, non-LLM. Failure here = hard fail, not aesthetic retry.
const hardChecks = [
  { name: 'no-horizontal-overflow', test: () => document.documentElement.scrollWidth <= document.documentElement.clientWidth },
  { name: 'hero-image-visible', test: () => heroImg.complete && heroImg.naturalWidth > 0 },
  { name: 'download-button-present', test: () => document.querySelector('.btn-download') !== null },
  { name: 'all-links-200', test: async () => { /* curl each href/src in the page, assert 200 */ } },
  // tap-target check (mobile-only viewport pass)
  { name: 'tap-targets-min-44px', test: () => /* evaluate all <a><button> clientHeight >= 44 */ },
];
// studio-audio-present is NOT in the hard gate — it is conditional on studioIncluded.
// It IS in the aesthetic rubric when studioIncluded=true (and asserted in the post-studio re-grade).

// Soft gate: vision-grade rubric. "studio plays on both" asserted ONLY when studioIncluded=true.
```

These run as Playwright `page.evaluate` calls before the vision-grade loop. Any hard-gate
failure emits a `HardGateFailed` error that bypasses the refine loop and goes directly to
the failure handler (honest email, no false "deployed with warnings").

**Playwright on ubuntu-latest:**

```yaml
- name: "Phase 0: Install Playwright Chromium"
  run: npx playwright install --with-deps chromium
```

Adds ~50s to the build at Phase 0. The station runs post-deploy in Phase 8.5 and uses the
same `OPENAI_API_KEY` already in the pipeline. Vision cost: ~$0.004 per screenshot pair,
~$0.012 per refinement iteration (3 pairs max). Total Station 8 vision cost: ≤$0.05 per
build.

**Completion definition (two-tier, reconciled with DDD §4.2):**

- **Hard gate (non-LLM, deterministic):** no horizontal overflow, hero loaded, all links
  200, tap-targets ≥ 44px, download section present. A build failing ANY of these hard-fails
  with a specific honest email naming the check. This is the real "never ship broken" guarantee.
- **Aesthetic gate (advisory, LLM):** both mobile and desktop vision-grade ≥ 80 (calibrate
  against 5 hand-curated examples before enforcing). If convergence is not reached after 3
  iterations, ship the highest-scoring iteration as `Succeeded`. The notification email
  reports actual scores: "Verified deployable and overflow-free on phone and PC; aesthetic
  score: {mobile}/100 mobile, {desktop}/100 desktop."
- **One terminal behavior:** hard-gate failure → Failed. Aesthetic loop non-convergence →
  Succeeded-with-caveat. No RefinementLimitExceeded → Failed for aesthetics (that path in
  DDD §4.2 applies to hard gate failures only).

---

### D7 — Durable job record + concurrency model (confirms ADR-0003 Decision 4; adds station-level evidence)

**Confirms:** ADR-0003 Decision 4 (Gist-based active-build registry as durable rate limit,
GHA `concurrency:` stanza). No change to that mechanism.

**Adds:** each station appends its evidence to the per-build Gist file (see station schema
in the Station Pipeline section above). The `update-gist-status.sh` script is extended to
accept an optional evidence argument:

```bash
# Current signature (scripts/update-gist-status.sh):
# update-gist-status.sh <gist_id> <step> <total> <stepName> <status> [error]

# Extended signature:
# update-gist-status.sh <gist_id> <step> <total> <stepName> <status> [error] [evidence]
```

**Concurrency model for dozens of users:**

| Layer | Mechanism | Notes |
|-------|-----------|-------|
| Per-repo deduplication | GHA `concurrency: group: build-{owner}-{repo}`, `cancel-in-progress: false` | 1 concurrent build per unique repo; prevents race on same ExplainerRepo/project |
| Global spend ceiling | Dispatch gate in `www/api/build.js`: count non-terminal active builds before dispatching | Cap enforced at submission, not via the hacky slot-mod (`slot-${{ github.run_number % 5 }}` is removed — it was only needed to avoid the shared-project overwrite, which per-build isolation eliminates) |
| Submission rate limit | Gist-based active-build registry (durable across cold starts); active-builds state moved OUT of in-memory `rateMap` | `rateMap` in `www/api/build.js:9` is in-memory and lost on serverless cold-start; move to the active-builds Gist |
| Studio concurrency | Cloud browser worker API queue | Best-effort; 2–3 concurrent `nlm` sessions; users under load get studio via the async deferred follow-up flow |

NOTE on rate limit durability: the active-builds Gist is also read by the StatusChannel Sweeper
(see Never-Fail-Silently spine below) which cleans up leaked entries from cancelled builds.
Without sweeper cleanup, a cancelled build could leave its active-builds entry and lock the
RateKey for 2h.

**Studio under load:** at dozens of concurrent builds, most will receive the studio-less page
first and a "studio now live" follow-up when the worker queue clears. This is by design
(INV-09 Studio Non-Blocking). The SLA is: core explainer page always; studio best-effort.
Do not promise simultaneous studio delivery to all users.

**Vercel project housekeeping:** per-build projects accumulate toward the Vercel team project
cap. Add a daily cron (not monthly) that deletes projects whose build reached a terminal state
more than N days ago. The sweeper (below) and the housekeeping cron together keep project
count bounded.

At 10 concurrent builds (upper practical bound on GHA without queue): Station 3 (images) =
~10 concurrent image gen calls = ~$1.50 peak burst cost. Station 9 vision grading = ~10 ×
$0.05 = $0.50. Total peak burst ≤ $2.00. Acceptable without a cost gate up to ~100 builds/day.

---

### D8 — Async + email primary + Never-Fail-Silently spine (confirms ADR-0003 Decision 1; adds sweeper)

**Confirms ADR-0003 Decision 1.** Updates and extends it with the Never-Fail-Silently spine
that was missing from both ADR-0003 and ADR-0004 v1.0.0.

**Email requirements:**
- Email is required at submission. `www/api/build.js:185` must return HTTP 400 if email
  is missing or invalid.
- `submitterEmail` MUST be written into the per-build status Gist payload at creation time
  (add to `statusPayload` in `www/api/build.js`). This is the only durable record of the
  address that survives runner death or cancellation — the sweeper reads it here.
- The UI shows a confirmation panel after submission; polling is optional ("Track progress").
- Remove `&& env.HAS_GMAIL == 'true'` condition from `build-explainer.yml:259`. Replace with
  a Phase 0 pre-flight that hard-fails if `GMAIL_APP_PASSWORD` is unset while an email was
  promised (no phase0 script exists yet — must be created at `scripts/phase0-preflight.mjs`).
- The failure email handler (`build-explainer.yml:277–283`) MUST call `phase9-send-email.mjs`
  (current code does not). Wire it in with a failure template that uses `$CURRENT_STATION`.
  Each station writes its name to `$GITHUB_ENV` before its work: `echo "CURRENT_STATION=N-NAME" >> "$GITHUB_ENV"`.
  The failure handler reads `CURRENT_STATION` for an honest "failed at {station}" message
  (not `${{ github.action }}` which resolves to `__run`).

**Cancellation / timeout coverage:**
- Change `build-explainer.yml:278` from `if: failure()` to `if: (failure() || cancelled()) && env.REACHED_TERMINAL != 'true'`.
  This covers user-initiated cancels and GHA's 6h job timeout cancellation signal.
- Set `REACHED_TERMINAL=true` in `$GITHUB_ENV` immediately after a successful deploy + smoke test
  (Station 8 success) — before Station 9 quality grading begins. This gates the failure handler
  so a NOTIFY SMTP hiccup (Station 11 failure) never flips a live-and-deployed build to Failed.
- Add `continue-on-error: true` to the Gist `done` PATCH step and the success email step
  (Station 11 terminal steps). Failure of either degrades to a warning, never to a failed build.

**StatusChannel Sweeper (new — the outermost INV-02 enforcement layer):**

The sweeper catches the one case GHA cannot self-report: a build that was dispatched but
whose runner never picked up (zero workflow steps — GHA cannot fire `failure()` or `cancelled()`
because no steps ever ran).

Concrete runtime: a Vercel Cron on the landing project (`www/`, already deployed as
`prj_KbSbSjdTfeGzW6x4O2TftTU8jXi1`). This is independent infrastructure — it runs even
when GHA is the thing that died.

Files required:
- `www/api/sweep.js` — a Vercel Node serverless function.
- `www/vercel.json` — add `"crons": [{ "path": "/api/sweep", "schedule": "*/5 * * * *" }]`.
- `www/lib/send-email.mjs` — extract SMTP logic from `scripts/phase9-send-email.mjs` into
  a shared module used by BOTH the sweeper (Vercel cron) AND the GHA failure handler.
  Zero npm deps (Node net/tls builtins). `GMAIL_APP_PASSWORD` stored as a Vercel env var
  on the landing project.

Sweeper logic:
1. Read the active-builds index Gist (or scan recent Gists with description prefix
   "Repo Explainer build status:").
2. For any Gist whose `status` is `queued` or `running` and whose `startedAt` is older
   than 20 minutes with no station progress: PATCH to `status=failed`, `error="Build did
   not complete within the time budget (worker never picked up, was cancelled, or timed out)."`,
   last-known `step` ordinal (never 0).
3. Send the failure email from the stored `submitterEmail`. If `submitterEmail` is absent,
   skip email (log as unrecoverable).
4. Guard idempotency: skip if Gist is already terminal (`done`/`failed`). Also clean up
   the active-builds entry so the RateKey is released.

The sweeper also cleans up leaked active-builds entries (builds that were cancelled and
never removed their entry) to prevent users from being rate-locked.

---

### D9 — Per-build Vercel isolation (confirms ADR-0003 Decision 5)

**Confirms ADR-0003 Decision 5. Updates the deploy command to verified Vercel CLI 54.17.2 syntax.**

- Each build deploys to a Vercel project named `re-{repo}-explainer` (prefix avoids team
  namespace collisions) under scope `sikerr-6092`.
- `build-explainer.yml:170–171` (`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) are removed.
- `build-explainer.yml:176` (`vercel pull`) is removed.
- `--name` flag does NOT exist in Vercel CLI 54.17.2 — it was removed. The verified deploy
  sequence is:

```bash
# Station 8: per-build Vercel project creation + deploy
# (runs inside the explainer-site/ directory)

# 1. Create the project (verified: "Add a new project")
vercel project add "re-${TARGET_REPO}-explainer" --scope sikerr-6092

# 2. Link the site dir to that project
vercel link --yes --project "re-${TARGET_REPO}-explainer" --scope sikerr-6092

# 3. Deploy
DEPLOY_URL=$(vercel deploy --prod --yes --scope sikerr-6092 --token "$VERCEL_TOKEN")

# 4. Assert isolation (CI lint: VERCEL_PROJECT_ID must be absent; post-deploy: projectId != landing)
DEPLOYED_PROJECT=$(vercel inspect "$DEPLOY_URL" --token "$VERCEL_TOKEN" | grep 'Project ID' | awk '{print $NF}')
if [ "$DEPLOYED_PROJECT" = "prj_KbSbSjdTfeGzW6x4O2TftTU8jXi1" ]; then
  echo "::error::OverwriteTrap: deployed to landing project!" && exit 1
fi

# 5. Assign custom domain (per-project attachment — NOT a single shared wildcard)
vercel domains add "${TARGET_REPO}.repoexplainer.isovision.ai" "re-${TARGET_REPO}-explainer" --scope sikerr-6092

echo "REACHED_TERMINAL=true" >> "$GITHUB_ENV"
echo "LIVE_URL=$DEPLOY_URL" >> "$GITHUB_ENV"
echo "CURRENT_STATION=8-DEPLOY" >> "$GITHUB_ENV"
```

**Custom domain architecture (resolved):** a Cloudflare wildcard CNAME `*.repoexplainer →
cname.vercel-dns.com` alone cannot route dozens of isolated Vercel projects — a wildcard
attaches to ONE project. The correct model: `vercel domains add <subdomain> <project>` attaches
THAT build's specific subdomain to THAT build's project. Requires the apex
`repoexplainer.isovision.ai` verified on team `sikerr-6092` first, with `*.repoexplainer →
cname.vercel-dns.com` in Cloudflare as the DNS record (so each attached subdomain resolves).
This needs one live two-build proof (two distinct projects, two `curl -I` → 200) before rollout.
Until proven, `*.vercel.app` is the real deliverable; `ShowcaseURL` is best-effort.

- Landing page (`www/`) is linked to a separate Vercel project (`repo-explainer-landing`).
  This must be done before any public rollout (ADR-0002 OC-A).

---

### D10 — Two distinct repos; SEO; DNS; secrets (confirms ADR-0002 D7, D8, D10, D11)

**Confirms ADR-0002 decisions without change:**

- **Two repos:** CORE repo (submitted, upstream — never touched by this pipeline) vs EXPLAINER
  repo (`stuinfla/{repo}-explainer` — created by Phase 9 / Station 9). Never conflate.
- **SEO (Station 7):** `scripts/phase7-seo.mjs` writes to the ExplainerSite:
  OG tags, Twitter card, JSON-LD (SoftwareSourceCode schema), `<link rel="canonical">`,
  `sitemap.xml`, `robots.txt`. Gate F asserts all six are present before deploy. Social
  preview image (GitHub social preview) is NOT settable via API — skip undocumented endpoints.
  The hero `og:image` at 1536×1024 (D3) is the primary social surface.
  - Verified gap in current `scripts/phase3-scaffold.mjs`: it emits `og:` tags and `robots.txt`
    but NOT `sitemap.xml`, NOT `<script type="application/ld+json">`, NOT `<link rel="canonical">`.
    These must be added in Station 7.
  - **Explainer repo README:** the PUBLISH station (Station 10) must author a keyword-rich
    `README.md` for the ExplainerRepo (distinct from `index.html`), using `name/description/topics`
    from the KB analysis. The current workflow pushes the ExplainerSite verbatim with no README.
- **DNS:** Cloudflare wildcard CNAME `*.repoexplainer` → `cname.vercel-dns.com` (DNS-only,
  no proxy). Each subdomain is attached per-project via `vercel domains add` (D9 above).
  `*.vercel.app` URL is always the real deliverable; `ShowcaseURL` is best-effort until proven.
- **Secrets split:**

| Secret | Landing (`www/`) | Pipeline (`stuinfla/Repo-Explainer`) | Worker service |
|--------|-----------------|--------------------------------------|----------------|
| `GITHUB_TOKEN` | Yes | — | — |
| `GH_PAT` | — | Yes | — |
| `OPENAI_API_KEY` | — | Yes | — |
| `GOOGLE_API_KEY` | — | Yes (new — D3) | — |
| `VERCEL_TOKEN` | Yes | Yes | — |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | — | Yes | — |
| `STUDIO_WORKER_URL` / `STUDIO_WORKER_KEY` | — | Yes (new — D4) | Stored in worker env |
| `ACTIVE_BUILDS_GIST_ID` | Yes (ADR-0003 D4) | Yes | — |
| `VERCEL_PROJECT_ID` / `VERCEL_ORG_ID` | — | REMOVED (D9) | — |

---

## Failure Handling

Each failure mode maps to a specific outcome visible to the user. "Never fail silently"
means the user always receives an email with an honest description of what happened.

| Station | Failure | Build result | User notification |
|---------|---------|-------------|-------------------|
| 0 (Preflight) | GMAIL_APP_PASSWORD unset | Build fails before any API spend | Email: "Misconfiguration: email not set up" (if email provided) |
| 1 (UNDERSTAND) | RVF build fails | Build fails — NO JSON fallback (would violate INV-07) | Email: "KB build failed at {step}; please retry" |
| 2 (AUTHOR) | OpenAI API error | Build fails | Email: "Content authoring failed; try again" |
| 3 (VISUALS) | All 3 engines fail for 1 image | Build fails (image is required) | Email: "Image generation failed; try again" |
| 4 (FAVICON) | Generation fails | Favicon skipped (warn-only) | No email; build continues |
| 5 (STUDIO) | Worker API error / timeout / auth failure | Studio deferred; core build unaffected (INV-09) | Follow-up email: "Your explainer is live — studio unavailable this time" (sent ONLY if build succeeded) |
| 6 (ASSEMBLE) | Zip assembly fails | Build fails (pack is required) | Email: "Knowledge pack assembly failed; try again" |
| 7 (SEO) | GitHub API error on repo topics | Warning-only; build continues | No email; noted in job record |
| 7 (SEO) | Page SEO hard failure (no canonical/sitemap/JSON-LD written) | Build fails | Email: "SEO generation failed; try again" |
| 8 (DEPLOY) | Vercel deploy fails | Build fails | Email: "Deploy failed at station 8; try again" |
| 9 (QUALITY) | Hard gate fails (overflow, hero broken, links 404) | Build fails with specific check named | Email: "Page failed quality gate: {specific failing check}" |
| 9 (QUALITY) | Aesthetic score < 80 after 3 iterations | Ships best-of-3 as Succeeded | Email notes actual scores; no false failure |
| 10 (PUBLISH) | Repo create/push fails | Build fails | Email: "GitHub repo creation failed at station 10; try again" |
| 11 (NOTIFY) | Gmail SMTP error | Succeeded (continue-on-error; email loss is not a Build failure) | User must poll status URL |
| (any) | Cancellation / runner timeout | Sweeper patches Gist to failed within 20 min | Sweeper sends failure email from stored submitterEmail |

**Gist failure handling:** `update-gist-status.sh` uses `|| true` — a Gist API blip does
not abort the build. Email is independent of Gist reachability (SMTP speaks directly to
`smtp.gmail.com:465`). If Gist fails but email succeeds: user gets the result. If Gist
succeeds but email fails: user can poll the status URL. Both channels failing simultaneously
is treated as an infrastructure incident (PagerDuty / Uptime alert on the Gist endpoint).

---

## Migration Order

Each step has a specific verification command. Do not proceed to the next step without
running the verification.

### Phase 0 — Immediate (blocking OC-A and OC-B)

These fix active false claims and the overwrite trap before any code changes:

**0a. Fix README misrepresentations** (doc-only, no code change):
- [ ] Correct Phase 2 description: "JSON analysis" not "searchable vector database."
- [ ] Rename Gate D to "Security," Gate E to "Deploy readiness" (current code names).
- [ ] Remove "Studio media — Google NotebookLM" from Built With table until Station 5 is live.
- [ ] Remove "PR on your original repo's README" claim (not implemented).
- [ ] Change "Resend" to "Gmail SMTP" in Built With table.
- **Verify:** `grep -n "vector database\|Studio media\|Resend\|PR on" README.md` → no matches.

**0b. Separate landing into its own Vercel project** (confirms ADR-0002 D1, ADR-0003 D5):
- [ ] `cd /Users/stuartkerr/Code/Ruv-Explainer/www && vercel link` → new project `repo-explainer-landing`.
- [ ] Set `GITHUB_TOKEN` env var on the landing project.
- [ ] Remove `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` from `build-explainer.yml:170–171`.
- [ ] Remove `vercel pull` from `build-explainer.yml:176`.
- [ ] Change Station 8 deploy to the verified sequence (D9): `vercel project add "re-${TARGET_REPO}-explainer" --scope sikerr-6092` → `vercel link --yes --project "re-${TARGET_REPO}-explainer" --scope sikerr-6092` → `vercel deploy --prod --yes --scope sikerr-6092`.
- **Verify:** trigger one test build; confirm landing URL unchanged; new Vercel project created; post-deploy projectId assertion passes.

### Phase 1 — Core engine fixes (D2, D3, D8 email, D7 rate limit)

**1a. D8: async+email UX** (from ADR-0003 Decision 1):
- [ ] `www/index.html`: make email field `required`.
- [ ] `www/api/build.js:185`: return HTTP 400 if email missing/invalid.
- [ ] `www/main.js`: confirmation panel on submit; optional "Track progress" button.
- [ ] `build-explainer.yml:259`: remove `&& env.HAS_GMAIL == 'true'` condition.
- [ ] Add failure email in `build-explainer.yml:277–283` failure handler.
- [ ] Add Phase 0 pre-flight: `test -n "$GMAIL_APP_PASSWORD" || (echo "::error::GMAIL_APP_PASSWORD not set" && exit 1)`.
- **Verify:** submit with real email; close browser; confirm email arrives within 5 min of build completion.

**1b. D7: durable rate limit** (from ADR-0003 Decision 4):
- [ ] Create active-builds tracking Gist. Save ID as `ACTIVE_BUILDS_GIST_ID` on landing project.
- [ ] Replace in-memory `rateMap` in `www/api/build.js:9–25` with Gist-read check.
- [ ] Add `concurrency:` stanza to `build-explainer.yml` build job (per-repo group).
- **Verify:** two rapid submissions for same repo; second returns 429.

**1c. D3: image engine upgrade**:
- [ ] Add `GOOGLE_API_KEY` to `stuinfla/Repo-Explainer` secrets.
- [ ] Rewrite `scripts/phase5-generate-images.mjs:43–59` image definitions for `gpt-image-2` at **1536×1024** (hero — the only landscape size gpt-image-2 supports; 1792×1024 is DALL·E-3 only and will be rejected) with `imagen-4.0-ultra` / `gemini-3-pro-image` fallback.
- [ ] Update hero prompt: widescreen-specific composition guidance.
- **Verify:** test build; confirm hero.png is 1536×1024; confirm fallback path reachable with a mock `OPENAI_API_KEY=invalid` build.

**1d. D2: RuVector KB (Station 1)**:
- [ ] Write `scripts/register-kb-target.mjs` to register the build's `$BUILD_ID` slug in `kb/kb.config.mjs`.
- [ ] Add `node kb/build-kb.mjs --target "$BUILD_ID"` step in Phase 2 (NOT `npx @rvf/forge` — that package does not exist).
- [ ] Copy `kb/stores/$BUILD_ID/` to `kb-output/` for downstream station access.
- [ ] Cache/restore `kb/models-cache/` in the GHA workflow to avoid cold-downloading the ONNX model per build.
- [ ] Add `@ruvector/rvf` + `.passages.jsonl` join in `scripts/phase4-author-content.mjs`.
- [ ] Update Phase 2 gist evidence step to record RVF size + passage count.
- **Verify:** test build; confirm `kb-output/{BUILD_ID}.rvf` and `kb-output/{BUILD_ID}.passages.jsonl` exist and are non-empty; confirm Phase 4 log shows "KB-grounded context: N passages loaded."

### Phase 2 — Quality gate overhaul (D6)

**2a. D6: dual mobile+desktop quality+refine loop**:
- [ ] Add `npx playwright install --with-deps chromium` to Phase 0 in `build-explainer.yml`.
- [ ] Write `scripts/phase8-quality-refine.mjs` (Station 9 — runs AFTER Station 8 DEPLOY; screenshots LIVE_URL).
- [ ] Add Station 9 step in `build-explainer.yml` AFTER the Station 8 deploy step (not before).
- [ ] Implement hard gate (no-overflow, hero-loaded, all-links-200, tap-targets, download-present) before vision-grade loop.
- [ ] Calibrate ≥80 aesthetic threshold against the 5 existing hand-curated examples before enforcing.
- **Verify:** one complete build; confirm Phase 8 log shows LIVE_URL; confirm Phase 9 log shows mobile score + desktop score graded against a live URL. Deliberately inject a broken CSS rule into `explainer-site/styles.css` and confirm the refine loop triggers a re-deploy.

**2b. Gate system alignment** (from ADR-0003 Decision 3, confirmed):
- [ ] Gate B: add KB-grounded token-overlap check; raise char minimum to 8000.
- [ ] Gate E (new): vision-grade images via GPT-4o Vision for hero/arch/use-case.
- [ ] Gate F: rename current Gate E (deploy readiness); add sitemap/robots checks.
- [ ] Gate H: station-5 asset checks (in studio GHA job).

### Phase 3 — Station 5 cloud worker + Station 6 pack (D4, D5)

**3a. D4: cloud browser worker for studio**:
- [ ] Deploy cloud browser worker service (Fly.io machine or GCP Cloud Run with Chrome + nlm).
- [ ] Implement worker HTTP API: `POST /studio` → studio artifact URLs.
- [ ] Configure worker session refresh cron (daily `nlm login --check`).
- [ ] Add `STUDIO_WORKER_URL` + `STUDIO_WORKER_KEY` to `stuinfla/Repo-Explainer` secrets.
- [ ] Add `studio:` job to `build-explainer.yml` calling worker API.
- [ ] Write `scripts/phase5.5-build-studio.mjs` (runs inside the worker, not GHA).
- **Verify:** trigger one build; confirm `studio/audio.mp3` reaches the Vercel project; inline `<audio>` plays on the live page. Simulate worker API failure (wrong `STUDIO_WORKER_KEY`); confirm build completes without studio and user email notes the omission.

**3b. D5: downloadable AI knowledge pack**:
- [ ] Use `kb/make-dropin.mjs "$BUILD_ID" "explainer-site/${TARGET_REPO}-knowledge-pack.zip"` (already in this repo — NOT a new script).
- [ ] Verify pack includes `{buildId}.passages.jsonl` and `{buildId}.rvf.embed.json` (required for text retrieval).
- [ ] Verify search tool is `ask-kb.mjs` and MCP server is `kb-mcp-server.mjs` (both from `kb/` — NOT `@ruvector/search-cli`/`@ruvector/mcp-server`, which do not exist on npm).
- [ ] Update Phase 3 scaffold to include `<!-- KPACK:download -->` slot in `index.html`.
- [ ] Station 6 populates the download slot (renders primer inline + download button) and writes zip to `explainer-site/`.
- [ ] Add Gate F check: zip file exists and is > 10KB.
- **Verify:** test build; `curl -I {LIVE_URL}/{TARGET_REPO}-knowledge-pack.zip` returns 200 with `Content-Type: application/zip`. Unzip on a clean machine, run `npm install` in `for-ai/`, run `node ask-kb.mjs {buildId} "what does this project do" 3` — confirm TEXT passages are returned (not just IDs).

### Phase 4 — PROVE IT: two concurrent watched builds

- [ ] Trigger two builds simultaneously for different repos.
- [ ] Watch both GHA workflows AND both email inboxes.
- [ ] Confirm: both complete; both emails arrive with correct live URL; both Vercel projects
      are distinct (`projectId` differs, neither equals `prj_KbSbSjdTfeGzW6x4O2TftTU8jXi1`);
      landing form is still live throughout; both pages pass visual inspection on mobile and
      desktop; both knowledge pack zips download and return text on `ask-kb.mjs` test.
- [ ] Custom domain proof: `curl -I https://{repo1}.repoexplainer.isovision.ai` → 200 and
      `curl -I https://{repo2}.repoexplainer.isovision.ai` → 200, both pointing to distinct
      Vercel deployments (different `x-vercel-id` headers).
- [ ] Cancellation proof: cancel one mid-run; confirm sweeper patches Gist to `failed` within
      20 minutes and sends a failure email.
- This step is not complete until all confirmations above are checked against real output.

---

## Considered Alternatives

### Alt 1 — Keep self-hosted Mac runner for studio (ADR-0003 Decision 2 as written)

**Rejected (D1):** Mac availability is a hard dependency. ADR-0003 Decision 2 acknowledged
this but concluded the risk was acceptable for an initial implementation. The updated
requirement — "MUST work every time" — is incompatible with a single Mac runner. A cloud
browser worker is more complex to set up but removes the reliability cliff.

### Alt 2 — Cookie injection for nlm on ubuntu-latest (ADR-0002 D4 Path B)

**Rejected (D4):** Google session cookies expire unpredictably. Expiry = silent studio
failure for all builds until the operator manually refreshes cookies. The cloud browser
worker with proactive session refresh is the correct approach.

### Alt 3 — Keep gpt-image-1

**Rejected (D3):** gpt-image-1 is deprecated by OpenAI. Any new code targeting gpt-image-1
will break on OpenAI's removal timeline. `gpt-image-2` is the direct successor.

### Alt 4 — Keep JSON KB; make README claim true by deleting the claim

**Rejected (D2):** removing the "vector database" claim from the README satisfies ADR-0002
OC-C but does not improve the product. The content authored in Station 2 is measurably
richer when grounded in semantic KB retrieval vs keyword-matched excerpts. The RVF KB is
required, not merely aspirational. ADR-0002 Alt 4 "deferred" this; the deferral is closed.

### Alt 5 — Skip the knowledge pack (D5); ship only the explainer page

**Rejected:** the knowledge pack is in the product spec and is a first-class differentiator
— no other explainer service provides a downloadable RuVector KB + MCP server that works
inside Claude Code. It is not a stretch goal; it is a station in the pipeline.

### Alt 6 — Single viewport for quality gate (revert to ADR-0003 Gate G)

**Rejected (D6):** mobile is the primary browsing environment for the majority of visitors
arriving via social sharing (where OG cards are rendered). A page graded only at desktop
viewport can have catastrophic mobile layout failures that go undetected. Dual-viewport
is the minimum for "looks damn good."

---

## Consequences

### Positive

- No Mac in the critical path → build availability matches GHA's SLA (>99.9%).
- RuVector KB in Station 1 → Station 2 content is semantically grounded, not excerpt-matched.
- gpt-image-2 / imagen-4.0-ultra / gemini-3-pro-image → hero images are widescreen (1536×1024),
  higher quality, and not tied to a deprecated API.
- Cloud browser worker for NotebookLM → studio can scale with multiple worker instances;
  session refresh is a monitored scheduled job, not a manual operator action.
- Downloadable knowledge pack → visitors take the KB home; the explainer creates lasting
  value beyond the page visit.
- Mobile + desktop quality gate with refine loop → pages are great on both devices before
  shipping; no "deployed_with_warnings" as a normal outcome.

### Negative / Risks

- **Cloud browser worker setup is non-trivial:** deploying Chrome + `nlm` in a cloud
  container requires verifying headless Chrome can authenticate Google SSO in a cloud
  environment. Google may block headless login attempts. Mitigation: use a real Chrome
  profile (not headless-only mode); store the session with `--user-data-dir` persistence.
  If this proves unworkable, fall back to the worker running as a long-lived process with
  an initial interactive login via SSH, subsequent runs non-interactive.
- **RVF KB build time:** building a real RVF adds 30–90s to Station 1 depending on repo
  size. For very large repos (>50K source files), cap at `--max-files 1000` and note in
  the job record. This is acceptable given the content quality improvement.
- **Vision grading cost:** Station 8 adds ~$0.05/build for the refine loop. At 100 builds/
  day = $5/day additional cost. Manageable. At 1000 builds/day, revisit.
- **Refinement loop adds latency:** up to 3 iterations × ~60s each = up to 3 minutes
  additional build time in the worst case. Total build time target moves from "3–5 minutes"
  to "3–10 minutes" depending on initial page quality. The email model (D8) means this
  latency is not user-visible as a waiting experience.
- **`GOOGLE_API_KEY` is a new required secret:** any existing `stuinfla/Repo-Explainer`
  build that doesn't have this secret set will fail at Station 3 on the fallback path.
  The primary engine is `gpt-image-2` (existing `OPENAI_API_KEY`); fallback to Google
  engines only triggers if OpenAI fails. Add `GOOGLE_API_KEY` before any build that
  deploys the new Phase 5 code.

---

## What Is NOT Proven by This ADR

- **Cloud NotebookLM SSO (highest risk):** a cloud browser worker successfully authenticating
  Google SSO for `nlm` in a headless environment is NOT proven. The only verified path is
  Mac-local CDP. Must prototype one full studio end-to-end from cloud before Phase 3 begins.
  If blocked, adopt the persistent authenticated VM fallback (see D4).
- **Custom domain per-project routing:** `vercel domains add {repo}.repoexplainer.isovision.ai
  re-{repo}-explainer` attaching dozens of per-build subdomains to isolated projects has NOT
  been proven at scale. Must run the two-concurrent-build proof (Phase 4) before rollout.
  Until proven, `*.vercel.app` is the real deliverable.
- **Aesthetic vision grade calibration:** that MIN_SCORE=80 is achievable by gpt-image-2 +
  LLM-authored content within 3 refine iterations for the range of repos expected. The
  calibration run (Phase 2 step 2a) against the 5 existing hand-curated examples must set
  the threshold before the aesthetic gate is enforced. Until calibrated, only the hard gate
  (deterministic checks) blocks ship.
- **Knowledge pack size on Vercel static:** that `{repo}-knowledge-pack.zip` is reliable for
  packs >50MB. Vercel's static file size limit must be verified before Station 6 deploys at
  scale.
- **NOTE — resolved in this version (v1.1.0):** `@rvf/forge` does NOT exist on npm (HTTP 404)
  and was a fictional command in v1.0.0. The real KB toolchain is `kb/build-kb.mjs` using this
  repo's own `kb/` engine. All Station 1 references have been corrected. Similarly,
  `@ruvector/search-cli` and `@ruvector/mcp-server` do not exist — corrected to `ask-kb.mjs`
  and `kb-mcp-server.mjs`. `vercel deploy --name` was removed from Vercel CLI — corrected to
  `vercel project add` + `vercel link` + `vercel deploy` sequence. Hero dimension corrected
  from 1792×1024 (DALL·E-3 only) to 1536×1024 (verified gpt-image-2 landscape size).
