// tests/readme-enhance.station.test.mjs — the REAL station, run as a child process in dry-run mode.
// Nothing here touches the network, gh, or the ledger: README_OUTREACH_DRYRUN=1 writes the exact text
// that would be sent. What this pins is the station's wiring: who is skipped, what is written, and that
// the owner's README survives byte-for-byte as a subsequence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSystemMap, renderDecision } from '../src/story-diagrams.mjs';
import { SYSTEM_MAP, DECISION } from './fixtures/story-claude-swap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION = path.join(HERE, '..', 'tools', 'readme-enhance.mjs');

const PLAIN_README = '# claude-swap\n\nMulti-account switcher for Claude Code.\n\n## Installation\n\n```bash\nuv tool install claude-swap\n```\n';
const ASCII_README = '# pipe\n\nA tiny pipeline.\n\n## Flow\n\n```text\n┌─────┐   ┌─────┐\n│ in  │ ─▶│ out │\n└─────┘   └─────┘\n```\n';

function makeBuild({ readme = PLAIN_README, publish = {}, repo = {}, leaveOutDiagrams = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-'));
  const clone = path.join(dir, 'repo');
  fs.mkdirSync(clone);
  fs.writeFileSync(path.join(clone, 'README.md'), readme);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'architecture.svg'), renderSystemMap(SYSTEM_MAP));
  fs.writeFileSync(path.join(dir, 'assets', 'flow.svg'), renderDecision(DECISION));
  const build = {
    repo: { owner: 'realiti4', name: 'claude-swap', slug: 'claude-swap', clonePath: clone, defaultBranch: 'main', ...repo },
    publish: { liveUrl: 'https://claude-swap-explainer.netlify.app', explainerRepoUrl: 'https://github.com/stuinfla/realiti4-claude-swap-explainer', ...publish },
    visuals: leaveOutDiagrams ? {} : {
      architectureDiagram: { svgPath: 'assets/architecture.svg', altText: 'What claude-swap plugs into. Accounts feed one engine that drives the CLI, a dashboard and a menu bar.' },
      flowDiagram: { svgPath: 'assets/flow.svg', altText: 'The moment claude-swap switches you. Work is over the line, personal has the most headroom and is picked.' },
    },
  };
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(build, null, 2));
  return { dir, clone };
}

function runStation(dir, env = {}) {
  const ledger = path.join(dir, 'ledger.jsonl');
  const r = spawnSync(process.execPath, [STATION, dir], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, README_OUTREACH_DRYRUN: '1', README_OUTREACH_AS: 'stuinfla', EMR_OUTREACH_LEDGER: ledger, ...env },
  });
  const line = r.stdout.trim().split('\n').pop();
  return { status: r.status, stderr: r.stderr, out: line ? JSON.parse(line) : null, ledger, build: JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')) };
}

const subsequence = (small, big) => { let i = 0; for (const l of big) if (i < small.length && l === small[i]) i++; return i === small.length; };

test('default: ON, issue-first — writes the proposal and the exact issue text, sends nothing', () => {
  const { dir } = makeBuild();
  const r = runStation(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.build.readmePr.kind, 'issue');
  assert.equal(r.build.readmePr.prUrl, 'dry-run');
  assert.equal(r.build.readmePr.mode, 'fallback');
  const issue = fs.readFileSync(path.join(dir, 'readme-proposal', 'ISSUE.md'), 'utf8');
  assert.match(issue, /^# A visual README for claude-swap\? \(happy to send a PR\)/);
  assert.match(issue, /I haven't touched your repo/);
  assert.equal(fs.existsSync(r.ledger), false, 'a dry run must not write the ledger');
});

test('the rendered-README link is the first link in the message and points at the hosted preview', () => {
  const { dir } = makeBuild();
  runStation(dir);
  const issue = fs.readFileSync(path.join(dir, 'readme-proposal', 'ISSUE.md'), 'utf8');
  const first = issue.match(/\]\((https:\/\/[^)]+)\)/)[1];
  assert.equal(first, 'https://github.com/stuinfla/realiti4-claude-swap-explainer/blob/main/readme-proposal/README.md');
});

test('the proposed README is the original plus additions — never less', () => {
  const { dir } = makeBuild();
  runStation(dir);
  const proposed = fs.readFileSync(path.join(dir, 'readme-proposal', 'README.md'), 'utf8');
  assert.ok(subsequence(PLAIN_README.replace(/\n$/, '').split('\n'), proposed.split('\n')));
  assert.match(proposed, /explainmyrepo:link:start/);
  assert.match(proposed, /docs\/explainer\/architecture\.svg/);
});

test('the graphics shipped are the repo\'s own story diagrams, byte-for-byte', () => {
  const { dir } = makeBuild();
  runStation(dir);
  const shipped = fs.readFileSync(path.join(dir, 'readme-proposal', 'docs', 'explainer', 'architecture.svg'), 'utf8');
  assert.equal(shipped, renderSystemMap(SYSTEM_MAP));
  assert.match(shipped, /✕ Codex/);
});

test('ASCII README: diagrams are converted in place and the fallback graphics are NOT added', () => {
  const { dir } = makeBuild({ readme: ASCII_README, repo: { name: 'pipe' } });
  const r = runStation(dir);
  assert.equal(r.build.readmePr.mode, 'ascii');
  const proposed = fs.readFileSync(path.join(dir, 'readme-proposal', 'README.md'), 'utf8');
  assert.match(proposed, /docs\/explainer\/diagram-1\.svg/);
  assert.doesNotMatch(proposed, /explainmyrepo:start/);
  assert.ok(fs.existsSync(path.join(dir, 'readme-proposal', 'docs', 'explainer', 'diagram-1.svg')));
  assert.ok(subsequence(ASCII_README.replace(/\n$/, '').split('\n'), proposed.split('\n')));
});

test('pr channel: wording switches to a PR and notes the issue it follows up', () => {
  const { dir } = makeBuild();
  // dry run skips the fork/push, which is exactly what we want here: only the text is under test
  const r = runStation(dir, { README_OUTREACH: 'pr', README_ENHANCE_ISSUE: '12' });
  assert.equal(r.build.readmePr.kind, 'pr');
  const pr = fs.readFileSync(path.join(dir, 'readme-proposal', 'PR.md'), 'utf8');
  assert.match(pr, /^# docs: a visual README to help more people discover claude-swap/);
  assert.match(pr, /Follow-up to #12, as offered\./);
});

test('voice: README_PR_INTRO + README_PR_SIGNOFF give the sender\'s own first-person tone', () => {
  const { dir } = makeBuild();
  runStation(dir, { README_PR_INTRO: 'I really found {repo} helpful.', README_PR_SIGNOFF: 'Stuart' });
  const issue = fs.readFileSync(path.join(dir, 'readme-proposal', 'ISSUE.md'), 'utf8');
  assert.match(issue, /I really found claude-swap helpful\./);
  assert.match(issue, /\nStuart\n/);
});

test('OPT-OUT: README_ENHANCE=0 sends nothing and says why', () => {
  const { dir } = makeBuild();
  const r = runStation(dir, { README_ENHANCE: '0' });
  assert.equal(r.status, 0);
  assert.equal(r.build.readmePr.prUrl, 'declined');
  assert.equal(r.build.readmePr.reason, 'opted-out');
  assert.equal(fs.existsSync(path.join(dir, 'readme-proposal')), false);
});

test('GUARD: never contacts the owner about their own repo', () => {
  const { dir } = makeBuild();
  const r = runStation(dir, { README_OUTREACH_AS: 'realiti4' });
  assert.equal(r.build.readmePr.prUrl, 'skipped');
  assert.equal(r.build.readmePr.reason, 'own-repo');
});

test('GUARD: never contacts about a private repo', () => {
  const { dir } = makeBuild({ repo: { private: true } });
  assert.equal(runStation(dir).build.readmePr.reason, 'private-source-repo');
});

test('GUARD: nothing to show means nothing to send (no live page / no explainer repo)', () => {
  assert.equal(runStation(makeBuild({ publish: { liveUrl: '' } }).dir).build.readmePr.reason, 'no-live-url');
  assert.equal(runStation(makeBuild({ publish: { explainerRepoUrl: '' } }).dir).build.readmePr.reason, 'no-explainer-repo');
});

test('fails loud (non-zero) when enabled and a declared input is missing', () => {
  const { dir } = makeBuild({ leaveOutDiagrams: true });
  const r = runStation(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /architectureDiagram\.svgPath is absent/);
});

// ── the good-citizen rules, exercised THROUGH the station (a dry run still reads the ledger) ──────
const seed = (dir, rows) => fs.writeFileSync(path.join(dir, 'ledger.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const sentRow = (repo, hoursAgo) => ({ type: 'sent', repo, kind: 'issue', url: `https://github.com/${repo}/issues/1`, ts: new Date(Date.now() - hoursAgo * 3_600_000).toISOString() });

test('GUARD: one contact per repo, ever — a second run is refused even weeks later', () => {
  const { dir } = makeBuild();
  seed(dir, [sentRow('realiti4/claude-swap', 24 * 30)]);
  const r = runStation(dir);
  assert.equal(r.build.readmePr.prUrl, 'skipped');
  assert.equal(r.build.readmePr.reason, 'already-contacted');
});

test('GUARD: the daily cap stops the sixth message in 24 hours', () => {
  const { dir } = makeBuild();
  seed(dir, Array.from({ length: 5 }, (_, i) => sentRow(`o/r${i}`, i + 1)));
  const r = runStation(dir);
  assert.equal(r.build.readmePr.prUrl, 'skipped');
  assert.match(r.build.readmePr.reason, /daily-cap-reached \(5\/5/);
});

test('the cap is configurable and sends resume under it', () => {
  const { dir } = makeBuild();
  seed(dir, Array.from({ length: 5 }, (_, i) => sentRow(`o/r${i}`, i + 1)));
  const r = runStation(dir, { README_OUTREACH_DAILY_CAP: '6' });
  assert.equal(r.build.readmePr.prUrl, 'dry-run');
});

test('the PR follow-up is NOT blocked by the one-contact rule (it is the second step of the same contact)', () => {
  const { dir } = makeBuild();
  seed(dir, [sentRow('realiti4/claude-swap', 48)]);
  const r = runStation(dir, { README_OUTREACH: 'pr', README_ENHANCE_ISSUE: '3' });
  assert.equal(r.build.readmePr.prUrl, 'dry-run');
  assert.equal(r.build.readmePr.kind, 'pr');
});
