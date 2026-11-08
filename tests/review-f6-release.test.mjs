// review 3.0.1 F6: the 3.0.1 label is true (-v prints it, manifests agree) and --help states the real model defaults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL, AUTHORING_MODEL } from '../src/claude.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'explainmyrepo.mjs');
const json = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

test('version is 3.0.1 in package.json, the lockfile top level, and the -v output', () => {
  assert.equal(json('package.json').version, '3.0.1');
  const lock = json('package-lock.json');
  assert.equal(lock.version, '3.0.1'); assert.equal(lock.packages[''].version, '3.0.1');
  const r = spawnSync(process.execPath, [BIN, '-v'], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), '3.0.1');
});

test('--help states the default model AND the OpenRouter-only fallback, both read from the code that decides them', () => {
  const h = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' }).stdout;
  assert.ok(h.includes(`default: ${DEFAULT_MODEL}`), 'default model named');
  assert.ok(h.includes(AUTHORING_MODEL) && /OPENROUTER_API_KEY/.test(h) && /OpenRouter/.test(h), 'OpenRouter-only fallback named');
  assert.equal(DEFAULT_MODEL, 'claude-sonnet-5-5'); assert.equal(AUTHORING_MODEL, 'z-ai/glm-5.3');
});
