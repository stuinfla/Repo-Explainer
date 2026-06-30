#!/usr/bin/env node
// bin/explainmyrepo.mjs — the `npx @isovision/explainmyrepo <github-url>` entry point.
//
// Turns any GitHub repo into a bespoke, art-directed explainer site — for humans AND their AI — in
// one command. It runs the deterministic pipeline tools (tools/*.mjs, per tools/CONTRACT.md) in
// order and calls Claude in the loop to author the judgment slots (concept, content, the Station-4
// image briefs + diagram ASCII, and the primer). See src/orchestrator.mjs for the station map.
//
// Usage:  npx @isovision/explainmyrepo <github-url> [flags]
// Reads credentials from the environment / a gitignored .env (never printed): ANTHROPIC_API_KEY
// (or CLAUDE_API_KEY), OPENAI_API_KEY (or OPEN_AI_KEY), NETLIFY_AUTH_TOKEN, plus GitHub via `gh`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/orchestrator.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
function version() {
  try { return JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
}

const HELP = `
explainmyrepo — turn any GitHub repo into a bespoke explainer site (for humans + AI).

USAGE
  npx @isovision/explainmyrepo <github-url> [options]

ARGUMENTS
  <github-url>            https://github.com/owner/name  (also git@… or bare owner/name)

OPTIONS
  --out <dir>            build directory (default: ./explainer-builds/<repo>)
  --model <id>           Anthropic model for the brain steps (default: claude-sonnet-4-6)
  --no-deploy            skip the deploy station (build + grade locally only)
  --no-publish           skip publish-repo + repo-seo (no GitHub explainer repo)
  --no-notify            skip the email notify station
  --no-quality           skip the local vision quality gate (faster dry iterations)
  --no-refine            grade once but don't auto-iterate the copy to lift weak axes
  --max-refine <n>       max content-refine passes when below the quality bar (default 2)
  --register-kb          OPT-IN: if the repo isn't a kb.config target, inject a generated
                         entry into kb/kb.config.mjs (the one step that edits the shared registry)
  --from <station>       resume: start at this station id (needs an existing --out build)
  --to <station>         stop after this station id
  --only <station>       run just one station id
  --dry-run             print the station plan and exit (no tools, no API calls)
  -h, --help             show this help
  -v, --version          print version

STATIONS (ids for --from/--to/--only)
  clone-repo · kb:register · build-kb · primer · concept · content · visual-brief ·
  generate-image · make-favicon · make-social-card · make-diagrams · assemble-page ·
  make-pack · quality-grade · deploy · publish-repo · repo-seo · readme-enhance · notify

ENV (from .env, never printed)
  ANTHROPIC_API_KEY|CLAUDE_API_KEY  (required — brain steps)
  OPENAI_API_KEY|OPEN_AI_KEY        (images + vision grade)
  NETLIFY_AUTH_TOKEN                (deploy)         gh auth / GH_TOKEN (publish, repo-seo, readme)
  SMTP_USER/SMTP_PASS/EMAIL_TO      (notify — optional; failure is non-blocking)

EXAMPLES
  npx @isovision/explainmyrepo https://github.com/owner/cool-lib
  npx @isovision/explainmyrepo owner/cool-lib --no-deploy --no-publish
  npx @isovision/explainmyrepo owner/cool-lib --from concept --out ./explainer-builds/cool-lib
`;

const BOOL_FLAGS = new Set(['--no-deploy', '--no-publish', '--no-notify', '--no-quality', '--no-refine', '--register-kb', '--dry-run', '-h', '--help', '-v', '--version']);
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
