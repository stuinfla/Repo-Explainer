# ruvn — Top-Down Primer

> A synthesized, top-down orientation for newcomers. Seven sections, one per
> stage of the comprehension arc: what it is → what it can do for you → what it
> is made of → how the pipeline works → how mature it is → where the docs live →
> how to install and use it. Every claim is grounded in the cloned repo
> (`README.md`, `CLAUDE.md`, `SYSTEM.md`, `AGENTS.md`, `install.md`,
> `package.json`, `src/agents/*.ts`, `bin/cli.js`,
> `scripts/openrouter-validate.mjs`, `.harness/manifest.json`). The published
> package is **`@ruvnet/ruvn`** and the command it installs is **`ruvn`**
> (package.json L2, L6-8). Upstream: github.com/ruvnet/ruvn @
> `5b5dd7247bd9e0f61bdce2fee6730692b9606977` (2026-06-16), MIT, by Reuven Cohen
> (@ruvnet).

## 1. What is ruvn?

**ruvn is a research agent that turns a question into a graded, cited evidence
dossier.** You ask a research question; it runs a disciplined six-agent pipeline
that searches the web, **grades every source A/B/C/D**, synthesizes findings
*only* from the good sources, adversarially fact-checks every claim, and hands
back a dossier in Markdown where **every claim is cited** and the bibliography
shows a letter grade next to each source. (Source: README.md L1-9; CLAUDE.md
"Output" section.)

It is a small AI-agent **"harness"** — not a model and not a hosted service. It
is a set of specialist agents plus the config to drop them **into an AI coding
host you already use** (Claude Code, Codex, Copilot, and six more). Underneath
you are still talking to your own model; ruvn adds the *discipline*: the
search-grade-synthesize-verify-cite pipeline and the grading rubric. (Source:
README.md L5, L60-75; package.json `@metaharness/host-*` dependencies.)

The point is trust. Most "ask an AI to research X" tools blend good and bad
sources into one confident-sounding answer you cannot check. **ruvn refuses
to** — it grades sources first and only lets grade A/B evidence into the
synthesis, so what you get back is a *starting dossier you can defend*, with
receipts. (Source: README.md L13, "How sources are graded"; src/agents/
synthesizer.ts SYSTEM_PROMPT "Use ONLY grade A and B sources".)

It was built for the [ruv-neural](https://github.com/ruvnet/ruv-neural)
project — comparing **40 Hz gamma-entrainment** stimulation modalities, dosing,
responder profiles, and safety evidence — but it works for any research
question. (Source: README.md L7, "Part of ruv-neural"; package.json
description.)

Also asked as: what is ruvn, what does ruvn give me back, what is an evidence
dossier, what does "graded and cited" mean here, is ruvn a model or a harness,
is ruvn a chatbot or a hosted service, what makes ruvn different from asking an
AI to research something, what was ruvn built for. Keywords: research agent,
graded cited evidence dossier, A/B/C/D source grading, every claim cited,
bibliography with grades, AI-agent harness, drops into your AI coding host,
Claude Code Codex Copilot, not a model not a hosted service, trust receipts
defendable, 40 Hz gamma entrainment, ruv-neural, built for any research
question.

## 2. What can ruvn do for you?

ruvn gives you a **defensible research artifact** instead of a vibes answer. In
plain terms, here is what it does for you that a plain chatbot does not:

- **It grades every source before it trusts it.** Each hit is fetched and graded
  **A** (primary source — paper / official doc, under ~2 years, on-topic), **B**
  (reputable secondary — major outlet / expert, under ~5 years), **C** (tertiary
  — Wikipedia / summary, context only), or **D** (discarded — forum post,
  unsourced claim, dead link). (Source: README.md "How sources are graded";
  src/agents/source-grader.ts SYSTEM_PROMPT.)
- **It only synthesizes from the good stuff.** The synthesizer is *allowed to
  use grade A and B sources only* — that constraint is the whole point. (Source:
  README.md L13 "The synthesizer is **only allowed to use A and B**";
  src/agents/synthesizer.ts.)
- **It adversarially fact-checks the result.** A dedicated fact-checker re-checks
  every claim and asks "is this supported by at least one grade-A or two grade-B
  sources?", flags each as CONFIRMED / DISPUTED / UNSUPPORTED, and **strips
  UNSUPPORTED claims** out of the dossier. (Source: src/agents/fact-checker.ts
  SYSTEM_PROMPT.)
- **It hands you a cited dossier.** The final output is Markdown: a **TL;DR**, a
  **body where every claim carries an inline citation `[1][2]`**, and a
  **bibliography with grade tags `[A] [B] [C]`** — no claim ships without a
  receipt. (Source: src/agents/citer.ts SYSTEM_PROMPT; README.md "You get
  back".)
- **It validates against a real model.** You can exercise the whole agent set
  end-to-end against a live model via OpenRouter
  (`npm run validate:openrouter`), which also runs under `npm test` when
  `OPENROUTER_API_KEY` is set. (Source: README.md "Try it against a real model";
  scripts/openrouter-validate.mjs.)

So the value is a **before → after** you can feel: *before*, you paste a
question into a chatbot and get a fluent paragraph you cannot cite or trust;
*after*, ruvn returns a dossier where you can see exactly which claim came from
which graded source — something you can hand to a reviewer, a clinician, or a
paper. (Source: README.md L5, scope note "a *research* tool … a starting dossier
to verify, not a conclusion".)

Also asked as: what can ruvn do for me, why would I use ruvn, what does ruvn
give me that ChatGPT or Claude does not, what does graded and cited mean in
practice, how does ruvn decide which sources to trust, what is in the final
dossier, can I run ruvn against a real model, what is the before and after of
using ruvn. Keywords: grades every source, A B C D rubric authority freshness
relevance, synthesizer uses only A and B, adversarially fact-checks, CONFIRMED
DISPUTED UNSUPPORTED strips unsupported, cited dossier TL;DR body bibliography,
inline citations grade tags, validate:openrouter live model, defensible research
artifact, before chatbot paragraph after cited dossier.

## 3. What is ruvn made of? (the six agents and nine hosts)

ruvn is a single npm package (`@ruvnet/ruvn`), **not** a multi-crate workspace.
Its "components" are **six pipeline agents** plus the config for **nine AI
hosts**.

**The six agents** live in `src/agents/` as plain prompt + model-tier
definitions (each is a `SYSTEM_PROMPT`, a `NAME`, and a `TIER`), so they are
easy to read and tweak (Source: src/agents/*.ts; README.md "How it's built"):

| # | Agent | Tier | What it does |
|---|-------|------|--------------|
| 1 | **scout** | sonnet | Decomposes your question into 3–7 standalone, web-searchable subqueries |
| 2 | **web-searcher** | haiku | Runs each subquery, collects raw `{url, title, snippet}` hits — no filtering |
| 3 | **source-grader** | sonnet | Fetches each URL and grades it A/B/C/D with a reason and key facts |
| 4 | **synthesizer** | sonnet | Writes findings using grade A/B sources only; flags contradictions |
| 5 | **fact-checker** | sonnet | Adversarially verifies each claim; strips UNSUPPORTED ones |
| 6 | **citer** | sonnet | Adds inline citations and a graded bibliography; renders the dossier |

(Source: CLAUDE.md "Agents" table; src/agents/scout.ts / web-searcher.ts /
source-grader.ts / synthesizer.ts / fact-checker.ts / citer.ts.)

**The nine hosts.** ruvn ships the config each AI host needs so you can drop the
pipeline into whichever you use (Source: README.md "Other hosts" table;
.harness/manifest.json `hosts` array):

| Host | What ships |
|------|-----------|
| **Claude Code** | `.claude/settings.json`, `.claude-plugin/plugin.json` |
| **Codex** | `.codex/config.toml`, `AGENTS.md` |
| **GitHub Copilot** | `.vscode/mcp.json`, `.github/copilot-instructions.md` |
| **OpenCode** | `.opencode/opencode.json` |
| **GitHub Actions** | `.github/workflows/ruvn.yml`, `.github/actions/ruvn/` |
| **pi-dev** | `AGENTS.md`, `SYSTEM.md`, `trust.json` |
| **Hermes** | `cli-config.yaml`, `optional-mcps/ruvn.json` |
| **OpenClaw** | `.openclaw/openclaw.json` |
| **RVM** | `rvm.manifest.toml`, `capability-table.json` |

Underneath, ruvn rides on the metaharness **kernel** (`@metaharness/kernel`) for
orchestration, memory, and trajectory — the kernel does **no model calls**; your
host provides the model. The whole package was *generated* by
[`metaharness`](https://github.com/ruvnet/agent-harness-generator) from its
`vertical:research` template, then extended to all nine hosts. (Source:
README.md "How it's built"; package.json `@metaharness/kernel` +
`@metaharness/host-*` deps; .harness/manifest.json `template: vertical:research`.)

Also asked as: what is ruvn made of, what are the six agents, what does each
agent do, what model tier does each agent use, what are the nine hosts, which
files ship per host, is ruvn a monorepo or one package, what is the metaharness
kernel, who generated ruvn and from what template, where do the agents live.
Keywords: six agents scout web-searcher source-grader synthesizer fact-checker
citer, sonnet haiku tiers, src/agents SYSTEM_PROMPT NAME TIER, nine hosts Claude
Code Codex Copilot OpenCode GitHub Actions pi-dev Hermes OpenClaw RVM, per-host
config files, @metaharness/kernel orchestration memory trajectory no model
calls, generated by metaharness vertical:research template, single npm package
@ruvnet/ruvn.

## 4. How the pipeline works (step by step)

The six agents run **in a line**, and the discipline comes from one rule:
**each agent only sees the OUTPUT of the previous agent, not the raw inputs.**
That forces every piece of information to pass through the grading and
verification gates before it can reach you. (Source: README.md "What it does in
plain language"; CLAUDE.md "Each agent only sees the OUTPUT of the previous
one.")

```
scout → web-searcher → source-grader → synthesizer → fact-checker → citer
```

Step by step (Source: README.md agent table; src/agents/*.ts SYSTEM_PROMPTs):

1. **scout** — "What exactly do we need to find out?" Breaks your question into
   3–7 precise, standalone, non-overlapping subqueries. Output: a JSON list of
   strings.
2. **web-searcher** — "Go find the sources." Runs each subquery via
   WebFetch/WebSearch and collects raw hits; it deliberately does **not** filter
   or summarize. Output per subquery: `{url, title, snippet}`.
3. **source-grader** — "Which of these can we trust?" Fetches each URL and
   assigns **A/B/C/D** with a reason and extracted key facts.
4. **synthesizer** — "Summarize — but only from the good stuff." Writes a
   coherent narrative using **grade A and B sources only**, and flags
   contradictions explicitly. It does **not** cite yet.
5. **fact-checker** — "Try to prove each statement wrong." Adversarially checks
   each claim against the sources, marks it CONFIRMED / DISPUTED / UNSUPPORTED,
   and **strips UNSUPPORTED claims** out.
6. **citer** — "No claim ships without a receipt." Adds inline citations
   `[1][2]` to every claim and builds the graded bibliography, then renders the
   final dossier: **TL;DR + body + bibliography**.

The grading rubric the source-grader applies is the heart of the system —
**only A and B are allowed into the synthesis** (Source: README.md "How sources
are graded"; src/agents/source-grader.ts):

| Grade | Means |
|-------|-------|
| **A** | Primary source (paper, official doc), under ~2 years old, on-topic |
| **B** | Reputable secondary (major outlet, expert), under ~5 years |
| **C** | Tertiary (Wikipedia, summary) — context only, not evidence |
| **D** | Discarded (forum post, unsourced claim, dead link) |

Also asked as: how does the ruvn pipeline work, what is the order of the agents,
why does each agent only see the previous output, what does scout do first, how
does grading gate the synthesis, what does the fact-checker remove, what does the
citer produce, what is the grading rubric, which grades are allowed into the
synthesis. Keywords: scout web-searcher source-grader synthesizer fact-checker
citer in a line, each agent only sees the previous output, grading and
verification gates, 3-7 subqueries JSON, raw hits no filtering, A/B/C/D fetch and
grade, synthesizer grade A and B only flags contradictions, fact-checker
CONFIRMED DISPUTED UNSUPPORTED strips unsupported, citer inline citations graded
bibliography, TL;DR body bibliography, rubric authority freshness relevance.

## 5. Is it production-ready? (scope and honest limits)

**It is v0.1.1 — early and honest about it.** State the limits plainly:

- **It is a *research* tool, not an oracle.** ruvn grades and cites evidence; it
  **does not give medical advice or make efficacy claims**, even though its
  flagship example (40 Hz gamma entrainment) is a medical-research topic. Treat
  its output as **"a starting dossier to verify, not a conclusion."** (Source:
  README.md scope blockquote L11.)
- **Quality depends on the live model and its web access.** ruvn is a harness:
  the actual searching, grading, and synthesis are performed by *your* host's
  model through the agent prompts. ruvn supplies the discipline (the pipeline +
  rubric), not the intelligence. (Source: README.md L5, "How it's built"; the
  kernel does no model calls.)
- **The end-to-end live check is opt-in.** Unit tests stay offline-friendly; the
  OpenRouter integration check runs only when `OPENROUTER_API_KEY` is set (under
  `npm run validate:openrouter` or automatically under `npm test`). Without a
  key it is skipped. (Source: README.md "Try it against a real model";
  scripts/openrouter-validate.mjs `if (!KEY) … exit(2)`.)
- **It is generated, then extended.** ruvn was scaffolded by metaharness from
  the `vertical:research` template and then extended to all nine hosts — so its
  maturity tracks the metaharness kernel it depends on (`@metaharness/kernel
  ^0.1.0`). (Source: README.md "How it's built"; package.json deps;
  .harness/manifest.json.)
- **Node ≥ 20 required.** (Source: package.json `engines.node >=20.0.0`.)

What ruvn is **not**: it is not a chatbot, not a hosted service, not a medical
device, and not a replacement for reading the sources — it is the machine that
finds, grades, and organizes them so *you* can. (Source: README.md scope note;
package.json description.)

Also asked as: is ruvn production-ready, how mature is ruvn, what version is it,
what are ruvn's honest limits, does ruvn give medical advice, can I trust its
output as a conclusion, what does ruvn depend on for intelligence, is the
OpenRouter check required, what Node version do I need, what is ruvn not.
Keywords: v0.1.1 early honest, research tool not an oracle, does not give medical
advice no efficacy claims, starting dossier to verify not a conclusion, quality
depends on live model web access, harness supplies discipline not intelligence,
OpenRouter check opt-in skipped without key, generated from vertical:research
extended to nine hosts, @metaharness/kernel ^0.1.0, Node >=20, not a chatbot not
hosted not a medical device.

## 6. Where do I read more? (the docs map)

ruvn ships its documentation as a handful of small, purposeful files — read them
top-down:

- **`README.md`** — the full pitch: what it does in plain language, the agent
  table, the grading rubric, install + use, the OpenRouter check, how it's
  built, and the ruv-neural connection. Start here.
- **`CLAUDE.md`** — the operating contract for the model running the harness:
  the pipeline diagram, the agents-and-tiers table, the evidence-grading rubric,
  and the dossier output format.
- **`install.md`** — per-host install steps (e.g. registering the `ruvn` MCP
  server in GitHub Copilot/VSCode).
- **`SYSTEM.md`** — the one-line system identity ("You are ruvn …").
- **`AGENTS.md`** — behavioral rules for hosts that read an AGENTS file (Codex,
  pi-dev): use the `mcp__ruvn__*` tools, defer destructive operations to the
  user.
- **`package.json`** — the published name (`@ruvnet/ruvn`), the `ruvn` bin, the
  nine `@metaharness/host-*` dependencies, and the scripts
  (`build` / `test` / `init` / `doctor` / `validate:openrouter`).
- **`src/agents/*.ts`** — the actual source of truth for behavior: each agent's
  `SYSTEM_PROMPT` is the substance. Read these to see exactly what each agent is
  told to do.
- **Upstream context:** [ruv-neural](https://github.com/ruvnet/ruv-neural) (the
  closed-loop gamma-entrainment OS ruvn researches for) and
  [metaharness](https://github.com/ruvnet/agent-harness-generator) (the factory
  that generated ruvn).

(Source: README.md throughout; CLAUDE.md; install.md; SYSTEM.md; AGENTS.md;
package.json; src/agents/.)

Also asked as: where do I read more about ruvn, what docs ship with ruvn, which
file has the pipeline and rubric, where are the per-host install steps, where is
the agent behavior defined, what is in package.json, where do I read about
ruv-neural and metaharness, which file should I start with. Keywords: README.md
pitch agent table rubric install, CLAUDE.md pipeline agents tiers rubric dossier
format, install.md per-host steps MCP, SYSTEM.md identity, AGENTS.md behavioral
rules mcp__ruvn__ defer destructive, package.json name bin deps scripts,
src/agents SYSTEM_PROMPT source of truth, ruv-neural metaharness upstream links.

## 7. How do I install and use it (end-to-end)?

ruvn runs **inside an AI host you already use** — it adds the research pipeline
to that host. The fastest path is Claude Code:

```bash
npm i -g @ruvnet/ruvn   # installs the `ruvn` command
ruvn init               # wires the harness into Claude Code (.claude/ settings + plugin)
ruvn doctor             # health check — confirms the kernel + host adapter load
# or one-off, no install:  npx @ruvnet/ruvn init
```

`ruvn init` boots the metaharness kernel + the Claude-Code host adapter and
prints the kernel version and backend; `ruvn doctor` runs four PASS/FAIL checks
(kernel loads, reports a version, backend is native|wasm|js, host adapter has a
name) and exits non-zero if anything is wrong. (Source: bin/cli.js `init()` /
`doctor()`.) Then, **inside Claude Code, ask it to run the research pipeline on
your question** — the six agents and the grading rubric in `CLAUDE.md` are now
available to it.

**Other hosts:** the package already contains the config each host needs — point
your host at it (see `install.md` for per-host steps). Nine hosts are supported:
Claude Code, Codex, Copilot, OpenCode, GitHub Actions, pi-dev, Hermes, OpenClaw,
RVM. (Source: README.md "Other hosts"; .harness/manifest.json.)

**Validate it against a real model (optional):**

```bash
export OPENROUTER_API_KEY=sk-or-...   # your OpenRouter key
npm run validate:openrouter           # runs all six agents on a sample 40 Hz question
```

Each agent is exercised against its model tier (sonnet/haiku) and must return a
sensible, on-task response; the same check runs under `npm test` when a key is
present and is skipped otherwise. (Source: README.md "Try it against a real
model"; scripts/openrouter-validate.mjs.)

**Build from source (only if you extend the TypeScript):**

```bash
npm install
npm run build   # TypeScript → dist (the shipped bin/cli.js already runs without this)
npm test        # unit tests (+ OpenRouter integration if a key is present)
```

(Source: README.md "How it's built"; package.json scripts; bin/cli.js header
"runs as-is via `npx ruvn` with NO build step".)

Also asked as: how do I install ruvn, how do I use ruvn end to end, what does
ruvn init do, what does ruvn doctor check, how do I run the research pipeline,
how do I install ruvn into a host other than Claude Code, how do I validate ruvn
against a real model, do I need to build before running, what is the no-install
one-liner. Keywords: npm i -g @ruvnet/ruvn, ruvn init wires Claude Code settings
plugin, ruvn doctor four PASS/FAIL checks kernel backend host adapter, npx
@ruvnet/ruvn init no install, ask Claude Code to run the pipeline, other hosts
config in package install.md, validate:openrouter OPENROUTER_API_KEY sonnet
haiku, npm install build test, bin/cli.js runs as-is no build step, Node >=20.

## 8. How do I extend ruvn safely? (the extension points)

ruvn is a small, readable harness — its "API" is **six agent definitions + one
CLI dispatcher + the config that drops them into nine hosts**, so most extensions
are a few lines in one obvious file. The hard rule: the agents form a **fixed
linear pipeline where each agent only sees the previous agent's output**
(`scout → web-searcher → source-grader → synthesizer → fact-checker → citer`),
so when you change one agent keep its **input/output contract** stable or the next
agent breaks. The agents are *prompt definitions*, not executable orchestration —
the **host's model runs them**; ruvn ships the prompts, the rubric, and the host
wiring. Add a test next to the existing ones in `__tests__/`.

- **Add or edit a research agent.** Each agent is one file in
  **`src/agents/<name>.ts`** that exports exactly three things:
  `SYSTEM_PROMPT` (a backtick template literal — the agent's instructions),
  `NAME` (its string id, e.g. `'scout'`), and `TIER` (`'sonnet' | 'haiku' | 'opus'`
  — which model class runs it). To tune behavior, edit that agent's
  `SYSTEM_PROMPT`. To add a *new* stage, create `src/agents/your-agent.ts` with
  the same three exports, then **slot it into the pipeline order** (update the
  `scout → … → citer` chain in `CLAUDE.md` + `README.md`, since the host reads the
  pipeline order from there) and make sure its output shape is what the *next*
  agent expects. The live-model validator auto-discovers every `.ts` in
  `src/agents/`, so a new agent is picked up automatically once you add a sample
  task for it (see below). (Source: src/agents/scout.ts, synthesizer.ts — the
  `SYSTEM_PROMPT`/`NAME`/`TIER` triple; CLAUDE.md "Pipeline".)
- **Change a model tier for an agent.** Set `TIER` in that agent's file to
  `'sonnet'`, `'haiku'`, or `'opus'`. The tier → concrete model mapping lives in
  the validator: **`TIER_MODEL` in `scripts/openrouter-validate.mjs`**
  (`sonnet → anthropic/claude-sonnet-4.6`, `haiku → …-haiku-4.5`,
  `opus → …-opus-4.8`). web-searcher runs on `haiku` (cheap, high-volume fetch);
  the reasoning agents run on `sonnet`. (Source: src/agents/web-searcher.ts
  `TIER = 'haiku'`; scripts/openrouter-validate.mjs `TIER_MODEL`.)
- **Change the evidence-grading rubric.** The A/B/C/D definitions live in TWO
  places that must stay in sync: the **`source-grader` `SYSTEM_PROMPT` in
  `src/agents/source-grader.ts`** (what the grader is told) and the rubric table
  in **`CLAUDE.md`** (what the host shows). The synthesizer's rule — "use ONLY
  grade A and B" — is enforced in **`src/agents/synthesizer.ts`**'s prompt; if you
  loosen the rubric, update the synthesizer's allowed-grades line too, or you
  break the "only good sources reach the user" guarantee that is ruvn's whole
  point. (Source: src/agents/source-grader.ts, synthesizer.ts.)
- **Add a CLI subcommand.** The CLI is plain ESM in **`bin/cli.js`**: a
  `switch (cmd)` inside the exported `run(argv)` dispatcher
  (`init`, `doctor`, `--version`, `--help`). Add `async function mycmd() { … }`,
  add a `case 'mycmd': return mycmd();` branch, and list it in the `--help` text.
  `run` is exported (not just run on import) so a test can drive it directly —
  add a case to `__tests__/smoke.test.ts` (it already calls
  `run(['doctor'])` / `run(['definitely-not-a-command'])`). The file is shipped
  as-is (no build step), so `npx ruvn mycmd` works the moment it is published.
  (Source: bin/cli.js `run(argv)` switch; __tests__/smoke.test.ts.)
- **Add support for another host.** Each host is a `@metaharness/host-*`
  dependency plus the host's own config files, both declared in
  **`package.json`** (`dependencies` + the `files` array that ships
  `.claude/`, `.codex/`, `.vscode/`, `.opencode/`, etc.). Add the host adapter to
  `dependencies`, add its config file(s) to `files`, and document the per-host
  step in **`install.md`** + the "Other hosts" table in `README.md`. The nine
  current hosts (Claude Code, Codex, Copilot, OpenCode, GitHub Actions, pi-dev,
  Hermes, OpenClaw, RVM) are the template to copy. (Source: package.json
  `dependencies` `@metaharness/host-*` + `files`; README.md "Other hosts";
  install.md.)
- **Exercise it against a real model.** Add a representative task for your new or
  changed agent to the **`TASKS` map in `scripts/openrouter-validate.mjs`** (keyed
  by the agent `NAME`); `npm run validate:openrouter` (with `OPENROUTER_API_KEY`
  set) then runs every agent end-to-end and asserts a non-empty, on-task reply,
  and `__tests__/openrouter.integration.test.ts` runs the same check under
  `npm test` when a key is present. (Source: scripts/openrouter-validate.mjs
  `TASKS`; __tests__/openrouter.integration.test.ts.)

Rule of thumb for safety: treat **the linear pipeline order and each agent's
input→output contract** as the stable API (the next agent depends on it), and the
**A/B → synthesizer gate** as a guarantee you must not silently weaken. Run
`npm test` before and after; add `OPENROUTER_API_KEY` to also run the live check.
(Source: src/agents/*.ts; bin/cli.js; scripts/openrouter-validate.mjs;
package.json; CLAUDE.md; __tests__/.)

Also asked as: how do I add a new agent to ruvn, how do I change an agent's
prompt, how do I change which model an agent uses, where is the grading rubric,
how do I add a CLI command, how do I add another host, what is the stable contract
between agents, how do I validate ruvn against a real model, where do I add a test.
Keywords: src/agents/<name>.ts SYSTEM_PROMPT NAME TIER, pipeline order
scout web-searcher source-grader synthesizer fact-checker citer fixed linear,
each agent sees previous output contract, TIER sonnet haiku opus TIER_MODEL
openrouter-validate.mjs, source-grader A/B/C/D rubric CLAUDE.md synthesizer only
grade A B, bin/cli.js run argv switch case subcommand, package.json dependencies
@metaharness/host-* files array install.md host, TASKS map validate:openrouter
__tests__ smoke openrouter integration.

## 9. Cost, latency, and gotchas (running the pipeline)

ruvn has no heavy runtime of its own — the cost and the gotchas come from **what
the pipeline asks the host's model to do**, and from understanding that ruvn is a
**disciplined prompt + rubric set, not an autonomous engine**.

- **ruvn ships prompts, not an executable run loop.** `ruvn init`/`ruvn doctor`
  only boot the kernel + host adapter; there is **no `ruvn research` / `ruvn
  dossier` CLI command** — `init.ts` mentions a `dossier "<question>"` invocation
  as the *intended host workflow*, but the actual driving is done by the host AI
  reading `CLAUDE.md` and running the six agents. Don't expect a one-shot binary;
  expect to ask your host to run the pipeline. (Source: bin/cli.js commands =
  init/doctor/--version/--help only; src/init.ts; README.md "ask it to run the
  research pipeline".)
- **Six model passes per question = six rounds of latency + token cost.** Every
  question fans through all six agents in sequence, and several (scout, grader,
  synthesizer, fact-checker, citer) run on the **sonnet** tier; only web-searcher
  runs on cheaper **haiku**. Expect roughly six sequential LLM calls plus the web
  fetches, not one. Keep the scout's decomposition tight (3–7 subqueries) —
  more subqueries multiply every downstream agent's work. (Source:
  src/agents/*.ts `TIER`; scout.ts "3-7 specific subqueries".)
- **Web search/fetch is the host's, not ruvn's.** web-searcher and source-grader
  call **`WebSearch` / `WebFetch` in your host** — ruvn does not bundle a search
  provider or API key. If your host has no web tool wired up (or it is rate-limited
  / blocked), the pipeline starves at stage 2 and everything downstream has nothing
  to grade. Verify your host's web tooling before a real run. (Source:
  src/agents/web-searcher.ts, source-grader.ts "via WebFetch / WebSearch".)
- **The output is a *starting dossier*, not a verdict — and not medical advice.**
  ruvn is explicitly a research tool: it grades and cites evidence, it does not
  make efficacy or safety claims, and its gamma-entrainment origin does **not** make
  it a clinical instrument. fact-checker strips UNSUPPORTED claims and citer refuses
  to ship any claim without a citation, but you still verify before relying on it.
  (Source: README.md "Scope" + "does not give medical advice"; src/agents/
  fact-checker.ts, citer.ts.)
- **Grade quality caps everything.** The synthesizer may use **only grade A/B**
  sources; if a topic only has C/D evidence, the dossier will be thin or empty by
  design — that is the system working, not failing. Loosening this (see §8) trades
  the trust guarantee for coverage. (Source: src/agents/synthesizer.ts;
  source-grader.ts grade definitions.)
- **No build step needed to run; build only to edit TypeScript.** `bin/cli.js`
  ships as plain ESM and runs under `npx ruvn` with no compile; `npm run build`
  (tsc → dist) is only for extending `src/`. Node **>= 20** is required.
  Unit tests are offline-friendly; the OpenRouter integration test is **skipped
  unless `OPENROUTER_API_KEY` is set**, so a missing key is not a failure.
  (Source: bin/cli.js header; package.json `engines` + scripts;
  __tests__/openrouter.integration.test.ts `describe.skipIf`.)

Also asked as: how much does ruvn cost to run, why is ruvn slow, how many model
calls per question, does ruvn do its own web search, is there a ruvn research
command, can I trust ruvn's output, why is my dossier empty, is ruvn medical
advice, do I need to build ruvn, what Node version, gotchas with ruvn,
performance tips. Keywords: no ruvn research/dossier CLI command prompts not
engine host runs pipeline, six sequential model passes sonnet haiku latency token
cost, WebSearch WebFetch are the host's tools no bundled provider, starting
dossier not verdict not medical advice scope, synthesizer grade A B only thin
empty by design, no build step npx ruvn Node>=20 OpenRouter test skipped without
key.
