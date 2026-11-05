// A light palette that sets only bg/surface/ink must not leave body copy on the skeleton's DARK siblings
// (live ruvllm: --ink-2 stayed #c4c8de on a cream card, and the page background ended in near-black).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTheme, contrast } from '../tools/assemble-page.mjs';

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const tokens = (css) => Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));
const quiet = (fn) => { const w = process.stderr.write; process.stderr.write = () => true; try { return fn(); } finally { process.stderr.write = w; } };
const LIGHT = { bg: '#F2EBDB', surface: '#FBF7EC', ink: '#1B2233', muted: '#7B705C', accent: '#C23A22', 'accent-2': '#2E6B52' };
const DARK = { bg: '#0c0d12', surface: '#15161f', ink: '#eef0fb', accent: '#8b7bff' };

test('light palette: every sibling token is derived and body copy is AA on every surface it can sit on', () => {
  const t = tokens(quiet(() => buildTheme({ palette: LIGHT })).css);
  for (const k of ['bg-2', 'surface-2', 'ridge', 'ink-2', 'muted', 'faint']) assert.ok(t[k], `--${k} must be defined by the theme`);
  for (const k of ['ink', 'ink-2', 'muted']) for (const g of ['bg', 'bg-2', 'surface', 'surface-2']) {
    const r = contrast(rgb(t[k]), rgb(t[g]));
    assert.ok(r >= 4.5, `--${k} on --${g} is ${r.toFixed(2)}:1, below AA`);
  }
  // the page background gradient foot must stay in the same light family (not the dark #101117 default)
  assert.ok(contrast(rgb(t['bg-2']), rgb(t.bg)) < 1.3, `--bg-2 ${t['bg-2']} drifted away from --bg ${t.bg}`);
});

test('an explicit but unreadable ink-2 is raised to AA, an explicit readable one is left alone', () => {
  const bad = tokens(quiet(() => buildTheme({ palette: { ...LIGHT, 'ink-2': '#c4c8de' } })).css);
  assert.ok(contrast(rgb(bad['ink-2']), rgb(bad.surface)) >= 4.5);
  const good = tokens(quiet(() => buildTheme({ palette: { ...LIGHT, 'ink-2': '#33384a' } })).css);
  assert.equal(good['ink-2'], '#33384a');
});

test('dark palette: derived siblings stay dark-theme readable too', () => {
  const t = tokens(quiet(() => buildTheme({ palette: DARK })).css);
  for (const k of ['ink-2', 'muted']) assert.ok(contrast(rgb(t[k]), rgb(t.surface)) >= 4.5, `--${k} below AA on the dark surface`);
});
