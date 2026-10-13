// Owner rule (2026-10-13): anything that names a link must BE a link, and an external link opens in a
// new tab. The source repo's address in the page's top banner was plain <code> text on every build —
// "super easy fix ... you should be making in every standard that you build".
// This builds a real page through assemble-page and audits the output, so any future surface that
// prints a URL without linking it (or links out without target=_blank rel=noopener) fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'assemble-page.mjs');

function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-links-'));
  const assets = path.join(dir, 'assets'); fs.mkdirSync(assets, { recursive: true });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
  for (const f of ['hero.png', 'card.png', 'favicon-32.png', 'problem.png']) fs.writeFileSync(path.join(assets, f), png);
  fs.writeFileSync(path.join(assets, 'arch.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>a</title><desc>d</desc><rect width="4" height="4"/></svg>');
  const ctx = {
    repo: { owner: 'o', name: 'r', slug: 'r', url: 'https://github.com/o/r' },
    concept: { palette: { accent: '#4be3c8' }, metaphor: 'm', tagline: 't' },
    kb: { primerPath: path.join(dir, 'primer.md') },
    visuals: {
      hero: { file: path.join(assets, 'hero.png'), altText: 'h' },
      sections: [{ id: 'problem', role: 'problem illustration', file: path.join(assets, 'problem.png'), alt: 'p' }],
      architectureDiagram: { svgPath: path.join(assets, 'arch.svg'), altText: 'arch' },
    },
    brand: { socialCard: { file: path.join(assets, 'card.png') }, favicon: { set: [path.join(assets, 'favicon-32.png')] } },
    content: { sections: {
      hero: { headline: 'H', lede: 'L' }, problem: { title: 'P', lead: 'l', paragraphs: ['p'] },
      whatItIs: { title: 'W', lead: 'l', paragraphs: ['p'] }, insight: { title: 'I', oh: 'oh', lead: 'l', paragraphs: ['p'] },
      howItWorks: { title: 'HW', paragraphs: ['p'] }, useCases: { title: 'U', cases: [{ title: 'c', paragraphs: ['p'] }] },
      getStarted: { title: 'G', install: 'npm i', steps: [{ strong: 's', text: 't' }] },
      pack: { title: 'K', intro: 'i', downloadLabel: 'd' },
    } },
  };
  fs.writeFileSync(path.join(dir, 'primer.md'), '# primer\n');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(ctx, null, 2));
  execFileSync(process.execPath, [TOOL, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  const html = fs.readFileSync(path.join(dir, 'site', 'index.html'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return html;
}

const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<head[\s\S]*?<\/head>/i, '');

test('every external anchor opens in a new tab with rel=noopener', () => {
  const html = build();
  const anchors = [...html.matchAll(/<a\b[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*>/gi)];
  assert.ok(anchors.length > 0, 'the page must contain external links for this audit to mean anything');
  const bad = anchors.filter((m) => !/target="_blank"/.test(m[0]) || !/rel="[^"]*noopener/.test(m[0])).map((m) => m[1]);
  assert.deepEqual(bad, [], `external links missing target=_blank / rel=noopener: ${bad.join(', ')}`);
});

test('no URL-looking text appears outside a link', () => {
  const body = strip(build()).replace(/<a\b[\s\S]*?<\/a>/gi, ' ');   // drop everything that IS a link
  const text = body.replace(/<[^>]+>/g, ' ');
  const hits = [...text.matchAll(/\bhttps?:\/\/[^\s<>"')]+|\b(?:[a-z0-9-]+\.)+(?:com|io|ai|app|dev|org|net)\/[^\s<>"')]*/gi)].map((m) => m[0]);
  assert.deepEqual(hits, [], `URL text that is not a hot link: ${hits.join(', ')}`);
});

test('the top banner shows the source repo as a clickable link to it', () => {
  const html = build();
  const banner = html.match(/<p class="prov-live">[\s\S]*?<\/p>/)[0];
  assert.match(banner, /<a href="https:\/\/github\.com\/o\/r"[^>]*target="_blank"[^>]*>/, 'the source address must be a link to the repo');
});
