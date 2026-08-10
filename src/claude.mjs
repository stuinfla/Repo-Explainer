// src/claude.mjs — the BRAIN-CALL interface.
//
// CONTRACT §a slot-ownership table: `concept` and `content` (and the diagram ASCII / image briefs
// that seed Station 4) are filled by the BRAIN directly — "there is intentionally no tool for them."
// The e2e finding was that these slots are author-judgment, so the pipeline cannot run fully
// deterministically: the CLI itself must call Claude to author them between the deterministic
// stations. This module is that single, narrow seam to Claude.
//
// It talks to the Anthropic Messages API over plain `fetch` (Node 18+ global) — ZERO npm deps, so
// the package installs and `node --test` stays green without an SDK. The key comes from the merged
// env (ANTHROPIC_API_KEY, back-filled from CLAUDE_API_KEY by src/env.mjs); it is never logged.
//
// NO API KEY? THE BRAIN CAN RIDE CLAUDE CODE INSTEAD (2026-07-08, owner direction: "minimum
// requirements"): when no Anthropic key is present but the `claude` CLI is installed and logged in,
// brain calls are delegated to `claude -p --output-format json` — the same documented headless path
// the hosted runner uses — so the judgment steps run on the user's Claude Code subscription with no
// API key at all. Force with EXPLAINMYREPO_BRAIN=claude-cli, forbid with EXPLAINMYREPO_BRAIN=api.
// (Temperature is not controllable over the CLI; authoring tolerates the default.)
//
// Interface (stable):
//   callClaude({ apiKey, model?, system, user, maxTokens?, temperature?, timeoutMs? }) -> string
//   callClaudeJSON({ …same… }) -> parsed JSON  (asks for JSON-only, strips fences, retries once)

import { spawnSync } from 'node:child_process';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Verified live via GET /v1/models on 2026-07-12 (claude-sonnet-5 present, created 2026-06-29;
// the prior default claude-sonnet-4-6 — created 2026-02-17 — is now the STALE one, caught late:
// tonight's model-freshness sweep checked OpenAI's family and missed our own Anthropic default).
// Sonnet is the authoring default: strong judgment for concept/content at a sane cost. Override
// with --model or EXPLAINMYREPO_MODEL / ANTHROPIC_MODEL.
export const DEFAULT_MODEL = 'claude-sonnet-5';

// ── THE AUTHORING MODEL (2026-08-08) ────────────────────────────────────────────────────────────
// Measured, not assumed. A blind A/B on the REAL concept-authoring task (identical brief, labels
// stripped from the judge) scored, on art-direction merit:
//     z-ai/glm-5.2        95   $0.00125     <- champion
//     claude-sonnet-5     89   $0.01865
//     qwen/qwen-plus      54   $0.00033
//     deepseek-chat-v3.1  43   $0.00037
//     minimax/minimax-m2.5 31  $0.00135
// GLM 5.2 is 14.9x cheaper than Sonnet 5 AND scored higher, with the same million-token context.
//
// READ THE THIRD ROW BEFORE "OPTIMISING" THIS. qwen-plus is 34x cheaper, the fastest of the set,
// and passes every automated schema check the pipeline applies — and it scored 54, inventing a
// generic wax seal. minimax scored 31 and called a cryptographic provenance spec "a dish's final
// garnish". Both sail through every deterministic gate we have. Cost and schema-validity are NOT
// proxies for authoring quality here; the only thing that separated them was judging the output.
//
// HONEST LIMIT: n=1 per model, one repo, one judge. The 15x cost gap survives that; the 95-vs-89
// quality gap may not. Hence the automatic Anthropic fallback below rather than a hard switch.
export const AUTHORING_MODEL = 'z-ai/glm-5.2';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// An OpenRouter model id is namespaced ("z-ai/glm-5.2"); a first-party Anthropic id is not.
export const isOpenRouterModel = (m) => typeof m === 'string' && m.includes('/');

export function resolveModel(env = {}, override) {
  if (override) return override;
  if (env.EXPLAINMYREPO_MODEL) return env.EXPLAINMYREPO_MODEL;
  if (env.ANTHROPIC_MODEL) return env.ANTHROPIC_MODEL;
  // Prefer the measured champion when an OpenRouter key exists; otherwise the Anthropic default.
  // Set EXPLAINMYREPO_AUTHORING=anthropic to pin the old behaviour without removing the key.
  if (env.OPENROUTER_API_KEY && env.EXPLAINMYREPO_AUTHORING !== 'anthropic') return AUTHORING_MODEL;
  return DEFAULT_MODEL;
}

// Transient failures (network throw, timeout, HTTP 429/5xx) are retried with backoff; permanent
// ones (4xx auth/validation) are not. One unretried "fetch failed" killed a 13-minute hosted build
// at step 4/17 on 2026-07-03 — a single blip must never abort a run again.
const RETRY_DELAYS_MS = [2_000, 8_000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── COST LEDGER (2026-08-09) ────────────────────────────────────────────────────────────────────
// The hosted runner tracks totalCostUsd in nine places and writes it to a gist receipt. The LOCAL
// path tracked nothing at all — build.json came out with no cost field, so "what does a build cost?"
// was unanswerable except by estimating, and estimates are how I got it wrong twice. OpenRouter
// returns a real `usage.cost` on every response, so the brain half can be measured exactly rather
// than derived from a price list.
const _spend = { usd: 0, calls: 0, byModel: {} };
function recordSpend(model, usd, tokens) {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) usd = 0;
  _spend.usd += usd;
  _spend.calls += 1;
  const m = (_spend.byModel[model] ||= { usd: 0, calls: 0, inTokens: 0, outTokens: 0 });
  m.usd += usd; m.calls += 1;
  m.inTokens += tokens?.in || 0; m.outTokens += tokens?.out || 0;
}
export function getBrainSpend() {
  return { usd: Math.round(_spend.usd * 1e6) / 1e6, calls: _spend.calls, byModel: _spend.byModel };
}

// Is a logged-in Claude Code CLI available to carry the brain? Cached for the process lifetime.
let _cliAvailable = null;
export function claudeCliAvailable() {
  if (_cliAvailable !== null) return _cliAvailable;
  try {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10_000 });
    _cliAvailable = r.status === 0;
  } catch { _cliAvailable = false; }
  return _cliAvailable;
}

function callClaudeCli({ model, system, user, timeoutMs }) {
  const args = ['-p', user, '--output-format', 'json', '--model', model];
  if (system) args.push('--system-prompt', system);
  // The CLI brain is slower than the raw API: each call pays Claude Code session startup and
  // cannot cap output tokens. First E2E (p-limit, 2026-07-08) had the content station time out
  // at the API-calibrated 120s three times in a row — triple the budget with a 6-min floor.
  const cliTimeoutMs = Math.max(timeoutMs * 3, 360_000);
  const r = spawnSync('claude', args, {
    encoding: 'utf8', timeout: cliTimeoutMs, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'explainmyrepo' },
  });
  if (r.error && (r.error.code === 'ETIMEDOUT' || r.signal === 'SIGTERM')) {
    const err = new Error(`claude CLI timed out after ${cliTimeoutMs}ms`);
    err.retryable = true;
    throw err;
  }
  if (r.status !== 0) throw new Error(`claude CLI exited ${r.status ?? 'null'}: ${(r.stderr || '').trim().slice(-300)}`);
  let j;
  try { j = JSON.parse(r.stdout); } catch { throw new Error(`claude CLI returned non-JSON output: ${(r.stdout || '').slice(0, 200)}`); }
  if (j.is_error) throw new Error(`claude CLI error: ${String(j.result || '').slice(0, 300)}`);
  const text = String(j.result || '');
  if (!text.trim()) throw new Error('claude CLI returned no text');
  return text;
}

/**
 * THE SINGLE SOURCE OF TRUTH for "can the brain stations run?" (issue #16, 2026-08-08).
 *
 * There are two credential lanes: an Anthropic API key, or a logged-in Claude Code CLI running on
 * the user's subscription. `callClaude` has always honoured both — but `orchestrator.mjs`'s
 * preflight independently re-implemented only the FIRST, so a subscription user with no API key was
 * refused before a single station ran, with `ANTHROPIC_API_KEY MISSING`, even though the very next
 * layer would have happily used their CLI. Reported by ciprianmelian against a `--no-deploy` run.
 *
 * The bug was not the missing CLI branch as such — it was that the same decision lived in two
 * places, so one could be taught something the other never learned. Both callers now ask HERE.
 */
export function resolveBrainLane({ apiKey, env = process.env } = {}) {
  const brainMode = env.EXPLAINMYREPO_BRAIN || '';
  const useCli = brainMode === 'claude-cli' || (!apiKey && brainMode !== 'api' && claudeCliAvailable());
  // THREE lanes now, not two. Since 2026-08-08 the default authoring model is an OpenRouter one
  // (z-ai/glm-5.2 — measured champion), so an OPENROUTER_API_KEY alone is a COMPLETE credential set
  // for the brain stations. Omitting it here would have re-created issue #16 in a new costume:
  // a user with the newly-recommended key, refused at the door by a gate that had not been told.
  const useOpenRouter = Boolean(env.OPENROUTER_API_KEY) && brainMode !== 'api' && brainMode !== 'claude-cli';
  return { useCli, useOpenRouter, brainMode, ok: Boolean(apiKey) || useCli || useOpenRouter };
}

export async function callClaude({
  apiKey, model = DEFAULT_MODEL, system, user,
  maxTokens = 4096, temperature = null, timeoutMs = 120_000,
  retryDelaysMs = RETRY_DELAYS_MS, env: envOverride = null,
}) {
  // ISSUE #16's SHAPE, THIRD OCCURRENCE (found by GPT-5.6-Sol, 2026-08-10). This destructured only
  // `useCli` and ignored `useOpenRouter`, so an OpenRouter-only user — no Anthropic key, no CLI —
  // sailed through preflight (which asks the shared predicate) and was rejected HERE on the first
  // brain call. It went unnoticed locally only because this machine happens to have the claude CLI
  // installed, making useCli true; a CI box with just OPENROUTER_API_KEY would have died. Ask the
  // predicate for ALL of its answer, not the one field you happen to remember.
  const { useCli, useOpenRouter } = resolveBrainLane({ apiKey, env: { ...process.env, ...(envOverride || {}) } });
  if (!apiKey && !useCli && !useOpenRouter) {
    throw new Error('no brain credentials — set OPENROUTER_API_KEY (recommended: authoring runs on z-ai/glm-5.2), or ANTHROPIC_API_KEY / CLAUDE_API_KEY, or install Claude Code and log in (the brain then runs on your Claude subscription with no API key at all).');
  }
  let lastErr;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      const delay = retryDelaysMs[attempt - 1];
      console.error(`[claude] ${lastErr.message} — retry ${attempt}/${retryDelaysMs.length} in ${delay / 1000}s`);
      await sleep(delay);
    }
    try {
      // An EXPLICIT lane choice outranks the model id. Previously the OpenRouter branch ran first, so
      // EXPLAINMYREPO_BRAIN=claude-cli was silently ignored whenever the model happened to be namespaced.
      if (isOpenRouterModel(model) && !(useCli && resolveBrainLane({ apiKey }).brainMode === 'claude-cli')) {
        // src/env.mjs loadEnv() explicitly "Returns a NEW object (does not mutate process.env)", so a
        // key living only in .env reached preflight through the merged object and then VANISHED here.
        // Accept an explicit override from the caller before falling back to the ambient env.
        const orKey = (envOverride && envOverride.OPENROUTER_API_KEY) || process.env.OPENROUTER_API_KEY;
        if (!orKey) throw Object.assign(new Error(`model "${model}" is an OpenRouter id but OPENROUTER_API_KEY is not set`), { retryable: false });
        return await callOpenRouterOnce({ key: orKey, model, system, user, maxTokens, timeoutMs });
      }
      return useCli
        ? callClaudeCli({ model, system, user, timeoutMs })
        : await callClaudeOnce({ apiKey, model, system, user, maxTokens, temperature, timeoutMs });
    } catch (e) {
      if (!e.retryable) throw e;
      lastErr = e;
    }
  }
  // FALLBACK, not a silent swap. The authoring champion is chosen on n=1 evidence, so an OpenRouter
  // outage or a model retirement must never take the build down when a first-party lane is sitting
  // right there. Announce it loudly — a quiet fallback would hide exactly the drift we want to see.
  if (isOpenRouterModel(model) && (apiKey || claudeCliAvailable())) {
    console.error(`[claude] ${model} failed after ${retryDelaysMs.length} retries (${lastErr?.message?.slice(0, 120)}) — FALLING BACK to ${DEFAULT_MODEL}`);
    return callClaude({ apiKey, model: DEFAULT_MODEL, system, user, maxTokens, temperature, timeoutMs, retryDelaysMs: [] });
  }
  throw lastErr;
}

async function callOpenRouterOnce({ key, model, system, user, maxTokens, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        // OpenRouter attributes traffic by these; harmless if absent, useful in their dashboard.
        'HTTP-Referer': 'https://explainmyrepo.isovision.ai',
        'X-Title': 'explainmyrepo',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(e.name === 'AbortError' ? `OpenRouter request timed out after ${timeoutMs}ms` : `OpenRouter request failed: ${e.message}`);
    err.retryable = true;
    throw err;
  }
  clearTimeout(timer);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const err = new Error(`OpenRouter ${resp.status} (${model}): ${body.slice(0, 300)}`);
    err.retryable = resp.status === 429 || resp.status >= 500;
    throw err;
  }
  const j = await resp.json();
  if (j.error) { const err = new Error(`OpenRouter error (${model}): ${String(j.error.message).slice(0, 300)}`); err.retryable = false; throw err; }
  // OpenRouter reports the ACTUAL charge per call — no price-list arithmetic, no drift when they
  // reprice. This is the measurement that makes a local build's cost a fact instead of an estimate.
  recordSpend(model, j.usage?.cost, { in: j.usage?.prompt_tokens, out: j.usage?.completion_tokens });
  const choice = j.choices?.[0];
  const text = String(choice?.message?.content || '');
  if (!text.trim()) {
    const err = new Error(choice?.finish_reason === 'length'
      ? `OpenRouter hit max_tokens (${maxTokens}) before emitting text (${model}) — raise maxTokens for this station.`
      : `OpenRouter returned no text (${model}, finish_reason=${choice?.finish_reason || 'unknown'})`);
    err.retryable = false;
    throw err;
  }
  return text;
}

async function callClaudeOnce({ apiKey, model, system, user, maxTokens, temperature, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      // TEMPERATURE IS DEPRECATED ON CURRENT MODELS (issue #17.1, pacphi — verified live
      // 2026-08-08 against api.anthropic.com: `claude-sonnet-5` + temperature -> HTTP 400
      // "`temperature` is deprecated for this model"; the identical request without it -> HTTP 200).
      // Because every brain station goes through here, sending it killed EVERY local build at the
      // first Claude-calling station. The hosted lane survived only because it shells out to the
      // `claude` CLI instead of this client, which is why 42 hosted builds passed while the npm
      // package was dead on arrival. Send it ONLY if a caller explicitly opts in for an older model.
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        ...(temperature == null ? {} : { temperature }),
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(e.name === 'AbortError' ? `Anthropic request timed out after ${timeoutMs}ms` : `Anthropic request failed: ${e.message}`);
    err.retryable = true;
    throw err;
  }
  clearTimeout(timer);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const err = new Error(`Anthropic API ${resp.status} (${model}): ${body.slice(0, 400)}`);
    err.retryable = resp.status === 429 || resp.status >= 500;
    throw err;
  }
  const j = await resp.json();
  // Anthropic does not return a charge, so this lane is DERIVED from published per-token rates and
  // is marked as such in the receipt. Only the OpenRouter lane is a measured figure.
  const RATES = { 'claude-sonnet-5': [2, 10], 'claude-opus-5': [5, 25], 'claude-haiku-4.5': [1, 5] };
  const [rin, rout] = RATES[model] || [0, 0];
  recordSpend(model, ((j.usage?.input_tokens || 0) * rin + (j.usage?.output_tokens || 0) * rout) / 1e6,
    { in: j.usage?.input_tokens, out: j.usage?.output_tokens });
  const text = (j.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  // Issue #17.2 (pacphi): current models emit an invisible `thinking` block BEFORE the text, and it
  // spends the same max_tokens budget — verified live 2026-08-08: `claude-sonnet-5` returns
  // content blocks ["thinking","text"]. So a budget sized for the answer alone can be consumed by
  // reasoning, yielding stop_reason=max_tokens with little or no visible text. The extraction below
  // was already correct (it filters for type==='text'); what was missing was a diagnosable failure
  // — the old message said only "returned no text", which reads like a model fault rather than a
  // budget one, and sent the reporter looking in the wrong place.
  if (!text.trim()) {
    const kinds = (j.content || []).map((b) => b && b.type).filter(Boolean);
    const err = new Error(j.stop_reason === 'max_tokens'
      ? `Anthropic hit max_tokens (${maxTokens}) before emitting any text — the model spent the budget on its `
        + `internal reasoning block${kinds.length ? ` (blocks: ${kinds.join(', ')})` : ''}. Raise maxTokens for this station.`
      : `Anthropic returned no text (stop_reason=${j.stop_reason || 'unknown'}, blocks: ${kinds.join(', ') || 'none'})`);
    err.retryable = false;
    throw err;
  }
  if (j.stop_reason === 'max_tokens') {
    process.stderr.write(`[claude] WARNING: response TRUNCATED at max_tokens=${maxTokens} — downstream JSON parsing may fail. `
      + `A thinking block shares this budget (#17.2).\n`);
  }
  return text;
}

// Strip ```fences``` then parse. If the model wrapped JSON in prose, slice from the first bracket to
// its matching last bracket and parse that.
function extractJSON(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(t); } catch { /* fall through to bracket slice */ }
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  let start = -1, open = '{', close = '}';
  if (firstObj === -1 && firstArr === -1) throw new Error('no JSON found in model reply');
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) { start = firstArr; open = '['; close = ']'; }
  else start = firstObj;
  const end = t.lastIndexOf(close);
  if (end <= start) throw new Error('unbalanced JSON in model reply');
  return JSON.parse(t.slice(start, end + 1));
}

export async function callClaudeJSON(opts) {
  const jsonSystem = `${opts.system || ''}\n\nOUTPUT FORMAT: respond with ONE valid JSON value and NOTHING else — no markdown fences, no commentary, no leading or trailing prose.`;
  let text = await callClaude({ ...opts, system: jsonSystem });
  try {
    return extractJSON(text);
  } catch (firstErr) {
    // One stricter retry — most JSON failures are a stray sentence the model can drop on request.
    const retryUser = `${opts.user}\n\n(Your previous reply was not parseable as JSON: ${firstErr.message}. Reply again with ONLY the JSON value.)`;
    text = await callClaude({ ...opts, system: jsonSystem, user: retryUser });
    return extractJSON(text);
  }
}
