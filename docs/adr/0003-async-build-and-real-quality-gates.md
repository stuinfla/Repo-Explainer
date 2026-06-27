# ADR-0003: Async Build Model, Build Process Architecture, Real Quality Gates, Durable Job Queue, Per-Build Vercel Isolation

**Version:** 1.0.0
**Created:** 2026-06-26
**Status:** Proposed
**Depends-on:** ADR-0002 (confirms D1 per-build Vercel isolation; extends D4 studio runner decision; replaces the fake quality-gate system)
**Supersedes:** nothing — supplements ADR-0002 which left five decisions deferred or undecided

---

## Context

ADR-0002 established the code-grounded reality of the current Repo Explainer pipeline: a
9-phase GitHub Actions workflow dispatched by a Vercel serverless function, with status
broadcast via a public GitHub Gist polled by the browser every 5 seconds. That ADR documented
the overwrite trap (single shared `VERCEL_PROJECT_ID`), the studio gap (no NotebookLM step in
the automated pipeline), and five aspirational quality gates that are structurally wrong.

ADR-0002 did NOT decide:

1. Whether ASYNC + EMAIL or live-watch is the primary UX contract with the user.
2. Whether the build should be ONE COHERENT process on a self-hosted runner or the current
   fragmented GitHub Actions model.
3. What the real quality gate system looks like (vision-graded, KB-grounded, asset-playback,
   live-page screenshot grade).
4. What durable job queue and concurrency model handles dozens of concurrent users.
5. How per-build Vercel project isolation is specifically implemented (confirmed in ADR-0002 D1
   but migration left to a checklist item).

This ADR decides all five. Each decision references the specific code it contradicts or extends.

---

## Five Decisions

---

### Decision 1 — ASYNC + EMAIL is the primary UX contract; live-watch is a bonus

**Status:** Accepted

#### What the current code does

`www/main.js:25-35` defines `PIPELINE_STEPS` and starts polling immediately on form submit.
`www/main.js:317` sets `MAX_WAIT_MS = 15 * 60 * 1000` — a hard 15-minute browser-session
timeout. `www/main.js:319` sets `STALE_THRESHOLD_MS = 3 * 60 * 1000` — shows "Build appears
stuck" if the step counter does not advance within 3 minutes. `www/main.js:413-425` implements
exponential backoff with `MAX_CONSECUTIVE_ERRORS = 10` before showing "Lost connection."

The email is collected at submission but used only in Phase 9 (`build-explainer.yml:259`) as a
secondary notification after success. The primary model is: user keeps the browser tab open and
watches.

#### Why the live-watch-first model is the wrong primary contract

The live-watch model has five distinct failure surfaces that produce a bad user experience even
when the pipeline succeeds:

1. **Tab closed or phone locked.** If the user closes the tab between submission and the 15-min
   timeout, the session is gone. Phase 9 sends an email, but the user never saw their success
   panel. The success state is lost from the user's perspective.
2. **Stale false-positive (`main.js:365-368`).** GHA jobs sit in the queue before picking up.
   Setup (Phase 0) can take 30-60s of queue wait before the runner even starts. During that
   wait, `currentStep` stays at 0. If the queue wait exceeds 3 minutes (common under load),
   the stale detector fires and shows "Build appears stuck" — even though the build is about
   to succeed.
3. **Network errors during a 3-minute build.** `main.js:414-424` starts exponential backoff
   on any fetch error. If the user's Wi-Fi drops for 60 seconds mid-build, the backoff reaches
   20s delay and they see a degraded "Lost connection" UI. The build is still running fine.
4. **Hard 15-minute timeout.** GHA queue delays mean a 3-minute build can hit the 15-minute
   browser timeout on a congested runner. `main.js:343-346` shows "Build timed out" — the user
   gives up and retries, doubling the load.
5. **Phase 9 email is conditional (`build-explainer.yml:259`).** The condition is
   `inputs.submitter_email != '' && env.HAS_GMAIL == 'true'`. If `GMAIL_APP_PASSWORD` is not
   set in secrets, the email step silently skips (`HAS_GMAIL` is `false`). The user who left
   the tab open and hit the stale timeout has no fallback delivery channel.

#### Decision

**Email is the reliability contract. The build completes and emails the user. The browser UI
is a bonus progress view that must degrade gracefully when the tab is closed or the connection
drops.**

Concrete changes to current code:

1. **Email is required at submission, not optional.** `www/index.html` form collects email as
   a `required` field. `www/api/build.js:185` currently sets `submitter_email` only `if (email
   && ... email.includes('@'))` — change this to return HTTP 400 if email is missing or invalid.
   The UX copy changes to: "We'll email you when your explainer is ready (usually 3-5 minutes)."

2. **API response does not start a live poll.** `www/api/build.js:214-223` currently returns
   `{ buildId, statusUrl, gistId, repoName }`. It continues to return `statusUrl` and `gistId`
   — but `www/main.js` treats them as optional. On submit, the UI shows a confirmation panel:
   "Building your explainer — we'll email you at {email} when it's ready. You can also track
   progress here: {statusUrl}" with an optional "Track progress" button that opens the polling
   view. The poll is NOT started automatically.

3. **Phase 9 email is unconditional.** `build-explainer.yml:259` changes from
   `if: inputs.submitter_email != '' && env.HAS_GMAIL == 'true'` to
   `if: inputs.submitter_email != ''`. `GMAIL_APP_PASSWORD` missing is a configuration error
   that blocks builds from going out — it is not a "gracefully skip" condition. The workflow
   must fail loudly if email cannot be sent when an email was promised. Add a pre-flight check
   at Phase 0 that asserts `GMAIL_APP_PASSWORD` is set when `submitter_email` is non-empty.

4. **Stale detection is removed from the polling path.** The `STALE_THRESHOLD_MS` check
   (`main.js:365-368`) is removed. Stale detection is now server-side: the failure handler
   (`build-explainer.yml:277-283`) fires on actual GHA job failure. The client polling UI shows
   elapsed time only; it does not make reliability promises on behalf of the build.

5. **Hard timeout extended to 30 minutes.** `main.js:317` `MAX_WAIT_MS` changes from
   `15 * 60 * 1000` to `30 * 60 * 1000`. This is for the OPTIONAL live-watch panel only. The
   email is always sent when the build completes or fails regardless of whether the user is
   watching.

6. **Failure email is mandatory.** Phase 9 sends a failure email when the build fails, not
   just a success email. The failure handler at `build-explainer.yml:277-283` currently only
   updates the Gist. Add a `node scripts/phase9-send-email.mjs` call in the failure handler
   with a failure-specific template: "Your Repo Explainer build for {repo} failed. We're
   looking into it. You can try again at {landing_url}."

#### Consequences

**Positive:**
- User who closes the tab immediately after submission still receives results.
- Stale false-positives eliminated from the UX.
- Email becomes the auditable delivery channel (Gmail sent log = proof of delivery).

**Negative:**
- Email is now required to use the service — anonymous submissions are not possible.
- `GMAIL_APP_PASSWORD` becomes a hard dependency; a misconfigured email secret blocks all
  builds. Mitigation: add a pre-flight check in the workflow (see item 3 above) that catches
  misconfiguration before the 5-minute build runs.

---

### Decision 2 — Build process architecture: GHA for core phases; self-hosted runner as an additive studio job

**Status:** Accepted

#### The honest tradeoff

The prompt asks why not ONE coherent process on a self-hosted runner. The answer requires an
honest capability/availability tradeoff.

**Arguments for ONE coherent process on a self-hosted runner (Stuart's Mac):**

- The `nlm` CLI (`/opt/homebrew/bin/nlm`) works on the Mac today and produced the 5 existing
  studio examples. Running all phases on the Mac eliminates the "no Chrome on ubuntu-latest"
  blocker for Phase 5.5.
- A single process is easier to instrument: one log stream, one exit code, one retry unit.
  The current 9 GHA steps produce 9 separate log panes with no unified view.
- A self-hosted worker can implement a real durable queue (SQLite file) and process multiple
  jobs concurrently with rate limiting per-phase, rather than relying on GHA's opaque
  concurrency model.
- Vision-graded quality gates (Decision 3) require Playwright or agent-browser for the live-
  page screenshot. Both are trivially available on the Mac; installing Playwright on ubuntu-
  latest adds 45-90s per build.

**Arguments against ONE coherent process on a self-hosted runner (the blockers):**

- **Availability.** Stuart's Mac must be online, awake, and healthy for every build to
  succeed. A Mac restart, a sleep timer, a disk-full state, or a Chrome update that logs out
  the Google session will fail every queued build simultaneously. This directly violates
  "MUST work every time."
- **Scale.** Dozens of concurrent users requires concurrent build workers. The Mac can handle
  2-3 concurrent builds (memory and API call budgets) but not dozens. GHA ubuntu-latest scales
  horizontally to GHA's runner pool with no Mac involvement.
- **Google auth expiry.** The `nlm` CLI reads Chrome session cookies for Google auth. These
  cookies expire. When they do, the studio step fails silently unless explicitly checked.
  Cookie expiry is not detectable from the GHA workflow; it requires a `nlm login --check`
  pre-flight that only makes sense on the self-hosted runner.
- **Deployment complexity.** Moving the entire pipeline off GHA and onto a self-hosted worker
  requires: a persistent HTTP endpoint for job submission (replacing `api/build.js` dispatch
  to GHA), a job queue (SQLite or Redis), worker process management (PM2 or launchd), and a
  log shipping strategy. This is weeks of work vs a one-line GHA `runs-on` change.

**The third option: GHA for core phases + self-hosted runner as a parallel studio job**

This is the recommended architecture. It keeps the proven GHA core pipeline intact and adds
the studio as a separate optional job that runs on the Mac runner:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest       # Phases 0-9: clone, KB, scaffold, content, images,
    # ...                        # quality gates, GitHub repo, deploy, notify

  studio:
    runs-on: [self-hosted, macos]
    needs: build                 # wait for deploy URL
    if: always()                 # run even if some build steps warned
    # Phase 5.5: nlm notebook create, source add, audio/video/slides,
    # download, embed, update explainer repo, redeploy
```

**Why this is better than both extremes:**

- The core pipeline (phases 0-9) runs on GHA ubuntu-latest — available 24/7, no Mac dependency,
  scales horizontally.
- The studio job runs on the Mac — uses `nlm` with real Chrome auth, no cookie-injection hack.
- If the Mac runner is offline, the studio job queues (not fails) until the runner comes online,
  or it times out with a graceful degradation: the explainer is deployed without studio artifacts,
  the user gets an email with the page URL, and a follow-up email is sent when studio artifacts
  are added (or not, with explanation).
- Studio failure never blocks the core build. Gate D-Studio (Decision 3) runs in the `studio`
  job, not in the `build` job. The user gets a working page regardless.

**Recommendation:** implement this hybrid. Keep `runs-on: ubuntu-latest` at `build-explainer.yml:39`
unchanged. Add a new `studio` job with `runs-on: [self-hosted, macos]`. Register Stuart's Mac
as a self-hosted runner on `stuinfla/Repo-Explainer`. This is the minimal change that unblocks
studio without destabilizing the proven core pipeline.

**Future consideration (not now):** if concurrent build volume exceeds GHA's free-tier limits
(2000 min/month ≈ 500-660 builds) OR if a single-process design becomes clearly superior after
the hybrid is proven, revisit ONE coherent process on a managed worker (e.g., a small cloud VM
with an `nlm`-compatible environment). Do not build the full worker infrastructure until GHA
proves insufficient — premature complexity is the failure mode to avoid.

#### Consequences

**Positive:**
- Core pipeline remains GHA ubuntu-latest — always available, zero Mac dependency for the
  10-second minimum viable product (page without studio).
- Studio is additive: the Mac's `nlm` toolchain is used without cookie injection hacks.
- Graceful degradation: Mac offline = studio queues; user still gets a working explainer.

**Negative:**
- Studio builds are serialized on one Mac runner (1 concurrent studio build at a time).
  At dozens of concurrent core builds, studio jobs will queue. This is acceptable: studio is
  a bonus that adds ~2-5 minutes per build; queuing adds latency but not failure.
- Two separate log streams (GHA build job + GHA studio job). Unified observability requires
  reading both job logs. Acceptable; both are in the same workflow run.

---

### Decision 3 — Real quality gates: vision-graded images, KB-grounded content, asset playback, live-page screenshot grade

**Status:** Accepted

#### What the current gates actually check

`scripts/phase6-quality-gates.mjs` runs five gates:

| Gate | Code label (line) | What it actually checks |
|------|-------------------|------------------------|
| A | `Gate A — Structure completeness` (line 50) | Files exist, valid HTML structure |
| B | `Gate B — Content quality` (line 84) | ≥5000 chars, project name in title/hero, ≥5/9 sections filled |
| C | `Gate C — Asset integrity` (line 119) | hero.png exists (warn-only), no broken local `<img>` srcs, no broken anchors |
| D | `Gate D — Security` (line 152) | No `eval()`, no external inline scripts, no hardcoded secrets |
| E | `Gate E — Deploy readiness` (line 179) | `vercel.json` valid object, `package.json` has `name` field |

None of these gates check:
- Whether images look good (vision quality)
- Whether content is grounded in the actual repo (not generic boilerplate)
- Whether studio assets are present and playable
- Whether the LIVE deployed page actually renders correctly for a visitor

All five gates run against the local filesystem before deployment. A build that passes all five
and deploys a broken page gets five green checkmarks and silently delivers a broken product.

#### The new gate system

The current five gates are restructured and supplemented. Gate D (security) is kept in place
because it is correct and useful — it is just renamed to stop being mislabeled as a quality
gate. Two entirely new gates (F and G) are added post-deployment.

**Gate A — Structural completeness** (unchanged)
All required files exist: `index.html`, `styles.css`, `main.js`, `vercel.json`, `package.json`.
HTML has `<!doctype>`, `<html>`, `<head>`, `<body>`. All `<!-- CONTENT:xxx -->` markers
replaced (0 remaining markers = all 9 sections filled). **Failure blocks deploy.**

**Gate B — KB-grounded content** (replaces current character count check)
The generated content must be grounded in the actual repo analysis. New checks:

1. At least 3 technology names from `repo-analysis.json`.language / `.topics` / `.symbols`
   appear verbatim in `index.html`. (Catches generic "this is a great project" boilerplate.)
2. The repo's description from `repo-analysis.json`.description appears paraphrased in the
   hero section (fuzzy match: ≥50% of non-stopword tokens from the description appear in
   the hero text).
3. No `<!-- CONTENT:xxx -->` markers remain (all 9 sections filled — this moves from Gate B
   to here from Gate A, made a hard fail here).
4. Content length ≥ 8000 chars (raised from 5000 — 5000 chars is trivially met by template
   boilerplate; 8000 chars forces meaningful section content).

Implementation: extend `phase6-quality-gates.mjs` gateB() to load `repo-analysis.json` and
run the token-matching checks. Zero new npm dependencies — regex + string matching suffices.
**Failure blocks deploy.**

**Gate C — Asset integrity** (unchanged except favicon added)
Hero, architecture, use-case, and favicon images exist in `assets/img/`. Favicon files must
be non-empty (0-byte generated images = generation failure). No broken local `<img>` srcs.
No broken internal anchors. Hero missing = warn-only (images may have been rate-limited);
favicon-32.png missing = warn-only. Broken anchors = fail. **Broken anchor fails deploy.**

**Gate D — Security** (renamed from misnamed position, otherwise unchanged)
No `eval()`, no `document.write`, no external inline `<script src="http...">` tags, no
hardcoded secrets (regex `SECRET_RE` at `phase6-quality-gates.mjs:29`). **Failure blocks deploy.**

**Gate E — Vision-graded image quality** (new; replaces "Deploy readiness" which moves to F)
For each of hero.png, architecture.png, use-case.png that exist:

1. Call OpenAI GPT-4o Vision API with the image and a structured prompt:
   ```
   Grade this image for a technical explainer website on a 1-100 scale.
   Repo name: {repoName}. Repo technologies: {topTechnologies}.
   Grade on: (a) visual quality — sharp, no artifacts, not a placeholder (40pts),
   (b) relevance — clearly related to the repo's domain, not generic stock art (30pts),
   (c) professionalism — suitable for a public-facing developer page (30pts).
   Return JSON: {"score": N, "reason": "..."}
   ```
2. Each image must score ≥ 70. Below 70 = regenerate once (retry with a more specific prompt
   appending the failure reason). Still below 70 after one retry = fail the gate.
3. The vision check uses the same `OPENAI_API_KEY` already in the pipeline (Phase 4 and 5).
   GPT-4o Vision cost is ~$0.003 per image — 3 images per build = ~$0.01 per build, negligible.

This gate runs in Phase 6 before deploy (images are on disk). **Failure blocks deploy.**

**Gate F — Deploy readiness** (content of old Gate E, same checks, renamed correctly)
`vercel.json` is a valid JSON object. `package.json` has a `name` field. `sitemap.xml` exists.
`robots.txt` exists. **Failure blocks deploy.**

**Gate G — Live-page screenshot grade** (new; runs AFTER Phase 8 deploy)
This is the most important gate for "never fails silently." It runs after `vercel deploy` in a
new Phase 8.5 step:

1. Use Playwright (installed on the self-hosted Mac runner, or on ubuntu-latest via
   `npx playwright install --with-deps chromium`) to navigate to `$LIVE_URL`.
2. Wait for `networkidle` + 3-second settle. Take a full-page screenshot.
3. Call GPT-4o Vision with the screenshot:
   ```
   This is a screenshot of a live deployed website. Grade it 1-100 for:
   (a) renders correctly — no broken layout, no error pages, no placeholder text (40pts),
   (b) images loading — hero image and section images visible, not broken icon placeholders (30pts),
   (c) professional appearance — suitable for a public-facing developer page (30pts).
   Return JSON: {"score": N, "failures": ["...", ...]}
   ```
4. Score ≥ 75 = pass. Score < 75 = the build publishes the Vercel URL to the Gist but marks
   the build as `status: "deployed_with_warnings"` rather than `status: "done"`. The email
   sent to the user includes the live URL AND a note: "Visual quality check flagged potential
   rendering issues. Please review your page."

**Why Gate G must run post-deploy:** the current smoke test at `build-explainer.yml:198-203`
checks only `HTTP 200` — it does not open a browser. A page that returns 200 but renders as
broken CSS or missing images passes the smoke test and fails the user. Gate G is the first
check that sees what the user will see.

**Implementation note:** Gate G runs as a Phase 8.5 step in the `build` GHA job. Install
Playwright in Phase 0 (adds ~45s):
```yaml
- name: "Phase 0: Install Playwright"
  run: npx playwright install --with-deps chromium
```
This avoids a Mac runner dependency for Gate G. The vision call uses the same `OPENAI_API_KEY`.

#### Studio gates (Gate H — conditional; lives in the `studio` GHA job)

**Gate H — Studio asset presence and playability** (new; only runs when studio job runs)
After Phase 5.5 downloads studio artifacts:

1. `studio/audio.mp3` exists and `du -b studio/audio.mp3` ≥ 100KB (a real audio file, not
   a 0-byte placeholder).
2. `studio/slides.pdf` exists and starts with `%PDF-` (valid PDF header check with
   `head -c 4 studio/slides.pdf`).
3. For the video: the GitHub Release asset URL resolves with HTTP 200 (curl check on the
   `gh release view` URL).

If any artifact fails Gate H, the studio job retries the specific `nlm` download once. If still
failing, the studio job marks itself failed but does NOT fail the parent `build` job (the
explainer page is already live). A follow-up email is sent: "Studio assets for {repo} could not
be generated this time. Your explainer page is live without them."

#### Gate summary table

| Gate | Name | When | Failure mode |
|------|------|-------|--------------|
| A | Structural completeness | Phase 6 (pre-deploy) | Blocks deploy |
| B | KB-grounded content | Phase 6 (pre-deploy) | Blocks deploy |
| C | Asset integrity | Phase 6 (pre-deploy) | Broken anchors block; missing images warn |
| D | Security | Phase 6 (pre-deploy) | Blocks deploy |
| E | Vision-graded images | Phase 6 (pre-deploy) | Blocks deploy after 1 retry |
| F | Deploy readiness | Phase 6 (pre-deploy) | Blocks deploy |
| G | Live-page screenshot grade | Phase 8.5 (post-deploy) | Warns user; build reported as `deployed_with_warnings` |
| H | Studio asset playability | Studio job | Warns user; studio job fails; build job unaffected |

---

### Decision 4 — Durable job queue and concurrency model

**Status:** Accepted

#### What the current code does (and why it breaks under load)

`www/api/build.js:9-25`: in-memory `rateMap` — a `Map` keyed by `owner/repo`, one entry per
submission, 1-hour window, 500-entry cap. This is the ONLY rate-limiting mechanism. It does not
survive Vercel cold starts. A new function instance has an empty Map; a determined user (or a
bot) can trigger unlimited builds by waiting for a cold start or by using a new Vercel region.

There is no queue. Each successful `api/build.js` call immediately dispatches a GitHub Actions
workflow. Ten simultaneous submissions = ten simultaneous GHA jobs = ten simultaneous Phase 4
(GPT-4o) calls = $1-2 OpenAI cost in 3 minutes with no gate.

GHA's own concurrency model: the `build-explainer.yml` workflow has no
`concurrency:` stanza, so GHA will happily run all jobs in parallel up to the runner pool
limit (20 for free tier ubuntu-latest). This is not a queue — it's uncontrolled parallelism.

#### Decision

**Short-term (implement now): Gist-based active-build registry as durable rate limit.**

The landing's `api/build.js` already has a `GITHUB_TOKEN` for Gist creation and workflow
dispatch. Use that token to maintain a single named "active builds" Gist
(a known Gist ID stored as an environment variable on the landing project,
e.g., `ACTIVE_BUILDS_GIST_ID`). This Gist contains a JSON file `active.json`:

```json
{
  "builds": [
    { "repo": "owner/repo", "buildId": "uuid", "startedAt": "2026-06-26T..." }
  ]
}
```

On each submission:
1. Fetch `active.json` from the known Gist (1 GitHub API call, authenticated = 5000/hr limit).
2. If `builds` contains an entry for `owner/repo` started within 2 hours, return HTTP 429.
3. PATCH the Gist to add the new build entry before dispatching the workflow.

On each build completion (Phase 9 success or failure handler):
4. PATCH the known Gist to remove the completed build entry.

This is durable across cold starts (Gist is server-side), requires zero new infrastructure
(uses the `GITHUB_TOKEN` already in `api/build.js`), and provides a real-time view of active
builds (the Gist is publicly readable). The race condition (two concurrent submissions for the
same repo hitting step 1 simultaneously) is acceptable at this scale — the GHA concurrency
governor (step below) catches duplicates.

**Short-term (implement now): GHA concurrency governor.**

Add a `concurrency:` stanza to `build-explainer.yml`:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    concurrency:
      group: build-${{ inputs.target_owner }}-${{ inputs.target_repo }}
      cancel-in-progress: false
```

This ensures GHA queues (not cancels) concurrent builds for the same repo. At most one
pipeline runs per `owner/repo` at any time. Duplicate submissions queue and run in order.

**Short-term (implement now): global concurrent build cap.**

Add a second concurrency group at the workflow level:

```yaml
concurrency:
  group: global-build-capacity
  max-parallel: 5
```

Note: GHA does not support `max-parallel` on workflow-level concurrency natively; this is
achievable via a `strategy.matrix` on a fan-out job, or via a simple semaphore pattern using
environment protection rules. Simpler alternative: use `concurrency.group: slot-${{ github.run_number % 5 }}`
to spread builds across 5 slots. At 5 concurrent builds × $0.15/build = $0.75 peak burst cost.
This is an acceptable cost gate without requiring infrastructure.

**Medium-term (implement when volume exceeds ~50 builds/day): SQLite worker queue.**

If GHA free minutes are exhausted or if the studio job's Mac-runner serialization becomes a
bottleneck, replace `api/build.js` dispatch with a submission to a SQLite job queue on Stuart's
Mac (or a small cloud VM). A Node.js worker process reads from the queue, runs all phases
sequentially in a child process, and posts results back via Gist. The queue table:

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  gist_id TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
```

Workers: `SELECT * FROM jobs WHERE status='pending' ORDER BY created_at LIMIT 1` with
SQLite's `BEGIN IMMEDIATE` transaction to prevent double-claiming. 3 workers = 3 concurrent
builds. Trivial to add workers on any machine. This is the architecture to build AFTER GHA
proves insufficient — not before.

**Do not build now:** Redis, SQS, Supabase queue, Vercel KV queue, or any infrastructure
requiring provisioning and ongoing cost. The Gist + GHA concurrency pattern handles dozens of
users. Build the SQLite worker only when forced by real load data.

#### Consequences

**Positive:**
- Gist-based active-build registry survives cold starts — true durable rate limiting with
  zero new infrastructure.
- GHA concurrency governor prevents duplicate same-repo builds and caps total parallelism.
- Cost is bounded: 5 concurrent builds × $0.15 = $0.75 burst maximum.

**Negative:**
- Gist PATCH for active-build tracking adds ~200ms to the submission response time.
- The Gist PATCH race condition (two simultaneous submissions) can slip through. Mitigation:
  the GHA `concurrency` stanza catches it — the second workflow is queued, not run concurrently.
- The `active.json` Gist can drift (builds that fail mid-pipeline without hitting the cleanup
  step leave stale entries). Mitigation: cleanup entries older than 6 hours in the read step.

---

### Decision 5 — Per-build Vercel project isolation: confirmed and specified

**Status:** Accepted (confirms ADR-0002 D1; adds implementation specifics and idempotency design)

#### What the current code does

`build-explainer.yml:170-171`:
```yaml
VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
```

`build-explainer.yml:176`: `vercel pull --yes --environment=production --token "$VERCEL_TOKEN"`

`build-explainer.yml:182`: `vercel deploy --prod --yes --token "$VERCEL_TOKEN"`

These three lines tie every build to a single Vercel project (`prj_KbSbSjdTfeGzW6x4O2TftTU8jXi1`).
Every `--prod` deploy overwrites that project's production URL. The landing page and every
generated explainer share this single project. Build 2 clobbers build 1's result URL. This is
the overwrite trap documented in ADR-0002.

#### Decision

**Each build creates or reuses a per-repo Vercel project named `{repo}-explainer`.**

The Phase 8 deploy step changes to:

```yaml
- name: "Phase 8: Deploy to Vercel"
  env:
    VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
    VERCEL_TEAM: sikerr-6092
  run: |
    npm i -g vercel@latest
    cd explainer-site
    # No vercel pull — no pre-linked project. vercel deploy creates the project
    # by name on first run; on subsequent runs for the same repo it deploys to
    # the existing project, keeping the URL stable.
    set +e
    DEPLOY_OUT=$(vercel deploy --prod --yes \
      --name "${TARGET_REPO}-explainer" \
      --scope "$VERCEL_TEAM" \
      --token "$VERCEL_TOKEN" 2>deploy.err)
    DEPLOY_RC=$?
    set -e
    # ... rest of URL parsing and alias assignment unchanged
```

Remove from `build-explainer.yml` env block (lines 170-171): `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID`. Remove `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` from the workflow's
`secrets` references. Remove `vercel pull` (line 176) — it requires a linked project and
is unnecessary when creating by name.

**Idempotency:** `vercel deploy --name {repo}-explainer` with `--scope sikerr-6092` creates a
new Vercel project on first build. On a second build for the same repo (after rate-limit
expiry), Vercel matches the project by name and deploys to it — the URL is stable and the
second deploy updates the page. This is the correct behavior: re-runs update the same explainer
rather than proliferating projects.

**Landing page isolation:** the landing page (`www/`) must be linked to a separate Vercel
project (e.g., `repo-explainer-landing`) before any public rollout. This is a one-time
setup step: `cd www && vercel link` to create a new project, configure git integration for
the `www/` subdirectory, and set `GITHUB_TOKEN` as an environment variable on the landing
project. After this step, `VERCEL_PROJECT_ID` in the pipeline workflow can be removed without
affecting the landing.

**Project accumulation housekeeping:** each unique repo name creates one Vercel project.
Projects accumulate. On Vercel's Pro plan (team `sikerr-6092`), the project limit is high
(200+ on Pro). Add a housekeeping cron (GitHub Actions `schedule:` trigger, monthly) that
lists Vercel projects via API, filters for projects named `*-explainer` with last deployment
older than 90 days, and deletes them.

#### Consequences

**Positive:**
- Each explainer URL is permanent and scoped to its repo. No build can overwrite another.
- The landing page is never touched by pipeline builds.
- Re-submissions for the same repo update the same project — one stable URL per repo.

**Negative:**
- `VERCEL_PROJECT_ID` removal means `vercel pull` can no longer be used to pull
  project-level environment variables (currently there are none — Phase 8 injects all
  env via CLI flags and `$GITHUB_ENV`). No regression.
- Project naming: if `{repo}-explainer` collides with a user's own Vercel project of the
  same name on the `sikerr-6092` team, the deploy targets their project. Mitigation: use
  a prefix, e.g., `re-{repo}-explainer` (re = Repo Explainer). Check: no existing projects
  use this prefix on the team.

---

## Failure Handling (cross-cutting)

The failure model must satisfy: the user is NEVER left without information.

**Pipeline failure (any GHA step exits non-zero):**
- `build-explainer.yml:277-283` failure handler fires: updates Gist to `status="failed"`.
- NEW: failure handler also calls `phase9-send-email.mjs` with a failure template (see
  Decision 1, item 6). The email includes: what failed, a retry link, and support contact.
- The Gist update means any user who is watching the optional progress UI sees the failure
  panel immediately.

**Gist unreachable (GitHub API down):**
- `update-gist-status.sh` will fail, causing the phase to exit non-zero, triggering the
  failure handler, which also fails (Gist still unreachable). The user receives no Gist update.
- Mitigation: the email (Decision 1) is independent of Gist reachability — `phase9-send-email.mjs`
  speaks SMTP directly to `smtp.gmail.com:465` (no GitHub API dependency). If Gist fails but
  email succeeds, the user gets a result. The reverse (Gist up, email down) is the scenario
  the Gist was designed to handle — the user can poll the status URL.
- Do not treat Gist failure as a build failure. Change `update-gist-status.sh` to use
  `|| true` (warn, not fail) so a Gist API blip does not abort a successful build.

**Vision gate failure (Gate E or G):**
- Gate E: images are regenerated once with a more specific prompt before failing. The retry
  adds ~50s to build time (one more `gpt-image-1` call). If the retry fails the gate, the
  build stops and the user is emailed: "Image quality check failed — the generated images
  did not meet the visual standard. Please try again."
- Gate G: the build is marked `deployed_with_warnings` — the live URL is still emailed to
  the user with a caveat. The user can visit the page and judge for themselves.

**Studio job failure (GHA studio job):**
- The `build` job is already complete and the explainer is live when the `studio` job runs.
- Studio failure emits a `::warning` and sends a follow-up email: "Studio assets could not
  be generated for {repo} this time. Your explainer is live without them."
- The `studio` job's failure does NOT set the Gist to `status="failed"` — the Gist was
  already updated to `status="done"` by Phase 9 in the `build` job.

**Mac runner offline (studio job only):**
- GHA queues the `studio` job until the runner is available, for up to the workflow timeout
  (6 hours by default). If the runner never comes online within 6 hours, the job times out.
- The `build` job is complete; the user already has their page. The studio timeout is a
  silent degradation (no studio, no follow-up email from the timeout itself).
- Mitigation: add a 30-minute timeout to the `studio` job (`timeout-minutes: 30`). On timeout,
  the failure handler in the studio job sends the "studio could not be generated" email.

---

## Migration Order (verifiable; do in sequence)

Each step has a specific verify command. Do not proceed to the next step without running it.

### Step 1 — Implement Decision 1 (async + email UX)
- [ ] `www/index.html`: make email field `required`.
- [ ] `www/api/build.js:185`: return HTTP 400 if `email` is missing or fails basic `@` check.
  **Currently:** `if (email && typeof email === 'string' && email.includes('@')) { workflowInputs.submitter_email = email }` — it silently omits email.
  **Change to:** validate email is present and valid; if missing, return `{ error: "Email is required" }`.
- [ ] `www/main.js`: change submission handler to show confirmation panel rather than start
  automatic polling. Add "Track progress (optional)" button.
- [ ] `build-explainer.yml:259`: remove `&& env.HAS_GMAIL == 'true'` condition. Add a Phase 0
  pre-flight step that exits 1 with a clear error if `GMAIL_APP_PASSWORD` is unset.
- [ ] Add failure email: in the failure handler (`build-explainer.yml:277-283`), call
  `node scripts/phase9-send-email.mjs` with `EMAIL_SUBJECT="Build failed for {repo}"` and
  a failure-specific body.
- **Verify:** submit a test build with a real email. Close the browser immediately. Confirm the
  email arrives within 5 minutes of build completion. Confirm the build Gist shows `done`.

### Step 2 — Implement Decision 5 (per-build Vercel isolation)
- [ ] Create a new Vercel project for the landing: `cd www && vercel link` → new project
  `repo-explainer-landing`. Set `GITHUB_TOKEN` env var on it.
- [ ] Remove `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` from `build-explainer.yml` env block
  (lines 170-171). Remove `vercel pull` (line 176).
- [ ] Change Phase 8 deploy command to:
  `vercel deploy --prod --yes --name "${TARGET_REPO}-explainer" --scope "$VERCEL_TEAM" --token "$VERCEL_TOKEN"`
- [ ] Add `VERCEL_TEAM: sikerr-6092` to the Phase 8 step env.
- **Verify:** trigger a test build. Confirm: (a) a new Vercel project named `{repo}-explainer`
  appears on the `sikerr-6092` team, (b) the landing project URL still serves the form,
  (c) the new project URL serves the explainer. Trigger a second build for the same repo;
  confirm it deploys to the same project (no new project created).

### Step 3 — Implement Decision 4 (durable rate limit)
- [ ] Create the "active builds" tracking Gist (one-time setup). Save its ID as
  `ACTIVE_BUILDS_GIST_ID` env var on the landing Vercel project.
- [ ] Modify `www/api/build.js`: replace the in-memory `rateMap` (lines 9-25) with a Gist-read
  check: fetch `active.json` from `ACTIVE_BUILDS_GIST_ID`, check for existing entry for
  `owner/repo` within 2 hours, PATCH to add entry on acceptance.
- [ ] Add `build-explainer.yml` `concurrency:` stanza on the `build` job (per-repo group).
- [ ] Add Phase 9 / failure handler Gist PATCH to remove the build entry from `active.json`.
- **Verify:** submit two builds for the same repo in rapid succession. Confirm: (a) second
  submission returns 429, (b) after the first build completes, `active.json` no longer
  contains that repo entry, (c) a new submission for the same repo is accepted.

### Step 4 — Implement Decision 3 (real quality gates — Gates B, E, F, G)
- [ ] **Gate B:** extend `phase6-quality-gates.mjs` gateB() to load `repo-analysis.json` and
  check technology token overlap with `index.html`. Raise character minimum to 8000.
- [ ] **Gate E:** add a new gateE() function in `phase6-quality-gates.mjs` that calls OpenAI
  Vision API for each of hero.png, architecture.png, use-case.png. Implement one-retry logic.
  The current gateE() (deploy readiness checks) becomes gateF().
- [ ] **Gate F:** rename current gateE() to gateF(). Add `sitemap.xml` and `robots.txt`
  existence checks.
- [ ] **Gate G:** add a `scripts/phase8.5-live-grade.mjs` script that uses Playwright to
  screenshot `$LIVE_URL` and calls OpenAI Vision. Add Phase 8.5 step in `build-explainer.yml`
  after the Phase 8 deploy step.
- [ ] Add `npx playwright install --with-deps chromium` to Phase 0 in `build-explainer.yml`.
- **Verify:** run a complete build. Confirm Gates A-G each appear in the Phase 6 log output.
  Confirm Gate G runs after deploy and logs a score. Trigger a build with a deliberately
  minimal generated page (e.g., mock a stub `index.html` via the analysis) and confirm Gate B
  fails with a specific error message.

### Step 5 — Implement Decision 2 (self-hosted runner for studio)
- [ ] Register Stuart's Mac as a self-hosted runner on `stuinfla/Repo-Explainer` repository
  (Settings → Actions → Runners → New self-hosted runner).
- [ ] Run `nlm login --check` on the Mac to confirm the Google session is valid.
- [ ] Write `scripts/phase5.5-build-studio.mjs` implementing the `nlm` workflow:
  `nlm notebook create` → `source add` (GitHub URL + generated `index.html`) →
  `nlm audio/video/slides create` → poll for completion → `nlm download` → upload video
  to GitHub Release via `gh release upload`.
- [ ] Add `studio:` job to `build-explainer.yml` with `runs-on: [self-hosted, macos]`,
  `needs: build`, `timeout-minutes: 30`.
- [ ] Add Gate H checks in the studio job.
- [ ] Add studio-failure email in the studio job's failure handler.
- **Verify:** trigger a build and wait for the `studio` job to run on the Mac. Confirm
  `studio/audio.mp3`, `studio/slides.pdf` are deployed to the Vercel project. Confirm
  a GitHub Release named `studio-latest` contains the MP4. Confirm the live page has an
  inline `<audio controls>` element and a PDF.js slide viewer.

### Step 6 — PROVE IT: two concurrent watched builds
- Trigger two builds simultaneously for different repos.
- Watch both GHA workflows AND both landing-page polling UIs.
- Confirm: both complete, both emails arrive, both Vercel projects are distinct, neither
  overwrites the other, the landing form is still live throughout.
- This step is not complete until both emails are received and both live URLs serve the
  correct page.

---

## Considered Alternatives

### Alt 1 — ONE coherent process on a self-hosted Mac (rejected for current phase)

Run all phases as a single Node.js process on Stuart's Mac, triggered by an HTTP POST to a
local server. GitHub Actions becomes a thin queue/trigger only. Arguments: unified logs,
`nlm` access, Playwright available, no 9-step fragmentation.

**Rejected for now because:** Mac availability is a hard dependency. A sleeping Mac fails
all builds simultaneously. The core pipeline (Phases 0-8 without studio) works reliably on
GHA ubuntu-latest today and handles horizontal scale. Moving it to the Mac sacrifices
cloud availability for a "coherent process" benefit that does not justify the risk at this
stage. Revisit when GHA proves insufficient.

### Alt 2 — Cookie injection for nlm on ubuntu-latest (rejected)

Export Chrome session cookies for `studio@sikerr.com` (or `sikerr@gmail.com`) as a JSON
blob, store in GitHub Secrets, write to `~/.notebooklm-mcp-cli/profiles/default` on the
runner before invoking `nlm`. This enables studio on ubuntu-latest without a self-hosted
runner.

**Rejected because:** Google session cookies expire on a schedule that cannot be predicted
from the build pipeline. When cookies expire, every studio build fails silently (nlm exits
non-zero with a generic auth error, not a cookie-expiry message). The failure is invisible
until a user submits a build and waits. Cookie refreshing requires a manual login action.
This is a hidden operational burden with a silent failure mode — the inverse of "never fails
silently."

### Alt 3 — Remove email requirement; keep live-watch as primary (rejected)

Keep the current model. Anonymous submissions. Live-watch is the primary UX. Email is
optional.

**Rejected because:** the live-watch failure surfaces enumerated in Decision 1 produce bad
user experiences even when the build succeeds. Email as the contract makes the service work
for mobile users, users on slow connections, and users who simply don't want to stare at a
progress bar for 3 minutes. The email constraint (requires a valid email) is a feature —
it provides a delivery address for the result and a spam-prevention mechanism.

### Alt 4 — Vercel KV for durable rate limiting instead of Gist (deferred)

Use Vercel KV (Redis-backed, available as a Vercel addon on the pro plan) to store active
build state. Atomic `SET NX` prevents the race condition in the Gist PATCH approach.

**Deferred:** Vercel KV requires provisioning the addon on the landing project and adds a
cost line item ($0.20/GB-month, negligible but non-zero). The Gist approach uses only the
`GITHUB_TOKEN` already in `api/build.js` and is sufficient at current scale (dozens of
builds/day, not thousands). Revisit when the Gist race condition causes observable duplicate
builds in production.

---

## Consequences Summary

| Decision | Primary benefit | Primary cost |
|----------|-----------------|--------------|
| 1: Async + email | Eliminates live-watch failure surface | Email required; GMAIL_APP_PASSWORD is a hard dependency |
| 2: GHA core + self-hosted studio | Studio works; core pipeline stays cloud-available | Studio serialized on one Mac; two log streams |
| 3: Real quality gates | Vision-graded output; live-page validation | +$0.01-0.04/build (Vision API); +45s (Playwright install) |
| 4: Gist rate limit + GHA concurrency | Durable rate limiting; bounded parallelism | +200ms submission latency; Gist drift risk |
| 5: Per-build Vercel projects | No overwrite trap; permanent URLs per repo | Project accumulation; `vercel pull` removed |

---

## What Is NOT Proven by This ADR

- That Gate G (live-page vision grade) produces consistent scores across different repos and
  design aesthetics. The 75/100 threshold is a starting estimate; it must be calibrated against
  the 5 existing hand-curated examples (which are the quality bar) before the gate is enforced.
- That the Mac self-hosted runner sustains studio builds without Google auth expiry for more
  than 30 days. A scheduled `nlm login --check` cron (daily) must be added to detect expiry
  before it causes build failures.
- That `vercel deploy --name {repo}-explainer --scope sikerr-6092` correctly creates and reuses
  projects as described. This must be verified with a real build in Step 2 above before
  proceeding to Steps 3-5.
