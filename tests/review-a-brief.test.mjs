// tests/review-a-brief.test.mjs — the grounding brief (#1: README-first, no agent boilerplate) and the image prompt (#7: no self-contradiction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { gatherBrief, authorVisualBrief, authorContent, READER_STANDARD } = await import('../src/brain.mjs');
const { DEFAULT_MODEL } = await import('../src/claude.mjs');
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

test('#1 — tier 0: under budget pressure the README outranks 25 earlier docs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-a-tier0-'));
  try {
    const lines = [];
    // 25 docs x 600-char snippets overfill the 12k budget on their own and sit BEFORE the README in file order.
    for (let i = 0; i < 25; i++) lines.push(JSON.stringify({ id: `d${i}`, path: `docs/guide${i}.md`, kind: 'doc', source_type: 'doc', text: `A guide to widgetco, part ${i}. `.repeat(30) }));
    lines.push(JSON.stringify({ id: 'readme', path: 'README.md', kind: 'doc', source_type: 'doc', text: 'WIDGETCO turns receipts into budgets. '.repeat(20) }));
    fs.writeFileSync(path.join(dir, 'p.jsonl'), lines.join('\n') + '\n');
    const ids = idsIn(gatherBrief({ kb: { passagesPath: 'p.jsonl' } }, dir));
    assert.ok(ids.has('readme'), 'without the README tier rule it sorts last among docs and the budget drops it');
    assert.equal(ids.size, 20, '12000 chars / 600 per snippet = exactly 20 passages fit');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
    await authorVisualBrief({ _env: { EXPLAINMYREPO_BRAIN: 'api' }, repo: { name: 'fixture' } }, { apiKey: 'test-key', model: DEFAULT_MODEL });
  } finally { globalThis.fetch = realFetch; }
  const prompt = `${sent.system}\n${sent.messages[0].content}`;
  assert.match(prompt, /NO ROOMS, NO PROPS, NO PEOPLE/, 'the ban itself must survive');
  assert.match(prompt, /sticky notes as set dressing/, 'the ban list must survive');
  assert.doesNotMatch(prompt, /someone\/something using/i, 'must not ask for a person using it');
  assert.doesNotMatch(prompt, /binders|handwritten/i, 'must not hold up banned props as the model to copy');
  const sticky = prompt.match(/sticky note/gi) || [];
  assert.equal(sticky.length, 1, 'sticky notes may appear only in the ban list');
});

test('two doors — the real authorContent request carries READER_STANDARD verbatim', async () => {
  const realFetch = globalThis.fetch;
  let sent;
  const section = (extra = {}) => ({ title: 't', ...extra });
  const reply = { sections: { hero: { headline: 'h', lede: 'l' }, problem: section(), whatItIs: section(), insight: section({ oh: 'o' }), howItWorks: section(), useCases: section({ cases: [] }), getStarted: section({ steps: [] }), pack: section() } };
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(reply) }], stop_reason: 'end_turn', usage: {} }) };
  };
  try {
    await authorContent({ _env: { EXPLAINMYREPO_BRAIN: 'api' }, repo: { name: 'fixture' } }, { apiKey: 'test-key', model: DEFAULT_MODEL });
  } finally { globalThis.fetch = realFetch; }
  assert.ok(READER_STANDARD.length > 800 && /FIFTEEN-YEAR-OLD/.test(READER_STANDARD), 'the block is the real reader standard');
  assert.ok(sent.system.includes(READER_STANDARD), 'authorContent must put READER_STANDARD, word for word, in the system prompt');
  assert.match(sent.system, /INV-24/, 'and the gate that enforces it is named');
});
