// tests/review-p4b-preflight.test.mjs — the ONE local preflight: any one authoring credential is enough
// (Anthropic, OpenRouter alone, or a logged-in CLI), the key prompt is reachable on a terminal, and every
// other case stops with an actionable message. Env, TTY, prompt and .env writer are injected fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preflight, credentialProblems } from '../src/preflight.mjs';
import { stationsFor, selectStations } from '../src/stations.mjs';
import { resolveBrainLane } from '../src/claude.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'bin', 'explainmyrepo.mjs');
const ALL = stationsFor({});
// a lane fake: usable iff a key is configured (never probes this machine's real `claude` login)
const keyLane = ({ apiKey, env }) => ({ ok: Boolean(apiKey || env.OPENROUTER_API_KEY) });
const FULL = { OPENAI_API_KEY: 'sk-o', NETLIFY_AUTH_TOKEN: 'nf', GITHUB_TOKEN: 'gh' };
const fakes = (over = {}) => {
  const out = [];
  return { out, lane: keyLane, interactive: false, ask: async () => { throw new Error('ask must not be called'); }, save: () => { throw new Error('save must not be called'); }, print: (m) => out.push(String(m)), ...over };
};

test('an OpenRouter key ALONE satisfies the brain stations (sole-credential lane) — nothing is asked, nothing throws', async () => {
  const f = fakes();
  const r = await preflight(ALL, { ...FULL, OPENROUTER_API_KEY: 'sk-or' }, '/x', f);
  assert.deepEqual(r.problems.filter((p) => p.fatal), []);
  assert.ok(!f.out.some((l) => /MISSING/.test(l)));
});

test('the REAL lane predicate also accepts OpenRouter alone (issue #16 — no Anthropic key, brain pinned off the CLI)', async () => {
  const env = { ...FULL, OPENROUTER_API_KEY: 'sk-or' };
  const lane = (a) => resolveBrainLane({ ...a, env: { ...a.env, EXPLAINMYREPO_BRAIN: '' } });
  const probs = credentialProblems(ALL, env, { lane });
  assert.equal(probs.filter((p) => p.fatal).length, 0);
});

test('an Anthropic key alone is enough for the brain; a CLI-only login is enough too', () => {
  assert.equal(credentialProblems(ALL, { ...FULL, ANTHROPIC_API_KEY: 'sk-ant' }, { lane: keyLane }).filter((p) => p.fatal).length, 0);
  const cliLane = () => ({ ok: true, useCli: true });
  assert.equal(credentialProblems(ALL, { ...FULL }, { lane: cliLane }).filter((p) => p.fatal).length, 0);
});

test('with NOTHING configured and no terminal: stops, naming each credential and every way to supply the brain', async () => {
  const f = fakes();
  await assert.rejects(() => preflight(ALL, {}, '/x', f), (e) => {
    assert.match(e.message, /required credential\(s\) missing/);
    assert.match(e.message, /ANTHROPIC_API_KEY/);
    assert.match(e.message, /OPENROUTER_API_KEY/);
    assert.match(e.message, /Claude Code CLI/);
    assert.match(e.message, /OPENAI_API_KEY/);
    assert.match(e.message, /NETLIFY_AUTH_TOKEN/);
    assert.match(e.message, /No terminal to ask on/);
    return true;
  });
});

test('on a terminal with nothing configured the key prompt IS reached: asked once per missing key, saved to .env, never printed', async () => {
  const asked = []; const saved = [];
  const answers = { ANTHROPIC_API_KEY: 'sk-ant-SECRET-1', OPENAI_API_KEY: 'sk-openai-SECRET-2', NETLIFY_AUTH_TOKEN: 'nf-SECRET-3' };
  const f = fakes({
    interactive: true,
    ask: async (q) => { const k = Object.keys(answers).find((n) => q.includes(n)); asked.push(k); return answers[k]; },
    save: (file, k, v) => saved.push([file, k, v]),
  });
  const env = {};
  await preflight(ALL, env, '/proj', f);
  assert.deepEqual(asked, ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NETLIFY_AUTH_TOKEN']);
  assert.deepEqual(saved.map(([file, k]) => [file, k]), asked.map((k) => [path.join('/proj', '.env'), k]));
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-SECRET-1', 'the pasted key is live for this run');
  assert.ok(!f.out.join('\n').includes('SECRET'), 'a pasted secret is never printed');
});

test('on a terminal, pressing Enter on a required key still fails the run (no silent degrade)', async () => {
  const f = fakes({ interactive: true, ask: async () => '', save: () => {} });
  await assert.rejects(() => preflight(ALL, {}, '/x', f), /required credential\(s\) missing/);
});

test('a key already present is not asked for again; only the missing one is', async () => {
  const asked = [];
  const f = fakes({ interactive: true, ask: async (q) => { asked.push(q.trim()); return 'tok'; }, save: () => {} });
  await preflight(ALL, { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' }, '/x', f);
  assert.deepEqual(asked, ['NETLIFY_AUTH_TOKEN:']);
});

test('the check is slice-aware: --only concept needs the brain only; --no-deploy drops the Netlify demand', async () => {
  const one = selectStations(ALL, { only: 'concept' });
  assert.deepEqual(credentialProblems(one, { ANTHROPIC_API_KEY: 'a' }, { lane: keyLane }), []);
  const noDeploy = credentialProblems(stationsFor({ noDeploy: true }), { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GITHUB_TOKEN: 'g' }, { lane: keyLane });
  assert.deepEqual(noDeploy.filter((p) => p.fatal), []);
});

test('the concept tournament without direct Anthropic+OpenAI keys is a disclosed heads-up, not a refusal', async () => {
  const probs = credentialProblems(ALL, { ...FULL, OPENROUTER_API_KEY: 'sk-or' }, { lane: keyLane });
  const t = probs.find((p) => /tournament/.test(p.why));
  assert.ok(t && t.fatal === false, 'disclosed as non-fatal');
  assert.match(t.how, /single-shot|one model writes the concept/);
  const f = fakes();
  await preflight(ALL, { ...FULL, OPENROUTER_API_KEY: 'sk-or' }, '/x', f);   // does not throw
  assert.ok(f.out.some((l) => /heads-up/.test(l)));
});

// The old CLI-level check (bin/explainmyrepo.mjs) ran BEFORE this one, demanded OpenAI + Netlify for every
// slice and ignored OpenRouter, so an OpenRouter-only user was refused and the prompt above was unreachable.
test('CLI: an OpenRouter-only user running one brain station is not refused at the door', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'p4b-home-'));
  const out = path.join(home, 'build');
  const r = spawnSync(process.execPath, [BIN, 'owner/widget', '--only', 'concept', '--out', out],
    { encoding: 'utf8', cwd: home, env: { PATH: process.env.PATH, HOME: home, OPENROUTER_API_KEY: 'sk-or-test', EXPLAINER_NONINTERACTIVE: '1' } });
  assert.ok(!/Before this can run|MISSING/.test(r.stderr), r.stderr);
  assert.match(r.stderr, /needs an existing build/, 'got past credentials to the build-dir check');
});
