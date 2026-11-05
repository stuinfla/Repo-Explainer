// Shared helpers for tests that drive quality-grade's real gradeCrops with a stubbed fetch (no network).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEYS_A = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
const KEYS_B = ['B1', 'B2', 'B3', 'B4', 'B5'];
const OPS = ['believeIUnderstand', 'approachable', 'explainsToNovice', 'architectureConfidence', 'makesMeSmile', 'zeroKnowledgeReader'];

// A complete, schema-valid grader reply where every axis scores `score`.
export function gradeReply(score = 90, over = {}) {
  return {
    gateA: Object.fromEntries(KEYS_A.map((k) => [k, score])),
    gateB: Object.fromEntries(KEYS_B.map((k) => [k, score])),
    operatorQuestions: Object.fromEntries(OPS.map((k) => [k, true])),
    rationales: Object.fromEntries([...KEYS_A, ...KEYS_B].map((k) => [k, 'saw it'])),
    clarity: { architectureReadsClearly: true, architectureNote: 'ok', flowReadsClearly: true, flowNote: 'ok' },
    rasters: [],
    ...over,
  };
}

// Run fn with globalThis.fetch replaced by a stub that serves `replies` in order (the last one repeats).
export async function withStubbedGrader(replies, fn) {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    const reply = replies[Math.min(calls, replies.length - 1)];
    calls++;
    const body = JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
    return { ok: true, status: 200, text: async () => body };
  };
  try { return await fn(() => calls); } finally { globalThis.fetch = real; }
}

export function tempCrops(n = 2) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-stub-'));
  return Array.from({ length: n }, (_, i) => {
    const p = path.join(dir, `crop${i}.png`);
    fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return { key: `k${i}`, label: `crop ${i}`, path: p };
  });
}

export const ARGS = (crops) => ({ apiKey: 'sk-test', model: 'gpt-5.6-sol', baseUrl: 'http://stub.invalid/v1', crops, deviceLabel: 'mobile(390)' });
