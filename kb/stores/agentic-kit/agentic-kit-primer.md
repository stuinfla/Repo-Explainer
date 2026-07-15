# agentic-kit — orientation primer

## What it is
`@pacphi/agentic-kit` (CLI: `agentic-kit` or `ak`) is a single, zero-runtime-dependency
npm package that installs, heals, and **proves** two other AI-agent tools work: `ruflo`
(claude-flow — persistent memory, self-learning, security scanning, background workers
for Claude Code) and `agentic-qe` (test-engineering agents). You do not install ruflo or
agentic-qe yourself — `ak setup` does it, then repairs whatever silently drifted, then
demonstrates the repair with real evidence rather than a green checkmark you have to trust.

## The problem it exists to solve
A stock ruflo install prints "OK" while quietly rotting:
- Native SQLite bindings (`better-sqlite3`) get dropped on an npm upgrade and the store
  silently falls back to a WASM path that loses memory writes — `src/lib/natives.mjs`,
  `src/lib/heal.mjs`.
- npm ≥11.17's `allow-scripts` gate blocks the install scripts that build those natives
  in the first place, so a plain `npm i -g` can leave you on the broken path indefinitely
  (`ALLOW_SCRIPTS` allow-list in `heal.mjs`, ladder: plain install → `npm approve-scripts`
  + rebuild → run the package's own install script directly).
- A package the CLI still imports (`@claude-flow/aidefence`/`security`) stopped shipping
  in a later ruflo release, leaving prompt-injection defense silently dead
  (upstream ruvnet/ruflo#2670) — `natives.mjs: aidefencePresent/securityPresent`.
- The pattern store (RVF) corrupts on an interrupted write — two known failure shapes:
  a lock file stamped with the RVF magic bytes ("FLVR") from a torn write, and a runaway
  oversized `.rvf` file after a hard exit — `src/lib/rvf.mjs: scanRvf/quarantine`
  (derived caches, so the fix is simply delete-and-rebuild from `memory.db`).
- Background daemons can burn tokens unsupervised unless pinned local-only.

## The four commands
- `ak` — status + one suggested next action.
- `ak setup [--project] [--minimal] [--yes] [--no-aqe] [--no-security] [--reconfigure]` —
  installs/updates ruflo + agentic-qe globally (working around allow-scripts), deploys the
  token-audit skill, merges managed guidance blocks into `~/.claude/CLAUDE.md`, offers MCP
  registration, and (inside a git repo) initializes the project: sanitized `ruflo init`,
  an absolute memory-path pin, a **verified store→disk write** (`setup.mjs`: writes a probe
  key via `ruflo memory store`, then confirms the on-disk row before saying VERIFIED), a
  statusline footer, and a background daemon defaulting to **local-only ($0) workers**
  (token-spending workers stay opt-in, behind upstream's own budget).
- `ak status [--json] [--deep]` — read-only per-subsystem ✓/⚠/✗ dashboard (versions, the
  kit's own version, natives, security, learning/aqe, MCP, daemons, CLAUDE.md blocks,
  statusline) — each drift row names exactly what `sync` would do about it
  (`src/commands/status.mjs`).
- `ak sync [--dry-run] [--no-upgrade]` — the one convergence verb: upgrades first when a
  newer release exists, re-heals everything the upgrade may have wiped, then re-verifies
  and reports; it also self-updates the kit itself as the LAST step (new code takes effect
  on the next run, never mid-sync). `--dry-run` prints the plan + reasons with nothing
  changed.
- `ak uninstall [--dry-run] [--purge]` — removes the kit's footprint (project data is
  never touched; `--purge` also offers to remove the global packages).

Power-user surface: `ak x daemon-gc|mcp pick|off|reference diff|sync|verify learning|security|aqe|improvement-eval`.

## Maturity
`4.0.0-alpha.4` — pre-1.0/alpha channel (`npm install -g @pacphi/agentic-kit@next`),
actively developed, MIT licensed, CI on GitHub Actions, Node ≥22 required. A v3 shell-based
kit is archived under `docs/archive/` — this v4 is an npm rewrite, cross-platform
(macOS/Linux/Windows), and `ak setup` migrates an old shell-kit install automatically.
Investigative history for each guard, with the specific upstream issues filed
(#2219, #2222, #2239, #2360, #2549, #2670), lives in `docs/archive/`.

## Where the docs are
`README.md` (overview + command table + status-line legend), `docs/TROUBLESHOOTING.md`
(symptom → command), `MAINTAINER.md` (dev setup via pnpm, release process), `docs/archive/`
(the investigative history behind every guard).

## How to use it end-to-end
1. `npm install -g @pacphi/agentic-kit@next`
2. `ak setup` once per machine (run it inside a git repo to also set that project up).
3. `ak status` any time to see what's true vs. drifted.
4. `ak sync` (optionally `--dry-run` first) whenever status shows drift, after an upgrade,
   or on a schedule — it upgrades, heals, and re-verifies in one pass, then self-updates
   the kit last.
5. `ak uninstall` to leave cleanly.
