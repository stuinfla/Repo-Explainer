#!/usr/bin/env node
// _probe-eval.mjs — regression harness for reranker tuning. Runs grader probes through the SAME
// searchKb() the CLI/MCP use and scores STRICT (top-1 matches expected) + REAL-USE (top-5 matches).
// Underscore-prefixed => gitignored. Not shipped. Usage: node kb/_probe-eval.mjs
import { searchKb } from './ask-kb.mjs';

// cat: 'guard' = currently passing, must NOT regress. 'rerank' = STRICT-fail we aim to fix by
// reranking (no rebuild). 'content' = needs Phase-2 passages + rebuild (expected to fail now).
const PROBES = [
  // ---- ruvector ----
  { store: 'ruvector', q: 'which crate implements dynamic min-cut', want: 'mincut', cat: 'rerank' },
  { store: 'ruvector', q: 'HNSW index in ruvector-core', want: 'ruvector-core/src/index', cat: 'rerank' },
  { store: 'ruvector', q: 'graph transformer attention implementation', want: 'sublinear_attention', cat: 'rerank' },
  { store: 'ruvector', q: 'ruvector-mmwave radar parser', want: 'ruvector-mmwave', cat: 'rerank' },
  { store: 'ruvector', q: 'RaBitQ quantization', want: 'rabitq', cat: 'guard' },
  { store: 'ruvector', q: 'witness chain verify RVF', want: 'verify_witness', cat: 'guard' },
  { store: 'ruvector', q: 'EWC++ continual learning catastrophic forgetting', want: 'ewc', cat: 'guard' },
  { store: 'ruvector', q: 'Phi consciousness coherence metric', want: 'coherence_phi', cat: 'guard' },
  { store: 'ruvector', q: 'tiny-dancer neural routing', want: 'tiny-dancer', cat: 'guard' },
  { store: 'ruvector', q: 'MicroLoRA adapter manager', want: 'lora|adapter_manager', cat: 'guard' },
  // ---- ruview ----
  { store: 'ruview', q: 'how is breathing rate extracted from CSI', want: 'breathing', cat: 'guard' },
  { store: 'ruview', q: 'how is heart rate extracted from CSI', want: 'heartrate', cat: 'guard' },
  { store: 'ruview', q: '17-keypoint pose tracker Kalman filter', want: 'pose_tracker', cat: 'guard' },
  { store: 'ruview', q: 'Soul Signature BFLD EnrolledMatcher', want: 'soul_match|soul_channels', cat: 'guard' },
  { store: 'ruview', q: 'Apple Home HomeKit HAP bridge', want: 'homecore-hap', cat: 'guard' },
  { store: 'ruview', q: 'what is RuView', want: 'PRIMER#1', cat: 'rerank' },
  { store: 'ruview', q: 'what is WiFi-DensePose', want: 'PRIMER#', cat: 'rerank' },
  { store: 'ruview', q: 'which crate contains the densepose head', want: 'densepose.rs', cat: 'guard' },
  { store: 'ruview', q: 'DensePose body-surface UV correspondence from wifi', want: 'densepose', cat: 'content' },
  { store: 'ruview', q: 'provision.py flags edge-tier tdm-slot fall-thresh', want: 'provision', cat: 'content' },
];

const VARIANT = process.env.VARIANT || undefined;  // 'small' | 'big' | undefined(auto=big)
const hit = (path, want) => want.toLowerCase().split('|').some((w) => (path || '').toLowerCase().includes(w));

const rows = [];
for (const p of PROBES) {
  let res;
  try { res = await searchKb({ query: p.q, k: 5, store: p.store, variant: VARIANT }); }
  catch (e) { rows.push({ ...p, strict: false, real: false, top1: 'ERROR: ' + e.message }); continue; }
  const top5 = (res || []).slice(0, 5).map((r) => r.path);
  const strict = top5.length > 0 && hit(top5[0], p.want);
  const real = top5.some((pp) => hit(pp, p.want));
  rows.push({ ...p, strict, real, top1: top5[0] || '(none)' });
}

const byCat = (c) => rows.filter((r) => r.cat === c);
const tally = (rs) => ({ strict: rs.filter((r) => r.strict).length, real: rs.filter((r) => r.real).length, n: rs.length });

console.log('\n# | store | cat | STRICT | REAL | want -> top1');
console.log('--|-------|-----|--------|------|-------------');
rows.forEach((r, i) => {
  console.log(`${String(i + 1).padStart(2)} | ${r.store.padEnd(8)} | ${r.cat.padEnd(7)} | ${r.strict ? 'PASS' : 'fail'} | ${r.real ? 'yes' : 'NO '} | ${r.want}  ->  ${r.top1}`);
});

for (const c of ['guard', 'rerank', 'content']) {
  const t = tally(byCat(c));
  console.log(`\n[${c}]  STRICT ${t.strict}/${t.n}   REAL-USE ${t.real}/${t.n}`);
}
const all = tally(rows);
console.log(`\n[ALL]  STRICT ${all.strict}/${all.n} (${(100 * all.strict / all.n).toFixed(0)}%)   REAL-USE ${all.real}/${all.n} (${(100 * all.real / all.n).toFixed(0)}%)`);
