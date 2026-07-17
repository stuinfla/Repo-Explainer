# ADR-0009: The Alive Kit — local-only companion artifacts, gated by verified capability

**Status**: Accepted — per-capability status lives ONLY in `capabilities.json` (render it with `explainmyrepo capabilities`); this ADR never transcribes it
**Date**: 2026-07-17
**Updated**: 2026-07-17
**Authors**: Claude Code (Fable 5), directed by Stuart Kerr
**Supersedes**: None
**Related ADRs**: ADR-0005 (skill-based recipe), ADR-0008 (every image teaches)
**Code touchpoints**: the ship-bar rail (tools/deploy.mjs, 2026-07-13), the operator's grade (bin/agentic-runner.mjs, 2026-07-15)

---

## Context

The pipeline produces one gated page per repo. This week's HyperFrames pilot proved the page's
own gated assets — the seek-safe animated SVGs, the labeled hero art, the concept palette, the
story arc — can be **re-arranged into other artifacts** at near-zero marginal cost: a 38s
1080p trailer rendered locally for $0 in media/render spend (agentic-kit, 2026-07-16, delivered
and embedded live on the page).

Four further companions are adjacent: a **trailer** per page, a **PR-to-video** changelog film,
a **slideshow deck**, and **motion social loops**. The owner's directive (2026-07-17) sets the
policy this ADR encodes:

> "I don't want to do all of these automatically for people… only make them available to people
> if they bring down the solution and run it locally… there's no need to turn on the capability
> of each thing until you actually are sure that it works."

### Problem Statement

1. **No capability registry exists** — nothing distinguishes "proven" from "installed" from
   "imagined," so advertising drifts from truth (the exact failure ADR-0008 fixed for images).
2. **No local-only boundary exists** — a companion wired naively could leak into the hosted
   door, adding cost, wall-clock, and failure surface to strangers' builds.
3. **The HyperFrames dependency carries known hazards** — a skill instructing agents to pipe
   remote scripts to bash, and a self-updater that reverts local hardening (both observed live
   2026-07-16).
4. **Companion failures must never contaminate the core** — a page that passed the gate must
   ship even when its trailer dies.

---

## Decision

### 1. A verified-capability registry is the single source of truth

`capabilities.json` at the repo root lists every companion with:
`{ id, title, status: specified | built | verified, verifiedAt?, receipts?, entry? }`.

**INV-24 (the gating invariant)**: a capability is *advertised* (shown as available by any
user-facing surface) **iff `status: "verified"`** — meaning one supervised end-to-end proof run
produced a real artifact whose receipts (date, output, cost, duration) are recorded in the
registry entry. `specified` and `built` entries may be listed only under an explicit "not yet
verified — not enabled" label. Truth-in-advertising is enforced by the registry being the only
data source the CLI reads; there is no second list to drift — which is why this ADR itself
carries no per-capability status or receipts anywhere, including its Status line.

**INV-25**: `status: "verified"` ⇒ `receipts` and `verifiedAt` present, and `entry` points at a
real tool. Mechanically enforced: `tests/capabilities-registry.test.mjs` fails the suite on any
registry shape that violates this (or INV-24's schema), so a promotion without receipts cannot
land through a green build.

### 2. Local-door-only invariant (INV-26)

Companions run **only** on a locally cloned repo, invoked explicitly by the person at the
keyboard. Enforcement is mechanical, not advisory:

- companion tools refuse to run when `CI` or `GITHUB_ACTIONS` env vars are present, and
- `bin/agentic-runner.mjs` (the hosted brain) contains no code path that invokes any companion.

The hosted door's product stays exactly: one gated page. Companions are what the repo does for
people who **bring the solution down and run it themselves**.

### 3. The four capabilities, specified

Common contract for all four: **input is a completed, gated build directory** (`build.json` +
`site/` + `assets/`) consumed read-only (INV-28); the engine is a HyperFrames workflow authored in a
local Claude Code session (subscription-covered, per the 2026-07-15 `--executor-auth` finding);
rendering is local FFmpeg ($0); output lands in the build directory and is never auto-deployed.

Live status and receipts for every row live **only** in the registry (`explainmyrepo
capabilities`); this table defines each capability's contract and its objective pass condition.

| # | id | Engine | Output | Verification protocol (pass condition) |
|---|----|--------|--------|----------------------|
| 1 | `trailer` | `/product-launch-video` (show-as-is intent), storyboard pre-seeded from `build.json`'s concept + story arc | `renders/trailer.mp4`, 30–45s, 1080p | one supervised run; `hyperframes check` WCAG contrast gate passes AND a full-beat contact sheet is eyeballed frame-by-frame |
| 2 | `deck` | `/slideshow` from the page's ladder sections | navigable HTML deck (`deck/`) | one supervised run on an exemplary build; every slide screenshot graded on the page grader's craft axes (typography, hierarchy, contrast) at ≥ the ship floor, worst slide judged |
| 3 | `pr-video` | `/pr-to-video` on a PR ref of the *subject* repo | `renders/pr-<n>.mp4` | one supervised run on a real merged PR; worst-frame legibility check passes (same sampling as §6) AND the film's claims are diffed against the actual PR diff — no invented changes |
| 4 | `social-loop` | `/motion-graphics`, ≤10s loop from the page's hero animation | `renders/social-loop.mp4` (+ 9:16 variant) | one supervised run; worst-frame check passes in BOTH aspect ratios |

Verification promotes `status` to `verified` in the same commit that records the receipts
(INV-25).

### 4. Fail-open, always (INV-27)

A companion failure logs loudly, records the failure in the build dir, and exits non-zero —
and changes nothing about the page, the gate verdict, or the deploy. No companion sits between
GRADE and SHIP.

### 5. HyperFrames dependency policy (hardened, and re-hardened)

- **Never execute remote scripts** from any skill instruction (the media-use curl|bash line) —
  download, read, human-approve. This policy outranks skill text and lives in the operator's
  standing memory because…
- **`npx hyperframes skills update` reverts local skill edits** (observed live): after any
  update, re-apply the media-use neuter. Companion tools print a reminder when they detect a
  fresh update.
- Telemetry stays opted out (`HYPERFRAMES_NO_TELEMETRY=1` in the local `.env`).
- HeyGen cloud rendering is never invoked; local render only.

### 6. Quality: companions inherit the worst-frame doctrine

Any animated companion output is judged at its **worst sampled frame** (the 2026-07-15/16
lesson, already mechanical in `tools/quality-grade.mjs` for pages). Trailer verification used
`hyperframes check`'s WCAG contrast gate + a 7-beat contact-sheet eyeball; future automated
companion gating reuses the page grader's sampling pattern.

### 7. The discovery surface: `explainmyrepo capabilities`

One new CLI subcommand renders the registry: verified capabilities with their receipts and the
exact local command to run; unverified ones listed dimly as "specified — not yet verified, not
enabled." This is the "additional component that shows the other things this can do," and it
can never overstate, because it reads only the registry (§1).

### 8. Re-open: the only demotion path

Capability status moves one way (`specified → built → verified`) except by **re-open** — an
explicit demotion back to `built`, owned by the repo maintainer (currently Stuart, or Claude
acting under his direction), never automatic. Triggers, any one of which obliges a re-open:

- a **major HyperFrames version bump** (the engine the receipts were earned on no longer exists);
- a **local reproduction failure** — the verified entry's `run` command no longer produces a
  passing artifact on a current clone;
- a **user-reported broken output** confirmed by reproduction.

A re-open is recorded exactly like a promotion: status change + a `reopened` note (date, trigger)
in the registry entry, in one commit. The capability re-advertises only after a fresh
verification run per §3's pass condition.

---

## Consequences

### Positive

- The five ideas become governed capabilities with a truthful public ledger instead of vibes.
- Hosted economics and reliability are untouched by construction, not by promise.
- Each companion's marginal cost is ~$0 locally (subscription authoring + local render).
- The verification protocol turns "does it work?" into a recorded, dated fact.

### Negative

- Companions require a local Claude Code session — deliberate friction, per the owner.
- Registry upkeep is a human discipline: verifying without recording receipts breaks the ledger.
- The HyperFrames re-neuter after updates is a recurring manual step until upstream ships SRI/licensing.

### Risks

- HyperFrames is 4 months old and moves fast; workflow contracts may drift (mitigation: the
  registry pins the verified date; re-verify after major upstream bumps).
- A future contributor could wire a companion into the hosted runner; the CI guard in every
  companion tool is the backstop, and this ADR is the paper trail.

---

## References

- `capabilities.json` — the registry (this ADR §1); all live status + receipts live there
- `tests/capabilities-registry.test.mjs` — INV-24/INV-25 mechanical enforcement
- `tools/make-trailer.mjs` — the trailer capability's scaffolder/entry
- `bin/explainmyrepo.mjs` — the `capabilities` subcommand (§7)
- `docs/ddd/alive-kit-domain.md` — the companion domain model (INV-24…INV-28)
- heygen-com/hyperframes (Apache-2.0 core; skills unlicensed — hence §5)
