// bin/runner-lib.mjs — the hosted runner's decisions as plain exported functions, so tests run the
// real code instead of grepping bin/agentic-runner.mjs (a top-level script that cannot be imported).

import { spawn } from 'node:child_process';
import { MAX_QUALITY_ITERATIONS } from '../tools/quality-grade.mjs';
import { overUsdBackstop, isNativeBudgetStop, maxBudgetArgs, CURE } from './cure.mjs';

export const NPX_LINE = 'Run it yourself with no wait and no budget limit: npx explainmyrepo <your-github-url> in a VS Code / Claude Code session (or Codex) — it uses your own API key and takes about 15 minutes.';

// The repo-controlled agent sees ONLY these. No GitHub token (gist-write / repo-publish scope) and no
// SMTP credential is ever forwarded: a hostile README is a realistic prompt-injection vector and the
// agent has Bash. ANTHROPIC_API_KEY is needed by `claude -p` itself; OPENAI + NETLIFY by the tools.
export const AGENT_ENV_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR', 'NODE_ENV', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NETLIFY_AUTH_TOKEN'];

// Files the agent may never read, even though its env is already scrubbed.
export const AGENT_DISALLOWED_TOOLS = ['Read(./.env)', 'Read(./.env.*)', 'Read(**/.env)', 'Read(**/.env.*)'];
export const AGENT_ALLOWED_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];

// The agent's environment: the allowlist, the INV-21 identity pin (not a secret), and — when the
// preflight engaged the OpenRouter lane — that lane's endpoint and key. `subscription` (local,
// owner-initiated builds only) strips the API key so reasoning rides the local Claude login.
// CI=1 is set on purpose: the local-door-only tools (make-trailer, make-social-loop, make-overview)
// refuse to run when CI is set (ADR-0009 INV-31), and the allowlist would otherwise hide it from them.
export function buildAgentEnv(procEnv, { submittedRepoId, executor, subscription = false }) {
  const env = {};
  for (const key of AGENT_ENV_ALLOWLIST) if (procEnv[key] !== undefined) env[key] = procEnv[key];
  if (subscription) delete env.ANTHROPIC_API_KEY;
  env.CI = '1';
  env.EXPLAINER_SUBMITTED_REPO = submittedRepoId;
  if (executor?.baseUrl) {
    env.ANTHROPIC_BASE_URL = executor.baseUrl;
    env.ANTHROPIC_API_KEY = executor.key;
    env.ANTHROPIC_AUTH_TOKEN = executor.key;
  }
  return env;
}

// Fire-and-forget spawns (alert, notify) must never crash the runner or hang it: a missing binary
// emits 'error' and never 'close'. Resolves the exit code, or -1 if the process could not start.
export function spawnAndWait(label, bin, args, opts, log = () => {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, opts);
    let settled = false;
    child.on('error', (e) => { if (settled) return; settled = true; log(`${label} FAILED TO START: ${e.message}`); resolve(-1); });
    child.on('close', (code) => { if (settled) return; settled = true; resolve(code); });
  });
}

// Starts the main agent. A missing/misconfigured binary emits 'error' and never 'close': record it
// in state.spawnErrorMsg and resolve `exited` with -1, or the build would hang (or crash with a raw
// stack trace). The listener is registered synchronously, before any event can fire.
export function startAgent(bin, argv, opts, log = () => {}) {
  const state = { spawnErrorMsg: null };
  const child = spawn(bin, argv, opts);
  const exited = new Promise((resolve) => {
    child.on('error', (e) => { state.spawnErrorMsg = e.message; log(`claude spawn FAILED TO START: ${e.message}`); resolve(-1); });
    child.on('close', resolve);
  });
  return { child, state, exited };
}

// Folds the agent's stream-json lines into run state and enforces the $ backstop. The native
// --max-budget-usd stop is the primary guard; total_cost_usd only arrives on the final `result`
// event, so the streamed meter is what can stop an agent that ignores the native cap.
export function createStreamHandler({ costMeter, budgetUsd, stop = () => {}, onToolUse = () => {}, log = () => {} }) {
  const state = { killedForUsd: null, totalCostUsd: 0, finalResultText: '', sawResultEvent: false };
  let buf = '';
  function handleLine(line) {
    let evt;
    try { evt = JSON.parse(line); } catch { return; }
    costMeter.add(evt);
    if (!state.killedForUsd && overUsdBackstop(costMeter.usd, budgetUsd)) {
      state.killedForUsd = 'backstop';
      log(`DOLLAR BUDGET EXCEEDED — streamed usage estimates $${costMeter.usd.toFixed(2)} against a $${budgetUsd} ceiling and the native cap did not stop the agent; stopping it now.`);
      stop();
    }
    if (evt.type === 'assistant' && Array.isArray(evt.message?.content)) {
      for (const block of evt.message.content) if (block.type === 'tool_use') onToolUse(block);
    } else if (evt.type === 'result') {
      state.sawResultEvent = true;
      state.totalCostUsd = evt.total_cost_usd || 0;
      state.finalResultText = evt.result || '';
      if (isNativeBudgetStop(evt)) {
        state.killedForUsd = state.killedForUsd || 'native';
        log(`DOLLAR BUDGET EXCEEDED — Claude Code stopped the agent at $${state.totalCostUsd.toFixed(2)} (ceiling $${budgetUsd}).`);
      }
      log(`agent finished: is_error=${evt.is_error} cost=$${state.totalCostUsd.toFixed(2)} turns=${evt.num_turns}`);
      if (evt.is_error) log(`agent error result: ${String(evt.result || '(no result text)').slice(0, 600)}`);
    }
  }
  return {
    state,
    feed(chunk) {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) if (line.trim()) handleLine(line);
    },
  };
}

// Canonical lowercase "owner/name" for a GitHub URL — the identity the whole build is pinned to (INV-21).
export function repoId(u) {
  const m = String(u || '').trim().replace(/\/+$/, '').match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

export const elapsedMinutes = (startMs, nowMs = Date.now()) => Math.max(0, Math.round((nowMs - startMs) / 60_000));

// The honest, friendly line the SUBMITTER sees; the raw reason goes to the admin only.
export function classifyFailure(reason) {
  const r = String(reason || '');
  if (/credit balance|insufficient.*balance|billing|usage limits|regain access/i.test(r)) {
    return `We ran this build for free, and it's been genuinely popular — the community budget is tapped out for the moment, not anything wrong with your repo. ${NPX_LINE}`;
  }
  if (/dollar budget/i.test(r)) return `Your repo needed more work than our free per-build budget covers this round — not a failure of the build itself. ${NPX_LINE}`;
  if (/exceeded its.*budget|wall-clock/i.test(r)) return `Your repo needed more time than we could give it for free this round — not a failure of the build itself. ${NPX_LINE}`;
  return `It didn't complete this time — not necessarily your repo's fault, our free hosted builds do sometimes hit a snag. ${NPX_LINE}`;
}

// The repo the build ENDED on must be the repo the human submitted, or nothing ships (INV-21).
// An unreadable build.json yields null here: the live-URL check already fails that case.
export function identityViolationOf(finalCtx, submittedRepoId) {
  if (!finalCtx) return null;
  const finalId = repoId(finalCtx?.repo?.url);
  return finalId === submittedRepoId ? null : `build ended on "${finalCtx?.repo?.url}" but was submitted for ${submittedRepoId}`;
}

// Where did the agent's run end? The agent's own RESULT line is a courtesy; build.json is the truth.
export function agentReportOf(finalResultText) {
  const m = String(finalResultText || '').match(/RESULT:\s*(\{.*\})\s*$/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
// Only the deploy tool's own verified record counts. An agent's RESULT line is repo-influenced text:
// never trusted for a URL that goes into the submitter's status page and email.
export function liveUrlOf(ctx) {
  return ctx?.publish?.liveUrl && ctx.publish.http200 === true ? ctx.publish.liveUrl : null;
}

// The run's verdict: ok only for a clean exit, inside both budgets, with a verified live URL on the
// submitted repo. `liveUrl` is the FINAL one (after any cure redeploy); identity is re-checked here.
export function finalizeRun({ exitCode, killedForBudget, killedForUsd, spawnErrorMsg, agentReported, liveUrl, finalCtx, submittedRepoId, budgetMin, budgetUsd, totalCostUsd }) {
  const identityViolation = identityViolationOf(finalCtx, submittedRepoId);
  const budgetExceeded = Boolean(killedForBudget || killedForUsd);
  const ok = exitCode === 0 && !budgetExceeded && Boolean(liveUrl) && !identityViolation;
  const reason = identityViolation
    ? `SOURCE-IDENTITY VIOLATION: ${identityViolation} — treating any deploy from this run as invalid`
    : spawnErrorMsg
    ? `could not start the claude binary: ${spawnErrorMsg}`
    : killedForUsd
    ? `exceeded its $${budgetUsd} dollar budget before finishing (~$${Number(totalCostUsd || 0).toFixed(2)} spent; stopped by ${killedForUsd === 'native' ? 'Claude Code --max-budget-usd' : 'the streamed-usage backstop'})`
    : budgetExceeded
    ? `exceeded its ${budgetMin}-minute budget before finishing`
    : agentReported && agentReported.ok === false ? agentReported.reason
    : exitCode !== 0 ? `claude process exited ${exitCode}`
    : !liveUrl ? 'agent finished but no verified live URL was found in build.json'
    : 'unknown';
  return { ok, reason, identityViolation, budgetExceeded };
}

// ADR-0011 D4 / ADR-0012 D4: which axis held a below-bar delivery back, and the FORM each diagram took.
export function disclosureOf(ctx) {
  const pub = ctx?.publish || {};
  const publishDisclosure = { belowBar: pub.belowBar === true, graderUnavailable: pub.graderUnavailable === true, weakest: pub.weakest || null };
  const v = ctx?.visuals || {};
  const diagramForms = Object.fromEntries(['architectureDiagram', 'flowDiagram', 'bigIdeaDiagram', 'insightDiagram']
    .filter((k) => v[k]).map((k) => [k, { form: v[k].form ?? null, variant: v[k].formVariant ?? null }]));
  return { publishDisclosure, diagramForms };
}

// The graded record that travels in the status gist; null when nothing was graded.
export function scorecardOf(ctx, executorLane) {
  const q = ctx?.quality;
  if (!q || !Array.isArray(q.scorecard) || !q.scorecard.length) return null;
  const { publishDisclosure, diagramForms } = disclosureOf(ctx);
  return {
    passed: !!q.passed,
    exemplary: !!q.exemplary,
    belowBarDelivery: publishDisclosure,
    diagramForms,
    executor: executorLane, // which billing/endpoint lane built this: admin attributes grades and cost per lane
    iterations: Number.isInteger(q.iterations) ? q.iterations : null,
    gradedAt: q.gradedAt || null,
    devices: q.scorecard.map((c) => ({ device: c.deviceLabel || c.device || null, headline: c.headlineScore ?? null, gateA: c.gateA || null, gateB: c.gateB || null, operators: c.operatorQuestions || null })),
  };
}

// Pre-agent work (clone, probes, concept tournament) is part of the build's wall-clock budget, so the
// agent gets what is LEFT. Returns the milliseconds the agent may run, or 0 when too little remains.
export const MIN_AGENT_WALL_MS = 3 * 60_000;
export function agentWallMs({ budgetMin, startedAt, now = Date.now() }) {
  const left = budgetMin * 60_000 - Math.max(0, now - startedAt);
  return left >= MIN_AGENT_WALL_MS ? left : 0;
}

// The terminal status patch retries through GitHub's secondary rate limit with these waits (3.5 min).
export const STATUS_RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

// Worst-case minutes the runner can spend AFTER the agent's own budget: the cure cycle plus the
// terminal status retries. The dispatch timeout (landing build.js budgetMin + 25) must cover it.
export const postAgentWorstCaseMin = () =>
  (CURE.AGENT_WALL_MS + CURE.GRADE_WALL_MS + CURE.DEPLOY_WALL_MS + STATUS_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)) / 60_000;

// The exact spawn spec for the main agent and the cure agent, so what each child may see (env) and
// spend (budget flags) is one tested decision rather than wiring inside a top-level script.
const TOOL_ARGS = ['--allowed-tools', ...AGENT_ALLOWED_TOOLS, '--disallowed-tools', ...AGENT_DISALLOWED_TOOLS];
export function mainAgentSpawn({ claudeBin, prompt, executor, budgetUsd, procEnv, submittedRepoId, subscription = false, cwd }) {
  return {
    bin: claudeBin,
    argv: ['-p', prompt, '--permission-mode', 'bypassPermissions', '--bare', '--output-format', 'stream-json', '--verbose',
      '--model', executor.model, ...maxBudgetArgs(budgetUsd), ...TOOL_ARGS],
    opts: { cwd, env: buildAgentEnv(procEnv, { submittedRepoId, executor, subscription }), stdio: ['ignore', 'pipe', 'inherit'] },
  };
}
export function cureAgentSpawn({ claudeBin, prompt, executor, remainingUsd, procEnv, submittedRepoId, subscription = false, cwd }) {
  return {
    bin: claudeBin,
    argv: ['-p', prompt, '--permission-mode', 'bypassPermissions', '--bare', '--output-format', 'json', '--model', executor.model,
      ...maxBudgetArgs(remainingUsd), ...TOOL_ARGS],
    opts: { cwd, env: buildAgentEnv(procEnv, { submittedRepoId, executor, subscription }), encoding: 'utf8', timeout: CURE.AGENT_WALL_MS, maxBuffer: 32 * 1024 * 1024 },
  };
}

export function buildAgentPrompt({ repoUrl, buildDir, budgetMin, budgetUsd }) {
  const cap = MAX_QUALITY_ITERATIONS;
  return `Use the explainmyrepo skill (skills/explainmyrepo/SKILL.md is the brain — read it, follow it) to build a bespoke explainer for this repo:

TOKEN ECONOMY: skills/explainmyrepo/TOOLS-CONTRACT.md is the complete toolbox reference (every tool's own header docs: usage, flags, gotchas). Read THAT instead of tool source files — open a tool's source ONLY if the contract is genuinely ambiguous about something you need. Re-deriving tool interfaces from source has measured at ~25% of build spend; it is waste.

  ${repoUrl}

Build directory (already created, seeded with build.json): ${buildDir}
Station 0–1 (validate + clone) is ALREADY DONE by the harness: the repo is cloned, verified, and pinned at ${buildDir}/repo. Do NOT re-run clone-repo, and do NOT touch repo.url in build.json.

THE SOURCE-IDENTITY LAW (INV-21 — overrides every other instruction in this brief): the repo named above IS this build's identity. If its clone is missing, broken, or anything else makes it unusable, STOP and report ok:false with the specific reason. NEVER search for, substitute, fetch, or reconstruct a different repo or its README — an explainer of the wrong repo is fabrication, the one unforgivable output. There is no workaround for source identity.
Do NOT publish a separate GitHub repo for this build (skip that station — no write-scoped GitHub token is provisioned in this hosted context, by design).
Do NOT run the notify station (station 9) — sending the submitter's email is handled OUTSIDE your process; you have no SMTP credentials and should not need them. Your job ends once quality-grade + deploy are done and build.json's publish.liveUrl is set.
The refine loop is capped at ${cap} total quality-grade calls (1 initial + ${cap - 1} refines), ENFORCED by the tool itself: a further call returns the prior scorecard unchanged at zero cost. Do not try to work around it. At the cap, RUN DEPLOY AND YOU ARE DONE.
DELIVERY IS NOT CONDITIONAL ON THE SCORE (ADR-0011). deploy.mjs refuses only on INTEGRITY — a page that did not assemble, a source-identity violation, or a missing scorecard. It does NOT refuse on a low grade: a below-bar page ships to its live URL and the requester gets an honest note naming the weakest axis. So at the cap, DELIVER. Run deploy, confirm publish.liveUrl is set, report ok:true; do not try to force a deploy, there is nothing left to force past.
Because the score does not gate delivery, you have NOTHING to gain by making the page look better to the grader than it is. The scorecard is DISCLOSURE — it goes to the requester verbatim. Grade-chasing, flattering self-assessments, and cosmetic changes aimed at the rubric rather than the reader are waste and dishonest. Spend your remaining effort on what genuinely helps a stranger understand this repo, and let the number land where it honestly lands.

You have an approximate budget of ${budgetMin} minutes and $${budgetUsd}. Track your own elapsed time and cost as you work. This repo's actual size/complexity is unknown to me in advance — YOU are the one who discovers it by reading the repo, so budget your own effort accordingly: for a small repo, take your time and polish; for a large/deep monorepo, work faster and be willing to cap exhaustiveness (e.g. don't try to full-text-sweep every file in a 10,000-file repo — sample the important ones: READMEs, top-level docs, the most-referenced components) rather than trying to be exhaustive and running out of budget.

CRITICAL — never fail silently (this is INV-04 in the skill, restated because it is the single most important rule for this run): if a tool fails, or a repo's structure breaks an assumption (e.g. the dependency graph comes back empty, or the repo is unusually deep/large), do NOT just crash. STOP, THINK about why, and try a reasonable workaround — always WITHIN the pinned repo; the SOURCE-IDENTITY LAW above is never workaroundable — (e.g. hand-write a minimal-but-honest architecture note if the automated extractor genuinely cannot produce one for this repo's structure) before giving up. If you truly cannot produce a working page, say EXACTLY why in plain language as your final message — a specific, honest reason a human could act on, never a bare stack trace or a vague "something went wrong."

At the end, print your final status as the LAST line of your response in this exact form (nothing after it):
RESULT: {"ok": true, "liveUrl": "<url>"}   — on success
RESULT: {"ok": false, "reason": "<specific honest reason>"}   — on failure`;
}
