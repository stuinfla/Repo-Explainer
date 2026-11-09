import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildInsights, classify, parseRepo, clean, OWNER_TAG } = require('../landing/netlify/lib/admin-insights.js');

const NOW = '2026-11-09T20:00:00Z';
const b = (o) => ({ repo: 'a/b', status: 'done', createdAt: '2026-11-08T10:00:00Z', buildId: 'id-' + Math.random(), grades: { overall: 90 }, ownerTest: false, ...o });
const base = (o = {}) => buildInsights({ builds: [], ratings: [], traffic: [], doors: {}, ledger: {}, ownerEmails: ['me@x.com'], now: NOW, ...o });

test('parseRepo strips the owner-test tag and flags it', () => {
  assert.deepEqual(parseRepo('explainmyrepo build: a/b' + OWNER_TAG), { repo: 'a/b', ownerTest: true });
  assert.deepEqual(parseRepo('explainmyrepo build: a/b'), { repo: 'a/b', ownerTest: false });
});

test('classify: verdict wins, numeric fallback thresholds 85/55, junk is null', () => {
  assert.equal(classify({ verdict: 'missed', score: 99 }), 'missed');
  assert.equal(classify({ score: 85 }), 'nailed');
  assert.equal(classify({ score: 84 }), 'close');
  assert.equal(classify({ score: 54 }), 'missed');
  assert.equal(classify({ score: null }), null);
  assert.equal(classify({ verdict: 'bogus', score: NaN }), null);
});

test('owner test builds are kept out of funnel and real-build counts', () => {
  const r = base({ builds: [b({}), b({ ownerTest: true }), b({ ownerTest: true })] });
  assert.equal(r.realBuilds, 1);
  assert.equal(r.funnel.find((f) => f.key === 'built').n, 1);
  assert.equal(r.owner.markedTestBuilds, 2);
});

test('unmarked owner builds are estimated from the ledger, never guessed per-build', () => {
  const r = base({ builds: [b({ ownerTest: true })], ledger: { 'ME@x.com': { count: 11 }, 'other@y.com': { count: 3 } } });
  assert.equal(r.owner.ledgerBuilds, 11);
  assert.equal(r.owner.unmarkedEstimate, 10);
});

test('funnel respects the 14-day window and sums views and accepted door tallies', () => {
  const r = base({
    traffic: [{ date: '2026-11-09', views: 40 }, { date: '2026-11-08', views: 10 }],
    doors: { '2026-11-09': { accepted: 3 }, '2026-10-01': { accepted: 99 } },
    builds: [b({}), b({ createdAt: '2026-09-01T00:00:00Z' }), b({ status: 'failed' })],
  });
  const f = Object.fromEntries(r.funnel.map((x) => [x.key, x.n]));
  assert.deepEqual(f, { views: 50, accepted: 3, built: 1, rated: 0 });
});

test('our score vs theirs: matches by build id, then repo; one-tap verdict maps to a number', () => {
  const bd = b({ buildId: 'B1', repo: 'o/r', grades: { overall: 96 } });
  const r = base({ builds: [bd], ratings: [{ repo: 'o/r', buildId: 'B1', verdict: 'missed', score: null, thoughts: 'diagram was wrong', at: '2026-11-09T01:00:00Z' }] });
  const c = r.ratings.compared[0];
  assert.equal(c.ours, 96); assert.equal(c.theirs, 35); assert.equal(c.matched, true);
  assert.equal(r.ratings.ourMean, 96); assert.equal(r.ratings.theirMean, 35); assert.equal(r.ratings.gap, 61);
});

test('operator selftest ratings and unclassifiable rows never count as reader evidence', () => {
  const r = base({ ratings: [
    { repo: 'selftest/loop-check', verdict: 'missed', thoughts: 'x', at: 'a' },
    { repo: 'a/b', score: null, verdict: null, thoughts: 'no signal', at: 'b' },
    { repo: 'a/b', verdict: 'nailed', thoughts: 'great', at: 'c' },
  ] });
  assert.equal(r.ratings.total, 1);
  assert.deepEqual(r.ratings.tally, { nailed: 1, close: 0, missed: 0 });
});

test('learned lessons: negatives first (max 8), positives (max 3), only with comments, hostile text neutralised', () => {
  const ratings = [];
  for (let i = 0; i < 12; i++) ratings.push({ repo: 'r/' + i, verdict: 'close', thoughts: 'c' + i, at: '2026-11-0' + (1 + (i % 9)) });
  for (let i = 0; i < 5; i++) ratings.push({ repo: 'p/' + i, verdict: 'nailed', thoughts: 'p' + i, at: '2026-11-0' + (1 + i) });
  ratings.push({ repo: 'h/x', verdict: 'missed', thoughts: '<img src=x onerror=alert(1)> ```rm -rf``` https://evil.test/a ' + 'z'.repeat(400), at: '2026-11-09' });
  ratings.push({ repo: 'n/c', verdict: 'missed', thoughts: '', at: '2026-11-09' });
  const r = base({ ratings });
  assert.equal(r.learned.fix.length, 8);
  assert.equal(r.learned.keep.length, 3);
  const hostile = r.learned.fix.find((l) => l.repo === 'h/x');
  assert.ok(hostile, 'newest negative is kept');
  assert.ok(hostile.text.length <= 260);
  assert.doesNotMatch(hostile.text, /<|```|https?:/);
  assert.ok(!r.learned.fix.some((l) => l.repo === 'n/c'), 'a rating without a comment is not a lesson');
});

test('clean() caps, strips markup, urls and fences', () => {
  assert.equal(clean('a <b>b</b> https://x.y/z ```c``` d'), 'a b [link] d');
  assert.equal(clean('x'.repeat(999)).length, 260);
  assert.equal(clean(null), '');
});

test('summary is plain English and handles the empty state', () => {
  const r = base();
  assert.ok(r.summary.some((l) => /No reader has rated/.test(l)));
  const r2 = base({ builds: [b({})], ratings: [] });
  assert.ok(r2.summary.some((l) => /optional, so low volume is normal/.test(l)));
});

test('summary admits older untagged owner builds instead of claiming everything is real traffic', () => {
  const r = base({ builds: [b({})], ledger: { 'me@x.com': { count: 4 } } });
  assert.match(r.summary[0], /your own older test builds/);
  assert.doesNotMatch(base({ builds: [b({})] }).summary[0], /older test builds/);
});

test('source shape: build.js tags owner gists and the admin consumes insights + fixed traffic keys', () => {
  const build = fs.readFileSync(new URL('../landing/netlify/functions/build.js', import.meta.url), 'utf8');
  const stats = fs.readFileSync(new URL('../landing/netlify/functions/admin-stats.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../landing/admin.html', import.meta.url), 'utf8');
  assert.match(build, /\[owner-test\]/);
  assert.match(stats, /buildInsights\(/);
  assert.match(stats, /verdict: s\.data\?\.verdict/);
  assert.match(html, /d\.traffic\.repoViews14d/);
  assert.doesNotMatch(html, /d\.traffic\.views14d/);
  assert.match(html, /data-show-test/);
});
