# Running a build through Codex (near-zero text-model cost)

`explainmyrepo` normally calls the Anthropic Messages API for its brain steps (`src/claude.mjs`)
and the OpenAI API for imagery and the vision grade. Both are metered per call.

There is a cheaper door. Run the build **as a Codex session**, signed in with a ChatGPT
subscription, and Codex itself becomes the brain. Authoring and grading then cost nothing beyond
the flat subscription you already pay for.

This is not a new pipeline. It is the same skill (`skills/explainmyrepo/SKILL.md`) entered through
a different door, which is exactly what INV-08 ("one brain, many doors") anticipates.

---

## Why this works

Each vendor ships two doors, and they bill differently.

| | subscription door (flat) | metered API door (per call) |
|---|---|---|
| Anthropic | `claude` CLI, backed by Claude Max | `api.anthropic.com` + `sk-ant-…` |
| OpenAI | `codex` CLI, backed by ChatGPT Plus/Pro | `api.openai.com` + `sk-…` |

The npx CLI knocks on the metered doors. A Codex session knocks on the subscription door.

Codex is a coding agent, not an image model, so it does not produce imagery. It does not need to:
`tools/generate-image.mjs` calls the OpenAI image API directly. Codex conducts, the tool paints.
Codex *does* accept image input (`codex --image`), so it can read the rendered screenshots and run
the Gate A/B quality grade itself.

### What each step costs

| Step | Engine | Cost |
|---|---|---|
| Understand, author, grade | Codex on a ChatGPT subscription | $0 marginal |
| Embeddings for the KB | `bge-small-en-v1.5`, runs locally | $0 |
| Imagery (hero, problem, use-case) | `gpt-image-2` via the OpenAI API | cents per image |

Image generation is the only unavoidable metered spend, and it lands well under $1 per build.

---

## Setup

```bash
npm install -g @openai/codex
codex login          # choose "Sign in with ChatGPT"
codex login status   # must print: Logged in using ChatGPT
```

Optional full-auto aliases, so Codex does not stop for approvals mid-build (zsh shown; use
`~/.bashrc` on bash):

```bash
echo -e "alias cdsp='codex --dangerously-bypass-approvals-and-sandbox'\nalias cdsp-c='codex resume --last --dangerously-bypass-approvals-and-sandbox'" >> ~/.zshrc && source ~/.zshrc
```

`--dangerously-bypass-approvals-and-sandbox` lets the agent run commands without confirming each
one. Use it only in a repo you trust.

`.env` needs `OPENAI_API_KEY` for imagery. No `ANTHROPIC_API_KEY` is required on this path.

---

## Before you set `LOCAL_REPO_PATH`: a real footgun

This flow builds from a **local checkout** rather than cloning, which keeps private source off the
network. That introduces one sharp edge.

`git -C <dir>` **walks up** the directory tree until it finds a `.git`. Point it at a folder that is
not itself a repository and git silently resolves to some *ancestor* repo. `git archive` will then
package the wrong source. If a home directory happens to be a git repo, that can mean archiving a
home directory, secrets included, straight into the knowledge base.

Check before you trust a path:

```bash
git -C "$LOCAL_REPO_PATH" rev-parse --show-toplevel   # must equal $LOCAL_REPO_PATH exactly
git -C "$LOCAL_REPO_PATH" remote get-url origin       # must be the repo you intend to explain
```

A wrapper folder such as `~/Projects/Foo/` that merely *contains* `Foo/` is the classic trap. Point
at the inner directory. The prompt below asserts both conditions before it writes anything, which is
the INV-21 source-identity rule enforced by hand.

---

## Fill these in

| Placeholder | Meaning | Example |
|---|---|---|
| `{{OWNER}}` | GitHub owner of the source repo | `acme` |
| `{{NAME}}` | Repo name, exact case | `WidgetKit` |
| `{{SLUG}}` | lowercase, hyphenated build slug | `widgetkit` |
| `{{LOCAL_REPO_PATH}}` | absolute path to the **real** git root | `/Users/you/Projects/WidgetKit` |
| `{{PRIVATE}}` | `true` or `false` | `true` |
| `{{BRANCH}}` | default branch | `main` |

Start the session inside this repo, then paste the prompt:

```bash
cd /path/to/Repo-Explainer
cdsp
```

---

## The prompt

```text
You are the "brain" of the explainmyrepo pipeline in THIS repo. Read
skills/explainmyrepo/SKILL.md fully first (plus tools/CONTRACT.md) — that is the
authoritative recipe. You make ALL judgments (understand, conceive, author, grade);
the pure tools in tools/*.mjs do the mechanics. Follow SKILL.md station by station,
with these THREE overrides:

── OVERRIDE 1: SOURCE IS LOCAL, NEVER CLONE ──────────────────────────────────
The target is a local checkout of {{OWNER}}/{{NAME}} at {{LOCAL_REPO_PATH}}.
Do NOT run tools/clone-repo.mjs and do NOT touch the network. Prepare the source:

  cd "$(git rev-parse --show-toplevel)"
  SRC="{{LOCAL_REPO_PATH}}"
  # INV-21 source-identity guard. `git -C` walks UP to an ancestor repo when SRC is
  # not itself a git root, which would archive the wrong source entirely.
  [ "$(git -C "$SRC" rev-parse --show-toplevel)" = "$SRC" ] \
    || { echo "ABORT: $SRC is not a git root (git resolved elsewhere)"; exit 1; }
  git -C "$SRC" remote get-url origin | grep -q "{{OWNER}}/{{NAME}}" \
    || { echo "ABORT: $SRC is not {{OWNER}}/{{NAME}}"; exit 1; }

  BUILD="explainer-builds/{{SLUG}}"
  rm -rf "$BUILD" && mkdir -p "$BUILD/repo"
  # export ONLY git-tracked files: no build output, no .git, no network
  git -C "$SRC" archive HEAD | tar -x -C "$BUILD/repo"
  ABS="$(cd "$BUILD/repo" && pwd)"
  cat > "$BUILD/build.json" <<JSON
  {
    "repo": {
      "url": "https://github.com/{{OWNER}}/{{NAME}}",
      "owner": "{{OWNER}}", "name": "{{NAME}}", "slug": "{{SLUG}}",
      "private": {{PRIVATE}}, "defaultBranch": "{{BRANCH}}",
      "clonePath": "$ABS", "reachable": true
    }
  }
  JSON
  echo "seeded with $(find "$BUILD/repo" -type f | wc -l) source files"

Then resume at SKILL.md Station 1: register a "{{SLUG}}" target in kb/kb.config.mjs
(copy an existing target's shape; set repoDir to the ABS path above and the embed block
to Xenova/bge-small-en-v1.5, 384-dim — SKILL.md explains why the explicit embed block is
required), run node tools/build-kb.mjs "$BUILD", author + index the primer, then proceed
concept → content → visual-brief → images/diagrams → assemble → grade.

── OVERRIDE 2: MODEL ROUTING (subscription first, minimise API) ──────────────
YOU (Codex, on the ChatGPT subscription) do ALL authoring and ALL quality judgment: the
primer, concept, content, visual briefs, and the Gate A/B + six operator questions.
Images are made by tools/generate-image.mjs via OPENAI_API_KEY in .env — expected and
fine (a few cents each). For grading, run node tools/quality-grade.mjs "$BUILD" to RENDER
the 390px + 1440px screenshots; then OPEN those PNGs under "$BUILD/assets/" and grade them
YOURSELF against the verbatim Gate A/B rubric in SKILL.md, writing the quality slot.
Refine-loop until BOTH devices clear: mean ≥ 90, min axis ≥ 85, all six operator YES.

── OVERRIDE 3: SHIP OR HOLD ──────────────────────────────────────────────────
If the source repo is PRIVATE: stop after the quality gate passes. Do NOT run deploy,
publish-repo, repo-seo, or notify (Stations 8/8b/9); publishing an explainer of private
code exposes it publicly. Leave the finished site + AI pack in explainer-builds/{{SLUG}}/.
If the source repo is PUBLIC and you were told to ship: run Station 8 as SKILL.md defines.
Either way, print the final scorecard and the absolute path to the assembled index.html.

Ground every claim in the KB (INV-06). Fail loud, never fake a station. Begin.
```

---

## What you get

- `explainer-builds/{{SLUG}}/site/` — the assembled, graded explainer page
- `explainer-builds/{{SLUG}}/` — the downloadable AI knowledge pack (RVF vector KB plus MCP server)
- A printed scorecard for mobile (390px) and desktop (1440px)

On large repos the KB build dominates wall-clock, because it embeds every tracked source file
locally.

---

## Notes and limits

- **Private repos stay private.** Nothing is cloned and nothing is deployed under Override 3. The
  source never leaves the machine except as imagery prompts, which describe the concept rather than
  the code.
- **Grading calibration.** The numeric bar (mean ≥ 90, min axis ≥ 85) was tuned against the vision
  grader in `tools/quality-grade.mjs`. A different grader is a different harsh critic, so treat the
  first Codex-graded build as a recalibration point rather than a like-for-like score.
- **A first-class local-source mode** (an `EXPLAINER_SOURCE_DIR` env var on `clone-repo.mjs`, with
  both guards enforced in code rather than in a prompt) would remove the hand-rolled seeding above.
  Happy to send that as a follow-up PR if it is wanted.
