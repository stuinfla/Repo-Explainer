#!/usr/bin/env node
// tools/concept-tournament.mjs — Stuart's build-economics directive (2026-07-13, see memory
// "build-economics-text-first" + ADR-0008/INV-23 lineage):
//   (1) concepts compete in TEXT mode across models — pennies, not builds;
//   (2) a cheap judge grades the texts;
//   (3) the winner is implemented ONCE by the low-cost executor.
// Runs PRE-AGENT (needs only the clone): README + file-tree digest → one candidate concept
// spec from each model → judged on a swap-test-first rubric → winner seeded into
// build.json.concept with the full tournament record (scores, why, judge) for the registry.
// The implementation agent's Station 2 then VALIDATES the winner against the full KB (truth
// rails stay with the agent) — it refines with grounded specifics but does not re-invent.
//
// Usage: node tools/concept-tournament.mjs <build-dir>
// Env:   ANTHROPIC_API_KEY (or repo-root .env CLAUDE_API_KEY), OPENAI_API_KEY (or OPEN_AI_KEY)
// Exit:  0 with concept seeded · 0 with "SKIPPED" if <2 candidates were reachable (the agent
//        invents the concept itself, as before — the tournament degrades, never blocks a build)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.resolve(process.argv[2] || '');
if (!buildDir || !fs.existsSync(path.join(buildDir, 'build.json'))) {
  console.error('usage: concept-tournament.mjs <build-dir with build.json + repo/>'); process.exit(2);
}
const buildJson = JSON.parse(fs.readFileSync(path.join(buildDir, 'build.json'), 'utf8'));
const repoDir = path.join(buildDir, 'repo');
const log = (m) => process.stderr.write(`[concept-tournament] ${m}\n`);

function envKey(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  try {
    const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const n of names) { const m = txt.match(new RegExp(`^${n}=("?)(.*?)\\1\\s*$`, 'm')); if (m?.[2]) return m[2]; }
  } catch { /* env-only in CI */ }
  return null;
}
const anthropicKey = envKey('ANTHROPIC_API_KEY', 'CLAUDE_API_KEY');
const openaiKey = envKey('OPENAI_API_KEY', 'OPEN_AI_KEY');

// ---- the repo digest: README head + shallow tree + manifest description. Concepts need the
// repo's ESSENCE, not its full KB — that is what keeps this stage at text prices. ----
function digest() {
  const parts = [];
  for (const f of ['README.md', 'readme.md', 'README.rst']) {
    const p = path.join(repoDir, f);
    if (fs.existsSync(p)) { parts.push(`--- README (head) ---\n${fs.readFileSync(p, 'utf8').slice(0, 6000)}`); break; }
  }
  for (const f of ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod']) {
    const p = path.join(repoDir, f);
    if (fs.existsSync(p)) { parts.push(`--- ${f} (head) ---\n${fs.readFileSync(p, 'utf8').slice(0, 1200)}`); break; }
  }
  const tree = [];
  const walk = (dir, depth, prefix) => {
    if (depth > 2 || tree.length > 120) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (/^(\.git|node_modules|dist|target|coverage|\.next|__pycache__)$/.test(e.name)) continue;
      tree.push(prefix + e.name + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1, prefix + '  ');
    }
  };
  walk(repoDir, 0, '');
  parts.push(`--- file tree (2 levels) ---\n${tree.join('\n')}`);
  return parts.join('\n\n');
}

const SPEC_FIELDS = `{
  "metaphor": "<one visual metaphor that IS this repo's mechanism — a stranger should nod>",
  "whyItFits": "<one sentence tying each metaphor element to a named concept of the repo>",
  "palette": "<3-5 colors with hex, born from the metaphor's world>",
  "typePersonality": "<display + body + mono pairing carrying the metaphor's voice>",
  "heroConcept": "<the single opening image: the metaphor rendered literally and concretely>",
  "tagline": "<one line for the social card>",
  "thesis": "<ONE plain jargon-free sentence the whole page proves>",
  "arcBeats": ["<beat 1: a pain the reader has personally shipped>", "<beat 2..5, reader's world first>"],
  "heroAnimDesign": "<what VISIBLY HAPPENS in a 6-10s loop: a value changes / something crosses or pointedly refuses to cross a boundary. Motion must perform the argument — a dot moving along a line is banned>",
  "flagshipDiagramIdea": { "archetype": "<journey|containment|field|fan|tree|exchange>", "whatItShows": "<the thesis motion a stranger sees happen>" },
  "rejectedIdea": "<one direction you considered and rejected, with the reason>"
}`;

const candidatePrompt = (dig) => `You are art-directing a bespoke explainer page for a GitHub repo. Below is the repo's essence. Produce ONE concept spec as pure JSON (no markdown fence, no commentary) with exactly these fields:\n${SPEC_FIELDS}\n\nHard rules: the concept must fail the "swap test" — if it could describe a different repo, it is wrong. Banned: generic glowing networks/particles, person-at-laptop imagery, dark-editorial-because-everyone-does-it (a dark palette needs a reason from the metaphor). The animation design is the most important field.\n\n${dig}`;

async function callAnthropic(model, prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`anthropic ${model}: HTTP ${r.status}`);
  const j = await r.json();
  return j.content?.map((c) => c.text || '').join('') || '';
}
async function callOpenAI(model, prompt) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_completion_tokens: 6000, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`openai ${model}: HTTP ${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}
function parseSpec(text, model) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`${model}: no JSON object in response (len=${String(text).length}, head=${JSON.stringify(String(text).slice(0, 160))})`);
  return JSON.parse(m[0]);
}

const CANDIDATES = [
  { model: 'claude-sonnet-5', call: callAnthropic, needs: anthropicKey },
  { model: 'claude-fable-5', call: callAnthropic, needs: anthropicKey },
  { model: 'gpt-5.6-sol', call: callOpenAI, needs: openaiKey },
];
const JUDGE = { model: 'gpt-5.6-terra', call: callOpenAI, needs: openaiKey };

const dig = digest();
log(`digest: ${dig.length} chars from ${buildJson.repo?.owner || '?'}/${buildJson.repo?.name || '?'}`);

const specs = (await Promise.all(CANDIDATES.map(async (c) => {
  if (!c.needs) { log(`SKIP ${c.model} — no API key`); return null; }
  try {
    const spec = parseSpec(await c.call(c.model, candidatePrompt(dig)), c.model);
    log(`candidate ${c.model}: metaphor="${String(spec.metaphor).slice(0, 90)}"`);
    return { model: c.model, spec };
  } catch (e) { log(`candidate ${c.model} FAILED: ${e.message}`); return null; }
}))).filter(Boolean);

if (specs.length < 2 || !JUDGE.needs) {
  log(`SKIPPED — need >=2 candidates + a judge (got ${specs.length}); the agent will invent the concept itself`);
  process.exit(0);
}

const judgePrompt = `You are judging ${specs.length} competing art-direction concepts for an explainer page about the repo below. Score each 0-100 on: SPECIFICITY (would fail if swapped onto another repo — heaviest weight), thesis clarity for a total stranger, whether the animation design PERFORMS the repo's argument (motion that changes a value or crosses/refuses a boundary — not travel-along-a-path), and distinctiveness from the generic "dark page with glowing cards" house style. Return pure JSON: {"scores":[{"index":0,"score":<int>,"why":"<one line>"}...],"winnerIndex":<int>}\n\nRepo essence:\n${dig.slice(0, 3000)}\n\n${specs.map((s, i) => `=== CANDIDATE ${i} ===\n${JSON.stringify(s.spec, null, 1)}`).join('\n\n')}`;

let verdict;
try { verdict = parseSpec(await JUDGE.call(JUDGE.model, judgePrompt), JUDGE.model); }
catch (e) { log(`judge FAILED: ${e.message} — SKIPPED, agent invents concept`); process.exit(0); }

const winner = specs[verdict.winnerIndex] || specs[0];
for (const s of verdict.scores || []) log(`judge: candidate ${s.index} (${specs[s.index]?.model}) → ${s.score} — ${s.why}`);
log(`WINNER: ${winner.model}`);

buildJson.concept = {
  ...(buildJson.concept || {}),
  ...winner.spec,
  story: { thesis: winner.spec.thesis, arc: winner.spec.arcBeats },
  tournament: {
    judge: JUDGE.model,
    winnerModel: winner.model,
    candidates: (verdict.scores || []).map((s) => ({ model: specs[s.index]?.model, score: s.score, why: s.why })),
    ranAt: new Date().toISOString(),
  },
};
fs.writeFileSync(path.join(buildDir, 'build.json'), JSON.stringify(buildJson, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, outputs: { winner: winner.model, scores: verdict.scores } }));
