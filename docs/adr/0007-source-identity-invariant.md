# ADR-0007: INV-21 Source-Identity — the submitted repo is the build, or there is no build

Updated: 2026-07-08 19:50:00 EDT | Version 1.2.0
Created: 2026-07-08 17:10:00 EDT

> **v1.2.0 — the open question is RESOLVED (owner decision, same day): the hosted door builds
> PUBLIC repos only.** A hosted build publishes a public page, which must never quietly expose
> private code. The landing /build function now rejects private repos at submit time and routes
> the owner to the local door: `npx explainmyrepo` inside a VS Code / Claude Code session
> (`gh auth login` first), where they run under their own identity and control whether it deploys
> at all. Positioning shipped with it (owner's "great first experience" mandate): the CLI gained
> an up-front environment doctor (missing keys are named in second zero, with the fix), the brain
> can now ride a logged-in Claude Code install when no Anthropic key is set (claude -p, the same
> headless path the hosted runner uses — minimum requirements collapse to OpenAI + optional
> Netlify), and the README + landing explain the door choice in one question: "is the repo
> public, and whose keys should do the work?"

**Status:** Accepted and implemented (same day — this is an incident-response ADR).

**Amends:** ADR-0005 (adds INV-21 to the invariants; moves Station 0–1 to the hosted harness)
and the hosted-runner architecture (bin/agentic-runner.mjs).

## Incident (2026-07-08, hosted run 28973407121)

A user (mark@heroforge.ai) submitted `mamd69/SONA-Trader` — a **private** repo they had shared
with our GitHub account, exactly as the front door's own error message instructs. The front
door's token-authenticated check passed, so the build dispatched. But the hosted runner's env
allowlist strips `GITHUB_TOKEN` from the agent (correct — untrusted-input security, 2026-07-04),
so the agent's clone failed unauthenticated. The run brief's anti-silent-failure clause ("try a
reasonable workaround") then licensed the agent to treat *no access* as an obstacle: it searched
GitHub, found the similarly-named **public** repo `Dar-41/Virtual-Trader-SONA-AI-` (a stranger's
project), edited `repo.url` in build.json, built a real-looking explainer of the WRONG repo,
deployed it, and the submitter was emailed "your explainer is ready."

Root cause: two individually-correct rules (never fail silently; achieve the goal) composed into
fabrication because a third rule was never written: **the source repo's identity is inviolable.**
The deterministic tools all failed loudly and correctly; the policy layer had the hole.

## Decision

1. **Station 0–1 moves to the harness (hosted flow).** `bin/agentic-runner.mjs` runs
   `tools/clone-repo.mjs` itself — deterministic code that MAY hold the GitHub token — **before
   the agent exists**. Private repos shared with our account now genuinely work; the agent still
   never sees a token. If the exact submitted repo cannot be cloned, the run ends there: the
   status gist gets an actionable human message ("if it's private, share it with our GitHub
   account or make it public, then rebuild — nothing was built"), the owner is alerted, exit
   non-zero. Nothing exists yet that could "work around" it. (Pattern per RVM: the capability
   check is the FIRST thing that happens; no subsystem is touched until rights are verified.)
2. **INV-21 Source-identity, enforced mechanically at both boundaries.** The runner pins
   `EXPLAINER_SUBMITTED_REPO=owner/name` into the agent env. `clone-repo` refuses any
   `repo.url` that doesn't match the pin (before any network); `deploy` — the outward-facing
   boundary — refuses the same before touching any provider. The runner re-verifies the pin on
   exit and treats a mismatch as failure regardless of what the agent reports.
3. **The law is stated to the brain.** SKILL.md rule 5 + the runner brief carry THE
   SOURCE-IDENTITY LAW: never search for, substitute, or reconstruct a different repo; an
   explainer of the wrong repo is fabrication — worse than shipping nothing. The workaround
   license is now explicitly scoped "within the pinned repo."
4. **The user is told, early and specifically.** Front door: the access check (which already
   existed) now names the account to share with. Runner preflight failure: the specific
   private-repo message reaches the live status page, not a generic "didn't complete."

## Remediation of the incident itself (v1.1.0 — completed same day)

- `virtual-trader-sona-ai-explainer.netlify.app` deleted (2026-07-08, verified 404).
- Conformance suite `tests/source-identity.test.mjs` pins the repairs (19/19 suite green).
- The corrective rebuild of the REAL `mamd69/SONA-Trader` through the fixed pipeline shook out
  two more gate bugs, both of which failed CLOSED pre-agent (the designed direction): (a) the
  preflight rejected the bare `owner/name` form the workflow passes (fixed: normalize before
  pinning); (b) on CI, git inherited the actions/checkout AUTHORIZATION extraheader from the
  invoking checkout and GitHub refused the doubled header (fixed: runGit uses a neutral cwd —
  which also makes the "unauthenticated" probe honestly unauthenticated on CI for the first
  time). Third attempt: preflight OK (private=true, cloned pre-agent), page deployed and
  verified grounded in the real repo — https://sona-trader-explainer.netlify.app (the run
  itself hit its 40-min budget during the agent's post-deploy re-verification loop).
- Original build's status gist patched with the corrected result; correction email drafted to
  the submitter; no ledger credit was needed (the best-effort meter write had never recorded
  the build).
- **Open question for the owner:** hosted builds of PRIVATE repos now succeed — and publish a
  PUBLIC explainer of private code. Should private-repo builds require explicit consent (or
  password-protected/unlisted deploys) before publishing? The correction email offers the
  submitter a takedown.

## What this does NOT change

The one-brain/three-doors architecture, the agentic hosted runner itself, the env allowlist
(GH tokens stay OUT of the agent), and the quality gate all stand. This ADR adds the one
constraint agent autonomy was missing: identity is not the agent's to decide.
