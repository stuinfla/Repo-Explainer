// tests/diagram-legibility.test.mjs — the PHONE legibility rail (ADR-0012 D5, owner decision 2026-11-05:
// "you always need a mobile friendly version"), exercised through the REAL tool.
//
// A phone fits a diagram to width, so label size on screen = smallest font x 312 / canvas width. The wide canvases
// measured 3.65px (system map), 2.81px (6-candidate decision), 2.69px (insight) and 4.37px (big idea) on a phone; every
// diagram is now ALSO drawn on a 360-wide portrait canvas that must clear 11px for every piece of text, and the build step
// FAILS (after one corrective re-flow) when one does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBuild, runTool, visualsOf, cleanup, CONCEPT_SLOTS } from './helpers/diagram-build.mjs';
import { phonePx, fontSizes, canvasWidth } from './helpers/diagram-svg.mjs';
import { drawMobileChecked, legibilityDefects, minTextPx } from '../tools/diagrams/legibility.mjs';
import { renderSystemMap, renderDecision } from '../src/story-diagrams.mjs';
import { SYSTEM_MAP, DECISION } from './fixtures/story-claude-swap.mjs';

const CLONE = {
  'README.md': 'Works with both the Claude Code CLI and the VS Code extension.\n',
  'src/claude_swap/autoswitch.py': '    if h - active_headroom < settings.hysteresis_pct:\n        continue\n',
};
const SIX = { ...DECISION, candidates: [...DECISION.candidates, { name: 'a', value: 10, status: 'eligible' }, { name: 'b', value: 20, status: 'eligible' }] };
const within = (v, lo, hi, what) => assert.ok(typeof v === 'number' && v >= lo && v <= hi, `${what}: expected ${lo}-${hi}px, got ${v}`);

test('REGRESSION FIXTURES: the wide canvases really are illegible on a phone (the numbers P1 measured)', () => {
  // smallest text of ANY kind (the 11px section heads), so a notch under P1's 3.65 / 2.81 label measurements
  within(phonePx(renderSystemMap(SYSTEM_MAP)), 2.8, 3.9, 'wide system map');
  within(phonePx(renderDecision(SIX)), 2.2, 3.0, 'wide 6-candidate decision');
});

test('every grounded and concept family has a phone twin: 360 wide, nothing under 13 units, >= 11px on a 390px phone', () => {
  const dir = makeBuild({ visuals: CONCEPT_SLOTS });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    const v = visualsOf(dir);
    for (const key of ['architectureDiagram', 'flowDiagram', 'bigIdeaDiagram', 'insightDiagram']) {
      const d = v[key];
      assert.ok(d.mobileSvgPath && fs.existsSync(d.mobileSvgPath), `${key}: no phone twin on disk (mobileSvgPath=${d.mobileSvgPath})`);
      const svg = fs.readFileSync(d.mobileSvgPath, 'utf8');
      assert.equal(canvasWidth(svg), 360, `${key}: phone canvas must be 360 wide`);
      assert.ok(Math.min(...fontSizes(svg)) >= 13, `${key}: a phone label is under 13 units: ${Math.min(...fontSizes(svg))}`);
      assert.ok(phonePx(svg) >= 11, `${key}: ${phonePx(svg)}px on a phone`);
      within(d.mobileLabelPx, 11, 12, `${key} recorded mobileLabelPx`);
      assert.equal(d.mobileLabelPx, Math.round(phonePx(svg) * 100) / 100, `${key}: recorded px must equal the measurement of the phone file`);
    }
    assert.match(r.stderr, /phone text size @312px \(floor 11px\) — architecture 11\.\d+px/);
  } finally { cleanup(dir); }
});

test('story diagrams: the phone twins clear the floor where the wide canvases were 3.65px and 2.81px', () => {
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, systemMap: SYSTEM_MAP, decision: SIX }, clone: CLONE });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    const v = visualsOf(dir);
    assert.equal(v.architectureDiagram.form, 'systemMap');
    assert.equal(v.flowDiagram.form, 'decision');
    for (const key of ['architectureDiagram', 'flowDiagram']) {
      const wide = fs.readFileSync(v[key].svgPath, 'utf8'), phone = fs.readFileSync(v[key].mobileSvgPath, 'utf8');
      assert.ok(phonePx(wide) < 5, `${key}: the wide file is the illegible one (${phonePx(wide)}px) — that is why the twin exists`);
      assert.ok(phonePx(phone) >= 11, `${key}: the phone twin is ${phonePx(phone)}px`);
      assert.ok(v[key].mobileLabelPx >= 11);
    }
  } finally { cleanup(dir); }
});

test('GATE: a phone layout under 11px FAILS the build step (11.0px passes, 10.9px does not)', () => {
  const svgAt = (fs_) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 200"><text x="10" y="20" font-size="${fs_}">hello</text></svg>`;
  assert.deepEqual(legibilityDefects(svgAt(12.7)), [], '12.7 x 312/360 = 11.0px clears the floor');
  assert.match(legibilityDefects(svgAt(12.6)).join(), /10\.9\dpx on a phone \(floor 11px\)/);
  assert.equal(minTextPx(svgAt(13)), 11.27);
  // the old wide story canvas, offered as a "phone" layout, is refused
  assert.throws(() => drawMobileChecked('systemMap', () => renderSystemMap(SYSTEM_MAP)), /still fails after the corrective re-flow.*3\.\d+px on a phone/);
});

test('GATE: one corrective re-flow, then a loud failure', () => {
  const bad = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 100"><text x="5" y="20" font-size="9">tiny</text></svg>';
  const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 100"><text x="5" y="20" font-size="14">ok</text></svg>';
  const seen = [];
  const ok = drawMobileChecked('x', (scale) => { seen.push(scale); return scale === 1 ? bad : good; });
  assert.deepEqual(seen, [1, 0.88], 'pass 1 at normal wrapping, then exactly one tighter pass');
  assert.equal(ok.pass, 2);
  const seen2 = [];
  assert.throws(() => drawMobileChecked('x', (s) => { seen2.push(s); return bad; }), /x: the phone layout still fails/);
  assert.equal(seen2.length, 2, 'never a third attempt');
  // a clean first pass is not re-drawn
  const seen3 = [];
  drawMobileChecked('x', (s) => { seen3.push(s); return good; });
  assert.deepEqual(seen3, [1]);
});
