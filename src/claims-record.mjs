// src/claims-record.mjs — the ONE advisory claims check both doors use. It records what content claims the
// knowledge base cannot ground into build.json `claims`; it never blocks and never throws.
//   ok:true/false → { advisory, ok, findings, citations, commands }   check could not run → { advisory, ok:null, error }

import path from 'node:path';
import { mergeSlot } from './build-context.mjs';
import { checkBuild } from '../tools/check-claims.mjs';
import { REPO_ROOT, C, log as defaultLog } from './runtime.mjs';

export function recordClaims(buildDir, { check = checkBuild, root = REPO_ROOT, merge = mergeSlot, log = defaultLog } = {}) {
  let slot;
  try {
    const r = check(path.join(buildDir, 'build.json'), { root });
    slot = { advisory: true, ok: r.ok, findings: r.findings, citations: r.citations, commands: { ...r.commands, checked: undefined } };
  } catch (e) {
    slot = { advisory: true, ok: null, error: String(e.message || e).slice(0, 200) };
  }
  try { merge(buildDir, 'claims', slot); } catch { /* best-effort */ }
  if (slot.error) log(`${C.yellow}claims check could not run: ${slot.error}${C.reset}`);
  else if (slot.findings) log(`${C.yellow}claims check: ${slot.findings} claim(s) the knowledge base cannot ground (advisory — see build.json claims)${C.reset}`);
  else log(`${C.dim}claims check: every cited passage and command is grounded.${C.reset}`);
  return slot;
}
