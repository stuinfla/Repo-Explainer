// tests/make-overview.test.mjs — the NotebookLM follow-up station, run as a child process against STUB
// `nlm` / `ffprobe` / `ffmpeg` binaries on a private PATH. The real NotebookLM CLI is never started: PATH
// holds only the stub dir plus /usr/bin:/bin, and every test asserts the stub's call log is non-empty
// (a real `nlm` would not write it). Scenario knobs live in <stub>/scenario.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_SECONDS, withinCap } from '../src/overview-cap.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'make-overview.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'overview-test-'));

const NLM = `#!${process.execPath}
const fs = require('fs'), path = require('path');
const dir = process.env.STUB_DIR; const a = process.argv.slice(2);
const sc = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
const state = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch { return { n: 0, status: 0, jobs: {} }; } };
const save = (s) => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s));
fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify({ t: Date.now(), a }) + '\\n');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const cmd = a[0] + ' ' + a[1];
const s = state();
if (a[0] === 'login') process.exit(sc.loggedIn === false ? 1 : 0);
if (cmd === 'notebook create') { console.log(JSON.stringify({ id: id(1) })); process.exit(0); }
if (cmd === 'source add') { process.exit(sc.sourceFails ? 1 : 0); }
if (cmd === 'notebook delete') { process.exit(sc.deleteFails ? 1 : 0); }
if (cmd === 'video create') { s.n++; const fmt = a[a.indexOf('--format') + 1]; s.jobs[id(10 + s.n)] = { kind: 'video', fmt }; save(s); console.log(JSON.stringify({ artifact_id: id(10 + s.n) })); process.exit(0); }
if (cmd === 'infographic create') { s.n++; s.jobs[id(10 + s.n)] = { kind: 'infographic' }; save(s); console.log(JSON.stringify({ artifact_id: id(10 + s.n) })); process.exit(0); }
if (cmd === 'studio status') {
  if (sc.mutateBuildJson) { const f = sc.mutateBuildJson; const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.notify = { emailSent: true }; fs.writeFileSync(f, JSON.stringify(j)); }
  s.status++; save(s);
  console.log(JSON.stringify(Object.entries(s.jobs).map(([aid, j]) => {
    const rule = (j.kind === 'video' ? (sc.video || {})[j.fmt] : sc.infographic) || { after: 1, final: 'completed' };
    return { id: aid, status: s.status >= rule.after ? rule.final : 'in_progress' };
  })));
  process.exit(0);
}
if (a[0] === 'download') {
  const o = a[a.indexOf('-o') + 1]; const aid = a[a.indexOf('--id') + 1];
  fs.writeFileSync(o, a[1] === 'video' ? 'MP4:' + s.jobs[aid].fmt : 'PNG');
  process.exit(0);
}
process.exit(2);
`;
const FFPROBE = `#!${process.execPath}
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2); if (a[0] === '-version') { console.log('ffprobe stub'); process.exit(0); }
const sc = JSON.parse(fs.readFileSync(path.join(process.env.STUB_DIR, 'scenario.json'), 'utf8'));
const f = fs.readFileSync(a[a.length - 1], 'utf8').replace('MP4:', '');
console.log(String((sc.duration || {})[f] ?? 60));
`;
const FFMPEG = `#!${process.execPath}
require('fs').writeFileSync(process.argv[process.argv.length - 1], 'IMG');
`;

function setup(scenario = {}, { buildExtra = {}, pageExtra = '' } = {}) {
  const stub = tmp(); const bin = path.join(stub, 'bin'); fs.mkdirSync(bin);
  for (const [n, src] of [['nlm', NLM], ['ffprobe', FFPROBE], ['ffmpeg', FFMPEG]]) { fs.writeFileSync(path.join(bin, n), src); fs.chmodSync(path.join(bin, n), 0o755); }
  fs.writeFileSync(path.join(stub, 'scenario.json'), JSON.stringify(scenario));
  const build = tmp(); const site = path.join(build, 'site'); fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'index.html'), `<html><body><main><div class="sections"><p>sections</p></div></main>${pageExtra}</body></html>`);
  const bj = path.join(build, 'build.json');
  fs.writeFileSync(bj, JSON.stringify({ repo: { name: 'Demo', url: 'https://github.com/o/demo' }, page: { dir: site }, concept: { metaphor: 'A lighthouse. More text.', palette: { bg: '#001', accent: '#fa0' } }, ...buildExtra }));
  const env = { PATH: `${bin}:/usr/bin:/bin`, STUB_DIR: stub, CI: '', GITHUB_ACTIONS: '', OVERVIEW_POLL_MS: '20', OVERVIEW_BUDGET_MS: '8000', HOME: stub };
  const calls = () => { try { return fs.readFileSync(path.join(stub, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  return { stub, build, site, bj, env, calls, slot: () => JSON.parse(fs.readFileSync(bj, 'utf8')).overview };
}
const run = (s, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [TOOL, s.build], { encoding: 'utf8', env: { ...s.env, ...extraEnv } });
  const lines = r.stdout.trim().split('\n'); assert.equal(lines.length, 1, `stdout: ${r.stdout}\n${r.stderr}`);
  assert.ok(s.calls().length > 0, 'the stub nlm was never called — PATH override failed, refusing to trust this run');
  return { status: r.status, out: JSON.parse(lines[0]), stderr: r.stderr };
};
const verbs = (s) => s.calls().map((c) => (c.a[0] === 'download' ? 'download ' + c.a[1] : c.a[0] + ' ' + c.a[1]));

test('video and infographic are queued together, before the first status poll', () => {
  const s = setup(); const r = run(s); assert.equal(r.status, 0, r.stderr);
  const v = verbs(s);
  const firstPoll = v.indexOf('studio status');
  assert.ok(v.indexOf('video create') >= 0 && v.indexOf('infographic create') >= 0);
  assert.ok(v.indexOf('video create') < firstPoll && v.indexOf('infographic create') < firstPoll, `queue order: ${v.join(' > ')}`);
  assert.equal(r.out.outputs.overview.infographic.path, 'assets/overview-infographic.jpg');
  assert.equal(r.out.outputs.overview.durationSec, 60);
  for (const f of ['overview.mp4', 'overview-poster.jpg', 'overview-infographic.jpg']) assert.ok(fs.existsSync(path.join(s.site, 'assets', f)), f);
  const html = fs.readFileSync(path.join(s.site, 'index.html'), 'utf8');
  assert.ok(html.indexOf('data-overview') > -1 && html.indexOf('data-overview') < html.indexOf('<div class="sections">'));
  assert.doesNotMatch(html, /from the project's README/);
});

test('both jobs ride the same status polls: a slow infographic does not double the wait', () => {
  const s = setup({ video: { brief: { after: 3, final: 'completed' } }, infographic: { after: 3, final: 'completed' } });
  const r = run(s); assert.equal(r.status, 0, r.stderr);
  const polls = verbs(s).filter((x) => x === 'studio status').length;
  assert.equal(polls, 3, `serial polling would need 6, got ${polls}`);
  assert.ok(r.out.outputs.overview.infographic);
});

test('the notebook this run created is deleted: success, skip, failed render, timeout', () => {
  const deletions = (s) => s.calls().filter((c) => c.a[0] === 'notebook' && c.a[1] === 'delete');
  const ok = setup(); run(ok); assert.equal(deletions(ok).length, 1);
  assert.deepEqual(deletions(ok)[0].a.slice(2), ['00000000-0000-4000-8000-000000000001', '-y']);

  const failed = setup({ video: { brief: { after: 1, final: 'failed' }, short: { after: 1, final: 'failed' } } });
  const f = run(failed); assert.equal(f.status, 0); assert.match(f.out.outputs.overview.skipped, /no format produced/); assert.equal(deletions(failed).length, 1);

  const noSource = setup({ sourceFails: true });
  const n = run(noSource); assert.match(n.out.outputs.overview.skipped, /could not create the notebook/); assert.equal(deletions(noSource).length, 1);

  const t0 = Date.now();
  const stuck = setup({ video: { brief: { after: 99999, final: 'completed' } }, infographic: { after: 99999, final: 'completed' } });
  const st = run(stuck, { OVERVIEW_BUDGET_MS: '600' });
  assert.equal(st.status, 0); assert.match(st.out.outputs.overview.skipped, /timed out/);
  assert.equal(deletions(stuck).length, 1); assert.ok(Date.now() - t0 < 6000, 'a stuck render must end at the budget, not hang');
  assert.equal(st.out.ok, true);
});

test('an operator-supplied OVERVIEW_NOTEBOOK is used and never deleted', () => {
  const s = setup(); const nbid = '11111111-2222-4333-8444-555555555555';
  const r = run(s, { OVERVIEW_NOTEBOOK: nbid }); assert.equal(r.status, 0, r.stderr);
  const v = verbs(s); assert.ok(!v.includes('notebook create') && !v.includes('source add') && !v.includes('notebook delete'), v.join(' > '));
  assert.ok(s.calls().filter((c) => c.a[0] === 'video').every((c) => c.a[2] === nbid));
});

test('a render over the cap (300s) is discarded and the short format is tried, inside the same run', () => {
  const s = setup({ duration: { brief: 300, short: 45 } });
  const r = run(s); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out.outputs.overview.format, 'short'); assert.equal(r.out.outputs.overview.durationSec, 45);
  const formats = s.calls().filter((c) => c.a[0] === 'video' && c.a[1] === 'create').map((c) => c.a[c.a.indexOf('--format') + 1]);
  assert.deepEqual(formats, ['brief', 'short']);
});

test('CI is a clean skip (exit 0, ok:true), not a failure', () => {
  const s = setup();
  const r = spawnSync(process.execPath, [TOOL, s.build], { encoding: 'utf8', env: { ...s.env, CI: 'true' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim()); assert.equal(out.ok, true);
  assert.match(out.outputs.overview.skipped, /local-door-only/);
  assert.equal(s.calls().length, 0, 'CI must not touch NotebookLM at all');
  assert.match(s.slot().skipped, /local-door-only/);
});

test('it re-reads build.json fresh: a slot another station wrote during the run survives', () => {
  const s = setup({}); const sc = JSON.parse(fs.readFileSync(path.join(s.stub, 'scenario.json'), 'utf8'));
  fs.writeFileSync(path.join(s.stub, 'scenario.json'), JSON.stringify({ ...sc, mutateBuildJson: s.bj }));
  const r = run(s); assert.equal(r.status, 0, r.stderr);
  const bj = JSON.parse(fs.readFileSync(s.bj, 'utf8'));
  assert.deepEqual(bj.notify, { emailSent: true });
  assert.equal(bj.overview.format, 'brief');
});

test('missing login skips without creating anything', () => {
  const s = setup({ loggedIn: false }); const r = run(s);
  assert.match(r.out.outputs.overview.skipped, /nlm missing or not authenticated/);
  assert.deepEqual(verbs(s), ['login --check']);
});

test('SIGTERM mid-render still deletes the notebook', async () => {
  const s = setup({ video: { brief: { after: 99999, final: 'completed' } }, infographic: { after: 99999, final: 'completed' } });
  const child = spawn(process.execPath, [TOOL, s.build], { env: { ...s.env, OVERVIEW_POLL_MS: '200', OVERVIEW_BUDGET_MS: '60000' }, stdio: 'ignore' });
  const exited = new Promise((res) => child.on('exit', res));
  for (let i = 0; i < 100 && !verbs(s).includes('studio status'); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(verbs(s).includes('studio status'), 'render never started');
  child.kill('SIGTERM'); await exited;
  assert.ok(verbs(s).includes('notebook delete'), verbs(s).join(' > '));
});

test('the length cap is 90 seconds: 94.7 rejected, 89.9 accepted, NaN / 0 / negative rejected', () => {
  assert.equal(MAX_SECONDS, 90);
  assert.equal(withinCap(94.7), false);
  assert.equal(withinCap(89.9), true);
  assert.equal(withinCap(90), true);
  assert.equal(withinCap(90.01), false);
  for (const bad of [NaN, 0, -3, Infinity, undefined]) assert.equal(withinCap(bad), false, String(bad));
});

test('a 94.7s render is never shipped: next format is tried, and if none fits the run skips with a reason', () => {
  const a = setup({ duration: { brief: 94.7, short: 80 } }); const r = run(a); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out.outputs.overview.format, 'short'); assert.equal(r.out.outputs.overview.durationSec, 80);
  const b = setup({ duration: { brief: 94.7, short: 94.7 } }); const rb = run(b);
  assert.match(rb.out.outputs.overview.skipped, /no format produced a video under 90s/);
  assert.ok(!fs.existsSync(path.join(b.site, 'assets', 'overview.mp4')), 'an over-cap video must not reach the page');
  assert.doesNotMatch(fs.readFileSync(path.join(b.site, 'index.html'), 'utf8'), /data-overview/);
  const ok = setup({ duration: { brief: 89.9 } }); assert.equal(run(ok).out.outputs.overview.durationSec, 89.9);
});

test('the brief asks NotebookLM for a ~75-second script and never says two minutes', () => {
  const s = setup(); run(s);
  const focus = s.calls().find((c) => c.a[0] === 'video' && c.a[1] === 'create').a;
  const text = focus[focus.indexOf('--focus') + 1];
  assert.match(text, /about 75 seconds/); assert.match(text, /190 spoken words/); assert.doesNotMatch(text, /two.minute/i);
  assert.doesNotMatch(fs.readFileSync(path.join(s.site, 'index.html'), 'utf8'), /two.minute/i);
});
