// tests/review-a-claims.test.mjs — tools/check-claims.mjs is ADVISORY: it reports bad citations and
// ungrounded commands against the KB, and never fails the build.
// Shapes mirror real builds (explainer-builds/*/build.json: content.citations[{claim,passageId}] with
// string OR number ids; kb/stores/*/<slug>-entrypoints.json install/quickstart/commands[{cmd,raw}]).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { checkClaims, checkBuild, splitCommands, extractStepCommands } = await import('../tools/check-claims.mjs');

const passages = [
  { id: '1', path: 'README.md', text: 'Install with `npm install widgetco` then run `npx widgetco scan ./receipts`.' },
  { id: '2', path: 'src/cli.js', text: 'export function scan() {}' },
];
const entrypoints = { install: ['npm install widgetco'], quickstart: [], commands: [{ cmd: 'npm run test', raw: 'node --test', category: 'test' }] };
const content = (over = {}) => ({
  sections: { getStarted: { install: 'npm install widgetco', steps: ['Run `npx widgetco scan ./receipts` — you see a table.'], ...over } },
  citations: [{ claim: 'it scans receipts', passageId: 1 }, { claim: 'cli', passageId: '2' }],
});

test('#5 — a fully grounded page reports zero findings (number and string ids both resolve)', () => {
  const r = checkClaims({ content: content(), passages, entrypoints, repoUrl: 'https://github.com/o/widgetco' });
  assert.equal(r.advisory, true);
  assert.equal(r.findings, 0, JSON.stringify(r));
  assert.deepEqual([r.citations.total, r.citations.ok], [2, 2]);
  assert.deepEqual([r.commands.total, r.commands.ok], [2, 2]);
});

test('#5 — invented citations and commands are each reported, exactly', () => {
  const c = content({
    install: 'git clone https://github.com/o/widgetco\ncd widgetco && npm install widgetco-pro',
    steps: ['Start it: `widgetco serve --port 9`', { strong: 'Check', text: 'Run `npm run test` to see it pass.' }, 'npx widgetco magic — does magic'],
  });
  c.citations.push({ claim: 'fast', passageId: '999' }, { claim: 'no id' });
  const r = checkClaims({ content: c, passages, ids: { entries: { 1: {}, 2: {} } }, entrypoints, repoUrl: 'https://github.com/o/widgetco.git' });
  assert.deepEqual(r.citations.missing.map((m) => [m.passageId, m.reason]), [['999', 'passageId not in KB'], [null, 'no passageId']]);
  assert.deepEqual(r.commands.ungrounded.map((u) => u.cmd).sort(), ['npm install widgetco-pro', 'npx widgetco magic'].sort());
  assert.equal(r.findings, 4);
  assert.equal(r.ok, false);
  // `widgetco serve` does not start like a known command, so it is not claimed; `cd` and the repo's
  // own clone URL are never findings.
  assert.ok(r.commands.checked.some((x) => x.cmd === 'git clone https://github.com/o/widgetco' && x.groundedIn === 'entrypoints'));
});

test('#5 — splitter handles continuations, chains, comments and shell variables', () => {
  assert.deepEqual(splitCommands('git clone \\\n  https://x/y\ncd y\n# build it\ninit=\'{"a":1}\'\ncargo build --release && cargo test'),
    ['git clone https://x/y', 'cargo build --release', 'cargo test']);
  assert.deepEqual(extractStepCommands(['no commands here', { strong: 'Go', text: 'Use `pnpm dev`, then `open it`.' }]), ['pnpm dev']);
});

test('#5 — CLI is advisory: findings present, exit code 0, structured JSON out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));
  try {
    fs.writeFileSync(path.join(dir, 'p.jsonl'), passages.map((p) => JSON.stringify(p)).join('\n'));
    fs.writeFileSync(path.join(dir, 'e.json'), JSON.stringify(entrypoints));
    const c = content({ install: 'npm install not-real' });
    fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ content: c, kb: { passagesPath: 'p.jsonl', entrypointsPath: 'e.json' } }));
    const run = spawnSync(process.execPath, [path.join(REPO, 'tools', 'check-claims.mjs'), path.join(dir, 'build.json'), '--root', dir], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.findings, 1);
    assert.equal(out.commands.ungrounded[0].cmd, 'npm install not-real');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5 — checkBuild grounds a command in the clone\'s README, and the module exports no second readPassages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));
  try {
    fs.mkdirSync(path.join(dir, 'repo'));
    fs.writeFileSync(path.join(dir, 'repo', 'README.md'), 'Install: `npm install only-in-readme`');
    fs.writeFileSync(path.join(dir, 'p.jsonl'), passages.map((p) => JSON.stringify(p)).join('\n'));
    const mk = (install) => { fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ content: content({ install }), repo: { clonePath: 'repo' }, kb: { passagesPath: 'p.jsonl' } })); return checkBuild(path.join(dir, 'build.json'), { root: dir }); };
    const grounded = mk('npm install only-in-readme');
    assert.deepEqual(grounded.commands.ungrounded, []);
    assert.equal(grounded.commands.checked.find((c) => c.cmd === 'npm install only-in-readme').groundedIn, 'text');
    assert.deepEqual(mk('npm install nowhere').commands.ungrounded.map((u) => u.cmd), ['npm install nowhere']);
    assert.equal((await import('../tools/check-claims.mjs')).readPassages, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
