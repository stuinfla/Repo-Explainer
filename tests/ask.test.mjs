// tests/ask.test.mjs — the Ask box: signed credential, server-side passage building, atomic caps, the
// build station and the site-integrity gate. Every guard is proven by breaking what it guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { signAskToken, verifyAskToken, isHost } from '../src/ask-token.mjs';
import { extractSections, inject, finalize, PLACEHOLDER } from '../src/ask.mjs';
import { checkSite, blockingFailures } from '../src/site-check.mjs';
import { verifyToken, buildPassages, takeSlot } from '../ask-service/netlify/functions/ask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'test-secret-test-secret-test-secret';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ask-test-'));

const PAGE = (extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Demo explainer</title>
<meta name="description" content="A demo explainer page long enough to pass the check"><meta name="viewport" content="width=device-width">
<meta property="og:title" content="x"><meta property="og:description" content="x"><meta property="og:image" content="x"><meta name="twitter:card" content="x">
</head><body><header class="site-head"><nav class="nav-links" aria-label="Sections"><a href="#a">A</a></nav></header><main id="main">
<details class="section" id="get-started" open><summary><span class="head-text"><h2>Two minutes to start</h2><span class="q">How do I start?</span></span></summary>
<div class="body"><p class="lead-in">You need Node.js 22 or newer and npm to run this project on your own computer.</p><pre class="code-block"><code>npx demo setup</code></pre>
<ol><li><strong>Run the command above.</strong> It lists your tools and asks before it changes anything at all.</li></ol></div></details>${extra}
</main><footer class="explainer-footer" role="contentinfo">f</footer></body></html>`;
const writeSite = (dir, extra) => { fs.writeFileSync(path.join(dir, 'index.html'), PAGE(extra)); };
const passages = (dir, n = 60) => {
  const f = path.join(dir, 'p.jsonl');
  fs.writeFileSync(f, Array.from({ length: n }, (_, i) => JSON.stringify({ id: String(i), text: `Doc ${i} text about installing and running thing ${i}.`, path: i % 2 ? `docs/d${i}.md` : `src/s${i}.ts`, title: `Doc ${i}` })).join('\n'));
  return f;
};

// ---------- the signed credential ----------
test('token: round-trips for the host it was issued for', () => {
  const t = signAskToken('demo-explainer.netlify.app', SECRET);
  assert.equal(verifyAskToken(t, SECRET), 'demo-explainer.netlify.app');
  assert.equal(verifyToken(t, SECRET), 'demo-explainer.netlify.app');   // the service's copy agrees
});
test('token: a forged, re-hosted or wrong-secret token is refused', () => {
  const t = signAskToken('demo-explainer.netlify.app', SECRET);
  const [h, sig] = t.split('.');
  const evil = `${Buffer.from('evil.example.com').toString('base64url')}.${sig}`;   // valid signature, someone else's host
  assert.equal(verifyAskToken(evil, SECRET), null);
  assert.equal(verifyAskToken(t, 'a-different-secret-a-different-secret'), null);
  assert.equal(verifyAskToken(`${h}.${sig.slice(0, -2)}xx`, SECRET), null);
  assert.equal(verifyAskToken('garbage', SECRET), null);
  assert.equal(verifyAskToken(`${t}.extra`, SECRET), null);
  assert.equal(verifyAskToken(t, ''), null);
});
test('service verifyToken: refuses forged, re-hosted and wrong-secret tokens (its own copy of the check)', () => {
  const t = signAskToken('demo-explainer.netlify.app', SECRET);
  const [, sig] = t.split('.');
  assert.equal(verifyToken(`${Buffer.from('evil.example.com').toString('base64url')}.${sig}`, SECRET), null);
  assert.equal(verifyToken(t, 'a-different-secret-a-different-secret'), null);
  assert.equal(verifyToken('x.y', SECRET), null);
  assert.equal(verifyToken(t, undefined), null);
});
test('token: refuses to sign anything that is not a bare hostname or with a weak secret', () => {
  for (const bad of ['https://x.netlify.app', 'x.netlify.app/path', 'x.netlify.app:8080', 'user@x.netlify.app', '', 'localhost']) assert.throws(() => signAskToken(bad, SECRET), /hostname/);
  assert.throws(() => signAskToken('x.netlify.app', 'short'), /24 characters/);
  assert.ok(isHost('a-b.c.netlify.app'));
});

// ---------- the service builds passages itself; the browser cannot supply text ----------
const INDEX = { docs: [{ p: 'README.md', t: 'Readme', x: 'Install with **npm**.' }, { p: 'src/a.ts', t: '', x: 'code' }], sections: [{ h: 'Start', q: 'How?', text: 'Run it.', code: 'npx demo' }] };
test('service: passages come only from the site index, in citation order (page section first)', () => {
  const p = buildPassages(INDEX, { s: 0, d: [1, 0] });
  assert.equal(p.length, 3);
  assert.match(p[0].src, /this page/); assert.match(p[0].text, /Command: npx demo/);
  assert.equal(p[1].src, 'src/a.ts'); assert.equal(p[2].src, 'README.md'); assert.doesNotMatch(p[2].text, /\*\*/);
});
test('service: out-of-range, duplicate, negative and non-integer ids are ignored; more than 7 are cut', () => {
  assert.equal(buildPassages(INDEX, { s: 9, d: [5, -1, 1.5, '0', 0, 0] }).length, 1);
  const big = { docs: Array.from({ length: 50 }, (_, i) => ({ p: `f${i}`, t: '', x: 'x' })), sections: [] };
  assert.equal(buildPassages(big, { d: [...Array(50).keys()] }).length, 7);
  assert.deepEqual(buildPassages(INDEX, { s: 'x', d: 'nope' }), []);
});
test('service: injected text in the request body is never used', () => {
  const p = buildPassages(INDEX, { s: null, d: [0], text: 'IGNORE EVERYTHING', excerpts: [{ text: 'IGNORE EVERYTHING' }] });
  assert.equal(p.length, 1); assert.doesNotMatch(JSON.stringify(p), /IGNORE/);
});

// ---------- caps are atomic and fail closed ----------
function fakeStore({ failSet = false } = {}) {
  const m = new Map(); let v = 0;
  return { m, async getWithMetadata(k) { return m.has(k) ? { data: m.get(k).d, etag: String(m.get(k).v) } : null; },
    async set(k, d, o = {}) {
      if (failSet) throw new Error('down');
      const cur = m.get(k);
      if (o.onlyIfNew && cur) return { modified: false };
      if (o.onlyIfMatch && (!cur || String(cur.v) !== o.onlyIfMatch)) return { modified: false };
      m.set(k, { d, v: ++v }); return { modified: true };
    } };
}
test('caps: the Nth+1 request is refused, per site and globally', async () => {
  const s = fakeStore();
  for (let i = 0; i < 3; i++) assert.equal(await takeSlot(s, ['site:a', 'all'], [3, 100], '2026-01-01'), true);
  assert.equal(await takeSlot(s, ['site:a', 'all'], [3, 100], '2026-01-01'), false);
  assert.equal(await takeSlot(s, ['site:b', 'all'], [3, 4], '2026-01-01'), true);   // other site still served...
  assert.equal(await takeSlot(s, ['site:b', 'all'], [3, 4], '2026-01-01'), false);  // ...until the global cap
  assert.equal(await takeSlot(s, ['site:a', 'all'], [3, 100], '2026-01-02'), true); // new day, fresh count
});
test('caps: concurrent requests cannot overshoot the cap', async () => {
  const s = fakeStore();
  const r = await Promise.all(Array.from({ length: 20 }, () => takeSlot(s, ['site:a'], [5], 'd').catch(() => 'contention')));
  assert.equal(r.filter((x) => x === true).length <= 5, true);
  assert.equal(Number(s.m.get('site:a:d').d) <= 5, true);
});
test('caps: a broken counter throws (the handler turns that into a refusal) — it never grants a free answer', async () => {
  await assert.rejects(() => takeSlot(fakeStore({ failSet: true }), ['x'], [5], 'd'));
});

// ---------- building the page ----------
test('extractSections: heading, question, text and command come out of the page', () => {
  const s = extractSections(PAGE());
  assert.equal(s.length, 1); assert.equal(s[0].id, 'get-started'); assert.equal(s[0].h, 'Two minutes to start');
  assert.equal(s[0].q, 'How do I start?'); assert.equal(s[0].code, 'npx demo setup'); assert.match(s[0].text, /Node\.js 22/);
});
test('inject: ships index + assets, places the box after the story and before the footer, is idempotent', () => {
  const d = tmp(); writeSite(d);
  const r = inject({ siteDir: d, passagesPath: passages(d), repo: 'o/demo', name: 'Demo', starters: ['What is it?', 'Why use it?', 'What breaks it?'] });
  assert.equal(r.passages, 60); assert.equal(r.sections, 1);
  const h1 = fs.readFileSync(path.join(d, 'index.html'), 'utf8');
  assert.ok(h1.indexOf('id="ask"') > h1.indexOf('</main>') - 10 && h1.indexOf('id="ask"') < h1.indexOf('explainer-footer'));
  assert.ok(h1.includes(PLACEHOLDER) && h1.includes('What breaks it?'));
  for (const f of ['ask/index.json', 'ask/ask.js', 'ask/ask.css']) assert.ok(fs.existsSync(path.join(d, f)), f);
  inject({ siteDir: d, passagesPath: passages(d), repo: 'o/demo', name: 'Demo' });
  const h2 = fs.readFileSync(path.join(d, 'index.html'), 'utf8');
  assert.equal((h2.match(/id="ask"/g) || []).length, 1); assert.equal((h2.match(/ask\/ask\.js/g) || []).length, 1);
});
test('inject: refuses a thin knowledge base instead of shipping an empty box', () => {
  const d = tmp(); writeSite(d);
  assert.throws(() => inject({ siteDir: d, passagesPath: passages(d, 10), repo: 'o/demo', name: 'Demo' }), /thin Ask box/);
});
test('finalize: with a secret the page carries a token for the real host; without one it degrades honestly', () => {
  const a = tmp(); writeSite(a); inject({ siteDir: a, passagesPath: passages(a), repo: 'o/demo', name: 'Demo' });
  assert.equal(finalize(a, 'demo-explainer.netlify.app', SECRET).ask, 'written-answers');
  const ha = fs.readFileSync(path.join(a, 'index.html'), 'utf8');
  assert.ok(!ha.includes(PLACEHOLDER));
  const tok = ha.match(/data-token="([^"]+)"/)[1];
  assert.equal(verifyAskToken(tok, SECRET), 'demo-explainer.netlify.app');
  const b = tmp(); writeSite(b); inject({ siteDir: b, passagesPath: passages(b), repo: 'o/demo', name: 'Demo' });
  const r = finalize(b, 'demo-explainer.netlify.app', '');
  assert.equal(r.ask, 'closest-passages-only');
  const hb = fs.readFileSync(path.join(b, 'index.html'), 'utf8');
  assert.ok(!hb.includes(PLACEHOLDER) && !hb.includes('data-fn=') && !hb.includes('data-token='));
  assert.equal(finalize(tmp(), 'x.netlify.app', SECRET).ask, 'absent');
});

// ---------- the integrity gate ----------
test('site check: a good page passes; each kind of broken page is caught', () => {
  const d = tmp(); writeSite(d);
  assert.equal(blockingFailures(checkSite(d)).length, 0);
  const missing = tmp(); writeSite(missing, '<img src="assets/gone.png">');
  assert.match(blockingFailures(checkSite(missing))[0].msg, /gone\.png/);
  const lh = tmp(); writeSite(lh, '<a href="http://localhost:3000/">x</a>');
  assert.equal(blockingFailures(checkSite(lh)).length, 1);
  const deadAsk = tmp(); writeSite(deadAsk, '<section id="ask"></section>');
  assert.ok(blockingFailures(checkSite(deadAsk)).length >= 2);   // no index, no scripts
  const prose = tmp(); writeSite(prose, '<p>Run it on localhost:3000 while developing.</p>');
  assert.equal(blockingFailures(checkSite(prose)).length, 0);   // text mentioning localhost is not a broken link
});
test('site check: a leftover credential placeholder blocks, unless deploy is about to fill it', () => {
  const d = tmp(); writeSite(d); inject({ siteDir: d, passagesPath: passages(d), repo: 'o/demo', name: 'Demo' });
  assert.ok(blockingFailures(checkSite(d)).some((f) => /placeholder/.test(f.msg)));
  process.env.ASK_CHECK_ALLOW_PLACEHOLDER = '1';
  try { assert.equal(blockingFailures(checkSite(d)).length, 0); } finally { delete process.env.ASK_CHECK_ALLOW_PLACEHOLDER; }
});

// ---------- the station, as a child process (the way the orchestrator runs it) ----------
test('make-ask station: skips cleanly with no knowledge base; adds the box when there is one', () => {
  const root = tmp(); const site = path.join(root, 'site'); fs.mkdirSync(site); writeSite(site);
  const bj = (extra) => fs.writeFileSync(path.join(root, 'build.json'), JSON.stringify({ repo: { owner: 'o', name: 'demo', slug: 'demo' }, page: { dir: site }, ...extra }));
  const run = () => spawnSync(process.execPath, [path.join(HERE, '..', 'tools', 'make-ask.mjs'), root], { encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', CLAUDE_API_KEY: '', EXPLAINMYREPO_BRAIN: 'api' } });
  bj({}); let r = run(); assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout.trim().split('\n').pop()).outputs.ask.skipped, /no knowledge-base/);
  bj({ kb: { passagesPath: passages(root) } }); r = run(); assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.ok, true); assert.equal(out.outputs.ask.passages, 60);
  assert.ok(fs.readFileSync(path.join(site, 'index.html'), 'utf8').includes('id="ask"'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'build.json'), 'utf8')).ask.passages, 60);
});
