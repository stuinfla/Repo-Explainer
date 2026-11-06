#!/usr/bin/env node
// bin/agentic-runner.mjs — the HOSTED door. Deterministic preflight (clone, live credential and
// embedding probes, concept tournament), then `claude -p` running skills/explainmyrepo/SKILL.md, then
// the cure stage, then notify. The decisions live in runner-lib.mjs / runner-preflight.mjs / cure.mjs
// (importable, unit-tested); this file is the wiring.
//
// Usage: node bin/agentic-runner.mjs <github-url|owner/name> --build-dir <dir> [--budget-min N]
//        [--budget-usd N] [--submitter <email>] [--run-url <url>] [--build-id <id>] [--gist-id <id>]
//
//   - The agent runs headless with --permission-mode bypassPermissions and --bare, tools limited to
//     Bash/Read/Write/Edit/Glob/Grep, env limited to AGENT_ENV_ALLOWLIST, .env reads disallowed.
//   - stream-json shows tool calls as they happen (status gist gets a human progress line).
//   - The runner enforces its own wall-clock and $ ceilings so it can still report before the outer
//     job is SIGKILLed.
//   - Any failure (non-zero exit, budget kill, no verified live URL) alerts the owner AND the submitter.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCureStage, createCostMeter, maxBudgetArgs, CURE } from './cure.mjs';
import { probeCredentials, probeEmbedding } from './runner-preflight.mjs';
import { NPX_LINE, mainAgentSpawn, cureAgentSpawn, spawnAndWait, startAgent, createStreamHandler, repoId, elapsedMinutes, agentWallMs, MIN_AGENT_WALL_MS, STATUS_RETRY_DELAYS_MS,
  classifyFailure, agentReportOf, liveUrlOf, finalizeRun, disclosureOf, scorecardOf, buildAgentPrompt } from './runner-lib.mjs';
import { recordClaims } from '../src/claims-record.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const startedAt = Date.now();

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
// The workflow passes bare "owner/name": normalize to a full URL so the identity pin, build.json seed and clone agree.
if (!/^[a-z]+:\/\//i.test(repoUrl) && !/github\.com/i.test(repoUrl)) repoUrl = `https://github.com/${repoUrl.replace(/^\/+/, '')}`;

const buildDir = path.resolve(args['build-dir'] || path.join(REPO_ROOT, 'build', `hosted-${Date.now()}`));
const budgetMin = Number(args['budget-min'] || 20);
const budgetUsd = Number(args['budget-usd'] || 8);
const submitter = args.submitter || '';
const runUrl = args['run-url'] || '';
const buildId = args['build-id'] || '';
// The tournament (text-mode, cents) holds the premium creative judgment, so the implementation
// agent runs on the low-cost tier (build-economics-text-first).
const model = args.model || 'claude-sonnet-5-5';
let executor = { lane: 'anthropic', model, baseUrl: null, key: null };

fs.mkdirSync(buildDir, { recursive: true });
const buildJsonPath = path.join(buildDir, 'build.json');
if (!fs.existsSync(buildJsonPath)) fs.writeFileSync(buildJsonPath, JSON.stringify({ repo: { url: repoUrl } }, null, 2) + '\n');

const log = (msg) => process.stderr.write(`[agentic-runner] ${msg}\n`);
const run = (label, bin, argv, opts) => spawnAndWait(label, bin, argv, opts, log);
const readBuild = () => JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
const repoSlug = repoUrl.replace(/^https?:\/\/github\.com\//, '');

const submittedRepoId = repoId(repoUrl);
if (!submittedRepoId) { console.error(`[agentic-runner] cannot parse owner/name from "${repoUrl}" — need a github.com/owner/name URL`); process.exit(2); }

// ── status gist (the submitter's progress page) ──────────────────────────────────────────────────
const gistId = args['gist-id'] || '';
const ghToken = process.env.EXPLAINER_GH_TOKEN || process.env.GITHUB_TOKEN || '';
let lastProgressPatchAt = 0;

// 'building' patches are throttled (a patch per tool call hit GitHub's secondary rate limit); the
// terminal 'done'/'failed' patch must land, so it retries through the limit. Never throws.
async function patchStatus(stepName, status = 'building', result = null, error = null, internalReason = null) {
  if (!gistId || !ghToken || !buildId) {
    if (status !== 'building') log(`patchStatus(${status}) SKIPPED — missing ${!gistId ? 'gistId' : !ghToken ? 'ghToken' : 'buildId'}`);
    return;
  }
  if (status === 'building') {
    if (Date.now() - lastProgressPatchAt < 20_000) return;
    lastProgressPatchAt = Date.now();
  }
  const delaysMs = status === 'building' ? [] : STATUS_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        // internalReason is for the admin dashboard; the submitter's page only shows `error`.
        body: JSON.stringify({ files: { 'status.json': { content: JSON.stringify({ buildId, stepName, status, repo: repoUrl, result, error, internalReason }, null, 2) } } }),
      });
      if (resp.ok) return;
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

// A preflight failure ends the run before any cost: tell the status page, the OWNER and the SUBMITTER.
async function failBeforeBuild({ stepName, publicMessage, reason }) {
  await patchStatus(stepName, 'failed', null, publicMessage);
  await run('alert-owner', process.execPath, [
    path.join(REPO_ROOT, 'tools', 'alert-owner.mjs'),
    '--repo', repoSlug, '--submitter', submitter || '(none)', '--build-id', buildId || '(none)', '--run-url', runUrl || '(none)',
    '--reason', reason, '--elapsed-min', String(elapsedMinutes(startedAt)),
  ], { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
  if (submitter) {
    await run('notify-failure', process.execPath, [path.join(REPO_ROOT, 'tools', 'notify-failure.mjs'), '--repo', repoSlug, '--to', submitter, '--message', publicMessage],
      { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
  }
  process.exit(1);
}

// ── SOURCE-IDENTITY GATE: validate + clone run HERE, before the agent exists (INV-21) ─────────────
// The clone needs the token, which the agent must never hold; and if the EXACT submitted repo cannot
// be cloned, the build ends loudly — nothing can "work around" it by substituting a lookalike.
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
  await failBeforeBuild({
    stepName: 'Stopped before building: we could not access this repo.',
    publicMessage: `We couldn't access ${repoUrl}. If it's private, share it with our GitHub account or make it public, then rebuild. Nothing was built — we never build from a guess or a similar-looking repo.`,
    reason: `repo inaccessible at preflight: ${why}`,
  });
}
log(`preflight OK — cloned ${cloneOut.outputs?.repo?.owner}/${cloneOut.outputs?.repo?.name} (private=${cloneOut.outputs?.repo?.private})`);

// ── CREDENTIAL + EMBEDDING PREFLIGHT: prove every key and the model source BEFORE any cost ─────────
{
  let dotenvText = '';
  try { dotenvText = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8'); } catch { /* no .env in CI — env-only is the normal hosted case */ }
  const { a, n, o, executor: lane } = await probeCredentials({ model, env: process.env, dotenvText, log });
  executor = lane;
  // The agent and every tool authenticate from process.env: hand each the PROVEN-live value, overwriting a dead one.
  if (a.ok && executor.lane === 'anthropic') process.env.ANTHROPIC_API_KEY = a.val;
  if (n.ok) process.env.NETLIFY_AUTH_TOKEN = n.val;
  if (o.ok) process.env.OPENAI_API_KEY = o.val;
  for (const r of [a, n, o]) log(`credential preflight: ${r.ok ? '✓' : '✗'} ${r.label} — ${r.why}`);
  const fatal = [a, n, o].filter((r) => !r.ok);
  if (fatal.length) {
    const why = fatal.map((r) => `${r.label}: ${r.why}`).join('; ');
    log(`PREFLIGHT FAILED — dead/missing credentials, stopping before any cost is incurred: ${why}`);
    await failBeforeBuild({
      stepName: a.usageLimited ? 'Stopped before building: the free community budget is used up for the moment.' : 'Stopped before building: a required service credential is invalid.',
      publicMessage: a.usageLimited
        ? `We ran this build for free, and it's been genuinely popular — the community budget is used up for the moment (it resets monthly), not anything wrong with your repo. Nothing was built and nothing was charged. ${NPX_LINE}`
        : 'A service credential this build needs is missing or expired. Nothing was built and nothing was charged. The operator has been alerted with specifics.',
      reason: `credential preflight failed: ${why}`,
    });
  }
  const embed = await probeEmbedding({ cachedModelExists: fs.existsSync(path.join(REPO_ROOT, 'kb', 'models-cache', 'Xenova', 'bge-small-en-v1.5', 'onnx', 'model_quantized.onnx')) });
  log(`embedding preflight: ${embed.ok ? '✓' : '✗'} ${embed.why}`);
  if (!embed.ok) {
    log(`PREFLIGHT FAILED — no embedding source, stopping before any cost is incurred: ${embed.why}`);
    await failBeforeBuild({
      stepName: 'Stopped before building: the knowledge-base embedding model is unavailable.',
      publicMessage: 'The embedding model this build grounds itself on has no local cache and its download source (huggingface.co) is unreachable — usually a temporary outage on their side. Nothing was built and nothing was charged. Please try again in a little while.',
      reason: `embedding preflight failed in seconds: ${embed.why}. The workflow's kb/warm-model-cache.mjs step seeds the cache first (sha256-pinned release asset, else Hugging Face), so reaching here means that seeding failed and Hugging Face is unreachable too; a later run recovers once either source is up.`,
    });
  }
}

// ── CONCEPT TOURNAMENT: concepts compete as text before any expensive work. Fail-open: a skipped or
// failed tournament logs loud and the agent invents the concept; skipped on resume (concept exists).
if (!readBuild().concept) {
  log('concept tournament: starting (text-mode, pre-agent)');
  const tRes = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'concept-tournament.mjs'), buildDir],
    { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'inherit'], timeout: 300_000 });
  if (tRes.status === 0) {
    const seeded = readBuild().concept;
    log(seeded?.tournament ? `concept tournament: winner ${seeded.tournament.winnerModel}` : 'concept tournament: skipped (agent will invent the concept)');
  } else log(`concept tournament FAILED (exit ${tRes.status}) — proceeding, agent will invent the concept`);
}

log(`starting: ${repoUrl} (budget ${budgetMin}min / $${budgetUsd}, build dir ${buildDir})`);

// --executor-auth subscription: LOCAL, owner-initiated builds only (a fresh CI runner has no OAuth
// session, and third-party traffic on a consumer plan violates its terms).
const subscription = args['executor-auth'] === 'subscription';
if (subscription) log('executor-auth=subscription — agent reasoning rides the local Claude login; API keys stay with tournament/tools only');
if (executor.baseUrl) log(`executor lane: ${executor.lane} (${executor.model}) via ${executor.baseUrl}`);

const claudeBin = process.env.CLAUDE_BIN || 'claude';
if (!maxBudgetArgs(budgetUsd).length) log(`WARN — --budget-usd "${args['budget-usd']}" is not a positive number; the main run has NO dollar ceiling`);

// Pre-agent work (clone, probes, tournament) is part of the budget: the agent gets what is left.
const agentMs = agentWallMs({ budgetMin, startedAt });
if (!agentMs) {
  await failBeforeBuild({
    stepName: 'Stopped before building: setup used the time budget.',
    publicMessage: `Setup took longer than expected and left too little time to build this round — nothing was built. ${NPX_LINE}`,
    reason: `pre-agent stages used ${elapsedMinutes(startedAt)} of the ${budgetMin}-minute budget; under ${MIN_AGENT_WALL_MS / 60_000} min left for the agent`,
  });
}
const agentBudgetMin = Math.max(1, Math.floor(agentMs / 60_000));
const spawnCtx = { claudeBin, executor, procEnv: process.env, submittedRepoId, subscription, cwd: REPO_ROOT };
const mainSpawn = mainAgentSpawn({ ...spawnCtx, prompt: buildAgentPrompt({ repoUrl, buildDir, budgetMin: agentBudgetMin, budgetUsd }), budgetUsd });
const { child, state: agentState, exited } = startAgent(mainSpawn.bin, mainSpawn.argv, mainSpawn.opts, log);

let killedForBudget = false;
const costMeter = createCostMeter(executor.model);
if (!costMeter.known) log(`WARN — no rate for ${executor.model}; the streamed $ backstop is off, only --max-budget-usd guards the ceiling`);

// The status gist is read by the submitter's browser: a human progress line, never the raw tool call
// (which still goes to the workflow log).
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

const stopAgent = () => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10_000); };
const hardTimer = setTimeout(() => {
  killedForBudget = true;
  log(`WALL-CLOCK BUDGET EXCEEDED (${budgetMin} min, ${elapsedMinutes(startedAt)} used) — stopping the agent cleanly rather than letting the outer job get SIGKILLed.`);
  stopAgent();
}, agentMs);

const stream = createStreamHandler({
  costMeter, budgetUsd, stop: stopAgent, log,
  onToolUse: (block) => {
    log(`→ ${block.name === 'Bash' ? String(block.input?.command || '').slice(0, 140) : `${block.name} ${JSON.stringify(block.input || {}).slice(0, 100)}`}`);
    patchStatus(friendlyStep(block.name, block.input));
  },
});
child.stdout.on('data', (chunk) => stream.feed(chunk));

const exitCode = await exited;
clearTimeout(hardTimer);
const { killedForUsd, finalResultText, sawResultEvent } = stream.state;
let totalCostUsd = stream.state.totalCostUsd;
const spawnErrorMsg = agentState.spawnErrorMsg;
if (!sawResultEvent && costMeter.usd > totalCostUsd) {
  totalCostUsd = costMeter.usd; // killed/crashed before the final `result` event — the streamed estimate is the best figure
  log(`no result event — cost taken from the streamed usage estimate: ~$${totalCostUsd.toFixed(2)}`);
}

// ── outcome: the agent's RESULT line is a courtesy; build.json is the truth ────────────────────────
const agentReported = agentReportOf(finalResultText);
let finalCtx = null;
try { finalCtx = readBuild(); } catch { /* build.json may not exist on a very early failure */ }
let liveUrl = liveUrlOf(finalCtx);
const identityViolation = finalizeRun({ exitCode, spawnErrorMsg, liveUrl, finalCtx, submittedRepoId }).identityViolation;

// ── THE CURE STAGE (bin/cure.mjs runCureStage): every unshipped or below-bar ending is classified
// deterministically. A near-miss gets ONE bounded cycle: a narrow cure agent fixes ONLY the named
// weaknesses, ONE fresh grade, then tools/deploy.mjs. A page already live is replaced only by a strictly
// better verdict.
const tool = (name) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', name), buildDir],
  { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'inherit'], timeout: name === 'deploy.mjs' ? CURE.DEPLOY_WALL_MS : CURE.GRADE_WALL_MS });
const cure = await runCureStage({ buildDir, repoUrl, exitCode, killedForBudget, killedForUsd, identityViolation, spawnErrorMsg, liveUrl, totalCostUsd, budgetUsd }, {
  readBuild, writeBuild: (o) => fs.writeFileSync(buildJsonPath, JSON.stringify(o, null, 2) + '\n'),
  siteExists: () => fs.existsSync(path.join(buildDir, 'site', 'index.html')),
  deploy: () => tool('deploy.mjs'), grade: () => tool('quality-grade.mjs'),
  cureAgent: ({ prompt, remainingUsd }) => { const sp = cureAgentSpawn({ ...spawnCtx, prompt, remainingUsd }); return spawnSync(sp.bin, sp.argv, sp.opts); },
  patchStatus, log,
});
liveUrl = cure.liveUrl;
totalCostUsd = cure.totalCostUsd;

// ADVISORY claims check on the page that is actually live: lands in build.json `claims`, never blocks.
if (exitCode === 0 && fs.existsSync(path.join(buildDir, 'site', 'index.html'))) recordClaims(buildDir, { root: REPO_ROOT, log });

try { finalCtx = readBuild(); } catch { finalCtx = null; }
const { ok, reason } = finalizeRun({ exitCode, killedForBudget, killedForUsd, spawnErrorMsg, agentReported, liveUrl, finalCtx, submittedRepoId, budgetMin, budgetUsd, totalCostUsd });

// The status gist is each build's permanent public record: grades and cost travel with the result.
// Which axis held a below-bar page back, and the FORM each diagram took, are recorded so the
// "same form" taxonomy stays falsifiable (ADR-0011 D4 / ADR-0012 D4).
const { publishDisclosure, diagramForms } = disclosureOf(finalCtx);
const scorecard = scorecardOf(finalCtx, executor.lane);

// Feed the memory distiller one MEASURED outcome per build (ADR-174 oracle tier). Best-effort: the
// ruflo binary is absent on CI runners, and telemetry never inverts a build outcome.
try {
  const fb = {
    kind: 'explainer-build-outcome', repo: repoUrl, ok, reason: ok ? null : reason.slice(0, 400),
    passed: scorecard?.passed ?? null, exemplary: scorecard?.exemplary ?? null,
    belowBarDelivery: publishDisclosure, diagramForms,
    devices: scorecard?.devices?.map((d) => ({ device: d.device, gateA: d.gateA, gateB: d.gateB, operators: d.operators })) ?? null,
    costUsd: Math.round(totalCostUsd * 100) / 100, liveUrl: liveUrl || null,
  };
  const fbRes = spawnSync('ruflo', ['memory', 'store', '-k', `build-outcome-${buildId || Date.now()}`,
    '--value', JSON.stringify(fb), '--namespace', 'feedback'], { cwd: REPO_ROOT, timeout: 20_000, stdio: 'ignore' });
  if (fbRes.status === 0) log('build outcome recorded to feedback namespace (ADR-174 oracle tier)');
} catch { /* telemetry never inverts a build outcome */ }

if (ok) {
  console.log(`LIVE: ${liveUrl}`);
  log(`SUCCESS — ${liveUrl} (cost $${totalCostUsd.toFixed(2)})`);
  await patchStatus('Done — your explainer is live.', 'done', { liveUrl, scorecard, costUsd: Math.round(totalCostUsd * 100) / 100 }, null);
  // Notify runs HERE, not in the agent: this is deterministic code, the safe place to hold SMTP creds.
  // A notify failure must never flip a successful build to failed.
  if (submitter) await run('notify', process.execPath, [path.join(REPO_ROOT, 'tools', 'notify.mjs'), buildDir], { cwd: REPO_ROOT, env: { ...process.env, EMAIL_TO: submitter }, stdio: 'inherit' });
  process.exit(0);
}

log(`FAILED — ${reason}`);
const publicMessage = classifyFailure(reason);
await patchStatus('The build could not finish.', 'failed', null, publicMessage, reason);
// The owner's alert carries the grader's ACTUAL complaints (every floor-failing axis + false operator
// question), so the operator can judge whether a cure is worth it without re-running the build.
let gateDetail = '';
try {
  for (const dev of finalCtx?.quality?.scorecard || []) {
    for (const [axis, score] of Object.entries({ ...dev.gateA, ...dev.gateB })) {
      if (score < 70) gateDetail += `\n[${dev.device} ${axis}=${score}] ${String(dev.rationales?.[axis] || '').slice(0, 500)}`;
    }
    const falseOps = Object.entries(dev.operatorQuestions || {}).filter(([, v]) => !v).map(([k]) => k);
    if (falseOps.length) gateDetail += `\n[${dev.device} operators false] ${falseOps.join(', ')}`;
  }
} catch { /* no scorecard — nothing to append */ }
await run('alert-owner', process.execPath, [
  path.join(REPO_ROOT, 'tools', 'alert-owner.mjs'),
  '--repo', repoSlug, '--submitter', submitter || '(none)', '--build-id', buildId || '(none)', '--run-url', runUrl || '(none)',
  '--reason', gateDetail ? `${reason}\n\nGATE DETAIL (grader's own words):${gateDetail}` : reason,
  '--elapsed-min', String(elapsedMinutes(startedAt)),
], { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
// The submitter hears about a failure by email too; non-blocking, like the alert.
if (submitter) {
  await run('notify-failure', process.execPath, [path.join(REPO_ROOT, 'tools', 'notify-failure.mjs'), '--repo', repoSlug, '--to', submitter, '--message', publicMessage],
    { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
}
process.exit(1);
