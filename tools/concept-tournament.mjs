#!/usr/bin/env node
// tools/concept-tournament.mjs — pre-agent, text-mode concept tournament (both doors).
// Each model drafts one concept spec from the README + file-tree digest, a cheap judge ranks them, and
// the winner is seeded into build.json.concept with the tournament record. The agent then validates it
// against the full KB. Palette/typePersonality are normalised to the knob-object schema assemble-page
// reads (concept.palette = { accent, bg, ... }), so the winner renders.
//
// Usage: node tools/concept-tournament.mjs <build-dir>
// Env:   ANTHROPIC_API_KEY (or .env CLAUDE_API_KEY), OPENAI_API_KEY (or .env OPEN_AI_KEY)
// Exit:  0 with concept seeded ({ok:true, outputs:{winner,scores}, error:null}); 0 with
//        {ok:true, outputs:{}, skipped:"<why>", error:null} if <2 candidates or no judge was reachable (fails
//        open: the single-shot concept station / the agent authors the concept, the tournament never blocks a build).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { priceUsd } from '../src/claude.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = (m) => process.stderr.write(`[concept-tournament] ${m}\n`);

// ---- schema normalisation: the tournament's winner must be readable by assemble-page / make-social-card ----
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;
const COLOR_KNOBS = ['bg', 'bg-2', 'surface', 'surface-2', 'ridge', 'ink', 'ink-2', 'muted', 'faint', 'accent', 'accent-2', 'accent-3'];
const FONT_KEYS = ['display', 'sans', 'mono', 'displayWeight', 'displayCase', 'displayTracking'];
const SAFE_CSS = (v) => typeof v === 'string' && v.trim() && !/[;{}<>]/.test(v) && !/javascript:|url\(/i.test(v);

function hexSaturation(h) {
  const m = h.match(/^#([0-9a-f]{6})$/i) || h.match(/^#([0-9a-f]{3})$/i);
  if (!m) return -1;
  const x = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

/** Palette as the knob object assemble-page requires ({accent, bg, ...}); null when no accent can be had. */
export function normalizePalette(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const key = String(k).replace(/^--/, '').trim().toLowerCase();
      if (COLOR_KNOBS.includes(key) && typeof v === 'string' && COLOR.test(v.trim())) out[key] = v.trim();
      else if ((key === 'color-scheme' || key === 'colorscheme') && /^(dark|light|light dark|dark light)$/i.test(String(v).trim())) out['color-scheme'] = String(v).trim().toLowerCase();
    }
  } else {
    // A prose string or a hex array ("3-5 colors with hex"): only the colours themselves are usable.
    const hexes = [...new Set(JSON.stringify(raw ?? '').match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || [])]
      .sort((a, b) => hexSaturation(b) - hexSaturation(a));
    if (hexes[0]) out.accent = hexes[0];
    if (hexes[1]) out['accent-2'] = hexes[1];
  }
  return out.accent ? out : null;
}

/** typePersonality as the object assemble-page reads; null when nothing safe survives. */
export function normalizeTypePersonality(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of FONT_KEYS) if (SAFE_CSS(raw[k])) out[k] = raw[k].trim();
  if (typeof raw.fontHref === 'string') { const m = raw.fontHref.match(/^https:\/\/[^\s'")]+$/); if (m) out.fontHref = m[0]; }
  return Object.keys(out).length ? out : null;
}

/** Returns a copy of a candidate spec with palette/typePersonality in the renderer's schema (or dropped). */
export function normalizeConceptSpec(spec) {
  const out = { ...spec };
  const palette = normalizePalette(spec.palette);
  if (palette) out.palette = palette; else { delete out.palette; log('winner palette unusable (no accent colour) — dropped; the agent defines it'); }
  const type = normalizeTypePersonality(spec.typePersonality);
  if (type) out.typePersonality = type; else delete out.typePersonality;
  return out;
}

// ---- the repo digest: README head + shallow tree + manifest description. ----
function digest(repoDir) {
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

export const SPEC_FIELDS = `{
  "metaphor": "<one visual metaphor that IS this repo's mechanism — a stranger should nod>",
  "whyItFits": "<one sentence tying each metaphor element to a named concept of the repo>",
  "palette": { "bg": "<hex>", "surface": "<hex>", "ink": "<hex>", "muted": "<hex>", "accent": "<hex, REQUIRED>", "accent-2": "<hex>", "color-scheme": "<dark|light>" },
  "typePersonality": { "display": "<CSS font stack for headings>", "sans": "<CSS font stack for body>", "mono": "<CSS font stack for code>", "fontHref": "<optional https Google Fonts URL>" },
  "heroConcept": "<the single opening image: the metaphor rendered literally and concretely>",
  "tagline": "<one line for the social card>",
  "thesis": "<ONE plain jargon-free sentence the whole page proves>",
  "arcBeats": ["<beat 1: a pain the reader has personally shipped>", "<beat 2..5, reader's world first>"],
  "heroAnimDesign": "<what VISIBLY HAPPENS in a 6-10s loop: a value changes / something crosses or pointedly refuses to cross a boundary. Motion must perform the argument — a dot moving along a line is banned>",
  "flagshipDiagramIdea": { "archetype": "<journey|containment|field|fan|tree|exchange>", "whatItShows": "<the thesis motion a stranger sees happen>" },
  "rejectedIdea": "<one direction you considered and rejected, with the reason>"
}`;

const candidatePrompt = (dig) => `You are art-directing a bespoke explainer page for a GitHub repo. Below is the repo's essence. Produce ONE concept spec as pure JSON (no markdown fence, no commentary) with exactly these fields (palette and typePersonality are OBJECTS of CSS values, not prose):\n${SPEC_FIELDS}\n\nHard rules: the concept must fail the "swap test" — if it could describe a different repo, it is wrong. Banned: generic glowing networks/particles, person-at-laptop imagery, dark-editorial-because-everyone-does-it (a dark palette needs a reason from the metaphor). Surface mode is a choice, not a default: consider light/paper/warm surfaces seriously — pick the mode the METAPHOR lives in (a blueprint lives on paper; a darkroom lives in the dark), and say why in whyItFits. The animation design is the most important field.\n\n${dig}`;

function parseSpec(text, model) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`${model}: no JSON object in response (len=${String(text).length}, head=${JSON.stringify(String(text).slice(0, 160))})`);
  return JSON.parse(m[0]);
}

/** Tournament spend from per-call usage. A model with no sourced rate (the OpenAI ones) makes `usd` null, never $0. */
export function tournamentSpend(calls) {
  let pricedUsd = 0;
  const unpriced = new Set();
  for (const { model, usage } of calls) {
    const usd = usage ? priceUsd(model, { in: usage.in, out: usage.out }) : null;
    if (usd == null) unpriced.add(model); else pricedUsd += usd;
  }
  return { usd: unpriced.size ? null : Math.round(pricedUsd * 1e6) / 1e6, pricedUsd: Math.round(pricedUsd * 1e6) / 1e6, unpriced: [...unpriced], calls: calls.length };
}

/** Merge the winning spec into build.json's concept (pure; the tournament record rides along). */
export function seedConcept(existing, winner, verdict, specs, judgeModel, ranAt = new Date().toISOString(), spend = null) {
  const spec = normalizeConceptSpec(winner.spec);
  return {
    ...(existing || {}),
    ...spec,
    story: { thesis: spec.thesis, arc: spec.arcBeats },
    tournament: {
      judge: judgeModel,
      winnerModel: winner.model,
      candidates: (verdict.scores || []).map((s) => ({ model: specs[s.index]?.model, score: s.score, why: s.why })),
      ranAt,
      ...(spend ? { spend } : {}),
    },
  };
}

async function main() {
  const buildDir = path.resolve(process.argv[2] || '');
  if (!buildDir || !fs.existsSync(path.join(buildDir, 'build.json'))) {
    console.error('usage: concept-tournament.mjs <build-dir with build.json + repo/>'); process.exit(2);
  }
  const buildJson = JSON.parse(fs.readFileSync(path.join(buildDir, 'build.json'), 'utf8'));
  const repoDir = path.join(buildDir, 'repo');

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

  async function callAnthropic(model, prompt) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(`anthropic ${model}: HTTP ${r.status}`);
    const j = await r.json();
    return { text: j.content?.map((c) => c.text || '').join('') || '', usage: { in: j.usage?.input_tokens, out: j.usage?.output_tokens } };
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
    return { text: j.choices?.[0]?.message?.content || '', usage: { in: j.usage?.prompt_tokens, out: j.usage?.completion_tokens } };
  }

  const CANDIDATES = [
    { model: 'claude-sonnet-5-5', call: callAnthropic, needs: anthropicKey },
    { model: 'claude-fable-5-1', call: callAnthropic, needs: anthropicKey },
    { model: 'gpt-5.6-sol', call: callOpenAI, needs: openaiKey },
  ];
  const JUDGE = { model: 'gpt-5.6-terra', call: callOpenAI, needs: openaiKey };

  const dig = digest(repoDir);
  log(`digest: ${dig.length} chars from ${buildJson.repo?.owner || '?'}/${buildJson.repo?.name || '?'}`);

  const calls = [];   // every paid call's usage, for the spend record
  const ask = async (c, prompt) => { const r = await c.call(c.model, prompt); calls.push({ model: c.model, usage: r.usage }); return r.text; };

  const specs = (await Promise.all(CANDIDATES.map(async (c) => {
    if (!c.needs) { log(`SKIP ${c.model} — no API key`); return null; }
    try {
      const spec = parseSpec(await ask(c, candidatePrompt(dig)), c.model);
      log(`candidate ${c.model}: metaphor="${String(spec.metaphor).slice(0, 90)}"`);
      return { model: c.model, spec };
    } catch (e) { log(`candidate ${c.model} FAILED: ${e.message}`); return null; }
  }))).filter(Boolean);

  if (specs.length < 2 || !JUDGE.needs) {
    return skip(`need >=2 candidates + a judge (got ${specs.length}); the concept is authored without a tournament`);
  }

  const judgePrompt = `You are judging ${specs.length} competing art-direction concepts for an explainer page about the repo below. Score each 0-100 on: SPECIFICITY (would fail if swapped onto another repo — heaviest weight), thesis clarity for a total stranger, whether the animation design PERFORMS the repo's argument (motion that changes a value or crosses/refuses a boundary — not travel-along-a-path), and distinctiveness from the generic "dark page with glowing cards" house style. Return pure JSON: {"scores":[{"index":0,"score":<int>,"why":"<one line>"}...],"winnerIndex":<int>}\n\nRepo essence:\n${dig.slice(0, 3000)}\n\n${specs.map((s, i) => `=== CANDIDATE ${i} ===\n${JSON.stringify(s.spec, null, 1)}`).join('\n\n')}`;

  let verdict;
  try { verdict = parseSpec(await ask(JUDGE, judgePrompt), JUDGE.model); }
  catch (e) { return skip(`judge failed: ${e.message}; the concept is authored without a tournament`); }

  const winner = specs[verdict.winnerIndex] || specs[0];
  for (const s of verdict.scores || []) log(`judge: candidate ${s.index} (${specs[s.index]?.model}) → ${s.score} — ${s.why}`);
  log(`WINNER: ${winner.model}`);

  const spend = tournamentSpend(calls);
  log(`spend: ${spend.usd == null ? `UNPRICED (priced part $${spend.pricedUsd}; no sourced rate for ${spend.unpriced.join(', ')})` : `$${spend.usd}`}`);
  buildJson.concept = seedConcept(buildJson.concept, winner, verdict, specs, JUDGE.model, undefined, spend);
  fs.writeFileSync(path.join(buildDir, 'build.json'), JSON.stringify(buildJson, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, outputs: { winner: winner.model, scores: verdict.scores }, error: null }));
}

// A skip is a success with a reason on stdout (CONTRACT: every tool prints ONE JSON result).
function skip(reason) {
  log(`SKIPPED — ${reason}`);
  console.log(JSON.stringify({ ok: true, outputs: {}, skipped: reason, error: null }));
}

const isEntrypoint = (() => {
  try { return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return true; }
})();
if (isEntrypoint) await main();
