# Ship Checklist — explainmyrepo

> Ordered steps to ship the canonical `explainmyrepo` landing page, point the domain at it,
> retire stale deploys, and publish the npm package.
>
> **BLOCKED ON OWNER TOKENS** markers call out every step that requires credentials that are
> not in this repo. Do those steps manually or with the right token in hand.

---

## Prerequisites

- [ ] Vercel account access for the `isovision` org (team `team_J1ktaVpPnXdvDZsFH9Z4yH6t`)
  **BLOCKED ON OWNER TOKENS: Vercel login required**
- [ ] GitHub `gh` CLI authenticated as `stuinfla` (or org member with repo write access)
- [ ] npm logged in as a member of the `@isovision` org
  **BLOCKED ON OWNER TOKENS: `npm login` + confirm `@isovision` org exists on npm**
- [ ] DNS control for `isovision.ai` (to add the `explainmyrepo` subdomain CNAME)
  **BLOCKED ON OWNER TOKENS: DNS access required**

---

## Phase A — Deploy ONE canonical page to the "repo-explainer" Vercel project and rename it

The canonical landing page lives in `www/`. Its current Vercel project is named **`repo-explainer`**
(`projectId: prj_KbSbSjdTfeGzW6x4O2TftTU8jXi1`, `www/.vercel/project.json`).

1. **Verify the working deploy from `www/`**

   ```bash
   cd www
   npx vercel --prod --yes          # re-deploy latest www/ to the repo-explainer project
   ```

   Confirm the deployment URL resolves and the landing page loads correctly.

2. **Rename the Vercel project from `repo-explainer` → `explainmyrepo`**

   In the Vercel dashboard: Settings → General → Project Name → change to `explainmyrepo`.
   This will change the auto-assigned URL from `repo-explainer.vercel.app` to
   `explainmyrepo.vercel.app`. Update `www/.vercel/project.json` `projectName` field to match.

   **BLOCKED ON OWNER TOKENS: Vercel project settings access required**

3. **Update the `www/.vercel/project.json` locally after renaming**

   Change `"projectName": "repo-explainer"` → `"projectName": "explainmyrepo"`.

4. **Update in-page branding now that the project is confirmed live** (separate PR — not this
   checklist's scope, but note that `www/index.html` still shows "Repo Explainer" in `<title>`,
   `og:title`, the nav logo, hero copy, and footer. See naming inventory for the full list.)

---

## Phase B — Point `isovision.ai` / `explainmyrepo.isovision.ai` at the Vercel project

5. **Add the custom domain in Vercel**

   Dashboard → explainmyrepo project → Settings → Domains → Add domain:
   - `explainmyrepo.isovision.ai`
   - Optionally: `isovision.ai` if that root should redirect here too

   Vercel will show the required DNS record (typically a CNAME to `cname.vercel-dns.com` for the
   subdomain, or A/ALIAS for the apex).

   **BLOCKED ON OWNER TOKENS: Vercel project access required**

6. **Add the DNS record at your DNS provider for `isovision.ai`**

   ```
   CNAME  explainmyrepo.isovision.ai  →  cname.vercel-dns.com
   ```

   (Exact value comes from step 5. If using Vercel DNS, run `vercel dns add …` instead.)

   **BLOCKED ON OWNER TOKENS: DNS provider access required**

7. **Verify TLS and propagation**

   ```bash
   curl -sI https://explainmyrepo.isovision.ai | head -4
   # expect: HTTP/2 200
   ```

   Vercel auto-provisions TLS once the CNAME resolves. Allow up to 24 h for DNS propagation.

8. **Update `www/vercel.json`** if a canonical redirect from the old `.vercel.app` URL is needed.
   Add a redirect rule pointing `repo-explainer.vercel.app` → `https://explainmyrepo.isovision.ai`.
   Vercel will continue serving the old auto-assigned URL until you delete it.

---

## Phase C — Retire stale deploys and note the dead metaharness URL

The following Vercel projects are stale per-repo explainer outputs, NOT part of the landing page.
Retire them by removing them from Vercel and archiving or deleting their GitHub repos.

| Stale Vercel URL | Vercel project name | Local dir | Action |
|---|---|---|---|
| `repo-explainer.vercel.app` | `repo-explainer` (becomes `explainmyrepo.vercel.app` after step 2) | `www/` | Keep — this is the canonical page |
| `repo-explainer-six.vercel.app` | unknown — no local project.json found | — | **Delete** in Vercel dashboard |
| `repo-explainer-website.vercel.app` | unknown — no local project.json found | — | **Delete** in Vercel dashboard |
| `ruv-explainer-agent-harness-generator.vercel.app` | `ruv-explainer-agent-harness-generator` | `ruv-explainer-agent-harness-generator/` | **Delete or archive** (see dead URL note below) |
| `ruvn-explainer.vercel.app` | `ruvn-explainer` | `ruv-explainer-ruvn/` | Delete or archive |
| `ruqu-explainer.vercel.app` | `ruqu-explainer` | `ruv-explainer-ruqu/` | Delete or archive |
| `photonlayer-explainer.vercel.app` | `photonlayer-explainer` | `ruv-explainer-photonlayer/` | Delete or archive |

**Dead URL — MetaHarness / agent-harness-generator:**
The file `ruv-explainer-agent-harness-generator/package.json` references homepage
`https://ruv-explainer-agent-harness-generator.vercel.app`. This URL is stale and should be
considered dead. The studio link inside the explainer (`ruvnet.github.io/agent-harness-generator/`)
points to a GitHub Pages URL that may or may not still be live — verify independently before
removing the link from the explainer HTML.

**Steps to retire:**

9. **Identify stale project IDs** for `repo-explainer-six` and `repo-explainer-website` — they
   have no local `project.json` in this repo. Check the Vercel dashboard to find them.

   **BLOCKED ON OWNER TOKENS: Vercel access required**

10. **Delete stale projects in Vercel dashboard** (Settings → General → Delete Project).

    Before deleting, confirm each project has no active custom domain pointing at it, and that
    no external links in READMEs or docs you care about reference it.

11. **Archive or delete the stale per-repo GitHub repos** (if they were created as separate repos):
    - `stuinfla/ruv-explainer-agent-harness-generator` (referenced in that project's package.json)
    - Any other `stuinfla/ruv-explainer-*` repos created as per-explainer outputs

    The source code for all of them lives in this monorepo; the GitHub repos are deployment
    artifacts and can be archived once Vercel projects are deleted.

---

## Phase D — Publish `@isovision/explainmyrepo` to npm

The package is already named correctly (`package.json`: `"name": "@isovision/explainmyrepo"`,
`"version": "0.1.0"`). These steps complete the publish.

12. **Confirm the `@isovision` npm org exists**

    ```bash
    npm org ls @isovision    # or check https://www.npmjs.com/org/isovision
    ```

    If the org does not exist, create it at `https://www.npmjs.com` before proceeding.

    **BLOCKED ON OWNER TOKENS: npm login required; @isovision org existence unconfirmed**

13. **Log in to npm**

    ```bash
    npm login
    # follow prompts; confirm you have publish rights to @isovision
    ```

    **BLOCKED ON OWNER TOKENS: npm credentials required**

14. **Dry-run the publish**

    ```bash
    npm pack --dry-run
    # review the file list — confirm no .env, secrets, or large binaries are included
    ```

15. **Publish**

    ```bash
    npm publish --access public
    ```

16. **Verify the package is live**

    ```bash
    npm info @isovision/explainmyrepo
    # should return version 0.1.0
    ```

17. **Test the npx invocation** (the README shows `npx @isovision/explainmyrepo <github-url>`).
    Confirm the bin entry in `package.json` is set and the entry script runs correctly:

    ```bash
    npx @isovision/explainmyrepo --help    # or whatever the CLI entry point is
    ```

---

## Blocked items summary

| Item | Blocker |
|---|---|
| Netlify re-auth | Netlify token is returning 401; existing Netlify deploys (e.g. `agenticow-explainer.netlify.app`) cannot be managed until a valid token is provided. Per-repo explainer outputs may still deploy via Netlify if the Netlify integration is used. |
| npm login + @isovision org | Must log in to npm as a user with publish rights; must verify `@isovision` org exists before `npm publish`. |
| Vercel project rename + domain + cleanup | Requires Vercel access to the `isovision` org (team `team_J1ktaVpPnXdvDZsFH9Z4yH6t`). Cannot rename project, add custom domain, or delete stale projects without this. |
| DNS for `explainmyrepo.isovision.ai` | Requires access to the DNS provider for `isovision.ai`. |

---

## Notes

- The e2e test output in the scratchpad (`e2e/site/`) uses `agenticow-explainer.netlify.app` as
  its base URL. That is correct for a per-repo explainer output (agenticow was the test repo).
  The SEO meta tags, sitemap, robots.txt, and llms.txt in that output are all well-formed and
  correctly reference the Netlify URL, not the landing page URL.
- The sitemap's `<loc>` and robots.txt `Sitemap:` directive will need to be parameterised (or
  the build tool updated) to use `explainmyrepo.isovision.ai` once that domain is live and
  per-repo explainers are deployed under it rather than under Netlify.
