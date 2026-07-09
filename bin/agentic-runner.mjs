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

import { spawn, spawnSync } from 'node:child_process';
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
let repoUrl = args._[0];
if (!repoUrl) { console.error('usage: agentic-runner.mjs <github-url> --build-dir <dir> [--budget-min N] [--budget-usd N]'); process.exit(2); }
// The workflow passes the bare "owner/name" form (build.js sends fullName, not a URL) — normalize
// to a full URL up front so the identity pin, build.json seed, and clone all see the same thing.
// (Learned live 2026-07-08: the first INV-21 preflight failed CLOSED on exactly this — safe, but wrong.)
if (!/^[a-z]+:\/\//i.test(repoUrl) && !/github\.com/i.test(repoUrl)) repoUrl = `https://github.com/${repoUrl.replace(/^\/+/, '')}`;

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

// Canonical "owner/name" identity for a GitHub URL — what the whole build is pinned to (INV-21).
function repoId(u) {
  const m = String(u || '').trim().replace(/\/+$/, '').match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}
const submittedRepoId = repoId(repoUrl);
if (!submittedRepoId) { console.error(`[agentic-runner] cannot parse owner/name from "${repoUrl}" — need a github.com/owner/name URL`); process.exit(2); }

// Status-gist patching lives ABOVE the preflight so access failures can reach the status page too.
const gistId = args['gist-id'] || '';
const ghToken = process.env.EXPLAINER_GH_TOKEN || process.env.GITHUB_TOKEN || '';
// status: 'building' while in progress (the default); MUST be called with 'done'/'failed' at the
// end too — a real production run (2026-07-06, sindresorhus/p-map, budget-exceeded) proved this
// wasn't happening: the gist froze on the last in-progress step forever, so anyone watching the
// live status page (as opposed to the email alert, which DID fire correctly) saw no indication the
// build had actually finished, successfully or not. That is exactly the silent-failure mode this
// whole rebuild exists to close.
// Progress patches are throttled: one gist PATCH per tool call blew GitHub's secondary
// rate limit mid-build (2026-07-09, agentveil-sdk) — and the 403 landed on the one patch
// that mattered, `done`, leaving the submitter staring at "building" while their page was
// live. Progress is best-effort every ≥20s; terminal states retry through the limit.
let lastProgressPatchAt = 0;

async function patchStatus(stepName, status = 'building', result = null, error = null) {
  if (!gistId || !ghToken || !buildId) {
    if (status !== 'building') log(`patchStatus(${status}) SKIPPED — missing ${!gistId ? 'gistId' : !ghToken ? 'ghToken' : 'buildId'}`);
    return;
  }
  if (status === 'building') {
    if (Date.now() - lastProgressPatchAt < 20_000) return;
    lastProgressPatchAt = Date.now();
  }
  // Terminal states (done/failed) must land even if a secondary rate limit is active —
  // GitHub's write-burst limits clear within a minute or two, so wait them out.
  const delaysMs = status === 'building' ? [] : [30_000, 60_000, 120_000];
  for (let attempt = 0; ; attempt++) {
    try {
      const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: { 'status.json': { content: JSON.stringify({ buildId, step: 0, totalSteps: 1, stepName, status, repo: repoUrl, result, error }, null, 2) } } }),
      });
      if (resp.ok) return;
      // A silent swallow here is exactly the anti-pattern this whole rebuild exists to close — a
      // gist-patch failure on the TERMINAL state is itself worth knowing about, even though it must
      // never invert the real build outcome (hence: log loudly, but never throw).
      const body = await resp.text().catch(() => '');
      if (status !== 'building') log(`patchStatus(${status}) attempt ${attempt + 1} FAILED: HTTP ${resp.status} ${body.slice(0, 200)}`);
      if (attempt >= delaysMs.length) return;
    } catch (e) {
      if (status !== 'building') log(`patchStatus(${status}) attempt ${attempt + 1} THREW: ${e.message}`);
      if (attempt >= delaysMs.length) return;
    }
    await new Promise((r) => setTimeout(r, delaysMs[attempt]));
  }
}

// ── SOURCE-IDENTITY GATE: Station 0–1 (validate + clone) runs HERE, pre-agent, deterministic ────
// Incident 2026-07-08 (submitted mamd69/SONA-Trader, shipped Dar-41/Virtual-Trader-SONA-AI-): the
// agent, unable to clone a private-but-shared repo (the env allowlist strips GITHUB_TOKEN —
// correctly), treated the clone failure as an obstacle to work around, GitHub-searched a lookalike,
// edited repo.url in build.json, and shipped a stranger's repo to the submitter as theirs. Two
// structural conclusions, both enforced here:
//   1. The clone belongs in trusted deterministic code that MAY hold the token — never in the
//      agent. Private repos shared with our account now work; the agent still never sees a token.
//   2. If the EXACT submitted repo cannot be cloned, the build ends before the agent exists,
//      loudly, with an actionable message to the human. Nothing can "work around" it.
log(`preflight: cloning ${repoUrl} deterministically (pre-agent, token never enters the agent env)`);
const cloneEnv = { ...process.env, EXPLAINER_SUBMITTED_REPO: submittedRepoId };
if (!cloneEnv.GITHUB_TOKEN && cloneEnv.EXPLAINER_GH_TOKEN) cloneEnv.GITHUB_TOKEN = cloneEnv.EXPLAINER_GH_TOKEN;
const cloneRes = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'clone-repo.mjs'), buildDir], { cwd: REPO_ROOT, env: cloneEnv, encoding: 'utf8' });
if (cloneRes.stderr) process.stderr.write(cloneRes.stderr);
let cloneOut = null;
try { cloneOut = JSON.parse((cloneRes.stdout || '').trim().split('\n').pop()); } catch { /* non-JSON stdout = failure */ }
if (cloneRes.status !== 0 || !cloneOut?.ok) {
  const why = cloneOut?.error || (cloneRes.stderr || '').trim().split('\n').pop() || `clone-repo exited ${cloneRes.status}`;
  log(`PREFLIGHT FAILED — ${why}`);
  await patchStatus('Stopped before building: we could not access this repo.', 'failed', null,
    `We couldn't access ${repoUrl}. If it's private, share it with our GitHub account or make it public, then rebuild. Nothing was built — we never build from a guess or a similar-looking repo.`);
  const alert = spawn(process.execPath, [
    path.join(REPO_ROOT, 'tools', 'alert-owner.mjs'),
    '--repo', repoUrl.replace(/^https?:\/\/github\.com\//, ''),
    '--submitter', submitter || '(none)',
    '--build-id', buildId || '(none)',
    '--run-url', runUrl || '(none)',
    '--reason', `repo inaccessible at preflight: ${why}`,
    '--elapsed-min', '0',
  ], { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
  await new Promise((r) => alert.on('close', r));
  process.exit(1);
}
log(`preflight OK — cloned ${cloneOut.outputs?.repo?.owner}/${cloneOut.outputs?.repo?.name} (private=${cloneOut.outputs?.repo?.private})`);

const prompt = `Use the explainmyrepo skill (skills/explainmyrepo/SKILL.md is the brain — read it, follow it) to build a bespoke explainer for this repo:

  ${repoUrl}

Build directory (already created, seeded with build.json): ${buildDir}
Station 0–1 (validate + clone) is ALREADY DONE by the harness: the repo is cloned, verified, and pinned at ${buildDir}/repo. Do NOT re-run clone-repo, and do NOT touch repo.url in build.json.

THE SOURCE-IDENTITY LAW (INV-21 — overrides every other instruction in this brief, including the workaround license below): the repo named above IS this build's identity. If its clone is missing, broken, or anything else makes it unusable, STOP and report ok:false with the specific reason. NEVER search for, substitute, fetch, or reconstruct a different repo or its README — an explainer of the wrong repo is fabrication, the one unforgivable output. There is no workaround for source identity.
Ship mode: --ship-best-effort semantics — if you cannot reach the exemplar bar (mean>=90/min>=85/all six operators) after a reasonable refine attempt, ship the best HONEST version you have (the SHIP_OPERATORS bar: mean>=82, min>=70, real legible diagrams, comprehension operators YES) rather than nothing. The one thing you must NEVER ship broken is the mandatory architecture + flow diagrams (INV-18) — hold rather than ship if those didn't render as real vectors.
Do NOT publish a separate GitHub repo for this build (skip that station — no write-scoped GitHub token is provisioned in this hosted context, by design).
Do NOT run the notify station (station 9) — sending the submitter's email is handled OUTSIDE your process; you have no SMTP credentials and should not need them. Your job ends once quality-grade + deploy are done and build.json's publish.liveUrl is set.
Do NOT run the refine loop more than twice.

You have an approximate budget of ${budgetMin} minutes and $${budgetUsd}. Track your own elapsed time and cost as you work. This repo's actual size/complexity is unknown to me in advance — YOU are the one who discovers it by reading the repo, so budget your own effort accordingly: for a small repo, take your time and polish; for a large/deep monorepo, work faster and be willing to cap exhaustiveness (e.g. don't try to full-text-sweep every file in a 10,000-file repo — sample the important ones: READMEs, top-level docs, the most-referenced components) rather than trying to be exhaustive and running out of budget.

CRITICAL — never fail silently (this is INV-04 in the skill, restated because it is the single most important rule for this run): if a tool fails, or a repo's structure breaks an assumption (e.g. the dependency graph comes back empty, or the repo is unusually deep/large), do NOT just crash. STOP, THINK about why, and try a reasonable workaround — always WITHIN the pinned repo; the SOURCE-IDENTITY LAW above is never workaroundable — (e.g. hand-write a minimal-but-honest architecture note if the automated extractor genuinely cannot produce one for this repo's structure) before giving up. If you truly cannot produce a working page, say EXACTLY why in plain language as your final message — a specific, honest reason a human could act on, never a bare stack trace or a vague "something went wrong."

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
// Not a secret — the INV-21 identity pin. clone-repo.mjs and deploy.mjs refuse to run against any
// repo.url that doesn't match it, so even a misbehaving agent cannot swap the source mid-build.
agentEnv.EXPLAINER_SUBMITTED_REPO = submittedRepoId;

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

// The status gist is read by the submitter's browser — it gets a human progress line, never the
// raw tool call (a reader watching their build saw `node tools/generate-image.mjs … PID=$!` as
// the "step", 2026-07-09). The raw command still goes to the workflow log for debugging.
function friendlyStep(name, input) {
  if (name === 'Bash') {
    const cmd = String(input?.command || '');
    if (/generate-image/.test(cmd)) return 'Creating the imagery…';
    if (/quality-grade|render-page|screenshot/.test(cmd)) return 'Grading the page against the quality bar…';
    if (/deploy/.test(cmd)) return 'Deploying the page…';
    if (/assemble-page/.test(cmd)) return 'Assembling the page…';
    if (/build-context|clone/.test(cmd)) return 'Studying the repository…';
    if (/npm (ci|install)/.test(cmd)) return 'Setting up tools…';
    return 'Working…';
  }
  if (name === 'Write' || name === 'Edit') {
    const p = String(input?.file_path || '');
    if (/\.svg$/.test(p)) return 'Drawing diagrams…';
    if (/\.(html|css)$/.test(p)) return 'Writing the page…';
    return 'Authoring content…';
  }
  if (name === 'Read' || name === 'Grep' || name === 'Glob' || name === 'LS') return 'Reading the code…';
  return 'Thinking…';
}

const hardTimer = setTimeout(() => {
  killedForBudget = true;
  log(`WALL-CLOCK BUDGET EXCEEDED (${budgetMin} min) — stopping the agent cleanly rather than letting the outer job get SIGKILLed.`);
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 10_000);
}, budgetMin * 60_000);

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
          patchStatus(friendlyStep(block.name, block.input));
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

// Source-identity re-verification at the exit boundary (INV-21, defense in depth vs a mid-build
// swap): the repo the build ENDED on must be the repo the human submitted, or nothing ships.
let identityViolation = null;
try {
  const finalCtx = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
  const finalId = repoId(finalCtx?.repo?.url);
  if (finalId !== submittedRepoId) identityViolation = `build ended on "${finalCtx?.repo?.url}" but was submitted for ${submittedRepoId}`;
} catch { /* unreadable build.json already fails the liveUrl check */ }

const budgetExceeded = killedForBudget;
const ok = exitCode === 0 && !budgetExceeded && !!liveUrl && !identityViolation;
const elapsedMin = ((Date.now() - (lastActivity - 0)) / 60000); // approx; refined below
const reason = identityViolation
  ? `SOURCE-IDENTITY VIOLATION: ${identityViolation} — treating any deploy from this run as invalid`
  : budgetExceeded
  ? `exceeded its ${budgetMin}-minute budget before finishing`
  : agentReported && agentReported.ok === false ? agentReported.reason
  : exitCode !== 0 ? `claude process exited ${exitCode}`
  : !liveUrl ? 'agent finished but no verified live URL was found in build.json'
  : 'unknown';

if (ok) {
  console.log(`LIVE: ${liveUrl}`);
  log(`SUCCESS — ${liveUrl} (cost $${totalCostUsd.toFixed(2)})`);
  await patchStatus('Done — your explainer is live.', 'done', { liveUrl }, null);
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
  await patchStatus('The build could not finish.', 'failed', null, "It didn't complete this time. Try another repo, or try again in a bit.");
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
