# ADR-0002: Repo Explainer End-to-End Architecture

**Version:** 1.0.0
**Created:** 2026-06-26
**Status:** Accepted — pipeline proven end-to-end (single build, HANDOFF.md); overwrite trap and
studio gap documented and unresolved; migration checklist below is the binding work order.
**Supersedes:** nothing — extends ADR-0001 (which covers the manual KB/studio pipeline for ruv's
own repos). This ADR governs the *public web service* that accepts any GitHub repo URL and
produces an explainer in 3–15 minutes.
**Domain model:** `docs/ddd/repo-primer-domain-model.md` (partial — a separate Repo-Explainer
DDD is a follow-up)

---

## Context

ADR-0001 covers the manual Repo-Primer Pipeline: a Claude Code / NotebookLM process for
building dual-half knowledge bundles for ruv's own repos (MetaHarness, PhotonLayer, etc.).

This ADR covers a different system: **Repo Explainer**, a public web service where a visitor
pastes any GitHub URL and receives, in 3–15 minutes:

1. A polished, visual, standalone explainer website (same quality bar as the existing 5 examples).
2. A public GitHub repo (`stuinfla/{repo}-explainer`) with the target repo's owner invited as
   a collaborator.
3. A showcase URL (`{repo}.repoexplainer.isovision.ai`) when DNS is live.
4. A real-time progress view on the landing page — the user is never waiting blind.
5. An email notification when done.

The system is **proven end-to-end** (HANDOFF.md — "Build pipeline (phases 0–9): Passing,
~2–2.5 min, all phases green") but has two critical structural problems that must be resolved
before multi-user rollout:

- **The overwrite trap** (HANDOFF.md line 78): the landing and every generated explainer share
  the same Vercel project, so each new build clobbers the landing page's production URL.
- **The studio gap** (README.md lines 165–173 vs `phase6-quality-gates.mjs`): the README
  advertises five quality gates including "Gate D — Studio media (audio overview graded ≥95)"
  but the actual pipeline Gate D is a **security check** (no eval/document.write/hardcoded
  secrets). There is no NotebookLM or audio step anywhere in the automated pipeline.

---

## End-to-End Step Map (code-grounded)

The automated pipeline is `stuinfla/Repo-Explainer` `.github/workflows/build-explainer.yml`,
triggered by `workflow_dispatch` from `www/api/build.js`. Status is broadcast via a public
GitHub Gist, polled by `www/api/status.js` every 5 seconds.

The landing page (`www/main.js` line 25–35) shows 9 named steps with time estimates. These
map to 10 workflow phases (0 is implicit setup, 1–9 are explicit steps).

### Phase 0 — Setup (workflow-level)

- **What it does:** `actions/checkout@v4`, `actions/setup-node@v4` (Node 20), `apt-get install jq`.
  Updates gist: `step=0, stepName="Setup", status="running"`.
- **Inputs:** the Repo-Explainer repo itself (`stuinfla/Repo-Explainer`).
- **Outputs:** a working build environment with Node 20 and jq.
- **User sees (main.js):** "Setting up — Preparing the build runner and tools (~25s)". Step 0
  active.
- **External services:** GitHub Actions runner only.
- **Failure:** workflow fails to launch; gist never reaches "running" state. The frontend
  timeout (15 min, main.js line 317) and stale-detection (3 min no progress, line 319) will
  eventually surface this. **Gap:** the `consecutiveErrors` counter (line 314) catches network
  failures to the poll endpoint but not a workflow that never starts. If `api/build.js`
  successfully dispatches and the runner never picks up the job, the user will stall for 3 min
  before seeing "Build appears stuck".

### Phase 1 — Clone target repo

- **What it does:** `git clone --depth 1 https://github.com/{owner}/{repo}.git target-repo`.
  Exits 1 with `::error::Target repo not found` if clone fails.
  Updates gist: `step=1, stepName="Cloning target repository", status="running"`.
- **Inputs:** `TARGET_OWNER`, `TARGET_REPO` env vars.
- **Outputs:** `target-repo/` directory on the runner.
- **User sees:** "Cloning repository (~5s)". Step 1 active.
- **External services:** GitHub (public git clone; no token required for public repos).
- **Failure:** `exit 1` → failure handler at workflow end updates gist to `status="failed"` →
  frontend shows "Build failed" with retry button.

### Phase 2 — Build knowledge base

- **What it does:** `node scripts/phase2-build-kb.mjs target-repo/ kb-output/`. Walks the repo
  tree (skipping `node_modules`, `.git`, `vendor`, `dist`, etc.), reads source files up to 200
  lines each (MAX_LINES), extracts symbols with regex patterns per language, reads manifests
  (`package.json`, `Cargo.toml`, etc.), and writes `kb-output/repo-analysis.json` — a plain
  JSON structure.
  Updates gist: `step=2, stepName="Building knowledge base", status="running"`.
- **Inputs:** `target-repo/` directory.
- **Outputs:** `kb-output/repo-analysis.json` — repo metadata (name, description, language,
  topics, file tree, source excerpts, symbol table, manifest contents).
- **User sees:** "Analyzing the codebase (~5s)". Step 2 active.
- **External services:** none. Zero npm dependencies (Node built-ins only).
- **IMPORTANT — README MISREPRESENTATION:** README.md line 72 says Phase 2 "embeds [the repo]
  into a searchable vector database." This is false. `phase2-build-kb.mjs` produces a plain
  JSON file with no embeddings, no RVF, no vector operations. There is no vector database in
  the automated web pipeline at all. Correcting this claim is required before publishing.
- **Failure:** `exit 1` → failure handler.

### Phase 3 — Scaffold explainer site

- **What it does:** `node scripts/phase3-scaffold.mjs kb-output/repo-analysis.json explainer-site/`.
  Creates `explainer-site/` with `index.html` (9 section slots as `<!-- CONTENT:xxx -->`
  markers), `styles.css`, `main.js`, `vercel.json`, `package.json`, and `assets/img/` directory.
  Updates gist: `step=3, stepName="Scaffolding explainer site", status="running"`.
- **Inputs:** `kb-output/repo-analysis.json`.
- **Outputs:** `explainer-site/` with a templated HTML scaffold. Gallery section uses
  `<!-- IMG:gallery -->` marker; use-cases section uses `<!-- CONTENT:use-cases -->` in a
  `<div class="use-case-grid">`.
- **User sees:** "Scaffolding explainer (~5s)". Step 3 active.
- **External services:** none.
- **Failure:** `exit 1` → failure handler.

### Phase 4 — Author content

- **What it does:** `node scripts/phase4-author-content.mjs kb-output/repo-analysis.json explainer-site/`.
  Calls OpenAI GPT-4o to generate HTML content for each `<!-- CONTENT:xxx -->` section slot
  using the repo analysis as context. Replaces markers in-place.
  Updates gist: `step=4, stepName="Authoring explainer content", status="running"`.
- **Inputs:** `kb-output/repo-analysis.json`, `explainer-site/index.html` (with markers).
- **Outputs:** `explainer-site/index.html` with markers replaced by AI-authored HTML sections.
- **User sees:** "Authoring content (~45s)". Step 4 active.
- **External services:** OpenAI API (`gpt-4o`); requires `OPENAI_API_KEY`.
- **Failure:** OpenAI error → `exit 1` → failure handler.

### Phase 5 — Generate images

- **What it does:** `node scripts/phase5-generate-images.mjs kb-output/repo-analysis.json explainer-site/`.
  Calls OpenAI `gpt-image-1` to generate three images:
  - `hero.png` at `1536x1024` (widest landscape; 1792x1024 was rejected by gpt-image-1 — fixed per HANDOFF.md).
  - `architecture.png` at `1024x1024`.
  - `use-case.png` at `1024x1024`.
  Saves to `explainer-site/assets/img/`. Populates the `<!-- IMG:gallery -->` slot, or
  removes it cleanly on failure — never a broken `<img>` tag.
  Updates gist: `step=5, stepName="Generating images", status="running"`.
- **Inputs:** `kb-output/repo-analysis.json`, `explainer-site/`.
- **Outputs:** `explainer-site/assets/img/hero.png`, `architecture.png`, `use-case.png`;
  updated `index.html` gallery slot.
- **User sees:** "Generating images (~50s)". Step 5 active.
- **External services:** OpenAI `gpt-image-1`; requires `OPENAI_API_KEY`.
- **Failure:** graceful image-level (removes broken `<img>`); hard exit if directory not
  found → failure handler.

### Phase 6 — Quality gates

- **What it does:** `node scripts/phase6-quality-gates.mjs explainer-site/ kb-output/repo-analysis.json`.
  Runs 5 gates. Reports pass/fail/score per gate; exits 1 if any gate fails.
  Updates gist: `step=6, stepName="Running quality gates", status="running"`.

  | Gate | Name in code | What it actually checks |
  |------|-------------|------------------------|
  | A | Structure completeness | index.html, styles.css, main.js, vercel.json, package.json exist; valid HTML; real content |
  | B | Content quality | ≥5000 chars, project name in title + hero, ≥5/9 sections filled, no secrets in HTML |
  | C | Asset integrity | hero.png exists (warn only), no broken local img srcs, no broken internal anchors |
  | D | Security | No `eval()`/`document.write`, no external inline scripts, no hardcoded secrets/tokens |
  | E | Deploy readiness | vercel.json is valid JSON object, package.json has name field |

- **Inputs:** `explainer-site/`, `kb-output/repo-analysis.json`.
- **Outputs:** gate results printed to stderr; exits 0 (all pass) or 1 (any fail).
- **User sees:** "Running quality gates (~5s)". Step 6 active.
- **External services:** none.
- **STUDIO GAP — CONFIRMED:** The README.md (lines 165–173) describes Gate D as "Studio media
  — Is the audio overview clear, confident, and complete? Score >= 95." This is completely
  false. The actual Gate D is a **security check** (`phase6-quality-gates.mjs` line 150:
  `log('Gate D — Security')`). There is no NotebookLM, no audio overview, no studio step
  anywhere in the automated 9-phase pipeline. The studio artifacts in the 5 existing examples
  were produced manually via the ADR-0001 Claude Code process. This mismatch must be corrected
  in the README and quality gate labels before rollout.
- **Failure:** `exit 1` → failure handler.

### Phase 7 — Create GitHub repo and invite collaborator

- **What it does:**
  1. `gh repo create stuinfla/{repo}-explainer --public` (or skip if exists).
  2. `git init` + `git push -u origin main --force` in `explainer-site/`.
  3. `gh api repos/stuinfla/{repo}-explainer/collaborators/{target_owner} -X PUT -f permission=push`
     (warning-only — does not fail the build if the invite fails).
  Updates gist: `step=7, stepName="Creating GitHub repository", status="running"`.
- **Inputs:** `explainer-site/`, `GH_PAT` secret, `EXPLAINER_REPO` env var.
- **Outputs:** public repo at `https://github.com/stuinfla/{repo}-explainer`; target owner
  invited as push collaborator.
- **User sees:** "Publishing to GitHub (~10s)". Step 7 active.
- **External services:** GitHub API (`GH_PAT`).
- **ASPIRATIONAL CLAIM:** README.md line 93 says "A PR on your original repo's README — adds
  a badge linking to the explainer." There is no such step in the workflow. This is not
  implemented.
- **Failure:** git push failure → `exit 1` → failure handler. Collaborator invite failure →
  `::warning` only.

### Phase 8 — Deploy to Vercel

- **What it does:**
  1. `npm i -g vercel@latest`.
  2. `vercel deploy --prod --yes` — captures URL, does NOT pipe through `tail -1` (that bug
     was fixed per HANDOFF.md).
  3. Smoke test: `curl ... -w "%{http_code}"` on the deployment URL (200 = OK, else warning).
  4. `vercel alias set {url} {repo}.repoexplainer.isovision.ai` — best-effort, warns on fail.
  5. Custom domain liveness check: if domain resolves, `LIVE_URL = domain`; else fallback to
     `*.vercel.app` URL. Writes `DEPLOYMENT_URL` and `LIVE_URL` to `$GITHUB_ENV`.
  Updates gist: `step=8, stepName="Deploying to Vercel", status="running"`.
- **Inputs:** `explainer-site/`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
- **Outputs:** live Vercel deployment URL; `LIVE_URL` env var for Phase 9.
- **User sees:** "Deploying to Vercel (~35s)". Step 8 active.
- **External services:** Vercel CLI + Vercel API.
- **OVERWRITE TRAP — CRITICAL:** All builds currently use the same `VERCEL_PROJECT_ID`
  (`prj_KbSbSjdTfeGzW6x4O2TftTU8jXi1`) — the same project that hosts the landing page. Each
  `vercel deploy --prod` overwrites that project's production URL. With multiple concurrent
  users this is fatal: each build clobbers the previous one's production URL, the landing page
  disappears, and all in-progress builds lose their result URL. This must be resolved before
  multi-user rollout (see D1 below).
- **Failure:** no URL parsed or deploy exit non-zero → `exit 1` → failure handler.

### Phase 9 — Notify

- **What it does:**
  1. Updates gist: `step=9, status="done"`, `result={explainerUrl: LIVE_URL, repoUrl: ...}`.
  2. If `submitter_email != ''` AND `GMAIL_APP_PASSWORD != ''`: runs
     `node scripts/phase9-send-email.mjs` — speaks SMTP directly over implicit-TLS to
     `smtp.gmail.com:465` with zero npm deps.
- **Inputs:** `LIVE_URL`, `DEPLOYMENT_URL`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` secrets.
- **User sees:** Frontend polls `/api/status`, sees `status="done"`, calls `showSuccessResult()`
  (main.js line 388): all 9 steps go green, success panel shows "Your explainer is live!" with
  "Explainer page" and "GitHub repo" links, each with a Copy button and Open button.
- **External services:** GitHub Gist API (gist patch); Gmail SMTP (`smtp.gmail.com:465`).
- **Failure handler (workflow-level):** `if: failure()` step at workflow end (yml line 277).
  Calls `update-gist-status.sh` with `status="failed"`. Frontend sees `status="failed"` →
  `showFailureResult(statusData.error)` → "Build failed" panel with "Try Again" button.

### Status polling (client-side)

`www/main.js` (lines 340–429):
- Polls `/api/status?id={buildId}&gist={gistId}` every `currentDelay` ms (starts at 5000ms).
- **Stale detection** (line 365): if `currentStep` does not advance within 3 minutes
  (`STALE_THRESHOLD_MS = 3 * 60 * 1000`), shows "Build appears stuck — no progress for 3
  minutes."
- **Hard timeout** (line 343): 15 minutes (`MAX_WAIT_MS = 15 * 60 * 1000`), shows "Build timed
  out after 15 minutes."
- **Network errors** (line 412): exponential backoff up to 20s delay; after 10 consecutive
  errors (`MAX_CONSECUTIVE_ERRORS`) shows "Lost connection to the build server."
- **Rate limit** (`www/api/build.js` line 9–25): in-memory Map keyed by `owner/repo`,
  1-hour window, max 500 entries. **Gap:** this does not survive serverless cold starts; a
  new function instance has an empty Map. Provides no durable rate protection under load.

---

## Target Architecture (clean/simple)

### D1 — Landing and per-build explainers are fully isolated Vercel projects

**Decision:** the submission landing (`www/`) and each generated explainer must live in
**separate Vercel projects** with separate project IDs.

- **Landing project:** root directory `www/`, auto-deploys on git push to `stuinfla/Repo-Explainer`
  `main`. Owns domain `repoexplainer.isovision.ai` (apex) once DNS is live. Never touched by
  a user-submitted build. Secrets: `GITHUB_TOKEN` (for `api/build.js` to dispatch workflows
  and create gists).
- **Per-build explainer project:** each build creates a NEW Vercel project (not a deployment
  within an existing one). The simplest mechanism: change the Phase 8 deploy step to use
  `vercel --name {repo}-explainer` without a `VERCEL_PROJECT_ID`, which creates a new project
  on first deploy. Each project gets its own preview + production URL and its own alias
  (`{repo}.repoexplainer.isovision.ai`). These projects accumulate on the team; a housekeeping
  cron can archive stale ones.

**Rationale:** the current single-project design is fatal at any concurrent load >1. With
project-per-build: (a) builds never clobber each other, (b) the landing is stable, (c) each
explainer URL is permanent and scoped to its build.

**Migration:** drop `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` from the pipeline workflow's Phase 8
env block; change the deploy command to `vercel --name {repo}-explainer --yes --prod`; add
`VERCEL_TEAM_ID` (the org slug, `sikerr-6092`) so the project lands on the right team. The
landing project is a separate setup step: `cd www && vercel link` to a new project, then add
a separate GitHub deploy or re-enable git integration only for `www/`.

### D2 — Status channel: GitHub Gist (zero infrastructure)

**Decision:** keep GitHub Gist as the status broadcast channel. The pipeline writes a JSON
`status.json` file to a public Gist (created at submission time by `api/build.js`). The
client polls `/api/status` which reads the Gist. The Gist ID is the correlation key between
the submission (client ↔ `api/build.js`) and the pipeline (`update-gist-status.sh`).

**Why keep it:** zero infrastructure, no database, Gist is free and durable, and the current
implementation already works end-to-end. The workflow update script (`update-gist-status.sh`)
speaks the GitHub API directly with `curl` — no npm required on the runner.

**Gap:** rate limiting on `/api/status` (reads from the Gist API) is not durable across
serverless cold starts. For dozens of concurrent users this is acceptable since each client
polls its own unique Gist ID (no shared hot path). The in-memory rate limit on submissions
(`api/build.js`) is the weak point — it should be replaced with a durable store (e.g., a KV
check on the Gist description) for true multi-user safety.

### D3 — Pipeline trigger: workflow_dispatch via GitHub API

**Decision:** keep `workflow_dispatch` as the trigger. `api/build.js` calls
`POST .../actions/workflows/build-explainer.yml/dispatches` with `{ ref: "main", inputs: {...} }`.
GitHub Actions is the compute layer — free, scalable, cloud-native, no server to manage.

**Why not webhooks/queue:** the current model is a direct synchronous dispatch with immediate
acknowledgment (HTTP 204 = accepted). A queue would add complexity without benefit at this
scale. The status Gist is the async channel back to the client.

### D4 — Studio: current state is manual; target state is automated via nlm CLI on a self-hosted runner

**Current state (honest):** the automated 9-phase pipeline **does not produce NotebookLM
studio artifacts**. The 5 existing examples (MetaHarness, PhotonLayer, ruqu, ruvn, Agentic QE)
have studio artifacts because they were produced via the ADR-0001 manual Claude Code process on
Stuart's Mac, not via the web pipeline. The web pipeline produces only:
- A visual HTML/CSS/JS explainer website (Phases 3–5).
- Three AI-generated images (Phase 5).

**Target state (designed — not yet implemented):** a Phase 5.5 (Studio) runs after image
generation and before quality gates, producing a NotebookLM audio overview, explainer video,
and slide deck, embedding them in the explainer page. Gate D (currently security-only) is
split: Gate D-Security (existing) stays; Gate D-Studio (new) checks that studio assets are
present and non-empty.

**The blocking constraint: authentication on CI runners.** The `nlm` CLI
(`notebooklm-mcp-cli`, documented in `docs/notebooklm-capabilities.md`) CAN script all studio
steps programmatically: `nlm notebook create`, `nlm source add`, `nlm audio create`,
`nlm video create`, `nlm slides create`, `nlm share public`, `nlm download`. All UI steps
are CLI-scriptable (verified 2026-06-19, notebooklm-capabilities.md line 38). BUT: `nlm`
authenticates by reading Google auth cookies from a Chrome profile at
`~/.notebooklm-mcp-cli/profiles/default`. A standard `ubuntu-latest` GitHub Actions runner
has no Chrome profile, no Google auth cookies, and no user session. This is the only blocker.

**Two viable automation paths:**

**Path A — Self-hosted GitHub Actions runner on Stuart's Mac (recommended for initial
implementation).** Stuart's Mac has `nlm` installed at `/opt/homebrew/bin/nlm`, a valid
Google auth profile for `sikerr@gmail.com`, and Chrome. Adding `runs-on: [self-hosted, macos]`
to the workflow makes Phase 5.5 run locally, with full `nlm` access. Downsides: no scale-out
(one Mac = one concurrent studio build), runner must be online and Chrome/profile must be
healthy. This is the path that produced the 5 existing examples — it just wasn't wired into
the web pipeline workflow. This path is proven.

**Path B — Cookie-based auth via GitHub Secrets.** Export the `nlm` session cookies as a
JSON blob (from `~/.notebooklm-mcp-cli/profiles/default`), store as a GitHub encrypted
secret. On the runner: write the cookies to the expected path before invoking `nlm`. Re-export
the cookies whenever they expire. This works on `ubuntu-latest` runners but requires periodic
manual re-auth (when cookies expire, builds silently fail — a studio-fail must not block the
overall build). This is more complex than Path A and has a known silent-failure mode.

**Design for Phase 5.5 (once runner constraint is resolved):**

```yaml
# Phase 5.5 — NotebookLM Studio
- name: "Phase 5.5: Create NotebookLM studio"
  run: |
    NB_ID=$(nlm notebook create "${TARGET_REPO} Explainer" --output id)
    nlm source add "$NB_ID" --url "https://github.com/${TARGET_OWNER}/${TARGET_REPO}"
    nlm source add "$NB_ID" --file explainer-site/index.html
    nlm audio create "$NB_ID"
    nlm video create "$NB_ID"
    nlm slides create "$NB_ID"
    sleep 120  # generation is async; poll for completion
    nlm download "$NB_ID" --type audio -o explainer-site/studio/audio-overview.mp3
    nlm download "$NB_ID" --type video -o explainer-site/studio/explainer-video.mp4
    nlm download "$NB_ID" --type slides -o explainer-site/studio/slides.pdf
    STUDIO_URL=$(nlm share public "$NB_ID" --output url)
    echo "STUDIO_URL=$STUDIO_URL" >> "$GITHUB_ENV"
```

Phase 3 scaffold adds a `<!-- STUDIO:embed -->` slot in the HTML. Phase 5.5 replaces it
with an embedded studio player or links to the three artifacts. Gate D-Studio checks that
`studio/audio-overview.mp3`, `studio/explainer-video.mp4`, and `studio/slides.pdf` all
exist and are non-empty. If any artifact is missing, Gate D-Studio fails and the build stops.

**Required README corrections before any rollout (regardless of studio timeline):**
1. Remove "Studio media" from the "Built with" table until the studio phase is live.
2. Rename Gate D from "Studio media — audio overview graded ≥95" to "Security" in the
   quality gate table (the current code Gate D is security, not studio).
3. Rename Gate E from "Visuals graded ≥95" to "Deploy readiness."
4. Correct Phase 2 claim: "JSON repo analysis" not "searchable vector database."
5. Remove "A PR on your original repo's README" (not implemented).
6. Change "Resend" → "Gmail SMTP" in the Built With table.

**Once Phase 5.5 is implemented and proven:** restore Gate D as "Studio media" in README,
restore NotebookLM in the Built With table.

### D4.5 — Studio asset hosting and inline embedding

**Decision:** studio artifacts (audio, video, slides) must be embedded inline in the
explainer page — not linked out. A visitor should be able to play the audio, watch the video,
and browse the slides without leaving the page. Design per asset type:

**Audio overview (MP3):**
- `nlm download --type audio` produces an MP3 file (~20–40 MB per ADR-0001 measurements).
- Commit to `explainer-site/studio/audio.mp3`; deploy to Vercel with the rest of the site.
- Embed: `<audio controls src="/studio/audio.mp3">` — native browser player, no iframe, no
  CORS issue (same origin). This is the cleanest and most compatible path.
- Size constraint: 40 MB is within Vercel's serverless function payload limit and fine for
  static assets. No external hosting needed.

**Slide deck (PDF):**
- `nlm download --type slides` produces a PDF (~10–20 MB).
- Commit to `explainer-site/studio/slides.pdf`; deploy to Vercel.
- Embed option 1 (simple): `<iframe src="/studio/slides.pdf" width="100%" height="500px">` —
  works in Chrome/Edge/Safari with built-in PDF viewer; Firefox may prompt to download.
- Embed option 2 (reliable): use [PDF.js](https://mozilla.github.io/pdf.js/) bundled in
  `assets/js/pdf.min.js` — renders PDF in a canvas element, works in all browsers, no
  external CDN needed. Phase 3 scaffold should include PDF.js when studio is enabled.
- Recommended: PDF.js for consistent cross-browser rendering.

**Explainer video (MP4):**
- `nlm download --type video` produces an MP4 (~37 MB per ADR-0001 measurements, but may be
  larger for longer videos).
- **Hosting constraint:** MP4 files of this size cannot be served from Vercel's static layer
  efficiently (large binary on every CDN edge, slow cold load). Vercel does not transcode or
  stream video. Committed to Git, a 37 MB MP4 approaches GitHub's soft file-size limit
  (warning at 50 MB, hard limit 100 MB) and will bloat the explainer repo.
- **Recommended approach:** upload the MP4 to the per-build GitHub Release (same `stuinfla/{repo}-explainer` repo; tag `studio-latest`) using `gh release upload`. The Release URL is permanent, unauthenticated, and fast. Embed via `<video controls src="{release-asset-url}">` — browsers stream `<video>` from HTTPS URLs natively. No CORS issue (video tag does not require CORS headers for playback).
- Alternative: upload to R2/S3 — adds infrastructure. Reject unless GitHub Release proves
  unreliable.

**NotebookLM share URLs (iframe):**
- `nlm share public {nb_id}` produces a `notebooklm.google.com/notebooklm/...` URL.
- These URLs CANNOT be embedded in iframes: Google returns `X-Frame-Options: DENY` for
  NotebookLM pages. Do not attempt to iframe the share URL.
- The share URL is useful as a "open in NotebookLM" external link (opens in new tab), but is
  not the inline experience. Use the downloaded files for inline.

**Summary embedding strategy:**

| Asset | Hosting | Embed mechanism |
|-------|---------|-----------------|
| Audio overview (MP3) | Vercel static | `<audio controls src="/studio/audio.mp3">` |
| Slide deck (PDF) | Vercel static | PDF.js inline canvas renderer |
| Explainer video (MP4) | GitHub Release asset | `<video controls src="{release-url}">` |
| Images (PNG) | Vercel static (`assets/img/`) | `<img>` with lightbox JS (already in Phase 5) |
| NotebookLM share URL | Google-hosted | External link only (iframe blocked) |

Phase 3 scaffold must include the HTML slots: `<!-- STUDIO:audio -->`, `<!-- STUDIO:slides -->`,
`<!-- STUDIO:video -->`. Phase 5.5 populates them (or removes them cleanly on failure).

### D5 — Image generation: OpenAI gpt-image-1 primary, Gemini as documented fallback

**Decision:** keep OpenAI `gpt-image-1` as the primary image engine. It is proven (HANDOFF.md:
"hero at valid 1536x1024; gallery populated; all load HTTP 200"). The Gemini key (imagen-4.0 /
gemini-2.0-flash) is available but should NOT be added as an automatic fallback in the current
pipeline — it would introduce a branching code path for minimal gain at this scale.

**Recommended use of Gemini:** document it as an opt-in alternative for operators who prefer
Gemini or who exhaust OpenAI quota. Add a `GEMINI_API_KEY` secret to the workflow; if
`OPENAI_API_KEY` is unset and `GEMINI_API_KEY` is set, use Gemini in Phase 5. Do not run
both engines in the same build — complexity without benefit.

**Simplicity rationale:** one proven image engine, one code path. Dual-engine failover is
worth adding only if OpenAI reliability proves to be a problem in practice. Prove-it first.

### D6 — Landing engine: www/ is canonical; scratchpad is superseded

**Decision:** `www/` is the canonical landing. Its `main.js` (535 lines, real-time gist
polling, stale detection, failure handling, Copy/Open link buttons) is the correct engine.
The scratchpad `repo-explainer-website/main.js` (246 lines, simpler, no status.js, no
real-time polling) was the confirmed-good visual baseline from an earlier session and is
superseded by `www/`.

**No merge required:** `www/` already has both the confirmed visual design and the newer
engine from the HANDOFF.md session. No files from the scratchpad need porting. The
scratchpad can be deleted from the temp directory.

### D7 — DNS: wildcard Cloudflare CNAME, self-healing alias assignment

**Decision:** one Cloudflare DNS record unblocks all per-build custom domains at once:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `*.repoexplainer` | `cname.vercel-dns.com` | DNS only (gray cloud) |

The pipeline already assigns aliases (`vercel alias set`) and self-heals: once the DNS record
exists, future builds automatically advertise the custom domain. Until then, every build falls
back to its `*.vercel.app` URL (which is always valid and public). Nothing is blocked.

**Prerequisite:** the wildcard domain `*.repoexplainer.isovision.ai` is already attached to
the Vercel `repo-explainer` project and ownership-verified (HANDOFF.md). Once per-build
project isolation (D1) is in place, aliases must be assigned to the per-build project
rather than the shared project.

### D8 — Secrets, split by project (reference table)

| Secret | Landing project (`www/`) | Pipeline repo (`stuinfla/Repo-Explainer`) |
|--------|--------------------------|------------------------------------------|
| `GITHUB_TOKEN` | Yes — dispatch workflows, create Gists | — (uses `GH_PAT` instead) |
| `GH_PAT` | — | Yes — repo create, push, collaborator invite |
| `OPENAI_API_KEY` | — | Yes — Phases 4 and 5 |
| `VERCEL_TOKEN` | Yes (for landing deploys) | Yes — Phase 8 |
| `VERCEL_TEAM_ID` | Yes | Yes — to place projects under `sikerr-6092` |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | — | Yes — Phase 9 email |

`VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` are **removed from the pipeline** under D1 (each
build creates its own project dynamically).

---

## Operating Constraints (Binding)

**OC-A — Never share a Vercel project between the landing and any generated explainer.** The
overwrite trap (HANDOFF.md line 78) is a multi-user correctness failure. The landing must
have its own project before any public rollout. Treat any design that deploys both to the
same `VERCEL_PROJECT_ID` as broken.

**OC-B — Never advertise a studio step that is not implemented.** The README's Gate D
description ("Studio media — audio overview graded ≥95") and "Built with: Google NotebookLM"
are false for the automated pipeline. Shipping these claims creates user expectation that the
pipeline cannot meet. Fix first, ship second.

**OC-C — Never claim "vector database" for what is a JSON file.** `phase2-build-kb.mjs`
produces plain JSON analysis. The README's "searchable vector database" claim is aspirational
at best. If a real vector KB step is added (e.g. building an RVF from the repo), it must be
implemented and gated before the claim is published. Until then: "analyzes your repo and
builds a structured knowledge file."

**OC-D — The pipeline must never fail silently.** The failure handler
(`if: failure()` at yml line 277) must always run, and it must update the Gist to
`status="failed"`. The front-end shows a "Build failed" panel with a "Try Again" button.
Never let a failed build leave the Gist in a `running` state.

**OC-E — Custom domain alias is best-effort; the *.vercel.app URL is the real deliverable.**
Until Cloudflare DNS is live, every build's result URL is a `*.vercel.app` URL. The pipeline
already handles this correctly (self-heal check in Phase 8). Do not block builds on domain
resolution.

**OC-F — Prove end-to-end before rollout.** The migration checklist below specifies a
"watched build" step. Do not open the service to public traffic until one complete build
(with the isolated-project architecture) is run and observed step-by-step.

---

## Migration Checklist (current → target)

Each step is verifiable. Do them in order; do not skip.

1. **Fix README claims (no code change, doc only):**
   - [ ] README.md: correct Phase 2 description (JSON analysis, not vector DB).
   - [ ] README.md: rename Gate D to "Security" and Gate E to "Deploy readiness" in the
         quality gate table (lines 167–174).
   - [ ] README.md: remove "Studio media — Google NotebookLM" from Built With table.
   - [ ] README.md: remove "PR on your original repo's README" from deliverables list.
   - [ ] README.md: change "Resend" to "Gmail SMTP" in Built With table.
   - [ ] README.md: correct "~6 minutes" → "~3 minutes" pipeline estimate (www/main.js already
         says "~3 minutes"; README says "~6 minutes" at line 62).
   - **Verify:** grep README.md for "studio", "vector database", "Resend", "PR on" — all
     gone or corrected.

2. **Separate the landing into its own Vercel project:**
   - [ ] From `www/`, run `vercel link` to create a NEW project (not `repo-explainer`).
         Name it `repo-explainer-landing` or similar.
   - [ ] Set `GITHUB_TOKEN` env var on the landing project (needed by `api/build.js`).
   - [ ] Enable Vercel git integration on the landing project for `www/` (root dir = `www/`).
   - [ ] Confirm: push a whitespace change to `www/index.html`; verify the landing project
         auto-deploys and the `repo-explainer` project is unaffected.
   - [ ] Set the apex domain `repoexplainer.isovision.ai` on the landing project (not on
         `repo-explainer`).
   - **Verify:** `curl -I https://{landing-deploy-url}/` returns 200 with the submission form.

3. **Change Phase 8 to create per-build Vercel projects:**
   - [ ] Remove `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` from the workflow `env` block.
   - [ ] Add `VERCEL_TEAM_ID: ${{ secrets.VERCEL_TEAM_ID }}` (value: `sikerr-6092`).
   - [ ] In Phase 8, replace `vercel pull --yes ...` (which requires a linked project) with
         `vercel deploy --yes --prod --name "{repo}-explainer" --team "$VERCEL_TEAM_ID"`.
   - [ ] Confirm the alias step uses the per-build project (it already uses the deployment URL
         from the same step, so no change needed there).
   - **Verify:** run a build; confirm two separate Vercel projects exist (landing + new
     per-build project); confirm the landing URL is unchanged.

4. **Add Cloudflare DNS record:**
   - [ ] In the Cloudflare dashboard for `isovision.ai`: add CNAME `*.repoexplainer` →
         `cname.vercel-dns.com` (DNS only, gray cloud, not proxied).
   - **Verify:** `dig *.repoexplainer.isovision.ai CNAME` returns `cname.vercel-dns.com`.
     After DNS propagates: `curl -I https://{repo}.repoexplainer.isovision.ai/` returns 200.

5. **Add favicon generation to Phase 5 (D9):**
   - [ ] Add a 4th image definition to `scripts/phase5-generate-images.mjs` for `favicon.png` at `1024x1024` with the icon-specific prompt.
   - [ ] Add `convert` calls to Phase 5 to downscale to `favicon-32.png` and `favicon-192.png`.
   - [ ] Update Phase 3 scaffold to emit the three `<link rel="icon">` tags.
   - [ ] Add `favicon-32.png` to Gate C warn-only asset list.
   - **Verify:** built site has a `<link rel="icon">` tag; `assets/img/favicon-32.png` is a real image.

6. **Add SEO metadata to Phase 4 and Phase 3 (D10):**
   - [ ] Phase 3 scaffold: add `<!-- SEO:head -->` slot in `<head>` and generate `sitemap.xml` + `robots.txt` with the `EXPLAINER_DOMAIN` placeholder filled by the workflow env.
   - [ ] Phase 4: replace `<!-- SEO:head -->` with populated title, meta description, canonical, OG tags, Twitter card, JSON-LD.
   - [ ] Phase 5: add `alt` text to every `<img>` it places (derived from the repo name and image type).
   - [ ] Phase 7: add "Set GitHub repo SEO metadata" step as per D8b implementation block above.
   - [ ] Gate E: add `sitemap.xml` and `robots.txt` existence checks.
   - **Verify:** `curl -s {build-url} | grep "og:image"` returns the hero image URL. `curl -s {build-url}/sitemap.xml` returns valid XML. GitHub explainer repo shows topics and homepage URL in its About panel.

7. **Implement Phase 5.5 (NotebookLM studio) on a self-hosted runner (D4):**
   - [ ] Register Stuart's Mac as a GitHub Actions self-hosted runner on `stuinfla/Repo-Explainer`.
   - [ ] Add a `studio` job (or a conditional step) in the workflow with `runs-on: [self-hosted, macos]`.
   - [ ] Implement the Phase 5.5 script (`scripts/phase5.5-build-studio.mjs`) following the design in D4:
         `nlm notebook create` → `nlm source add` → `nlm audio/video/slides create` → poll until done → `nlm download`.
   - [ ] Upload video to GitHub Release (`gh release upload studio-latest studio/video.mp4`).
   - [ ] Implement `<!-- STUDIO:audio/slides/video -->` slots in Phase 3 scaffold and Phase 5.5 populates them (D4.5).
   - [ ] Add Gate D-Studio to `phase6-quality-gates.mjs`: checks `studio/audio.mp3`, `studio/slides.pdf` exist non-empty; `studio/video.mp4` present on GitHub Release.
   - [ ] Confirm `nlm login --check` passes on the self-hosted runner before the first build.
   - **Verify:** one complete build produces a page with inline `<audio>`, PDF.js slide viewer, and `<video>` — all playable without leaving the page.

8. **PROVE IT — run one complete watched build with the new architecture (steps 1–7 must all be complete first):**
   - [ ] Trigger: `gh workflow run build-explainer.yml -f target_owner=stuinfla -f target_repo=Repo-Explainer -f build_id=$(uuidgen) -f gist_id=TEST --repo stuinfla/Repo-Explainer` (or use your own repo).
   - [ ] Watch the Actions run AND the landing page simultaneously. Confirm:
     - Each of the 9 pipeline steps marks active, then done, on the landing page.
     - The landing page is still serving the submission form throughout (not overwritten).
     - The final success panel shows a live Vercel URL + a GitHub repo URL.
     - Both URLs are accessible unauthenticated.
     - If DNS is live: the custom domain URL also works.
     - The page has a favicon, OG image, and correct `<title>`.
     - The GitHub explainer repo shows topics and homepage URL in the About panel.
   - [ ] Trigger a second build concurrently. Confirm both complete without clobbering each
         other.
   - **PROVE-IT rule (from CLAUDE.md Rule 20):** do not claim "it works" without running the
     real commands on the actual paths and showing real output. A test on a different Vercel
     project does not prove the landing is isolated.

9. **Public rollout:**
   - [ ] Only after step 8 passes with two concurrent watched builds should this service be
         promoted publicly (e.g., shared on social media or linked from ruv's repos).

---

## Considered Alternatives

### Alt 1 — WebSocket / SSE for status instead of Gist polling

**Rejected:** adds a persistent server (WebSockets need a persistent process, not a serverless
function). Gist polling at 5s intervals is sufficient for a 2–3 minute pipeline and adds zero
infrastructure. The only downside is GitHub API rate limits on the Gist read — at dozens of
concurrent users, each polling every 5s, this is within GitHub's unauthenticated rate limit
(60/hour per IP; authenticated is 5000/hour). The `/api/status` Vercel function can add a
`GITHUB_TOKEN` header to the Gist read to use authenticated limits if needed.

### Alt 2 — Single monorepo Vercel project with path-based routing

**Rejected:** the overwrite trap makes this unworkable. Each `vercel deploy --prod`
updates the project's production deployment, regardless of path routing. Per-build isolation
requires per-project isolation.

### Alt 3 — Gemini as automatic failover for image generation

**Rejected (for now):** adds a branching code path in Phase 5 for marginal reliability gain.
OpenAI `gpt-image-1` is proven. Add Gemini only when OpenAI reliability proves to be a real
problem. Premature resilience is complexity debt.

### Alt 4 — Add a vector KB step to Phase 2 (make the README claim true)

**Deferred:** building a real RVF vector KB in Phase 2 would make the explainer richer (Phase 4
content grounded in real semantic retrieval rather than excerpt excerpts) but adds:
- npm dependency (`@ruvector/rvf`) on the CI runner.
- 30–90s to build time per repo.
- Complexity in the quality gate (live-query check against the RVF).

This is a follow-up item, not a blocker. The current pipeline produces good content from the
JSON analysis alone (all 5 existing examples pass quality gates). Add the RVF step when the
JSON-based content quality is proven insufficient.

### Alt 5 — Store per-build state in a database instead of GitHub Gist

**Rejected:** Gist is free, requires no setup, is permanently accessible via a stable URL,
and the build pipeline can update it with a single `curl` call (no npm dependency). A
database (Supabase, Vercel KV, etc.) would require provisioning, credentials, and ongoing
cost. Gist is appropriate at this scale.

---

## Consequences

### Positive

- The overwrite trap (D1) fix makes the service safe for dozens of concurrent users without
  any new infrastructure.
- README corrections (D4) eliminate false user expectations before they become complaints.
- Per-build Vercel project isolation means each explainer URL is permanent and scoped;
  builds never conflict.
- The self-healing alias pattern (D7) means custom domain goes live automatically the moment
  Cloudflare DNS is configured — no code change needed.

### Negative / Risks

- **Per-build Vercel project accumulation:** each build creates a Vercel project. On a free
  Vercel plan, project limits apply. Mitigation: archive or delete projects older than 90 days
  via a housekeeping cron. On a pro plan the limit is much higher.
- **In-memory rate limiting:** `api/build.js` rate limit does not survive serverless cold
  starts. A determined user can bypass it by waiting for a new function instance. Mitigation:
  the GitHub API will reject duplicate workflow dispatches for the same inputs; the Gist
  creation cost is low; accept this limitation at current scale.
- **OpenAI cost per build:** Phase 4 (GPT-4o, 9 sections) + Phase 5 (3 images at gpt-image-1
  pricing) is approximately $0.05–$0.20 per build depending on repo complexity. At dozens of
  builds/day this is manageable; at hundreds it requires a cost gate (e.g., require an API key
  from the submitter, or add billing).
- **GitHub Actions minute budget:** each build uses approximately 3–4 minutes of Actions time.
  On the `stuinfla` free tier this is 2000 min/month = ~500–660 builds/month before charges.

### D9 — Favicon: per-build generated icon, wired into Phase 5

**Decision:** each explainer gets its own generated favicon — a compact, bold, square icon
derived from the repo's visual identity. Favicon generation is added as a fourth image call in
Phase 5 (`phase5-generate-images.mjs`).

**Implementation:** Phase 3 scaffold writes these tags in `<head>`:

```html
<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/img/favicon-192.png">
<link rel="apple-touch-icon" sizes="192x192" href="/assets/img/favicon-192.png">
```

Phase 5 generates `favicon.png` at `1024x1024` (minimum gpt-image-1 supports) with a
prompt tuned for icon aesthetics — "A bold, minimal, icon-style symbol representing
{projectName}. Single dominant shape. High contrast. Square composition, legible at 32px.
No text or letters. {techContext}. Flat design, vibrant accent color on a dark background."
ImageMagick (`convert`, available on `ubuntu-latest`) downscales to 32×32 and 192×192:

```bash
convert explainer-site/assets/img/favicon.png -resize 32x32 explainer-site/assets/img/favicon-32.png
convert explainer-site/assets/img/favicon.png -resize 192x192 explainer-site/assets/img/favicon-192.png
```

**Gate C update:** add `favicon-32.png` to the asset existence check (warn-only, same
treatment as `hero.png` — missing favicon doesn't fail the build).

---

### D10 — SEO: explainer page and GitHub repo, both derived from Phase 2 analysis

**Decision:** the pipeline derives SEO metadata from `kb-output/repo-analysis.json` (already
built in Phase 2) and applies it to two surfaces without any new external API calls beyond
what Phase 4 already makes to OpenAI.

#### D8a — Explainer page SEO (Phase 4 writes these into `index.html`)

Phase 4 already reads `repo-analysis.json` and writes HTML. It also populates the following
into `<head>` (Phase 3 scaffold includes placeholder slots that Phase 4 replaces):

```html
<title>{repoName} — Visual Explainer | Repo Explainer</title>
<meta name="description" content="{1–2 sentences from analysis.description}">
<meta name="keywords" content="{top 10 from analysis.topics + language + key symbols}">
<link rel="canonical" href="https://{EXPLAINER_DOMAIN}/">

<!-- Open Graph — hero.png as og:image for rich social sharing -->
<meta property="og:type" content="website">
<meta property="og:title" content="{repoName} — Visual Explainer">
<meta property="og:description" content="{same description}">
<meta property="og:image" content="https://{EXPLAINER_DOMAIN}/assets/img/hero.png">
<meta property="og:image:width" content="1536">
<meta property="og:image:height" content="1024">
<meta property="og:url" content="https://{EXPLAINER_DOMAIN}/">

<!-- Twitter / X card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{repoName} — Visual Explainer">
<meta name="twitter:description" content="{same description}">
<meta name="twitter:image" content="https://{EXPLAINER_DOMAIN}/assets/img/hero.png">

<!-- JSON-LD: SoftwareSourceCode is correct for an explainer of an open-source repo -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  "name": "{repoName}",
  "description": "{description}",
  "url": "https://{EXPLAINER_DOMAIN}/",
  "codeRepository": "https://github.com/{TARGET_OWNER}/{TARGET_REPO}",
  "programmingLanguage": "{language}",
  "keywords": "{comma-separated topics}",
  "author": { "@type": "Person", "name": "{TARGET_OWNER}" }
}
</script>
```

**`sitemap.xml` and `robots.txt`** (generated in Phase 3 — static, no OpenAI call):

`sitemap.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://{EXPLAINER_DOMAIN}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
```

`robots.txt`:
```
User-agent: *
Allow: /
Sitemap: https://{EXPLAINER_DOMAIN}/sitemap.xml
```

**Heading structure:** already correct in Phase 3 scaffold — single `<h1>` (repo name in
hero), `<h2>` per section. No change needed.

**Image alt text:** Phase 4 must write descriptive `alt` text when placing images (e.g.,
"Architecture diagram of {repoName} showing component structure and data flow"). Currently
Phase 5 places images with no alt text — this must be fixed in Phase 5 as well.

**Gate E update:** add checks that `sitemap.xml` and `robots.txt` exist in the site dir.

#### D8b — GitHub explainer repo SEO (Phase 7, after push)

Two additional API calls using the existing `GH_PAT`. Both are stable, documented GitHub
REST endpoints requiring only `public_repo` scope (already held by `GH_PAT`):

**API call 1 — Update repo description and homepage:**
```
PATCH /repos/{owner}/{repo}
Body: { "description": "...", "homepage": "https://..." }
```
Docs: `https://docs.github.com/en/rest/repos/repos#update-a-repository`

```bash
gh api "repos/${EXPLAINER_REPO}" -X PATCH \
  -F description="Visual explainer for ${TARGET_OWNER}/${TARGET_REPO}" \
  -F homepage="${LIVE_URL}"
```

**API call 2 — Set repository topics:**
```
PUT /repos/{owner}/{repo}/topics
Header: Accept: application/vnd.github+json
Body: { "names": ["topic1", ...] }
```
Docs: `https://docs.github.com/en/rest/repos/repos#replace-all-repository-topics`
Limits: max 20 topics, each ≤50 chars, lowercase alphanumeric + hyphens only.

```bash
# Derive from analysis.topics + language + "explainer" + "repo-explainer"
TOPICS=$(node -e "
  const a = JSON.parse(require('fs').readFileSync('./kb-output/repo-analysis.json', 'utf8'));
  const t = (a.topics || [])
    .map(s => s.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').slice(0,50))
    .filter(Boolean).slice(0, 18);
  t.push('explainer', 'repo-explainer');
  process.stdout.write(JSON.stringify(t));
")
gh api "repos/${EXPLAINER_REPO}/topics" \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input <(node -e "process.stdout.write(JSON.stringify({names: ${TOPICS}}))")
```

**Social preview image — CONFIRMED NOT AVAILABLE VIA API.**
Researched against GitHub's REST API, GraphQL `updateRepository` mutation, and community
issues (#32166, #49928, #52294, #172072 — most recent September 2025). There is no
documented endpoint. The `AnswerDotAI/gh-social-preview` tool reverse-engineers undocumented
internal endpoints — fragile, breaks on GitHub UI changes, rejected for this pipeline.

The social preview image (shown when sharing the repo URL on social media) can only be set
via the web UI at `Settings > General > Social preview`.

**What we do instead (maximally effective within API constraints):**
- The explainer REPO's `README.md` opens with the hero image
  `![{repoName} explainer](https://{LIVE_URL}/assets/img/hero.png)` — visible in GitHub's
  repo listing UI.
- The `homepage` field (set above) points to the live explainer URL. Anyone visiting the
  GitHub repo sees the "About" panel with the live explainer link; clicking through hits a
  page with full `og:image` metadata (the hero at 1536×1024).
- For high-traffic repos: document the manual step (upload hero.png via
  Settings > Social preview). This is a one-time 30-second UI action, not a pipeline step.

**This is the higher-value SEO surface anyway:** when someone shares the explainer URL
(`{repo}.repoexplainer.isovision.ai`) on Twitter/LinkedIn, the OG card shows the hero image
and the description. That's more discoverable than the GitHub repo's social card.

**Phase 7 implementation addition (after existing git push):**

```yaml
- name: "Phase 7: Set GitHub repo SEO metadata"
  env:
    GITHUB_TOKEN: ${{ secrets.GH_PAT }}
  run: |
    gh api "repos/${EXPLAINER_REPO}" -X PATCH \
      -F description="Visual explainer for ${TARGET_OWNER}/${TARGET_REPO}" \
      -F homepage="${LIVE_URL}" \
      || echo "::warning::Could not update repo description/homepage"

    TOPICS=$(node -e "
      const a = JSON.parse(require('fs').readFileSync('./kb-output/repo-analysis.json','utf8'));
      const t = (a.topics||[])
        .map(s=>s.toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,50))
        .filter(Boolean).slice(0,18);
      t.push('explainer','repo-explainer');
      process.stdout.write(JSON.stringify(t));
    ")
    printf '{"names":%s}' "$TOPICS" | \
      gh api "repos/${EXPLAINER_REPO}/topics" -X PUT \
        -H "Accept: application/vnd.github+json" \
        --input - \
      || echo "::warning::Could not set repo topics"
```

(Warning-only — topics/description failure must not block the build; the explainer is already
deployed and live.)

---

### D11 — Ownership model: per-build repo, collaborator invite, hosting stays with Stuart

**Decision (clarifies Phase 7):** each submitted URL produces exactly one new GitHub repo
(`stuinfla/{repo}-explainer`, under Stuart's `stuinfla` org). The target repo's owner is
invited as a **push collaborator** on that explainer repo — they can fork it, clone it, edit
it, redeploy it anywhere. They do NOT get ownership of the Vercel hosting.

- **Showcase URL** (`{repo}.repoexplainer.isovision.ai`) lives on Stuart's Vercel team
  (`sikerr-6092`). The hosting is Stuart's; the URL is his domain. The explainer owner can
  always self-host by cloning their explainer repo and deploying independently.
- **Collaborator invite is best-effort** (workflow line 155: `|| echo "::warning::"`). If the
  target repo owner has a GitHub username that doesn't match the URL owner (org repos, bots),
  the invite silently warns. This is acceptable; the explainer repo is still public and
  findable.
- **Why `stuinfla` org, not personal account:** keeps explainers separated from personal repos,
  makes batch housekeeping possible (all explainer repos in one org), and signals that the
  repo is an auto-generated artifact, not a personally-maintained project.

This model is already implemented in the current workflow. No code change needed. The
architecture section is for clarity only.

### Follow-ups

| # | Item | Priority |
|---|------|----------|
| 1 | Implement migration checklist (D1 landing isolation + D7 DNS) before public launch | Critical |
| 2 | Fix all README misrepresentations (Phase 2 claims, Gate D/E names, studio, Resend, PR badge) | Critical |
| 3 | Implement Phase 5.5 (NotebookLM studio) on a self-hosted Mac runner (Path A in D4) | High |
| 4 | Implement D4.5 asset embedding (audio `<audio>`, PDF.js slides, video via GitHub Release) | High |
| 5 | Split Gate D into D-Security (current code) + D-Studio (checks studio asset presence) | High |
| 6 | Implement favicon generation in Phase 5 (D9) — 4th gpt-image-1 call + ImageMagick resize | High |
| 7 | Implement SEO Phase 4 additions (D10a): meta/OG/Twitter/JSON-LD/canonical/sitemap/robots.txt | High |
| 8 | Implement GitHub repo SEO in Phase 7 (D10b): `PATCH /repos/…` + `PUT /repos/…/topics` | High |
| 9 | Add descriptive alt text to all Phase 5-generated images (current: missing or empty) | High |
| 10 | Add durable rate limiting (replace in-memory Map with Gist-based check or Vercel KV) | Medium |
| 11 | Add housekeeping cron to archive/delete Vercel projects older than 90 days | Medium |
| 12 | Add cost gate for Phase 4/5 API calls if build volume grows beyond ~50/day | Medium |
| 13 | Optionally add an RVF vector KB step in Phase 2 to ground Phase 4 content in semantic retrieval | Medium |
| 14 | Document GitHub social preview as a manual step for high-traffic repos (UI-only, D8b) | Low |
| 15 | Add `GEMINI_API_KEY` as documented opt-in alternative for image generation (D5) | Low |
| 16 | Write a Repo-Explainer DDD paired with this ADR | Low |

---

## Validation / Proof Points (What Is Actually Proven)

The following were verified against real artifacts before this ADR was written:

- End-to-end pipeline run: all 9 phases green, ~2–2.5 min (HANDOFF.md).
- Vercel deploy: project linked, URL captured, smoke test 200, public access confirmed.
- Images: hero.png at 1536x1024, gallery populated, all HTTP 200.
- Email: Gmail SMTP path tested live from `stuart@isovision.ai`.
- GitHub repo: `stuinfla/{repo}-explainer` created public.
- Quality gates A–E: all pass on the 5 existing examples.

What was NOT proven:
- Multiple concurrent builds (overwrite trap never tested with ≥2 builds in flight).
- Per-build Vercel project isolation (not yet implemented).
- Custom domain resolution (Cloudflare DNS record not yet added).
- Studio artifacts from the automated pipeline (do not exist; manually produced only).
- Durable rate limiting across serverless instances.
