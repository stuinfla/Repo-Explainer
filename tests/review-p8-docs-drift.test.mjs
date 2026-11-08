// tests/review-p8-docs-drift.test.mjs — the numbers and names the docs state are computed from the code that decides
// them: the two quality tiers, the borderline band, the station table, the doors. A doc that disagrees with the code fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePass, evaluateShipworthy, BORDERLINE, SHIP_OPERATORS } from '../tools/quality-grade.mjs';
import { STATIONS, stationIds } from '../src/stations.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
// Every living doc that states the quality bars. ADRs 0005-0010 and docs/ddd/ are historical records and keep the
// numbers they were written with; ADRs 0011-0016 and the README/contract/skill/command/prompts must match the code.
const DOCS = ['README.md', 'tools/CONTRACT.md', 'skills/explainmyrepo/SKILL.md', 'commands/explainmyrepo.md', 'docs/prompts/codex-explainer-build.md',
  'ask-service/README.md', ...fs.readdirSync(path.join(REPO, 'docs/adr')).filter((f) => /^001[1-6]-/.test(f)).map((f) => `docs/adr/${f}`)];

// ── thresholds, found by BEHAVIOUR (scan the boundary of the real functions), not by copying their source ──
const ALL_YES = [true, true, true, true, true, true];
const SHIP_YES = Object.fromEntries(['believeIUnderstand', 'approachable', 'explainsToNovice', 'architectureConfidence', 'makesMeSmile', 'zeroKnowledgeReader'].map((k) => [k, true]));
const first = (fn) => { for (let v = 0; v <= 100; v++) if (fn(v)) return v; throw new Error('no threshold found'); };
const T = {
  shipMean: first((v) => evaluateShipworthy({ mean: v, min: 100, operatorQuestions: SHIP_YES })),
  shipMin: first((v) => evaluateShipworthy({ mean: 100, min: v, operatorQuestions: SHIP_YES })),
  exMean: first((v) => evaluatePass({ mean: v, min: 100, operatorQuestions: ALL_YES })),
  exMin: first((v) => evaluatePass({ mean: 100, min: v, operatorQuestions: ALL_YES })),
};

test('the thresholds the code enforces are the ones the tests below look for (sanity: ship 82/70, exemplary 90/85)', () => {
  assert.deepEqual(T, { shipMean: 82, shipMin: 70, exMean: 90, exMin: 85 });
  assert.equal(SHIP_OPERATORS.length, 5);
});

test('every "mean N" and "min N" the docs state is one of the real thresholds', () => {
  const means = new Set([T.shipMean, T.exMean]);
  const mins = new Set([T.shipMin, T.exMin]);
  for (const f of DOCS) {
    const text = read(f);
    // every phrasing of "mean <bar>": "mean 90", "mean >= 90", "mean ≥ 90", "mean of at least 90", "mean at least 90", "mean above 90" (a measured "mean of 88" is not a bar)
    for (const m of text.matchAll(/\bmean(?: score)?\s*(?:>=|≥|=|of at least|at least|above|over)?\s*(\d{2,3})(?![-–]\d|\.\d)/gi)) {
      assert.ok(means.has(Number(m[1])), `${f}: "${m[0]}" states a mean bar of ${m[1]}; the code's bars are ${[...means]}`);
    }
    for (const m of text.matchAll(/\bmin(?:imum)?(?: axis)?(?: score)?\s*(?:>=|≥|=|of at least|at least|above|over)?\s*(\d{2,3})(?![-–]\d|\.\d)/gi)) {
      assert.ok(mins.has(Number(m[1])), `${f}: "${m[0]}" states a min-axis bar of ${m[1]}; the code's bars are ${[...mins]}`);
    }
  }
});

test('the README and the contract state BOTH tiers, and the borderline re-grade band', () => {
  const readme = read('README.md');
  assert.ok(readme.includes(`ship tier ${T.shipMean}/${T.shipMin}`), 'README states the ship tier as mean/min');
  assert.ok(readme.includes(`exemplary tier ${T.exMean}/${T.exMin}`), 'README states the exemplary tier as mean/min');
  const contract = read('tools/CONTRACT.md');
  assert.ok(contract.includes(`mean >= ${T.shipMean}, min axis >= ${T.shipMin}`), 'CONTRACT states the ship tier');
  assert.ok(contract.includes(`mean >= ${T.exMean}, min axis >= ${T.exMin}`), 'CONTRACT states the exemplary tier');
  assert.ok(contract.includes(`${BORDERLINE.center}+-${BORDERLINE.band}`), 'CONTRACT states the borderline band');
  assert.ok(readme.includes(`mean ${BORDERLINE.center - BORDERLINE.band}-${BORDERLINE.center + BORDERLINE.band}`), 'README states the borderline band');
  const skill = read('skills/explainmyrepo/SKILL.md');
  assert.ok(skill.includes(`mean ≥ ${T.shipMean}`) && skill.includes(`mean ≥ ${T.exMean}`), 'SKILL states both tiers');
});

test('no doc still claims a 95 bar or that deploy refuses on score', () => {
  for (const f of DOCS) {
    const text = read(f);
    assert.ok(!/cannot reach 95|score\s*(?:>=|≥)\s*95|mean\s*(?:>=|≥)\s*95/i.test(text), `${f}: a stale 95 bar`);
    assert.ok(!/deploy(?:s)? refuses (?:a |any )?(?:page )?below/i.test(text), `${f}: says deploy refuses on a low score`);
  }
});

// ── the station table: stations.svg carries one data-station group per station, with the same fatal flag and doors ──
test('assets/diagrams/stations.svg has exactly the stations of src/stations.mjs, with the same fatal flag and doors', () => {
  const svg = read('assets/diagrams/stations.svg');
  const drawn = [...svg.matchAll(/<g data-station="([^"]+)" data-fatal="(true|false)" data-doors="([^"]+)"/g)]
    .map((m) => ({ id: m[1], fatal: m[2] === 'true', doors: m[3].split(',') }));
  assert.deepEqual(drawn.map((d) => d.id), STATIONS.map((s) => s.id), 'same stations, same order');
  for (const s of STATIONS) {
    const d = drawn.find((x) => x.id === s.id);
    assert.equal(d.fatal, s.fatal, `${s.id}: fatal flag`);
    assert.deepEqual(d.doors, s.doors, `${s.id}: doors`);
  }
});

test('the README names every station and says two doors, never three; the doors diagram exists', () => {
  const readme = read('README.md');
  for (const id of stationIds()) {
    const re = new RegExp(`(?<![\\w:-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
    assert.ok(re.test(readme), `README mentions station ${id} as a whole word`);
  }
  assert.ok(/two doors/i.test(readme));
  assert.ok(!/three doors|one brain/i.test(readme), 'the old "three doors / one brain" claim is gone');
  assert.ok(fs.existsSync(path.join(REPO, 'assets/diagrams/two-doors.svg')));
  const doors = new Set(STATIONS.flatMap((s) => s.doors));
  assert.deepEqual([...doors].sort(), ['hosted', 'local'], 'the station table has exactly two doors');
});

test('the Ask box is documented as local-door only exactly while the station table says so', () => {
  const ask = STATIONS.find((s) => s.id === 'make-ask');
  const localOnly = ask.doors.length === 1 && ask.doors[0] === 'local';
  const says = /local[- ]door only/i.test(read('README.md')) && /local door/i.test(read('ask-service/README.md'));
  assert.equal(says, localOnly, 'README/ask-service docs match make-ask.doors');
});

// ── the hosted agent follows SKILL.md: every file it tells the agent to run must exist ──
test('SKILL.md only points the hosted agent at tools and files that exist, and names no deleted ones', () => {
  const skill = read('skills/explainmyrepo/SKILL.md');
  for (const m of skill.matchAll(/\btools\/([a-z0-9-]+\.mjs)/g)) assert.ok(fs.existsSync(path.join(REPO, 'tools', m[1])), `SKILL.md names tools/${m[1]}, which does not exist`);
  for (const m of skill.matchAll(/\bnode (kb\/[a-z0-9-]+\.mjs)/g)) assert.ok(fs.existsSync(path.join(REPO, m[1])), `SKILL.md runs ${m[1]}, which does not exist`);
  for (const gone of ['make-dropin', 'postCapManualFix', 'layoutRhythm', 'DEPLOY_FORCE']) assert.ok(!skill.includes(gone), `SKILL.md still mentions the removed ${gone}`);
  assert.ok(!/Vercel is a one-line swap/.test(skill));
  // the tool PATH, not the bare word ("deploy" and "notify" appear in any prose)
  for (const s of STATIONS.filter((x) => x.tool && x.doors.includes('hosted'))) {
    assert.ok(skill.includes(`tools/${s.tool}.mjs`), `SKILL.md names the hosted tool as tools/${s.tool}.mjs`);
  }
});

// ── the tool table in tools/CONTRACT.md says "local" exactly for the stations the table runs on the local door only ──
test('tools/CONTRACT.md tool table: the Door column agrees with src/stations.mjs for every tool', () => {
  const rows = [...read('tools/CONTRACT.md').matchAll(/^\| \*\*([a-z-]+)\*\* \| ([^|]+) \|/gm)].map((m) => ({ tool: m[1], door: m[2] }));
  assert.ok(rows.length >= 15, 'found the tool table rows');
  for (const { tool, door } of rows) {
    const st = STATIONS.find((x) => x.tool === tool);
    assert.ok(st, `CONTRACT lists ${tool}, which no station runs`);
    const says = /local/i.test(door) && !/both/i.test(door) ? ['local'] : ['local', 'hosted'];
    assert.deepEqual(says, st.doors, `CONTRACT says ${tool} runs on "${door.trim()}", the station table says ${st.doors}`);
  }
});

test('no doc says the station table lists readme-enhance on both doors, and every ADR 0005-0016 names no removed knob', () => {
  const dir = path.join(REPO, 'docs/adr');
  for (const f of fs.readdirSync(dir).filter((x) => /^00(0[5-9]|1[0-6])-/.test(x))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/station table lists\s+`?readme-enhance`?\s+on both doors/i.test(text), `${f}: readme-enhance is local-only in src/stations.mjs`);
    for (const gone of ['postCapManualFix', 'DEPLOY_FORCE', 'flowRowsFromModel']) {
      const bare = text.replace(new RegExp(`[^\\n]*(?:since deleted|neither name exists)[^\\n]*`, 'g'), '');
      assert.ok(!bare.includes(gone), `${f}: still names the removed ${gone}`);
    }
  }
});

// ── ADR hygiene ──
test('ADRs 0005-0016 each carry a Status, a Date and an Updated line near the top', () => {
  const dir = path.join(REPO, 'docs/adr');
  const files = fs.readdirSync(dir).filter((f) => /^00(0[5-9]|1[0-6])-/.test(f));
  assert.equal(files.length, 12, 'ADRs 0005-0016 are all present');
  for (const f of files) {
    const head = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(0, 14).join('\n');
    for (const k of ['Status', 'Date', 'Updated']) assert.ok(new RegExp(`^\\**${k}\\**:`, 'm').test(head), `${f}: no ${k} line in its header`);
  }
});

test('INV-24 means ReadsAtFifteen only: the Alive Kit invariants were renumbered to INV-29 and up', () => {
  for (const rel of ['docs/adr/0009-alive-kit-local-companions.md', 'docs/ddd/alive-kit-domain.md']) {
    // the explanatory note itself must name the old numbers, so it is excluded from the scan
    const text = read(rel).replace(/^> \*\*Renumbered[\s\S]*?\n\n/m, '').replace(/\([^)]*renumbered[^)]*\)/gi, '');
    const old = [...text.matchAll(/INV-(2[4-8])\b/g)].map((m) => m[0]);
    assert.deepEqual(old, [], `${rel} still uses ${old.join(', ')} for the Alive Kit`);
    assert.match(text, /INV-29/);
  }
});
