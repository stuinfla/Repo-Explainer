// tests/stations.test.mjs — the one station table (src/stations.mjs) and what reads it: --help, the
// --from/--to/--only validation, the --no-* flags, the post-ship follow-ups and the advisory claims step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STATIONS, SKIP_FLAGS, stationIds, stationsFor, selectStations } from '../src/stations.mjs';
import { recordClaims } from '../src/claims-record.mjs';
import { buildStations, overviewAddedToPage, followUpSkipReason } from '../src/station-runners.mjs';
import { run } from '../src/orchestrator.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'bin', 'explainmyrepo.mjs');
const idx = (id) => stationIds('local').indexOf(id);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stations-'));

test('table: ids are unique, fields are well-formed, every spawned tool file exists', () => {
  assert.equal(new Set(STATIONS.map((s) => s.id)).size, STATIONS.length);
  for (const s of STATIONS) {
    assert.ok(['tool', 'brain'].includes(s.kind), s.id);
    assert.ok(['pre', 'agent', 'ship', 'post-ship'].includes(s.phase), s.id);
    assert.equal(typeof s.fatal, 'boolean', s.id);
    assert.ok(s.doors.length > 0 && s.doors.every((d) => ['local', 'hosted'].includes(d)), s.id);
    if (s.kind === 'brain') assert.equal(s.tool, null, `${s.id}: a brain station spawns no tool`);
    if (s.tool) assert.ok(fs.existsSync(path.join(REPO, 'tools', `${s.tool}.mjs`)), `tools/${s.tool}.mjs missing for ${s.id}`);
    if (s.entry) assert.ok(fs.existsSync(path.join(REPO, s.entry)), `${s.entry} missing for ${s.id}`);
  }
});

test('make-overview is a post-ship follow-up: after notify, then re-deploy, then re-publish; outreach does not wait', () => {
  assert.ok(idx('readme-enhance') < idx('notify'));
  assert.ok(idx('notify') < idx('make-overview'), 'overview runs after the last delivery station');
  assert.ok(idx('make-overview') < idx('redeploy') && idx('redeploy') < idx('republish'));
  assert.ok(idx('readme-enhance') < idx('make-overview'), 'outreach is sent before the overview exists');
  assert.ok(idx('make-overview') > idx('quality-grade'), 'it no longer sits on the critical path before grading');
  const tail = stationIds('local').slice(idx('make-overview'));
  assert.deepEqual(tail, ['make-overview', 'redeploy', 'republish']);
  assert.ok(STATIONS.filter((s) => s.phase === 'post-ship').every((s) => !s.fatal), 'a failed follow-up must not fail a shipped build');
  assert.deepEqual(STATIONS.filter((s) => s.id === 'redeploy' || s.id === 'republish').map((s) => s.tool), ['deploy', 'publish-repo']);
});

test('--no-* flags drop exactly the stations they name, including the follow-ups that depend on them', () => {
  const all = stationIds('local');
  for (const [flag, ids] of Object.entries(SKIP_FLAGS)) {
    const left = stationsFor({ [flag]: true }).map((s) => s.id);
    assert.deepEqual(all.filter((id) => !left.includes(id)).sort(), [...ids].sort(), flag);
  }
  assert.ok(!stationsFor({ noDeploy: true }).some((s) => s.tool === 'deploy'), 'no deploy of any kind with --no-deploy');
  assert.deepEqual(stationsFor({}).map((s) => s.id), all);
});

test('selectStations validates --only / --from / --to against the table', () => {
  const list = stationsFor({});
  assert.deepEqual(selectStations(list, { only: 'concept' }).map((s) => s.id), ['concept']);
  assert.throws(() => selectStations(list, { only: 'no-such-station' }), /--only: unknown station "no-such-station"/);
  assert.throws(() => selectStations(list, { from: 'nope' }), /--from: unknown station/);
  assert.throws(() => selectStations(list, { to: 'nope' }), /--to: unknown station/);
  const slice = selectStations(list, { from: 'primer', to: 'content' }).map((s) => s.id);
  assert.deepEqual(slice, ['primer', 'index-primer', 'concept', 'content']);
  assert.throws(() => selectStations(list, { from: 'content', to: 'primer' }), /comes before --from/);
  assert.throws(() => selectStations(stationsFor({ noDeploy: true }), { only: 'deploy' }), /switched off by a --no-\* option/);
  // the stations the old --help forgot are selectable
  for (const id of ['make-ask', 'make-overview', 'check-claims']) assert.deepEqual(selectStations(list, { only: id }).map((s) => s.id), [id]);
});

test('--help lists EXACTLY the table\'s local stations, in run order', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const block = r.stdout.split('STATIONS (')[1].split('WHAT YOU NEED')[0].split('\n').slice(1).join(' ');
  assert.deepEqual(block.split(/[\s·]+/).filter(Boolean), stationIds('local'));
  assert.ok(!/ship-best-effort|register-kb/.test(r.stdout), 'the removed no-op flags are not advertised in --help');
});

test('CLI: the removed no-op aliases --ship-best-effort and --register-kb are rejected, not silently accepted', () => {
  for (const flag of ['--ship-best-effort', '--register-kb']) {
    const r = spawnSync(process.execPath, [BIN, 'owner/widget', flag, '--dry-run'], { encoding: 'utf8', cwd: tmp(), env: { PATH: process.env.PATH, HOME: tmp() } });
    assert.equal(r.status, 2, `${flag} must be refused`);
    assert.match(r.stderr, new RegExp(`unknown flag: ${flag}`));
  }
});

test('CLI: --dry-run makes no credential demand (the old preflight read dead camel-cased keys and refused)', () => {
  const r = spawnSync(process.execPath, [BIN, 'owner/widget', '--dry-run', '--no-deploy'], { encoding: 'utf8', cwd: tmp(), env: { PATH: process.env.PATH, HOME: tmp() } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /--dry-run: plan only/);
  assert.ok(!/MISSING/.test(r.stderr));
});

test('run(): an unknown --only is an error, not an empty plan', async () => {
  await assert.rejects(() => run('owner/widget', { only: 'no-such-station', dryRun: true }), /unknown station/);
});

test('buildStations: every local station has a runner and carries its table fields', () => {
  const built = buildStations({});
  assert.deepEqual(built.map((s) => s.id), stationIds('local'));
  for (const s of built) assert.equal(typeof s.run, 'function', s.id);
});

// ── advisory check-claims ─────────────────────────────────────────────────────────────────────────────
function claimsBuild({ citations, install }) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'p.jsonl'), JSON.stringify({ id: 1, text: 'widget scans receipts' }) + '\n');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    content: { sections: { getStarted: { install, steps: [] } }, citations },
    kb: { passagesPath: path.join(dir, 'p.jsonl') },
  }));
  return dir;
}

test('claims station: records ungrounded claims in the claims slot and still passes (advisory, never blocks)', async () => {
  const dir = claimsBuild({ citations: [{ claim: 'ok', passageId: 1 }, { claim: 'invented', passageId: 999 }], install: 'npm install widget-pro-max' });
  const station = buildStations({}).find((s) => s.id === 'check-claims');
  assert.equal(station.fatal, false);
  const r = await station.run({ buildDir: dir, env: {} });
  assert.equal(r.ok, true);
  const claims = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).claims;
  assert.equal(claims.advisory, true);
  assert.equal(claims.ok, false);
  assert.equal(claims.citations.total, 2);
  assert.deepEqual(claims.citations.missing.map((m) => m.passageId), [999]);
  assert.ok(claims.findings >= 2, `expected the bad citation and the invented install, got ${claims.findings}`);
  assert.equal(claims.commands.checked, undefined, 'the bulky per-command list is not stored');
});

test('claims station: a fully grounded page records zero findings', () => {
  const dir = claimsBuild({ citations: [{ claim: 'ok', passageId: 1 }], install: '' });
  const slot = recordClaims(dir);
  assert.equal(slot.findings, 0);
  assert.equal(slot.ok, true);
});

test('claims station: a checker that throws is recorded as an error, never thrown into the build', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'build.json'), '{}');
  const slot = recordClaims(dir, { check: () => { throw new Error('cannot read build'); } });
  assert.equal(slot.ok, null);
  assert.match(slot.error, /cannot read build/);
  assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).claims.error, /cannot read build/);
});

// ── post-ship gates ───────────────────────────────────────────────────────────────────────────────────
test('overviewAddedToPage: only a produced video or infographic counts', () => {
  assert.equal(overviewAddedToPage(undefined), false);
  assert.equal(overviewAddedToPage({ skipped: 'nlm missing' }), false);
  assert.equal(overviewAddedToPage({ injected: false, infographic: null }), false);
  assert.equal(overviewAddedToPage({ injected: true }), true);
  assert.equal(overviewAddedToPage({ injected: false, infographic: { path: 'assets/overview-infographic.jpg' } }), true);
});

test('followUpSkipReason: re-deploy needs an overview AND a prior deploy; re-publish also needs a published repo', () => {
  const ov = { injected: true };
  assert.match(followUpSkipReason({ overview: { skipped: 'x' }, publish: { liveUrl: 'u' } }, 'redeploy'), /added nothing/);
  assert.match(followUpSkipReason({ overview: ov }, 'redeploy'), /nothing was deployed/);
  assert.equal(followUpSkipReason({ overview: ov, publish: { liveUrl: 'u' } }, 'redeploy'), null);
  assert.match(followUpSkipReason({ overview: ov, publish: { liveUrl: 'u' } }, 'republish'), /no explainer repo/);
  assert.equal(followUpSkipReason({ overview: ov, publish: { liveUrl: 'u', explainerRepoUrl: 'r' } }, 'republish'), null);
});

test('redeploy / republish stations skip without spawning anything when the overview produced nothing', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ overview: { skipped: 'nlm missing' }, publish: { liveUrl: 'https://x.netlify.app' } }));
  for (const id of ['redeploy', 'republish']) {
    const r = await buildStations({}).find((s) => s.id === id).run({ buildDir: dir, env: {} });
    assert.equal(r.ok, true);
    assert.match(r.skipped, /added nothing/);
  }
});
