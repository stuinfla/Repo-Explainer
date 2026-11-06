// P12 — the LOCAL door's animated hero scene: the brain authors it, one repair pass, disclosed fallback,
// make-diagrams installs it, generate-image skips the paid raster hero when a valid scene exists.
// The model is stubbed at fetch (the real callClaudeJSON parser runs); the real validator and tools run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorVisualBrief, visualsSlotFromBrief, HERO_SCENE_RULES } from '../src/brain.mjs';
import { DEFAULT_MODEL } from '../src/claude.mjs';
import { validateHeroScene } from '../tools/diagrams/scene.mjs';
import { minTextPx } from '../tools/diagrams/legibility.mjs';
import { heroRasterDecision, renderSceneBackdrop } from '../tools/generate-image.mjs';
import { validScene } from './helpers/hero-scene-fixture.mjs';
import { makeBuild, runTool, visualsOf, cleanup, CONCEPT_SLOTS } from './helpers/diagram-build.mjs';

const BASE_REPLY = { hero: { prompt: 'x' }, sections: [], diagrams: { bigIdea: { rows: [{ items: ['a'] }] }, insight: { rows: [{ items: ['b'] }] } } };

/** Stub fetch with a queue of model replies; returns { calls, restore }. */
function stubModel(replies) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(r) }], stop_reason: 'end_turn', usage: {} }) };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const brief = () => authorVisualBrief({ _env: { EXPLAINMYREPO_BRAIN: 'api' }, repo: { name: 'fixture' } }, { apiKey: 'k', model: DEFAULT_MODEL });
const tinyText = validScene().replace('font-size:16px', 'font-size:9px').replace('font-size:18px', 'font-size:9px');

test('a valid authored scene rides through the brain into the visuals slot, one model call', async () => {
  const m = stubModel([{ ...BASE_REPLY, heroAnim: { sceneSvg: validScene(), altText: 'A copy is edited and one edit is undone', metaphorTie: 'the sealed original' } }]);
  try {
    const slot = visualsSlotFromBrief(await brief());
    assert.equal(m.calls.length, 1, 'a valid scene needs no repair call');
    assert.equal(slot.heroAnim.sceneMarkup, validScene());
    assert.equal(slot.heroAnim.altText, 'A copy is edited and one edit is undone');
    assert.equal(slot.heroAnim.metaphorTie, 'the sealed original');
    assert.equal(slot.heroAnimSkipped, undefined);
    assert.match(`${m.calls[0].system}\n${m.calls[0].messages[0].content}`, /HERO SCENE \(heroAnim\)/, 'the request must carry the scene rules');
  } finally { m.restore(); }
});

test('an invalid scene gets exactly ONE repair pass naming the defects, and the repaired scene ships', async () => {
  const m = stubModel([{ ...BASE_REPLY, heroAnim: { sceneSvg: tinyText } }, { sceneSvg: validScene() }]);
  try {
    const slot = visualsSlotFromBrief(await brief());
    assert.equal(m.calls.length, 2, 'initial + one repair, no more');
    assert.match(m.calls[1].messages[0].content, /smallest text is [\d.]+px on a 390px phone/, 'the repair prompt must carry the real defect');
    assert.equal(slot.heroAnim.sceneMarkup, validScene());
  } finally { m.restore(); }
});

test('still invalid after the repair: NO scene, a disclosed reason, and never a third call', async () => {
  const m = stubModel([{ ...BASE_REPLY, heroAnim: { sceneSvg: tinyText } }, { sceneSvg: tinyText }, { sceneSvg: validScene() }]);
  try {
    const slot = visualsSlotFromBrief(await brief());
    assert.equal(m.calls.length, 2, 'exactly one repair, even though a third reply would have been valid');
    assert.equal(slot.heroAnim, undefined, 'a broken scene must never reach build.json as heroAnim');
    assert.match(slot.heroAnimSkipped.reason, /still invalid after one repair pass: .*smallest text/);
  } finally { m.restore(); }
});

test('no scene authored at all: skipped with a reason, build unchanged otherwise', async () => {
  const m = stubModel([BASE_REPLY]);
  try {
    const slot = visualsSlotFromBrief(await brief());
    assert.equal(slot.heroAnim, undefined);
    assert.equal(slot.heroAnimSkipped.reason, 'the brain authored no hero scene');
    assert.equal(slot.hero.px, '1536x1024', 'the raster hero is still briefed as the fallback');
  } finally { m.restore(); }
});

test('the validator enforces each rule of the contract, with magnitudes', () => {
  const ok = validScene();
  assert.deepEqual(validateHeroScene(ok), []);
  const px = minTextPx(ok);
  assert.ok(px >= 11 && px < 14, `valid scene text is ${px}px at 390 (expected 12-13)`);
  const cases = {
    'no viewBox': [ok.replace(/viewBox="[^"]+"/, ''), /viewBox/],
    'static (no animation)': [ok.replace(/@keyframes[^}]*\}\}?/, '').replace(/animation:[^;}]*/, ''), /no animation/],
    'no reduced-motion state': [ok.replaceAll('prefers-reduced-motion', 'min-width'), /prefers-reduced-motion/],
    'unscoped selector': [ok.replace('</style>', 'body{background:red}</style>'), /selector "body\{?background|selector "body/],
    'unscoped keyframes': [ok.replaceAll(`hs-pulse`, 'pulse'), /keyframes "pulse"/],
    'foreign inner id': [ok.replace('id="hs-bg"', 'id="bg"'), /inner id "bg"/],
    'script': [ok.replace('</svg>', '<script>alert(1)</script></svg>'), /script/],
    'external image': [ok.replace('</svg>', '<image href="https://x.test/a.png"/></svg>'), /external reference/],
    'text under the phone floor': [tinyText, /9\.36px|smallest text/],
    'not xml': [ok.replace('</svg>', ''), /not well-formed|no <svg>/],
    'too big': [ok.replace('</svg>', `<!--${'x'.repeat(26000)}--></svg>`), /bytes \(max 25000\)/],
  };
  for (const [name, [svg, re]] of Object.entries(cases)) {
    const d = validateHeroScene(svg).join(' | ');
    assert.match(d, re, `${name}: expected a defect matching ${re}, got "${d}"`);
  }
});

test('the prompt states the same contract the validator enforces (390px text, scoping, reduced motion, repair)', () => {
  for (const re of [/viewBox width 400/, /at least 14 units/, /starts with #<id>/, /prefers-reduced-motion/, /ONE repair pass/, /PERFORMS/, /Banned as "motion"/]) assert.match(HERO_SCENE_RULES, re);
});

test('make-diagrams installs a brain-authored scene (sceneMarkup), refuses a bad one, and a re-run keeps it', () => {
  const dir = makeBuild({ visuals: { ...CONCEPT_SLOTS, heroAnim: { sceneMarkup: validScene(), altText: 'alt' } } });
  try {
    const r = runTool(dir);
    assert.equal(r.status, 0, r.out);
    const h = visualsOf(dir).heroAnim;
    assert.equal(h.format, 'svg-vector-animated-scene');
    assert.equal(h.sceneMarkup, undefined, 'the inline markup must not linger in build.json');
    assert.equal(h.sceneSvg, 'assets/hero-scene.svg');
    assert.equal(fs.readFileSync(path.join(dir, 'assets', 'hero-scene.svg'), 'utf8'), validScene());
    assert.match(h.altText, /original model stays locked/, 'alt text comes from the scene <desc>');
    const again = runTool(dir);
    assert.equal(again.status, 0, `a refine-pass re-run must still draw the scene: ${again.out}`);
    assert.equal(visualsOf(dir).heroAnim.svgPath, h.svgPath);
  } finally { cleanup(dir); }
  const bad = makeBuild({ visuals: { ...CONCEPT_SLOTS, heroAnim: { sceneMarkup: tinyText } } });
  try {
    const r = runTool(bad);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /heroAnim scene refused.*smallest text/);
    assert.ok(!fs.existsSync(path.join(bad, 'assets', 'hero-scene.svg')), 'a refused scene is never written');
  } finally { cleanup(bad); }
});

test('raster-skip decision: valid scene skips the paid hero; invalid or absent scene does not', () => {
  assert.deepEqual(
    (({ skip, reason }) => ({ skip, reason }))(heroRasterDecision({ heroAnim: { sceneMarkup: validScene() } }, '/nowhere')),
    { skip: true, reason: 'valid hero scene' });
  const bad = heroRasterDecision({ heroAnim: { sceneMarkup: tinyText } }, '/nowhere');
  assert.equal(bad.skip, false);
  assert.match(bad.reason, /hero scene invalid.*smallest text/);
  assert.equal(heroRasterDecision({}, '/nowhere').skip, false);
  assert.equal(heroRasterDecision({ heroAnim: { label: 'chips only', chips: [] } }, '/nowhere').skip, false, 'a chips band is not a scene');
  assert.match(heroRasterDecision({ heroAnim: { sceneSvg: 'assets/missing.svg' } }, '/nowhere').reason, /not readable/);
});

test('the scene backdrop feeding favicon/social card is a real 1536x1024 PNG in the scene colour (no model call)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p12-backdrop-'));
  try {
    const f = path.join(dir, 'b.png');
    const bytes = await renderSceneBackdrop(validScene(), f);
    const { default: sharp } = await import('sharp');
    const meta = await sharp(f).metadata();
    assert.deepEqual([meta.width, meta.height], [1536, 1024]);
    assert.ok(bytes > 2000 && bytes < 400_000, `backdrop is ${bytes} bytes`);
    const { data } = await sharp(f).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([...data].slice(0, 3), [0x0d, 0x11, 0x14], 'corner pixel is the scene background #0d1114');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
