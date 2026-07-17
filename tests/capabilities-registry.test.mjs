// tests/capabilities-registry.test.mjs — INV-24/INV-25 made mechanical (ADR-0009 §1).
// The QA review of ADR-0009 (2026-07-17) flagged that "verified ⇒ receipts" was labeled an
// enforced invariant while actually being a human discipline. This test is the enforcement:
// a promotion without receipts, a verified entry whose tool doesn't exist, or a status
// outside the lifecycle enum now fails the suite — it cannot land through a green build.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const reg = JSON.parse(fs.readFileSync(new URL('../capabilities.json', import.meta.url), 'utf8'));

const STATUSES = new Set(['specified', 'built', 'verified']);

test('registry shape: capabilities is a non-empty array with unique ids', () => {
  assert.ok(Array.isArray(reg.capabilities) && reg.capabilities.length > 0);
  const ids = reg.capabilities.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length, `duplicate capability ids: ${ids}`);
});

test('INV-24: every capability has id, title, and a status in the lifecycle enum', () => {
  for (const c of reg.capabilities) {
    assert.ok(c.id && typeof c.id === 'string', 'capability missing id');
    assert.ok(c.title && typeof c.title === 'string', `${c.id}: missing title`);
    assert.ok(STATUSES.has(c.status), `${c.id}: status "${c.status}" not in specified|built|verified`);
  }
});

test('INV-25: verified ⇒ receipts + verifiedAt present, entry names a real tool', () => {
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

test('INV-25 corollary: entry present iff built or verified; unverified name a verification protocol', () => {
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
