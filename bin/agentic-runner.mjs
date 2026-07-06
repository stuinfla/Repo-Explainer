#!/usr/bin/env node
// bin/agentic-runner.mjs — the AGENTIC hosted runner (replaces the deterministic orchestrator.mjs
// call for the hosted /build flow). Runs the real explainmyrepo SKILL as a headless Claude Code
// agent (`claude -p`) — the brain decides, tools/*.mjs do the mechanics (CONTRACT), instead of a
// fixed 19-station bash pipeline. See docs memory "hosted-agentic-architecture" (approved
// 2026-06-30) and ADR-033 (agent-harness-generator) for why: GitHub Actions is the right HOST for
// this triggered, autonomous class of task; what it invokes should be the agent, not a rigid script.
//
// Usage: node bin/agentic-runner.mjs <github-url> --build-dir <dir> [--budget-min N] [--budget-usd N]
//        [--submitter <email>] [--run-url <url>] [--build-id <id>]
//
// Behavior:
//   - Spawns `claude -p` headless, non-interactive (--permission-mode bypassPermissions, --bare to
//     skip hooks/CLAUDE.md/plugin-sync — irrelevant/unsafe on a shared CI runner), with the
//     explainmyrepo skill as the task brief and Bash/Read/Write/Edit/Glob/Grep as its only tools.
//   - Streams --output-format stream-json so tool calls are visible AS THEY HAPPEN (real progress,
//     not a fixed step counter) — printed to stderr and, if --build-id/--gist-id are set, patched to
//     the status gist so the website's poll shows the agent's actual current action.
//   - Enforces its OWN wall-clock (--budget-min) and $ (--budget-usd) ceilings, ending the run
//     cleanly with an honest reason BEFORE the outer GH Actions job timeout would SIGKILL it — a
//     clean stop can still report; a SIGKILL cannot. This is the dynamic-per-repo budget: the caller
//     (landing/netlify/functions/build.js) sizes --budget-min from a cheap pre-flight repo check.
//   - On ANY failure (non-zero exit, timeout, budget exceeded, or a completed run with no live URL
//     in build.json), calls tools/alert-owner.mjs with full particulars — never fails silently.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1] ?? true; if (argv[i + 1] !== undefined) i++; }
    else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const repoUrl = args._[0];
if (!repoUrl) { console.error('usage: agentic-runner.mjs <github-url> --build-dir <dir> [--budget-min N] [--budget-usd N]'); process.exit(2); }

const buildDir = path.resolve(args['build-dir'] || path.join(REPO_ROOT, 'build', `hosted-${Date.now()}`));
const budgetMin = Number(args['budget-min'] || 20);
const budgetUsd = Number(args['budget-usd'] || 8);
const submitter = args.submitter || '';
const runUrl = args['run-url'] || '';
const buildId = args['build-id'] || '';
const model = args.model || 'claude-sonnet-4-6';

fs.mkdirSync(buildDir, { recursive: true });
const buildJsonPath = path.join(buildDir, 'build.json');
if (!fs.existsSync(buildJsonPath)) {
  fs.writeFileSync(buildJsonPath, JSON.stringify({ repo: { url: repoUrl } }, null, 2) + '\n');
}

function log(msg) { process.stderr.write(`[agentic-runner] ${msg}\n`); }

const prompt = `Use the explainmyrepo skill (skills/explainmyrepo/SKILL.md is the brain — read it, follow it) to build a bespoke explainer for this repo:

  ${repoUrl}

Build directory (already created, seeded with build.json): ${buildDir}
Ship mode: --ship-best-effort semantics — if you cannot reach the exemplar bar (mean>=90/min>=85/all six operators) after a reasonable refine attempt, ship the best HONEST version you have (the SHIP_OPERATORS bar: mean>=82, min>=70, real legible diagrams, comprehension operators YES) rather than nothing. The one thing you must NEVER ship broken is the mandatory architecture + flow diagrams (INV-18) — hold rather than ship if those didn't render as real vectors.
Do NOT publish a separate GitHub repo for this build (skip that station — no write-scoped GitHub token is provisioned in this hosted context, by design).
Do NOT run the notify station (station 9) — sending the submitter's email is handled OUTSIDE your process; you have no SMTP credentials and should not need them. Your job ends once quality-grade + deploy are done and build.json's publish.liveUrl is set.
Do NOT run the refine loop more than twice.

You have an approximate budget of ${budgetMin} minutes and $${budgetUsd}. Track your own elapsed time and cost as you work. This repo's actual size/complexity is unknown to me in advance — YOU are the one who discovers it by reading the repo, so budget your own effort accordingly: for a small repo, take your time and polish; for a large/deep monorepo, work faster and be willing to cap exhaustiveness (e.g. don't try to full-text-sweep every file in a 10,000-file repo — sample the important ones: READMEs, top-level docs, the most-referenced components) rather than trying to be exhaustive and running out of budget.

CRITICAL — never fail silently (this is INV-04 in the skill, restated because it is the single most important rule for this run): if a tool fails, or a repo's structure breaks an assumption (e.g. the dependency graph comes back empty, or the repo is unusually deep/large), do NOT just crash. STOP, THINK about why, and try a reasonable workaround (e.g. hand-write a minimal-but-honest architecture note if the automated extractor genuinely cannot produce one for this repo's structure) before giving up. If you truly cannot produce a working page, say EXACTLY why in plain language as your final message — a specific, honest reason a human could act on, never a bare stack trace or a vague "something went wrong."

At the end, print your final status as the LAST line of your response in this exact form (nothing after it):
RESULT: {"ok": true, "liveUrl": "<url>"}   — on success
RESULT: {"ok": false, "reason": "<specific honest reason>"}   — on failure`;

log(`starting: ${repoUrl} (budget ${budgetMin}min / $${budgetUsd}, build dir ${buildDir})`);

// SECURITY (flagged by automated review, confirmed real): the target repo is untrusted, internet-
// submitted input, and this agent runs with bypassed permission checks. It must NOT see credentials
// it has no legitimate need for — a malicious README/CONTEXT.md in a submitted repo is a realistic
// prompt-injection vector, and a leaked token would be exfiltratable via the agent's own Bash access.
// Build an explicit allowlist rather than forwarding process.env wholesale. Only what the TOOLS this
// agent is told to invoke actually need: OpenAI (images + vision grading) and Netlify (deploy, scoped
// to an isolated {repo}-explainer site per the approved architecture). ANTHROPIC_API_KEY is
// unavoidable — `claude -p` needs it to authenticate its own reasoning in a fresh CI runner with no
// existing OAuth session (the documented headless-auth path). Explicitly EXCLUDED: EXPLAINER_GH_TOKEN
// /GITHUB_TOKEN (gist-write + repo-publish scope — this runner patches the status gist itself,
// outside the agent, and publish-repo is disabled for hosted builds) and all SMTP/GMAIL creds
// (notify is handled post-agent below, not by the agent).
const AGENT_ENV_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR', 'NODE_ENV', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NETLIFY_AUTH_TOKEN'];
const agentEnv = {};
for (const key of AGENT_ENV_ALLOWLIST) if (process.env[key] !== undefined) agentEnv[key] = process.env[key];

const claudeBin = process.env.CLAUDE_BIN || 'claude';
const child = spawn(claudeBin, [
  '-p', prompt,
  '--permission-mode', 'bypassPermissions',
  '--bare',
  '--output-format', 'stream-json',
  '--verbose',
  '--model', model,
  '--allowed-tools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  // Defense in depth beyond the env allowlist above: observed live in testing (2026-07-04) that the
  // agent will happily `cat .env` if it perceives a missing credential and try to work around it —
  // harmless in that specific local test (no .env exists in the production checkout at all — fresh
  // clone via actions/checkout, .env is gitignored/never committed) but there's no reason to leave
  // the door open rather than close it explicitly.
  '--disallowed-tools', 'Read(./.env)', 'Read(./.env.*)', 'Read(**/.env)', 'Read(**/.env.*)',
], {
  cwd: REPO_ROOT,
  env: agentEnv,
  stdio: ['ignore', 'pipe', 'inherit'],
});

let killedForBudget = false;
let lastActivity = Date.now();
let totalCostUsd = 0;
let finalResultText = '';
let sawResultEvent = false;

const hardTimer = setTimeout(() => {
  killedForBudget = true;
  log(`WALL-CLOCK BUDGET EXCEEDED (${budgetMin} min) — stopping the agent cleanly rather than letting the outer job get SIGKILLed.`);
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 10_000);
}, budgetMin * 60_000);

// Also patch a status gist directly if the caller gave us the IDs, so the hosted-flow website's
// poll shows the agent's REAL current action instead of a fixed step counter.
const gistId = args['gist-id'] || '';
const ghToken = process.env.EXPLAINER_GH_TOKEN || process.env.GITHUB_TOKEN || '';
async function patchStatus(stepName) {
  if (!gistId || !ghToken || !buildId) return;
  try {
    await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ files: { 'status.json': { content: JSON.stringify({ buildId, step: 0, totalSteps: 1, stepName, status: 'building', repo: repoUrl, result: null, error: null }, null, 2) } } }),
    });
  } catch { /* best-effort — a status-gist hiccup must never fail the build */ }
}

let buf = '';
child.stdout.on('data', (chunk) => {
  lastActivity = Date.now();
  buf += chunk.toString('utf8');
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    if (evt.type === 'assistant' && Array.isArray(evt.message?.content)) {
      for (const block of evt.message.content) {
        if (block.type === 'tool_use') {
          const summary = block.name === 'Bash'
            ? String(block.input?.command || '').slice(0, 140)
            : `${block.name} ${JSON.stringify(block.input || {}).slice(0, 100)}`;
          log(`→ ${summary}`);
          patchStatus(summary.slice(0, 120));
        }
      }
    } else if (evt.type === 'result') {
      sawResultEvent = true;
      totalCostUsd = evt.total_cost_usd || 0;
      finalResultText = evt.result || '';
      log(`agent finished: is_error=${evt.is_error} cost=$${totalCostUsd.toFixed(2)} turns=${evt.num_turns}`);
    }
  }
});

const exitCode = await new Promise((resolve) => child.on('close', resolve));
clearTimeout(hardTimer);

// ── Determine outcome ────────────────────────────────────────────────────────────────────────────
const resultLineMatch = finalResultText.match(/RESULT:\s*(\{.*\})\s*$/s);
let agentReported = null;
if (resultLineMatch) { try { agentReported = JSON.parse(resultLineMatch[1]); } catch { /* fall through */ } }

let liveUrl = agentReported?.ok ? agentReported.liveUrl : null;
if (!liveUrl) {
  // Cross-check against build.json directly — the agent's own final-line report is a courtesy,
  // not the source of truth (INV-05's "eyes agree" principle: verify, don't just trust the claim).
  try {
    const ctx = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
    if (ctx.publish?.liveUrl && ctx.publish?.http200) liveUrl = ctx.publish.liveUrl;
  } catch { /* build.json may not exist on a very early failure */ }
}

const budgetExceeded = killedForBudget;
const ok = exitCode === 0 && !budgetExceeded && !!liveUrl;
const elapsedMin = ((Date.now() - (lastActivity - 0)) / 60000); // approx; refined below
const reason = budgetExceeded
  ? `exceeded its ${budgetMin}-minute budget before finishing`
  : agentReported && agentReported.ok === false ? agentReported.reason
  : exitCode !== 0 ? `claude process exited ${exitCode}`
  : !liveUrl ? 'agent finished but no verified live URL was found in build.json'
  : 'unknown';

if (ok) {
  console.log(`LIVE: ${liveUrl}`);
  log(`SUCCESS — ${liveUrl} (cost $${totalCostUsd.toFixed(2)})`);
  // Notify runs HERE, not inside the agent (see the env allowlist above) — this is plain
  // deterministic code, not an LLM interpreting untrusted repo content, so it's the safe place to
  // hold SMTP creds. Non-blocking: a notify failure must never flip a successful build to failed.
  if (submitter) {
    const notifyEnv = { ...process.env, EMAIL_TO: submitter };
    const notify = spawn(process.execPath, [path.join(REPO_ROOT, 'tools', 'notify.mjs'), buildDir], { cwd: REPO_ROOT, env: notifyEnv, stdio: 'inherit' });
    await new Promise((r) => notify.on('close', r));
  }
  process.exit(0);
} else {
  log(`FAILED — ${reason}`);
  const alertArgs = [
    path.join(REPO_ROOT, 'tools', 'alert-owner.mjs'),
    '--repo', repoUrl.replace(/^https?:\/\/github\.com\//, ''),
    '--submitter', submitter || '(none)',
    '--build-id', buildId || '(none)',
    '--run-url', runUrl || '(none)',
    '--reason', reason,
    '--elapsed-min', String(Math.round(budgetMin)),
  ];
  const alert = spawn(process.execPath, alertArgs, { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
  await new Promise((r) => alert.on('close', r));
  process.exit(1);
}
