// tests/review-p4b-receipt-verdict.test.mjs — the below-bar verdict uses the grader's structural-presence
// check (not "any device's legibility passed"), and the receipt never prints an unpriced grade as $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { belowBarVerdict } from '../src/refine.mjs';
import { formatGradingCost, printReceipt } from '../src/receipt.mjs';

const dev = (inv18) => ({ device: 'd', meanScore: 70, inv18 });
const structural = { passed: false, architecturePresent: true, architectureVisible: true };

test('verdict: diagrams drawn and visible on EVERY device deliver, even when legibility failed (structure is what is held on)', () => {
  const v = belowBarVerdict({ scorecard: [dev(structural), dev(structural)] });
  assert.equal(v.action, 'deliver');
});

test('verdict: one device where the architecture diagram is not visible holds, even if the other device passed INV-18', () => {
  const ok = { passed: true, architecturePresent: true, architectureVisible: true };
  const v = belowBarVerdict({ scorecard: [dev(ok), dev({ passed: false, architecturePresent: true, architectureVisible: false })] });
  assert.equal(v.action, 'hold');
  assert.match(v.why, /diagrams did not render/);
});

test('verdict: a scorecard with no structural fields holds (an old `.passed`-only shape no longer counts)', () => {
  assert.equal(belowBarVerdict({ scorecard: [dev({ passed: true })] }).action, 'hold');
});

test('formatGradingCost: unknown price is UNPRICED, a known one keeps its dollars', () => {
  const unknown = formatGradingCost({ usd: null, calls: 4 });
  assert.match(unknown, /UNPRICED/);
  assert.ok(!/\$0/.test(unknown), unknown);
  assert.equal(formatGradingCost({ usd: 0.1234, calls: 4 }), 'grading $0.1234 (4 calls, derived)');
  assert.equal(formatGradingCost({ usd: 0, calls: 0 }), 'grading $0.0000 (0 calls, derived)', 'a real zero is still a zero');
});

test('printReceipt: an UNPRICED grade and UNPRICED images are flagged in the Cost line and never counted as $0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4b-receipt-'));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ visuals: { cost: { usd: null, images: 3 } }, quality: { cost: { usd: null, calls: 2, basis: 'UNPRICED' } } }));
  const lines = [];
  const orig = process.stderr.write;
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  try { printReceipt(dir, Date.now() - 1000); } finally { process.stderr.write = orig; }
  const cost = lines.join('').split('\n').find((l) => /Cost:/.test(l));
  assert.ok(cost, 'a Cost line was printed');
  assert.match(cost, /grading UNPRICED/);
  assert.match(cost, /images UNPRICED/);
  assert.match(cost, /unpriced images \+ grading/);
  assert.ok(!/grading \$0\.0000/.test(cost), cost);
  const slot = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).cost;
  assert.equal(slot.grading.usd, null, 'the stored receipt keeps null, not 0');
});
