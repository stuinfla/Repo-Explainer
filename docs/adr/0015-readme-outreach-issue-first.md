# ADR-0015 — README outreach: issue first, PR on a yes, every send tracked

Status: Accepted + Implemented (station, CLI, ledger, tests). **Response rates are not yet known** —
the tracking exists to find out; no claim is made that this works until it has been measured.
Date: 2026-10-10
Amends: ADR-0005 (Station 8b readme-enhance)
Builds on: ADR-0014 (the diagrams it sends are the per-repo story diagrams)

## Context

Station 8b could offer a source repo's maintainer a better README as a pull request, but it was gated
behind an undocumented env var (`README_ENHANCE=1`), so by default it silently did nothing, and what it
sent was the dependency-graph diagrams appended to the bottom of the file.

The owner's intent, stated across 2026-10-10: when the tool runs on someone's repo, *always* send them
a friendly, visual, one-click suggestion — "this guy really has a grasp on what I built" — written in a
warm first-person voice, with images, leading with the rendered README; and **track whether people
respond**. And, explicitly: "I don't want to be a bad citizen. Only trying to help." They asked for a
recommendation on PR vs issue vs email.

### What we measured before choosing (realiti4/claude-swap, via `gh`, 2026-10-10)

| | |
|---|---|
| Open pull requests | 143 |
| Merged PRs, all time | 107 |
| Closed without merge | 51 |
| PRs opened in the last 14 days | 44 (~3 a day) |
| Open issues | 61 |
| Our PR #447 | 0 comments, 0 reviews, and "1 workflow awaiting approval" for the maintainer |

The maintainer is active and does merge outside work — in bursts, mostly bug fixes from active users.
A docs PR from a stranger lands as roughly the 144th item and costs them a CI-approval click. GitHub's
Acceptable Use Policy lists "bulk distribution of promotions and advertising" and "posting monetized or
excessive bulk content in issues" as prohibited, and bars using information from the Service "for
spamming purposes, including for the purposes of sending unsolicited emails to users". So the risk of
being a bad citizen is real, and it is a matter of volume, burden, and consent, not just of channel.

## Decision

1. **Default channel: an issue that shows the finished work.** The issue contains a one-click link to the
   proposed README *rendered* (hosted in the explainer repo under `readme-proposal/`), the images, the
   explainer link, and an offer: "say the word and I'll open a PR". It touches nothing in their repo
   and triggers no CI.
2. **The PR is the second step, after a yes** — `explainmyrepo outreach open-pr <owner/name>`. It is a
   human step on purpose: judging "sure, go ahead" vs "no thanks" is not something to automate.
   `README_OUTREACH=pr` sends the PR directly for anyone who prefers that.
3. **On by default; one documented off switch** (`--no-readme-pr` or `README_ENHANCE=0`).
4. **Never email.** Addresses can sometimes be found in commit history, but using them for unsolicited
   contact is what the AUP prohibits and is the most intrusive channel. Not built.
5. **Voice.** The default opening makes no claim about the sender's personal experience (the tool can't
   know it). A sender who wants their own first-person tone sets `README_PR_INTRO` / `README_PR_SIGNOFF`.
6. **The README link is the first link and the README image comes before the explainer page** — the
   owner's "you're burying the lead" note, pinned in a test.
7. **Additions only.** Their README comes back as an in-order subsequence of the result. Their ASCII
   diagrams are drawn as animated SVGs *above* the originals, which stay untouched; with none, the
   generated diagrams go just after the intro, not at the bottom.

### Good-citizen rules (enforced in code, each proven by mutation)

- never your own repo, a private repo, or without a live page and a hosted preview;
- **one contact per repo, ever**; a closed or merged item is never re-sent;
- daily cap (default 5, `README_OUTREACH_DAILY_CAP`);
- disclosure: the message says what sent it and how to say no, and that no second message will come;
- every send is appended to `explainer-builds/outreach.jsonl`; `outreach status` polls GitHub and
  classifies each as merged / replied / reacted / discussed / closed / waiting / thumbs-down.

## Consequences

- **The default ships outward-facing behaviour to every user of the npm package.** It is the same class
  as the existing defaults (a public explainer repo, an invite to the source owner), it is documented in
  `--help`, rate-limited, and one flag from off. It is still a real decision, recorded here.
- **A preview needs the explainer repo.** `--no-publish` builds, or a failed push, cannot host the
  rendered README, so no issue is sent (an issue about "see it rendered" with no rendering is worse than
  silence).
- **`publish-repo` force-pushes the site on every build**, which replaces `readme-proposal/`; the
  station re-adds it after, so the preview is always current for the latest build.
- **Open question: does it work?** Nothing here shows maintainers want this. The ledger and `status`
  exist so the answer comes from data. If the response rate is poor, or negative reactions appear,
  the right move is to turn the default off, not to push harder.
- **Not built:** automatic PR-on-reply, a thumbs-up classifier beyond reactions/owner comments, an
  email channel, or a digest feed (the status table is the digest for now).

## Verification (2026-10-10)

- `tests/readme-ascii.test.mjs` (20): detection, lossless conversion, additions-only, idempotence.
- `tests/readme-pr.test.mjs` (22): tone, link order, honesty lines, voice override, who-is-skipped.
- `tests/outreach.test.mjs` (13), `tests/outreach-cli.test.mjs` (9).
- `tests/readme-enhance.station.test.mjs` (16): the real station as a child process in dry-run —
  skip rules, additions-only on disk, ledger rules. The one-contact and daily-cap guards were each
  proven by deleting them and watching a test fail.
