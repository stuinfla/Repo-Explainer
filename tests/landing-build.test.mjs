// The hosted front door (landing/netlify/functions/build.js): a repo URL is validated BEFORE anything is
// spent, and the same shape rule is enforced again by the workflow that actually runs the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { handler, isSafeSegment } = require('../landing/netlify/functions/build.js');

async function post(body, fetchImpl, env = {}) {
  const realFetch = globalThis.fetch;
  const saved = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  Object.assign(process.env, { EXPLAINER_GH_TOKEN: 't', ...env });
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return fetchImpl(String(url), init); };
  try {
    const res = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
    return { status: res.statusCode, body: JSON.parse(res.body), calls };
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const resp = (status, obj) => ({ status, ok: status >= 200 && status < 300, json: async () => obj, text: async () => JSON.stringify(obj) });

test('a dot-segment owner/name is rejected before GitHub is ever called (repos/../users bypassed the private check)', async () => {
  for (const url of ['../users', 'https://github.com/../users', 'owner/..', 'owner/.', '.hidden/repo', 'owner/.github', 'https://github.com/owner/..']) {
    const r = await post({ url }, async () => { throw new Error('GitHub must not be called'); });
    assert.equal(r.status, 400, url);
    assert.deepEqual(r.calls, [], `${url}: no outbound call`);
  }
});

test('ordinary and dotted names still get through to the existence check', async () => {
  for (const [url, full] of [['vercel/next.js', 'vercel/next.js'], ['https://github.com/stuinfla/Repo-Explainer.git', 'stuinfla/Repo-Explainer'], ['a_b/c-d', 'a_b/c-d']]) {
    const r = await post({ url }, async () => resp(404, {}));
    assert.equal(r.status, 404, url);
    assert.deepEqual(r.calls, [`https://api.github.com/repos/${full}`], url);
  }
  assert.equal(isSafeSegment('..'), false);
  assert.equal(isSafeSegment('next.js'), true);
});

test('the over-quota messages point at a command the CLI really has', async () => {
  const gist = (obj) => resp(200, { files: { 'ledger.json': { content: JSON.stringify(obj) } } });
  const r = await post({ url: 'o/n', email: 'a@b.co' }, async (u) => (u.includes('/gists/') ? gist({ 'a@b.co': { count: 99 } }) : resp(200, { private: false, size: 1 })), { EMAIL_LEDGER_GIST_ID: 'L' });
  assert.equal(r.status, 402);
  assert.match(r.body.error, /npx explainmyrepo <github-url>(?![\w-])/);
  assert.doesNotMatch(r.body.error, /--ship-best-effort/);
});

test('every flag the landing page tells users to type is documented by the CLI --help', () => {
  const html = fs.readFileSync(path.join(ROOT, 'landing', 'index.html'), 'utf8');
  const cmds = [...html.matchAll(/data-copy="(npx explainmyrepo[^"]*)"/g)].map((m) => m[1]);
  assert.ok(cmds.length > 0, 'the landing page has a copyable npx command');
  const help = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'explainmyrepo.mjs'), '--help'], { encoding: 'utf8' });
  const text = help.stdout + help.stderr;
  assert.match(text, /--from/, 'help sanity: the real flags are listed');
  for (const flag of cmds.flatMap((c) => c.match(/--[a-z-]+/g) || [])) assert.match(text, new RegExp(flag), `${flag} is not in --help`);
});

test('the build workflow rejects the same dot-segment shapes (it is the second gate)', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-explainer.yml'), 'utf8');
  const re = yml.match(/grep -qE '([^']+)'/)[1];
  const accepts = (v) => spawnSync('grep', ['-qE', re], { input: v }).status === 0;
  for (const bad of ['../..', '../users', 'owner/..', '.hidden/x', 'owner/.', 'a/b/c', 'a b/c', '']) assert.equal(accepts(bad), false, JSON.stringify(bad));
  for (const good of ['vercel/next.js', 'stuinfla/Repo-Explainer', 'a_b/c-d.e']) assert.equal(accepts(good), true, good);
});
