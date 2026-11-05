// bin/runner-preflight.mjs — the hosted runner's live credential and embedding probes.
// Pure of process state: env, .env text and fetch are injected, so tests drive every branch.

// Every source that HAS a value, in priority order (process env first, then repo .env), deduped by
// value: the probe walks the list and the first LIVE key wins, so a dead key in process env cannot
// shadow a proven-live .env key.
export function credCandidates(names, { env = process.env, dotenvText = '' } = {}) {
  const out = [];
  for (const n of names) if (env[n]) out.push({ val: env[n], src: `process env ${n}` });
  for (const n of names) {
    const m = dotenvText.match(new RegExp(`^${n}=("?)(.*?)\\1\\s*$`, 'm'));
    if (m?.[2] && !out.some((c) => c.val === m[2])) out.push({ val: m[2], src: `.env ${n}` });
  }
  return out;
}

export async function probeCred(label, candidates, url, headers, fetchFn = fetch) {
  if (!candidates.length) return { label, ok: false, why: 'not set anywhere (process env or repo .env)' };
  const dead = [];
  for (const cred of candidates) {
    try {
      const r = await fetchFn(url, { headers: headers(cred.val), signal: AbortSignal.timeout(5000) });
      if (r.ok) return { label, ok: true, val: cred.val, why: dead.length ? `OK via ${cred.src} — self-healed past: ${dead.join('; ')}` : `OK via ${cred.src}` };
      dead.push(`${cred.src} HTTP ${r.status}`);
    } catch (e) { dead.push(`${cred.src} unreachable (${e.message})`); }
  }
  return { label, ok: false, why: `every source dead: ${dead.join('; ')}` };
}

// Failover is for CAPACITY only: a merely-dead or invalid key is a config bug the operator must see.
export function shouldFailOver(anthropicProbe) {
  return anthropicProbe.ok === false && anthropicProbe.usageLimited === true;
}

// Authentication is not capacity: /v1/models spends nothing, so a 1-token completion on the agent's
// own model proves the key can SPEND, and classifies a usage-limit 400 distinctly.
async function spendProbe(a, model, fetchFn, log) {
  try {
    const r = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': a.val, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) return;
    const body = await r.text().catch(() => '');
    a.ok = false;
    if (/usage limits|regain access/i.test(body)) {
      a.usageLimited = true;
      a.why = `key authenticates but has hit its API usage limit (spend-probe HTTP ${r.status}): ${body.slice(0, 300)}`;
    } else {
      a.why = `key authenticates but a real 1-token completion on ${model} failed (HTTP ${r.status}): ${body.slice(0, 300)}`;
    }
  } catch (e) { log(`credential preflight: spend-probe inconclusive (${e.message}) — proceeding on the auth probe`); }
}

// Same executor model through OpenRouter's Anthropic-compatible endpoint, engaged only on a
// PROVEN-live 1-token completion. Returns the executor descriptor or null.
async function tryOpenRouterLane({ env, dotenvText, fetchFn, log }) {
  const cands = credCandidates(['OPENROUTER_API_KEY'], { env, dotenvText });
  const orModel = env.OPENROUTER_ANTHROPIC_MODEL || 'anthropic/claude-sonnet-5.5';
  for (const cand of cands) {
    try {
      const r = await fetchFn('https://openrouter.ai/api/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': cand.val, Authorization: `Bearer ${cand.val}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: orModel, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) return { executor: { lane: 'openrouter', model: orModel, baseUrl: 'https://openrouter.ai/api', key: cand.val }, src: cand.src };
      const body = await r.text().catch(() => '');
      log(`failover probe: OpenRouter Skin refused (${cand.src}, HTTP ${r.status}): ${body.slice(0, 200)}`);
    } catch (e) { log(`failover probe: ${cand.src} unreachable (${e.message})`); }
  }
  log(cands.length ? 'failover: no live OpenRouter lane — the honest usage-limit refusal stands' : 'failover: no OPENROUTER_API_KEY configured — the honest usage-limit refusal stands');
  return null;
}

// Probes the three keys a hosted run needs (agent reasoning, deploy, vision grading). Returns
// { a, n, o, executor }; the caller applies the proven-live values to process.env.
export async function probeCredentials({ model, env = process.env, dotenvText = '', fetchFn = fetch, log = () => {} }) {
  const cands = (...names) => credCandidates(names, { env, dotenvText });
  const bearer = (v) => ({ Authorization: `Bearer ${v}` });
  const [a, n, o] = await Promise.all([
    probeCred('ANTHROPIC_API_KEY (agent reasoning)', cands('ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'), 'https://api.anthropic.com/v1/models', (v) => ({ 'x-api-key': v, 'anthropic-version': '2023-06-01' }), fetchFn),
    probeCred('NETLIFY_AUTH_TOKEN (deploy)', cands('NETLIFY_AUTH_TOKEN'), 'https://api.netlify.com/api/v1/user', bearer, fetchFn),
    probeCred('OPENAI_API_KEY (images + vision grading)', cands('OPENAI_API_KEY', 'OPEN_AI_KEY'), 'https://api.openai.com/v1/models', bearer, fetchFn),
  ]);
  if (a.ok) await spendProbe(a, model, fetchFn, log);
  let executor = { lane: 'anthropic', model, baseUrl: null, key: null };
  if (shouldFailOver(a)) {
    const lane = await tryOpenRouterLane({ env, dotenvText, fetchFn, log });
    if (lane) {
      executor = lane.executor;
      a.ok = true;
      a.why = `primary key usage-limited — FAILOVER ENGAGED: same executor model via OpenRouter's Anthropic Skin (${lane.executor.model}, ${lane.src}), billed to OpenRouter credits`;
    }
  }
  return { a, n, o, executor };
}

// KB build hard-requires a real embedding model (grounding is never fabricated). The workflow's
// kb/warm-model-cache.mjs step seeds the cache BEFORE this runs (release asset, sha256-pinned, then HF);
// if the cache is still cold here, the only source the KB build itself uses is huggingface.co, so that
// is the only thing worth probing.
export async function probeEmbedding({ cachedModelExists, fetchFn = fetch }) {
  if (cachedModelExists) return { ok: true, why: 'model cached locally — KB build needs no network' };
  try {
    const r = await fetchFn('https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main/config.json', { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) });
    return r.ok
      ? { ok: true, why: `no local cache; huggingface.co reachable (HTTP ${r.status}) — the KB build will download the model from there` }
      : { ok: false, why: `no local model cache and huggingface.co answered HTTP ${r.status}` };
  } catch (e) { return { ok: false, why: `no local model cache and huggingface.co unreachable (${e.message})` }; }
}
