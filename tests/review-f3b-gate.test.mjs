// tests/review-f3b-gate.test.mjs — local door + gate fixes from the fresh re-audit. Every test here fails on the
// code it replaced (mutation-proven by the author): see the finding named in each test title.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refineLoop, reinjectAsk } from '../src/refine.mjs';
import { concludeShip } from '../src/orchestrator.mjs';
import { finalize, PLACEHOLDER } from '../src/ask.mjs';
import { checkSite, blockingFailures } from '../src/site-check.mjs';
import { postJsonFreshSocket } from '../tools/quality-grade.mjs';
import { resolveBrainLane } from '../src/claude.mjs';
import { selectPassages, passageTier, HERO_SCENE_RULES, authorKbTarget } from '../src/brain.mjs';
import { MAX_SCENE_BYTES } from '../tools/diagrams/scene.mjs';
import { kbRegisterStation, tournamentOutcome } from '../src/station-runners.mjs';
import * as stationRunners from '../src/station-runners.mjs';
import { recordClaims } from '../src/claims-record.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const tmp = (p = 'f3b-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// ── refine keeps the Ask box (set5 D1) ──────────────────────────────────────────────────────────────
const card = (device, mean) => ({ device, meanScore: mean, passed: false, inv18: { passed: true } });
const graded = (iterations, mean) => ({
  scorecard: [card('mobile(390)', mean), card('desktop(1440)', mean)], passed: false, iterations,
  refineNotes: [{ device: 'mobile(390)', criterion: 'A3', score: 72, saw: 'x' }], cost: { usd: iterations },
});
function refineSetup(quality, ask) {
  const dir = tmp('f3b-refine-');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ content: { v: 0 }, quality, ...(ask ? { ask } : {}) }));
  return dir;
}
// Records every tool the loop spawns; quality-grade writes the next scorecard from `means`.
function refineHarness(dir, means, { gradeOk = () => true } = {}) {
  const order = [];
  let v = 0, g = 0;
  const bj = () => readJson(path.join(dir, 'build.json'));
  const put = (f) => { const c = bj(); f(c); fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(c)); };
  return {
    order,
    deps: {
      authorContent: async () => { v += 1; return { v }; },
      runTool: (name) => {
        order.push(name);
        if (name !== 'quality-grade') return { ok: true };
        const ok = gradeOk(g);
        const iterations = bj().quality.iterations + 1;
        put((c) => { c.quality = graded(iterations, means[g]); });
        g++;
        return { ok, error: ok ? null : 'grade crashed' };
      },
    },
  };
}
const args = (dir) => ({ buildDir: dir, env: {}, model: 'm', apiKey: 'k', opts: {} });

test('D1 — every refine pass re-adds the Ask box right after assemble-page and before the grade sees the page', async () => {
  const dir = refineSetup(graded(1, 80), { passages: 90, sections: 7, starters: ['a?'] });
  try {
    const h = refineHarness(dir, [81, 82]);
    await refineLoop(args(dir), h.deps);
    assert.deepEqual(h.order, ['assemble-page', 'make-ask', 'quality-grade', 'assemble-page', 'make-ask', 'quality-grade']);
  } finally { rm(dir); }
});

test('D1 — restoring the best iteration re-assembles the page AND puts the Ask box back', async () => {
  const dir = refineSetup(graded(1, 85), { passages: 90, sections: 7, starters: ['a?'] });
  try {
    const h = refineHarness(dir, [75, 70]);
    await refineLoop(args(dir), h.deps);
    assert.deepEqual(h.order.slice(-2), ['assemble-page', 'make-ask'], 'the restore re-assembles and re-adds the box');
    assert.equal(readJson(path.join(dir, 'build.json')).content.v, 0, 'best (first) copy restored');
  } finally { rm(dir); }
});

test('D1 — a build whose Ask box was skipped (or never ran) is not given one by refine', async () => {
  for (const ask of [{ skipped: 'ASK_DISABLE=1' }, undefined]) {
    const dir = refineSetup(graded(1, 80), ask);
    try {
      const h = refineHarness(dir, [81, 82]);
      await refineLoop(args(dir), h.deps);
      assert.ok(!h.order.includes('make-ask'), JSON.stringify(ask));
      assert.deepEqual(reinjectAsk(dir, h.deps.runTool, {}), { ran: false });
    } finally { rm(dir); }
  }
});

test('D1 — finalize reports a LOST Ask box instead of claiming written answers', () => {
  const d = tmp('f3b-ask-');
  try {
    fs.mkdirSync(path.join(d, 'ask'));
    fs.writeFileSync(path.join(d, 'ask', 'pending.json'), '{}');
    fs.writeFileSync(path.join(d, 'index.html'), '<html><body>a page that lost its Ask section</body></html>');
    const r = finalize(d, 'x-explainer.netlify.app', 'a-signing-secret-that-is-long-enough-123');
    assert.equal(r.ask, 'lost');
    assert.match(r.reason, /make-ask/);
    assert.ok(!fs.existsSync(path.join(d, 'ask', 'pending.json')), 'the pending marker is cleared');
  } finally { rm(d); }
});

test('D1 — a rebuilt page that DOES carry the section still gets its token', () => {
  const d = tmp('f3b-ask-');
  try {
    fs.mkdirSync(path.join(d, 'ask'));
    fs.writeFileSync(path.join(d, 'ask', 'pending.json'), '{}');
    fs.writeFileSync(path.join(d, 'index.html'), `<section id="ask" data-token="${PLACEHOLDER}"></section>`);
    const r = finalize(d, 'x-explainer.netlify.app', 'a-signing-secret-that-is-long-enough-123');
    assert.equal(r.ask, 'written-answers');
    assert.ok(!fs.readFileSync(path.join(d, 'index.html'), 'utf8').includes(PLACEHOLDER));
  } finally { rm(d); }
});

// ── refine ranking: a FAILED grade is not a candidate (set4 M4) ───────────────────────────────────────
test('M4 — a grade that crashed after writing a (higher) slot is not kept as the best iteration', async () => {
  const dir = refineSetup(graded(1, 70));
  try {
    const h = refineHarness(dir, [95], { gradeOk: () => false });
    const q = await refineLoop(args(dir), h.deps);
    assert.equal(readJson(path.join(dir, 'build.json')).content.v, 0, 'the original copy is restored, not the one whose grade crashed');
    assert.deepEqual(q.scorecard.map((c) => c.meanScore), [70, 70]);
  } finally { rm(dir); }
});

// ── a fatal failure AFTER the grade is not "Done." (set4 D2) ─────────────────────────────────────────
function captureStderr(fn) {
  const real = process.stderr.write.bind(process.stderr);
  let out = '';
  process.stderr.write = (s) => { out += s; return true; };
  try { return { value: fn(), out }; } finally { process.stderr.write = real; }
}
test('D2 — a deploy failure after the grade prints the resume hint and NO green Done., and returns ok:false', () => {
  const dir = tmp('f3b-done-');
  try {
    fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ publish: { liveUrl: 'https://stale.example' } }));
    const { value, out } = captureStderr(() => concludeShip({ outDir: dir, startedAt: Date.now(), preResults: [{ id: 'quality-grade', ok: true, sec: 1 }], postR: { ok: false, failedAt: 'deploy', error: 'netlify said no', results: [{ id: 'deploy', ok: false, sec: 2 }] } }));
    assert.equal(value.ok, false);
    assert.equal(value.failedAt, 'deploy');
    assert.match(out, /Build stopped at "deploy"/);
    assert.match(out, new RegExp(`--from deploy --out ${dir.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
    assert.doesNotMatch(out, /Done\./);
    assert.doesNotMatch(out, /live: https:\/\/stale/);
  } finally { rm(dir); }
});

test('D2 — a clean ship still prints Done. and returns ok:true', () => {
  const dir = tmp('f3b-done-');
  try {
    fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ publish: { liveUrl: 'https://live.example' } }));
    const { value, out } = captureStderr(() => concludeShip({ outDir: dir, startedAt: Date.now(), preResults: [], postR: { ok: true, results: [] } }));
    assert.equal(value.ok, true);
    assert.match(out, /Done\./);
    assert.match(out, /live: https:\/\/live\.example/);
  } finally { rm(dir); }
});

// ── site-check: placeholder allowance is an option; AVIF != phone twin; no duplicates (set5 D4, set6 D3) ──
function siteDir(html, files = {}) {
  const d = tmp('f3b-site-');
  fs.mkdirSync(path.join(d, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(d, 'index.html'), `<!doctype html><html lang="en"><head><title>Demo explainer</title></head><body>${html}</body></html>`);
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  return d;
}
const msgs = (d, re, opts) => checkSite(d, opts).filter((r) => re.test(r.msg));

test('D4 — the Ask placeholder is allowed only by the option, never by a stray process env var', () => {
  const docs = Array.from({ length: 60 }, (_, i) => ({ p: `f${i}.md`, t: 't', x: 'x' }));
  const d = siteDir(`<section id="ask" data-token="${PLACEHOLDER}"></section>`, {
    'ask/index.json': JSON.stringify({ docs, sections: [] }), 'ask/ask.js': '//', 'ask/ask.css': '/**/',
  });
  const prev = process.env.ASK_CHECK_ALLOW_PLACEHOLDER;
  process.env.ASK_CHECK_ALLOW_PLACEHOLDER = '1';
  try {
    assert.equal(msgs(d, /Ask credential/)[0].ok, false, 'the env var no longer opens the gate');
    assert.equal(msgs(d, /Ask credential/, { allowAskPlaceholder: true })[0].ok, true);
    assert.equal(msgs(d, /Ask credential/, { allowAskPlaceholder: 'yes' })[0].ok, false, 'exactly true, not truthy');
  } finally { if (prev === undefined) delete process.env.ASK_CHECK_ALLOW_PLACEHOLDER; else process.env.ASK_CHECK_ALLOW_PLACEHOLDER = prev; rm(d); }
});

test('D3 — a missing AVIF is reported once, as a responsive-image variant, not as a phone twin', () => {
  const d = siteDir('<picture><source type="image/avif" srcset="assets/a-960.avif"><img src="assets/a-960.jpg"></picture>', { 'assets/a-960.jpg': 'j' });
  try {
    const twin = msgs(d, /phone-twin/);
    const variant = msgs(d, /responsive image variant/);
    assert.equal(twin.length, 1);
    assert.equal(twin[0].ok, true, 'no phone twin is missing');
    assert.equal(variant.length, 1);
    assert.equal(variant[0].ok, false);
    assert.equal(variant[0].blocking, true);
    assert.equal((variant[0].msg.match(/a-960\.avif/g) || []).length, 1, 'named once, not twice');
  } finally { rm(d); }
});

test('D3 — a missing phone twin is still a phone-twin failure, named once', () => {
  const d = siteDir('<picture><source media="(max-width: 600px)" srcset="assets/hero.m.png"><img src="assets/hero.png"></picture>', { 'assets/hero.png': 'p' });
  try {
    const twin = msgs(d, /phone-twin/);
    assert.equal(twin[0].ok, false);
    assert.equal((twin[0].msg.match(/hero\.m\.png/g) || []).length, 1);
    assert.equal(msgs(d, /responsive image variant/)[0].ok, true);
    assert.ok(blockingFailures(checkSite(d)).some((f) => /phone-twin/.test(f.msg)));
  } finally { rm(d); }
});

// ── ask.js with an index that has sections but no passages (set7 D3) ─────────────────────────────────
function stubEl() {
  const e = { dataset: {}, value: '', innerHTML: '', textContent: '', listeners: {}, children: {}, placeholder: '' };
  e.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  e.addEventListener = (t, f) => { (e.listeners[t] ||= []).push(f); };
  e.querySelector = (sel) => (e.children[sel] ||= stubEl());
  e.querySelectorAll = () => [];
  e.closest = () => null;
  return e;
}
test('D3 — ask.js with docs:[] answers "nothing matches" instead of crashing into "index did not load"', async () => {
  const root = stubEl();
  Object.assign(root.dataset, { index: 'ask/index.json', repo: 'o/demo', name: 'Demo', fn: '', token: '' });
  const document = { getElementById: (id) => (id === 'ask' ? root : null), querySelector: () => null, activeElement: null };
  const fetch = async () => ({ ok: true, json: async () => ({ docs: [], sections: [{ id: 's1', h: 'Heading', q: 'What is it?', text: 'something about the heading and what it does' }, ...['alpha', 'bravo', 'charlie', 'delta'].map((w, i) => ({ id: `s${i + 2}`, h: w, q: `About ${w}?`, text: `text on ${w} only` }))] }) });
  const ctx = vm.createContext({ document, fetch, window: { addEventListener() {}, scrollY: 0, innerHeight: 800 }, matchMedia: () => ({ matches: true }), setTimeout, setInterval, clearInterval, console, Promise });
  vm.runInContext(fs.readFileSync(path.join(REPO, 'tools', 'ask', 'ask.js'), 'utf8'), ctx);
  root.children['.ask-input'].value = 'explain heading';
  root.children['.ask-form'].listeners.submit[0]({ preventDefault() {} });
  await new Promise((r) => setTimeout(r, 1200));
  const html = root.children['.ask-ans'].innerHTML;
  assert.doesNotMatch(html, /did not load/);
  assert.match(html, /Read “Heading”/, 'the page section that matches is offered');
});

// ── quality-grade retry transport (set9 D5) ──────────────────────────────────────────────────────────
const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
test('D5 — the retry transport speaks plain http when OPENAI_BASE_URL is http://', async () => {
  let seen;
  const srv = await listen((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { seen = { url: req.url, body: b }; res.end('{"ok":1}'); }); });
  try {
    const r = await postJsonFreshSocket(`http://127.0.0.1:${srv.address().port}/v1/chat/completions`, { headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '{"ok":1}');
    assert.deepEqual(seen, { url: '/v1/chat/completions', body: '{"a":1}' });
  } finally { srv.close(); }
});
test('D5 — a stalled socket is abandoned after the timeout instead of hanging the grade', async () => {
  const srv = await listen(() => { /* never answers */ });
  try {
    const call = postJsonFreshSocket(`http://127.0.0.1:${srv.address().port}/x`, { body: '{}' }, 150);
    const guard = new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG: no timeout')), 3000));
    await assert.rejects(() => Promise.race([call, guard]), /no response within 150ms/);
  } finally { srv.closeAllConnections?.(); srv.close(); }
});

// ── brain lane: api forbids only the CLI (set4 D3) ───────────────────────────────────────────────────
test('D3 — EXPLAINMYREPO_BRAIN=api with only an OpenRouter key is a usable lane; claude-cli still excludes it', () => {
  const api = resolveBrainLane({ apiKey: '', env: { EXPLAINMYREPO_BRAIN: 'api', OPENROUTER_API_KEY: 'sk-or-x' } });
  assert.deepEqual([api.ok, api.useOpenRouter, api.useCli], [true, true, false]);
  const cli = resolveBrainLane({ apiKey: '', env: { EXPLAINMYREPO_BRAIN: 'claude-cli', OPENROUTER_API_KEY: 'sk-or-x' } });
  assert.deepEqual([cli.useOpenRouter, cli.useCli], [false, true]);
});

// ── brain: passage order (set4 M1) and prompt/target hygiene ─────────────────────────────────────────
test('M1 — source outranks ADRs in the grounding brief, including the Rust `crate-src` kind', () => {
  assert.equal(passageTier({ path: 'src/a.ts', kind: 'source' }), 2);
  assert.equal(passageTier({ path: 'crates/x/src/lib.rs', kind: 'crate-src' }), 2);
  assert.equal(passageTier({ path: 'docs/adr/0001.md', kind: 'adr' }), 3);
  const recs = [
    { id: 'adr', path: 'docs/adr/0001.md', kind: 'adr', text: 'decision text' },
    { id: 'crate', path: 'crates/x/src/lib.rs', kind: 'crate-src', text: 'rust module docs' },
    { id: 'src', path: 'src/a.ts', kind: 'source', text: 'typescript source' },
    { id: 'readme', path: 'README.md', kind: 'doc', source_type: 'doc', text: 'the readme' },
  ];
  assert.deepEqual(selectPassages(recs).map((p) => p.rec.id), ['readme', 'crate', 'src', 'adr']);
});

test('hero-scene prompt states the validator\'s real size limit, not a stale one', () => {
  assert.ok(HERO_SCENE_RULES.includes(`Under ${Math.round(MAX_SCENE_BYTES / 1000)} KB.`), String(MAX_SCENE_BYTES));
  assert.doesNotMatch(HERO_SCENE_RULES, /Under 20 KB/);
});

test('authorKbTarget emits no dead fullTextExt / templateExt keys and always carries an embed block', async () => {
  const realFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_u, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ metaName: 'Demo', codeExt: ['.rs'] }) }], stop_reason: 'end_turn', usage: {} }) };
  };
  try {
    const entry = await authorKbTarget({ _env: { EXPLAINMYREPO_BRAIN: 'api' }, repo: { slug: 'demo', clonePath: '/x' }, understanding: {} }, { apiKey: 'k', model: 'claude-sonnet-5-5' });
    assert.ok(entry.embed?.model && entry.embed.dim === 384);
    assert.ok(!('fullTextExt' in entry) && !('templateExt' in entry));
    assert.doesNotMatch(sent.messages[0].content, /fullTextExt/);
  } finally { globalThis.fetch = realFetch; }
});

// ── tournament skip shape: a skip and a failure are different outcomes ───────────────────────────────
test('tournamentOutcome: a skip keeps its reason, a failure stays a failure, a silent exit-0 is no longer a skip', () => {
  assert.deepEqual(tournamentOutcome({ ok: true, code: 0, result: { ok: true, skipped: 'only one candidate model', error: null } }), { ok: true, skipped: 'tournament not run: only one candidate model' });
  assert.deepEqual(tournamentOutcome({ ok: true, code: 0, result: { ok: true, error: null } }), { ok: true });
  assert.deepEqual(tournamentOutcome({ ok: false, code: 1, result: null, error: 'boom' }), { ok: false, error: 'boom' });
  assert.deepEqual(tournamentOutcome({ ok: false, code: 0, result: null, error: 'no JSON' }), { ok: false, error: 'no JSON' });
});

// ── ONE recordClaims (set7 MIS) ───────────────────────────────────────────────────────────────────────
test('claims: one shared recordClaims; a checker that throws is recorded, never thrown; the slot is merged', () => {
  assert.equal(stationRunners.recordClaims, undefined, 'station-runners keeps no second copy');
  const merged = [];
  const quiet = () => {};
  const ok = recordClaims('/b', { check: () => ({ ok: true, findings: 2, citations: 5, commands: { checked: ['x'], n: 1 } }), merge: (d, k, v) => merged.push([d, k, v]), log: quiet });
  assert.deepEqual([ok.ok, ok.findings, ok.citations, ok.commands.n, ok.commands.checked], [true, 2, 5, 1, undefined]);
  const bad = recordClaims('/b', { check: () => { throw new Error('cannot read build'); }, merge: (d, k, v) => merged.push([d, k, v]), log: quiet });
  assert.deepEqual([bad.ok, bad.advisory, bad.error], [null, true, 'cannot read build']);
  assert.deepEqual(merged.map((m) => m[1]), ['claims', 'claims']);
  assert.doesNotThrow(() => recordClaims('/b', { check: () => ({ ok: true }), merge: () => { throw new Error('disk full'); }, log: quiet }));
});

// ── kb:register writes a per-build overlay, never the tracked kb.config.mjs (set5 MIS) ────────────────
const CONFIG_FIXTURE = `import fs from 'node:fs';
export const targets = { existing: { slug: 'existing', embed: { model: 'm' } }, bare: { slug: 'bare' } };
if (process.env.KB_TARGET_OVERLAY) Object.assign(targets, JSON.parse(fs.readFileSync(process.env.KB_TARGET_OVERLAY, 'utf8')));
export function getTarget(slug) { const t = targets[slug]; if (!t) throw new Error('unknown target ' + slug); return t; }
`;
function registerFixture(slug) {
  const root = tmp('f3b-root-');
  fs.mkdirSync(path.join(root, 'kb'));
  fs.writeFileSync(path.join(root, 'kb', 'kb.config.mjs'), CONFIG_FIXTURE);
  const buildDir = tmp('f3b-build-');
  fs.writeFileSync(path.join(buildDir, 'build.json'), JSON.stringify({ repo: { slug, clonePath: '/clone' } }));
  return { root, buildDir };
}
test('kb:register — a new target goes to the per-build overlay; kb/kb.config.mjs stays byte-identical', async () => {
  const { root, buildDir } = registerFixture('fresh-one');
  const before = fs.readFileSync(path.join(root, 'kb', 'kb.config.mjs'), 'utf8');
  const prev = process.env.KB_TARGET_OVERLAY;
  try {
    const r = await kbRegisterStation({ buildDir }, { apiKey: 'k', model: 'm' }, { repoRoot: root, author: async () => ({ slug: 'fresh-one', embed: { model: 'Xenova/bge-small-en-v1.5' } }) });
    assert.equal(r.registered, true);
    assert.equal(fs.readFileSync(path.join(root, 'kb', 'kb.config.mjs'), 'utf8'), before, 'the tracked config is never edited');
    const overlay = path.join(buildDir, 'kb-targets.overlay.json');
    assert.equal(readJson(overlay)['fresh-one'].embed.model, 'Xenova/bge-small-en-v1.5');
    assert.equal(process.env.KB_TARGET_OVERLAY, overlay);
    const again = await kbRegisterStation({ buildDir }, { apiKey: 'k', model: 'm' }, { repoRoot: root, author: async () => { throw new Error('must not re-author'); } });
    assert.equal(again.skipped, 'already-registered');
  } finally { if (prev === undefined) delete process.env.KB_TARGET_OVERLAY; else process.env.KB_TARGET_OVERLAY = prev; rm(root); rm(buildDir); }
});
test('kb:register — refuses a target with no embed block (authored or already registered)', async () => {
  const prev = process.env.KB_TARGET_OVERLAY;
  const a = registerFixture('no-embed');
  const b = registerFixture('bare');
  try {
    await assert.rejects(() => kbRegisterStation({ buildDir: a.buildDir }, {}, { repoRoot: a.root, author: async () => ({ slug: 'no-embed' }) }), /no `embed` block/);
    assert.ok(!fs.existsSync(path.join(a.buildDir, 'kb-targets.overlay.json')), 'nothing is registered for the refused entry');
    await assert.rejects(() => kbRegisterStation({ buildDir: b.buildDir }, {}, { repoRoot: b.root, author: async () => ({}) }), /no `embed` block/);
  } finally { if (prev === undefined) delete process.env.KB_TARGET_OVERLAY; else process.env.KB_TARGET_OVERLAY = prev; rm(a.root); rm(a.buildDir); rm(b.root); rm(b.buildDir); }
});
test('kb:register contract — the REAL kb/kb.config.mjs merges KB_TARGET_OVERLAY into targets at load', () => {
  const dir = tmp('f3b-ovl-');
  try {
    const overlay = path.join(dir, 'o.json');
    fs.writeFileSync(path.join(dir, 'o.json'), JSON.stringify({ 'zz-overlay-probe': { slug: 'zz-overlay-probe', embed: { model: 'm', dim: 384 } } }));
    const code = `const m = await import(${JSON.stringify(path.join(REPO, 'kb', 'kb.config.mjs'))}); console.log(m.getTarget('zz-overlay-probe').slug);`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, KB_TARGET_OVERLAY: overlay } });
    assert.equal(r.stdout.trim(), 'zz-overlay-probe', r.stderr.slice(0, 300));
  } finally { rm(dir); }
});

// ── tools/build-kb.mjs: no guessed embedder, no .small.rvf folklore, overlay forwarded (set7 D2, set2 D2) ──
function buildKbRoot() {
  const root = tmp('f3b-bkb-');
  fs.mkdirSync(path.join(root, 'tools')); fs.mkdirSync(path.join(root, 'kb'));
  fs.copyFileSync(path.join(REPO, 'tools', 'build-kb.mjs'), path.join(root, 'tools', 'build-kb.mjs'));
  const w = (f, body) => fs.writeFileSync(path.join(root, 'kb', f), body);
  const store = `path.join(process.cwd(), 'kb', 'stores', slug)`;
  const head = `import fs from 'node:fs'; import path from 'node:path';\nconst slug = process.argv[process.argv.length - 1]; const dir = ${store}; fs.mkdirSync(dir, { recursive: true });\n`;
  w('build-kb.mjs', `${head}
if (process.env.STUB_STORE !== 'none') fs.writeFileSync(path.join(dir, process.env.STUB_STORE === 'small' ? slug + '-kb.small.rvf' : slug + '-kb.rvf'), 'rvf');
fs.writeFileSync(path.join(dir, slug + '-kb.passages.jsonl'), '{"id":"1","text":"x"}\\n');
fs.writeFileSync(path.join(dir, slug + '-kb.ids.json'), '{}');
if (process.env.STUB_EMBED) fs.writeFileSync(path.join(dir, slug + '-kb.rvf.embed.json'), JSON.stringify({ model: process.env.STUB_EMBED }));
fs.writeFileSync(path.join(dir, 'overlay-seen.txt'), process.env.KB_TARGET_OVERLAY || '');`);
  w('extract-symbols.mjs', `${head}fs.writeFileSync(path.join(dir, slug + '-symbols.json'), '{"count":0}');`);
  w('dep-graph.mjs', `${head}fs.writeFileSync(path.join(dir, slug + '-dep-graph.json'), '{"nodes":[]}');`);
  w('entrypoints.mjs', `${head}fs.writeFileSync(path.join(dir, slug + '-entrypoints.json'), '{"commands":[]}');`);
  const build = tmp('f3b-bkb-build-'); const clone = tmp('f3b-bkb-clone-');
  fs.writeFileSync(path.join(build, 'build.json'), JSON.stringify({ repo: { slug: 'demo', name: 'demo', clonePath: clone } }));
  return { root, build, clone };
}
const runBuildKb = (f, env = {}) => {
  const r = spawnSync(process.execPath, [path.join(f.root, 'tools', 'build-kb.mjs'), f.build], { cwd: f.root, encoding: 'utf8', env: { ...process.env, KB_TARGET_OVERLAY: '', ...env } });
  return { code: r.status, out: JSON.parse(r.stdout.trim().split('\n').pop()), stderr: r.stderr };
};
test('build-kb tool — records the embedder the SIDECAR names, never a guessed default', () => {
  const f = buildKbRoot();
  try {
    const r = runBuildKb(f, { STUB_EMBED: 'Xenova/all-MiniLM-L6-v2' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.out.outputs.kb.embedModel, 'Xenova/all-MiniLM-L6-v2');
  } finally { rm(f.root); rm(f.build); rm(f.clone); }
});
test('build-kb tool — a store with no embed sidecar fails loud instead of claiming bge-small', () => {
  const f = buildKbRoot();
  try {
    const r = runBuildKb(f, {});
    assert.equal(r.code, 1);
    assert.equal(r.out.ok, false);
    assert.match(r.out.error, /embed\.json is missing or names no model/);
    assert.doesNotMatch(r.stderr + r.out.error, /bge-small/);
  } finally { rm(f.root); rm(f.build); rm(f.clone); }
});
test('build-kb tool — no store is the plain "RVF build produced no store" failure (no .small.rvf branch)', () => {
  const f = buildKbRoot();
  try {
    const r = runBuildKb(f, { STUB_STORE: 'small', STUB_EMBED: 'm' });
    assert.equal(r.code, 1);
    assert.match(r.out.error, /RVF build produced no store/);
    assert.doesNotMatch(r.out.error, /small/);
  } finally { rm(f.root); rm(f.build); rm(f.clone); }
});
test('build-kb tool — a build\'s kb-targets overlay is forwarded to the kb engine (resume in a fresh process)', () => {
  const f = buildKbRoot();
  try {
    const overlay = path.join(f.build, 'kb-targets.overlay.json');
    fs.writeFileSync(overlay, '{}');
    const r = runBuildKb(f, { STUB_EMBED: 'm' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(f.root, 'kb', 'stores', 'demo', 'overlay-seen.txt'), 'utf8'), overlay);
  } finally { rm(f.root); rm(f.build); rm(f.clone); }
});

// ── ask-kb: `k` sizes the result set through the REAL searchKb (set2 WEAK M4) ─────────────────────────
test('searchKb returns exactly k results for k=10 and k=3 (the CLI/MCP argument is what sizes the set)', async (t) => {
  const { searchKb } = await import('../kb/ask-kb.mjs');
  let ten;
  try { ten = await searchKb({ query: 'how do I use it', k: 10, store: 'chalk' }); }
  catch (e) {
    if (/fetch failed|ENOTFOUND|ECONN|offline|Could not locate|Unauthorized|model/i.test(String(e.message))) return t.skip(`embedder unavailable here: ${String(e.message).slice(0, 80)}`);
    throw e;
  }
  assert.equal(ten.length, 10, 'k=10 must not be cut to a stale default of 5');
  assert.equal((await searchKb({ query: 'how do I use it', k: 3, store: 'chalk' })).length, 3);
});
