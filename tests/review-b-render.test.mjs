// tests/review-b-render.test.mjs — review 3.0.1 #10b (devices render concurrently) and the grader-outage
// slot (#2/#3, live ruvllm 3.0.0 build). Runs the REAL tools/quality-grade.mjs against a tiny static page
// with real Playwright Chromium, and points OPENAI_BASE_URL at an in-process mock grader — no API is
// called. Skipped when Playwright/Chromium is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QG = path.join(ROOT, 'tools', 'quality-grade.mjs');

let haveBrowser = false;
try {
  const { chromium } = await import('playwright');
  haveBrowser = fs.existsSync(chromium.executablePath());
} catch { haveBrowser = false; }

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#58a"/></svg>';
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test explainer page</title>
<style>img{max-width:100%} section,details{display:block;min-height:500px} .hero-refusal{width:300px;height:120px;background:#222;color:#fff}</style></head><body>
<section class="hero"><h1>A tiny tool.</h1><p>It sorts your files. It is fast.</p><div class="hero-refusal">moving</div></section>
<details class="section" id="problem" open><summary>Problem</summary><p>Files get lost. People waste time.</p></details>
<details class="section" id="what-it-is" open><summary>What</summary><p>It puts each file in the right box.</p></details>
<details class="section" id="the-insight" open><summary>Insight</summary><p>It reads the name first.</p></details>
<section id="how-it-works"><figure class="diagram"><span class="tier">architecture</span><img src="a.svg" alt="architecture"></figure>
<figure class="diagram"><span class="tier">flow</span><img src="f.svg" alt="flow"></figure></section>
<section id="get-started"><p>Run it.</p></section></body></html>`;

const GRADE = JSON.stringify({
  gateA: { A1: 90, A2: 90, A3: 90, A4: 90, A5: 90, A6: 90 },
  gateB: { B1: 90, B2: 90, B3: 90, B4: 90, B5: 90 },
  rationales: Object.fromEntries(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5'].map((k) => [k, 'fine'])),
  clarity: { architectureReadsClearly: true, architectureNote: '', flowReadsClearly: true, flowNote: '' },
  operatorQuestions: { believeIUnderstand: true, approachable: true, explainsToNovice: true, architectureConfidence: true, makesMeSmile: true, zeroKnowledgeReader: true },
});

async function mockGrader(content) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/v1`, calls: () => calls };
}

function buildDir(quality) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-b-render-'));
  const site = path.join(dir, 'site');
  fs.mkdirSync(site, { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), PAGE);
  fs.writeFileSync(path.join(site, 'a.svg'), SVG);
  fs.writeFileSync(path.join(site, 'f.svg'), SVG);
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    repo: { url: 'https://github.com/o/r', slug: 'r' },
    page: { dir: site, htmlPath: path.join(site, 'index.html') },
    visuals: { flowDiagram: { svgPath: 'f.svg' } },
    ...(quality ? { quality } : {}),
  }));
  return dir;
}
function runQG(dir, baseUrl) {
  return new Promise((resolve) => {
    const env = { ...process.env, OPENAI_API_KEY: 'sk-test-offline', OPENAI_BASE_URL: baseUrl, QUALITY_VISION_MODEL: 'mock-model' };
    const p = spawn(process.execPath, [QG, dir], { env });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
const pngWidth = (p) => fs.readFileSync(p).readUInt32BE(16);
const mtime = (dir, f) => fs.statSync(path.join(dir, 'assets', f)).mtimeMs;

test('#10b both devices render CONCURRENTLY, with the same screenshots and scorecard shape', { skip: !haveBrowser && 'playwright chromium not installed', timeout: 120000 }, async () => {
  const mock = await mockGrader(GRADE);
  const dir = buildDir();
  try {
    const r = await runQG(dir, mock.url);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const q = read(dir).quality;
    assert.deepEqual(q.scorecard.map((c) => c.device), ['mobile(390)', 'desktop(1440)'], 'device order is unchanged');
    assert.equal(q.passed, true);
    assert.equal(q.iterations, 1);
    assert.equal(mock.calls(), 2, 'one grade per device: a mean of 90 is not borderline, so no second sample');
    assert.equal(q.scorecard[0].samples, 1);
    assert.equal(q.cost.usd, null, 'mock-model has no known rate: UNPRICED, never $0');
    assert.match(q.cost.basis, /UNPRICED/);
    assert.equal(q.cost.calls, 2);
    assert.equal(pngWidth(q.screenshots.mobile), 780, 'mobile full page at 390 CSS px x dsf 2');
    assert.equal(pngWidth(q.screenshots.desktop), 1440);
    for (const c of q.scorecard) assert.ok(c.gradedCrops.length >= 8, `${c.device}: hero, 3 anim beats, 2 diagrams, sections`);
    // Each device samples its hero animation for >= 6.2s. Run one after the other, every mobile beat is
    // written before any desktop beat; run together, the two sampling windows OVERLAP.
    const m1 = mtime(dir, 'grade-mobile-390-heroAnim-beat1.png'), m3 = mtime(dir, 'grade-mobile-390-heroAnim-beat3.png');
    const d1 = mtime(dir, 'grade-desktop-1440-heroAnim-beat1.png'), d3 = mtime(dir, 'grade-desktop-1440-heroAnim-beat3.png');
    assert.ok(m3 - m1 >= 6000 && d3 - d1 >= 6000, 'the worst-frame sampling still spans ~6s per device');
    assert.ok(m1 < d3 && d1 < m3, `sampling windows must overlap (mobile ${m1}-${m3}, desktop ${d1}-${d3})`);
  } finally { mock.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

const scored = (score, over = {}) => JSON.stringify({ ...JSON.parse(GRADE),
  gateA: Object.fromEntries(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((k) => [k, score])),
  gateB: Object.fromEntries(['B1', 'B2', 'B3', 'B4', 'B5'].map((k) => [k, score])), ...over });

test('D1 the INV-22 raster cap runs in the REAL tool: a both-FAIL raster in the grader reply caps B5 at 55 on both devices', { skip: !haveBrowser && 'playwright chromium not installed', timeout: 120000 }, async () => {
  const mock = await mockGrader(scored(95, { rasters: [{ what: 'hero', takeaway: 'FAIL', swappable: 'FAIL', why: 'generic' }] }));
  const dir = buildDir();
  try {
    const r = await runQG(dir, mock.url);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const q = read(dir).quality;
    for (const c of q.scorecard) {
      assert.equal(c.gateB.B5, 55, `${c.device}: capped, not the 95 the grader reported`);
      assert.equal(c.headlineScore, 55);
      assert.equal(c.passed, false);
    }
    assert.equal(q.passed, false);
    assert.match(r.stderr, /INV-22 cap applied by arithmetic/);
  } finally { mock.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a borderline page (mean 82) is graded twice per device: 4 calls, samples=2, cost counts all four', { skip: !haveBrowser && 'playwright chromium not installed', timeout: 120000 }, async () => {
  const mock = await mockGrader(scored(82));
  const dir = buildDir();
  try {
    const r = await runQG(dir, mock.url);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const q = read(dir).quality;
    assert.equal(mock.calls(), 4);
    assert.deepEqual(q.scorecard.map((c) => c.samples), [2, 2]);
    assert.equal(q.cost.calls, 4);
    assert.equal(q.passed, true, 'mean 82, min 82: ships');
  } finally { mock.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('grader outage writes a FRESH slot: no stale scorecard or pre-check refusal from an older copy', { skip: !haveBrowser && 'playwright chromium not installed', timeout: 120000 }, async () => {
  const mock = await mockGrader('{}'); // the live failure: "missing gateA/gateB/rationales/clarity"
  const stale = { device: 'mobile(390)', meanScore: 61, inv18: { passed: false } };
  const dir = buildDir({ scorecard: [stale, stale], passed: false, iterations: 2, cost: { usd: 0.5 },
    gateRefusal: 'INV-20 unexplained acronym(s): GNU', inv20: { passed: false, violations: ['GNU'] } });
  try {
    const r = await runQG(dir, mock.url);
    assert.equal(r.status, 1, 'the grade did not happen — still a non-zero exit');
    assert.match(r.stdout, /missing gateA\/gateB\/rationales\/clarity/);
    const q = read(dir).quality;
    assert.equal(q.graderUnavailable, true);
    assert.deepEqual(q.scorecard, [], 'an older copy\'s grades must not be disclosed as this copy\'s');
    assert.equal(q.gateRefusal, undefined, 'this copy passed the pre-checks');
    assert.equal(q.iterations, 2, 'an outage does not spend a grade');
    assert.deepEqual(q.cost, { usd: 0.5 }, 'prior spend carries over');
    assert.ok(fs.existsSync(q.screenshots.mobile) && fs.existsSync(q.screenshots.desktop), 'this copy\'s fresh renders are recorded');
  } finally { mock.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
