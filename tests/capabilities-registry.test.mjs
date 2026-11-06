// tests/capabilities-registry.test.mjs — INV-29/INV-30 made mechanical (ADR-0009 §1).
// A promotion without receipts, a verified entry whose tool is missing, or a status outside the lifecycle
// enum fails the suite.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: pathname percent-encodes (a checkout under a directory
// with a space yields ".../Ruv%20Explainer/..." and every existsSync goes false).
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const reg = JSON.parse(fs.readFileSync(new URL('../capabilities.json', import.meta.url), 'utf8'));

const STATUSES = new Set(['specified', 'built', 'verified']);

test('registry shape: capabilities is a non-empty array with unique ids', () => {
  assert.ok(Array.isArray(reg.capabilities) && reg.capabilities.length > 0);
  const ids = reg.capabilities.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length, `duplicate capability ids: ${ids}`);
});

test('INV-29: every capability has id, title, and a status in the lifecycle enum', () => {
  for (const c of reg.capabilities) {
    assert.ok(c.id && typeof c.id === 'string', 'capability missing id');
    assert.ok(c.title && typeof c.title === 'string', `${c.id}: missing title`);
    assert.ok(STATUSES.has(c.status), `${c.id}: status "${c.status}" not in specified|built|verified`);
  }
});

test('INV-30: verified ⇒ receipts + verifiedAt present, entry names a real tool', () => {
  for (const c of reg.capabilities.filter((c) => c.status === 'verified')) {
    assert.ok(c.verifiedAt, `${c.id}: verified without verifiedAt`);
    assert.ok(c.receipts && typeof c.receipts === 'object', `${c.id}: verified without receipts`);
    assert.ok(c.receipts.output, `${c.id}: receipts missing output`);
    assert.ok(Number.isFinite(c.receipts.costUsd), `${c.id}: receipts missing costUsd`);
    assert.ok(c.receipts.proof, `${c.id}: receipts missing proof`);
    assert.ok(c.entry, `${c.id}: verified without an entry tool`);
    assert.ok(fs.existsSync(ROOT + c.entry), `${c.id}: entry "${c.entry}" does not exist`);
  }
});

test('INV-30 corollary: entry present iff built or verified; unverified name a verification protocol', () => {
  for (const c of reg.capabilities) {
    if (c.status === 'specified') {
      assert.ok(!c.entry, `${c.id}: specified must not carry an entry (nothing is built)`);
      assert.ok(!c.receipts, `${c.id}: specified must not carry receipts`);
      assert.ok(c.verification, `${c.id}: specified must name its verification protocol`);
    }
    if (c.status === 'built') {
      assert.ok(c.entry && fs.existsSync(ROOT + c.entry), `${c.id}: built requires an existing entry`);
      assert.ok(c.verification, `${c.id}: built must name its verification protocol`);
    }
  }
});
