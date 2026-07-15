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
// Executor model economics (owner directive 2026-07-13, "build-economics-text-first"): the
// premium creative judgment happens in the TEXT-MODE CONCEPT TOURNAMENT below (Fable/Sonnet/Sol
// compete on specs for cents; a cheap judge ranks them) — so the implementation agent runs on
// the low-cost tier. All-Fable implementation measured $7-9/page; tournament + Sonnet executor
// targets $2.50-4.00 at the same gate bar. Both IDs verified live via GET /v1/models 2026-07-13.
const model = args.model || 'claude-sonnet-5';

fs.mkdirSync(buildDir, { recursive: true });
const buildJsonPath = path.join(buildDir, 'build.json');
if (!fs.existsSync(buildJsonPath)) {
  fs.writeFileSync(buildJsonPath, JSON.stringify({ repo: { url: repoUrl } }, null, 2) + '\n');
}

function log(msg) { process.stderr.write(`[agentic-runner] ${msg}\n`); }

// Confirmed bug (tests/spawn-error-handling.test.mjs): none of this file's spawn() calls
// registered an .on('error', ...) listener — a missing/misconfigured binary (a bad `claude`
// PATH, a moved node executable) crashes the WHOLE process with a raw Node stack trace,
// contradicting this file's own "never fail silently" contract. Fire-and-forget notification
// spawns (alert-owner, notify, notify-failure) go through this: waits for close OR error,
// logs either way, never throws, never hangs.
function spawnAndWait(label, bin, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, opts);
    let settled = false;
    child.on('error', (e) => { if (settled) return; settled = true; log(`${label} FAILED TO START: ${e.message}`); resolve(-1); });
    child.on('close', (code) => { if (settled) return; settled = true; resolve(code); });
  });
}

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

async function patchStatus(stepName, status = 'building', result = null, error = null, internalReason = null) {
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
        // internalReason is the real diagnostic (e.g. "Credit balance is too low") — it rides in
        // the same gist for the admin dashboard to read, but app.js (the submitter's own status
        // page) only ever displays `error`, never this, so nothing internal leaks publicly.
        body: JSON.stringify({ files: { 'status.json': { content: JSON.stringify({ buildId, step: 0, totalSteps: 1, stepName, status, repo: repoUrl, result, error, internalReason }, null, 2) } } }),
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
  await spawnAndWait('alert-owner', process.execPath, [
    path.join(REPO_ROOT, 'tools', 'alert-owner.mjs'),
    '--repo', repoUrl.replace(/^https?:\/\/github\.com\//, ''),
    '--submitter', submitter || '(none)',
    '--build-id', buildId || '(none)',
    '--run-url', runUrl || '(none)',
    '--reason', `repo inaccessible at preflight: ${why}`,
    '--elapsed-min', '0',
  ], { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
  process.exit(1);
}
log(`preflight OK — cloned ${cloneOut.outputs?.repo?.owner}/${cloneOut.outputs?.repo?.name} (private=${cloneOut.outputs?.repo?.private})`);

// CREDENTIAL PREFLIGHT — live-verify every key this run will need BEFORE any expensive work.
// A rotated key discovered at agent turn 1 costs minutes; discovered at deploy (minute ~9) it
// costs the whole build; discovered here it costs three parallel HTTP probes (~2s total).
// Learned live 2026-07-13: a stale ANTHROPIC_API_KEY in the caller's shell env killed a local
// build on its first turn while a valid key sat unused in the repo .env — the runner trusted
// the env instead of proving it. Images note: generate-image.mjs self-loads GROK_AI_KEY from
// the repo .env as its own fallback, so Grok is probed through the same resolution order and
// a dead Grok key only WARNS (gpt-image fallback exists) — a dead OpenAI key FAILS (it also
// backs vision grading, which has no fallback).
// Every source that HAS a value, in priority order (process env first, then repo .env),
// deduped by value. The probe walks this list and the first LIVE key wins — learned live
// 2026-07-14: a dead key PRESENT in process env shadowed a proven-live .env key, so
// "first that exists" failed a build that "first that works" would have started.
function credCandidates(...names) {
  const out = [];
  for (const n of names) if (process.env[n]) out.push({ val: process.env[n], src: `process env ${n}` });
  try {
    const txt = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8');
    for (const n of names) {
      const m = txt.match(new RegExp(`^${n}=("?)(.*?)\\1\\s*$`, 'm'));
      if (m?.[2] && !out.some((c) => c.val === m[2])) out.push({ val: m[2], src: `.env ${n}` });
    }
  } catch { /* no .env in CI — env-only is the normal hosted case */ }
  return out;
}
async function probeCred(label, candidates, url, headers) {
  if (!candidates.length) return { label, ok: false, why: 'not set anywhere (process env or repo .env)' };
  const dead = [];
  for (const cred of candidates) {
    try {
      const r = await fetch(url, { headers: headers(cred.val), signal: AbortSignal.timeout(5000) });
      if (r.ok) return { label, ok: true, val: cred.val, why: dead.length ? `OK via ${cred.src} — self-healed past: ${dead.join('; ')}` : `OK via ${cred.src}` };
      dead.push(`${cred.src} HTTP ${r.status}`);
    } catch (e) { dead.push(`${cred.src} unreachable (${e.message})`); }
  }
  return { label, ok: false, why: `every source dead: ${dead.join('; ')}` };
}
{
  const bearer = (v) => ({ Authorization: `Bearer ${v}` });
  const [a, n, o, g] = await Promise.all([
    probeCred('ANTHROPIC_API_KEY (agent reasoning)', credCandidates('ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'), 'https://api.anthropic.com/v1/models', (v) => ({ 'x-api-key': v, 'anthropic-version': '2023-06-01' })),
    probeCred('NETLIFY_AUTH_TOKEN (deploy)', credCandidates('NETLIFY_AUTH_TOKEN'), 'https://api.netlify.com/api/v1/user', bearer),
    probeCred('OPENAI_API_KEY (vision grading + image fallback)', credCandidates('OPENAI_API_KEY', 'OPEN_AI_KEY'), 'https://api.openai.com/v1/models', bearer),
    probeCred('GROK_AI_KEY (primary image engine)', credCandidates('GROK_AI_KEY', 'GROK_API_KEY'), 'https://api.x.ai/v1/models', bearer),
  ]);
  // The spawned agent and every tool authenticate from process.env — hand each the PROVEN-LIVE
  // value, OVERWRITING whatever was there (a dead value present is exactly the failure mode).
  if (a.ok) process.env.ANTHROPIC_API_KEY = a.val;
  if (n.ok) process.env.NETLIFY_AUTH_TOKEN = n.val;
  if (o.ok) process.env.OPENAI_API_KEY = o.val;
  if (g.ok) process.env.GROK_AI_KEY = g.val;
  for (const r of [a, n, o, g]) log(`credential preflight: ${r.ok ? '✓' : '✗'} ${r.label} — ${r.why}`);
  if (!g.ok) log('credential preflight: WARN — Grok unavailable, images will use the gpt-image fallback');
  const fatal = [a, n, o].filter((r) => !r.ok);
  if (fatal.length) {
    const why = fatal.map((r) => `${r.label}: ${r.why}`).join('; ');
    log(`PREFLIGHT FAILED — dead/missing credentials, stopping before any cost is incurred: ${why}`);
    await patchStatus('Stopped before building: a required service credential is invalid.', 'failed', null,
      'A service credential this build needs is missing or expired. Nothing was built and nothing was charged. The operator has been alerted with specifics.');
    await spawnAndWait('alert-owner', process.execPath, [
      path.join(REPO_ROOT, 'tools', 'alert-owner.mjs'),
      '--repo', repoUrl.replace(/^https?:\/\/github\.com\//, ''),
      '--submitter', submitter || '(none)',
      '--build-id', buildId || '(none)',
      '--run-url', runUrl || '(none)',
      '--reason', `credential preflight failed: ${why}`,
      '--elapsed-min', '0',
    ], { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
    process.exit(1);
  }
}

// THE CONCEPT TOURNAMENT (owner directive 2026-07-13): concepts compete as TEXT before any
// expensive work — three models spec, a cheap judge ranks, the winner seeds build.json.concept.
// Fail-open by design: a skipped/failed tournament logs loud and the agent invents the concept
// itself (the old path); it never blocks a build. Skipped entirely on resume (concept exists).
if (!JSON.parse(fs.readFileSync(buildJsonPath, 'utf8')).concept) {
  log('concept tournament: starting (text-mode, pre-agent)');
  const tRes = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'concept-tournament.mjs'), buildDir],
    { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'inherit'], timeout: 300_000 });
  if (tRes.status === 0) {
    const seeded = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8')).concept;
    log(seeded?.tournament ? `concept tournament: winner ${seeded.tournament.winnerModel}` : 'concept tournament: skipped (agent will invent the concept)');
  } else {
    log(`concept tournament FAILED (exit ${tRes.status}) — proceeding, agent will invent the concept`);
  }
}

const prompt = `Use the explainmyrepo skill (skills/explainmyrepo/SKILL.md is the brain — read it, follow it) to build a bespoke explainer for this repo:

TOKEN ECONOMY: skills/explainmyrepo/TOOLS-CONTRACT.md is the complete toolbox reference (every tool's own header docs: usage, flags, gotchas). Read THAT instead of tool source files — open a tool's source ONLY if the contract is genuinely ambiguous about something you need. Re-deriving tool interfaces from source has measured at ~25% of build spend; it is waste.

  ${repoUrl}

Build directory (already created, seeded with build.json): ${buildDir}
Station 0–1 (validate + clone) is ALREADY DONE by the harness: the repo is cloned, verified, and pinned at ${buildDir}/repo. Do NOT re-run clone-repo, and do NOT touch repo.url in build.json.

THE SOURCE-IDENTITY LAW (INV-21 — overrides every other instruction in this brief, including the workaround license below): the repo named above IS this build's identity. If its clone is missing, broken, or anything else makes it unusable, STOP and report ok:false with the specific reason. NEVER search for, substitute, fetch, or reconstruct a different repo or its README — an explainer of the wrong repo is fabrication, the one unforgivable output. There is no workaround for source identity.
Ship mode: --ship-best-effort semantics — if you cannot reach the exemplar bar (mean>=90/min>=85/all six operators) after a reasonable refine attempt, ship the best HONEST version you have (the SHIP_OPERATORS bar: mean>=82, min>=70, real legible diagrams, comprehension operators YES) rather than nothing. The one thing you must NEVER ship broken is the mandatory architecture + flow diagrams (INV-18) — hold rather than ship if those didn't render as real vectors.
Do NOT publish a separate GitHub repo for this build (skip that station — no write-scoped GitHub token is provisioned in this hosted context, by design).
Do NOT run the notify station (station 9) — sending the submitter's email is handled OUTSIDE your process; you have no SMTP credentials and should not need them. Your job ends once quality-grade + deploy are done and build.json's publish.liveUrl is set.
The refine loop is capped at 3 total quality-grade calls (1 initial + 2 refines) and this is now ENFORCED by the tool itself, not just this instruction — a 4th call returns the prior scorecard unchanged at zero cost rather than re-grading. Do not try to work around this; when you see capReached, ship immediately.

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
// --executor-auth subscription (owner ask 2026-07-15, verified live: headless `claude -p` with no
// ANTHROPIC_API_KEY answers on the machine's logged-in Claude subscription session): for LOCAL,
// OWNER-INITIATED builds only, strip the API key from the agent env so the executor's reasoning —
// the $3-5 slice of every build — rides the subscription instead of metered billing. Hybrid by
// design: the concept tournament and every OpenAI/Netlify tool still use API keys (raw API calls
// have no subscription path). NEVER set this on CI/hosted builds — a fresh runner has no OAuth
// session (it would just fail), and third-party traffic on a consumer plan violates its terms.
if (args['executor-auth'] === 'subscription') {
  delete agentEnv.ANTHROPIC_API_KEY;
  log('executor-auth=subscription — agent reasoning rides the local Claude login; API keys stay with tournament/tools only');
}
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

// A missing/misconfigured `claude` binary previously crashed this whole process with an
// unhandled 'error' throw and a raw Node stack trace — the exact "fail silently" this file's
// own header comment forbids. spawnErrorMsg feeds the `reason` classification below; 'close'
// never fires if spawn itself failed to start, so this also resolves exitCode instead of
// hanging the build forever.
let spawnErrorMsg = null;
child.on('error', (e) => { spawnErrorMsg = e.message; log(`claude spawn FAILED TO START: ${e.message}`); });

let killedForBudget = false;
let lastActivity = Date.now();
let totalCostUsd = 0;
let finalResultText = '';
let sawResultEvent = false;

// Failure classification for the PUBLIC-facing message (owner mandate 2026-07-10: "don't just
// fail silently — tell them why, and if it's a budget thing, tell them exactly that and point
// to npx"). Distinct from `internalReason`, which carries the raw diagnostic for admin's eyes;
// this is the honest, friendly line the submitter themselves sees and gets emailed.
const NPX_LINE = 'Run it yourself with no wait and no budget limit: npx explainmyrepo <your-github-url> in a VS Code / Claude Code session (or Codex) — it uses your own API key and takes about 15 minutes.';
function classifyFailure(reason) {
  const r = String(reason || '');
  if (/credit balance|insufficient.*balance|billing/i.test(r)) {
    return `We ran this build for free, and it's been genuinely popular — the community budget is tapped out for the moment, not anything wrong with your repo. ${NPX_LINE}`;
  }
  if (/exceeded its.*budget|wall-clock/i.test(r)) {
    return `Your repo needed more time than we could give it for free this round — not a failure of the build itself. ${NPX_LINE}`;
  }
  return `It didn't complete this time — not necessarily your repo's fault, our free hosted builds do sometimes hit a snag. ${NPX_LINE}`;
}

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
      // Two builds failed on 2026-07-09 with nothing but "exited 1" in the log — when the
      // session itself errors, its own words are the diagnosis. Log them.
      if (evt.is_error) log(`agent error result: ${String(evt.result || '(no result text)').slice(0, 600)}`);
    }
  }
});

const exitCode = await new Promise((resolve) => {
  if (spawnErrorMsg) { resolve(-1); return; }
  child.on('close', resolve);
  child.on('error', () => resolve(-1)); // covers an 'error' that fires after this Promise is built
});
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

// THE OPERATOR'S GRADE (2026-07-15) — mechanizes what was done by hand for agentic-kit: the
// refine cap bounds the AGENT's spend, not the truth. When the agent ends UNSHIPPED at the cap
// but documented a genuine post-cap fix (quality.postCapManualFix), the RUNNER — trusted
// deterministic code, outside the agent — spends exactly ONE fresh grade and, if the page now
// honestly passes, deploys through the ship-bar rail (no force; the rail stays the judge).
// Fires at most once per run; a page that fails its operator grade stays refused. Without a
// documented fix there is nothing new to verify, so it does NOT fire on plain B5 stalls.
if (exitCode === 0 && !killedForBudget && !liveUrl && !identityViolation) {
  try {
    const bc = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
    const q = bc.quality;
    if (q && q.postCapManualFix && q.passed !== true && Number.isInteger(q.iterations) && q.iterations >= 3
        && fs.existsSync(path.join(buildDir, 'site', 'index.html'))) {
      log(`operator grade: agent ended at the refine cap WITH a documented post-cap fix — spending one runner-authorized regrade`);
      const savedNote = q.postCapManualFix;
      bc.quality.iterations = q.iterations - 1;
      fs.writeFileSync(buildJsonPath, JSON.stringify(bc, null, 2) + '\n');
      const g = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'quality-grade.mjs'), buildDir],
        { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'inherit'], timeout: 420_000 });
      const after = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
      after.quality.postCapManualFix = savedNote;
      after.quality.operatorRegrade = { authorizedBy: 'runner (deterministic post-cap verification)', gradeExit: g.status };
      fs.writeFileSync(buildJsonPath, JSON.stringify(after, null, 2) + '\n');
      if (g.status === 0 && after.quality?.passed === true) {
        log(`operator grade: PASSED fresh — deploying through the ship-bar rail`);
        const d = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'deploy.mjs'), buildDir],
          { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'inherit'], timeout: 180_000 });
        const shipped = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
        if (d.status === 0 && shipped.publish?.liveUrl && shipped.publish?.http200) {
          liveUrl = shipped.publish.liveUrl;
          log(`operator grade: cured and shipped — ${liveUrl}`);
        } else {
          log(`operator grade: regrade passed but deploy refused/failed (exit ${d.status}) — leaving run as failed`);
        }
      } else {
        log(`operator grade: page still below the bar on a fresh grade (passed=${after.quality?.passed}) — refusal stands, honestly`);
      }
    }
  } catch (e) { log(`operator grade: skipped on error (${e?.message || e}) — run outcome unchanged`); }
}

const budgetExceeded = killedForBudget;
const ok = exitCode === 0 && !budgetExceeded && !!liveUrl && !identityViolation;
const elapsedMin = ((Date.now() - (lastActivity - 0)) / 60000); // approx; refined below
const reason = identityViolation
  ? `SOURCE-IDENTITY VIOLATION: ${identityViolation} — treating any deploy from this run as invalid`
  : spawnErrorMsg
  ? `could not start the claude binary: ${spawnErrorMsg}`
  : budgetExceeded
  ? `exceeded its ${budgetMin}-minute budget before finishing`
  : agentReported && agentReported.ok === false ? agentReported.reason
  : exitCode !== 0 ? `claude process exited ${exitCode}`
  : !liveUrl ? 'agent finished but no verified live URL was found in build.json'
  : 'unknown';

// The status gist is each build's permanent public record, so the GRADES and the cost of
// production travel with the result — the admin dashboard trends them across builds (owner
// ask 2026-07-09: "grade every one 1-100 and tell yourself if you're getting better, worse,
// or the same"). Extraction is defensive: a missing scorecard never blocks the ship.
let scorecard = null;
try {
  const q = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8')).quality;
  if (q && Array.isArray(q.scorecard) && q.scorecard.length) {
    scorecard = {
      passed: !!q.passed,
      exemplary: !!q.exemplary,
      iterations: Number.isInteger(q.iterations) ? q.iterations : null,
      gradedAt: q.gradedAt || null,
      devices: q.scorecard.map((c) => ({
        device: c.deviceLabel || c.device || null,
        headline: c.headlineScore ?? null,
        gateA: c.gateA || null,
        gateB: c.gateB || null,
        operators: c.operatorQuestions || null,
      })),
    };
  }
} catch { /* build.json unreadable — already reflected in the liveUrl check */ }

// ADR-174 oracle feed (2026-07-15): the memory distiller PROMOTES patterns only from
// execution-observed outcomes, judged by the `feedback` namespace — and no build ever wrote one,
// so all 282 distilled patterns sat proxy-tier (promoted: 0). Every completed build now records
// its MEASURED result (real vision-graded axes, verified deploy, cost) as a feedback entry.
// Best-effort by design: ruflo is a machine-global binary, absent on CI runners (which have no
// memory substrate anyway) — a miss must never touch the build outcome.
try {
  const fb = {
    kind: 'explainer-build-outcome', repo: repoUrl, ok, reason: ok ? null : reason.slice(0, 400),
    passed: scorecard?.passed ?? null, exemplary: scorecard?.exemplary ?? null,
    devices: scorecard?.devices?.map((d) => ({ device: d.device, gateA: d.gateA, gateB: d.gateB, operators: d.operators })) ?? null,
    costUsd: Math.round(totalCostUsd * 100) / 100, liveUrl: liveUrl || null,
  };
  const fbRes = spawnSync('ruflo', ['memory', 'store', '-k', `build-outcome-${buildId || Date.now()}`,
    '--value', JSON.stringify(fb), '--namespace', 'feedback'], { cwd: REPO_ROOT, timeout: 20_000, stdio: 'ignore' });
  if (fbRes.status === 0) log('build outcome recorded to feedback namespace (ADR-174 oracle tier — distiller promotes from these)');
} catch { /* telemetry never inverts a build outcome */ }

if (ok) {
  console.log(`LIVE: ${liveUrl}`);
  log(`SUCCESS — ${liveUrl} (cost $${totalCostUsd.toFixed(2)})`);
  await patchStatus('Done — your explainer is live.', 'done',
    { liveUrl, scorecard, costUsd: Math.round(totalCostUsd * 100) / 100 }, null);
  // Notify runs HERE, not inside the agent (see the env allowlist above) — this is plain
  // deterministic code, not an LLM interpreting untrusted repo content, so it's the safe place to
  // hold SMTP creds. Non-blocking: a notify failure must never flip a successful build to failed.
  if (submitter) {
    const notifyEnv = { ...process.env, EMAIL_TO: submitter };
    await spawnAndWait('notify', process.execPath, [path.join(REPO_ROOT, 'tools', 'notify.mjs'), buildDir], { cwd: REPO_ROOT, env: notifyEnv, stdio: 'inherit' });
  }
  process.exit(0);
} else {
  log(`FAILED — ${reason}`);
  const publicMessage = classifyFailure(reason);
  await patchStatus('The build could not finish.', 'failed', null, publicMessage, reason);
  // Gate-refusal alerts must carry the grader's ACTUAL complaints (learned 2026-07-15:
  // autonomous-wealth-builder's alert said "B5 stayed at 56/58" but not WHY, so the operator
  // couldn't judge whether it was worth curing without re-running the whole build). Append the
  // rationale of every floor-failing axis + false operator questions from the final scorecard.
  let gateDetail = '';
  try {
    const q = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8')).quality;
    for (const dev of q?.scorecard || []) {
      for (const [axis, score] of Object.entries({ ...dev.gateA, ...dev.gateB })) {
        if (score < 70) gateDetail += `\n[${dev.device} ${axis}=${score}] ${String(dev.rationales?.[axis] || '').slice(0, 500)}`;
      }
      const falseOps = Object.entries(dev.operatorQuestions || {}).filter(([, v]) => !v).map(([k]) => k);
      if (falseOps.length) gateDetail += `\n[${dev.device} operators false] ${falseOps.join(', ')}`;
    }
  } catch { /* no scorecard — nothing to append */ }
  const alertArgs = [
    path.join(REPO_ROOT, 'tools', 'alert-owner.mjs'),
    '--repo', repoUrl.replace(/^https?:\/\/github\.com\//, ''),
    '--submitter', submitter || '(none)',
    '--build-id', buildId || '(none)',
    '--run-url', runUrl || '(none)',
    '--reason', gateDetail ? `${reason}\n\nGATE DETAIL (grader's own words):${gateDetail}` : reason,
    '--elapsed-min', String(Math.round(budgetMin)),
  ];
  await spawnAndWait('alert-owner', process.execPath, alertArgs, { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
  // The submitter used to hear NOTHING on failure beyond a status page most people stop
  // watching after 20 minutes — the exact "silent failure" the owner flagged 2026-07-10.
  // Non-blocking, mirrors alert-owner's own tolerance: an email failure must never invert
  // the real build outcome.
  if (submitter) {
    const failNotifyArgs = [
      path.join(REPO_ROOT, 'tools', 'notify-failure.mjs'),
      '--repo', repoUrl.replace(/^https?:\/\/github\.com\//, ''),
      '--to', submitter,
      '--message', publicMessage,
    ];
    await spawnAndWait('notify-failure', process.execPath, failNotifyArgs, { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
  }
  process.exit(1);
}
