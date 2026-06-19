# MetaHarness — Top-Down Primer

> A synthesized, top-down orientation for newcomers. Seven sections, one per
> stage of the comprehension arc: what it is → what it can do → what it is made
> of → how the composer works → how mature it is → where the docs live → how to
> start. Every claim is grounded in the cloned repo (`README.md`, `docs/*`,
> `docs/adrs/*`, `packages/*`). The published CLI is **`metaharness`**;
> `create-agent-harness` is the internal package directory name and an alias for
> the same tool (README.md L7-9; `packages/create-agent-harness/package.json`
> line 2 is literally `"name": "metaharness"`). Lead with `metaharness`.

## 1. What is MetaHarness?

**MetaHarness is a free, local-first CLI and browser Studio that turns any
GitHub repo — or a blank slate — into a custom, branded, npm-publishable AI
agent "harness".** You run `npx metaharness` (the published CLI) and out comes
a self-contained npm package with its own `npx <your-name>` command, its own
skills, its own scoped memory, and its own safety policy — generated without
ever running your code. (Source: README.md L23-41; docs/USERGUIDE.md L9-21.)

A "harness" is the wrapper *around* the model, not the model itself. Underneath
you are still talking to Claude or GPT; the harness adds a name and brand,
project knowledge, a set of skills, and a safety net. (Source:
docs/USERGUIDE.md L24-40.) The repo's own slogan captures the idea exactly:
*"It is not another agent framework. It is a **factory for agent frameworks**.
The model is replaceable. The **harness is the product**."* (Source: README.md
L27-29.)

The fastest way in is `npx metaharness` — either arg-driven
(`npx metaharness my-bot`) or guided (`npx metaharness --wizard`). The Studio
is the same thing in the browser, 100% client-side, with no account and no
hosted backend. (Source: README.md L93-108; docs/USAGE.md L24-34.)

Also asked as: what is MetaHarness, what does metaharness produce, what does it
turn a repo into, is the harness the model or a wrapper, do I need a MetaHarness
account or a server, why a factory and not a framework, metaharness vs
create-agent-harness CLI name. Keywords: agent harness, any repo, npm package,
scoped memory, safety policy, branded CLI, client-side, no account, no hosted
backend, factory for agent frameworks, model is replaceable, harness is the
product, wrapper around Claude or GPT, alias.

## 2. What can the tool do to a repo?

Before you ever scaffold anything, MetaHarness can read a repo (it **never**
executes your code) and report on it, and it ships several capabilities beyond
plain scaffolding. The headline capabilities are:

- **`metaharness score <repo>`** — a fit / build-likelihood / safety /
  cost-per-run report card, printed before you commit to building. (Source:
  README.md L45-48, L226-227.)
- **`harness genome <repo>`** — a 7-section pre-scaffold readiness report
  (repo profile · agent topology · MCP risk model · test confidence · release
  readiness · recommended plan · scorecard) with a `ready` / `needs-work` /
  `blocked` verdict, computed deterministically from a local repo path.
  (Source: docs/USAGE.md L299-309.)
- **`harness mcp-scan <path>`** — "npm audit for agent tools": a static-only
  scan flagging shell/network grants, missing audit/timeouts, wildcard
  permissions, unguarded secrets, and unpinned deps; exits 1 on any HIGH.
  (Source: README.md L148-150.)
- **`harness threat-model <path>`** — renders the mcp-scan findings as a clean
  PR / compliance review artifact (clean / medium / high verdict). (Source:
  docs/USAGE.md L327-338.)
- **`@metaharness/router`** — routes each request to the cheapest model
  predicted to clear your quality bar, learned from your own eval logs.
  (Source: README.md L49-54, L89-91.)
- **Darwin Mode (`@metaharness/darwin`, `npm run evolve`)** — the harness
  mutates its own config, tests each change in a sandbox, and keeps only what
  *measurably* improves; the model stays frozen, only the harness evolves.
  (Source: README.md L55-60.)

Everything here is **static analysis only**: `metaharness analyze`,
`harness genome`, and the Studio's Repo→Harness analysis never run repo code;
inferred build/test commands are emitted as
`trust: inferred · execution: disabled`. (Source: README.md L117, L354-357.)

Also asked as: what can the tool do to a repo before I build, how do I score a
repo before committing, what does harness genome report, what is the npm audit
for agent tools command, what artifact does threat-model produce, how does
metaharness cut my model cost, what does Darwin Mode do, does metaharness ever
execute my code. Keywords: metaharness score, cost-per-run, report card, genome
readiness ready needs-work blocked, mcp-scan static HIGH, threat-model clean
medium high, router cheapest model quality bar, Darwin Mode mutates its own
config sandbox model stays frozen, never executes your code, static analysis
only, execution: disabled.

## 3. What packages make up MetaHarness?

MetaHarness is a package-based monorepo (`packages/<name>`), wired in a
**three-layer** model (Source: docs/ARCHITECTURE.md L5-40):

- **Layer 1 — Kernel.** `@metaharness/kernel` is the shared Rust core
  (claims, hooks, intel, mcp, memory, routing, witness, federation), shipped as
  a wasm-bindgen target and a NAPI-RS target plus a TypeScript loader. Nothing
  in Layer 1 imports from Layers 2 or 3 (ADR-002 owns this boundary).
- **Layer 2 — Adapters + application.** The **host** adapter packages —
  `host-claude-code`, `host-codex`, `host-pi-dev`, `host-hermes`,
  `host-openclaw`, `host-rvm`, `host-copilot`, `host-opencode`,
  `host-github-actions` — plus `sdk`, `vertical-base`, and `vertical-trading`.
- **Layer 3 — User-facing surface.** `create-agent-harness` (the CLI you run as
  `metaharness`), the `harness` subcommands, the Claude marketplace plugin, and
  the Codex skills.

Other notable packages in `packages/`: `router` (the model router),
`darwin-mode` (Darwin self-evolution), `agent-harness-generator-lib` (the
published library `@ruvnet/agent-harness-generator`), and `bench` (the DRACO
benchmark). (Source: README.md L256-284; docs/ARCHITECTURE.md L5-40;
`packages/` directory listing.)

Also asked as: what packages make up metaharness, what is the kernel and what is
in it, what are the three layers, which host adapter packages exist, what does
the kernel boundary forbid, which packages are user-facing, what does the model
router package do, what kernel subsystems are bundled. Keywords: three-layer,
Kernel Adapter user-facing surface, @metaharness/kernel Rust wasm NAPI-RS,
claims hooks intel mcp memory routing witness federation, host-claude-code
host-codex host-pi-dev host-hermes host-openclaw host-rvm, router, darwin,
create-agent-harness, marketplace plugin, Layer 1 imports portable.

## 4. How does the composer scaffold a harness?

A guided **composer** asks a short series of choices and assembles a complete,
self-contained npm package from them. It runs the same way interactively (a
picker UI / `--wizard`) or non-interactively (command-line flags); both build
the same typed `HarnessChoice` object that drives template selection. The
stages, **in order**, are (Source:
docs/adrs/ADR-003-generator-architecture.md L102-114):

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

The output is layered from a `_base` template plus host and feature overlays
(merge order: `_base` → each selected host overlay → each selected feature
overlay; later wins), so toggles compose without forking the template tree.
(Source: docs/adrs/ADR-003-generator-architecture.md L118-162.)

> **Note on "7 arcs" vs "9 stages":** this primer's seven sections are a
> *teaching* outline. The tool's composer has **9 stages** as listed above.
> They are different things — do not conflate them. (Source:
> docs/adrs/ADR-003-generator-architecture.md L102-114; this document's own
> structure for the 7.)

Also asked as: how does the composer scaffold a harness, how many stages does
the composer have, how do template overlays merge, what are the default agents
and skills, what object drives template selection, which stage toggles kernel
subsystems, is the 7-arc outline the same as composer stages, what is the last
composer stage. Keywords: 9 stages, Identity Hosts Primitives Agents Skills
Plugins Features Branding Confirm, HarnessChoice, interactive non-interactive,
_base host overlay feature overlay later wins, default: all on, mcp always on,
coder reviewer tester, hooks-automation memory-search swarm-orchestration,
teaching outline do not conflate, file list kernel version.

## 5. Is this production-ready (maturity and honest limits)?

**It is v0.1.x beta** — published and usable, with an explicit
credibility / doc-reconciliation effort still in progress (issue #4 /
ADR-042). (Source: README.md L246-252; docs/OVERVIEW.md L5.) State the limits
plainly:

- **Test count: don't assert one fixed number.** The README badge shows
  **568** passing across 67 files; other doc/changelog snapshots cite different
  totals. Say "the README badge shows 568 passing; exact counts vary by
  snapshot." (Source: README.md L13, L263.)
- **Host count: docs lag the code (6 vs 9).** The code's `HOSTS` array targets
  **nine** hosts (`claude-code, codex, pi-dev, hermes, openclaw, rvm, copilot,
  opencode, github-actions`), of which six are the long-stable set and copilot
  / opencode / github-actions are newer additions. Say "six stable, plus three
  newer" — never assert "nine hosts" as long-stable. (Source:
  `packages/create-agent-harness/src/index.ts` L61-64; README.md L125.)
- **It never executes your code.** Analysis is deterministic static analysis
  only; inferred commands are `trust: inferred · execution: disabled`. (Source:
  README.md L117, L354-357.)
- **Default-deny is a feature with a cost.** The generated MCP server ships
  locked down (no network, no shell, no file-write by default). (Source:
  README.md L149; docs/USERGUIDE.md L137-139.)
- **It is not a chatbot, a no-code platform, or a hosted service, and it does
  not fine-tune models.** (Source: docs/USERGUIDE.md L198-207.)

The release *pipeline*, by contrast, is mature: a 16-job **CI matrix**
(Rust × 3 OS + WASM × 3 OS + Node 20/22 × 3 OS + bench + pack+install), a
**security pipeline** (cargo-audit / cargo-deny / npm-audit / CodeQL / SBOM), and
**single-command releases**. (Source: README.md L246-267; docs/ARCHITECTURE.md
L42-98.)

Also asked as: is this production-ready, how mature is metaharness, how many
hosts are stable versus newer, which three hosts are newer, what is the
default-deny posture of the generated MCP server, what is metaharness NOT,
should I assert one fixed test count, what release status is it in, how mature
is the release pipeline. Keywords: v0.1.x beta published doc-reconciliation,
568 passing badge varies by snapshot, nine hosts six stable plus three newer,
copilot opencode github-actions, default-deny no network no shell no file-write,
not a chatbot not a no-code platform not a hosted service does not fine-tune,
never executes your code, CI matrix security pipeline single-command releases.

## 6. Where do I read about the architecture?

The docs are deliberately layered, so you can read top-down:

- **`README.md`** — what it is, the pitch, hosts, status table.
- **`docs/OVERVIEW.md`** — why it exists, the three forces, scope / non-goals.
- **`docs/USERGUIDE.md`** — plain-language usage, FAQ, honest limits.
- **`docs/USAGE.md`** — the step-by-step build→publish flow and every
  `harness` subcommand.
- **`docs/ARCHITECTURE.md`** — the three-layer model, release pipeline, CI
  matrix, and test-contract map.
- **`docs/adrs/INDEX.md`** — the read-in-order index for the full ADR series;
  the composer's 9-stage flow lives in
  **`docs/adrs/ADR-003-generator-architecture.md`**, the host model in
  **ADR-004**, naming/branding in **ADR-015**, goals/non-goals in **ADR-001**.

(Source: docs/OVERVIEW.md L24-43; docs/ARCHITECTURE.md L122-127; canon §5
source map: README.md / OVERVIEW.md / USERGUIDE.md / USAGE.md / ARCHITECTURE.md
/ ADR-003 / INDEX.md.)

Also asked as: where do I read about the architecture, which doc covers the
build to publish flow and subcommands, where is the composer 9-stage flow
documented, where do I read why metaharness exists, which doc gives plain
-language usage and FAQ, where is the three-layer model and CI matrix described,
what is the read-in-order ADR index, where does the host integration model live.
Keywords: ARCHITECTURE.md three-layer CI matrix, OVERVIEW.md scope ADR-001,
USERGUIDE.md FAQ limits, USAGE.md harness subcommand build to publish, INDEX.md
read-in-order ADR series, ADR-003 composer 9-stage, ADR-004 host integration
model, ADR-015 naming branding.

## 7. How do I start the fastest (end-to-end)?

If you don't know what to pick, **run the wizard** — a 4-question form
(name → template → host → description) that prints the equivalent
`npx metaharness …` command afterwards so you can skip it next time (Source:
README.md L104-108; docs/USAGE.md L34):

```bash
npx metaharness --wizard
```

Or jump straight in with flags and run it locally (Source: README.md L99-102;
docs/USERGUIDE.md L96-99):

```bash
npx metaharness my-bot --template vertical:coding --host claude-code
cd my-bot && npm install && npx . --help
```

Then run `harness doctor` to confirm the scaffold is healthy. (Source:
docs/USERGUIDE.md L217.) After scaffolding you **own** the files: open them,
trim what you don't need, tune prompts and routing, run `harness validate` to
clear every release gate, then `npm publish --provenance`. Your users then run
`npx my-bot init` and never see the factory layer — only your brand. (Source:
README.md L62-91; docs/USAGE.md L94-159.)

Also asked as: how do I start the fastest, what does the wizard ask me, how do I
check the scaffold is healthy after generating, how do I publish my harness and
what do my users run, what is the fastest path if I don't know what to pick,
show the one-liner to scaffold a coding harness, do I own the files and can I
trim them, what command clears every release gate before publishing. Keywords:
npx metaharness --wizard 4-question name template host description, --template
--host npm install, harness doctor scaffold healthy, own trim tune prompts
routing, harness validate release gate, npm publish --provenance, npx my-bot
init never see the factory layer.
