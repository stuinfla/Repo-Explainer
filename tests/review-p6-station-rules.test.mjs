// tests/review-p6-station-rules.test.mjs — the good-citizen rules on BOTH channels, the hosted-door skip
// order, and the slot write, driven through the real readme-enhance station as a child process (dry-run or a
// failing fake `gh`; no network). Plus pull-ratings' HTTP-error handling via a stubbed fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderSystemMap, renderDecision } from '../src/story-diagrams.mjs';
import { SYSTEM_MAP, DECISION } from './fixtures/story-claude-swap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const STATION = path.join(ROOT, 'tools', 'readme-enhance.mjs');

function makeBuild({ publish = {}, extra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p6st-'));
  const clone = path.join(dir, 'repo');
  fs.mkdirSync(clone); fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(clone, 'README.md'), '# claude-swap\n\nMulti-account switcher.\n');
  fs.writeFileSync(path.join(dir, 'assets', 'architecture.svg'), renderSystemMap(SYSTEM_MAP));
  fs.writeFileSync(path.join(dir, 'assets', 'flow.svg'), renderDecision(DECISION));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    repo: { owner: 'realiti4', name: 'claude-swap', slug: 'claude-swap', clonePath: clone, defaultBranch: 'main' },
    publish: { liveUrl: 'https://claude-swap-explainer.netlify.app', explainerRepoUrl: 'https://github.com/stuinfla/realiti4-claude-swap-explainer', ...publish },
    visuals: { architectureDiagram: { svgPath: 'assets/architecture.svg', altText: 'Plugs in.' }, flowDiagram: { svgPath: 'assets/flow.svg', altText: 'Switches.' } },
    ...extra,
  }, null, 2));
  return dir;
}
function run(dir, env = {}, pathPrefix = '') {
  const r = spawnSync(process.execPath, [STATION, dir], {
    encoding: 'utf8',
    env: { PATH: pathPrefix + process.env.PATH, README_OUTREACH_DRYRUN: '1', README_OUTREACH_AS: 'stuinfla', EMR_OUTREACH_LEDGER: path.join(dir, 'ledger.jsonl'), ...env },
  });
  return { status: r.status, stderr: r.stderr, build: JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')) };
}
const seed = (dir, rows) => fs.writeFileSync(path.join(dir, 'ledger.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const sent = (repo, hoursAgo) => ({ type: 'sent', repo, kind: 'issue', url: `https://github.com/${repo}/issues/1`, ts: new Date(Date.now() - hoursAgo * 3_600_000).toISOString() });
const full = () => Array.from({ length: 5 }, (_, i) => sent(`o/r${i}`, i + 1));

test('PR channel obeys the daily cap too (audit R5 frag 5: it used to be issue-only)', () => {
  const dir = makeBuild(); seed(dir, full());
  const r = run(dir, { README_OUTREACH: 'pr' });
  assert.equal(r.build.readmePr.prUrl, 'skipped');
  assert.match(r.build.readmePr.reason, /daily-cap-reached \(5\/5/);
});

test('PR channel obeys one-contact-per-repo unless it is the offered open-pr step', () => {
  const dir = makeBuild(); seed(dir, [sent('realiti4/claude-swap', 24 * 30)]);
  assert.equal(run(dir, { README_OUTREACH: 'pr' }).build.readmePr.reason, 'already-contacted');
  const dir2 = makeBuild(); seed(dir2, [{ ...sent('realiti4/claude-swap', 24 * 30), number: 1 }, ...full()]);
  const open = run(dir2, { README_OUTREACH: 'pr', README_ENHANCE_ISSUE: '1' });
  assert.equal(open.build.readmePr.prUrl, 'dry-run', 'open-pr is exempt from both rules');
});

test('open-pr exemption needs a REAL matching issue on the ledger, not just a flag', () => {
  const claimed = { README_OUTREACH: 'pr', README_ENHANCE_ISSUE: '7' };
  const prior = { ...sent('realiti4/claude-swap', 24 * 30), number: 7 };
  // flag set, ledger empty of this repo + full cap: cap refuses
  const d1 = makeBuild(); seed(d1, full());
  assert.match(run(d1, claimed).build.readmePr.reason, /daily-cap-reached/);
  // flag set, ledger has an issue for this repo but a DIFFERENT number
  const d2 = makeBuild(); seed(d2, [{ ...prior, number: 8 }]);
  assert.equal(run(d2, claimed).build.readmePr.reason, 'already-contacted');
  // non-numeric / zero flag values never qualify
  for (const bad of ['0', 'x', '7x', '-7']) {
    const d = makeBuild(); seed(d, [prior]);
    assert.equal(run(d, { README_OUTREACH: 'pr', README_ENHANCE_ISSUE: bad }).build.readmePr.reason, 'already-contacted', bad);
  }
  // a PR was already sent: even the right number is refused
  const d3 = makeBuild(); seed(d3, [prior, { ...prior, kind: 'pr', url: 'https://github.com/realiti4/claude-swap/pull/9', number: 9 }]);
  assert.equal(run(d3, claimed).build.readmePr.reason, 'already-contacted');
  // the legitimate case: matching issue, no PR yet, even with the cap full
  const d4 = makeBuild(); seed(d4, [prior, ...full()]);
  assert.equal(run(d4, claimed).build.readmePr.prUrl, 'dry-run');
});

test('no explainer repo is a clean skip BEFORE any gh identity call (hosted door has no gh login)', () => {
  const dir = makeBuild({ publish: { explainerRepoUrl: '' } });
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-fakegh-'));
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "gh: not logged in" >&2\nexit 1\n', { mode: 0o755 });
  const r = run(dir, { README_OUTREACH_DRYRUN: '', README_OUTREACH_AS: '' }, `${bin}${path.delimiter}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.build.readmePr.reason, 'no-explainer-repo');
  assert.doesNotMatch(r.stderr, /cannot identify the sending account/);
});

test('the readmePr slot is REPLACED each run, not merged with stale keys, and other slots survive', () => {
  const dir = makeBuild({ extra: { readmePr: { prUrl: 'old', stale: 'KEEP-ME-OUT' }, marker: { keep: true } } });
  const r = run(dir);
  assert.equal(r.build.readmePr.prUrl, 'dry-run');
  assert.equal('stale' in r.build.readmePr, false);
  assert.deepEqual(r.build.marker, { keep: true });
});

test('pull-ratings: an HTTP error on the submissions fetch is a clear exit 1, not a TypeError', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-pr-'));
  const stub = path.join(tmp, 'stub.mjs');
  fs.writeFileSync(stub, `globalThis.fetch = async (u) => String(u).includes('/submissions')
    ? new Response('{"message":"boom"}', { status: 500 })
    : new Response(JSON.stringify([{ id: 'f1', name: 'build-rating' }]), { status: 200 });\n`);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, path.join(ROOT, 'tools', 'pull-ratings.mjs')], {
    encoding: 'utf8', env: { PATH: process.env.PATH, NETLIFY_AUTH_TOKEN: 'stub' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /submissions fetch failed \(HTTP 500\)/);
  assert.doesNotMatch(r.stderr, /TypeError/);
});
