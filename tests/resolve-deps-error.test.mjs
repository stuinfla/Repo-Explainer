// loadTransformers must report WHY the import failed, not just that resolution did.
//
// 2026-09-17: the release workflow installs with `npm ci --ignore-scripts`, which skips the install
// script of the nested `sharp` that @xenova/transformers carries. The package WAS on disk; importing
// it threw "Something went wrong installing the sharp module". The resolver swallowed that and said
// "Cannot resolve '@xenova/transformers'. Run `npm i`" — a confident, wrong diagnosis that cost three
// months of failed releases, because the one useful fact was thrown away by a bare `catch {}`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'kb', 'resolve-deps.mjs');

test('an installed-but-broken @xenova/transformers reports the real import error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-resolve-'));
  try {
    // resolve-deps roots its require() at its OWN file, so a copy beside a fake node_modules sees that tree.
    fs.mkdirSync(path.join(root, 'kb'));
    fs.copyFileSync(SRC, path.join(root, 'kb', 'resolve-deps.mjs'));
    const pkg = path.join(root, 'node_modules', '@xenova', 'transformers');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@xenova/transformers', version: '0.0.0', main: 'index.js' }));
    fs.writeFileSync(path.join(pkg, 'index.js'), "throw new Error('Something went wrong installing the \"sharp\" module');\n");

    const { loadTransformers } = await import(pathToFileURL(path.join(root, 'kb', 'resolve-deps.mjs')).href);
    await assert.rejects(() => loadTransformers(), (err) => {
      assert.match(err.message, /Cannot resolve '@xenova\/transformers'/, 'the existing headline stays');
      assert.match(err.message, /sharp/, 'the REAL cause must reach the reader, not be swallowed');
      return true;
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a genuinely absent package still gets the plain "run npm i" message', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-resolve-'));
  try {
    fs.mkdirSync(path.join(root, 'kb'));
    fs.copyFileSync(SRC, path.join(root, 'kb', 'resolve-deps.mjs'));
    const { loadTransformers } = await import(pathToFileURL(path.join(root, 'kb', 'resolve-deps.mjs')).href);
    await assert.rejects(() => loadTransformers(), (err) => {
      assert.match(err.message, /Run `npm i`/);
      assert.doesNotMatch(err.message, /importing it failed/, 'no phantom cause when nothing was installed');
      return true;
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
