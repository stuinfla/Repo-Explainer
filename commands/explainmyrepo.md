---
description: Build a bespoke, art-directed explainer site (+ downloadable AI knowledge pack) for any GitHub repo
argument-hint: <github-url>
---

# /explainmyrepo `<github-url>`

You were invoked with: **$ARGUMENTS**

`$ARGUMENTS` is (or should contain) a GitHub repository URL — the repo to explain.

## What to do

Invoke the **Repo Explainer skill** at `skills/explainmyrepo/SKILL.md` and run it
**end-to-end** on the GitHub repository URL in `$ARGUMENTS`. That skill is **the brain** —
the single source of truth for this command (ADR-0005 D1 / D9, INV-08). This command file is a
**thin door**: it contains no explainer logic of its own; it only validates the input and hands
control to the skill.

1. **Parse the URL.** Extract `{owner}/{repo}` from `$ARGUMENTS`. If `$ARGUMENTS` is empty or is
   not a recognizable GitHub URL, stop and ask the user for a GitHub repo URL — do **not** guess.
2. **Run the skill.** Load `skills/explainmyrepo/SKILL.md` and follow it exactly. It owns all
   judgment (understand → conceive → author → judge); the pure tools in `tools/` (see
   `tools/CONTRACT.md`) do all mechanics; one `build.json` (`BuildContext`) carries the work
   station to station.
3. **Honor the contract.** Every tool is invoked as `node tools/<name>.mjs <build-dir>`, reads
   only its declared inputs, merges its slot into `build.json`, and **fails loud** (non-zero exit,
   clear message) — never a silent placeholder. Read `tools/CONTRACT.md` before running any tool.
4. **Report honestly.** When the build finishes, return the live URL, the explainer repo, the AI
   knowledge pack link, the dual-gate scorecard, and both screenshots. If any station could not
   clear its bar (e.g. a criterion that genuinely cannot reach 95), **flag it honestly** — never
   ship slop and call it done (INV-05).

> The completion bar is the mission, not a slogan: a stranger looks at the result and smiles —
> *"that's really cool."* If a build cannot clear that bar, it is not done.
