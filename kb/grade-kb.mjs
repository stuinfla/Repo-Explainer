#!/usr/bin/env node
// grade-kb.mjs — DUAL-METRIC KB answer-quality grader (gate A) [build-plan §3-A, D15-A].
//
// Grades the REAL .rvf through the SAME searchKb() the CLI/MCP use (grade the real door, not an
// adjacent one). Deterministic, offline, CI-repeatable — the primary grader.
//
//   M1  retrieval relevance (0..1) = 0.6·[top-1 path ∈ wantPaths] + 0.4·[any top-k path ∈ wantPaths]
//   M2  answer correctness   (0..1) : assemble the top-k full docs (the fullText ask-kb returns);
//        coverage   = |mustContain ∩ answer| / |mustContain|
//        niceToHave = |niceToHave  ∩ answer| / |niceToHave|   (0 if none specified)
//        penaltyFrac= |forbidden    ∩ answer| / |forbidden|    (0 if none specified)
//        M2 = clamp(0.85·coverage + 0.15·niceToHave − 0.5·penaltyFrac, 0, 1)
//   per-question = 100·(0.4·M1 + 0.6·M2);  stage = mean of its questions;  overall = mean of stages.
//
// Question file (JSONL, one object per line):
//   { "stage":1, "arc":"what-is-it", "query":"…",
//     "wantPaths":["README.md","docs/OVERVIEW.md"],
//     "mustContain":["…","…"], "niceToHave":["…"], "forbidden":["…"] }
//
// Gate A PASSES when overall ≥ THRESHOLD_OVERALL AND every stage ≥ THRESHOLD_STAGE, on the set.
// Exit code: 0 = pass, 1 = below threshold, 2 = usage / missing inputs.
//
// Usage:
//   node kb/grade-kb.mjs --target agent-harness-generator --set tuned   [--variant small|big] [--k 6]
//   node kb/grade-kb.mjs --target agent-harness-generator --set heldout
//   node kb/grade-kb.mjs --target agent-harness-generator --questions path/to/file.jsonl
//
// When no --questions is given it resolves kb/questions/<target>.<set>.jsonl (set default 'tuned').

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchKb } from './ask-kb.mjs';
import { getTarget, defaultTarget } from './kb.config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const THRESHOLD_OVERALL = 98;   // overall must be ≥ 98 [D15-A, §6]
export const THRESHOLD_STAGE = 95;     // every stage must be ≥ 95 [D15-A]

// weights (kept as named constants so the formula is auditable, not magic)
const W_M1 = 0.4, W_M2 = 0.6;
const W_COVERAGE = 0.85, W_NICE = 0.15, W_PENALTY = 0.5;
const W_M1_TOP1 = 0.6, W_M1_ANYK = 0.4;

function parseArgs(argv) {
  const a = { target: defaultTarget, set: 'tuned', variant: undefined, k: 6, questions: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--target') a.target = argv[++i];
    else if (v.startsWith('--target=')) a.target = v.slice(9);
    else if (v === '--set') a.set = argv[++i];
    else if (v.startsWith('--set=')) a.set = v.slice(6);
    else if (v === '--variant') a.variant = argv[++i];
    else if (v.startsWith('--variant=')) a.variant = v.slice(10);
    else if (v === '--k') a.k = parseInt(argv[++i], 10) || 6;
    else if (v.startsWith('--k=')) a.k = parseInt(v.slice(4), 10) || 6;
    else if (v === '--questions') a.questions = argv[++i];
    else if (v.startsWith('--questions=')) a.questions = v.slice(12);
    else if (v === '--json') a.json = true;
  }
  return a;
}

function loadQuestions(file) {
  if (!fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('//') || s.startsWith('#')) continue;
    try { out.push(JSON.parse(s)); } catch (e) { console.error(`[grade] bad question line: ${e.message}`); }
  }
  return out;
}

// case-insensitive substring containment of `needle` anywhere in `hay`.
const contains = (hay, needle) => hay.includes(String(needle).toLowerCase());

// does any of the result paths satisfy a wantPaths entry? A wantPaths token matches a result path
// by case-insensitive substring (so "packages" matches "packages/kernel/..." and "docs/OVERVIEW.md"
// matches its exact path). Returns the matched flag.
function pathMatches(resultPath, wantPaths) {
  const rp = (resultPath || '').toLowerCase();
  return (wantPaths || []).some((w) => rp.includes(String(w).toLowerCase()));
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
const frac = (arr, hay) => (!arr || !arr.length) ? 0 : arr.filter((t) => contains(hay, t)).length / arr.length;

// Grade ONE question against the REAL retrieval pipeline.
export async function gradeQuestion(q, { store, k, variant }) {
  const results = await searchKb({ query: q.query, k, store, variant });
  const topK = results.slice(0, k);
  const paths = topK.map((r) => r.path);

  // M1 — retrieval relevance
  const top1Hit = paths.length > 0 && pathMatches(paths[0], q.wantPaths) ? 1 : 0;
  const anyKHit = paths.some((p) => pathMatches(p, q.wantPaths)) ? 1 : 0;
  const M1 = W_M1_TOP1 * top1Hit + W_M1_ANYK * anyKHit;

  // M2 — answer correctness/completeness over the assembled top-k full docs
  const answer = topK.map((r) => `${r.path}\n${r.fullText || r.text || ''}`).join('\n\n').toLowerCase();
  const coverage = frac(q.mustContain, answer);
  const niceToHave = frac(q.niceToHave, answer);
  const penaltyFrac = frac(q.forbidden, answer);
  const M2 = clamp01(W_COVERAGE * coverage + W_NICE * niceToHave - W_PENALTY * penaltyFrac);

  const score = 100 * (W_M1 * M1 + W_M2 * M2);

  // diagnose bucket (the actionable output for gate.mjs): R = retrieval/reranker (M1 low),
  // C = content/ingestion gap (right doc area, M2 low → fact missing), O = orientation/synthesis.
  let bucket = null;
  if (score < THRESHOLD_STAGE) {
    if (M1 < 0.7) bucket = 'R';
    else if (coverage < 0.85) bucket = 'C';
    else bucket = 'O';
  }
  const missing = (q.mustContain || []).filter((t) => !contains(answer, t));

  return {
    stage: q.stage, arc: q.arc, query: q.query,
    M1: +M1.toFixed(3), M2: +M2.toFixed(3),
    coverage: +coverage.toFixed(3), niceToHave: +niceToHave.toFixed(3), penaltyFrac: +penaltyFrac.toFixed(3),
    score: +score.toFixed(2),
    top1: paths[0] || '(none)', topPaths: paths,
    bucket, missing,
  };
}

// Grade a full set; return { perQuestion, perStage, overall, pass, bucketCounts }.
export async function gradeSet(questions, opts) {
  const perQuestion = [];
  for (const q of questions) perQuestion.push(await gradeQuestion(q, opts));

  const stages = new Map(); // stage -> [scores]
  for (const r of perQuestion) {
    if (!stages.has(r.stage)) stages.set(r.stage, []);
    stages.get(r.stage).push(r.score);
  }
  const perStage = [...stages.entries()]
    .map(([stage, scores]) => ({ stage, score: +(scores.reduce((s, x) => s + x, 0) / scores.length).toFixed(2), n: scores.length }))
    .sort((a, b) => a.stage - b.stage);

  const overall = perStage.length
    ? +(perStage.reduce((s, x) => s + x.score, 0) / perStage.length).toFixed(2)
    : 0;
  const everyStageOk = perStage.every((s) => s.score >= THRESHOLD_STAGE);
  const pass = overall >= THRESHOLD_OVERALL && everyStageOk;

  const bucketCounts = { R: 0, C: 0, O: 0 };
  for (const r of perQuestion) if (r.bucket) bucketCounts[r.bucket]++;

  return { perQuestion, perStage, overall, pass, bucketCounts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = getTarget(args.target);
  const store = target.slug;

  const file = args.questions || path.join(__dirname, 'questions', `${args.target}.${args.set}.jsonl`);
  const questions = loadQuestions(file);
  if (!questions) { console.error(`[grade] questions file not found: ${file}`); process.exit(2); }
  if (!questions.length) { console.error(`[grade] questions file is empty: ${file}`); process.exit(2); }

  const report = await gradeSet(questions, { store, k: args.k, variant: args.variant });

  if (args.json) {
    console.log(JSON.stringify({ target: args.target, set: args.set, variant: args.variant || 'auto', file, ...report }, null, 2));
  } else {
    console.log(`\n=== GRADE: ${args.target} [${args.set}] variant=${args.variant || 'auto'} k=${args.k} ===`);
    console.log('stage | arc                    | M1    | M2    | cov   | score  | bucket | top1');
    console.log('------|------------------------|-------|-------|-------|--------|--------|-----');
    for (const r of report.perQuestion) {
      console.log(
        `${String(r.stage).padStart(5)} | ${String(r.arc || '').padEnd(22)} | `
        + `${r.M1.toFixed(2)}  | ${r.M2.toFixed(2)}  | ${r.coverage.toFixed(2)}  | `
        + `${String(r.score.toFixed(1)).padStart(6)} | ${(r.bucket || ' ok ').padEnd(6)} | ${r.top1}`);
      if (r.missing && r.missing.length) console.log(`      | MISSING mustContain: ${r.missing.join(', ')}`);
    }
    console.log('\nper-stage:');
    for (const s of report.perStage) {
      console.log(`  stage ${s.stage}: ${s.score.toFixed(1)} (${s.n} q)${s.score < THRESHOLD_STAGE ? '  <-- below ' + THRESHOLD_STAGE : ''}`);
    }
    console.log(`\noverall: ${report.overall.toFixed(1)} (need >= ${THRESHOLD_OVERALL}, every stage >= ${THRESHOLD_STAGE})`);
    console.log(`diagnose buckets: R=${report.bucketCounts.R} C=${report.bucketCounts.C} O=${report.bucketCounts.O}`);
    console.log(`RESULT: ${report.pass ? 'PASS' : 'FAIL'}`);
  }

  process.exit(report.pass ? 0 : 1);
}

// Run as CLI when invoked directly.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('[grade] ERROR:', e); process.exit(1); });
}
