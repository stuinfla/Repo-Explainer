// src/claude.mjs — the single seam to the brain: author-judgment slots (concept, content, visual brief)
// are filled by Claude between the deterministic stations. Plain `fetch`, zero npm deps; the key comes
// from the merged env (ANTHROPIC_API_KEY, back-filled from CLAUDE_API_KEY by src/env.mjs) and is never logged.
//
// Three credential lanes, one predicate (resolveBrainLane): an Anthropic key, an OpenRouter key, or a
// logged-in `claude` CLI (`claude -p --output-format json`, no key needed). Force the CLI with
// EXPLAINMYREPO_BRAIN=claude-cli, forbid it with EXPLAINMYREPO_BRAIN=api (api forbids ONLY the CLI: an Anthropic or OpenRouter key still serves). Temperature is not
// controllable over the CLI.
//
// Interface (stable):
//   callClaude({ apiKey, model?, system, user, maxTokens?, temperature?, timeoutMs? }) -> string
//   callClaudeJSON({ …same… }) -> parsed JSON  (asks for JSON-only, strips fences, retries once)

import { spawnSync } from 'node:child_process';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Default authoring model; override with --model / EXPLAINMYREPO_MODEL / ANTHROPIC_MODEL.
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

// OpenRouter lane model: used only when it is the sole credential or EXPLAINMYREPO_AUTHORING=openrouter
// (blind A/B data lives in git history; glm-5.3 ties sonnet-5-5 on quality, so it is never the default).
export const AUTHORING_MODEL = 'z-ai/glm-5.3';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// An OpenRouter model id is namespaced ("z-ai/glm-5.3"); a first-party Anthropic id is not.
export const isOpenRouterModel = (m) => typeof m === 'string' && m.includes('/');

export function resolveModel(env = {}, override) {
  if (override) return override;
  if (env.EXPLAINMYREPO_MODEL) return env.EXPLAINMYREPO_MODEL;
  if (env.ANTHROPIC_MODEL) return env.ANTHROPIC_MODEL;
  // A direct Anthropic key always wins; OpenRouter only when it is the sole credential or opted into.
  const hasAnthropicKey = Boolean(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY);
  const a = env.EXPLAINMYREPO_AUTHORING;
  if (env.OPENROUTER_API_KEY && a !== 'anthropic' && (a === 'openrouter' || !hasAnthropicKey)) return AUTHORING_MODEL;
  return DEFAULT_MODEL;
}

// Transient failures (network throw, timeout, HTTP 429/5xx) are retried with backoff; permanent 4xx are not.
const RETRY_DELAYS_MS = [2_000, 8_000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Cost ledger: OpenRouter reports the real charge per call; the Anthropic lane is DERIVED from the rate
// table below and an unknown model is UNPRICED, never $0.
// USD per million tokens [input, output]. List prices as reported by third-party sources, not read from a
// bill (haiku-5-5, opus-5, fable-5-1 unverified). The one table: bin/cure.mjs prices its stream from it too.
export const MODEL_RATES = {
  'claude-sonnet-5-5': [2, 10], 'claude-sonnet-5': [2, 10],
  'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25],
  'claude-fable-5-1': [10, 50], 'claude-haiku-5-5': [0.1, 0.5],
};
const CACHE_WRITE_X = 1.25, CACHE_READ_X = 0.1;   // standard Anthropic prompt-caching multipliers on the input rate

/** USD for a usage record, or null when the model has no known rate (UNPRICED: never report $0). */
export function priceUsd(model, { in: inTok = 0, out: outTok = 0, cacheWrite = 0, cacheRead = 0 } = {}) {
  const rate = MODEL_RATES[model];
  if (!rate) return null;
  const [rin, rout] = rate;
  return (inTok * rin + cacheWrite * rin * CACHE_WRITE_X + cacheRead * rin * CACHE_READ_X + outTok * rout) / 1e6;
}

const _spend = { usd: 0, calls: 0, byModel: {}, unpriced: new Set() };
function recordSpend(model, usd, tokens) {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) { _spend.unpriced.add(model); usd = 0; }
  _spend.usd += usd;
  _spend.calls += 1;
  const m = (_spend.byModel[model] ||= { usd: 0, calls: 0, inTokens: 0, outTokens: 0 });
  m.usd += usd; m.calls += 1;
  m.inTokens += tokens?.in || 0; m.outTokens += tokens?.out || 0;
}
export function getBrainSpend() {
  return { usd: Math.round(_spend.usd * 1e6) / 1e6, calls: _spend.calls, byModel: _spend.byModel, unpriced: [..._spend.unpriced] };
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
  // The CLI pays session startup per call and cannot cap output tokens: triple the API budget, 6-min floor.
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

/** The single predicate for "can the brain stations run?" — preflight and callClaude both ask HERE (issue #16). */
export function resolveBrainLane({ apiKey, env = process.env } = {}) {
  const brainMode = env.EXPLAINMYREPO_BRAIN || '';
  const useCli = brainMode === 'claude-cli' || (!apiKey && brainMode !== 'api' && claudeCliAvailable());
  // An OPENROUTER_API_KEY alone is a complete credential set for the brain stations.
  const useOpenRouter = Boolean(env.OPENROUTER_API_KEY) && brainMode !== 'claude-cli';
  return { useCli, useOpenRouter, brainMode, ok: Boolean(apiKey) || useCli || useOpenRouter };
}

export async function callClaude({
  apiKey, model = DEFAULT_MODEL, system, user,
  maxTokens = 4096, temperature = null, timeoutMs = 120_000,
  retryDelaysMs = RETRY_DELAYS_MS, env: envOverride = null,
}) {
  const { useCli, useOpenRouter, brainMode } = resolveBrainLane({ apiKey, env: { ...process.env, ...(envOverride || {}) } });
  if (!apiKey && !useCli && !useOpenRouter) {
    throw new Error('no brain credentials — set ANTHROPIC_API_KEY (recommended; CLAUDE_API_KEY also works), or OPENROUTER_API_KEY, or install Claude Code and log in (the brain then runs on your Claude subscription with no API key at all).');
  }
  let lastErr;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      const delay = retryDelaysMs[attempt - 1];
      console.error(`[claude] ${lastErr.message} — retry ${attempt}/${retryDelaysMs.length} in ${delay / 1000}s`);
      await sleep(delay);
    }
    try {
      // An explicit EXPLAINMYREPO_BRAIN=claude-cli outranks a namespaced model id.
      if (isOpenRouterModel(model) && brainMode !== 'claude-cli') {
        // loadEnv() returns a NEW object (never mutates process.env): honour the caller's env first.
        const orKey = (envOverride && envOverride.OPENROUTER_API_KEY) || process.env.OPENROUTER_API_KEY;
        if (!orKey) throw Object.assign(new Error(`model "${model}" is an OpenRouter id but OPENROUTER_API_KEY is not set`), { retryable: false });
        return await callOpenRouterOnce({ key: orKey, model, system, user, maxTokens, timeoutMs });
      }
      return useCli
        ? callClaudeCli({ model, system, user, timeoutMs })
        : await callClaudeOnce({ apiKey, model, system, user, maxTokens, temperature, timeoutMs });
    } catch (e) {
      lastErr = e;
      if (e.fallback) break;        // lane unusable: skip pointless retries, go straight to the fallback below
      if (!e.retryable) throw e;
    }
  }
  // Announced fallback to a first-party lane when OpenRouter fails. With no key and brain=api there is no
  // such lane, so the original error stands (a keyless Anthropic call would only add a misleading 401).
  if (isOpenRouterModel(model) && (apiKey || (brainMode !== 'api' && claudeCliAvailable()))) {
    console.error(`[claude] ${model} failed after ${retryDelaysMs.length} retries (${lastErr?.message?.slice(0, 120)}) — FALLING BACK to ${DEFAULT_MODEL}`);
    return callClaude({ apiKey, model: DEFAULT_MODEL, system, user, maxTokens, temperature, timeoutMs, retryDelaysMs: [], env: envOverride });
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
    // 401/402/403/404: this lane cannot serve us however often we ask — let the fallback lane take over.
    err.fallback = [401, 402, 403, 404].includes(resp.status);
    throw err;
  }
  const j = await resp.json();
  if (j.error) { const err = new Error(`OpenRouter error (${model}): ${String(j.error.message).slice(0, 300)}`); err.retryable = false; throw err; }
  // OpenRouter reports the ACTUAL charge per call.
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
      // temperature is HTTP 400 on current models (#17.1): send it only when a caller opts in.
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
  // Anthropic returns no charge: derived from MODEL_RATES; an unknown model is recorded as UNPRICED.
  recordSpend(model, priceUsd(model, { in: j.usage?.input_tokens, out: j.usage?.output_tokens }),
    { in: j.usage?.input_tokens, out: j.usage?.output_tokens });
  const text = (j.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  // A thinking block shares max_tokens (#17.2): an empty reply with stop_reason=max_tokens is a budget fault.
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
