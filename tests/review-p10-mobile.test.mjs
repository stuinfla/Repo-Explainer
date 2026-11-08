// Mobile-first page layer, checked on REAL assembler output (markup + the generated styles.css).
// What this cannot prove without a browser: actual pixel layout / horizontal scroll at 390px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';
import { contrast, parseColors, commandBlocks, factsInk } from '../tools/assemble-page.mjs';

function build(mutate) {
  const dir = makeBuild({ mutate });
  const r = assemble(dir);
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const css = fs.readFileSync(path.join(dir, 'site', 'styles.css'), 'utf8');
  cleanup(dir);
  return { html: r.html, css };
}
const INSTALL = '# install\nnpm i -g thing\nthing init --yes\nthing run \\\n  --fast';

test('install and use-case code: ONE command per full-width block, each with its own copy button', () => {
  const { html } = build((c) => { c.content.sections.getStarted.install = INSTALL; c.content.sections.useCases.cases[0].code = 'a one\nb two'; });
  const blocks = [...html.matchAll(/<div class="cmd-block">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  assert.equal(blocks.length, 5, 'install gives 3 commands (continuation kept together), the case gives 2');
  const copies = [...html.matchAll(/data-copy="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(copies, ['a one', 'b two', 'npm i -g thing', 'thing init --yes', 'thing run \\\n  --fast']);
  for (const b of blocks) { assert.equal((b.match(/<pre /g) || []).length, 1); assert.equal((b.match(/<button /g) || []).length, 1); }
  assert.match(blocks[2], /cmd-note">install</, 'the comment rides along as a note, not in the copy payload');
  assert.ok(!copies.some((c) => c.includes('#')));
});

test('a case with code is marked so it spans the whole row; the copy buttons are enabled by script only', () => {
  const { html, css } = build((c) => { c.content.sections.useCases.cases[0].code = 'x'; });
  assert.match(html, /<details class="case has-code" open>/);
  assert.match(css, /\.gallery \.grid > \.case\.has-code \{ grid-column: 1 \/ -1; \}/);
  assert.match(html, /<button type="button" class="copy-btn"[^>]* hidden>/);
  assert.match(html, /b\.hidden = false/);
});

test('print rules from the Ask box migration are in the generated stylesheet verbatim', () => {
  const { css } = build();
  assert.ok(css.includes('@media print{.site-head,video,.cta-row,.dl-cta,.dropzone{display:none!important}details.section>summary .chev{display:none}details.section{break-inside:avoid-page}body{background:#fff!important}}'));
});

test('facts text clears 4.5:1 on the theme background, on dark AND light themes, and is never faded', () => {
  for (const bg of ['#0c0d12', '#ffffff', '#fdf6e3', '#1a0b2e']) {
    const { css } = build((c) => { c.concept.palette = { accent: '#4be3c8', bg, ink: bg === '#ffffff' || bg === '#fdf6e3' ? '#111111' : '#eeeeee', 'ink-2': bg === '#ffffff' || bg === '#fdf6e3' ? '#222222' : '#dddddd', muted: '#888888' }; });
    const rule = css.match(/\.meta-row, [^{]*\{([^}]*)\}/)[1];
    const color = rule.match(/color:\s*(#[0-9a-f]{6})/i)[1];
    assert.ok(contrast(parseColors(color)[0], parseColors(bg)[0]) >= 4.5, `${color} on ${bg}`);
    assert.match(rule, /opacity: 1/);
  }
});

test('factsInk: a mid-grey muted that fails AA is skipped for the next candidate that passes', () => {
  assert.equal(factsInk('#0c0d12', ['#3a3a44', '#c4c8de']), '#c4c8de');
  assert.equal(factsInk('#808080', ['#8a8a8a', '#7a7a7a']).length, 7, 'with no passing candidate it falls back to a guaranteed ink');
});

test('stylesheet floors for a 390px phone: no sub-13px text in the page layer, media-bound widths, tap targets >= 44px', () => {
  const { css } = build();
  const layer = css.slice(css.indexOf('page layer: mobile-first'));
  for (const m of layer.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 13, `font ${m[0]}`);
  assert.match(layer, /\.copy-btn \{[^}]*min-width: 44px; min-height: 44px/);
  assert.match(layer, /\.cmd-block \{[^}]*max-width: 100%; min-width: 0/);
  assert.match(layer, /img, svg, video \{ max-width: 100%; \}/);
  assert.match(layer, /html \{ overflow-x: clip; \}/);
  assert.ok(!/opacity:\s*0?\.\d/.test(layer.replace(/@media print[\s\S]*/, '')), 'no faded text in the page layer');
});

test('commandBlocks escapes HTML in commands (no markup injection through a code sample)', () => {
  const h = commandBlocks('echo "<img src=x onerror=alert(1)>"');
  assert.ok(!h.includes('<img') && h.includes('&lt;img'));
});
