// tools/diagrams/models.mjs — the CONTENT models the renderers draw from (one source of truth for both the desktop and
// the phone layout): the dependency-graph and build-lifecycle models, the authored-rows parser, the INV-23 form
// resolver, and the accessible-text builder. Pure; the only side effect is die() on an unresolvable form set.

import { die } from './draw.mjs';
import { GR } from './concept.mjs';

function symbolCountFor(node, sym) {
  if (!sym || !sym.byCrate || !node) return null;
  const bc = sym.byCrate, cands = [node.name];
  if (node.manifest) { const dir = String(node.manifest).replace(/\\/g, '/').replace(/\/[^/]+$/, ''); if (dir) cands.push(dir); }
  for (const c of cands) if (c && Object.prototype.hasOwnProperty.call(bc, c) && typeof bc[c] === 'number') return bc[c];
  return null;
}

// ── ARCHITECTURE model from the REAL dep-graph ────────────────────────────────────────────────────
// Dense monorepos are trimmed to the ARCH_MAX_NODES most-connected modules. Every kept module is drawn.
const ARCH_MAX_NODES = 12;

export function buildArchModel(dg, sym) {
  const all = (Array.isArray(dg.nodes) ? dg.nodes : []).filter((n) => n && n.name);
  const nameSet = new Set(all.map((n) => n.name));
  const seenE = new Set();
  let edges = (Array.isArray(dg.internalEdges) ? dg.internalEdges : [])
    .filter((e) => e && e.from && e.to && e.from !== e.to && nameSet.has(e.from) && nameSet.has(e.to))
    .filter((e) => { const k = e.from + '\x00' + e.to; if (seenE.has(k)) return false; seenE.add(k); return true; });

  // full-graph degree → keep the most-connected modules when there are too many to draw legibly
  const fIn = {}, fOut = {};
  for (const e of edges) { fIn[e.to] = (fIn[e.to] || 0) + 1; fOut[e.from] = (fOut[e.from] || 0) + 1; }
  const fdeg = (n) => (fIn[n.name] || 0) + (fOut[n.name] || 0);
  let nodes = all, trimmed = 0;
  if (all.length > ARCH_MAX_NODES) {
    nodes = [...all].sort((a, b) => fdeg(b) - fdeg(a) || (fIn[b.name] || 0) - (fIn[a.name] || 0)).slice(0, ARCH_MAX_NODES);
    const keep = new Set(nodes.map((n) => n.name));
    edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    trimmed = all.length - nodes.length;
  }

  // degrees on the shown subgraph drive labels, ordering and hub detection
  const inDeg = {}, outDeg = {};
  nodes.forEach((n) => { inDeg[n.name] = 0; outDeg[n.name] = 0; });
  for (const e of edges) { inDeg[e.to]++; outDeg[e.from]++; }
  const plur = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const symAnn = (n) => { const k = symbolCountFor(n, sym); return k != null ? `${k} sym` : ''; };

  // most-depended-on first (ties: more links, then name) — the radial renderer lays satellites out in this order
  nodes = [...nodes].sort((a, b) => (inDeg[b.name] - inDeg[a.name]) || ((inDeg[b.name] + outDeg[b.name]) - (inDeg[a.name] + outDeg[a.name]))
    || String(a.name).localeCompare(String(b.name)));

  // the hub = the module the most others depend on (ties → highest total degree)
  let hub = null, hubScore = -1;
  for (const n of nodes) { const sc = (inDeg[n.name] || 0) * 2 + (outDeg[n.name] || 0); if ((inDeg[n.name] || 0) > 0 && sc > hubScore) { hubScore = sc; hub = n.name; } }

  // attach display metadata to each node
  for (const it of nodes) {
    const id = it.name, di = inDeg[id] || 0, dout = outDeg[id] || 0;
    it.isHub = id === hub;
    it.isEntry = di === 0 && dout > 0;
    it.isLeaf = dout === 0 && di > 0;
    const sub = it.isEntry
      ? ['entry', dout ? `uses ${dout}` : '', symAnn(it)].filter(Boolean).join(' · ')
      : [it.isLeaf ? 'shared' : null, plur(di, 'dependent'), symAnn(it)].filter(Boolean).join(' · ');
    // display name drops a shared @scope/ prefix (keeps the distinguishing part legible); name stays canonical
    it.label = id.replace(/^@[^/]+\//, ''); it.sub = sub || symAnn(it) || '';
  }

  const extNames = Array.isArray(dg.externalDepNames) ? dg.externalDepNames.slice(0, 5) : [];
  const ext = extNames.length ? { names: extNames, count: dg.externalDepCount ?? extNames.length } : null;
  return { nodes, edges, ext, hub, trimmed };
}

// ── BUILD-LIFECYCLE model from the entrypoints: each stage carries the artifact it consumes and produces
// (derived from the detected ecosystem), so the diagram shows DATA MOVING, not a command list ─
function ecoOf(dg) {
  const e = (Array.isArray(dg.ecosystems) ? dg.ecosystems : []).map((s) => String(s).toLowerCase());
  if (e.includes('node') || e.includes('npm')) return 'node';
  if (e.includes('rust') || e.includes('cargo')) return 'rust';
  if (e.includes('python') || e.includes('pip')) return 'python';
  return 'generic';
}

function artifactModel(eco) {
  const M = {
    node: {
      source: 'package.json + src/',
      install: { verb: 'resolve + download dependencies', in: 'package.json + lock', out: 'node_modules/' },
      build: { verb: 'compile + bundle the source', in: 'src/ + node_modules/', out: 'dist/ bundle' },
      run: { verb: 'execute the entry point', in: 'dist/ + CLI args', out: 'program output' },
      verify: { verb: 'run the test suite', in: 'dist/ + test specs', out: 'pass / fail report' },
    },
    rust: {
      source: 'Cargo.toml + src/',
      install: { verb: 'resolve the crate graph', in: 'Cargo.toml + lock', out: 'cargo cache' },
      build: { verb: 'compile the workspace', in: 'src/ + crates', out: 'target/release/' },
      run: { verb: 'execute the binary', in: 'target/ + args', out: 'program output' },
      verify: { verb: 'run cargo test', in: 'crates + tests', out: 'pass / fail report' },
    },
    python: {
      source: 'pyproject + pkg/',
      install: { verb: 'install dependencies', in: 'pyproject + lock', out: 'site-packages/' },
      build: { verb: 'build the package', in: 'pkg/ source', out: 'wheel / dist' },
      run: { verb: 'run the entry point', in: 'pkg + CLI args', out: 'program output' },
      verify: { verb: 'run the test suite', in: 'pkg + tests', out: 'pass / fail report' },
    },
    generic: {
      source: 'source tree',
      install: { verb: 'install dependencies', in: 'manifest', out: 'dependencies' },
      build: { verb: 'build the artifacts', in: 'source', out: 'build output' },
      run: { verb: 'run the program', in: 'build + args', out: 'program output' },
      verify: { verb: 'run the tests', in: 'tests', out: 'pass / fail' },
    },
  };
  return M[eco] || M.generic;
}

export function buildFlowModel(ep, dg) {
  const A = artifactModel(ecoOf(dg));
  const pick = (cat) => { const c = (Array.isArray(ep.commands) ? ep.commands : []).find((x) => x && x.category === cat); return c ? c.cmd : null; };
  const binNames = (Array.isArray(ep.binaries) ? ep.binaries : []).map((b) => b && b.name).filter(Boolean);
  const installCmd = (Array.isArray(ep.install) && ep.install[0]) || pick('install');
  const buildCmd = pick('build');
  const runCmd = (binNames[0] && `${binNames[0]} ...`) || pick('run') || (Array.isArray(ep.quickstart) && ep.quickstart[0]) || null;
  const testCmd = pick('test');
  const steps = [];
  if (installCmd) steps.push({ name: 'INSTALL', ...A.install, cmd: installCmd });
  if (buildCmd) steps.push({ name: 'BUILD', ...A.build, cmd: buildCmd });
  if (runCmd) steps.push({ name: 'RUN', ...A.run, cmd: runCmd });
  if (testCmd) steps.push({ name: 'VERIFY', ...A.verify, cmd: testCmd });
  if (!steps.length && Array.isArray(ep.quickstart) && ep.quickstart[0]) steps.push({ name: 'RUN', ...A.run, cmd: ep.quickstart[0] });
  if (steps.length < 2) steps.push({ name: 'RESULT', verb: 'produces the entry artifact', in: steps[0] ? steps[0].out : 'build', out: binNames.length ? `bin: ${binNames.slice(0, 2).join(', ')}` : 'output', cmd: binNames[0] || 'run' });
  const result = binNames.length ? `${binNames.slice(0, 2).join(', ')} ready` : steps[steps.length - 1].out;
  return { steps, source: A.source, result };
}

// ── FORM FAMILIES (INV-23, ADR-0012) ─────────────────────────────────────────────────────────────
// A vision grader compares COARSE layout shape, and caps B5 at 60 (below the 70 ship floor) when two diagrams
// share one. So every slot declares the family it would emit, resolveForms assigns them pairwise-distinct,
// and the set is ASSERTED before a byte of SVG is written — free and deterministic, where a vision call to
// discover the collision cost a whole rebuild.
export const FORM = {
  VSTACK: 'vertical-stack',   // renderFlow · conceptColumn
  HRUN: 'horizontal-run',     // conceptRibbon   — a pipeline reads L→R
  RADIAL: 'radial',           // renderArchitectureRadial · conceptOrbit — hub + satellites
  CONTAINMENT: 'containment', // conceptStrata   — nested frames
  GRID: 'grid',               // conceptGrid     — a wrapped FIELD of cards
};
const VARIANT_FAMILY = { column: FORM.VSTACK, ribbon: FORM.HRUN, orbit: FORM.RADIAL, strata: FORM.CONTAINMENT, grid: FORM.GRID };

// conceptPrefs = ordered preference list of archetypes for a slot that draws a concept diagram: the resolver
// takes the first family not already claimed. groundedFamily = the family the slot's grounded renderer emits.
export const DIAGRAMS = [
  // Architecture (INV-18 mandates a real dependency map) draws RADIAL when grounded. Every list ends in 'column'
  // because VSTACK is free whenever no grounded flow claims it, and a list that never offers it starves a slot.
  { key: 'architectureDiagram', file: 'architecture.svg', title: 'Architecture', grounded: 'architecture',
    groundedFamily: FORM.RADIAL,
    conceptEyebrow: 'ARCHITECTURE', conceptHeading: 'How it is built', conceptPrefs: ['strata', 'orbit', 'grid', 'ribbon', 'column'] },
  // A pipeline IS a left→right run, so 'ribbon' is the right concept form for an authored flow.
  { key: 'flowDiagram', file: 'flow.svg', title: 'Process / Data Flow', grounded: 'flow',
    groundedFamily: FORM.VSTACK,
    conceptEyebrow: 'DATA FLOW', conceptHeading: 'What happens to your data', conceptPrefs: ['ribbon', 'column', 'grid', 'strata', 'orbit'] },
  // Big Idea explains a relationship or handoff: it never claims containment from its own wording.
  { key: 'bigIdeaDiagram', file: 'big-idea.svg', title: 'Big Idea', grounded: null,
    conceptEyebrow: 'THE BIG IDEA', conceptHeading: 'How it all fits together', conceptPrefs: ['ribbon', 'grid', 'column', 'orbit'] },
  { key: 'insightDiagram', file: 'insight.svg', title: 'The Insight', grounded: null,
    conceptEyebrow: 'THE INSIGHT', conceptHeading: 'The clever move', conceptPrefs: ['orbit', 'ribbon', 'grid', 'strata', 'column'] },
];

// THE RESOLVER. Input: the slots that will actually render, each declaring whether it renders grounded.
// Output: a per-key decision { family, variant } with a PAIRWISE-DISTINCT family set. Deterministic and total:
// it dies rather than return a colliding set.
// A ribbon's width grows with item count (3 items 731px, 4 = 949px, 6 = 1385px) while every other archetype
// stays portrait; a 1385px ribbon puts 13px labels at ~3.7px on a 390px phone. So a ribbon is only offered for a SHORT chain.
const RIBBON_MAX_ITEMS = 3;
// Nested frames assert literal containment: valid only when the authored takeaway says one thing is inside or
// contains another. One definition of "this text claims containment", used to ground strata and to notice an
// authored claim the page no longer draws.
export const CONTAINMENT_CLAIM = /\b(?:nested|concentric|contain(?:s|ing|ed)?|inside|within)\b/i;
function containmentIsGrounded(slot) {
  // A Big Idea's own prose is not independent evidence of containment, so it never earns strata.
  if (slot.key === 'bigIdeaDiagram') return false;
  return slot.semanticContainment === true;
}
function ribbonIsSafe(slot) {
  // Big Idea handoffs commonly have four stages; the compact ribbon keeps four readable. Other slots keep the tighter cap.
  const max = slot.key === 'bigIdeaDiagram' ? 4 : RIBBON_MAX_ITEMS;
  return !Number.isInteger(slot.chainLength) || slot.chainLength <= max;
}

// A grid only EARNS its own family when it wraps: with items <= PER_ROW it is a single row, a ribbon in disguise.
function gridIsDistinct(slot) {
  return Number.isInteger(slot.chainLength) && slot.chainLength > GR.PER_ROW;
}

export function resolveForms(slots) {
  const taken = new Map();   // family -> key that claimed it
  const out = {};
  // Pass 1 — a grounded slot claims the family ITS OWN renderer emits (architecture radial, flow vertical-stack).
  for (const s of slots) {
    if (!s.grounded) continue;
    if (taken.has(s.groundedFamily)) die(`${s.key}: grounded form ${s.groundedFamily} is already claimed by ${taken.get(s.groundedFamily)} — this is a bug in the DIAGRAMS table, not in the repo being explained.`);
    taken.set(s.groundedFamily, s.key);
    out[s.key] = { family: s.groundedFamily, variant: null };
  }
  // Pass 2 — every other slot takes the first free family from its own preference list.
  for (const s of slots) {
    if (out[s.key]) continue;
    const prefs = (s.conceptPrefs || [])
      .filter((v) => v !== 'ribbon' || ribbonIsSafe(s))
      .filter((v) => v !== 'grid' || gridIsDistinct(s))
      .filter((v) => v !== 'strata' || containmentIsGrounded(s));
    // If filtering left nothing, fall back to the unfiltered list: an illegible diagram is bad, but
    // refusing to draw one at all is worse, and INV-18 requires the mandatory diagrams to exist.
    const pick = prefs.find((v) => !taken.has(VARIANT_FAMILY[v]))
      || (s.conceptPrefs || []).find((v) => !taken.has(VARIANT_FAMILY[v]));
    if (!pick) die(`${s.key}: no distinct diagram form remains (claimed: ${[...taken.keys()].join(', ')}). `
      + `Every archetype is already used by another diagram — refusing to draw two diagrams of the same shape (INV-23).`);
    taken.set(VARIANT_FAMILY[pick], s.key);
    out[s.key] = { family: VARIANT_FAMILY[pick], variant: pick };
  }
  // Distinctness holds by construction: pass 1 dies on a repeated family, pass 2 only picks a family not yet taken.
  return out;
}

// Describes the picture THAT WAS DRAWN by a grounded renderer (never the brain's concept-rows altText, which
// describes a different diagram). Used for the <desc>, the recorded altText and a screen reader alike.
export function defaultAltText(spec, dg, ep, name, fallbackDesc, archModel, asConcept) {
  // a diagram drawn by the concept renderer is described by that renderer
  if (asConcept) return fallbackDesc || `${spec.title} diagram for ${name}`;
  if (spec.grounded === 'architecture') {
    const ecos = (Array.isArray(dg.ecosystems) ? dg.ecosystems : []).join('/') || 'one ecosystem';
    const total = dg.componentCount ?? (Array.isArray(dg.nodes) ? dg.nodes.length : 0);
    const shown = archModel.nodes.length;
    const hub = archModel.hub ? `${archModel.hub}, the core module the most others depend on, sits in the middle` : 'the most depended-on module sits in the middle';
    return `${name} module dependency map, drawn as a hub with the other modules around it: ${total} modules across ${ecos} wired by ${dg.internalEdgeCount ?? archModel.edges.length} internal dependencies`
      + `${archModel.trimmed ? `, showing the ${shown} most-connected` : ''}. ${hub}; each line runs from a module to what it depends on.`;
  }
  if (spec.grounded === 'flow') {
    const bins = (Array.isArray(ep.binaries) ? ep.binaries : []).map((b) => b && b.name).filter(Boolean).slice(0, 3).join(', ');
    return `${name} build & run lifecycle: the repo source flows through install (→ dependencies), build (→ compiled artifacts), run the entry point${bins ? ` (${bins})` : ''}, and verify (→ pass/fail), with each stage's input and output artifact labelled so you can see what changes at every step.`;
  }
  return fallbackDesc || `${spec.title} diagram for ${name}`;
}
