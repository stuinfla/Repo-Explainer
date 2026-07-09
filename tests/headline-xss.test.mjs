// tests/headline-xss.test.mjs — coverage for the confirmed bug #1 in memory test-coverage-gap-2026-07-09:
// tools/assemble-page.mjs:443 injects hero.headlineHtml straight into <h1> with zero escaping — the one
// escape hatch in an otherwise carefully-escaping renderer. The template-leak guard (assemble-page.mjs
// ~L646) does not catch it either: it only greps for `${`/`{{`/etc, not markup, so it gives a false
// sense of safety here. Builds a full minimal-but-real fixture (assemble-page.mjs's main() requires the
// entire content.sections/visuals/brand/kb schema — placeholder asset *files* are enough since
// copyAsset() only checks existence and copies bytes, never validates image content).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function xssFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xss-build-'));
  const write = (name, body) => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };
  const heroFile = write('hero.png', 'not-really-a-png');
  const archFile = write('arch.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const cardFile = write('card.png', 'not-really-a-png');
  const favFile = write('favicon-32.png', 'not-really-a-png');
  const primerFile = write('primer.md', '# primer');

  const buildJson = {
    repo: { slug: 'xss-test', owner: 'acme', name: 'widget', url: 'https://github.com/acme/widget' },
    concept: { tagline: 'does things', metaphor: 'a widget', palette: { accent: '#336699' } },
    content: {
      sections: {
        hero: { headlineHtml: '<img src=x onerror="window.__XSS_FIRED=1">', lede: 'a safe lede' },
        problem: { title: 'The problem' },
        whatItIs: { title: 'What it is' },
        insight: { title: 'The insight', oh: 'Oh!' },
        howItWorks: { title: 'How it works' },
        useCases: { title: 'Use cases', cases: [{ title: 'Case one' }] },
        getStarted: { title: 'Get started', steps: ['clone it'] },
        pack: { title: 'The pack' },
      },
    },
    visuals: {
      hero: { file: heroFile },
      architectureDiagram: { svgPath: archFile, altText: 'architecture' },
    },
    brand: {
      socialCard: { file: cardFile },
      favicon: { set: [favFile] },
    },
    kb: { primerPath: primerFile },
  };
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(buildJson, null, 2));
  return dir;
}

test(
  'SECURITY BUG — hero.headlineHtml is injected into <h1> completely unescaped (XSS)',
  { skip: 'confirmed bug, tools/assemble-page.mjs:443 — the one un-escaped field in the renderer; unskip once headlineHtml is sanitized (or the field is removed and headline goes through inline()/esc() unconditionally)' },
  () => {
    const dir = xssFixture();
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'assemble-page.mjs'), dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, `fixture must render cleanly (got exit ${r.status}: ${r.stdout} ${r.stderr})`);
    const html = fs.readFileSync(path.join(dir, 'site', 'index.html'), 'utf8');
    assert.doesNotMatch(html, /onerror="window\.__XSS_FIRED/,
      'an event-handler attribute authored into content must never reach the rendered page verbatim');
  }
);
