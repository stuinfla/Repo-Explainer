// ask-kb result count: `k` (what the CLI and the MCP server both pass) must size the result set.
// Before the fix searchKb sized it from `n || 5`, so `ask-kb <store> "q" 10` and MCP `k:10` returned 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultCount, formatDocument } from '../kb/ask-kb.mjs';

test('k sets the number of results (the CLI/MCP argument)', () => {
  assert.equal(resultCount({ k: 10 }), 10);
  assert.equal(resultCount({ k: 1 }), 1);
});

test('the default is 6; the floor is 1; there is no second `n` knob (k alone sizes the set)', () => {
  assert.equal(resultCount({ n: 3, k: 10 }), 10);
  assert.equal(resultCount({}), 6);
  assert.equal(resultCount({ k: 0 }), 1);
});

test('the MCP text carries the ADR status tag and the design-intent warning (adrStatus used to be CLI-only)', () => {
  const r = {
    path: 'docs/adr/0007.md', title: 'ADR 7', kind: 'adr', bestDistance: 0.4321, fullText: 'Status: Proposed\nbody', chunksJoined: 2, truncated: false,
    statusLabel: 'ADR STATUS: Proposed — design intent, NOT confirmed shipped', label: null,
    designIntentWarning: '⚠ This is design intent (ADR status: Proposed); no implementing source was retrieved',
  };
  const text = formatDocument(r, 0);
  assert.match(text, /^#1  \(distance 0\.4321\)  kind=adr  \[ADR STATUS: Proposed — design intent, NOT confirmed shipped\]\n/);
  assert.match(text, /\n⚠ This is design intent \(ADR status: Proposed\)/);
  assert.match(text, /----- full document \(21 chars, 2 chunk\(s\)\) -----\nStatus: Proposed\nbody\n$/);
  const plain = formatDocument({ ...r, statusLabel: null, designIntentWarning: undefined, kind: 'source' }, 1);
  assert.doesNotMatch(plain, /ADR STATUS|design intent/);
  assert.match(plain, /^#2  \(distance 0\.4321\)  kind=source\n/);
});
