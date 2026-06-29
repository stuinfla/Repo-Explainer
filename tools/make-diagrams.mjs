#!/usr/bin/env node
// make-diagrams.mjs — Station 4 structural-SVG rung (tools/ CONTRACT.md row 4)
//
// JOB (ADR-0005 Station 4 + INV-18 + DDD §13 INV-15): produce the structural-diagram SVGs as REAL
// VECTOR diagrams — node boxes + connector arrows — NOT raw ASCII rendered as <text>. The MANDATORY
// architecture diagram (grounded in the REAL kb dep-graph + symbols) and the MANDATORY process/
// data-flow diagram (grounded in the REAL kb entrypoints) are drawn DIRECTLY from the structured
// extraction: each component/step becomes a <rect> box; each dependency/transition becomes a <line>
// arrow. The big-idea and aha-insight diagrams are drawn from the brain-authored structure (its
// ASCII parsed into boxes + arrows). Visual conventions follow the ascii-to-svg skill
// (~/.claude/skills/ascii-to-svg): minimal palette, rounded boxes, triangle arrowheads, dark-mode
// aware, xmllint-clean.
//
// This is the fix for the failure the owner caught: the prior asciiToSvg() emitted ONE background
// <rect> + N <text> lines (raw ASCII), which is NOT a diagram. A real diagram has a box per node and
// an arrow per relationship. The conformance test (tests/diagrams.test.mjs) asserts architecture.svg
// and flow.svg each contain >=2 <rect> OR >=1 connector — this tool now satisfies it with genuine,
// grounded vectors.
//
// CONTRACT conformance: uniform invocation `node tools/make-diagrams.mjs <build-dir>`; reads ONLY its
// declared slice (kb.depGraphPath / .entrypointsPath / .symbolsPath + visuals.<key>.{ascii,altText} +
// concept.palette); writes ONLY visuals.architectureDiagram / .flowDiagram / .bigIdeaDiagram /
// .insightDiagram (+ the four .svg files under <build-dir>/assets/); PURE (no network); FAIL LOUD
// (non-zero exit + clear reason, never a silent placeholder); idempotent.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOL = 'make-diagrams';

function die(error) {
  process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error }) + '\n');
  process.stderr.write(`${TOOL}: ${error}\n`);
  process.exit(1);
}
const warn = (msg) => process.stderr.write(`${TOOL}: warning: ${msg}\n`);

function loadJson(file, label) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { die(`cannot read ${label} at ${file}: ${e.message}`); }
  try { return JSON.parse(raw); }
  catch (e) { die(`${label} at ${file} is not valid JSON: ${e.message}`); }
}

/** kb paths may be repo-root-relative (cwd) or build-dir-relative; resolve robustly. */
function resolveKbPath(p, buildDir) {
  if (!p || typeof p !== 'string') return null;
  const cands = path.isAbsolute(p)
    ? [p]
    : [path.resolve(process.cwd(), p), path.resolve(buildDir, p)];
  for (const c of cands) { if (fs.existsSync(c)) return c; }
  return null;
}

const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ── Vector layout constants (ascii-to-svg minimal style) ──────────────────────────────────────
const FONT = 14, BOX_H = 46, CHAR_W = 7.4, SUB_CW = 6.7, TITLE_CW = 8.7, BOX_PAD_X = 18, MIN_BOX_W = 96, MAX_BOX_W = 440;
const H_GAP = 28, V_GAP = 48, PAD = 26, TITLE_H = 36, BAND_W = 132;
const LBL_CLIP = 46, SUB_CLIP = 52;
// Box width must fit the WIDER of the label (14px) and the sub-label (11px). The sub-label was
// ignored before, so long subs ("2 dependents · 18 symbols") overflowed and collided with neighbours.
const itemWidth = (it) => {
  const lbl = clip(it.label, LBL_CLIP), sub = it.sub ? clip(it.sub, SUB_CLIP) : '';
  const w = Math.max(lbl.length * CHAR_W, sub.length * SUB_CW);
  return Math.min(MAX_BOX_W, Math.max(MIN_BOX_W, Math.ceil(w) + BOX_PAD_X * 2));
};

// Derive an on-brand diagram theme from concept.palette (optional, read-only). Null → neutral default.
function themeFromPalette(palette) {
  if (!palette || typeof palette !== 'object') return null;
  const g = (k) => (typeof palette[k] === 'string' && palette[k].trim() ? palette[k].trim() : null);
  const bg = g('surface') || g('bg-2') || g('bg');
  const ink = g('ink');
  if (!bg || !ink) return null;
  return { bg, ink, border: g('ridge') || g('accent') || ink, accent: g('accent') || ink };
}

function defsBlock(theme) {
  const t = theme || {};
  const boxFill = t.bg || '#f8f9fa', boxStroke = t.border || '#333333', ink = t.ink || '#1a1a1a';
  const arrow = t.arrow || t.border || '#555555', accent = t.accent || '#4a90d9';
  // Neutral default ships a dark-mode media query; an explicit brand theme is deliberate (no query).
  const darkBlock = theme ? '' : `
      @media (prefers-color-scheme: dark) {
        .box { fill: #2d333b; stroke: #768390; }
        .lbl { fill: #e6edf3; }
        .arr { stroke: #768390; }
        .ah  { fill: #768390; }
        .ttl { fill: #e6edf3; }
        .band { fill: #6cb6ff; }
      }`;
  return `  <defs>
    <marker id="ah" markerWidth="9" markerHeight="7" refX="8.5" refY="3.5" orient="auto">
      <polygon class="ah" points="0 0, 9 3.5, 0 7" fill="${arrow}"/>
    </marker>
    <style>
      .box { fill: ${boxFill}; stroke: ${boxStroke}; stroke-width: 1.5px; }
      .lbl { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: ${FONT}px; font-weight: 500; fill: ${ink}; }
      .sub { font-size: 11px; font-weight: 400; opacity: .8; }
      .arr { stroke: ${arrow}; stroke-width: 1.5px; fill: none; }
      .band { font-family: system-ui, sans-serif; font-size: 11px; font-weight: 700; fill: ${accent}; letter-spacing: .04em; }
      .ttl { font-family: system-ui, sans-serif; font-size: 15px; font-weight: 700; fill: ${ink}; }${darkBlock}
    </style>
  </defs>`;
}

function boxEl(x, y, w, label, sub) {
  const cx = x + w / 2, cy = y + BOX_H / 2;
  const main = `<text class="lbl" x="${cx}" y="${sub ? cy - 5 : cy}" text-anchor="middle" dominant-baseline="middle">${escapeXml(clip(label, 46))}</text>`;
  const subt = sub ? `<text class="lbl sub" x="${cx}" y="${cy + 12}" text-anchor="middle" dominant-baseline="middle">${escapeXml(clip(sub, 52))}</text>` : '';
  return `  <g><rect class="box" x="${x}" y="${y}" width="${w}" height="${BOX_H}" rx="5"/>${main}${subt}</g>`;
}
const vArrow = (cx, y1, y2) => `  <line class="arr" x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2 - 1}" marker-end="url(#ah)"/>`;
const hArrow = (x1, x2, cy) => `  <line class="arr" x1="${x1}" y1="${cy}" x2="${x2 - 1}" y2="${cy}" marker-end="url(#ah)"/>`;

/**
 * Render an ordered list of rows as a vertical diagram: boxes per row, a downward arrow between
 * consecutive rows (the spine), and optional left-to-right arrows WITHIN a row (connectWithin).
 * Every row is centred on one vertical axis so the spine arrows are straight. Returns crisp vectors.
 * row = { band?: string, items: [{label, sub?}], connectWithin?: bool }
 */
function renderRows(title, rows, theme) {
  rows = rows.filter((r) => r && Array.isArray(r.items) && r.items.length);
  if (!rows.length) rows = [{ items: [{ label: title }] }];
  const anyBand = rows.some((r) => r.band);
  const ttl = clip(title, 72);
  const rowWidth = (r) => r.items.reduce((s, it) => s + itemWidth(it), 0) + H_GAP * (r.items.length - 1);
  const contentW = Math.max(MIN_BOX_W, ...rows.map(rowWidth));
  const baseLeft = PAD + (anyBand ? BAND_W : 0);
  const contentBlockW = baseLeft + contentW + PAD;
  const titleW = Math.ceil(ttl.length * TITLE_CW) + PAD * 2;        // W must also fit the title (it clipped before)
  const W = Math.ceil(Math.max(contentBlockW, titleW));
  const shift = Math.max(0, (W - contentBlockW) / 2);               // re-centre the content when the title widens W
  const leftPad = baseLeft + shift;
  const bandX = PAD + shift;
  const centerX = leftPad + contentW / 2;
  const H = Math.ceil(PAD + TITLE_H + rows.length * BOX_H + (rows.length - 1) * V_GAP + PAD);

  const parts = [];
  parts.push(`  <text class="ttl" x="${W / 2}" y="${PAD + 14}" text-anchor="middle">${escapeXml(ttl)}</text>`);

  const rowGeom = rows.map((r, i) => {
    const y = PAD + TITLE_H + i * (BOX_H + V_GAP);
    const rw = rowWidth(r);
    let x = centerX - rw / 2;
    const boxes = r.items.map((it) => {
      const w = itemWidth(it);
      const g = { x, w, cx: x + w / 2, cy: y + BOX_H / 2 };
      x += w + H_GAP;
      return g;
    });
    return { y, boxes };
  });

  // spine: downward arrows between consecutive rows
  for (let i = 0; i < rows.length - 1; i++) {
    parts.push(vArrow(centerX, rowGeom[i].y + BOX_H, rowGeom[i + 1].y));
  }
  // rows: within-row horizontal arrows (if requested) then the boxes
  rows.forEach((r, i) => {
    const g = rowGeom[i];
    if (r.band) parts.push(`  <text class="band" x="${bandX}" y="${g.y + BOX_H / 2}" dominant-baseline="middle">${escapeXml(clip(r.band, 18))}</text>`);
    if (r.connectWithin && g.boxes.length > 1) {
      for (let j = 0; j < g.boxes.length - 1; j++) {
        parts.push(hArrow(g.boxes[j].x + g.boxes[j].w, g.boxes[j + 1].x, g.boxes[j].cy));
      }
    }
    r.items.forEach((it, j) => parts.push(boxEl(g.boxes[j].x, g.y, g.boxes[j].w, it.label, it.sub)));
  });

  const desc = `${title}: ${rows.map((r) => r.items.map((it) => it.label).join(r.connectWithin ? ' → ' : ', ')).join(' ↓ ')}`;
  return { svg: wrapSvg(W, H, parts.join('\n'), theme, title, desc), W, H, desc };
}

function wrapSvg(W, H, body, theme, title, desc) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="d-title d-desc">
  <title id="d-title">${escapeXml(title)}</title>
  <desc id="d-desc">${escapeXml(desc)}</desc>
${defsBlock(theme)}
${body}
</svg>
`;
}

/** xmllint is the proof of well-formedness; its absence or a failure is a loud stop. */
function assertXmllintClean(svgPath, key) {
  try {
    execFileSync('xmllint', ['--noout', svgPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    if (e && e.code === 'ENOENT') die(`xmllint not found on PATH — cannot validate the ${key} SVG; refusing to ship an unverified diagram`);
    const detail = e && e.stderr ? e.stderr.toString().trim() : (e ? e.message : 'unknown error');
    die(`SVG validation failed for ${key} (${svgPath}): ${detail}`);
  }
}

function symbolCountFor(node, sym) {
  if (!sym || !sym.byCrate || !node) return null;
  const bc = sym.byCrate, cands = [node.name];
  if (node.manifest) { const dir = String(node.manifest).replace(/\\/g, '/').replace(/\/[^/]+$/, ''); if (dir) cands.push(dir); }
  for (const c of cands) if (c && Object.prototype.hasOwnProperty.call(bc, c) && typeof bc[c] === 'number') return bc[c];
  return null;
}

// ── ARCHITECTURE: real boxes+arrows from the dep-graph, layered by dependency role ─────────────
function architectureRows(dg, sym) {
  const nodes = Array.isArray(dg.nodes) ? dg.nodes : [];
  const edges = Array.isArray(dg.internalEdges) ? dg.internalEdges : [];
  const inDeg = {}, outDeg = {};
  for (const e of edges) { if (!e || !e.to || !e.from) continue; inDeg[e.to] = (inDeg[e.to] || 0) + 1; outDeg[e.from] = (outDeg[e.from] || 0) + 1; }
  const plur = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const symAnn = (n) => { const k = symbolCountFor(n, sym); return k != null ? plur(k, 'symbol') : ''; };
  const ext = Array.isArray(dg.externalDepNames) ? dg.externalDepNames : [];
  const extRow = ext.length
    ? { band: 'EXTERNAL', items: [{ label: clip(ext.slice(0, 4).join(', '), 40), sub: `${dg.externalDepCount ?? ext.length} external deps` }] }
    : null;

  if (edges.length === 0) {
    // No internal graph: a row of component boxes (>=2 → real vectors). Single-component → add a deps box.
    const comps = nodes.slice(0, 6).map((n) => ({ label: n.name, sub: symAnn(n) }));
    if (comps.length >= 2) {
      const rows = [{ band: 'COMPONENTS', items: comps }];
      if (extRow) rows.push(extRow);
      return rows;
    }
    return [
      { band: 'COMPONENT', items: comps.length ? comps : [{ label: dg.target || 'this repo' }] },
      extRow || { band: 'EXTERNAL', items: [{ label: '(standalone — no internal deps)' }] },
    ];
  }

  const byDeg = (a, b, deg) => (deg[b.name] || 0) - (deg[a.name] || 0);
  const apps = nodes.filter((n) => !(inDeg[n.name] > 0) && outDeg[n.name] > 0).sort((a, b) => byDeg(a, b, outDeg)).slice(0, 5);
  const core = nodes.filter((n) => inDeg[n.name] > 0 && outDeg[n.name] > 0).sort((a, b) => byDeg(a, b, inDeg)).slice(0, 5);
  const found = nodes.filter((n) => !(outDeg[n.name] > 0) && inDeg[n.name] > 0).sort((a, b) => byDeg(a, b, inDeg)).slice(0, 5);
  const standalone = nodes.filter((n) => !(inDeg[n.name] > 0) && !(outDeg[n.name] > 0)).slice(0, 5);

  const rows = [];
  if (apps.length) rows.push({ band: 'APPS / ENTRY', items: apps.map((n) => ({ label: n.name, sub: `uses ${outDeg[n.name] || 0} internal` })) });
  if (core.length) rows.push({ band: 'CORE', items: core.map((n) => ({ label: n.name, sub: [plur(inDeg[n.name] || 0, 'dependent'), symAnn(n)].filter(Boolean).join(' · ') })) });
  if (found.length) rows.push({ band: 'FOUNDATION', items: found.map((n) => ({ label: n.name, sub: [plur(inDeg[n.name] || 0, 'dependent'), symAnn(n)].filter(Boolean).join(' · ') })) });
  if (standalone.length) rows.push({ band: 'STANDALONE', items: standalone.map((n) => ({ label: n.name })) });
  if (extRow) rows.push(extRow);
  // Guarantee a real diagram even in degenerate band distributions.
  if (rows.length < 2) rows.push(extRow || { band: 'COMPONENTS', items: nodes.slice(0, 4).map((n) => ({ label: n.name })) });
  return rows;
}

// ── PROCESS / DATA-FLOW: real step boxes + arrows from the entrypoints ─────────────────────────
function flowRows(ep) {
  const pick = (cat) => { const c = (Array.isArray(ep.commands) ? ep.commands : []).find((x) => x && x.category === cat); return c ? c.cmd : null; };
  const binNames = (Array.isArray(ep.binaries) ? ep.binaries : []).map((b) => b && b.name).filter(Boolean);
  const installCmd = (Array.isArray(ep.install) && ep.install[0]) || pick('install');
  const buildCmd = pick('build');
  const runCmd = binNames[0] || pick('run') || (Array.isArray(ep.quickstart) && ep.quickstart[0]) || null;
  const testCmd = pick('test');

  const steps = [];
  if (installCmd) steps.push(['1 · Install', installCmd]);
  if (buildCmd) steps.push(['2 · Build', buildCmd]);
  if (runCmd) steps.push([`${steps.length + 1} · Run`, runCmd]);
  if (testCmd) steps.push([`${steps.length + 1} · Verify`, testCmd]);
  if (!steps.length && Array.isArray(ep.quickstart) && ep.quickstart[0]) steps.push(['1 · Run', ep.quickstart[0]]);

  const rows = steps.map(([label, cmd]) => ({ items: [{ label, sub: clip(cmd, 48) }] }));
  if (rows.length < 2) rows.push({ items: [{ label: '✓ Done', sub: binNames.length ? `entry: ${binNames.slice(0, 3).join(', ')}` : 'running' }] });
  return rows;
}

// ── BIG-IDEA / INSIGHT: parse the brain-authored ASCII into boxes + arrows (no raw <text> dump) ──
function asciiRows(ascii) {
  const lines = String(ascii).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { title: 'Diagram', rows: [] };
  const title = lines[0];
  const body = lines.slice(1).length ? lines.slice(1) : lines; // if only one line, use it as the body too
  const rows = body.map((line) => {
    const parts = line.split(/\s*(?:->|→|=>|\|>)\s*/).map((p) => p.replace(/^[[(<{]+|[\])>}]+$/g, '').trim()).filter(Boolean);
    if (parts.length > 1) return { items: parts.map((p) => ({ label: p })), connectWithin: true };
    return { items: [{ label: line.replace(/^[[(<{]+|[\])>}]+$/g, '').trim() || line }] };
  });
  return { title, rows };
}

const DIAGRAMS = [
  { key: 'architectureDiagram', file: 'architecture.svg', title: 'Architecture', grounded: 'architecture' },
  { key: 'flowDiagram', file: 'flow.svg', title: 'Process / Data Flow', grounded: 'flow' },
  { key: 'bigIdeaDiagram', file: 'big-idea.svg', title: 'Big Idea', grounded: null },
  { key: 'insightDiagram', file: 'insight.svg', title: 'The Insight', grounded: null },
];

function defaultAltText(spec, dg, ep, name, fallbackDesc) {
  if (spec.grounded === 'architecture') {
    const ecos = (Array.isArray(dg.ecosystems) ? dg.ecosystems : []).join('/') || 'one ecosystem';
    return `${name} architecture diagram: ${dg.componentCount ?? (Array.isArray(dg.nodes) ? dg.nodes.length : 0)} components across ${ecos}, ${dg.internalEdgeCount ?? 0} internal dependencies — apps depend on core modules which build on foundation libraries.`;
  }
  if (spec.grounded === 'flow') {
    const bins = (Array.isArray(ep.binaries) ? ep.binaries : []).map((b) => b && b.name).filter(Boolean).slice(0, 3).join(', ');
    return `${name} process and data-flow diagram: install, build, run the entry point(s)${bins ? ` (${bins})` : ''}, then verify — the runtime sequence derived from the project's entrypoints.`;
  }
  return fallbackDesc || `${spec.title} diagram for ${name}`;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 1 || !argv[0]) die('usage: node tools/make-diagrams.mjs <build-dir>');
  const buildDir = path.resolve(argv[0]);
  if (!fs.existsSync(buildDir) || !fs.statSync(buildDir).isDirectory()) die(`build directory does not exist: ${buildDir}`);

  const buildJsonPath = path.join(buildDir, 'build.json');
  if (!fs.existsSync(buildJsonPath)) die(`build.json not found in build dir: ${buildJsonPath}`);
  const buildJson = loadJson(buildJsonPath, 'build.json');

  const kb = buildJson.kb;
  if (!kb || typeof kb !== 'object') die("build.json is missing the 'kb' slot (Station 1 must run before Station 4)");

  // Grounding preconditions: architecture & flow are REAL structure or a loud stop (INV-18).
  const dgPath = resolveKbPath(kb.depGraphPath, buildDir);
  if (!dgPath) die(`architecture diagram cannot be produced: kb.depGraphPath not found (${kb.depGraphPath ?? 'unset'}) — refusing to invent module structure`);
  const dg = loadJson(dgPath, 'dep-graph');
  if (!Array.isArray(dg.nodes) || dg.nodes.length === 0) die(`architecture diagram cannot be produced: dep-graph has no nodes (${dgPath})`);

  const epPath = resolveKbPath(kb.entrypointsPath, buildDir);
  if (!epPath) die(`flow diagram cannot be produced: kb.entrypointsPath not found (${kb.entrypointsPath ?? 'unset'}) — refusing to invent runtime flow`);
  const ep = loadJson(epPath, 'entrypoints');
  const hasFlow = (Array.isArray(ep.install) && ep.install.length) || (Array.isArray(ep.commands) && ep.commands.length)
    || (Array.isArray(ep.binaries) && ep.binaries.length) || (Array.isArray(ep.quickstart) && ep.quickstart.length);
  if (!hasFlow) die(`flow diagram cannot be produced: entrypoints has no install/commands/binaries/quickstart (${epPath})`);

  const symPath = resolveKbPath(kb.symbolsPath, buildDir);
  let sym = null;
  if (symPath) sym = loadJson(symPath, 'symbols');
  else warn(`kb.symbolsPath not found (${kb.symbolsPath ?? 'unset'}) — architecture diagram will omit symbol counts`);

  const name = (buildJson.understanding && buildJson.understanding.repoName)
    || (buildJson.repo && buildJson.repo.name) || dg.metaName || ep.metaName || dg.target || 'this repo';

  const theme = themeFromPalette(buildJson.concept && buildJson.concept.palette);
  if (theme) process.stderr.write(`${TOOL}: theming diagrams from concept.palette (bg ${theme.bg}, ink ${theme.ink})\n`);

  const assetsDir = path.join(buildDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const visualsIn = (buildJson.visuals && typeof buildJson.visuals === 'object') ? buildJson.visuals : {};
  const merged = {};

  for (const spec of DIAGRAMS) {
    const existing = (visualsIn[spec.key] && typeof visualsIn[spec.key] === 'object') ? visualsIn[spec.key] : {};
    let rendered;

    if (spec.grounded === 'architecture') {
      rendered = renderRows(`${name} — Architecture`, architectureRows(dg, sym), theme);
    } else if (spec.grounded === 'flow') {
      rendered = renderRows(`${name} — Process / Data Flow`, flowRows(ep), theme);
    } else {
      // judgment diagrams: require brain-authored ASCII (structure), parse it into boxes + arrows.
      const ascii = (typeof existing.ascii === 'string' && existing.ascii.trim()) ? existing.ascii : null;
      if (!ascii) die(`missing brain-authored ASCII for ${spec.key}: ${spec.title} is a judgment diagram with no KB source — the brain must author visuals.${spec.key}.ascii`);
      const parsed = asciiRows(ascii);
      rendered = renderRows(`${name} — ${parsed.title || spec.title}`, parsed.rows, theme);
    }

    const altText = (typeof existing.altText === 'string' && existing.altText.trim())
      ? existing.altText : defaultAltText(spec, dg, ep, name, rendered.desc);

    const svgPath = path.join(assetsDir, spec.file);
    fs.writeFileSync(svgPath, rendered.svg, 'utf8');
    assertXmllintClean(svgPath, spec.key);

    merged[spec.key] = { svgPath, altText, asciiFallback: rendered.desc, format: 'svg-vector', xmllintOK: true };
  }

  buildJson.visuals = { ...visualsIn, ...merged };
  fs.writeFileSync(buildJsonPath, JSON.stringify(buildJson, null, 2) + '\n', 'utf8');

  const outputs = {
    slot: 'visuals',
    mergedKeys: DIAGRAMS.map((d) => d.key),
    svgPaths: Object.fromEntries(DIAGRAMS.map((d) => [d.key, merged[d.key].svgPath])),
    groundedIn: { architecture: dgPath, flow: epPath, symbols: symPath || null },
    renderer: 'vector (boxes + arrows)',
  };
  process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n');
  process.exit(0);
}

main();
