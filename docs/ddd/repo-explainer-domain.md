# Repo Explainer — Domain-Driven Design Model

**Version:** 2.1.0
**Created:** 2026-06-26
**Updated:** 2026-06-26
**Status:** Accepted — authoritative. Supersedes v1.0.0 (paired with ADR-0002 alone).
**Paired ADRs:**
  - `docs/adr/0002-repo-explainer-architecture.md` v1.0.0 (code-grounded reality)
  - `docs/adr/0003-async-build-and-real-quality-gates.md` v1.0.0 (five decisions)
  - `docs/adr/0004-cloud-build-engine.md` v1.1.0 (the corrected cloud engine spec — governs where this doc conflicts with v1.0.0)

---

## How to Read This Document

Section 2 is the vocabulary contract. Section 3 maps the 13 bounded contexts and their
relationships. Section 4 is the Build aggregate state machine — the spine of the system —
including the QualityRefinement loop and Studio quarantine sub-flow. Section 5 gives
aggregates and value objects per context. Section 6 is the full domain event catalogue.
Section 7 covers idempotency, retry, and compensation per station. Section 8 defines the
ACL interfaces for every external system. Section 9 names the three hardest invariants.
Section 10 lists operational invariants. Section 11 is the target directory layout.

---

## 1. Purpose

Repo Explainer is a public cloud service: a visitor submits a public GitHub repository URL
and an email address; the system produces, via a fully-cloud pipeline of ordered stations,
a polished visual explainer page with embedded multimedia and a downloadable AI Knowledge
Pack, hosted at `{repo}.repoexplainer.isovision.ai`, backed by a dedicated ExplainerRepo
with the TargetRepo's owner invited as collaborator. The submitter is notified by email when
done — success (live URL + repo URL + download link) or failure (honest description + retry
link).

**The three non-negotiable design constraints:**

- **Async + email is the reliability contract.** The visitor submits and walks away. No
  live-watch tab is required to receive the result. Email is always sent.
- **Never fail silently.** Every failure at every station MUST surface to the submitter
  by email AND to the status channel by patch. A Build that leaves the StatusChannel in
  `running` state permanently is a defect.
- **The refine loop closes the gap.** A Build is not complete until both mobile (~390px)
  and desktop (~1440px) vision-graded screenshots of the LIVE page pass the quality bar.
  The loop is real; it is not a one-shot gate.

---

## 2. Ubiquitous Language

| Term | Definition |
|------|------------|
| **TargetRepo** | The public GitHub repository submitted for explanation (`{owner}/{repo}`). |
| **TargetOwner** | The GitHub user or organisation that owns the TargetRepo. |
| **ExplainerRepo** | The new public GitHub repository created to host the explainer (`stuinfla/{repo}-explainer`). Entirely distinct from TargetRepo — never conflate them. |
| **Build** | One end-to-end execution of the explainer pipeline. The central aggregate root. Identified by a UUID (BuildId). A Build is one durable job record; all stations append evidence to it. |
| **BuildId** | A UUID generated at submission time. The correlation key across all systems, stations, and async boundaries. |
| **Station** | One named, ordered step in the Build pipeline. The 11 stations are: (1) UNDERSTAND, (2) AUTHOR, (3) VISUALS, (4) FAVICON, (5) STUDIO, (6) ASSEMBLE+KNOWLEDGEPACK, (7) SEO, (8) DEPLOY, (9) QUALITY+REFINE, (10) PUBLISH, (11) NOTIFY. DEPLOY (8) precedes QUALITY+REFINE (9) because QA must screenshot the LIVE page. Each station writes a pass/fail verdict with positive evidence to the durable job record before advancing. |
| **StationEvidence** | The positive proof that a Station completed correctly: specific file paths, HTTP status codes, vision-grade scores, token counts. A Station that advances without evidence is a defect. |
| **StatusChannel** | The GitHub Gist (identified by GistId) used to broadcast Build progress to the polling client and record the final result. It is the client-visible view of the Build state. |
| **GistId** | The GitHub Gist identifier provisioned at submission time. Passed into the pipeline as a correlation key alongside the BuildId. |
| **RVFKnowledgeBase** | The RuVector/RVF binary vector knowledge base built from the TargetRepo in Station 1 (UNDERSTAND). Contains semantic passages, symbol table, and manifest data, indexed for HNSW retrieval. NOT a plain JSON file — all semantic grounding flows through RVF retrieval. |
| **ExplainerSite** | The generated static web site — HTML, CSS, JS, images, embedded studio assets, sitemap, robots.txt, and the downloadable Knowledge Pack download section — deployed to Vercel and committed to the ExplainerRepo. |
| **ContentSlot** | A named placeholder (`<!-- CONTENT:xxx -->`, `<!-- SEO:head -->`, `<!-- STUDIO:audio -->`, `<!-- STUDIO:slides -->`, `<!-- STUDIO:video -->`, `<!-- KPACK:download -->`) in the ExplainerSite scaffold. A Build is invalid if any ContentSlot remains unfilled in the delivered ExplainerSite. |
| **MediaBundle** | The set of AI-generated images produced in Station 3 (VISUALS): hero (1536×1024 widescreen), architecture (1024×1024), use-case (1024×1024). Primary engine: gpt-image-2. Alternatives: imagen-4.0-ultra, gemini-3-pro-image. `gpt-image-1` is retired. 1536×1024 is the only landscape size gpt-image-2 accepts; 1792×1024 is a DALL·E-3 size and is rejected by the API. |
| **Favicon** | A fourth image produced in Station 4 (FAVICON), derived from the hero's visual identity (prompt includes hero palette, shape language, primary motif). Generated at 1024x1024, resized to 32x32 and 192x192. Never a generic icon. |
| **StudioBundle** | NotebookLM artifacts produced in Station 5 (STUDIO): audio overview (MP3), explainer video (MP4), slide deck (PDF). Produced by the CloudBrowserWorker running headless Chrome with a Google-authed session. Optional — Build succeeds without it if the worker is unavailable. |
| **StudioQuarantine** | The design boundary isolating Station 5. If the CloudBrowserWorker fails, times out, or returns partial artifacts, the Build continues from StudioDeferred; the failure never propagates to the Build terminal state. The studio can be added asynchronously later. |
| **CloudBrowserWorker** | The headless Chrome process + Google auth session that drives the `nlm` CLI for Station 5. This MUST be a cloud-hosted browser worker, NOT a local Mac. The worker is a separate infrastructure concern; it can fail independently without failing the Build. |
| **AIKnowledgePack** | The downloadable "for-AI" bundle: the RVF KB binary (`{buildId}.rvf`), its passage sidecar (`{buildId}.passages.jsonl` — required for text retrieval; `.rvf` alone returns only `{id,distance}`), a self-contained search CLI (`ask-kb.mjs` from `kb/`), and an MCP server (`kb-mcp-server.mjs` from `kb/`) exposing 4 tools over JSON-RPC stdio. Delivered as a ZIP from Station 6. `@ruvector/search-cli` and `@ruvector/mcp-server` are NOT real npm packages (HTTP 404) — the real tools are the vendored scripts from `kb/`. |
| **ForHumansPrimer** | The introductory text section in the ExplainerSite explaining what the page is and how to use it, visible to human visitors. Counterpart to the AIKnowledgePack. |
| **QualityRefinementLoop** | The Station 8 loop: render the live page at 390px AND 1440px; take screenshots; vision-grade each; if either is below bar, apply CSS/content/layout refinements and re-deploy; re-check; repeat until BOTH pass. A Build does not exit this station until BOTH breakpoints pass. |
| **ResponsiveBar** | The mobile AND desktop quality bar that triggers exit from the QualityRefinementLoop. Both breakpoints must pass. The bar covers: no horizontal overflow, readable type, tap targets ≥ 44px, embeds fit and play, download works, all links resolve 200+content, KB-grounded content. "Studio plays on both" is CONDITIONAL on `Build.studioIncluded = true` — it is asserted only on the post-studio re-grade, never on the initial ship. The grade function receives `studioIncluded` and adjusts the rubric accordingly. |
| **VisionGrade** | A qualitative AI assessment (GPT-4o Vision or equivalent) of a generated image or a live-page screenshot against a named rubric. VisionGrades feed gate scores. |
| **DeploymentURL** | The `*.vercel.app` URL for the deployed ExplainerSite. Always valid after Station 10 (DEPLOY). |
| **ShowcaseURL** | The custom domain `{repo}.repoexplainer.isovision.ai`. Best-effort — the DeploymentURL is the real deliverable until DNS propagates. |
| **LiveURL** | Whichever of ShowcaseURL or DeploymentURL resolves when Station 11 (NOTIFY) runs. |
| **SubmitterEmail** | The email address collected at submission. Required (not optional). Station 11 sends a notification on success or failure. |
| **CollaboratorInvite** | The GitHub push-access invitation sent to TargetOwner on the ExplainerRepo. Best-effort — failure warns; does not fail the Build. |
| **FailureHandler** | The mandatory cleanup pathway that runs whenever any station fails. MUST always run. MUST patch the StatusChannel to `status=failed`. MUST send the failure email. Never suppressed. |
| **ShowcaseHost** | Stuart's Vercel team (`sikerr-6092`). The submitter/TargetOwner does NOT own the hosting; they are push collaborators on the ExplainerRepo only. |
| **RateKey** | `{owner}/{repo}` lowercased. Enforces at most one Build per repo per Rate Window. Durable across serverless cold starts via the active-builds Gist. |
| **IdempotencyKey** | The BuildId. Every station MUST produce the same observable outcome when re-executed with the same BuildId and the same inputs. |

---

## 3. Bounded Contexts

### 3.1 Context Map

```
[Submission]
     |
  BuildRequested
     |
[JobOrchestration] -------- StatusChannel (GitHub Gist)
     |
     +-- [RepoUnderstanding/RuVectorKB]     Station 1: UNDERSTAND
     |         | KBBuilt
     +-- [Authoring]                         Station 2: AUTHOR
     |         | ContentAuthored
     +-- [Visuals]                           Station 3: VISUALS
     |         | VisualsGraded
     +-- [Favicon]                           Station 4: FAVICON (part of Visuals context)
     |         | FaviconMade
     +-- [Studio]  <-- CloudBrowserWorker   Station 5: STUDIO (quarantined)
     |    |     |
     |  StudioBuilt  StudioDeferred
     |    \     /
     +-- [Assembly/Embedding]                Station 6: ASSEMBLE+EMBED
     |   [KnowledgePack]                     (sub-station within Assembly)
     |         | AssetsEmbedded
     |         | KnowledgePackBuilt
     +-- [SEO]                               Station 7: SEO
     |         | SEOApplied
     +-- [QualityRefinement] <-- loop        Station 8: QUALITY+REFINE
     |         | ResponsiveGreatVerified
     +-- [Publishing]                        Station 9: PUBLISH
     |         | Published
     +-- [HostingDeploy]                     Station 10: DEPLOY
     |         | Deployed
     +-- [Notification]                      Station 11: NOTIFY
               | UserNotified / BuildFailed
```

### 3.2 Context Responsibilities

**Submission**
Accepts a GitHub repo URL and a required email address. Validates URL parseability, repo
public existence (via GitHub API), and Rate Window. Provisions the StatusChannel (GitHub Gist).
Generates BuildId. Enqueues the Build job to JobOrchestration. Knows nothing downstream.

**JobOrchestration**
Owns the Build aggregate root and its state machine. Sequences stations, tracks current
station, enforces the invariant that every Build reaches Succeeded or Failed. Houses the
FailureHandler. Responsible for routing failures to Notification and patching the
StatusChannel. Executes no domain logic itself — it calls domain services in each context.

**RepoUnderstanding/RuVectorKB**
Clones the TargetRepo (depth 1) and builds the RVFKnowledgeBase: walks the repo tree,
extracts semantic passages, symbols, manifests; embeds them using a local ONNX model
(`Xenova/all-MiniLM-L6-v2`, 384-dim) into an RVF binary file. The RVF KB is the ONLY
knowledge artifact; all downstream content grounding uses HNSW retrieval against it. Plain
JSON is not the output and is not permitted for new builds.

**Authoring**
Consumes the RVFKnowledgeBase (via HNSW retrieval) and authors HTML content for every
ContentSlot. Every authored passage is grounded in retrieved KB passages — the retrieval log
is part of the StationEvidence. Also produces SEO metadata (title, meta, OG, Twitter, JSON-LD,
canonical, sitemap, robots.txt) as a separate SEOBlock. Does not generate images or studio.

**Visuals**
Generates the MediaBundle and Favicon via image generation APIs. Primary engine: gpt-image-2
at max quality + widescreen (hero 1536x1024). Fallbacks: imagen-4.0-ultra,
gemini-3-pro-image. `gpt-image-1` is retired and MUST NOT be used. Vision-grades each image
before advancing. Resizes Favicon via ImageMagick. Embeds alt text (required; never empty).

**Studio (quarantined)**
Drives the CloudBrowserWorker to create a NotebookLM notebook, add sources (GitHub URL +
generated `index.html`), request audio/video/slides generation, poll for completion, download
artifacts. The StudioACL translates between BuildId and NotebookLM concepts. The quarantine
contract: ANY failure here (nlm error, auth expiry, timeout, partial artifact) transitions
the Build to StudioDeferred, removes STUDIO ContentSlots cleanly, and continues. Studio can
never sink a Build.

**Assembly/Embedding**
Receives the built ExplainerSite skeleton (authored content + MediaBundle), the StudioBundle
OR a StudioDeferred signal, and the AIKnowledgePack. Embeds ALL studio assets inline: MP3 via
`<audio controls src="/studio/audio.mp3">`, PDF via PDF.js canvas renderer, MP4 via
`<video controls src="{github-release-url}">`. NotebookLM share URLs are NEVER iframed
(Google returns X-Frame-Options: DENY). Builds the download section + button for the
AIKnowledgePack. Video (MP4) is hosted as a GitHub Release asset (not on Vercel static
layer — file size). The station's output is the complete ExplainerSite, ready for QA.

**KnowledgePack** (sub-context of Assembly)
Builds the AIKnowledgePack: packages the RVF KB binary, a self-contained search CLI
(`npx @ruvector/search-cli`), and an MCP server stub (`npx @ruvector/mcp-server`) that
exposes the KB over the MCP protocol. Delivers as a ZIP (`{repo}-ai-knowledge-pack.zip`).
The download section in the ExplainerSite links to this ZIP and explains what it is.

**SEO**
Applies SEO to both the ExplainerSite page AND the ExplainerRepo. Page: title, meta
description, canonical, OG tags, Twitter card, JSON-LD (SoftwareSourceCode schema), sitemap,
robots.txt, alt text on all images. GitHub repo: description, homepage URL (LiveURL), topics
(derived from KB + "explainer" + "repo-explainer", max 20). NOTE: GitHub social-preview image
is NOT settable via API — skip; the page `og:image` (hero) is the real social surface.

**QualityRefinement**
The loop context. Renders the LIVE deployed page at 390px (mobile) AND 1440px (desktop),
screenshots both, vision-grades each against the ResponsiveBar rubric. If EITHER fails: the
refinement engine applies targeted CSS/content/layout fixes; re-deploys; re-screenshots;
re-grades. Loops until BOTH pass or a max-refinement limit is hit (hard failure). A Build
does not leave this context until ResponsiveGreatVerified is asserted with positive screenshot
evidence for both breakpoints.

**Publishing**
Creates the ExplainerRepo on GitHub (`stuinfla/{repo}-explainer`), pushes the ExplainerSite,
invites TargetOwner as push collaborator, sets GitHub repo SEO metadata (description,
homepage, topics). Two repos (TargetRepo, ExplainerRepo) are explicitly distinct here.

**HostingDeploy**
Deploys the ExplainerSite to a NEW, isolated Vercel project per Build. Project name:
`{repo}-explainer`, scoped to team `sikerr-6092`, via `vercel deploy --yes --prod --name
"{repo}-explainer" --scope "$VERCEL_TEAM_ID"`. No `VERCEL_PROJECT_ID` pre-set. Assigns
ShowcaseURL alias. Determines LiveURL (ShowcaseURL if resolvable; DeploymentURL otherwise).
Records LiveURL in the Build before handing off to Notification.

**Notification**
Sends the completion email on BOTH the happy path and the FailureHandler path. Success email:
LiveURL + ExplainerRepo URL + AIKnowledgePack download link. Failure email: honest description
of which station failed + retry link. Patches StatusChannel to `done` or `failed`. Notification
failure (SMTP error) does NOT retroactively change the Build's terminal state.

### 3.3 Context Relationships

| Upstream | Downstream | Relationship |
|----------|------------|--------------|
| Submission | JobOrchestration | Customer-Supplier. BuildId + GistId are the handoff keys. |
| RepoUnderstanding | Authoring | Published Language. RVF KB path + schema is the interface. |
| RepoUnderstanding | Visuals | Published Language. KB topics, name, description feed image prompts. |
| RepoUnderstanding | KnowledgePack | Published Language. RVF binary is the primary artifact. |
| RepoUnderstanding | Publishing | Published Language. KB topics + description → GitHub SEO. |
| Authoring | Assembly | Published Language. ContentSlots (filled HTML) + SEOBlock passed via filesystem. |
| Visuals | Assembly | Published Language. MediaBundle paths + Favicon paths. |
| Studio | Assembly | ACL (StudioACL). StudioBundle OR StudioDeferred signal. |
| Assembly | SEO | Published Language. Complete ExplainerSite with all slots filled. |
| Assembly | QualityRefinement | Published Language. Complete ExplainerSite for live-page grading. |
| HostingDeploy | QualityRefinement | Dependency. QualityRefinement drives HostingDeploy re-deploys in the loop. |
| JobOrchestration | Notification | Customer-Supplier. Build outcome supplied; email sent. |
| GitHub API | Submission | ACL (GitHubRepoValidationACL). |
| GitHub Gist API | JobOrchestration | ACL (StatusChannelACL). |
| OpenAI API | Authoring | ACL (AuthoringACL). |
| OpenAI API / Google Image API | Visuals | ACL (ImageGenerationACL). |
| CloudBrowserWorker + NlmCLI | Studio | ACL (StudioACL). |
| Vercel CLI | HostingDeploy | ACL (VercelDeployACL). |
| Cloudflare DNS | HostingDeploy | ACL (DnsResolutionACL). |
| GitHub API | Publishing | ACL (ExplainerRepoACL). |
| Gmail SMTP | Notification | ACL (EmailDeliveryACL). |
| RuVector / RVF | RepoUnderstanding | ACL (RuVectorACL). |
| Playwright / Vision API | QualityRefinement | ACL (ScreenshotGradeACL). |

---

## 4. Build Aggregate — State Machine

The Build aggregate root enforces this state machine. Every transition is triggered by a
domain event and MUST be recorded with StationEvidence before the transition is committed.
Transitions to `Failed` originate from any non-terminal state.

### 4.1 States

| State | Description |
|-------|-------------|
| `Queued` | Submission provisioned StatusChannel; job enqueued. Runner not yet active. |
| `Understanding` | Station 1 active: cloning TargetRepo + building RVF KB. |
| `Authoring` | Station 2 active: LLM content authoring from RVF KB retrieval. |
| `ProducingVisuals` | Station 3 active: generating MediaBundle via image APIs (gpt-image-2 primary). |
| `GeneratingFavicon` | Station 4 active: generating Favicon from hero visual identity. |
| `StudioBuilding` | Station 5 active: CloudBrowserWorker driving NotebookLM. Quarantined. |
| `StudioDeferred` | Station 5 fallback: worker unavailable/failed; continuing without studio. |
| `Assembling` | Station 6 active: embedding all assets inline; building AIKnowledgePack. |
| `ApplyingSEO` | Station 7 active: writing SEO to ExplainerSite and ExplainerRepo. |
| `QualityRefining` | Station 8 active: live-page screenshot → vision-grade → refine loop. |
| `Publishing` | Station 9 active: creating ExplainerRepo, pushing, inviting collaborator. |
| `Deploying` | Station 10 active: per-Build Vercel project creation + alias assignment. |
| `Notifying` | Station 11 active: patching StatusChannel; sending email. |
| `Succeeded` | Terminal. BOTH mobile and desktop screenshots passed. LiveURL confirmed. Email sent. |
| `Failed` | Terminal. FailureHandler ran. StatusChannel patched to `failed`. Failure email sent. |

### 4.2 Transitions

```
Queued
  -- BuildStarted --> Understanding
  -- RunnerTimeout (runner never picked up within 20 min) --> Failed

Understanding
  -- KBBuilt (RVF binary written; passage count > 0) --> Authoring
  -- CloneFailed (not found, private, rate-limited) --> Failed
  -- KBFailed (RVF write error, ONNX error) --> Failed

Authoring
  -- ContentAuthored (all ContentSlots filled; retrieval log present) --> ProducingVisuals
  -- AuthoringFailed (LLM error, zero slots filled, timeout) --> Failed

ProducingVisuals
  -- VisualsGraded (hero + 2 section images vision-graded >= threshold) --> GeneratingFavicon
  -- ImageGenerationFailed (individual image soft-fail) --> ProducingVisuals (continue; slot removed)
  -- AllImagesFailed (all primary images failed) --> Failed

GeneratingFavicon
  -- FaviconMade (32px + 192px files written; vision-graded on-brand) --> StudioBuilding
  -- FaviconFailed (soft; continue with default icon) --> StudioBuilding (warning)

StudioBuilding
  -- StudioBuilt (audio.mp3 + slides.pdf + video Release URL all non-empty and valid) --> Assembling
  -- StudioFailed (any nlm error, auth failure, partial artifact) --> StudioDeferred
  -- StudioTimeout (CloudBrowserWorker timeout, typically 10 min) --> StudioDeferred

StudioDeferred
  -- StudioDeferredAcknowledged (STUDIO ContentSlots removed cleanly) --> Assembling

Assembling
  -- AssetsEmbedded (all assets inline; <audio>, PDF.js, <video> slots filled or cleanly removed) --> ApplyingSEO
  -- KnowledgePackBuilt (ZIP file written; download section embedded) --> (sub-event within Assembling)
  -- AssemblyFailed --> Failed

ApplyingSEO
  -- SEOApplied (page meta + OG + JSON-LD + sitemap + robots.txt written) --> QualityRefining
  -- GitHubSEOApplied (description + topics + homepage set on ExplainerRepo) --> (sub-event, warning-only on failure)
  -- SEOFailed (page SEO hard failure) --> Failed

QualityRefining  [LOOP]
  -- ResponsiveGreatVerified (BOTH 390px AND 1440px screenshots pass ResponsiveBar) --> Publishing
  -- QualityRefineFailed (one or both below bar; refinements applied) --> QualityRefining [loop back]
  -- RefinementLimitExceeded (max refinement iterations hit without passing) --> Failed (GatesFailed emitted)

Publishing
  -- Published (ExplainerRepo created, pushed, TargetOwner invited) --> Deploying
  -- PublishFailed (git push hard failure) --> Failed
  -- CollaboratorInviteFailed --> Deploying (warning only; Build continues)
  -- GitHubSEOFailed --> Deploying (warning only)

Deploying
  -- Deployed (per-Build Vercel project created; DeploymentURL confirmed 200) --> Notifying
  -- DeployFailed (no URL parsed, CLI exit non-zero after retry) --> Failed
  -- AliasAssignmentFailed --> Notifying (warning; falls back to DeploymentURL)

Notifying
  -- StatusChannelUpdated AND NotificationSent --> Succeeded
  -- NotificationFailed (SMTP error) --> Succeeded (email failure is NOT a Build failure)
  -- StatusChannelUpdateFailed --> Succeeded (gist patch failure does NOT block completion)

Failed (terminal)
  -- (FailureHandler ran; StatusChannel = failed; failure email sent or attempted)
```

### 4.3 QualityRefinement Loop Detail

The QualityRefining state is a loop, not a single pass. Its internal flow:

```
[Enter QualityRefining]
  1. Render live page at 390px (mobile). Wait networkidle + 3s. Screenshot.
  2. Render live page at 1440px (desktop). Wait networkidle + 3s. Screenshot.
  3. Vision-grade mobile screenshot against ResponsiveBar rubric (GPT-4o Vision).
  4. Vision-grade desktop screenshot against same rubric.
  5. If BOTH scores >= ResponsiveBar threshold:
       emit ResponsiveGreatVerified (with screenshot evidence + scores as StationEvidence)
       --> Publishing
  6. If EITHER is below bar:
       Identify failing dimensions (overflow, type, tap targets, embeds, links, content).
       Apply targeted refinements (CSS patches, layout adjustments, content corrections).
       Re-deploy refined ExplainerSite to the SAME Vercel project.
       Increment refinement counter.
       If refinement counter < MAX_REFINEMENTS: loop to step 1.
       If refinement counter >= MAX_REFINEMENTS:
         emit GatesFailed
         --> Failed
```

MAX_REFINEMENTS is 3. After 3 iterations without passing, the Build fails with a specific
failure reason naming which dimension could not be closed.

### 4.4 Studio Quarantine Detail

The StudioBuilding state has an explicit quarantine boundary:

```
[Enter StudioBuilding]
  1. CloudBrowserWorker health check (StudioACL.checkSession()).
     If session expired or worker unreachable: skip to StudioDeferred immediately.
  2. nlm notebook create --> notebookId
  3. nlm source add (GitHub URL + index.html)
  4. nlm audio create; nlm video create; nlm slides create
  5. Poll for completion (max 8 min, 30s intervals).
  6. nlm download audio, slides.
  7. gh release upload (video MP4 to GitHub Release).
  8. nlm share public --> share URL (external link only, NOT iframe).
  9. If ALL artifacts present and non-zero:
       emit StudioBuilt
       --> Assembling
  10. If ANY step in 2-8 fails OR times out:
        emit StudioFailed (with specific step and error as evidence)
        --> StudioDeferred

[StudioDeferred]
  Remove STUDIO ContentSlots cleanly from ExplainerSite.
  Log warning to Build record.
  Record that studio is absent with reason.
  emit StudioDeferredAcknowledged
  --> Assembling (continues normally without studio)
```

The quarantine invariant: no exception, timeout, or partial failure from within the Studio
boundary may cause the Build aggregate to transition to Failed. The transition can only be
StudioBuilt (all artifacts) or StudioDeferred (clean degradation). There is no third path.

### 4.5 Build Aggregate Invariants

**INV-01 — Build Isolation.**
Each Build deploys to a Vercel project that is NOT shared with the landing page or any other
Build. `VERCEL_PROJECT_ID` MUST be absent from the pipeline's Phase 8 env block. Deploy
command MUST be `vercel deploy --yes --prod --name "{repo}-explainer" --scope
"$VERCEL_TEAM_ID"`. Violation: the OverwriteTrap (ADR-0002 OC-A). A CI lint step verifies
`VERCEL_PROJECT_ID` is absent. A post-deploy assertion verifies the project name matches the
expected per-Build name and is NOT the landing project ID.

**INV-02 — Never-Fail-Silently.**
A Build that enters any non-terminal state MUST eventually reach Succeeded or Failed. The
FailureHandler MUST run whenever any station fails, MUST patch StatusChannel to `failed`,
and MUST attempt the failure email when SubmitterEmail is present. A Build left in `running`
state permanently is a defect. Enforcement layers: FailureHandler (innermost), client-side
status polling (with stale detection), and a sweeper cron that patches Gists older than 20
minutes still in `running` state to `failed`.

**INV-03 — Station Monotonicity.**
The Build's station ordinal in the StatusChannel MUST only increase. No station may write a
step number lower than the previously committed value.

**INV-04 — Single Terminal State.**
A Build transitions to Succeeded or Failed exactly once. After either terminal state, no
further StatusChannel patches or state transitions occur.

**INV-05 — Repo Identity Separation.**
TargetRepo (`{owner}/{repo}`) and ExplainerRepo (`stuinfla/{repo}-explainer`) are distinct
aggregates. No operation on one mutates the other. Publishing context MUST NOT push to or
modify the TargetRepo.

**INV-06 — ContentSlot Completeness.**
The ExplainerSite reaching QualityRefinement MUST contain no unfilled ContentSlots. Any
remaining `<!-- CONTENT:xxx -->`, `<!-- SEO:head -->`, `<!-- STUDIO:* -->`, or
`<!-- KPACK:download -->` marker in `index.html` is a gate failure.

**INV-07 — RVF KB Grounding.**
All authored content MUST be derived from the RVFKnowledgeBase for this specific BuildId.
KBs MUST NOT be shared between Builds. The retrieval log (which passages were fetched and
used) is mandatory StationEvidence for Station 2. Sharing a KB is a correctness defect, not
an optimisation.

**INV-08 — ResponsiveBar Both Breakpoints.**
The QualityRefinementLoop exit condition requires BOTH 390px AND 1440px screenshots to pass.
A Build that passes only one breakpoint MUST NOT exit to Publishing. There is no exception
to this rule. Screenshot files for both breakpoints are required StationEvidence on the
ResponsiveGreatVerified event.

**INV-09 — Studio Non-Blocking.**
The Studio station MUST NOT cause a Build failure. Any error or timeout in the Studio context
MUST resolve to StudioDeferred, with ContentSlots removed cleanly. A Build in StudioDeferred
is a valid Build; it produces a complete ExplainerSite, just without embedded studio media.

**INV-10 — gpt-image-1 Retired.**
No Build MUST call `gpt-image-1`. The image generation pipeline MUST use `gpt-image-2`
(primary), `imagen-4.0-ultra`, or `gemini-3-pro-image`. Any reference to `gpt-image-1` in
scripts is a defect to be corrected.

---

## 5. Aggregates and Value Objects by Context

### 5.1 Submission Context

**Aggregate Root: Submission**

Identity: BuildId (UUID, generated at creation time)

Value Objects:
- `TargetRepoRef` — owner (string), repoName (string). Validated: must match GitHub URL
  pattern; repo must exist and be public.
- `SubmitterEmail` — required string; must contain `@` and pass basic format check. Absence
  is an HTTP 400 error, not a graceful skip.
- `RateKey` — `{owner}/{repo}` lowercased; enforces Rate Window.

Invariants:
- A Submission for a RateKey with an active-builds Gist entry within 2 hours returns HTTP
  429 before any Build is created.
- A Submission for a private or non-existent TargetRepo returns HTTP 400/404 before a Build
  is created.
- BuildId is generated exactly once per Submission and is immutable.
- Email is required. A Submission without a valid email is rejected (HTTP 400).

Domain Services:
- `RepoValidationService` — calls GitHub API via GitHubRepoValidationACL; maps HTTP 404 →
  `TargetRepoNotFound`, private flag → `TargetRepoIsPrivate`.
- `StatusChannelProvisioningService` — creates GitHub Gist via StatusChannelACL; returns
  GistId.
- `ActiveBuildsRegistryService` — reads and writes the active-builds tracking Gist; enforces
  Rate Window durably across cold starts.

### 5.2 JobOrchestration Context

**Aggregate Root: Build**

Identity: BuildId

State: one of the 15 states in §4.1.

Properties:
- `buildId`: UUID
- `targetRepo`: TargetRepoRef
- `gistId`: GistId
- `submitterEmail`: SubmitterEmail
- `currentStation`: StationOrdinal (1–11)
- `state`: BuildState (enum)
- `startedAt`: timestamp
- `completedAt`: optional timestamp
- `liveUrl`: optional URL (set after Deploying)
- `explainerRepoUrl`: optional URL (set after Publishing)
- `failureReason`: optional string (set on transition to Failed)
- `warnings`: list of non-blocking failures (collaborator invite, alias, SEO email, gist patch)
- `stationEvidence`: map of StationOrdinal → StationEvidence record
- `refinementCount`: integer (QualityRefinement loop counter)
- `studioIncluded`: boolean (true = StudioBuilt; false = StudioDeferred)

Domain Services:
- `StationCoordinatorService` — advances state machine; enforces INV-02, INV-03, INV-04.
- `FailureHandlerService` — runs on any station exit-non-zero; transitions to Failed;
  triggers Notification context.

### 5.3 RepoUnderstanding/RuVectorKB Context

**Aggregate Root: RVFKnowledgeBase**

Identity: `{buildId}-kb`

Value Objects:
- `RepoMetadata` — name, description, language, topics, stars, license, defaultBranch.
- `SemanticPassage` — text (up to 512 tokens), source file path, line range, embedding
  (384-dim float32 ONNX output).
- `SymbolTable` — per-language extracted symbols (functions, classes, exports, CLI commands).
- `ManifestSet` — parsed package.json / Cargo.toml / pyproject.toml / go.mod.

Invariants:
- RVFKnowledgeBase MUST be an RVF binary file (`.rvf`), NOT a plain JSON file.
- A KnowledgeBase scoped to a BuildId MUST NOT be shared with another BuildId.
- File traversal MUST skip `node_modules/`, `.git/`, `vendor/`, `dist/`, `build/`, binary
  files, and files > 200 lines (excerpt only for passages).
- The RVF binary MUST be queryable via HNSW before `KBBuilt` is emitted. A zero-passage
  KB is a hard failure.
- Embeddings MUST use the local ONNX model (`Xenova/all-MiniLM-L6-v2`, 384-dim). No
  external embedding APIs.

Repository:
- `KBRepository` — write: `save(kb: RVFKnowledgeBase, buildId)`; read: `load(buildId)`.
  Backed by filesystem (`kb-output/{buildId}.rvf`).

### 5.4 Authoring Context

**Aggregate Root: ExplainerSite** (scaffold + authored content)

Identity: BuildId

Value Objects:
- `ContentSlot` — name, htmlContent (string), filled boolean, retrievedPassages (list of
  SemanticPassage IDs used as grounding — required for INV-07).
- `SEOBlock` — title, metaDescription, keywords, canonicalUrl, ogImageUrl (hero 1536x1024),
  ogTitle, ogDescription, twitterCard, jsonLD (SoftwareSourceCode), sitemapXml, robotsTxt.
- `PageStructure` — HTML document with all ContentSlots resolved and SEOBlock populated.

Invariants:
- Every ContentSlot value MUST cite at least one retrieved passage from the RVFKnowledgeBase.
- A ContentSlot is either fully replaced or completely removed; partial replacement is invalid.
- Exactly one `<h1>` per page (repo name in hero); one `<h2>` per section. No `<h1>` outside
  the hero.
- sitemap.xml and robots.txt are generated at scaffold time (static; no LLM call required).

Domain Services:
- `ContentAuthoringService` — retrieves passages from RVF KB (top-k per slot topic); calls
  AuthoringACL; verifies no marker remains in the output; logs retrieval IDs as evidence.
- `SEOGenerationService` — derives SEOBlock from RepoMetadata; emits sitemap.xml and
  robots.txt.

### 5.5 Visuals Context

**Aggregate Root: MediaBundle**

Identity: BuildId

Value Objects:
- `GeneratedImage` — type (hero | architecture | use-case | favicon), path, width, height,
  altText (required, non-empty, derived from type + repo name), engine used, visionGradeScore.
- `FaviconSet` — `favicon-32.png`, `favicon-192.png`, `favicon.png` (source), derivedFromHero
  (boolean — MUST be true: prompt includes hero palette, shape, motif).

Invariants:
- `gpt-image-1` MUST NOT be called. Engine MUST be one of: gpt-image-2, imagen-4.0-ultra,
  gemini-3-pro-image.
- Hero MUST be 1536x1024 (widescreen; gpt-image-2 supports this natively).
- Architecture and use-case MUST be 1024x1024.
- Every GeneratedImage MUST have non-empty altText.
- A broken `<img>` tag MUST never be left in the ExplainerSite.
- Favicon MUST be derived from the hero's visual identity (same palette, motif, shape language).
- VisionGradeScore for each image MUST be >= 70 before the station advances. One retry with
  a more specific prompt is permitted. Below 70 after retry = gate failure.

### 5.6 Studio Context (Quarantined)

**Aggregate Root: StudioAttempt** (ephemeral — discarded on success or StudioDeferred)

Identity: BuildId

Value Objects:
- `StudioBundle` — audioPath (MP3, >= 100KB), slidesPath (PDF, valid header), videoReleaseUrl
  (GitHub Release asset URL resolving HTTP 200).
- `NotebookRef` — notebookId (nlm-assigned), shareUrl (external link only; never iframe).

Invariants:
- `NotebookRef.shareUrl` MUST NOT be used as an `<iframe>` src. Google returns
  X-Frame-Options: DENY.
- Video MP4 MUST be uploaded to GitHub Release (not Vercel static layer).
- Audio MP3 and slide deck PDF MUST be committed to ExplainerSite (served same-origin).
- Any failure in this context MUST resolve to StudioDeferred, never to Build Failed.
- `StudioACL.checkSession()` MUST be called before any nlm operation. If it returns false,
  transition directly to StudioDeferred.

### 5.7 Assembly/Embedding + KnowledgePack Context

**Aggregate Root: AssembledExplainerSite**

Identity: BuildId

Value Objects:
- `EmbeddedStudio` — audioPlayerHtml (inline `<audio>`), slidesViewerHtml (PDF.js canvas),
  videoPlayerHtml (`<video>` with GitHub Release src). Present only when StudioBundle
  available; absent ContentSlots removed cleanly otherwise.
- `AIKnowledgePack` — zipPath, rvfKbPath (reference), searchCliCommand, mcpServerCommand,
  packDescription, fileSizeBytes.
- `DownloadSection` — html block (the "For AI" download panel + button + primer).

Invariants:
- If StudioBundle is absent, STUDIO ContentSlots MUST be removed (not left as markers).
- The AIKnowledgePack ZIP MUST include the RVF binary for this BuildId.
- The download section MUST be present and visible on the ExplainerSite regardless of
  studio presence or absence.

### 5.8 SEO Context

**Aggregate Root: SEOApplication**

Identity: BuildId

Value Objects:
- `PageSEO` — all values from SEOBlock (§5.4), applied to the live `index.html`.
- `RepoSEO` — description, homepageUrl (LiveURL — set after Deploy), topics (list).

Invariants:
- `og:image` MUST reference the hero image URL at the ExplainerSite's domain.
- `canonical` MUST match the ShowcaseURL (or DeploymentURL if ShowcaseURL not yet resolvable).
- RepoSEO.homepageUrl MUST be set to LiveURL. Because Deploy (Station 10) runs after SEO
  (Station 7) in the core flow, the `homepage` field is set in a separate post-Deploy step
  or in Station 11 after LiveURL is determined.
- GitHub repo social-preview image is NOT settable via API. Skip it. Do not attempt
  undocumented endpoints.

### 5.9 QualityRefinement Context

**Aggregate Root: QualityReport**

Identity: BuildId

Value Objects:
- `Screenshot` — breakpoint (390 | 1440), imagePath, takenAt.
- `VisionGradeResult` — breakpoint, score (0–100), failingDimensions (list), passed boolean.
- `RefinementAction` — iteration, dimensionFixed, changeDescription, changeType
  (css | content | layout).
- `QualityVerdict` — iteration, mobileScore, desktopScore, allPassed, evidence (screenshot
  paths + scores), refinementCount.

Invariants:
- QualityAssurance MUST screenshot the LIVE deployed page — not the local filesystem.
- Both breakpoints (390px and 1440px) MUST be screenshotted and graded on EVERY iteration.
- ResponsiveGreatVerified MUST NOT be emitted unless BOTH screenshots pass in the same
  iteration.
- Screenshot file paths MUST be included as StationEvidence on ResponsiveGreatVerified.
- VisionGrade calls use GPT-4o Vision (same `OPENAI_API_KEY` as Authoring).
- RefinementActions are applied to the ExplainerSite source, then re-deployed to the SAME
  Vercel project before the next screenshot iteration.

### 5.10 Publishing Context

**Aggregate Root: ExplainerRepo**

Identity: `stuinfla/{repo}-explainer`

Value Objects:
- `RepoRef` — org (`stuinfla`), name (`{repo}-explainer`).
- `CollaboratorInvite` — githubUsername (TargetOwner), permission (`push`),
  status (pending | accepted | warning-only-failed).
- `RepoSEO` — description, homepageUrl, topics.

Invariants:
- ExplainerRepo.name MUST be `{repo}-explainer`. No other naming scheme.
- ExplainerRepo MUST be public. MUST NOT be the TargetRepo.
- If ExplainerRepo already exists (idempotent re-run), git push MUST use `--force`.
- CollaboratorInvite failure MUST NOT fail the Build (emits `CollaboratorInviteFailed`
  warning only).
- RepoSEO homepage is set after Station 10 provides LiveURL (warning-only if it fails).

### 5.11 HostingDeploy Context

**Aggregate Root: Deployment**

Identity: BuildId

Value Objects:
- `VercelProject` — projectId (dynamically allocated; NOT pre-set), name (`{repo}-explainer`),
  teamId (`sikerr-6092`).
- `DeploymentURL` — `https://{name}-{hash}.vercel.app`.
- `ShowcaseURL` — `https://{repo}.repoexplainer.isovision.ai`.
- `LiveURL` — ShowcaseURL if resolvable; DeploymentURL as fallback.

Invariants (see also INV-01):
- `VERCEL_PROJECT_ID` MUST NOT be pre-set.
- Each Build MUST create or reuse exactly ONE Vercel project named `{repo}-explainer`
  scoped to `sikerr-6092`.
- Landing project (`repoexplainer.isovision.ai`) MUST be a separate project never touched
  by any pipeline deploy step.
- AliasAssignment failure MUST NOT fail the Build.
- LiveURL MUST be recorded in the Build before Station 11 runs.
- Smoke test (HTTP 200 on DeploymentURL) MUST run before LiveURL is set.

### 5.12 Notification Context

**Aggregate Root: Notification**

Identity: BuildId

Value Objects:
- `NotificationPayload` — buildId, outcome (success | failure), liveUrl, explainerRepoUrl,
  knowledgePackDownloadUrl, failureReason (on failure), retryUrl (on failure).
- `StatusPatch` — gistId, status (`done` | `failed`), resultPayload.

Invariants:
- Notification runs on BOTH happy path (Station 11) and FailureHandler path.
- Notification failure MUST NOT retroactively fail a Succeeded Build.
- Success email MUST include LiveURL, ExplainerRepo URL, and AIKnowledgePack download link.
- Failure email MUST include honest description of which station failed and a retry link.
- Email is sent when SubmitterEmail is present. Absence is not an error.
- `GMAIL_APP_PASSWORD` absent with SubmitterEmail present is a pre-flight misconfiguration
  error that MUST abort the Build in Station 0 (Setup) before any API spend occurs.

---

## 6. Domain Events Catalogue

Events are past-tense. Cross-context events are marked. Internal events stay within context.

| Event | Source | Consumers | Payload |
|-------|--------|-----------|---------|
| `BuildRequested` | Submission | JobOrchestration | url, submitterEmail |
| `SubmissionValidated` | Submission | JobOrchestration | buildId, gistId, targetRepo, submitterEmail |
| `SubmissionRejected` | Submission | (client only) | reason (InvalidUrl \| RepoNotFound \| RepoIsPrivate \| RateLimitExceeded \| EmailMissing) |
| `BuildQueued` | JobOrchestration | StatusChannel | buildId, gistId, step=0, status=queued |
| `BuildStarted` | JobOrchestration | StatusChannel | buildId, step=1, stepName=Understanding |
| `KBBuilt` | RepoUnderstanding | JobOrchestration, Authoring, Visuals, KnowledgePack, Publishing | buildId, rvfPath, passageCount, languagePrimary |
| `CloneFailed` | RepoUnderstanding | JobOrchestration | buildId, reason |
| `KBFailed` | RepoUnderstanding | JobOrchestration | buildId, reason |
| `ContentAuthored` | Authoring | JobOrchestration | buildId, slotsFilledCount, retrievalLogPath |
| `AuthoringFailed` | Authoring | JobOrchestration | buildId, reason |
| `VisualsGraded` | Visuals | JobOrchestration | buildId, images[], visionScores{} |
| `ImageGenerationFailed` | Visuals | Visuals (soft) | buildId, imageType, reason |
| `AllImagesFailed` | Visuals | JobOrchestration | buildId, reason |
| `FaviconMade` | Visuals | JobOrchestration | buildId, favicon32Path, favicon192Path, derivedFromHero |
| `FaviconFailed` | Visuals | JobOrchestration (warning) | buildId, reason |
| `StudioBuilt` | Studio | JobOrchestration | buildId, audioPath, slidesPath, videoReleaseUrl, shareUrl |
| `StudioFailed` | Studio | JobOrchestration (quarantine) | buildId, failedStep, reason |
| `StudioDeferred` | Studio | JobOrchestration, Assembly | buildId, reason |
| `AssetsEmbedded` | Assembly | JobOrchestration | buildId, studioIncluded, downloadSectionPresent |
| `KnowledgePackBuilt` | KnowledgePack | Assembly, JobOrchestration | buildId, zipPath, fileSizeBytes |
| `AssemblyFailed` | Assembly | JobOrchestration | buildId, reason |
| `SEOApplied` | SEO | JobOrchestration | buildId, canonicalUrl, ogImageUrl, topicsCount |
| `GitHubSEOApplied` | SEO | JobOrchestration (info) | buildId, topics[], homepage |
| `GitHubSEOFailed` | SEO | JobOrchestration (warning) | buildId, reason |
| `SEOFailed` | SEO | JobOrchestration | buildId, reason |
| `QualityRefineFailed` | QualityRefinement | QualityRefinement (loop) | buildId, iteration, mobileScore, desktopScore, failingDimensions[] |
| `ResponsiveGreatVerified` | QualityRefinement | JobOrchestration | buildId, iteration, mobileScore, desktopScore, mobileScreenshotPath, desktopScreenshotPath |
| `GatesFailed` | QualityRefinement | JobOrchestration | buildId, iteration, reason |
| `Published` | Publishing | JobOrchestration | buildId, explainerRepoUrl, commitSha |
| `CollaboratorInvited` | Publishing | JobOrchestration (info) | buildId, targetOwner |
| `CollaboratorInviteFailed` | Publishing | JobOrchestration (warning) | buildId, targetOwner, reason |
| `PublishFailed` | Publishing | JobOrchestration | buildId, reason |
| `Deployed` | HostingDeploy | JobOrchestration | buildId, deploymentUrl, projectId |
| `AliasAssigned` | HostingDeploy | JobOrchestration (info) | buildId, showcaseUrl |
| `AliasAssignmentFailed` | HostingDeploy | JobOrchestration (warning) | buildId, reason |
| `LiveUrlDetermined` | HostingDeploy | JobOrchestration, Notification | buildId, liveUrl, usingCustomDomain |
| `DeployFailed` | HostingDeploy | JobOrchestration | buildId, reason |
| `UserNotified` | Notification | (terminal) | buildId, outcome, channel |
| `NotificationFailed` | Notification | JobOrchestration (warning) | buildId, reason |
| `BuildSucceeded` | JobOrchestration | (terminal) | buildId, liveUrl, explainerRepoUrl, knowledgePackDownloadUrl, durationSeconds |
| `BuildFailed` | JobOrchestration | Notification | buildId, failureStation, reason |

---

## 7. Idempotency, Retry, and Compensation per Station

**Global idempotency contract:** BuildId is the idempotency key. Any station re-executed
with the same BuildId MUST produce the same observable outcome. External systems MUST be
queried for existing state before creating new resources.

| Station | Idempotency | Retry Policy | Compensation on Failure |
|---------|-------------|--------------|------------------------|
| 0 — Setup | GHA setup is idempotent. Pre-flight check (GMAIL_APP_PASSWORD, OPENAI_API_KEY, etc.) exits early with clear error if misconfigured. | GHA auto-retry if runner fails to pick up (up to 20 min). | BuildFailed; FailureHandler. |
| 1 — UNDERSTAND | RVF binary overwritten on re-run (idempotent). Delete `target-repo/` if exists before re-clone. | No automatic retry. Hard failure → CloneFailed / KBFailed. | FailureHandler; TargetRepo info in failure email. |
| 2 — AUTHOR | OpenAI calls are NOT idempotent by nature. On re-run: re-call with same KB. Equivalent (not identical) output acceptable. Retrieval log re-generated. | 2 retries on OpenAI 429/5xx (5s, 15s backoff). | Restore all ContentSlot markers; emit AuthoringFailed. FailureHandler. |
| 3 — VISUALS | Image calls NOT idempotent. Previous images overwritten on re-run. | 1 retry per individual image on API error (same prompt). 1 retry with improved prompt if vision-grade below 70. | Individual image soft-fail: remove slot cleanly, continue. All images fail: hard AllImagesFailed. FailureHandler. |
| 4 — FAVICON | Same as individual image. Soft-fail if generation fails (Build continues with warning, no favicon). | 1 retry on API error. | FaviconFailed warning; default `<link rel="icon">` removed; continue to Studio. |
| 5 — STUDIO | `nlm notebook create` checks for existing notebook by title before creating (idempotent). `nlm download` overwrites local files. GitHub Release upload: `gh release upload --clobber` (idempotent). | 2 retries per nlm command on transient errors (30s backoff). | ANY failure → StudioDeferred; STUDIO ContentSlots removed cleanly; Build continues. |
| 6 — ASSEMBLE | Overwriting output files is idempotent. AIKnowledgePack ZIP is recreated on re-run. | No retry (pure local operation). | AssemblyFailed → FailureHandler. |
| 7 — SEO | Writing page SEO idempotent (file overwrite). GitHub PATCH/PUT for repo metadata idempotent. | 1 retry on GitHub API 5xx (15s backoff). | Page SEO failure: hard SEOFailed → FailureHandler. GitHub SEO failure: warning only; Build continues. |
| 8 — QUALITY+REFINE | Screenshotting is idempotent (same live URL). Refinements are applied incrementally. Re-deploy within same Vercel project is idempotent (stable project name). | Loop up to MAX_REFINEMENTS (3) iterations. | Iteration failure: apply next refinement and re-screenshot. RefinementLimitExceeded → GatesFailed → Failed. |
| 9 — PUBLISH | `gh repo create` skip if exists. `git push --force` idempotent. Collaborator invite and SEO: re-apply (PATCH/PUT idempotent). | 1 retry on GitHub API 5xx (15s backoff). | Collaborator invite: warning only. Git push: hard PublishFailed → FailureHandler. |
| 10 — DEPLOY | `vercel deploy --name {repo}-explainer` creates new project first time; reuses on subsequent runs for same repo (name match). DeploymentURL varies per deploy — acceptable. | 1 retry on deploy exit non-zero (30s backoff). | AliasAssignment failure: warning; fallback to DeploymentURL. Deploy failure: DeployFailed → FailureHandler. |
| 11 — NOTIFY | Gist PATCH idempotent (same status written). Email: NOT idempotent — check StatusChannel before sending; if already `done`, skip re-send. | 1 retry on SMTP failure (10s backoff). | Notification failure: warning only. Build terminal state not changed. |

---

## 8. Anti-Corruption Layers (ACL Interfaces)

Each ACL isolates the domain from external vocabulary, protocol, and failure modes. Domain
services call ACL interfaces; they NEVER call external SDKs or CLIs directly.

### 8.1 RuVectorACL

Purpose: translates RVF file operations and ONNX embedding calls into domain RVFKnowledgeBase
objects. Hides embedding model loading, HNSW indexing, binary format, and query API.

```typescript
interface RuVectorACL {
  // Build and persist an RVF KB from a local repo directory.
  // Uses Xenova/all-MiniLM-L6-v2 (384-dim) ONNX model locally.
  buildKB(
    repoDir: string,
    outputPath: string,   // path to write the .rvf binary
    buildId: string
  ): Promise<RVFKBResult>;

  // Retrieve top-k semantically similar passages for a query.
  query(
    rvfPath: string,
    queryText: string,
    topK: number
  ): Promise<SemanticPassage[]>;
}

type RVFKBResult = {
  rvfPath: string;
  passageCount: number;
  languagePrimary: string;
  fileSizeBytes: number;
};

class KBBuildFailed extends DomainError { step?: string; }
class KBQueryFailed extends DomainError { rvfPath: string; }
```

### 8.2 GitHubRepoValidationACL

Purpose: translates GitHub REST API into domain validation results for Submission context.

```typescript
interface GitHubRepoValidationACL {
  validate(owner: string, repo: string): Promise<TargetRepoMetadata>;
}

type TargetRepoMetadata = {
  fullName: string;
  defaultBranch: string;
  description: string | null;
  topics: string[];
  primaryLanguage: string | null;
  stars: number;
};

class TargetRepoNotFound extends DomainError {}
class TargetRepoIsPrivate extends DomainError {}
class GitHubAPIUnavailable extends DomainError { retryAfterSeconds?: number; }
```

### 8.3 StatusChannelACL

Purpose: translates GitHub Gist API into domain status events. Hides auth, JSON
serialisation, and HTTP error codes. Gist patch failures are logged but MUST NOT throw
(use `|| true` semantics — a gist blip must not abort a successful build).

```typescript
interface StatusChannelACL {
  provision(buildId: string, targetRepo: string): Promise<GistId>;
  patch(gistId: GistId, patch: StatusPatch): Promise<void>;  // never throws; logs failure
  read(gistId: GistId): Promise<StatusSnapshot>;
}

type StatusPatch = {
  step: number;
  stepName: string;
  status: 'running' | 'done' | 'failed';
  result?: BuildResult;
  error?: string;
};
```

### 8.4 AuthoringACL

Purpose: translates OpenAI Chat Completions (gpt-4o) into typed ContentSlot values.
Hides model selection, prompt construction, token counting, and retry logic. MUST
accept retrieved passages as grounding context; MUST return retrieval log.

```typescript
interface AuthoringACL {
  authorContent(
    retrievedPassages: SemanticPassage[],
    slotNames: ContentSlotName[],
    repoMetadata: RepoMetadata
  ): Promise<{ slots: ContentSlot[]; retrievalLog: RetrievalLogEntry[] }>;

  generateSEOBlock(
    metadata: RepoMetadata,
    explainerDomain: string
  ): Promise<SEOBlock>;
}

class AuthoringFailed extends DomainError { slotName?: string; }
class AuthoringQuotaExceeded extends DomainError {}
```

### 8.5 ImageGenerationACL

Purpose: translates OpenAI Images API (gpt-image-2, primary) and Google Image APIs
(imagen-4.0-ultra, gemini-3-pro-image, as alternatives) into GeneratedImage value objects.
`gpt-image-1` is retired and MUST NOT be called here.

```typescript
interface ImageGenerationACL {
  generate(
    type: 'hero' | 'architecture' | 'use-case' | 'favicon',
    prompt: string,
    outputPath: string,
    options?: { engine?: 'gpt-image-2' | 'imagen-4.0-ultra' | 'gemini-3-pro-image' }
  ): Promise<GeneratedImage>;

  visionGrade(
    imagePath: string,
    repoName: string,
    technologies: string[],
    rubric: VisionGradeRubric
  ): Promise<VisionGradeResult>;
}

type GeneratedImage = {
  type: string;
  path: string;
  width: number;
  height: number;
  altText: string;
  engine: string;
};

class ImageGenerationFailed extends DomainError { imageType: string; }
```

### 8.6 StudioACL (CloudBrowserWorker + NlmCLI)

Purpose: translates CloudBrowserWorker + nlm CLI commands into StudioBundle value objects.
Hides CLI invocation, polling, session cookie management, and file paths. Session check is
mandatory before any nlm operation. All errors translate to `StudioBuildFailed`; callers
MUST handle by transitioning to StudioDeferred.

```typescript
interface StudioACL {
  checkSession(): Promise<boolean>;  // false = session expired; must degrade immediately

  buildStudio(
    notebookTitle: string,
    sources: StudioSource[],
    outputDir: string,
    videoReleaseRepo: string  // "stuinfla/{repo}-explainer"
  ): Promise<StudioBundle>;
}

type StudioSource = { type: 'url'; url: string } | { type: 'file'; path: string };

type StudioBundle = {
  audioPath: string;          // MP3 in outputDir/studio/audio.mp3
  slidesPath: string;         // PDF in outputDir/studio/slides.pdf
  videoReleaseUrl: string;    // GitHub Release asset URL (not a local path)
  shareUrl: string;           // External link only; NEVER iframe
};

// Every nlm failure translates to this; callers handle with StudioDeferred
class StudioBuildFailed extends DomainError { step?: string; }
class StudioSessionExpired extends DomainError {}
```

### 8.7 ScreenshotGradeACL

Purpose: translates Playwright browser automation and GPT-4o Vision calls into VisionGrade
results for the QualityRefinement loop. Takes screenshots at specified viewport widths and
grades them against the ResponsiveBar rubric.

```typescript
interface ScreenshotGradeACL {
  screenshot(
    url: string,
    viewportWidth: 390 | 1440,
    outputPath: string,
    options?: { waitForNetworkIdle?: boolean; settleMs?: number }
  ): Promise<ScreenshotResult>;

  grade(
    screenshotPath: string,
    rubric: 'responsive-bar',
    context: { repoName: string; studioIncluded: boolean }
  ): Promise<VisionGradeResult>;
}

type ScreenshotResult = {
  path: string;
  viewportWidth: number;
  takenAt: string;
};

type VisionGradeResult = {
  score: number;              // 0-100
  passed: boolean;            // score >= ResponsiveBar threshold
  failingDimensions: string[];
  evidence: string;           // narrative summary for StationEvidence
};
```

### 8.8 VercelDeployACL

Purpose: translates Vercel CLI into Deployment value objects. Hides CLI output parsing,
project creation, team scoping, and URL extraction. MUST NOT accept a pre-existing
projectId — each call creates or reuses a project by name.

```typescript
interface VercelDeployACL {
  deploy(
    siteDir: string,
    projectName: string,  // "{repo}-explainer"
    teamId: string        // "sikerr-6092"
    // NO projectId parameter — enforces INV-01
  ): Promise<DeploymentResult>;

  assignAlias(deploymentUrl: string, alias: string): Promise<AliasResult>;
  smokeTest(url: string): Promise<{ status: number; ok: boolean }>;
}

type DeploymentResult = {
  deploymentUrl: string;
  projectId: string;     // newly allocated or existing (matched by name)
};
```

### 8.9 DnsResolutionACL

Purpose: checks ShowcaseURL resolvability. Domain logic should never depend on DNS library
specifics.

```typescript
interface DnsResolutionACL {
  isResolvable(hostname: string): Promise<boolean>;
}
```

### 8.10 ExplainerRepoACL

Purpose: translates GitHub API operations (repo create, push, collaborator invite, topics,
PATCH metadata) into ExplainerRepo domain events. Hides GH_PAT auth, gh CLI, and retry.

```typescript
interface ExplainerRepoACL {
  createOrEnsureRepo(name: string, org: string): Promise<{ created: boolean; url: string }>;
  push(localDir: string, remoteUrl: string, forcePush: boolean): Promise<{ commitSha: string }>;
  inviteCollaborator(
    repoFullName: string,
    username: string,
    permission: 'push'
  ): Promise<void>;  // throws CollaboratorInviteError; caller treats as warning
  setMetadata(repoFullName: string, description: string, homepage: string): Promise<void>;
  setTopics(repoFullName: string, topics: string[]): Promise<void>;
  uploadReleaseAsset(
    repoFullName: string,
    tag: string,
    filePath: string,
    fileName: string
  ): Promise<{ assetUrl: string }>;  // used for video MP4
}

class CollaboratorInviteError extends DomainError {}
class RepoSEOError extends DomainError {}
```

### 8.11 EmailDeliveryACL

Purpose: translates Gmail SMTP (implicit-TLS port 465) into notification domain events.
Hides SMTP protocol, auth, and MX resolution. Zero npm dependencies (Node net/tls builtins).

```typescript
interface EmailDeliveryACL {
  send(payload: EmailPayload): Promise<void>;  // throws EmailDeliveryFailed
}

type EmailPayload = {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
};

class EmailDeliveryFailed extends DomainError { smtpError?: string; }
```

---

## 9. The Three Hardest Invariants

### INV-08 — ResponsiveGreatVerified Both Breakpoints (hardest to close)

**What it is:** The QualityRefinementLoop MUST NOT exit to Publishing until BOTH a 390px
screenshot AND a 1440px screenshot of the LIVE page pass the ResponsiveBar in the SAME
iteration.

**Why it's hard:** CSS fixes for mobile often introduce regressions on desktop, and vice
versa. Each refinement iteration deploys a full re-build to the live URL, adds ~35s, and
requires two more vision-grade API calls. The loop can converge slowly or not at all. MAX_REFINEMENTS = 3 caps the cost but also caps the chance of convergence.

**Enforcement:** ScreenshotGradeACL is stateless — it grades independently per breakpoint
with no memory of prior iterations. The QualityRefinement domain service enforces the
both-pass conjunctive condition explicitly. `ResponsiveGreatVerified` event payload MUST
carry `mobileScreenshotPath` AND `desktopScreenshotPath` as mandatory fields — the event
cannot be constructed without them. The threshold calibration (what score = "looks great")
MUST be validated against the 6 hand-curated examples before going live; starting estimate
is 75/100.

### INV-09 — Studio Non-Blocking (hardest operationally)

**What it is:** The Studio station MUST NEVER cause a Build to fail, regardless of what
goes wrong in the CloudBrowserWorker. The quarantine boundary is absolute.

**Why it's hard:** The CloudBrowserWorker has multiple independent failure modes: Google
session cookie expiry (unpredictable; can expire mid-build), notebooklm.google.com API
latency/outages, partial artifact downloads (audio generated but slides timeout), video
release upload failures. Any of these can occur independently. Each must be caught and
handled as StudioDeferred, not as BuildFailed. The risk is that a developer "quickly adds"
an error handler that propagates an exception out of the Studio context — an innocent-looking
bug that makes Studio non-quarantined.

**Enforcement:** StudioACL interface is the quarantine wall. The domain service wrapping
Studio execution has a top-level `try/catch` that catches ALL errors and translates them to
`StudioDeferredAcknowledged`. The studio workflow test suite MUST include a test where every
nlm command fails and asserts the Build still reaches Succeeded. A separate test simulates
session expiry (checkSession returns false) and asserts immediate skip to Assembling.

### INV-01 — Build Isolation (hardest to enforce operationally)

**What it is:** Each Build deploys to its own isolated Vercel project. The landing page
project is inviolable. No two Builds share a project.

**Why it's hard:** The current code uses a pre-configured `VERCEL_PROJECT_ID` secret. Any
operator who accidentally sets this env var — even with good intent — reverts to the
OverwriteTrap. The invariant requires BOTH a code change (remove `VERCEL_PROJECT_ID` from
the Phase 10 env block; change deploy command to use `--name`) AND an operational setup
change (landing page linked to a separate project). It cannot be enforced by code alone.
A CI lint step that fails the workflow if `VERCEL_PROJECT_ID` appears in the Phase 10 env
block is the automated guard. A post-deploy assertion that compares the deployed project ID
against the known landing project ID is the runtime guard.

---

## 10. Operational Invariants (System-Level, Cross-Build)

**OI-01 — Landing Immutability.**
`repoexplainer.isovision.ai` is served from its own Vercel project, never touched by any
Build's deploy step.

**OI-02 — VERCEL_PROJECT_ID Absent.**
`VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` MUST NOT appear in the pipeline's Station 10 env
block. These belong to the landing project only.

**OI-03 — gpt-image-1 Retired.**
`gpt-image-1` MUST NOT appear anywhere in the image generation scripts. A code search grep
on build validates this.

**OI-04 — Cost Gate.**
Station 2 (AUTHOR) + Station 3 (VISUALS) cost approximately $0.05–$0.30 per Build. Above
~50 concurrent submissions/hour, a cost gate MUST trigger before Station 2. Not yet
implemented; must be in place before any viral traffic event.

**OI-05 — StudioRunner Session Health.**
A scheduled health check (`StudioACL.checkSession()`, daily) MUST run on the
CloudBrowserWorker. Expiry is detected before builds submit, not during them.

**OI-06 — Durable Rate Limiting.**
The in-memory `rateMap` in `www/api/build.js` does not survive serverless cold starts. The
active-builds Gist (`ACTIVE_BUILDS_GIST_ID`) is the durable rate limit. A GHA `concurrency:`
stanza caps same-repo parallel Builds.

**OI-07 — StatusChannel Sweeper.**
A cron (hourly) scans all Gists with description prefix "Repo Explainer build status:"
and status `running` older than 20 minutes; patches them to `failed` and attempts the failure
email. This is the outermost layer of INV-02 enforcement.

---

## 11. Context Directory Layout (Target)

```
/
  www/                          # Submission + Notification client
    api/
      build.js                  # SubmissionApplicationService + ActiveBuildsRegistryService
      status.js                 # StatusChannelACL.read() proxy
    index.html
    main.js                     # Progress UI (optional live watch; email is the contract)
    styles.css
  scripts/
    phase0-preflight.mjs        # Setup + pre-flight checks (GMAIL_APP_PASSWORD, API keys)
    phase1-clone.mjs            # RepoUnderstanding — git clone
    phase2-build-rvf-kb.mjs     # RepoUnderstanding — RVF KB build (NOT JSON)
    phase3-scaffold.mjs         # Authoring — scaffold with ContentSlots + SEO static files
    phase4-author-content.mjs   # AuthoringACL + ContentAuthoringService (RVF retrieval)
    phase5-generate-images.mjs  # ImageGenerationACL + MediaBundle (gpt-image-2 primary)
    phase5a-favicon.mjs         # Favicon generation (derived from hero)
    phase5b-build-studio.mjs    # StudioACL + CloudBrowserWorker (quarantined)
    phase6-assemble.mjs         # Assembly/Embedding + KnowledgePack
    phase7-seo.mjs              # SEO application (page + GitHub repo)
    phase8-quality-refine.mjs   # QualityRefinement loop (Playwright + Vision grade)
    phase9-publish.mjs          # ExplainerRepoACL + Publishing context
    phase10-deploy.mjs          # VercelDeployACL + HostingDeploy context
    phase11-notify.mjs          # EmailDeliveryACL + StatusChannelACL.patch()
    update-gist-status.sh       # StatusChannelACL.patch() (bash; no npm; used in shell steps)
  kb/
    stores/
      {buildId}/
        {buildId}.rvf           # RVF KB binary per Build (NOT global; scoped to BuildId)
  .github/
    workflows/
      build-explainer.yml       # JobOrchestration + FailureHandler
  docs/
    adr/
      0002-repo-explainer-architecture.md
      0003-async-build-and-real-quality-gates.md
    ddd/
      repo-explainer-domain.md        # This file
      repo-primer-domain-model.md     # Prior model (ADR-0001 manual pipeline)
```

Each script maps to exactly one bounded context. Cross-context communication occurs
exclusively through the filesystem (RVF KB, explainer-site/, kb-output/) and environment
variables (BuildId, GistId, LiveURL, ExplainerRepoUrl, KnowledgePackDownloadUrl). No
in-process coupling between contexts.

---

*Authoritative spec: provided by Stuart Kerr, 2026-06-26, supersedes ADR-0002 where
conflicting.*
*Paired ADRs: `docs/adr/0002-repo-explainer-architecture.md`, `docs/adr/0003-async-build-and-real-quality-gates.md`*
*Prior domain model (ADR-0001 Repo-Primer manual pipeline): `docs/ddd/repo-primer-domain-model.md`*
