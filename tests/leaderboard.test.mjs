// tests/leaderboard.test.mjs — the admin explainer leaderboard (top N by live people, per window).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readLeaderboard } = require('../landing/netlify/lib/leaderboard.js');

// A fake blob store: list() pages 2 keys at a time so cursor handling is exercised.
function fakeStore(data) {
  const keys = Object.keys(data);
  return {
    async list({ prefix, cursor }) {
      const all = keys.filter((k) => k.startsWith(prefix));
      const start = cursor ? Number(cursor) : 0;
      const slice = all.slice(start, start + 2);
      return { blobs: slice.map((key) => ({ key })), cursor: start + 2 < all.length ? String(start + 2) : undefined };
    },
    async get(k) { return data[k] ?? null; },
  };
}

const NOW = new Date('2026-11-23T15:00:00Z');
const data = {
  'daily:2026-10-01': { views: 9, sites: { oldie: { views: 40, newVisitors: 30 } } },   // all-time only
  'daily:2026-11-05': { views: 3, sites: { alpha: { views: 10, newVisitors: 5 } } },     // month, not week
  'daily:2026-11-20': { views: 3, sites: { alpha: { views: 4, newVisitors: 2 }, beta: { views: 9, newVisitors: 2 } } }, // week
  'daily:2026-11-23': { views: 5, sites: { beta: { views: 3, newVisitors: 1 }, gamma: { views: 1, newVisitors: 0 } } }, // today
  'daily:2026-11-22': { views: 2 },                                                       // legacy day, no `sites`
};

test('windows: today / 7 days / 30 days / all time pick the right days', async () => {
  const lb = await readLeaderboard(fakeStore(data), 15, NOW);
  assert.deepEqual(lb.day.map((r) => r.slug), ['beta', 'gamma']);                 // only 11-23
  assert.deepEqual(lb.week.map((r) => [r.slug, r.people, r.views]), [['beta', 3, 12], ['alpha', 2, 4], ['gamma', 0, 1]]);
  assert.deepEqual(lb.month.map((r) => [r.slug, r.people]), [['alpha', 7], ['beta', 3], ['gamma', 0]]);
  assert.deepEqual(lb.all.map((r) => [r.slug, r.people]), [['oldie', 30], ['alpha', 7], ['beta', 3], ['gamma', 0]]);
  assert.equal(lb.since, '2026-10-01');
});

test('ranking: people first, then views; list is capped at topN', async () => {
  const many = { 'daily:2026-11-23': { sites: {} } };
  for (let i = 0; i < 20; i++) many['daily:2026-11-23'].sites['s' + String(i).padStart(2, '0')] = { views: i, newVisitors: i };
  const lb = await readLeaderboard(fakeStore(many), 15, NOW);
  assert.equal(lb.day.length, 15);
  assert.equal(lb.day[0].slug, 's19');
  assert.equal(lb.day[14].slug, 's05');
});

test('no beacon data yet: empty lists and since=null, not an error', async () => {
  const lb = await readLeaderboard(fakeStore({ 'daily:2026-11-22': { views: 2 } }), 15, NOW);
  assert.deepEqual(lb.all, []);
  assert.equal(lb.since, null);
  assert.equal(lb.unavailable, undefined);
});

test('a store failure degrades to {unavailable}, never throws', async () => {
  const lb = await readLeaderboard({ list: async () => { throw new Error('boom'); } }, 15, NOW);
  assert.equal(lb.unavailable, 'boom');
});

test('with a universe: every live explainer is listed (zero-filled), strays are ignored, counts reported', async () => {
  const lb = await readLeaderboard(fakeStore(data), 15, NOW, ['alpha', 'beta', 'quiet-one', 'quiet-two']);
  // 'gamma' and 'oldie' are not live explainers -> ignored; quiet ones appear at 0, alphabetical
  assert.deepEqual(lb.week.map((r) => [r.slug, r.people]), [['beta', 3], ['alpha', 2], ['quiet-one', 0], ['quiet-two', 0]]);
  assert.equal(lb.weekTotal, 4);
  assert.equal(lb.weekActive, 2);
  assert.equal(lb.day.find((r) => r.slug === 'quiet-one').people, 0);
  assert.equal(lb.allActive, 2);
});
