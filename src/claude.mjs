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
// Interface (stable):
//   callClaude({ apiKey, model?, system, user, maxTokens?, temperature?, timeoutMs? }) -> string
//   callClaudeJSON({ …same… }) -> parsed JSON  (asks for JSON-only, strips fences, retries once)

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Verified live via GET /v1/models on 2026-06-29 (claude-sonnet-4-6 present). Sonnet is the
// authoring default: strong judgment for concept/content at a sane cost. Override with --model or
// EXPLAINMYREPO_MODEL / ANTHROPIC_MODEL.
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

export function resolveModel(env = {}, override) {
  return override || env.EXPLAINMYREPO_MODEL || env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

export async function callClaude({
  apiKey, model = DEFAULT_MODEL, system, user,
  maxTokens = 4096, temperature = 0.7, timeoutMs = 120_000,
}) {
  if (!apiKey) {
    throw new Error('no Anthropic API key — set ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in .env');
  }
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
    throw new Error(e.name === 'AbortError' ? `Anthropic request timed out after ${timeoutMs}ms` : `Anthropic request failed: ${e.message}`);
  }
  clearTimeout(timer);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Anthropic API ${resp.status} (${model}): ${body.slice(0, 400)}`);
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
