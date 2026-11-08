// Preloaded (node --import) into the concept-tournament process: replaces fetch with canned model replies.
// TOURNAMENT_STUB_PALETTE = 'prose' (the old string schema) | 'object' (the knob schema).
const prose = process.env.TOURNAMENT_STUB_PALETTE === 'prose';
const spec = (n) => ({
  metaphor: `lighthouse ${n}`, whyItFits: 'beam = query', heroConcept: 'a lighthouse', tagline: `Find it fast ${n}`,
  thesis: 'It finds things.', arcBeats: ['pain', 'fix'], heroAnimDesign: 'beam sweeps', rejectedIdea: 'x',
  palette: prose ? '3 colors: deep navy #0b1d3a, signal amber #ffb000, foam white #f4f7fb' : { bg: '#0b1d3a', ink: '#f4f7fb', accent: '#ffb000', 'accent-2': '#2f80ed' },
  typePersonality: prose ? 'Fraunces display + Inter body + JetBrains Mono' : { display: 'Fraunces, serif', sans: 'Inter, sans-serif', mono: 'JetBrains Mono, monospace' },
});
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const fail = process.env.TOURNAMENT_STUB_FAIL;   // 'all' = every call 500s; 'one' = only claude-sonnet-5-5 answers a candidate prompt; 'judge' = only the judge call does
  if (fail === 'one' && !/You are judging/.test(JSON.parse(init.body).messages?.[0]?.content || '') && !u.includes('anthropic.com')) return { ok: false, status: 500, json: async () => ({}) };
  if (fail === 'one' && u.includes('anthropic.com') && JSON.parse(init.body).model === 'claude-fable-5-1') return { ok: false, status: 500, json: async () => ({}) };
  if (fail === 'all' || (fail === 'judge' && !u.includes('anthropic.com') && /You are judging/.test(JSON.parse(init.body).messages[0].content))) return { ok: false, status: 500, json: async () => ({}) };
  if (u.includes('anthropic.com')) return ok({ content: [{ text: JSON.stringify(spec(1)) }], usage: { input_tokens: 1000, output_tokens: 500 } });
  const prompt = JSON.parse(init.body).messages[0].content;
  if (/You are judging/.test(prompt)) return ok({ choices: [{ message: { content: JSON.stringify({ scores: [{ index: 0, score: 80, why: 'a' }, { index: 1, score: 70, why: 'b' }, { index: 2, score: 60, why: 'c' }], winnerIndex: 0 }) } }] });
  return ok({ choices: [{ message: { content: JSON.stringify(spec(3)) } }] });
};
