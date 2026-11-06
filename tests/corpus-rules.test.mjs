// A lead source file's doc block must be ingested once. componentLead and docCommentSweep both emit a
// `crate-src` doc block for it; before the fix neither recorded the path, so the same text was embedded twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeContext } from '../kb/chunker.mjs';
import { RULE_IMPLS } from '../kb/corpus-rules.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-corpus-'));
  const pkg = path.join(root, 'packages', 'alpha', 'src');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'index.js'), '/**\n * Alpha parses widgets and nothing else.\n */\nexport const alpha = 1;\n');
  fs.writeFileSync(path.join(pkg, 'other.js'), '/**\n * Other helper that is not a lead file.\n */\nexport const other = 2;\n');
  return root;
}

function run(order) {
  const root = fixture();
  try {
    const ctx = makeContext({ slug: 't', repoDir: root, scopeExclude: [] });
    const rules = { lead: ['componentLead', { roots: ['packages'] }], sweep: ['docCommentSweep', { roots: ['packages'] }] };
    for (const k of order) RULE_IMPLS[rules[k][0]](ctx, rules[k][1]);
    const byPath = {};
    for (const e of ctx.entries) (byPath[e.path] ||= []).push(e);
    return byPath;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const order of [['lead', 'sweep'], ['sweep', 'lead']]) {
  test(`lead file doc block appears exactly once (${order.join(' then ')})`, () => {
    const by = run(order);
    const lead = by[path.join('packages', 'alpha', 'src', 'index.js')];
    assert.equal(lead.length, 1, `index.js emitted ${lead.length} chunks`);
    assert.match(lead[0].text, /parses widgets/);
    // the non-lead file is still covered by the sweep (the dedupe must not swallow it)
    const other = by[path.join('packages', 'alpha', 'src', 'other.js')];
    assert.equal(other.length, 1);
    assert.match(other[0].text, /not a lead file/);
  });
}
