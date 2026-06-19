# ruvn — Resonance Canon (the content standard)

> Purpose: the concrete, non-ethereal way to explain **ruvn** so a **non-technical Claude-Code user** goes "oh — *that's* what it's for." This is the binding content for the hero + §01 + the lead example + the use-case gallery of the ruvn explainer site. Every claim here is grounded in the real repo (`github.com/ruvnet/ruvn`, HEAD `5b5dd7247bd9e0f61bdce2fee6730692b9606977`). No invented features. Source file is cited after each load-bearing claim.

---

## Provenance (put this on the page — mandatory)
- **Original author:** Reuven Cohen / @ruvnet.
- **Source repo:** <https://github.com/ruvnet/ruvn> · package `@ruvnet/ruvn` v0.1.1 (`package.json:2-3`).
- **HEAD sha at canon time:** `5b5dd7247bd9e0f61bdce2fee6730692b9606977` ("fix(npm): bin path bin/cli.js (npm strips ./), publish 0.1.1").
- **Generated with** [`metaharness`](https://github.com/ruvnet/agent-harness-generator) — template `vertical:research`, generator 0.1.0, generated `2026-06-16` (`.harness/manifest.json`). ruvn is itself a MetaHarness output — the explainer can honestly say "this is what MetaHarness *makes*."

---

## The one plain sentence (lead with this)
**ruvn is an AI research assistant that turns a question into a graded, cited evidence dossier — it searches the web, gives every source a letter grade for trustworthiness, writes its answer using only the trustworthy ones, tries to prove itself wrong, and hands you a report where every single claim has a receipt.** (`README.md:3-5`, `CLAUDE.md:7-9`)

## Translate the abstraction down to earth (kill the jargon)
The repo's own one-liner is *"Gamma-entrainment protocol research agent — compare modalities/dosing, grade evidence, verify signed session bundles (ruv-neural)"* (`package.json:3`). That is precise but it lands on a normal person like a brick. Say it like this instead:

- When you ask a normal AI chatbot to "research" something, it blends good sources and bad sources into **one confident paragraph** — and you can't tell which parts came from a peer-reviewed paper and which came from a random forum post. It sounds sure of itself either way. That's the trap. (`README.md:13-15` — "Most 'ask an AI' research blends good and bad sources into one confident answer. `ruvn` refuses to.")
- ruvn is a **research process with checkpoints**, not a single answer. It runs **six specialist helpers in a line**, and — this is the clever part — **each helper only sees what the one before it produced, never the raw mess.** So information is *forced* to pass through a grading gate and a fact-checking gate before it ever reaches you. (`README.md:15`, `CLAUDE.md:9-11`)
- The six helpers, in plain words (`README.md:21-28`, `CLAUDE.md:13-22`):
  1. **scout** — breaks your big question into 3–7 precise little questions. *"What exactly do we need to find out?"* (`src/agents/scout.ts`)
  2. **web-searcher** — goes and finds raw sources for each little question; doesn't judge yet, just collects. *"Go find the sources."* (`src/agents/web-searcher.ts`)
  3. **source-grader** — opens each source and stamps it **A, B, C, or D** for how much you can trust it. *"Which of these can we actually trust?"* (`src/agents/source-grader.ts`)
  4. **synthesizer** — writes the findings **using only the A and B sources.** The C's and D's are not allowed in. *"Summarize — but only from the good stuff."* (`src/agents/synthesizer.ts`)
  5. **fact-checker** — goes back and tries to *disprove* every claim; anything it can't support gets deleted. *"Try to prove each statement wrong, and cut what fails."* (`src/agents/fact-checker.ts`)
  6. **citer** — final pass: attaches a numbered citation to **every** claim and builds the bibliography with the grades shown. *"No claim ships without a receipt."* (`src/agents/citer.ts`)
- **What you get back:** a Markdown dossier — a TL;DR up top, a body where every sentence is cited, and a bibliography with a letter grade next to each source. (`README.md:30`, `CLAUDE.md:32-33`)

### How the grading actually works (show this as a simple table)
(`README.md:36-42`, `CLAUDE.md:26-29`, `src/agents/source-grader.ts`)

| Grade | What it means | Allowed in the answer? |
|-------|---------------|------------------------|
| **A** | Primary source (a real paper, an official doc), under ~2 years old, on-topic | ✅ Yes |
| **B** | Reputable secondary source (major outlet, named expert), under ~5 years | ✅ Yes |
| **C** | Tertiary (Wikipedia, a summary) — background only, **not** evidence | ❌ No |
| **D** | Discarded (forum post, unsourced claim, dead link) | ❌ No |

The whole point in one line: *the synthesizer is only allowed to use A and B.* (`README.md:42`) And the fact-checker holds the bar higher still — a claim must be backed by **one grade-A source or two grade-B sources** or it gets stripped out. (`src/agents/fact-checker.ts`)

## Answer the stakes, explicitly and early
- **What does it actually DO?** It does disciplined research *for* you — finds sources, grades them, writes only from the trustworthy ones, fact-checks itself, and gives you a cited report instead of a confident guess. (`README.md:13-30`)
- **Why do I care?** Because a confident-but-wrong answer is the most expensive kind. ruvn makes the AI **show its work** — you can see which claim came from which source, and how good that source is, at a glance. No more "trust me."
- **Why do I need it?** Because the AI you already use doesn't grade its sources by default — it just answers. ruvn bolts a *grading-and-verification discipline* onto the AI you already have, so "research" stops meaning "plausible paragraph" and starts meaning "evidence you can check." (`README.md:13-15`)
- **Why is it important?** Because the output is **auditable**. Every claim has a citation; every source has a grade. You — or a colleague, or a skeptic — can re-check it. That's the difference between a vibe and a dossier. (`README.md:30`, `src/agents/citer.ts` — "The dossier must NOT contain any claim without a citation.")

## THE grounding example (concrete, relatable, before→after) — use this as §01's anchor
**Dr. Priya runs a small wellness studio.** She's heard clients ask about "40 Hz light-and-sound therapy" for focus and sleep, and she wants to know whether there's *real evidence* before she says anything to anyone. She is not a scientist and she does not have time to read forty tabs. She uses Claude Code (mostly for her booking spreadsheets), so she has the AI right there.

- **Before:** She asks her normal AI chatbot, *"Does 40 Hz light therapy actually help with sleep?"* It hands her one smooth, confident paragraph. It *sounds* authoritative. But she has no idea whether that confidence came from a 2024 clinical trial or from a supplement-seller's blog — they're blended together with no labels. She can't tell what to trust, can't cite anything to a client, and can't tell what's hype. So she's stuck: a paragraph she can't stand behind.
- **After ruvn:** She installs it once (`npm i -g @ruvnet/ruvn`, then `ruvn init`), and asks Claude Code to run the ruvn research pipeline on the same question. (`README.md:49-58`) Now it: splits her question into precise sub-questions (scout), goes and finds the sources (web-searcher), **grades each one A/B/C/D** (source-grader), writes the findings **using only the A's and B's** (synthesizer), then **tries to prove each statement wrong and deletes anything it can't back up** (fact-checker), and finally hands her a dossier where **every claim has a numbered citation and every source shows its grade** (citer). She gets back a TL;DR, a cited body, and a bibliography — she can see that the strong claims rest on a graded-A 2024 paper and the weak ones were thrown out. Now she can actually tell a client, honestly, "here's what the good evidence says, and here's what it doesn't." (`README.md:21-30`)
- **The "oh, that's what it's for" line:** *It's the difference between an AI that hands you a confident paragraph you can't check, and one that hands you a graded, cited dossier you can.*

> Honest framing to keep on the page: ruvn was *built* for exactly this kind of question — it was made for the **ruv-neural** gamma-entrainment (40 Hz) research project — but the repo is explicit that **"it works for any research question."** (`README.md:7-8`) The medical framing is the origin story, not a limit. And ruvn itself is a *research* tool: it grades and cites evidence; it does **not** give medical advice or make efficacy claims (`README.md:9`).

## 'Why this vs what I already have?' — the differentiation (put this head-on)
The reader almost certainly already has the AI host (Claude Code, Codex, Copilot…). So answer it directly:

- **"I already have Claude Code — why do I need ruvn too?"** Claude Code is the brilliant *generalist brain*. Out of the box, when you say "research X," it gives you one confident blended answer — it does **not**, by default, grade each source, refuse to use the weak ones, adversarially fact-check itself, and attach a citation to every claim. ruvn is the **discipline layer** that makes it do all of that, every time, in a fixed order. (`README.md:13-15`)
- **It doesn't replace your AI — it *rides inside* it.** ruvn ships no model of its own; the kernel "makes no model calls — your host provides the model." (`README.md:99`) You keep your same AI, your same login, your same bill. ruvn just adds the six-agent research pipeline and the grading rubric on top. (`README.md:47`, `bin/cli.js`)
- **The structural trick you don't get for free:** each agent only sees the previous agent's output, so good info is *forced* through grading + verification gates. That's a deliberate pipeline design, not something a single chat prompt reliably reproduces. (`README.md:15`, `CLAUDE.md:9-11`)
- **Before → after on your own question** (use as a side-by-side):
  | | Plain AI chat | With ruvn |
  |---|---|---|
  | Sources | Blended, unlabeled | Each graded A/B/C/D (`source-grader`) |
  | What the answer is built from | Whatever it found | **A & B sources only** (`synthesizer`) |
  | Self-checking | None by default | Adversarial fact-check; unsupported claims **deleted** (`fact-checker`) |
  | Citations | Sometimes, inconsistently | **Every** claim cited or it doesn't ship (`citer`) |
  | What you can hand a skeptic | "Trust me" | An auditable dossier |

## The collapsible gallery — ≥5 varied real-world uses (each: situation → command → what it does → what you get)
Sequence AFTER the grounding example, BEFORE "how to implement." Each is a collapsible card with its own visual (situation → command → pipeline → graded dossier). All five use the *same* pipeline (`scout → web-searcher → source-grader → synthesizer → fact-checker → citer`, `README.md:19`) — the variety is in the question and the audience.

1. **Check a health/wellness claim before you repeat it.**
   *Situation:* a client/friend asks "does 40 Hz light-and-sound therapy help sleep or focus?" and you don't want to parrot hype.
   *Command:* `ruvn init`, then in Claude Code ask it to run the ruvn dossier pipeline on the question. (`README.md:49-58`)
   *What it does:* scouts sub-questions → finds sources → grades each A–D → writes only from A/B → fact-checks → cites. (`README.md:21-28`)
   *What you get:* a TL;DR + cited body + graded bibliography you can actually stand behind — and the honest reminder that this is research, not medical advice. (`README.md:9,30`)

2. **Decide between two options with real evidence (compare modalities/dosing).**
   *Situation:* you're weighing option A vs option B — exactly the "compare modalities/dosing, responder profiles, safety evidence" job ruvn was built for. (`README.md:7-8`, `package.json:3`)
   *Command:* ask ruvn a comparative question ("X vs Y for outcome Z, and what does the safety evidence say?").
   *What it does:* scout splits it into the precise comparison sub-questions; grading keeps only trustworthy sources; fact-checker flags contradictions and strips unsupported claims. (`src/agents/scout.ts`, `src/agents/fact-checker.ts`)
   *What you get:* a side-by-side, cited dossier where contradictions are flagged explicitly (the synthesizer is told to "Flag contradictions explicitly," `src/agents/synthesizer.ts`).

3. **Sanity-check a viral or scary claim ("does X cure Y?").**
   *Situation:* a sensational headline is going around and you want the honest status.
   *Command:* feed ruvn the claim verbatim ("Claim: '<the headline>.' Verify it against current evidence").
   *What it does:* the fact-checker is adversarial by design — it marks each claim CONFIRMED / DISPUTED / UNSUPPORTED and **strips the UNSUPPORTED ones.** (`src/agents/fact-checker.ts`; the repo's own validation even runs this on "40 Hz light flicker cures Alzheimer's", `scripts/openrouter-validate.mjs:20`)
   *What you get:* a verdict backed by graded sources, with the hype removed — not a polite hedge.

4. **Build a cited brief for a report, post, or decision.**
   *Situation:* you need a short, defensible write-up that a manager or audience can trust.
   *Command:* run the dossier pipeline on your topic.
   *What it does:* the citer's job is literally "every claim must cite a graded source… the dossier must NOT contain any claim without a citation." (`src/agents/citer.ts`)
   *What you get:* a ready-to-paste Markdown dossier — TL;DR, fully-cited body, bibliography with [A]/[B]/[C] tags. (`README.md:30`, `src/agents/citer.ts`)

5. **Wire research into your existing tools — whichever AI you use.**
   *Situation:* your team isn't all on Claude Code; some use Codex, Copilot, OpenCode, or CI.
   *Command:* point the host at the shipped config — ruvn ships adapters for **9 hosts** (Claude Code, Codex, GitHub Copilot, OpenCode, GitHub Actions, pi-dev, Hermes, OpenClaw, RVM). (`README.md:47,64-74`, `.harness/manifest.json` hosts list)
   *What it does:* the same six-agent pipeline drops into each host via its own config file (e.g. `.claude/settings.json`, `.codex/config.toml`, `.vscode/mcp.json`). (`README.md:66-74`)
   *What you get:* the identical graded-and-cited research discipline, no matter which AI your teammate happens to use.

6. **Automate research in CI (research on a GitHub issue/comment).**
   *Situation:* you want a dossier generated automatically when someone files an issue or comments.
   *Command:* the shipped GitHub Actions host fires on `workflow_dispatch` or an issue comment and runs the harness non-interactively. (`.github/workflows/ruvn.yml`, `.github/actions/ruvn/action.yml`)
   *What it does:* runs the harness against the comment/event as the task, with a default-deny `contents: read` permission posture. (`.github/workflows/ruvn.yml` — "ADR-022 default-deny")
   *What you get:* hands-free, repeatable research wired into your repo's workflow.

## How to implement (put this AFTER the gallery) — the concrete on-ramp
Straight from the repo (`README.md:49-58`):
```bash
npm i -g @ruvnet/ruvn   # installs the `ruvn` command
ruvn init               # wires the harness into Claude Code (.claude/ settings + plugin)
ruvn doctor             # health check — confirms the kernel + host adapter load
# or one-off, no install:  npx @ruvnet/ruvn init
```
Then, in Claude Code, ask it to run the research pipeline on your question — the agents and the grading rubric in `CLAUDE.md` are now available to it. (`README.md:58`)

**Want to prove it against a live model first?** Set an OpenRouter key and run the validation — it exercises all 6 agents on a real sample question and each must return a sensible, on-task answer. (`README.md:78-87`, `scripts/openrouter-validate.mjs`)
```bash
export OPENROUTER_API_KEY=sk-or-...
npm run validate:openrouter
```

**What's actually inside** (for the "what do I get" visual — show the real pieces):
- 6 agent definitions, each a plain prompt + model tier you can read and tweak (`src/agents/*.ts`). scout/grader/synth/fact-check/citer run on the **sonnet** tier; web-searcher runs on the cheaper **haiku** tier (`src/agents/*.ts` `TIER` fields).
- A tiny CLI: `init`, `doctor`, `--version` (`bin/cli.js`).
- Host config for 9 hosts (the `.claude/`, `.codex/`, `.vscode/`, `.opencode/`, `.openclaw/`, `.github/`, plus `AGENTS.md`/`SYSTEM.md`/`trust.json`/`cli-config.yaml`/`rvm.manifest.toml` files). (`README.md:64-74`)
- A real smoke test that boots the kernel + host adapter so a broken install fails loudly (`__tests__/smoke.test.ts`).

## Honest limits (state plainly, don't hide)
- **Early beta — v0.1.1.** This is a young, small package. (`package.json:2`)
- **It's a *research* tool, not an oracle.** The repo says it plainly: it grades and cites evidence; it does **not** give medical advice or make efficacy claims, and its output is *"a starting dossier to verify, not a conclusion."* (`README.md:9`)
- **It needs a host with web access.** ruvn ships **no model of its own** — the kernel makes no model calls; your AI host provides the brain and the web-search tool (`README.md:99`, web-searcher uses the host's WebFetch/WebSearch, `src/agents/web-searcher.ts`). No host, no run.
- **Quality is bounded by what's findable and by the grader's judgment.** Grades are assigned by an AI applying the A/B/C/D rubric — solid, but not a human peer-reviewer. Treat the dossier as a strong first pass to verify.
- **Domain DNA.** It was built for the gamma-entrainment / ruv-neural project, so its built-in examples and validation tasks are 40 Hz-flavored (`scripts/openrouter-validate.mjs`). The *pipeline* is general; the examples just smell of its origin.
- **"Signed session bundles" is the sibling tool's job.** The "verify signed session bundles" phrase in the one-liner belongs to **ruv-neural** (the closed-loop OS that runs/measures/signs protocols); ruvn is the *research front-end* — gather and grade evidence. Don't oversell ruvn as the protocol-signer. (`README.md:104-106`)
