// .ascii-to-svg-manifest.json must describe the README as it is now: each tracked diagram's ASCII source and SVG
// hash to what the manifest says, so a stale SVG (or a stale manifest) cannot sit unnoticed.
// Re-sync after editing the README ASCII or an SVG: recompute the two hashes per entry (ascii-to-svg skill).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
const norm = (c) => c.split('\n').map((l) => l.trimEnd()).join('\n').trim();
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.ascii-to-svg-manifest.json'), 'utf8'));

for (const d of manifest.diagrams) {
  test(`manifest entry "${d.id}" matches its README ASCII block and its SVG`, () => {
    const lines = fs.readFileSync(path.join(ROOT, d.sourceFile), 'utf8').split('\n');
    const img = lines.findIndex((l) => l.includes(`](${d.svgFile})`));
    assert.ok(img >= 0, `${d.sourceFile} no longer embeds ${d.svgFile}`);
    assert.equal(img + 1, d.sourceLine, 'sourceLine');
    let i = img; while (i < lines.length && !/^```\s*$/.test(lines[i])) i++;
    let j = i + 1; while (j < lines.length && !/^```\s*$/.test(lines[j])) j++;
    assert.equal(sha(norm(lines.slice(i + 1, j).join('\n'))), d.asciiHash, 'ASCII source changed: regenerate the SVG, then re-sync the manifest');
    assert.equal(sha(fs.readFileSync(path.join(ROOT, d.svgFile))), d.svgHash, 'SVG changed: re-sync the manifest');
  });
}
