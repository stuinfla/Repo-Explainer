# MetaHarness — Canonical Newcomer Content

> **Single source of truth.** This file feeds the website, the KB primer, and the
> NotebookLM studio. All three must say the same true thing. Every non-obvious
> claim cites its source file in the cloned repo (`.targets/agent-harness-generator/`).
> Audience: a **non-technical Claude-Code user** — someone comfortable running
> `npm install` and `npx something --help`, but not a framework author.
>
> Naming note (used throughout): the published tool is **`metaharness`**
> (README header, line 7; `packages/create-agent-harness/package.json` line 2 is
> literally `"name": "metaharness"`). The repo and the internal package directory
> are named `agent-harness-generator` / `create-agent-harness` — these are the
> **same tool**, not two products. We always lead with `metaharness` and note the
> alias where it matters. (Source: README.md L7-9; build-plan-metaharness.md L23.)

---

## 1. What it is (one sentence)

**MetaHarness is a free, local-first CLI and browser Studio that turns any GitHub
repo — or a blank slate — into a custom, branded, npm-publishable AI agent
"harness": its own `npx <your-name>` command, its own skills, its own scoped
memory, its own safety policy — without ever running your code.**
(Source: README.md L23-41; docs/USERGUIDE.md L9-21.)

A "harness" is the wrapper *around* the model, not the model itself. Underneath
you are still talking to Claude or GPT; the harness adds a name and brand,
project knowledge, a set of skills, and a safety net. (Source: docs/USERGUIDE.md
L24-40.) The slogan the repo uses: *"It is not another agent framework. It is a
factory for agent frameworks. The model is replaceable. The harness is the
product."* (Source: README.md L27-29.)

---

## 2. The seven-arc answers, in order

### Arc 1 — Why was it built?

Because **forking an existing bundled agent system is a one-way door.** The
predecessor product, **ruflo**, ships a kernel of primitives *fused* to
opinionated content (60+ agents, 30+ skills, 33 plugins) as one tightly-bundled
thing. People wanted their own brand, agents, and marketplace listing — but
forking ruflo to get them meant losing every future kernel update.
`agent-harness-generator` **factors that apart** so you can take just the kernel
and generate just the content you need, owned and branded by you. (Source:
docs/OVERVIEW.md L13, L19; docs/USERGUIDE.md L187-193.)

### Arc 2 — What problem does it solve?

Three concrete problems, stated in the design overview (Source: docs/OVERVIEW.md
L16-21):

1. **Lock-in.** Forking a bundled product to rebrand it forfeits all upstream
   updates.
2. **Host fragmentation.** Claude Code is no longer the only place people run
   agents — Codex, Hermes, pi.dev and more each have their own config
   conventions. A harness should target any host without a rewrite.
3. **Reinventing infrastructure.** Every new agent project rebuilds ~80% of the
   same plumbing (MCP server, memory namespace, governance policy, release
   signing) by hand. (Source: docs/OVERVIEW.md L21; docs/USERGUIDE.md L134.)

### Arc 3 — Why now?

Because the surrounding ecosystem reached the point that makes a "factory" worth
building: **the hosts have multiplied** (Codex CLI, Hermes/Nous Research, pi.dev
all gained agent conventions) and **the plugin marketplace is heating up** — a
scaffolded harness is now both a consumer of plugins from the ruflo IPFS registry
and, optionally, a publisher of its own. (Source: docs/OVERVIEW.md L20-21.)

### Arc 4 — How does it solve it?

A guided **composer** asks you a short series of choices and assembles a complete,
self-contained npm package from them. The composer runs the same way interactively
(a picker UI / `--wizard`) or non-interactively (command-line flags) — both build
the same internal `HarnessChoice` object that drives template selection. The stages,
**in order**, are (Source: docs/adrs/ADR-003-generator-architecture.md L102-122):

1. **Identity** — name, npm scope, description, license, author.
2. **Hosts** — multi-select which agent runtimes to target (at least one).
3. **Primitives** — toggle kernel subsystems: `mcp` (always on), `hooks`,
   `memory`, `routing`, `marketplace`, `witness` (default: all on).
4. **Agents** — pick from a curated catalogue (defaults: `coder`, `reviewer`,
   `tester`).
5. **Skills** — pick re-usable skills (defaults: `hooks-automation`,
   `memory-search`, `swarm-orchestration`).
6. **Plugins** — pick from the IPFS registry (default: none).
7. **Features** — opt-in wiring like `federation`, `claims`, `self-evolution`.
8. **Branding** — powered-by vs independence mode + brand strings.
9. **Confirm** — summary, full file list, pinned kernel version, size estimate.

The output is layered from a `_base` template plus overlays, so feature toggles
compose without forking the template tree. (Source:
docs/adrs/ADR-003-generator-architecture.md L114, L124-135.) The whole thing is
client-side in the Studio and local in the CLI — **no MetaHarness account, no
hosted backend, no telemetry.** (Source: README.md L348-351.)

> **Note on the "7-arc" vs the composer's 9 stages:** the seven-arc structure
> above is the *teaching* outline for newcomers. The *tool's* composer has **9
> stages** as listed. They are different things; don't conflate them. (Source:
> docs/adrs/ADR-003-generator-architecture.md L102-122 for the 9; this document's
> own structure for the 7.)

### Arc 5 — What does "solved" look like?

A self-contained npm package — say `my-bot` — that has (Source: docs/USAGE.md
L9-19; README.md L41):

- Its own `npx my-bot` CLI (your identity, not "ruflo").
- Its own MCP server registration (default-deny — see Arc 4 / Limits).
- Its own scoped memory namespace.
- Your selected agents, skills, plugins, and per-host config files.
- An **Ed25519-signed witness manifest** so anyone who installs it can verify
  exactly what they got. (Source: docs/USAGE.md L16-17; README.md L261.)

You can `npm publish` it, and your users run `npx my-bot init` — they never see
the factory layer, only your brand. (Source: docs/USAGE.md L5, L155-159.)

### Arc 6 — How do I implement it?

Two paths, same result (a downloadable/scaffolded `.zip` you own):

- **Browser Studio** (zero install): open
  <https://ruvnet.github.io/agent-harness-generator/>, pick a tab
  (Repo→Harness / Create harness / Skill-Agent-Command / Verify), make your
  choices, click **Download .zip**, then `unzip`, `npm install`. (Source:
  docs/USERGUIDE.md L45-89.)
- **Terminal** (same behavioural output): `npx metaharness my-bot --template …
  --host …`, or run `npx metaharness --wizard` to be asked the questions.
  (Source: README.md L93-108; docs/USAGE.md L24-44.)

After scaffolding you own the files — open them, trim what you don't need, tune
prompts and routing, then `npm publish --provenance`. (Source: README.md L62-91;
docs/USAGE.md L94-159.)

### Arc 7 — How do I start (the fastest path)?

If you don't know what to pick, **run the wizard** — a 4-question form
(name → template → host → description) that prints the equivalent
`npx metaharness …` command afterwards so you can skip it next time:

```bash
npx metaharness --wizard
```

(Source: README.md L104-108; docs/USAGE.md L34.) Or jump straight in:

```bash
npx metaharness my-bot --template vertical:coding --host claude-code
cd my-bot && npm install && npx . --help
```

(Source: README.md L99-102; docs/USERGUIDE.md L96-99.) Then run
`harness doctor` to confirm the scaffold is healthy. (Source: docs/USERGUIDE.md
L217.)

---

## 3. Use-case scenarios (full: situation → command → what the tool does → what you get)

> Every command below is taken verbatim from the repo's own docs and is cited.
> No commands or flags are invented.

### Use case 1 — "I have a repo and want an agent that understands it"

- **Situation:** You maintain a GitHub repo and want a coding assistant tuned to
  *that* codebase, not a generic chatbot.
- **Command(s):**
  ```bash
  harness analyze-repo .                       # local — deterministic analysis only
  harness analyze-repo . --scaffold my-bot     # materialise the recommended harness
  ```
  (Source: README.md L110-115.) Or, in the browser, the Studio **Repo → Harness**
  tab: paste the GitHub URL, hit analyze, review/edit the recommended agents and
  skills, click **Download .zip**. (Source: docs/USERGUIDE.md L45-59.)
- **What the tool does:** Reads the file list, `package.json`, README, and
  language mix and recommends agents/skills/MCP tools. It **never executes your
  code**; inferred build/test commands are emitted as
  `trust: inferred · execution: disabled`. (Source: README.md L117; README.md
  L354-357.)
- **What you get:** A scaffolded harness (or a `.zip`) with a recommended agent
  set for your repo, ready to `npm install` and run. (Source: docs/USERGUIDE.md
  L55-56.)

### Use case 2 — "Score a repo *before* I commit to building a harness for it"

- **Situation:** You're not sure a given repo is even a good candidate, or how
  much each agent run will cost.
- **Command(s):**
  ```bash
  npx metaharness score <repo>     # fit / build-likelihood / safety / cost-per-run report card
  harness genome <repo>            # 7-section pre-scaffold readiness report
  ```
  (Source: README.md L45-48, L226-227; docs/USAGE.md L299-309.)
- **What the tool does:** Reads the repo (again, **never runs it**) and prints a
  one-screen report: how well a harness fits, how likely it is to build, how safe
  the tools are, and the rough cost per run. `harness genome` adds a verdict —
  `ready` / `needs-work` / `blocked` — from a deterministic scorecard. (Source:
  README.md L45-48; docs/USAGE.md L299-309.)
- **What you get:** A go / no-go decision with evidence *before* you scaffold,
  plus a recommended plan. (Source: docs/USAGE.md L301-309.)

### Use case 3 — "Spin up a customer-support (or trading, legal, …) pod from a template"

- **Situation:** You want a ready-made multi-agent setup for a known vertical and
  don't want to remember flags.
- **Command(s):**
  ```bash
  npx metaharness --list                       # browse all templates
  npx metaharness my-bot --template vertical:support
  # or the dedicated one-command wrapper, no flags to remember:
  npx @metaharness/support my-bot
  ```
  (Source: README.md L156-159, L195-208; docs/USAGE.md L48-67.)
- **What the tool does:** Scaffolds a harness pre-loaded with that vertical's
  bespoke domain agents (with system prompts), skills, commands, and per-host
  settings — **all default-deny**. A scaffold from a wrapper is byte-identical to
  the equivalent `metaharness` invocation. (Source: README.md L170, L177-179.)
- **What you get:** A working vertical pod — e.g. customer support, or
  paper-by-default quant trading, or drafts-only contract redline. (Source:
  README.md L199-208.)

### Use case 4 — "Check that a `.zip` a colleague gave me is safe to run"

- **Situation:** Someone hands you a generated harness and you want to vet it
  before installing.
- **Command(s):** Studio **Verify** tab (checks without unzipping or running
  anything), or from the CLI:
  ```bash
  harness mcp-scan <path>      # "npm audit for agent tools" — static-only
  harness threat-model <path>  # PR / compliance review artifact
  harness verify               # check the Ed25519 witness signature
  ```
  (Source: docs/USERGUIDE.md L81-89, L161-170; README.md L148-150, L228, L236.)
- **What the tool does:** Statically scans for risky MCP permissions
  (shell/network/file-write), missing audit/timeouts, wildcard permissions,
  unguarded secrets, and unpinned deps; `mcp-scan` exits 1 on any HIGH finding.
  `verify` confirms the witness signature hasn't been tampered with. **Nothing is
  executed.** (Source: README.md L150; README.md L148-150.)
- **What you get:** A clean / medium / high verdict and a shareable artifact —
  *"at least no riskier than any other npm package you'd `npm install`"* if it
  passes. (Source: docs/USERGUIDE.md L168-170; docs/USAGE.md L335-338.)

### Use case 5 — "Cut my model bill without losing quality"

- **Situation:** You're paying frontier prices for work a cheaper model could do.
- **Command(s):**
  ```bash
  npm i @metaharness/router
  # in code:
  # route(query) -> the cheapest model predicted to clear your quality bar
  ```
  (Source: README.md L49-54, L89-91.)
- **What the tool does:** `@metaharness/router` routes each request to the
  cheapest model that still clears your quality bar, learned from your own eval
  logs. It works out of the box with zero native deps; you can train it on your
  own data for a sharper fit. (Source: README.md L49-54, L82-91.)
- **What you get:** Same-quality output at lower spend — the repo's DRACO
  benchmark reports a small/cheap model delivering frontier-quality research at
  roughly one-tenth the cost. (Source: README.md L82-91.) **Caveat:** the
  underlying `@ruvector/emergent-time` signal is *"a diagnostic signal, not a
  proven early-warning lead vs a fair baseline. Bench it for your workload before
  relying on it in production."* (Source: docs/USAGE.md L250.)

### Use case 6 — "Eject from ruflo and ship my own branded harness"

- **Situation:** You've been using ruflo and want to ship a focused, branded
  harness derived from it.
- **Command(s):**
  ```bash
  npx metaharness --from-existing ./
  # later, to ship:
  harness validate        # 6-check release-readiness umbrella
  harness sign            # add the Ed25519 witness
  npm publish --provenance
  ```
  (Source: docs/USAGE.md L182-188, L133-159; README.md L236.)
- **What the tool does:** Detects your ruflo install (`.claude/`, `CLAUDE.md`,
  `.mcp.json`), lifts the agents/skills/commands you've customised into a new
  harness, and renames every `ruflo` / `claude-flow` reference. `.claude-flow/`
  local state is left behind by design — eject starts with fresh memory. (Source:
  docs/USAGE.md L182-188.)
- **What you get:** A clean, branded, publishable harness — and your team can run
  `npx @your-org/your-harness` to get the same repo-tuned agent. (Source:
  README.md L75-80; docs/USAGE.md L182-188.)

### Use case 7 — "Let the harness improve itself (Darwin Mode)"

- **Situation:** You want the harness to tune its own config over time without
  touching the model.
- **Command(s):**
  ```bash
  npm run evolve        # ships wired into every scaffold; --no-darwin to skip
  ```
  (Source: README.md L55-60.)
- **What the tool does:** Mutates its own config, tests each change in a sandbox,
  and keeps only what *measurably* improves. The model stays frozen; only the
  harness evolves. **Safe by default** — no network, no API key; pure
  refactor/tuning behind a safety gate. (Source: README.md L55-60.)
- **What you get:** A harness that self-tunes against a fitness function
  (validated on real SWE-bench Lite bug-fixing per the README), with the model
  untouched. (Source: README.md L55-60.) Treat it as experimental and opt-out
  with `--no-darwin`. (Source: README.md L60.)

---

## 4. Honest limits (state these plainly; do not hide them)

- **It is v0.1.x beta.** Published and usable, but with an explicit
  credibility/doc-reconciliation effort still in progress (issue #4 / ADR-042).
  (Source: README.md L246-252; docs/OVERVIEW.md L5.)
- **`metaharness` and `create-agent-harness` are the same tool.** The published
  CLI is `metaharness` (README header). Older doc sections show
  `npx create-agent-harness`, which is the internal package directory name
  (`packages/create-agent-harness/`, whose `package.json` is literally
  `"name": "metaharness"`). Lead with `metaharness`; treat `create-agent-harness`
  as an alias, not a second product. (Source: README.md L7-9;
  packages/create-agent-harness/package.json L2, L22-24; build-plan-metaharness.md
  L23.)
- **Host count: docs lag the code (6 vs 9).** The code targets **nine** hosts
  (`HOSTS` array: `claude-code, codex, pi-dev, hermes, openclaw, rvm, copilot,
  opencode, github-actions`), of which **six are the long-stable set** and
  copilot / opencode / github-actions are newer additions (ADR-032 / ADR-036 /
  ADR-033). The Status table and `docs/USAGE.md` still describe **six** (and parts
  of USAGE list only **four**). Do not assert "nine hosts" as long-stable — say
  "six stable, plus three newer." (Source:
  packages/create-agent-harness/src/index.ts L61-64; README.md L125, L257;
  docs/USAGE.md L73-82; build-plan-metaharness.md L212.)
- **Test count varies across docs — don't assert one fixed number.** The README
  badge reads **568 passing** across 67 files; other docs/changelog snapshots
  cite different totals (the build plan flags a 568-vs-605 doc lag). State "the
  README badge shows 568 passing; exact counts vary by snapshot," not a single
  hard figure. (Source: README.md L13, L263; build-plan-metaharness.md L212,
  L231, L268.)
- **It never executes your code.** `metaharness analyze`, `harness genome`, and
  the Studio's Repo→Harness analysis are deterministic **static analysis only**;
  inferred build/test commands are marked `trust: inferred · execution: disabled`.
  The Studio is 100% client-side and only reads the public repo *file list* via
  GitHub's API — it never reads file contents server-side. (Source: README.md
  L117, L354-357; docs/USERGUIDE.md L59, L156-159.)
- **The analysis is deliberately shallow.** It reads the file list, manifest,
  README, and language mix — not every line of code. The output is a strong
  starting point you should edit before downloading, not a finished agent.
  (Source: docs/USERGUIDE.md L134-143.)
- **Default-deny is a feature with a cost.** The generated MCP server ships
  locked down (no network, no shell, no file-write by default), so you must
  explicitly allow tools you want. (Source: README.md L149; docs/USERGUIDE.md
  L137-139.)
- **It is not a chatbot, a no-code platform, or a hosted service, and it does not
  fine-tune models.** It emits local-first Node.js code; the model is whatever
  your host brings. (Source: docs/USERGUIDE.md L198-207.)

---

## 5. Source map (where each fact lives)

| Topic | Primary source file(s) |
|---|---|
| What it is / pitch / hosts / status | `README.md` |
| Why it exists / forces / scope | `docs/OVERVIEW.md` |
| Plain-language usage / FAQ / limits | `docs/USERGUIDE.md` |
| Step-by-step build→publish flow / subcommands | `docs/USAGE.md` |
| Layered architecture / pipelines | `docs/ARCHITECTURE.md` |
| Composer 9-stage flow / templates | `docs/adrs/ADR-003-generator-architecture.md` |
| Naming / branding (powered-by vs independence) | `docs/adrs/ADR-015-naming-and-branding-policy.md` |
| Goals / non-goals | `docs/adrs/ADR-001-goals-and-non-goals.md` |
| The doc-lag limits + canon constraints | `docs/build-plan-metaharness.md` |
