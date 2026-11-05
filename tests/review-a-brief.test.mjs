// tests/review-a-brief.test.mjs — review 3.0.1 findings #1 (grounding brief) and #7 (image prompt).
//
// #1: gatherBrief used the first ~20 passages in FILE order and never the README, so on helix the
//     writer saw ADR-001 x13 + loop ledgers (and, on the rebuilt store, AGENTS.md/CLAUDE.md).
// #7: the visual-brief prompt banned people / notebooks / sticky notes, then asked for "someone using
//     this" and held up binders + a handwritten sticky note as the best example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { gatherBrief, authorVisualBrief } = await import('../src/brain.mjs');
const idsIn = (brief) => new Set([...brief.matchAll(/^• \[([^\]]+)\]/gm)].map((m) => m[1]));

test('#1 — boilerplate-first store: brief carries README head + README passages, no agent boilerplate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-a-'));
  try {
    const lines = [];
    let id = 1;
    const add = (p, kind, text) => lines.push(JSON.stringify({ id: String(id++), path: p, kind, source_type: 'doc', text }));
    for (let i = 0; i < 8; i++) add('AGENTS.md', 'doc', `swarm boilerplate ${i} `.repeat(40));
    for (let i = 0; i < 8; i++) add('CLAUDE.md', 'doc', `claude rules ${i} `.repeat(40));
    for (let i = 0; i < 6; i++) add('CAPABILITIES_STATUS.md', 'doc', `loop ledger ${i} `.repeat(40));
    for (let i = 0; i < 13; i++) add('docs/adr/ADR-001-vault.md', 'adr', `adr text ${i} `.repeat(40));
    add('README.md', 'doc', 'WIDGETCO turns receipts into budgets. '.repeat(10));
    add('docs/guide.md', 'doc', 'A guide to using widgetco. '.repeat(10));
    // 16 one-passage source files so the 12k budget is spent while ADR-001 still has passages left.
    for (let i = 0; i < 16; i++) lines.push(JSON.stringify({ id: String(id++), path: `src/m${i}.js`, kind: 'source', source_type: 'src', text: `export const m${i} = 1; `.repeat(40) }));
    fs.writeFileSync(path.join(dir, 'p.jsonl'), lines.join('\n') + '\n');
    fs.mkdirSync(path.join(dir, 'clone'));
    fs.writeFileSync(path.join(dir, 'clone', 'README.md'), '# WidgetCo\nREADME-HEAD-MARKER: the project framing.\n');
    const brief = gatherBrief({ kb: { passagesPath: 'p.jsonl' }, repo: { clonePath: 'clone' } }, dir);
    const ids = idsIn(brief);
    assert.match(brief, /README-HEAD-MARKER/, 'the README head must be in the brief');
    assert.ok(ids.has('36'), 'the README passage (last in file order) must be sampled');
    assert.ok(ids.has('37'), 'docs must be sampled');
    for (let n = 1; n <= 22; n++) assert.ok(!ids.has(String(n)), `boilerplate/ledger passage ${n} must not crowd out real content`);
    const adr = [...ids].filter((x) => +x >= 23 && +x <= 35);
    assert.ok(adr.length >= 1 && adr.length <= 3, `one ADR file may take at most 3 slots, took ${adr.length}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#1 — real committed helix store: README sampled, no single file dominates', () => {
  const rel = 'kb/stores/helix/helix-kb.passages.jsonl';
  const recs = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = new Map(recs.map((r) => [String(r.id), r]));
  const ids = [...idsIn(gatherBrief({ kb: { passagesPath: rel } }, REPO))];
  const paths = ids.map((i) => byId.get(i)?.path);
  assert.ok(ids.length >= 15, `expected a full sample, got ${ids.length}`);
  assert.ok(paths.includes('README.md'), `README.md must be in the sample; got ${[...new Set(paths)].join(', ')}`);
  assert.ok(!paths.some((p) => /(^|\/)(AGENTS|CLAUDE)\.md$|STATUS\.md$/.test(p)), 'no agent boilerplate or loop ledgers');
  const counts = paths.reduce((m, p) => m.set(p, (m.get(p) || 0) + 1), new Map());
  assert.ok(Math.max(...counts.values()) <= 3, `no file may exceed 3 passages: ${JSON.stringify([...counts])}`);
});

test('#7 — the visual-brief prompt no longer contradicts its own people/props ban', async () => {
  const realFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    const reply = { hero: { prompt: 'x' }, sections: [], diagrams: { bigIdea: { rows: [{ items: ['a'] }] }, insight: { rows: [{ items: ['b'] }] } } };
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(reply) }], stop_reason: 'end_turn', usage: {} }) };
  };
  try {
    await authorVisualBrief({ _env: { EXPLAINMYREPO_BRAIN: 'api' }, repo: { name: 'fixture' } }, { apiKey: 'test-key', model: 'claude-sonnet-5-5' });
  } finally { globalThis.fetch = realFetch; }
  const prompt = `${sent.system}\n${sent.messages[0].content}`;
  assert.match(prompt, /NO ROOMS, NO PROPS, NO PEOPLE/, 'the ban itself must survive');
  assert.match(prompt, /sticky notes as set dressing/, 'the ban list must survive');
  assert.doesNotMatch(prompt, /someone\/something using/i, 'must not ask for a person using it');
  assert.doesNotMatch(prompt, /binders|handwritten/i, 'must not hold up banned props as the model to copy');
  const sticky = prompt.match(/sticky note/gi) || [];
  assert.equal(sticky.length, 1, 'sticky notes may appear only in the ban list');
});
