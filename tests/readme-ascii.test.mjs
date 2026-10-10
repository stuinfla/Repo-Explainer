// tests/readme-ascii.test.mjs — the README rewrite (ADR-0015).
//
// The contract being pinned: the owner's README comes back IDENTICAL plus additions. Their words are
// never changed, an ASCII diagram gets a faithful animated-SVG twin above it, the explainer link sits
// under the title, and re-running is idempotent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findFences, isAsciiDiagram, findAsciiDiagrams, asciiToSvg, stripEnhancements, rewriteReadme,
} from '../src/readme-ascii.mjs';

const BOX = [
  '┌──────────┐     ┌──────────┐',
  '│  client  │ ──▶ │  server  │',
  '└──────────┘     └──────────┘',
].join('\n');

const PLUS = [
  '+--------+      +--------+',
  '| parse  | ---> | render |',
  '+--------+      +--------+',
].join('\n');

const TREE = ['src/', '├── index.js', '├── lib/', '│   └── util.js', '└── README.md'].join('\n');
const SHELL = ['$ npm install foo', '$ foo --help', '> usage: foo [options]'].join('\n');

const README = [
  '# cool-lib',
  '',
  'A library that does one thing well.',
  '',
  '## How it works',
  '',
  '```text',
  BOX,
  '```',
  '',
  '## Layout',
  '',
  '```',
  TREE,
  '```',
  '',
  '## Install',
  '',
  '```bash',
  'npm install cool-lib',
  '```',
  '',
].join('\n');

const OPTS = { liveUrl: 'https://cool-lib-explainer.netlify.app', repoName: 'cool-lib', svgDir: 'docs/explainer' };
const FALLBACK = [
  { alt: 'How cool-lib is put together.', rel: 'docs/explainer/architecture.svg' },
  { alt: 'What happens on a call.', rel: 'docs/explainer/flow.svg' },
];

function xmllintOk(svg) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ra-')), 'x.svg');
  fs.writeFileSync(f, svg);
  try { execFileSync('xmllint', ['--noout', f], { stdio: 'pipe' }); return true; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// ── detection ───────────────────────────────────────────────────────────────────────────────────
test('detect: finds box-drawing and +--+ diagrams', () => {
  assert.equal(isAsciiDiagram('', BOX), true);
  assert.equal(isAsciiDiagram('text', PLUS), true);
});

test('detect: a directory tree is NOT a diagram (it uses box characters too)', () => {
  assert.equal(isAsciiDiagram('', TREE), false);
});

test('detect: shell sessions and real code are NOT diagrams', () => {
  assert.equal(isAsciiDiagram('', SHELL), false);
  assert.equal(isAsciiDiagram('bash', BOX), false, 'a fence tagged with a code language is left alone');
  assert.equal(isAsciiDiagram('js', PLUS), false);
});

test('detect: a two-line snippet or an oversized block is not drawn', () => {
  assert.equal(isAsciiDiagram('', '┌──┐\n└──┘'), false);
  assert.equal(isAsciiDiagram('', Array.from({ length: 80 }, () => '│ row │').join('\n')), false);
});

test('detect: only the diagram in README is found, with correct fence lines', () => {
  const found = findAsciiDiagrams(README);
  assert.equal(found.length, 1);
  assert.equal(README.split('\n')[found[0].open], '```text');
});

test('detect: an unterminated fence does not swallow the rest of the file', () => {
  assert.deepEqual(findFences('# t\n\n```text\nno close\n'), []);
});

// ── conversion ──────────────────────────────────────────────────────────────────────────────────
test('svg: well-formed, script-free, accessible, with the original text', () => {
  const { svg } = asciiToSvg(BOX, { title: 'Diagram 1: client, server' });
  const ok = xmllintOk(svg);
  if (ok !== null) assert.equal(ok, true);
  assert.doesNotMatch(svg, /<script|foreignObject|href="https?:/i);
  assert.match(svg, /<title id="t">Diagram 1: client, server<\/title>/);
  assert.match(svg, />client</);
  assert.match(svg, />server</);
});

test('svg: boxes become strokes and the arrow becomes an animated head', () => {
  const { svg } = asciiToSvg(PLUS, { title: 'x' });
  assert.match(svg, /<path class="line"/);
  assert.match(svg, /class="head"/, 'the > at the end of --- is an arrowhead');
  assert.match(svg, /@media \(prefers-reduced-motion: reduce\)/);
});

test('svg: lossless — every word of the source survives', () => {
  const { svg } = asciiToSvg(PLUS, { title: 'x' });
  for (const w of ['parse', 'render']) assert.match(svg, new RegExp(`>${w}<`));
});

test('svg: markup in a diagram is escaped', () => {
  const { svg } = asciiToSvg('┌────────┐\n│ <b>&</b> │\n└────────┘', { title: 'x' });
  assert.doesNotMatch(svg, /<b>/);
  assert.match(svg, /&lt;b&gt;/);
});

// ── the rewrite ─────────────────────────────────────────────────────────────────────────────────
function isSubsequence(small, big) {
  let i = 0;
  for (const line of big) if (i < small.length && line === small[i]) i++;
  return i === small.length;
}

test('rewrite: ADDITIONS ONLY — every original line survives, in order (the whole point)', () => {
  const { markdown } = rewriteReadme(README, OPTS);
  assert.ok(isSubsequence(README.replace(/\s+$/, '').split('\n'), markdown.split('\n')),
    'the owner\'s README must be an in-order subsequence of the result');
});

test('rewrite: ascii mode — twin SVG goes directly above the original block, which is untouched', () => {
  const r = rewriteReadme(README, OPTS);
  assert.equal(r.mode, 'ascii');
  assert.equal(r.diagrams.length, 1);
  const lines = r.markdown.split('\n');
  const fence = lines.indexOf('```text');
  assert.equal(lines[fence - 1], '', 'blank line keeps the image and the fence as separate Markdown blocks');
  assert.match(lines[fence - 2], /^!\[Diagram 1: .*\]\(docs\/explainer\/diagram-1\.svg\)$/);
  assert.match(lines[fence - 3], /^<!-- explainmyrepo:ascii-1 -->$/);
  assert.ok(r.markdown.includes(BOX), 'original ASCII block still present');
});

test('rewrite: link block sits right under the H1, before any other content', () => {
  const { markdown } = rewriteReadme(README, OPTS);
  const lines = markdown.split('\n');
  const h1 = lines.indexOf('# cool-lib');
  assert.equal(lines[h1 + 1], '');
  assert.equal(lines[h1 + 2], '<!-- explainmyrepo:link:start -->');
  assert.match(markdown, /\(https:\/\/cool-lib-explainer\.netlify\.app\)/);
});

test('rewrite: idempotent — running twice equals running once', () => {
  const once = rewriteReadme(README, OPTS).markdown;
  const twice = rewriteReadme(once, OPTS).markdown;
  assert.equal(twice, once);
});

test('rewrite: strip returns the pristine README', () => {
  const out = rewriteReadme(README, OPTS).markdown;
  assert.equal(stripEnhancements(out), README.replace(/\s+$/, '\n'));
});

test('rewrite: fallback mode (no ASCII) places the generated graphics after the intro, not at the bottom', () => {
  const plain = '# plain\n\nIntro sentence here.\n\n## Install\n\n```bash\nnpm i plain\n```\n';
  const r = rewriteReadme(plain, { ...OPTS, repoName: 'plain', fallback: FALLBACK });
  assert.equal(r.mode, 'fallback');
  const idxBlock = r.markdown.indexOf('<!-- explainmyrepo:start -->');
  assert.ok(idxBlock > r.markdown.indexOf('Intro sentence here.'));
  assert.ok(idxBlock < r.markdown.indexOf('## Install'), 'graphics come before Install, so people see them');
  assert.match(r.markdown, /!\[How cool-lib is put together\.\]\(docs\/explainer\/architecture\.svg\)/);
});

test('rewrite: no ASCII and no fallback graphics → link only, still additions-only', () => {
  const r = rewriteReadme('# x\n\nhello\n', { ...OPTS, repoName: 'x' });
  assert.equal(r.mode, 'link-only');
  assert.ok(isSubsequence(['# x', '', 'hello'], r.markdown.split('\n')));
});

test('rewrite: empty README gets a title and the link, nothing invented', () => {
  const r = rewriteReadme('', { ...OPTS, repoName: 'empty' });
  assert.match(r.markdown, /^# empty\n/);
  assert.match(r.markdown, /explainmyrepo:link:start/);
});

test('rewrite: re-running in the OTHER mode replaces our old block rather than stacking', () => {
  const plain = '# p\n\nIntro.\n\n## Use\n';
  const a = rewriteReadme(plain, { ...OPTS, repoName: 'p', fallback: FALLBACK }).markdown;
  assert.equal((a.match(/explainmyrepo:start/g) || []).length, 1);
  const withAscii = a.replace('## Use\n', `## Use\n\n\`\`\`text\n${BOX}\n\`\`\`\n`);
  const b = rewriteReadme(withAscii, { ...OPTS, repoName: 'p', fallback: FALLBACK });
  assert.equal(b.mode, 'ascii');
  assert.equal((b.markdown.match(/explainmyrepo:start/g) || []).length, 0, 'the fallback block is gone');
});

test('rewrite: GUARD — a diagram inside a LONGER fence is not double-processed', () => {
  const md = `# t\n\ntext\n\n\`\`\`\`text\n${BOX}\n\`\`\`\`\n`;
  const r = rewriteReadme(md, OPTS);
  assert.equal(r.diagrams.length, 1);
  assert.ok(r.markdown.includes('````text'));
});
