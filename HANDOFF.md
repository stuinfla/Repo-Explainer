# Repo Explainer — Session Handoff

**Date:** 2026-06-26

---

## What was accomplished

### Pipeline implementation (PR #8, merged)

Created 5 Node.js scripts that replace the stub commands in phases 2–6 of the GitHub Actions workflow (`.github/workflows/build-explainer.yml`):

| Script | Lines | What it does |
|--------|-------|-------------|
| `scripts/phase2-build-kb.mjs` | 253 | Walks the target repo, extracts symbols per language (JavaScript, TypeScript, Python, Rust, Go, Java, C, Ruby, Swift), parses manifests, outputs `kb-output/repo-analysis.json` |
| `scripts/phase3-scaffold.mjs` | 439 | Creates a complete explainer site: HTML template with 9 content section placeholders, CSS design system, JavaScript interactivity, favicon, vercel.json, package.json |
| `scripts/phase4-author-content.mjs` | 371 | Calls OpenAI gpt-4o to author 9 sections (hero, grounding, problem, solution, how-it-works, use-cases, getting-started, gallery, provenance), replaces placeholders in index.html |
| `scripts/phase5-generate-images.mjs` | 155 | Calls OpenAI gpt-image-1 for 3 images: hero (1792x1024), architecture (1024x1024), use-case (1024x1024). Patches HTML to reference them |
| `scripts/phase6-quality-gates.mjs` | 241 | 5-gate system: structure, content, assets, security, deploy readiness. Writes `quality-report.json`. Exits with code 1 only on critical gate failures (gates A or D) |

All scripts use zero npm dependencies — Node 20+ built-ins only. Phases 2, 3, and 6 were tested locally end-to-end.

### README fix (PR #9, merged)

Fixed all 10 broken image paths. The rewritten README referenced `assets/img/screenshots/` which never existed — actual files are in `assets/readme/` and `assets/diagrams/`. Restored descriptive alt text from the original README. Spelled out all abbreviations (knowledge base, database, Phase 0, Model Context Protocol, etc.).

### Quality gate fix (PR #10, merged)

Fixed the placeholder detection regex in Gate B — had `<!-- CONTENT: -->` (with a space) but actual markers are `<!-- CONTENT:hero -->` (no space).

### Agent memory populated

- 8 entries in ruflo memory (namespace: `patterns`): project architecture, pipeline phases, file layout, critical constraints, infrastructure details, explainer site structure, quality gates system, visual-verification lesson
- 5 files in Claude auto memory: user profile, two feedback rules (verify visuals, no abbreviations), pipeline status, infrastructure reference

---

## What needs to happen next

### 1. Set GitHub secrets from the environment file

Read the `.env` file at the repo root and set these secrets:

```bash
grep "^OPENAI_API_KEY=" .env | cut -d= -f2- | gh secret set OPENAI_API_KEY --repo stuinfla/Repo-Explainer
grep "^VERCEL_TOKEN=" .env | cut -d= -f2- | gh secret set VERCEL_TOKEN --repo stuinfla/Repo-Explainer
grep "^RESEND_API_KEY=" .env | cut -d= -f2- | gh secret set RESEND_API_KEY --repo stuinfla/Repo-Explainer
```

If there is no `VERCEL_TOKEN` in the environment file, create one at `vercel.com/account/tokens` first.

### 2. Add Cloudflare DNS record

In the Cloudflare dashboard for `isovision.ai`:

| Field | Value |
|-------|-------|
| Type | CNAME |
| Name | `*.repoexplainer` |
| Target | `cname.vercel-dns.com` |
| Proxy status | DNS only (gray cloud) |

### 3. Add wildcard domain in Vercel

In the Vercel dashboard for the `repo-explainer` project:
- Settings → Domains → Add `*.repoexplainer.isovision.ai`

### 4. Run a test build

Once secrets and DNS are configured:

```bash
gh workflow run build-explainer.yml \
  -f target_owner=sindresorhus \
  -f target_repo=ky \
  -f build_id=$(uuidgen) \
  -f gist_id=TEST \
  --repo stuinfla/Repo-Explainer
```

Or use the website: paste `https://github.com/sindresorhus/ky` into the build form.

### 5. Verify the output

After the test build completes:

- Check that the generated explainer site renders correctly
- Verify images loaded (hero, architecture, use-case)
- Confirm quality gate scores in the workflow log
- Check the Vercel deployment and custom domain alias
- Verify the collaborator invitation was sent

---

## Current secrets status

| Secret | Status |
|--------|--------|
| `GH_PAT` | Set |
| `VERCEL_ORG_ID` | Set |
| `OPENAI_API_KEY` | **Missing** — needed for Phase 4 (content) and Phase 5 (images) |
| `VERCEL_TOKEN` | **Missing** — needed for Phase 8 (deploy) |
| `RESEND_API_KEY` | **Missing** — optional, for Phase 9 email notification |

---

## Files modified this session

```
.github/workflows/build-explainer.yml  — phases 2–6 now call real scripts
scripts/phase2-build-kb.mjs            — new: repo analysis
scripts/phase3-scaffold.mjs            — new: site scaffold with design system
scripts/phase4-author-content.mjs      — new: OpenAI content generation
scripts/phase5-generate-images.mjs     — new: OpenAI image generation
scripts/phase6-quality-gates.mjs       — new: 5-gate quality system (regex fixed)
README.md                              — fixed image paths and abbreviations
assets/readme/agentic-qe.png           — new: copied from www/ assets
```

---

## Critical rules to carry forward

- The `.env` file contains live API keys and a private RSA key. It is in `.gitignore`. Keys must never be embedded in client-side HTML or JavaScript, and must never be committed to any public repository. They may only be used server-side for pipeline operations.
- Never add a `Co-Authored-By` trailer to commits (per project CLAUDE.md).
- No abbreviations in user-facing documentation. Spell out everything: "knowledge base" not "KB", "database" not "DB", "Phase 0" not "P0".
- Always verify that visual output renders correctly — do not just check that the code is syntactically valid. Verify every image path resolves to a real file.
- Use feature branches and pull requests when auto-mode blocks direct pushes to main.
- The pipeline must never fail silently. It either completes successfully or tells the user exactly why it cannot.

---

## Infrastructure reference

| Item | Value |
|------|-------|
| GitHub repo | `stuinfla/Repo-Explainer` (main branch) |
| GitHub account | `stuinfla` |
| Vercel project | `repo-explainer` |
| Vercel project ID | `prj_KbSbSjdTfeGzW6x4O2TftTU8jXi1` |
| Vercel org ID | `team_J1ktaVpPnXdvDZsFH9Z4yH6t` |
| Vercel account | `sikerr-6092` |
| DNS provider | Cloudflare (nameservers: `hattie.ns.cloudflare.com`, `peter.ns.cloudflare.com`) |
| Domain pattern | `{repo}.repoexplainer.isovision.ai` |
| Explainer repo pattern | `stuinfla/{repo}-explainer` |
