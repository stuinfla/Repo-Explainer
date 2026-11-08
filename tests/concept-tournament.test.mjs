// The tournament's winner must be renderable: concept.palette is the KNOB OBJECT assemble-page and
// make-social-card read, never the prose string models were once asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePalette, normalizeTypePersonality, normalizeConceptSpec, tournamentSpend } from '../tools/concept-tournament.mjs';
import { buildTheme } from '../tools/assemble-page.mjs';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOURNAMENT = path.join(REPO, 'tools', 'concept-tournament.mjs');
const STUB = path.join(REPO, 'tests', 'helpers', 'tournament-fetch-stub.mjs');
const hasMagick = (() => { try { execFileSync('magick', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

// Runs the REAL CLI with a stubbed fetch; returns the concept it wrote into build.json.
function runTournament(paletteStyle, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tournament-'));
  fs.mkdirSync(path.join(dir, 'repo'));
  fs.writeFileSync(path.join(dir, 'repo', 'README.md'), '# widget\nfinds things\n');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ repo: { owner: 'o', name: 'r' } }));
  const r = spawnSync(process.execPath, ['--import', STUB, TOURNAMENT, dir], {
    encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', TOURNAMENT_STUB_PALETTE: paletteStyle, ...extraEnv },
  });
  assert.equal(r.status, 0, r.stderr);
  const concept = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).concept;
  const line = r.stdout.trim().split('\n').pop();
  return { dir, concept, stderr: r.stderr, result: line ? JSON.parse(line) : null };
}

for (const style of ['prose', 'object']) {
  test(`tournament output (${style} palette from the model) → concept.palette is a knob object with an accent`, () => {
    const { dir, concept } = runTournament(style);
    try {
      assert.equal(typeof concept.palette, 'object');
      assert.ok(!Array.isArray(concept.palette));
      assert.match(concept.palette.accent, /^#[0-9a-f]{6}$/i);
      assert.equal(concept.tournament.winnerModel, 'claude-sonnet-5-5');
      // assemble-page's own concept reader accepts it
      const theme = buildTheme(concept);
      assert.ok(theme.tokensUsed.includes('--accent'));
      assert.match(theme.css, /--accent:\s*#/);
    } finally { cleanup(dir); }
  });

  test(`tournament winner (${style}) renders through the real assemble-page`, () => {
    const { dir: tdir, concept } = runTournament(style);
    const dir = makeBuild({ mutate: (c) => { c.concept = { ...concept, metaphor: concept.metaphor, tagline: concept.tagline }; } });
    try {
      const r = assemble(dir);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.html, /<meta name="theme-color" content="#ffb000">/, "the winner's accent drives the page theme");
    } finally { cleanup(dir); cleanup(tdir); }
  });

  test(`tournament winner (${style}) renders through the real make-social-card with no temp-dir leak`, { skip: !hasMagick && 'ImageMagick not installed' }, () => {
    const { dir: tdir, concept } = runTournament(style);
    const dir = makeBuild({ mutate: (c) => { c.concept = concept; } });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-tmp-'));
    try {
      execFileSync('magick', ['-size', '96x64', 'xc:#336699', path.join(dir, 'assets', 'hero.png')]);   // a decodable hero
      const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'make-social-card.mjs'), dir], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmp } });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(path.join(dir, 'assets', 'social-card.png')));
      assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('social-card-')), [], 'the temp dir is removed even though the tool exits via process.exit');
    } finally { cleanup(dir); cleanup(tdir); cleanup(tmp); }
  });
}

test('normalizePalette: hex array / prose → accent chosen by saturation; object keeps colour knobs only', () => {
  assert.deepEqual(normalizePalette('navy #0b1d3a and amber #ffb000'), { accent: '#ffb000', 'accent-2': '#0b1d3a' });
  assert.deepEqual(normalizePalette({ accent: '#112233', radius: '99px', ease: 'linear', bg: 'not-a-colour', '--ink': '#fff' }), { accent: '#112233', ink: '#fff' });
  assert.equal(normalizePalette('no colours here'), null);
  assert.equal(normalizePalette({ bg: '#000000' }), null, 'no accent → unusable (assemble-page refuses a palette without one)');
});

test('normalizeTypePersonality: only safe CSS, https font URL; prose is dropped', () => {
  assert.equal(normalizeTypePersonality('Fraunces + Inter'), null);
  assert.deepEqual(normalizeTypePersonality({ display: 'Fraunces, serif', mono: 'x; } body{display:none', fontHref: 'http://evil', sans: 'url(x)' }), { display: 'Fraunces, serif' });
  assert.equal(normalizeTypePersonality({ fontHref: 'https://fonts.googleapis.com/css2?family=Inter' }).fontHref, 'https://fonts.googleapis.com/css2?family=Inter');
});

test('normalizeConceptSpec drops an unusable palette instead of seeding one that crashes the renderer', () => {
  const out = normalizeConceptSpec({ metaphor: 'm', palette: 'moody blues' });
  assert.ok(!('palette' in out));
  assert.equal(out.metaphor, 'm');
});

test('tournamentSpend: priced Anthropic calls are summed exactly; an OpenAI call (no sourced rate) makes the total UNPRICED, never $0', () => {
  const claude = tournamentSpend([{ model: 'claude-sonnet-5-5', usage: { in: 1000, out: 500 } }, { model: 'claude-fable-5-1', usage: { in: 1000, out: 500 } }]);
  assert.equal(claude.usd, 0.007 + 0.035);
  assert.deepEqual(claude.unpriced, []);
  const mixed = tournamentSpend([{ model: 'claude-sonnet-5-5', usage: { in: 1000, out: 500 } }, { model: 'gpt-5.6-sol', usage: { in: 9, out: 9 } }]);
  assert.equal(mixed.usd, null);
  assert.equal(mixed.pricedUsd, 0.007);
  assert.deepEqual(mixed.unpriced, ['gpt-5.6-sol']);
});

test('the CLI records the spend in the tournament record (2 Claude calls priced, OpenAI ones UNPRICED)', () => {
  const { dir, concept } = runTournament('object');
  try {
    assert.equal(concept.tournament.spend.calls, 4, 'sonnet + fable + sol candidates and the terra judge');
    assert.equal(concept.tournament.spend.usd, null);
    assert.deepEqual(concept.tournament.spend.unpriced.sort(), ['gpt-5.6-sol', 'gpt-5.6-terra']);
    assert.equal(concept.tournament.spend.pricedUsd, 0.007 + 0.035);
  } finally { cleanup(dir); }
});

test('success prints the contract shape with error:null', () => {
  const { dir, result } = runTournament('object');
  try {
    assert.equal(result.ok, true);
    assert.equal(result.error, null);
    assert.equal(result.outputs.winner, 'claude-sonnet-5-5');
    assert.equal(result.skipped, undefined);
  } finally { cleanup(dir); }
});

test('SKIP (fewer than 2 candidates) prints ONE ok:true JSON line with the reason and error:null, and seeds no concept', () => {
  const { dir, concept, result, stderr } = runTournament('object', { TOURNAMENT_STUB_FAIL: 'all' });
  try {
    assert.equal(result.ok, true);
    assert.equal(result.error, null);
    assert.match(result.skipped, /need >=2 candidates \+ a judge \(got 0\)/);
    assert.equal(concept, undefined);
    assert.match(stderr, /SKIPPED/);
  } finally { cleanup(dir); }
});

test('SKIP (judge fails after good candidates) is the same fail-open JSON and seeds no concept', () => {
  const { dir, concept, result } = runTournament('object', { TOURNAMENT_STUB_FAIL: 'judge' });
  try {
    assert.equal(result.ok, true);
    assert.match(result.skipped, /judge failed/);
    assert.equal(result.error, null);
    assert.equal(concept, undefined);
  } finally { cleanup(dir); }
});

test('SKIP with exactly ONE reachable candidate (the judge is fine): a lone candidate never "wins" a tournament', () => {
  const { dir, concept, result } = runTournament('object', { TOURNAMENT_STUB_FAIL: 'one' });
  try {
    assert.match(result.skipped, /got 1\)/);
    assert.equal(concept, undefined);
  } finally { cleanup(dir); }
});
