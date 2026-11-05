// guard.mjs — AIMDS screening for the Ask service (global rule 8): the visitor's question is scanned before it
// reaches the model, the model's answer is scanned before it reaches the visitor. Every failure path BLOCKS.
//
// @claude-flow/aidefence 3.1.0 has no `blockThreshold` option (checked against its published types), so the
// threshold is applied here to the severity of each returned threat: 'medium' blocks medium, high and critical.
import { createAIDefence } from '@claude-flow/aidefence';

const RANK = { low: 1, medium: 2, high: 3, critical: 4 };
export const BLOCK_THRESHOLD = 'medium';

/** @param {{ scanner?: { detect(text: string): Promise<object> }, blockThreshold?: keyof typeof RANK }} [opts]
 *  `scanner` is injectable so tests can drive every verdict without the real pattern packs. */
export function createGuard({ scanner, blockThreshold = BLOCK_THRESHOLD } = {}) {
  const s = scanner ?? createAIDefence({ enableLearning: true });
  const floor = RANK[blockThreshold] ?? RANK[BLOCK_THRESHOLD];

  async function check(text, { blockPii }) {
    let r;
    try { r = await s.detect(String(text)); } catch { return { ok: false, reason: 'scanner-error' }; }   // no verdict = no pass
    if (!r || typeof r !== 'object') return { ok: false, reason: 'scanner-error' };
    const threats = Array.isArray(r.threats) ? r.threats : [];
    const hit = threats.filter((t) => (RANK[t?.severity] ?? Infinity) >= floor);   // unknown severity counts as blocking
    if (hit.length) return { ok: false, reason: 'threat', types: [...new Set(hit.map((t) => String(t.type)))] };
    if (r.safe === false && !threats.length) return { ok: false, reason: 'threat', types: [] };   // unsafe with no detail
    if (blockPii && r.piiFound) return { ok: false, reason: 'pii' };
    return { ok: true };
  }

  return {
    /** Inbound: also refuses personal data / credentials, which must not be forwarded to a third-party model. */
    checkQuestion: (q) => check(q, { blockPii: true }),
    /** Outbound: threats only. Answers come from public repo files and may legitimately quote a contact address. */
    checkAnswer: (a) => check(a, { blockPii: false }),
  };
}
