# Ruv-Explainer — START HERE (Agent Handoff)

> **Mission:** turn any hard-to-grok Reuven Cohen / RuvNet repo into a **dual-audience, evergreen "explainer + proof point"** download — a **human half** that teaches a newcomer what the tool is and how to use it, and an **AI half** that lets an agent actually use it on a real task.
>
> This repo is the *generalized* home for that process. The *proven prototype* (built for **RuView** + **ruvector**, live at https://cognitum-sensor-primer.vercel.app) lives at `/Users/stuartkerr/Code/Cognitum Sensor Primer/cognitum-one-sensor-primer` — that's your working reference code.

---

## 0. Orient in 60 seconds

The project brain (AgentDB / Ruflo memory) is already seeded. Query it:

```bash
ruflo memory search -q "your question" -n ruv-explainer
ruflo memory list -n ruv-explainer        # see all keys
```

**Keys available** (read them first): `pipeline-overview`, `comprehension-arc`, `notebooklm-authoring`, `rvf-build`, `scope-boundary-rule`, `evergreen-ci`, `guard-and-distribution`, `built-vs-designed`, `qa-and-authoring-method`, `assets-and-tooling`, `reference-implementation`.

Then read the design docs:
- `docs/adr/0001-repo-primer-pipeline.md` — the decisions and *why* (10 decisions, 7 alternatives, binding constraints).
- `docs/ddd/repo-primer-domain-model.md` — the domain model. **Every invariant/event is tagged `[ENFORCED]` (built) vs `[MODELED — target]` (not yet built).** That tagging *is* your backlog.

---

## 1. What you build (per target repo)

One download, two clearly-labeled halves:
- **`for-humans/`** — NotebookLM studio outputs: explainer video, audio overview, native-PDF slide deck, infographics. Hand-curated. Teaches the 7-stage arc below.
- **`for-ai/`** — an RVF (single-file vector DB) knowledge base of the repo's **own** code + Whisper transcripts + a summary. Lets an agent query and use the tool.

The bundle is simultaneously the **explainer** (human half) and the **proof point** (AI half is a real, working, queryable artifact).

---

## 2. The 7-stage comprehension arc (the acceptance bar)

An artifact only succeeds if a newcomer who has never seen the repo can, after the human half, answer all seven:

1. What is this concept?
2. What can you do with it?
3. Why was it built?
4. What problems does it solve?
5. One concrete **end-to-end** example.
6. Three or four **other** application areas.
7. How exactly do I implement it (concrete path)?

If a true beginner is still lost, the primer failed. (See AgentDB key `comprehension-arc`.)

---

## 3. RUNBOOK — run the pipeline on ONE new repo

1. **Pick & pin.** Add the target repo as a git submodule; record its upstream `main`.
2. **Config.** Create its per-repo config entry (see §4).
3. **AI half.** Force-walk the repo's **own tree** — **respect the scope boundary: read `.gitmodules`, exclude every vendored dep / nested submodule** (key `scope-boundary-rule`). Embed into the RVF **small** variant (MiniLM 384-dim). Append the 7-arc primer sections (`index-primer`). Run the **guard** (anti-truncation / parity / live-query). *Ref:* `kb/build-*.mjs`, `kb/index-primer.mjs`, `kb/guard-check.mjs`.
4. **Human half (MANUAL — hand to Stuart).** Build the repo into a NotebookLM notebook, generate the studio outputs, pull them via the `nlm` CLI; transcribe audio/video with Whisper `small.en` into `for-ai/`. (key `notebooklm-authoring`).
5. **Bundle.** Zip `for-humans/` + `for-ai/` into one download. *Ref:* `kb/make-bundles.mjs`.
6. **Publish.** Upload to the rolling `kb-latest` GitHub Release (`--clobber`). Commit loose <100 MB KB files; gitignore the big zips.
7. **Surface.** Static page with both halves + live provenance from `/kb/.last-built.json`.
8. **Evergreen.** Daily change-based cron → `workflow_dispatch` (needs `actions: write`; rebase-before-push; build+guard **before** publish). (key `evergreen-ci`).

---

## 4. Per-repo config schema

```json
{
  "id": "reponame",
  "displayName": "Human-readable name",
  "submodule": "https://github.com/ruvnet/<repo>",
  "notebookId": "<NotebookLM notebook id>",
  "embedSmall": "Xenova/all-MiniLM-L6-v2",
  "embedBig": "Xenova/bge-base-en-v1.5",
  "scopeExclude": ["vendor/**", "<nested submodule paths from .gitmodules>"]
}
```

---

## 5. Finding new RuvNet repos (your next job)

- Look at **github.com/ruvnet** (and Reuven Cohen's other orgs / personal account). Sort by recently created/updated.
- Target the **brand-new, esoteric, under-documented "power tool"** repos — those are precisely the ones that need an on-ramp.
- For each candidate: confirm it's a standalone tool (not a fork/mirror), skim README + tree, then add a config entry (§4) to the build queue.

---

## 6. Hard rules & gotchas (do NOT relearn these the hard way)

- **Scope boundary** — index only the repo's own tree; exclude vendored/nested submodules. Violating it both broke the build (over-ingestion → `ManifestNotFound`) and drowned the learner.
- **`close()` is the only RVF persist path** — there is no flush/save.
- **`GITHUB_TOKEN` push won't trigger push-workflows** → dispatch via `gh workflow run` with `actions: write`.
- **Rebase-before-push** in CI commit steps (concurrent commits).
- **Build + guard BEFORE publish** — a bad build must never clobber the live download.
- **PROVE, don't assert** — verify on the real artifact (open the `.rvf`, hit the Release URL, check the live page). A subagent that reports "done" with **zero tool uses did nothing** — verify on disk.
- **Slides = native PDF, no OCR.** Keep the human on-ramp low-friction.
- **Secrets stay in `.env` (gitignored)** — never commit them.

---

## 7. Built vs. designed — your backlog

**BUILT & PROVEN today:** dual-half bundle · both RVF variants · multi-*kind* walk (source/docs/crate-src) · guard-before-publish · change-based trigger · Release distribution · scope-boundary via `.gitmodules` · live provenance.

**DESIGNED — NOT YET BUILT (build these):** delta-highlighting ("what's new each version") · the full **≥5-strategy** force-walk (add API/exports, examples, changelog passes) · the comprehension-arc **coverage guard** · automated NotebookLM authoring · **the generalized per-repo build scripts** (currently hard-wired to RuView/ruvector — *generalizing them is task #1*).

---

## 7.5 Build backlog to reach turnkey (from a script audit)

An audit traced the reference scripts and confirmed: the ADR/DDD are decision+model records, and the build code is **hard-coded to RuView+ruvector in ~8 places** — so onboarding repo #3 today is a bespoke rebuild, not a config swap. Close that in this order (**runbook FIRST** — it makes the process runnable immediately *and* forces out what the refactor must cover):

1. **`docs/RUNBOOK.md`** *(M, do first)* — operator steps: new-repo URL → shipped bundle (prereqs → submodule → build → index-primer → guard → bundle → publish → NotebookLM authoring → verify), each with the exact command + verify + manual gate.
2. **`repos.config.json`** *(L)* — `{id, displayName, submoduleUrl, notebookId, embedModels, excludeGlobs, sampleQuestions, blurb}`; refactor the 4 scripts that hard-code repo identity (`guard-check.mjs`, `index-primer.mjs`, `make-bundles.mjs`, `update-readme-pins.mjs`) to read it.
3. **generic `build-kb.mjs <repoId>`** *(L)* — universal walk passes (README/CHANGELOG, all `*.md`, manifests, crate doc-comments, examples, source-tree) driven by config globs + per-repo hooks. This is where the ≥5-strategy walk lands. (Today's two builders are 504/466 lines, hand-tailored.)
4. **`docs/NOTEBOOKLM-AUTHORING.md`** *(M)* — the manual bottleneck: source-curation checklist + 7-arc-stage mapping + exact `nlm auth --cdp`/`nlm pull` + output destinations.
5. **config-driven workflows** *(M)* — matrix over repo ids; build the Release upload list from config (both workflows are wired to two repos today).
6. **`scaffold-repo.mjs <id> <giturl> <notebookId>`** *(M)* — adds submodule, writes config, creates the store dir, prints the manual steps.
7. **arc-coverage guard** *(M)* — extend `guard-check.mjs` to assert all 7 arc stages are covered (today it only checks non-empty), so unattended runs are trustworthy.
8. **prereqs + `preflight.mjs`** *(S)* — Node ≥18, `@ruvector/rvf` + transformers, `nlm` CLI + CDP auth, `gh` auth, `actions: write`, optional `ANTHROPIC_API_KEY`.

**Do NOT gate turnkey on:** the delta/"what's new" layer · automating NotebookLM (ship the playbook, not a script) · DDD modeling refinements · the rename · a standalone chunk-count guard.

---

## 7.6 Design upgrades (challenged & recommended)

An adversarial design pass found real, non-gold-plating upgrades (full detail in AgentDB key `design-improvements`). **The one structural flaw to fix:** the AI half auto-refreshes but the human half is hand-authored and *never* does — so the teaching half silently goes stale while the proof half stays current, and provenance doesn't track it. Top upgrades (verify-then-apply; fund in this order):

- **Measure the big-variant build time** *(S)* — the two-variant split rests on an *unmeasured* ">1h" estimate; on ~6.7k passages BGE is likely minutes. If so, **delete the big variant** → one auto-refreshed variant (major simplification).
- **Use a code-aware embedding model** *(S)* — MiniLM/BGE are general-text; pick a code-aware ONNX model empirically with a grader. Half the value is code retrieval.
- **Auto-draft the 7-stage arc-script from the AI half** *(M)* — only the media *render* is manual; the *content* is what the KB already holds. Human edits + approves → feed as NotebookLM's primary source. Unblocks the bottleneck and makes the human half re-authorable.
- Plus: **`humanHalfSha` + staleness flag** *(S)*, **symbol-diff `DeltaSet`** *(M)*, **tag passages by strategy + arc-stage** *(M)*, **tag/drop Whisper transcripts of generated audio** *(S — protects answer-from-source)*.

**Leave alone (already optimal):** scope-boundary, change-based dispatch, guard-before-publish, the dual-half concept, RVF single-file.

---

## 8. Your first actions

1. `ruflo memory search -q "pipeline overview" -n ruv-explainer` → read all 11 keys.
2. Read `docs/adr/` + `docs/ddd/`.
3. Open the reference repo's `kb/` scripts + `.github/workflows/`.
4. Go find the first 1–2 brand-new RuvNet repos; draft their config entries (§4).
5. **Generalize the build scripts**, run the AI half on repo #1, and hand the human-half NotebookLM step to Stuart.

---
*Seeded from the cognitum-one-sensor-primer prototype on 2026-06-19. Re-seed the AgentDB any time with `bash scripts/seed-agentdb.sh`.*
