// The tool has TWO doors that must teach the same standard: the local CLI runs src/brain.mjs, and the
// hosted website drives an agent from skills/explainmyrepo/SKILL.md (bin/agentic-runner.mjs spawns
// `claude -p` against it). v0.8.0 put the fifteen-year-old reader, the reading gate, the no-props image
// rule and the lead-with-why law into brain.mjs ONLY — so every hosted build would have kept the old
// rules while the shared INV-24 gate silently failed them. It was found by reading the published
// package, not by a test. This is that test: each standard must be stated in BOTH places.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DOORS = { 'local door (src/brain.mjs)': read('src/brain.mjs'), 'hosted door (skills/explainmyrepo/SKILL.md)': read('skills/explainmyrepo/SKILL.md') };

const STANDARDS = [
  ['the reader is a curious fifteen-year-old (ADR-0006 v1.2.0)', /fifteen-year-old/i],
  ['INV-24 reading-level gate', /INV-24/],
  ['no rooms, props or people in any raster (ADR-0008 v1.1.0)', /no rooms, no props/i],
  ['lead with why it exists, not what it technically is', /lead with why/i],
];

for (const [standard, re] of STANDARDS) {
  for (const [door, text] of Object.entries(DOORS)) {
    test(`${door} states: ${standard}`, () => {
      assert.match(text, re, `the ${door} does not carry this standard — the two doors have drifted apart`);
    });
  }
}
