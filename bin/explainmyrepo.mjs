#!/usr/bin/env node
// bin/explainmyrepo.mjs — the `npx explainmyrepo <github-url>` entry point.
//
// Turns any GitHub repo into a bespoke, art-directed explainer site — for humans AND their AI — in
// one command. The station order lives in src/stations.mjs; src/orchestrator.mjs runs it.
//
// Usage:  npx explainmyrepo <github-url> [flags]
// Reads credentials from the environment / a gitignored .env (never printed): ANTHROPIC_API_KEY
// (or CLAUDE_API_KEY), OPENAI_API_KEY (or OPEN_AI_KEY), NETLIFY_AUTH_TOKEN, plus GitHub via `gh`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/orchestrator.mjs';
import { loadEnv } from '../src/env.mjs';
import { stationHelpText } from '../src/stations.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
function version() {
  try { return JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
}

const HELP = `
explainmyrepo — turn any GitHub repo into a bespoke explainer site (for humans + AI).

USAGE
  npx explainmyrepo <github-url> [options]

ARGUMENTS
  <github-url>            https://github.com/owner/name  (also git@… or bare owner/name)

OPTIONS
  --out <dir>            build directory (default: ./explainer-builds/<repo>)
  --model <id>           model for the brain steps (default: claude-sonnet-5-5; with only an OPENROUTER_API_KEY
                         and no Anthropic credential, the default is z-ai/glm-5.3 via OpenRouter)
  --no-deploy            skip the deploy station (build + grade locally only)
  --no-publish           skip publish-repo + repo-seo (no GitHub explainer repo)
  --no-notify            skip the email notify station
  --no-readme-pr         don't contact the repo's maintainer (see OUTREACH below)
  --no-quality           skip the local vision quality gate (faster dry iterations)
  --no-refine            grade once but don't auto-iterate the copy to lift weak axes
  --max-refine <n>       max content-refine passes when below the quality bar (default 2)
  --from <station>       resume: start at this station id (needs an existing --out build)
  --to <station>         stop after this station id
  --only <station>       run just one station id
  --dry-run             print the station plan and exit (no tools, no API calls)
  -h, --help             show this help
  -v, --version          print version

STATIONS (ids for --from/--to/--only, in run order)
${stationHelpText('local')}

WHAT YOU NEED (checked up-front — you'll be told exactly what's missing and what to do)
  Brain      ANTHROPIC_API_KEY in .env, OR OPENROUTER_API_KEY alone, OR just a logged-in Claude Code
             install: with no key set, the judgment steps run on your Claude subscription automatically.
             (On a terminal, anything missing is asked for and saved to .env; elsewhere the run stops and says what to set.)
  Visuals    OPENAI_API_KEY|OPEN_AI_KEY — hero art + the vision quality gate.
  Live URL   NETLIFY_AUTH_TOKEN — needed to deploy; without it the run stops up front, or pass
             --no-deploy and you still get the complete page in your build folder.
  GitHub     nothing for public repos; PRIVATE repos need "gh auth login" first.
  (SMTP_USER/SMTP_PASS/EMAIL_TO — notify only, optional, failure is non-blocking.)

OUTREACH (on by default — the readme-enhance station)
  After a build ships, the maintainer gets ONE friendly GitHub issue showing a better README for
  their repo: theirs exactly as written + an explainer link + diagrams. It shows the finished work in
  one click and offers a PR if they want it. Nothing in their repo is touched until they say yes.
  Rules it keeps: never your own repo or a private one, one contact per repo ever, a closed item is
  never re-sent, 5 a day at most (README_OUTREACH_DAILY_CAP), additions only, every send tracked.
  Turn it off:  --no-readme-pr   (or README_ENHANCE=0)        Send PRs directly:  README_OUTREACH=pr
  Your own voice: README_PR_INTRO="…{repo}…" README_PR_SIGNOFF="Your Name"   Rehearse: README_OUTREACH_DRYRUN=1
  Track replies:  npx explainmyrepo outreach status
  Check in once:  npx explainmyrepo outreach followup   (one note, a week after the last message, only if unanswered)
  After a yes:    npx explainmyrepo outreach open-pr owner/name

WHICH DOOR IS FOR YOU
  Public repo, zero setup      →  https://explainmyrepo.isovision.ai (paste the URL — done)
  Private repo, or your keys   →  THIS command, run inside a VS Code / Claude Code session
                                  in a project whose .env already holds the keys above —
                                  everything is picked up automatically, nothing re-exported.

EXAMPLES
  npx explainmyrepo https://github.com/owner/cool-lib
  npx explainmyrepo owner/cool-lib --no-deploy --no-publish
  npx explainmyrepo owner/cool-lib --from concept --out ./explainer-builds/cool-lib
`;

const BOOL_FLAGS = new Set(['--no-deploy', '--no-publish', '--no-notify', '--no-readme-pr', '--no-quality', '--no-refine', '--dry-run', '-h', '--help', '-v', '--version']);
const VALUE_FLAGS = new Set(['--out', '--model', '--from', '--to', '--only', '--max-refine']);

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '-v' || a === '--version') { opts.version = true; continue; }
    if (VALUE_FLAGS.has(a)) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      opts[a.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
      continue;
    }
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1 && VALUE_FLAGS.has(a.slice(0, eq))) {
      opts[a.slice(2, eq).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a.slice(eq + 1);
      continue;
    }
    if (BOOL_FLAGS.has(a)) { opts[a.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true; continue; }
    if (a.startsWith('-')) throw new Error(`unknown flag: ${a}`);
    positional.push(a);
  }
  return { opts, positional };
}

async function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`error: ${e.message}\n\nRun --help for usage.\n`); process.exit(2); }
  const { opts, positional } = parsed;

  if (opts.version) { process.stdout.write(version() + '\n'); return; }

  // The Alive Kit discovery surface (ADR-0009 §7): `npx explainmyrepo capabilities` renders the
  // verified-capability registry — the ONLY availability source, so it cannot overstate.
  // Local-door-only by policy: these companions never run on the hosted pipeline.
  // Outreach tracking (ADR-0015): `outreach status` polls every message we've sent;
  // `outreach open-pr <owner/name>` is the second step after a maintainer says yes.
  if (positional[0] === 'outreach') {
    const { statusCommand, openPrCommand, followupCommand } = await import('../src/outreach-cli.mjs');
    const sub = positional[1] || 'status';
    if (sub === 'status') { await statusCommand({ env: process.env }); return; }
    if (sub === 'followup') { followupCommand({ env: { ...process.env, ...loadEnv(path.join(HERE, '..')) }, dryRun: process.argv.includes('--dry-run') }); return; }
    if (sub === 'open-pr') {
      if (!positional[2] || !/^[^/\s]+\/[^/\s]+$/.test(positional[2])) {
        process.stderr.write('usage: explainmyrepo outreach open-pr <owner/name>\n'); process.exit(2);
      }
      process.exit(openPrCommand(positional[2], { env: { ...process.env, ...loadEnv(path.join(HERE, '..')) }, repoRoot: path.join(HERE, '..') }));
    }
    process.stderr.write(`unknown outreach command: ${sub}\nusage: explainmyrepo outreach [status | followup | open-pr <owner/name>]\n`);
    process.exit(2);
  }

  if (positional[0] === 'capabilities') {
    const reg = JSON.parse(readFileSync(path.join(HERE, '..', 'capabilities.json'), 'utf8'));
    const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', R = '\x1b[0m';
    process.stdout.write(`\n${B}The Alive Kit${R} — companions this repo can build from a finished explainer (local runs only)\n\n`);
    for (const c of reg.capabilities) {
      if (c.status === 'verified') {
        process.stdout.write(`  ${G}✓ ${c.id}${R} — ${c.title}\n`);
        process.stdout.write(`      verified ${c.verifiedAt} · ${c.receipts.output} · $${c.receipts.costUsd} render\n`);
        process.stdout.write(`      run: node ${c.entry} <build-dir>   ${D}(inside a local Claude Code session)${R}\n`);
        process.stdout.write(`      proof: ${c.receipts.proof}\n\n`);
      } else {
        process.stdout.write(`  ${D}○ ${c.id} — ${c.title}\n      ${c.status} — not yet verified, not enabled (${c.verification})${R}\n\n`);
      }
    }
    process.stdout.write(`${D}Governance: docs/adr/0009-alive-kit-local-companions.md · a capability appears as ✓ only after\na supervised end-to-end run with recorded receipts. Companions never run on the hosted door.${R}\n`);
    return;
  }

  if (opts.help || positional.length === 0) { process.stdout.write(HELP); process.exit(opts.help ? 0 : 2); }

  const url = positional[0];
  try {
    const res = await run(url, opts);
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    process.stderr.write(`\n\x1b[31merror:\x1b[0m ${e.message}\n`);
    process.exit(1);
  }
}

main();
