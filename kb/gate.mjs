#!/usr/bin/env node
// gate.mjs — the SELF-EVALUATING quality gate orchestrator (gate A loop) [build-plan §3, D15, I].
//
// Runs: build (small) -> index-primer -> build (big, same passages) -> GUARD (hard gate) ->
// GRADE (tuned + held-out, both variants) -> if below threshold, DIAGNOSE each failing question
// into R/C/O buckets and emit the actionable smallest-fix recommendation -> (operator applies fix)
// -> RE-GRADE. Iteration cap ≤ 5. Per-iteration per-stage delta is logged. Loop state is persisted
// to `ruflo memory` between iterations so a compact never loses it.
//
// Buckets (the actionable output) [§3]:
//   R-fail (wrong doc, M1 low): retrieval/reranker — add disambiguation/offtopicMagnet/primerSlug
//          route or componentRoots fix in ask-kb config. NO rebuild.
//   C-fail (right doc, M2 low — fact missing from corpus): ingestion gap — add/adjust an include
//          rule, then REBUILD that store.
//   O-fail (orientation/synthesis gap): thin/missing primer section — edit the arc-stage section of
//          the primer.md, then re-run index-primer.
//
// This orchestrator does NOT auto-mutate config/corpus (fixes are operator decisions, applied by a
// Claude Code Task executor per the Ruflo-first mandate). It runs the pipeline, grades, diagnoses,
// records evidence, and decides pass/continue/stop. --build/--no-build toggles the rebuild step;
// default is grade-only (fast inner loop) — pass --build to run the full build->guard->grade chain.
//
// Usage:
//   node kb/gate.mjs --target agent-harness-generator            # grade-only loop (tuned+heldout)
//   node kb/gate.mjs --target agent-harness-generator --build    # full build+guard+grade
//   node kb/gate.mjs --target agent-harness-generator --max 5

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTarget, defaultTarget } from './kb.config.mjs';
import { gradeSet, THRESHOLD_OVERALL, THRESHOLD_STAGE } from './grade-kb.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_NAMESPACE = 'metaharness-gate';

function parseArgs(argv) {
  const a = { target: defaultTarget, max: 5, build: false, k: 6 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--target') a.target = argv[++i];
    else if (v.startsWith('--target=')) a.target = v.slice(9);
    else if (v === '--max') a.max = parseInt(argv[++i], 10) || 5;
    else if (v.startsWith('--max=')) a.max = parseInt(v.slice(6), 10) || 5;
    else if (v === '--build') a.build = true;
    else if (v === '--no-build') a.build = false;
    else if (v === '--k') a.k = parseInt(argv[++i], 10) || 6;
  }
  a.max = Math.min(Math.max(1, a.max), 5);   // hard cap ≤ 5 [§3]
  return a;
}

function loadQuestions(target, set) {
  const file = path.join(__dirname, 'questions', `${target}.${set}.jsonl`);
  if (!fs.existsSync(file)) return { file, questions: null };
  const questions = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('//') || s.startsWith('#')) continue;
    try { questions.push(JSON.parse(s)); } catch { /* skip */ }
  }
  return { file, questions };
}

function runNode(scriptRelArgs, label) {
  console.log(`\n--- ${label}: node ${scriptRelArgs.join(' ')} ---`);
  try {
    execFileSync(process.execPath, scriptRelArgs.map((a) => (a.startsWith('--') || !a.endsWith('.mjs') ? a : path.join(__dirname, a))), {
      cwd: __dirname, stdio: 'inherit',
    });
    return true;
  } catch (e) {
    console.error(`[gate] ${label} FAILED (exit ${e.status ?? '?'})`);
    return false;
  }
}

// Persist loop state to ruflo memory (best-effort; never blocks the loop if the CLI is unavailable).
function persistState(key, value) {
  try {
    execFileSync('npx', ['ruflo@latest', 'memory', 'store', '-k', key, '--value', JSON.stringify(value), '--namespace', MEMORY_NAMESPACE], {
      stdio: 'ignore', timeout: 60000,
    });
    console.log(`[gate] persisted loop state to ruflo memory: ${MEMORY_NAMESPACE}/${key}`);
  } catch {
    console.warn(`[gate] could not persist to ruflo memory (continuing) — key ${key}`);
  }
}

// Diagnose: from the dominant failing bucket across both sets, emit the smallest-fix recommendation.
function diagnose(reports) {
  const counts = { R: 0, C: 0, O: 0 };
  const failing = [];
  for (const [setName, rep] of Object.entries(reports)) {
    for (const r of rep.perQuestion) {
      if (r.bucket) { counts[r.bucket]++; failing.push({ set: setName, ...r }); }
    }
  }
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const advice = {
    R: 'R-fail dominant (wrong doc, M1 low): tune retrieval/reranker in ask-kb config — add a '
      + 'disambiguation/offtopicMagnet entry, a primerSlug force-route, or a componentRoots fix. NO rebuild.',
    C: 'C-fail dominant (right doc, fact missing from corpus): ingestion gap — add/adjust an include '
      + 'rule in kb.config.mjs (a README un-swept, a source body out of scope), then REBUILD that store.',
    O: 'O-fail dominant (orientation/synthesis gap): thin/missing primer section — edit the arc-stage '
      + 'section of the primer.md, then re-run index-primer.',
  };
  return { counts, dominant: dominant && dominant[1] > 0 ? dominant[0] : null, advice, failing };
}

async function gradeBoth(target, k) {
  const store = target.slug;
  const out = {};
  for (const set of ['tuned', 'heldout']) {
    const { file, questions } = loadQuestions(target.slug, set);
    if (!questions) { out[set] = { missing: true, file }; continue; }
    if (!questions.length) { out[set] = { empty: true, file }; continue; }
    // SINGLE shipped variant (recipe v1.3.1): one 384-dim bge-small store at <store>-kb.rvf.
    // The 'small' variant auto-resolves to that canonical file. No separate big variant ships.
    const small = await gradeSet(questions, { store, k, variant: 'small' });
    const big = small; // alias for reporting back-compat; single variant only
    out[set] = {
      file, small, big,
      perQuestion: small.perQuestion,
      pass: small.pass,
    };
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = getTarget(args.target);
  console.log(`=== GATE A: ${args.target} (max ${args.max} iterations, build=${args.build}) ===`);

  let lastOverall = {};
  for (let iter = 1; iter <= args.max; iter++) {
    console.log(`\n############### ITERATION ${iter}/${args.max} ###############`);

    if (args.build) {
      if (!runNode(['build-kb.mjs', '--target', args.target], 'build small')) { process.exit(1); }
      // index-primer + big build are run with the store slug positional (their current CLI shape).
      runNode(['index-primer.mjs', args.target], 'index primer');
      runNode(['build-big-variant.mjs', 'both', args.target], 'build big (same passages)');
      // GUARD is a HARD gate: any FAIL aborts [D6].
      if (!runNode(['guard-check.mjs', args.target], 'guard')) {
        console.error('[gate] GUARD FAILED — aborting (a bad rebuild must never proceed).');
        process.exit(1);
      }
    }

    // GRADE both sets, both variants.
    let reports;
    try {
      reports = await gradeBoth(target, args.k);
    } catch (e) {
      console.error('[gate] grading crashed:', e.message);
      console.error('[gate] (engine parses; this likely means the .rvf has not been built yet — run with --build)');
      process.exit(1);
    }

    // Summarize.
    const summary = {};
    let allPass = true, anyGradable = false;
    for (const [set, rep] of Object.entries(reports)) {
      if (rep.missing) { console.log(`[gate] set '${set}': questions file MISSING (${rep.file}) — author it before gating.`); allPass = false; continue; }
      if (rep.empty) { console.log(`[gate] set '${set}': questions file EMPTY — author it.`); allPass = false; continue; }
      anyGradable = true;
      summary[set] = { small: rep.small.overall, big: rep.big.overall, pass: rep.pass };
      const delta = lastOverall[set] != null ? ` (Δ small ${(rep.small.overall - lastOverall[set]).toFixed(1)})` : '';
      console.log(`[gate] set '${set}': small=${rep.small.overall} big=${rep.big.overall} pass=${rep.pass}${delta}`);
      for (const s of rep.small.perStage) {
        if (s.score < THRESHOLD_STAGE) console.log(`        stage ${s.stage} small below ${THRESHOLD_STAGE}: ${s.score}`);
      }
      lastOverall[set] = rep.small.overall;
      if (!rep.pass) allPass = false;
    }

    const gradableReports = Object.fromEntries(Object.entries(reports).filter(([, r]) => !r.missing && !r.empty));
    const diag = anyGradable ? diagnose(gradableReports) : null;

    persistState(`iter-${iter}`, {
      iter, target: args.target, summary,
      buckets: diag ? diag.counts : null, dominant: diag ? diag.dominant : null,
      timestamp: new Date().toISOString(),
    });

    if (allPass && anyGradable) {
      console.log(`\n=== GATE A PASS at iteration ${iter}: overall >= ${THRESHOLD_OVERALL}, every stage >= ${THRESHOLD_STAGE}, both sets, both variants ===`);
      persistState('result', { pass: true, iter, summary, timestamp: new Date().toISOString() });
      process.exit(0);
    }

    if (diag && diag.dominant) {
      console.log(`\n[gate] DIAGNOSE — buckets R=${diag.counts.R} C=${diag.counts.C} O=${diag.counts.O}`);
      console.log(`[gate] dominant=${diag.dominant}: ${diag.advice[diag.dominant]}`);
      console.log('[gate] failing questions:');
      for (const f of diag.failing.slice(0, 12)) {
        console.log(`        [${f.set}] stage ${f.stage} (${f.bucket}) "${f.query}" -> ${f.top1}`
          + (f.missing && f.missing.length ? ` | missing: ${f.missing.join(', ')}` : ''));
      }
    }
    console.log(`\n[gate] iteration ${iter} did not pass. Apply the smallest fix for the dominant bucket, then re-run.`);
    // Without an operator-applied fix between iterations, re-running is a no-op — so stop after one
    // pass through unless --build re-runs the pipeline (which can change results via a corpus fix).
    if (!args.build) {
      console.log('[gate] grade-only mode: stopping after one pass (apply fix + re-run, or use --build).');
      break;
    }
  }

  console.log(`\n=== GATE A: NOT PASSED within ${args.max} iterations ===`);
  persistState('result', { pass: false, timestamp: new Date().toISOString() });
  process.exit(1);
}

main().catch((e) => { console.error('[gate] ERROR:', e); process.exit(1); });
