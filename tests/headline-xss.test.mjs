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
      // the page image contract now requires at least one generated problem/use-case image
      sections: [{ id: 'problem', file: heroFile, alt: 'the problem' }],
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

// JSON-LD block (SEO): content from the repo must never break out of its <script> tag, and the block must not
// assert facts we cannot know for a repo we do not own (price, platform).
test('JSON-LD: hostile repo name cannot close the script tag; no invented price or platform; valid SoftwareApplication', () => {
  const dir = xssFixture();
  const bj = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
  const hostile = 'x</script><script>window.__LD_XSS=1</script>';
  bj.repo.name = hostile;
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(bj));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'assemble-page.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `fixture must render cleanly (got exit ${r.status}: ${r.stdout} ${r.stderr})`);
  const html = fs.readFileSync(path.join(dir, 'site', 'index.html'), 'utf8');
  const open = html.indexOf('<script type="application/ld+json">');
  assert.ok(open >= 0, 'page carries a JSON-LD block');
  const close = html.indexOf('</script>', open);
  const body = html.slice(open + '<script type="application/ld+json">'.length, close);
  assert.doesNotMatch(body, /<script|<\/script/i, 'nothing inside the block can open or close a script tag');
  const ld = JSON.parse(body);
  assert.equal(ld['@type'], 'SoftwareApplication');
  assert.ok(JSON.stringify(ld).includes(hostile), 'the hostile name round-trips as data, unchanged');
  assert.equal(ld.offers, undefined, 'no invented price');
  assert.equal(ld.operatingSystem, undefined, 'no invented platform');
  assert.equal(ld.codeRepository, undefined, 'codeRepository is not a SoftwareApplication property');
  assert.ok(ld.sameAs, 'the repo link is carried as sameAs');
});
