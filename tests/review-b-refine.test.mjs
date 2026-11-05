// tests/review-b-refine.test.mjs — review 3.0.1 findings #3 and #9b, plus the live ruvllm 3.0.0 build.
// refineLoop runs against a temp build dir with the brain and the station tools stubbed: the stub
// quality-grade mimics the real one's contract (writes the quality slot; at the 3-grade cap it returns
// ok WITHOUT writing). No model, image or vision API is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refineLoop, stationTimingTable, formatImagesCost } from '../src/orchestrator.mjs';

const card = (device, mean) => ({ device, meanScore: mean, passed: false, inv18: { passed: true } });
const graded = (iterations, mean, extra = {}) => ({
  scorecard: [card('mobile(390)', mean), card('desktop(1440)', mean)], passed: false, iterations,
  refineNotes: [{ device: 'mobile(390)', criterion: 'A3', score: 72, saw: 'x' }], cost: { usd: iterations }, ...extra,
});
const refusal = (iterations, violations, scorecard = []) => ({
  scorecard, passed: false, iterations, refineNotes: [{ device: 'both', criterion: 'operator:zeroKnowledgeReader', score: 0, note: 'n', saw: 'n' }],
  inv20: { passed: false, violations }, gateRefusal: `INV-20 unexplained acronym(s): ${violations.join(', ')}`,
});

function setup(quality, content = { v: 0 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-b-refine-'));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ content, quality }));
  return dir;
}
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
function write(dir, quality) { const c = read(dir); c.quality = quality; fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(c)); }

// grades: one function per quality-grade CALL, given the content version on disk → { ok, quality? }
function stubs(dir, grades) {
  const calls = { author: 0, grade: 0 };
  let v = read(dir).content.v;
  return {
    calls,
    deps: {
      authorContent: async () => { calls.author++; v += 1; return { v }; },
      runTool: (name) => {
        if (name !== 'quality-grade') return { ok: true };
        const q = read(dir).quality;
        const n = calls.grade++;
        if ((q?.iterations ?? 0) >= 3) return { ok: true }; // the real cap: no write
        const r = grades[n](read(dir).content.v);
        if (r.quality) write(dir, r.quality);
        return { ok: r.ok, error: r.ok ? null : 'quality grading failed' };
      },
    },
  };
}
const args = (dir) => ({ buildDir: dir, env: {}, model: 'm', apiKey: 'k', opts: {} });

test('#3 restore-best restores the best iteration\'s content AND its own scorecard (no re-grade past the cap)', async () => {
  const dir = setup(graded(1, 85));
  const { deps, calls } = stubs(dir, [() => ({ ok: true, quality: graded(2, 75) }), () => ({ ok: true, quality: graded(3, 70) })]);
  const q = await refineLoop(args(dir), deps);
  const bj = read(dir);
  assert.deepEqual(bj.content, { v: 0 }, 'the best (first) copy is restored');
  assert.deepEqual(bj.quality.scorecard.map((c) => c.meanScore), [85, 85], 'its OWN grade travels with it, not the last pass\'s 70');
  assert.equal(bj.quality.iterations, 3, 'the grade budget spent stays recorded');
  assert.deepEqual(bj.quality.cost, { usd: 3 }, 'cumulative spend is the latest, not the best pass\'s');
  assert.equal(calls.grade, 2, 'restore must not spend (or be refused) another grade');
  assert.deepEqual(q.scorecard.map((c) => c.meanScore), [85, 85]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ruvllm 3.0.0 sequence: an ungraded copy that cleared the pre-checks beats copies the pre-checks refused', async () => {
  // grade 1: INV-20 CC,GPL · pass 1: INV-20 GNU · pass 2: pre-checks ok, vision grader returned malformed JSON
  const dir = setup(refusal(0, ['CC', 'GPL']));
  const outage = { scorecard: [], passed: false, iterations: 0, refineNotes: [], graderUnavailable: true, graderError: 'missing gateA' };
  const { deps, calls } = stubs(dir, [
    () => ({ ok: true, quality: refusal(0, ['GNU']) }),
    () => ({ ok: false, quality: outage }),
    () => ({ ok: true, quality: refusal(0, ['GNU']) }), // what re-grading the pass-1 copy produced live
  ]);
  const q = await refineLoop(args(dir), deps);
  assert.deepEqual(read(dir).content, { v: 2 }, 'the pass-2 copy (acronyms fixed) is kept, not discarded');
  assert.equal(q.graderUnavailable, true);
  assert.equal(q.gateRefusal, undefined, 'the kept copy must not be reported as a pre-check failure');
  assert.equal(calls.grade, 2, 'no extra grade on restore');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a pre-check refusal is never ranked by the PREVIOUS copy\'s kept scorecard', async () => {
  const dir = setup(graded(1, 80));
  const stale = graded(1, 80).scorecard;
  const { deps } = stubs(dir, [() => ({ ok: true, quality: refusal(1, ['GNU'], stale) }), () => ({ ok: true, quality: refusal(1, ['GNU'], stale) })]);
  const q = await refineLoop(args(dir), deps);
  assert.deepEqual(read(dir).content, { v: 0 }, 'the graded copy beats a refused one carrying its old grades');
  assert.equal(q.gateRefusal, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('#9b no refine pass when only design/imagery/diagram weaknesses remain', async () => {
  const q0 = graded(1, 80, { refineNotes: [
    { device: 'mobile(390)', criterion: 'B5', score: 60, saw: 'x' },
    { device: 'mobile(390)', criterion: 'MEAN', score: 80, saw: 'x' },
    { device: 'mobile(390)', criterion: 'INV-18', score: 0, saw: 'x' },
  ] });
  const dir = setup(q0);
  const { deps, calls } = stubs(dir, [() => ({ ok: true, quality: graded(2, 81) }), () => ({ ok: true, quality: graded(3, 82) })]);
  await refineLoop(args(dir), deps);
  assert.equal(calls.author, 0, 'a copy rewrite cannot move B*/INV-18 — do not pay for one');
  assert.equal(calls.grade, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('#9b an operator/A* weakness still gets its refine passes', async () => {
  const dir = setup(graded(1, 80));
  const { deps, calls } = stubs(dir, [() => ({ ok: true, quality: graded(2, 81) }), () => ({ ok: true, quality: graded(3, 82) })]);
  await refineLoop(args(dir), deps);
  assert.equal(calls.author, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('station timing table: exact layout, failed rows marked, total summed', () => {
  assert.deepEqual(stationTimingTable([
    { id: 'clone-repo', ok: true, sec: 1.2 },
    { id: 'quality-grade', ok: false, sec: 30 },
    { id: 'notify', ok: true, sec: 0.05 },
  ]), [
    'station        seconds',
    'clone-repo     1.2',
    'quality-grade  30.0  (failed)',
    'notify         0.1',
    'total          31.3',
  ]);
  assert.deepEqual(stationTimingTable([]), ['station  seconds', 'total    0.0']);
});

test('receipt: unpriced images print UNPRICED, never $0.0000', () => {
  assert.equal(formatImagesCost({ usd: null, images: 3 }), 'images UNPRICED (3)');
  assert.equal(formatImagesCost({ usd: 0.12, images: 3 }), 'images $0.1200 (3, derived)');
  assert.equal(formatImagesCost({ usd: 0, images: 0 }), 'images $0.0000 (0, derived)');
});
