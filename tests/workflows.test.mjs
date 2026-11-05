// CI posture: every third-party action is pinned to a full commit SHA and every workflow runs Node 22
// (the build workflow holds all the secrets; a movable tag or an EOL runtime there is the weakest link).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.yml'));

test('the workflows directory is not empty', () => assert.ok(files.length >= 3));

for (const f of files) {
  const text = fs.readFileSync(path.join(DIR, f), 'utf8');
  test(`${f}: every external action is pinned to a 40-hex SHA`, () => {
    const uses = [...text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]).filter((u) => !u.startsWith('./'));
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${f}: ${u}`);
  });
  test(`${f}: Node runtime is 22`, () => {
    for (const m of text.matchAll(/node-version:\s*"?([\d.x]+)"?/g)) assert.equal(m[1], '22', f);
  });
}
