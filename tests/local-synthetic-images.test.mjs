// tests/local-synthetic-images.test.mjs — the offline image engine.
//
// When no cloud image engine is available (no OpenAI/Grok key, or their probes fail), the hero
// and section images are rendered deterministically from the brand palette with sharp — a seeded
// SVG palette-gradient. It is clearly LABELLED local-synthetic and recorded as $0 in the cost
// slot, never a faked "gpt-image" receipt. EXPLAINMYREPO_LOCAL_IMAGES=1 forces it explicitly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'generate-image.mjs');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Source-level pins: the selection rule and the honest cost basis live in generate-image.mjs.
test('local-synthetic — selected as a fallback when no cloud image key is available', () => {
  const src = fs.readFileSync(TOOL, 'utf8');
  assert.match(src, /const useLocal = localFlag \|\| \(!grokOK && !openaiModel\)/,
    'the synthetic lane is the fallback when neither cloud engine is available');
  assert.match(src, /EXPLAINMYREPO_LOCAL_IMAGES/, 'an explicit opt-in flag must force it');
  assert.match(src, /engines\.hero = 'local-synthetic'/);
  assert.match(src, /engines\.section = 'local-synthetic'/);
  assert.match(src, /no external image API used/, 'the cost basis must say it used no cloud API');
});

// Behavioural: force the flag, no cloud keys in env, and confirm real PNGs + a $0 labelled slot.
test('local-synthetic — produces real PNGs and a $0 labelled cost slot with no cloud keys', () => {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synth-'));
  const ctx = {
    repo: { name: 'demo', slug: 'demo' },
    concept: { palette: { primary: '#7c3aed', accent: '#38bdf8', secondary: '#f472b6' } },
    visuals: {
      hero: { id: 'hero', role: 'hero', px: '1536x1024', prompt: 'a calm architectural hero' },
      sections: [
        { id: 'sec1', role: 'section', px: '1024x1024', prompt: 'a data flow section' },
      ],
    },
  };
  fs.writeFileSync(path.join(buildDir, 'build.json'), JSON.stringify(ctx, null, 2));
  const r = spawnSync(process.execPath, [TOOL, buildDir], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPLAINMYREPO_LOCAL_IMAGES: '1',
      OPENAI_API_KEY: '', OPEN_AI_KEY: '', GROK_API_KEY: '', XAI_API_KEY: '',
    },
  });
  assert.equal(r.status, 0, `synthetic generate-image must succeed: ${r.stdout}\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.match(String(out.outputs.engine || ''), /local-synthetic/);
  // Every produced file is a genuine PNG.
  for (const f of out.outputs.files) {
    const buf = fs.readFileSync(f);
    assert.ok(buf.subarray(0, 8).equals(PNG_MAGIC), `${f} must be a real PNG`);
  }
  // Cost slot is honest: $0, and the basis names no cloud API.
  const merged = JSON.parse(fs.readFileSync(path.join(buildDir, 'build.json'), 'utf8'));
  assert.equal(merged.visuals.cost.usd, 0, 'a synthetic render costs $0');
  assert.match(merged.visuals.cost.basis, /no external image API used/);
});
