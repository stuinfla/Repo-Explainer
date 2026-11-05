// tests/review-p8-tools-contract.test.mjs — skills/explainmyrepo/TOOLS-CONTRACT.md is GENERATED from each tool's own
// header; the hosted agent reads it instead of tool source. This fails when a header and the file disagree, or when a
// tool has no header (so it could not be documented).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, headerOf, toolFiles, OUT_REL } from '../scripts/gen-tools-contract.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const committed = () => fs.readFileSync(path.join(REPO, OUT_REL), 'utf8');

test('the committed TOOLS-CONTRACT.md equals what the generator produces from the tool headers', () => {
  assert.equal(committed(), generate(REPO), `${OUT_REL} is stale: run node scripts/gen-tools-contract.mjs`);
});

test('every tools/*.mjs has a header and appears exactly once, and nothing else is listed', () => {
  const doc = committed();
  const listed = [...doc.matchAll(/^## tools\/(\S+\.mjs)$/gm)].map((m) => m[1]);
  const files = toolFiles(REPO);
  assert.deepEqual([...listed].sort(), files, 'the listed tools are exactly the tools on disk');
  assert.equal(new Set(listed).size, listed.length, 'no tool listed twice');
  for (const f of files) {
    assert.ok(headerOf(fs.readFileSync(path.join(REPO, 'tools', f), 'utf8')).length > 40, `tools/${f} has a real header`);
  }
});

test('the generator is deterministic, and it notices an edited header (the guard can fail)', () => {
  assert.equal(generate(REPO), generate(REPO));
  // A scratch copy of tools/ with ONE header changed must no longer equal the committed file.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p8-tc-'));
  fs.cpSync(path.join(REPO, 'tools'), path.join(scratch, 'tools'), { recursive: true, dereference: false });
  const f = path.join(scratch, 'tools', 'notify.mjs');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('// notify.mjs', '// notify.mjs (edited)'));
  assert.notEqual(generate(scratch), committed());
  // and a tool with no header is a loud error, not a silent omission
  fs.writeFileSync(path.join(scratch, 'tools', 'zz-bare.mjs'), 'export const x = 1;\n');
  assert.throws(() => generate(scratch), /no leading \/\/ header/);
});
