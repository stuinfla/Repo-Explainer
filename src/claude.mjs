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

export function resolveModel(env = {}, override) {
  return override || env.EXPLAINMYREPO_MODEL || env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

// Transient failures (network throw, timeout, HTTP 429/5xx) are retried with backoff; permanent
// ones (4xx auth/validation) are not. One unretried "fetch failed" killed a 13-minute hosted build
// at step 4/17 on 2026-07-03 — a single blip must never abort a run again.
const RETRY_DELAYS_MS = [2_000, 8_000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

export async function callClaude({
  apiKey, model = DEFAULT_MODEL, system, user,
  maxTokens = 4096, temperature = 0.7, timeoutMs = 120_000,
  retryDelaysMs = RETRY_DELAYS_MS,
}) {
  const brainMode = process.env.EXPLAINMYREPO_BRAIN || '';
  const useCli = brainMode === 'claude-cli' || (!apiKey && brainMode !== 'api' && claudeCliAvailable());
  if (!apiKey && !useCli) {
    throw new Error('no Anthropic API key and no Claude Code login — either set ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in .env, or install Claude Code and log in (the brain then runs on your Claude subscription, no API key needed)');
  }
  let lastErr;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      const delay = retryDelaysMs[attempt - 1];
      console.error(`[claude] ${lastErr.message} — retry ${attempt}/${retryDelaysMs.length} in ${delay / 1000}s`);
      await sleep(delay);
    }
    try {
      return useCli
        ? callClaudeCli({ model, system, user, timeoutMs })
        : await callClaudeOnce({ apiKey, model, system, user, maxTokens, temperature, timeoutMs });
    } catch (e) {
      if (!e.retryable) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
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
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature,
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
  const text = (j.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  if (!text.trim()) throw new Error(`Anthropic returned no text (stop_reason=${j.stop_reason || 'unknown'})`);
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
    text = await callClaude({ ...opts, system: jsonSystem, user: retryUser, temperature: 0.2 });
    return extractJSON(text);
  }
}
