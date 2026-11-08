// tests/review-p4b-parity.test.mjs — local-door parity with the hosted door: the concept tournament and the
// primer index are stations of the one table, in the hosted order; the share card cannot be flagged away; and a
// drift test pins every both-door station to a name the hosted SKILL / runner actually uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STATIONS, SKIP_FLAGS, REQUIRED_STATIONS, stationIds, stationsFor, selectStations, hostedName } from '../src/stations.mjs';
import { buildStations, tournamentOutcome, conceptSkipReason, indexPrimerStation } from '../src/station-runners.mjs';
import { run } from '../src/orchestrator.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'bin', 'explainmyrepo.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p4b-'));
const ids = stationIds('local');
const at = (id) => ids.indexOf(id);
const station = (id) => STATIONS.find((s) => s.id === id);

test('hosted order is mirrored: KB built, tournament, primer authored then indexed, THEN the single-shot concept, then content', () => {
  const order = ['build-kb', 'concept-tournament', 'primer', 'index-primer', 'concept', 'content'];
  for (const id of order) assert.ok(at(id) >= 0, `${id} is a local station`);
  assert.deepEqual(order.map(at), [...order.map(at)].sort((a, b) => a - b), 'run order');
  for (const id of ['concept-tournament', 'index-primer']) assert.deepEqual(station(id).doors, ['local', 'hosted'], id);
  assert.equal(station('concept-tournament').fatal, false, 'hosted treats the tournament as fail-open');
  assert.equal(station('index-primer').fatal, true, 'a KB missing its orientation layer is not silently shipped');
  assert.equal(station('concept-tournament').phase, 'pre');
});

test('--only / --from / --to / --help pick the new stations up from the table alone', () => {
  const list = stationsFor({});
  for (const id of ['concept-tournament', 'index-primer']) assert.deepEqual(selectStations(list, { only: id }).map((s) => s.id), [id]);
  assert.deepEqual(selectStations(list, { from: 'concept-tournament', to: 'concept' }).map((s) => s.id), ['concept-tournament', 'primer', 'index-primer', 'concept']);
  const help = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' }).stdout;
  assert.ok(/concept-tournament/.test(help) && /index-primer/.test(help));
});

test('a dry run plans the tournament and the primer index', async () => {
  const r = await run('owner/widget', { dryRun: true });
  assert.ok(r.stations.indexOf('concept-tournament') < r.stations.indexOf('primer'));
  assert.ok(r.stations.indexOf('index-primer') === r.stations.indexOf('primer') + 1);
});

test('tournamentOutcome: a fail-open skip ({ok:true, skipped}) is a skip, a real failure stays a failure', () => {
  assert.deepEqual(tournamentOutcome({ ok: true, code: 0, result: { ok: true } }), { ok: true });
  const skip = tournamentOutcome({ ok: true, code: 0, result: { ok: true, skipped: 'needs 2+ candidate models', error: null } });
  assert.equal(skip.ok, true);
  assert.match(skip.skipped, /needs 2\+ candidate models/);
  assert.deepEqual(tournamentOutcome({ ok: false, code: 1, result: null, error: 'boom' }), { ok: false, error: 'boom' });
});

test('conceptSkipReason: a tournament win from THIS run stands; an older one, none, or --only concept re-authors', () => {
  const start = Date.parse('2026-11-05T10:00:00Z');
  const won = (ranAt) => ({ concept: { tournament: { ranAt, winnerModel: 'claude-sonnet-5-5' } } });
  assert.match(conceptSkipReason(won('2026-11-05T10:05:00Z'), { startedAt: start }), /winner claude-sonnet-5-5/);
  assert.equal(conceptSkipReason(won('2026-11-04T09:00:00Z'), { startedAt: start }), null, 'stale tournament record');
  assert.equal(conceptSkipReason({ concept: { metaphor: 'x' } }, { startedAt: start }), null);
  assert.equal(conceptSkipReason({}, { startedAt: start }), null);
  assert.equal(conceptSkipReason(won('2026-11-05T10:05:00Z'), { startedAt: start, only: 'concept' }), null);
});

test('the concept station does NOT call the brain after a tournament win (and does when there was none)', async () => {
  const dir = tmp();
  const bj = (concept) => fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ repo: { slug: 'w' }, concept }));
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{"error":{"message":"network blocked in test"}}', { status: 400 }); };
  try {
    const st = buildStations({}).find((s) => s.id === 'concept');
    const args = { buildDir: dir, env: { EXPLAINMYREPO_BRAIN: 'api' }, apiKey: 'k', model: 'm', opts: {}, startedAt: 0 };
    bj({ tournament: { ranAt: new Date().toISOString(), winnerModel: 'w' }, palette: { accent: '#fff' } });
    const skipped = await st.run(args);
    assert.equal(skipped.ok, true);
    assert.match(skipped.skipped, /tournament already chose/);
    assert.equal(calls, 0);
    bj(undefined);
    await assert.rejects(() => st.run({ ...args, opts: {} }), /network blocked|fetch failed|failed/i);
    assert.ok(calls >= 1, 'with no tournament the single-shot brain is asked');
  } finally { globalThis.fetch = realFetch; }
});

test('index-primer station: indexes the build slug through the library, and refuses a build with no slug', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ repo: { slug: 'widget' } }));
  const seen = [];
  const r = await indexPrimerStation({ buildDir: dir }, { index: async (slug) => { seen.push(slug); return { sections: 6, ingested: 9 }; } });
  assert.deepEqual(seen, ['widget']);
  assert.deepEqual(r, { ok: true, indexed: { sections: 6, ingested: 9 } });
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ repo: {} }));
  await assert.rejects(() => indexPrimerStation({ buildDir: dir }, { index: async () => ({}) }), /no repo\.slug/);
});

test('index-primer is wired to the REAL kb/index-primer library: a build with no store fails loud with its MISSING message', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ repo: { slug: 'p4b-no-such-store' } }));
  const st = buildStations({}).find((s) => s.id === 'index-primer');
  await assert.rejects(() => st.run({ buildDir: dir, env: {} }), /MISSING: .*p4b-no-such-store/);
});

// ── the share card is a required deliverable on both doors ───────────────────────────────────────────
test('make-social-card is a fatal station on BOTH doors and no --no-* flag drops it, even if one were mis-mapped', () => {
  const s = station('make-social-card');
  assert.deepEqual(s.doors, ['local', 'hosted']);
  assert.equal(s.fatal, true);
  assert.deepEqual(REQUIRED_STATIONS, ['make-social-card']);
  const every = Object.fromEntries(Object.keys(SKIP_FLAGS).map((f) => [f, true]));
  assert.ok(stationsFor(every).some((x) => x.id === 'make-social-card'), 'all flags on: the card still builds');
  // the guard itself: map the card under a flag and prove it is still not dropped
  SKIP_FLAGS.noQuality.push('make-social-card');
  try { assert.ok(stationsFor({ noQuality: true }).some((x) => x.id === 'make-social-card')); }
  finally { SKIP_FLAGS.noQuality.pop(); }
  assert.ok(!stationsFor({ noQuality: true }).some((x) => x.id === 'quality-grade'), 'the guard did not break real skips');
});

// ── drift: the table vs what the hosted door is told ─────────────────────────────────────────────────
const hostedCorpus = () => {
  const files = [path.join(REPO, 'skills/explainmyrepo/SKILL.md'), path.join(REPO, 'skills/explainmyrepo/TOOLS-CONTRACT.md'),
    ...fs.readdirSync(path.join(REPO, 'bin')).filter((f) => f.endsWith('.mjs') && f !== 'explainmyrepo.mjs').map((f) => path.join(REPO, 'bin', f))];
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
};
// What the hosted docs must say for a station: the tool PATH for a spawned tool (a bare word like "deploy" or
// "notify" appears in any prose), else the station's hosted name (brain/entry stations have no file).
const driftNeedle = (s) => (s.tool && !s.hostedRef ? `tools/${s.tool}.mjs` : hostedName(s));
// The both-door stations the corpus never names.
export const driftFindings = (table, corpus) => table
  .filter((s) => s.doors.includes('local') && s.doors.includes('hosted'))
  .filter((s) => !corpus.includes(driftNeedle(s)))
  .map((s) => `${s.id} (looked for "${driftNeedle(s)}")`);

test('drift: every station both doors run is named by the hosted SKILL / runner (so the doors cannot silently diverge)', () => {
  assert.deepEqual(driftFindings(STATIONS, hostedCorpus()), []);
});

// The SKILL's hosted station table is parsed (not grepped): the tool rows must equal the hosted tool stations of the
// one table in src/stations.mjs — same set, same order. Deleting or swapping a row, or a new/renamed/reordered station
// that the SKILL does not mirror, fails this.
export const skillToolRows = (md) => {
  const lines = md.split('\n');
  const h = lines.findIndex((l) => /^\|\s*Station\s*\|\s*Tool\s*\|/.test(l));
  if (h < 0) throw new Error('hosted station table not found in SKILL.md');
  const rows = [];
  for (let i = h + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const m = lines[i].split('|')[2].match(/tools\/([\w-]+)\.mjs/);
    rows.push(m ? m[1] : null);
  }
  return rows;
};
export const hostedToolStations = (table) => table.filter((s) => s.doors.includes('hosted') && s.kind === 'tool' && s.tool && !s.hostedRef).map((s) => s.tool);
const SKILL_MD = () => fs.readFileSync(path.join(REPO, 'skills/explainmyrepo/SKILL.md'), 'utf8');

test('drift: the SKILL hosted station table lists EXACTLY the hosted tool stations, in the same ORDER', () => {
  assert.deepEqual(skillToolRows(SKILL_MD()), hostedToolStations(STATIONS));
});

test('drift (table parser can fail): a deleted row and two swapped rows in the SKILL table are both caught', () => {
  const md = SKILL_MD();
  const lines = md.split('\n');
  const idx = (t) => lines.findIndex((l) => l.includes(`\`tools/${t}.mjs\``) && l.startsWith('|'));
  const dropped = lines.filter((_, i) => i !== idx('make-pack')).join('\n');
  assert.notDeepEqual(skillToolRows(dropped), hostedToolStations(STATIONS), 'deleted row detected');
  const sw = [...lines]; const a = idx('assemble-page'), b = idx('make-pack');
  [sw[a], sw[b]] = [sw[b], sw[a]];
  assert.notDeepEqual(skillToolRows(sw.join('\n')), hostedToolStations(STATIONS), 'swapped rows detected');
});

test('drift detector can fail: a both-door station the hosted docs never mention is reported, a local-only one is not', () => {
  const corpus = hostedCorpus();
  const fake = [
    { id: 'imaginary', tool: 'imaginary-tool', doors: ['local', 'hosted'] },
    { id: 'local-only-thing', tool: 'local-only-thing', doors: ['local'] },
    { id: 'renamed', tool: 'concept-tournament-v2-renamed', doors: ['local', 'hosted'] },
    // the bare word "deploy" is all over the docs; only the tool path proves the station is documented
    { id: 'bare-word', tool: 'deploy-v2', doors: ['local', 'hosted'] },
  ];
  assert.deepEqual(driftFindings(fake, corpus), [
    'imaginary (looked for "tools/imaginary-tool.mjs")',
    'renamed (looked for "tools/concept-tournament-v2-renamed.mjs")',
    'bare-word (looked for "tools/deploy-v2.mjs")',
  ]);
});

test('drift: the tournament the hosted runner spawns is the same tool id the local table runs', () => {
  const runner = fs.readFileSync(path.join(REPO, 'bin/agentic-runner.mjs'), 'utf8');
  assert.ok(runner.includes(`'${station('concept-tournament').tool}.mjs'`), 'hosted runner spawns tools/concept-tournament.mjs');
  assert.equal(station('concept-tournament').tool, 'concept-tournament');
});
