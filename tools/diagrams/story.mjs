// tools/diagrams/story.mjs — verified story diagrams (ADR-0014) and the authored-rows helpers.
// visuals.systemMap / visuals.decision REPLACE the architecture / flow drawing, but only when THIS tool confirms
// every claim against the real cloned repo (a quote that is really in the file; a "no" that is a zero-hit search).
// Anything unverifiable is dropped and the slot falls back to its grounded or authored diagram, never a failed build.
// Each verified story is drawn TWICE from the one verified model: the wide canvas and the phone canvas.

import fs from 'node:fs';
import path from 'node:path';
import {
  renderSystemMap, renderDecision, validateSystemMap, validateDecision, verifySystemMap, verifyDecision,
  describeSystemMap, describeDecision,
} from '../../src/story-diagrams.mjs';
import { renderSystemMapMobile, renderDecisionMobile } from '../../src/story-diagrams-mobile.mjs';
import { warn } from './draw.mjs';
import { FORM, CONTAINMENT_CLAIM } from './models.mjs';

export const STORY_SLOT = { architectureDiagram: 'systemMap', flowDiagram: 'decision' };
const SEARCH_SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__', '.next', 'target']);

export function makeRepoReaders(buildJson, buildDir) {
  const cp = buildJson.repo && buildJson.repo.clonePath;
  const root = cp ? (path.isAbsolute(cp) ? cp : path.resolve(buildDir, cp)) : null;
  if (!root || !fs.existsSync(root)) return null;
  const realRoot = fs.realpathSync(root);
  const read = (file) => {
    if (typeof file !== 'string' || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) return null;
    try {
      // a symlink inside the clone must not lead the reader (and so a quoted "evidence" line) outside it
      const full = fs.realpathSync(path.join(root, file));
      if (full !== realRoot && !full.startsWith(realRoot + path.sep)) return null;
      const st = fs.statSync(full);
      return st.isFile() && st.size <= 2_000_000 ? fs.readFileSync(full, 'utf8') : null;
    } catch { return null; }
  };
  const search = (terms) => {
    const needles = terms.map((t) => String(t).toLowerCase());
    const hits = [];
    let files = 0;
    const walk = (dir) => {
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (hits.length >= 20 || files > 6000) return;
        if (e.isDirectory()) { if (!SEARCH_SKIP.has(e.name)) walk(path.join(dir, e.name)); continue; }
        if (!e.isFile()) continue;
        files++;
        const full = path.join(dir, e.name);
        let st; try { st = fs.statSync(full); } catch { continue; }
        if (st.size > 1_000_000) continue;
        let txt; try { txt = fs.readFileSync(full, 'utf8'); } catch { continue; }
        if (txt.includes('\u0000')) continue;
        const lines = txt.split('\n');
        for (let i = 0; i < lines.length && hits.length < 20; i++) {
          const l = lines[i].toLowerCase();
          if (needles.some((n) => l.includes(n))) hits.push({ file: path.relative(root, full), line: i + 1 });
        }
      }
    };
    walk(root);
    return hits;
  };
  return { read, search };
}

export function storyFor(key, visualsIn, readers) {
  const slot = STORY_SLOT[key];
  const model = slot && visualsIn[slot];
  if (!model || typeof model !== 'object') return null;
  if (!readers) { warn(`${slot}: no cloned repo to verify against — using the grounded graph diagram`); return null; }
  try {
    if (slot === 'systemMap') {
      const bad = validateSystemMap(model);
      if (bad.length) { warn(`systemMap rejected: ${bad.join('; ')}`); return null; }
      const { model: ok, notes } = verifySystemMap(model, readers);
      notes.forEach((n) => warn(`systemMap: ${n}`));
      if (!ok.worksWith.items.length) { warn('systemMap: no "works with" claim could be verified — using the grounded graph diagram'); return null; }
      return { svg: renderSystemMap(ok), mobile: () => renderSystemMapMobile(ok), altText: `${ok.title}. ${describeSystemMap(ok)}`, kind: 'systemMap', notes,
        evidence: ok.worksWith.items.map((x) => ({ name: x.name, status: x.status, evidence: x.evidence })) };
    }
    const bad = validateDecision(model);
    if (bad.length) { warn(`decision rejected: ${bad.join('; ')}`); return null; }
    const v = verifyDecision(model, readers);
    if (!v.ok) { warn(v.note); return null; }
    return { svg: renderDecision(model), mobile: () => renderDecisionMobile(model), altText: `${model.title}. ${describeDecision(model)}`, kind: 'decision', notes: [],
      evidence: [{ rule: model.rule }] };
  } catch (e) { warn(`${slot} could not be drawn (${e.message}) — using the grounded graph diagram`); return null; }
}

// authored rows → the renderer's rows-model: [{ items:[{label,colorIdx}], connectWithin }] (empty rows dropped)
export function authoredRows(slot) {
  const rows = slot && Array.isArray(slot.rows) ? slot.rows : [];
  return rows.map((r) => ({
    items: (r && Array.isArray(r.items) ? r.items : [])
      .map((it, i) => (typeof it === 'string' ? { label: it, colorIdx: i } : { label: it && it.label, colorIdx: (it && it.colorIdx != null) ? it.colorIdx : i }))
      .filter((it) => it.label && String(it.label).trim()),
    connectWithin: !!r && r.connect !== false,
  })).filter((r) => r.items.length);
}

// The brain's alt text often carries a FORM CLAIM ("drawn as a hub with three satellites"). The resolver decides the
// form at RUNTIME, so a claim that contradicts the drawn family is rewritten here, BEFORE drawing, so the visible
// caption, the <desc> and the recorded altText all agree. An accurate or ambiguous claim stays in the author's words.
const FORM_PHRASE = {
  [FORM.RADIAL]: 'drawn as a hub with its related parts radiating from it',
  [FORM.VSTACK]: 'drawn as a vertical chain, top to bottom',
  [FORM.HRUN]: 'drawn as a left-to-right run',
  [FORM.CONTAINMENT]: 'drawn as nested frames, outermost to innermost',
  [FORM.GRID]: 'drawn as a field of cards, read left to right and wrapping',
};
const FORM_CUES = [
  [FORM.RADIAL, /\bhub\b|satellite|radiat|spoke/i],
  [FORM.CONTAINMENT, /nested|concentric|containing|contains|inside|within/i],
  [FORM.GRID, /\bgrid\b|\bfield\b|wrapp?ed|tiles?\b/i],
  [FORM.HRUN, /left[- ]to[- ]right|horizontal|across the|single row/i],
  [FORM.VSTACK, /vertical|top to bottom|stacked|down the|column/i],
];
export function correctedCaption(spec, decision, rawCap, rows) {
  let cap = rawCap
    ? rawCap.replace(/,?\s*drawn as [^:;.]+/i, (mm) => {
      const hits = FORM_CUES.filter(([, re]) => re.test(mm)).map(([fam]) => fam);
      const claimed = hits.length === 1 ? hits[0] : null;   // ambiguous => trust the author
      const truth = FORM_PHRASE[decision.family];
      if (!claimed || claimed === decision.family || !truth) return mm;
      warn(`${spec.key}: authored alt text claimed a ${claimed} form but the resolver drew ${decision.family} — rewrote "${mm.trim()}"`);
      return `, ${truth}`;
    })
    : null;
  // a Big Idea drawn as a handoff says so when the author wrote nothing, or claimed a containment that is not drawn
  if (spec.key === 'bigIdeaDiagram' && decision.family === FORM.HRUN && (!rawCap || CONTAINMENT_CLAIM.test(rawCap))) {
    cap = `A left-to-right handoff: ${rows.map((r) => r.items.map((it) => it.label).join(' → ')).join('; ')}.`;
  }
  return cap;
}
