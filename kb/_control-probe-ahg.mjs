#!/usr/bin/env node
// Discrimination control: feed the SAME judge (same system prompt as grade-ai-comprehension.mjs)
// deliberately-VAGUE/generic context for real MetaHarness questions. An honest judge MUST score
// these LOW (<30). If it rubber-stamps vague context, the high real scores are meaningless.
const key = process.env.ANTHROPIC_API_KEY;
const metaName = 'MetaHarness';
const system = `You are an HONEST, well-calibrated evaluator acting as an AI coding assistant that has been given a "drop-in knowledge pack" for a software repo (named ${metaName}). The CONTEXT block contains what the drop-in surfaced for ONE question: semantic-search results PLUS directly-injected files and structured artifacts (the symbol index with signatures, the dependency graph, the entrypoint/command list, and full file bodies looked up by path). The real drop-in ALSO contains the complete passages.jsonl (every file's full text) and symbols.json — so "I would have to look that detail up" is NOT a gap; looking things up in the provided material is the normal, expected workflow. You have NO other knowledge of this repo.

Score 0-100 on ONE thing: "From this CONTEXT, can I write a CORRECT and COMPLETE answer to THIS question for THIS repo?" Judge sufficiency of the provided material.

Calibration (apply literally — do not cluster everything at 92):
- 95-100: I can write a correct, complete, specific answer. The concrete facts the question asks for (names, signatures, commands, file paths, relationships, fields) are present in the context — even if spread across the injected files/symbols. A nicety I could trivially derive from what IS shown (e.g. a constructor that obviously exists, a default value, an example I can compose from the shown API) is NOT a deduction.
- 85-94: Reserve for when a genuinely SUBSTANTIVE specific is missing — a fact the question explicitly demands that is nowhere in the context and cannot be composed from what is shown.
- 70-84: A key specific (a required command, signature, relationship, or concrete fact) is absent or only vaguely implied.
- <70: Major gaps; only generic prose; the right file/fact is absent entirely.

Do NOT inflate, and do NOT reflexively deduct for trivia. If the answer is genuinely complete and specific, score 95+. If you deduct, the "missing" item must be a real, substantive fact the question needs that is truly absent from the WHOLE context (not just the top result). Note: in Rust a struct with no public fields is opaque BY DESIGN — its METHODS are its API, so if the methods/constructors are shown, do NOT deduct for "missing struct fields/definition"; that is complete. Likewise a function's signature + its argument/return TYPES is a complete signature.

Reply with STRICT JSON only (no markdown, no preamble), keeping "missing" to a short phrase and "reason" to ONE short sentence: {"score": <int 0-100>, "missing": "<short phrase, or 'nothing'>", "reason": "<one short sentence>"}`;

// Deliberately vague/generic context — NO real MetaHarness facts. Same wrapper an AI would see.
const VAGUE = `[#1] path: README.md  source_type:doc
This is a software project. It is written in modern languages and has several components. It does useful things and is designed to be flexible and extensible. You can install it and run it. There is documentation. The project follows good engineering practices and has tests. It is open source.

---

[#2] path: docs/notes.md  source_type:doc
The system is modular. Different parts handle different concerns. Configuration is supported. Performance is generally good. There are some limitations to be aware of, as with any software. Contributions are welcome.`;

const probes = [
  { dim: 'onboarding',    q: 'I just got this repo. How do I install, scaffold a harness, build it, and run its tests from scratch? Give me the exact commands.' },
  { dim: 'architecture',  q: 'What packages make up metaharness and how do they relate? What is the three-layer model?' },
  { dim: 'usage',         q: 'What does a host adapter implement to turn a harness spec into config files? What is the function signature?' },
  { dim: 'extensibility', q: 'How do I add a new host to metaharness? Which interface do I implement and which reference adapter should I copy?' },
  { dim: 'deep-dive',     q: 'Explain specifically what packages/router/src/index.ts does and the key symbols it defines. What is its responsibility?' },
];

async function judge(dim, q) {
  const user = `QUESTION (dimension: ${dim}):\n${q}\n\nCONTEXT (everything the drop-in returned — judge sufficiency of THIS):\n\n${VAGUE}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 700, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  let text = (j.content || []).map((c) => c.text || '').join('').replace(/```(?:json)?/gi, '').trim();
  const obj = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(obj);
}

console.log('=== DISCRIMINATION CONTROL (vague context — MUST score low) ===\n');
let max = 0;
for (const p of probes) {
  const res = await judge(p.dim, p.q);
  max = Math.max(max, res.score);
  console.log(`${p.dim.padEnd(14)} score=${String(res.score).padStart(3)}  missing="${res.missing}"  reason="${res.reason}"`);
}
console.log(`\nmax control score = ${max}  ${max < 30 ? 'PASS (judge discriminates — vague context scores low)' : 'FAIL (judge rubber-stamps)'}`);
