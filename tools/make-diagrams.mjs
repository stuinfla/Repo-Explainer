#!/usr/bin/env node
// make-diagrams.mjs — Station 4: draw the page's diagrams as real, dark glassmorphic SVGs (never ASCII-as-text).
//
// READS  build.json: kb.depGraphPath / kb.entrypointsPath / kb.symbolsPath, concept.palette, repo.clonePath
//        (only to verify story claims), and visuals.<key>.{rows, title, altText} for the four slots plus
//        visuals.systemMap, visuals.decision and visuals.heroAnim.
// WRITES assets/{architecture,flow,big-idea,insight}.svg  AND their phone twins assets/<name>.m.svg,
//        assets/hero-scene.svg | refusal.svg (+ refusal.m.svg) for heroAnim, and merges
//        visuals.<key> = { svgPath, mobileSvgPath, altText, asciiFallback, form, formVariant, mobileLabelPx, ... }
//        (+ the authored rows/title round-tripped, so a re-run redraws identically) and visuals.heroAnim.
//
// EVERY diagram is drawn TWICE from ONE model: a wide canvas and a 360-wide portrait canvas (one column, no text under
// 13 units = 11.3px on a 390px phone). The page swaps them with <picture><source media>; mobileLabelPx is measured on
// the phone twin and the step FAILS, after one corrective re-flow, if any text is under MOBILE_FLOOR_PX (11).
//
// WHAT IS DRAWN, per slot (the first that applies wins):
//   1. a verified story diagram (visuals.systemMap -> architecture slot, visuals.decision -> flow slot);
//   2. architecture: a RADIAL hub-and-spokes dependency map from the real dep-graph (the most depended-on
//      module in the middle, up to ARCH_MAX_NODES modules in all); flow: a vertical build-lifecycle card
//      stack from the real entrypoints (skipped for a library with no entrypoints);
//   3. otherwise an authored concept diagram from visuals.<key>.rows. Architecture falls here when the dep-graph
//      has 0 edges, flow when the brain authored a real runtime flow.
// Each slot gets a distinct form family (resolveForms, INV-23); a collision dies loudly before any SVG is written.
//
// PURE (no network); FAIL LOUD (non-zero exit + a reason, never a placeholder); idempotent.
// stdout: one JSON { ok, outputs, error }; stderr: diagnostics. Design history: ADR-0012, 0013, 0014.
// Code: tools/diagrams/ (draw kit, desktop + phone renderers, models, story, legibility).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tune } from '../src/story-diagrams-mobile.mjs';
import {
  TOOL, die, warn, PAL, setPalette, wrapSvg,
} from './diagrams/draw.mjs';
import { renderArchitectureRadial, renderFlow } from './diagrams/arch-flow.mjs';
import { renderArchitectureMobile, renderFlowMobile } from './diagrams/mobile.mjs';
import { renderConcept } from './diagrams/concept.mjs';
import { renderConceptMobile } from './diagrams/mobile-concept.mjs';
import { renderRefusal, renderRefusalMobile } from './diagrams/refusal.mjs';
import { validateHeroScene, sceneAltText } from './diagrams/scene.mjs';
import {
  buildArchModel, buildFlowModel, DIAGRAMS, CONTAINMENT_CLAIM, resolveForms, defaultAltText,
} from './diagrams/models.mjs';
import { makeRepoReaders, storyFor, STORY_SLOT, authoredRows, correctedCaption } from './diagrams/story.mjs';
import {
  labelPx, findTextOverlaps, drawMobileChecked, reportLegibility,
} from './diagrams/legibility.mjs';

function loadJson(file, label) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { die(`cannot read ${label} at ${file}: ${e.message}`); }
  try { return JSON.parse(raw); }
  catch (e) { die(`${label} at ${file} is not valid JSON: ${e.message}`); }
}

function resolveKbPath(p, buildDir) {
  if (!p || typeof p !== 'string') return null;
  const cands = path.isAbsolute(p) ? [p] : [path.resolve(process.cwd(), p), path.resolve(buildDir, p)];
  for (const c of cands) { if (fs.existsSync(c)) return c; }
  return null;
}

function assertXmllintClean(svgPath, key) {
  try { execFileSync('xmllint', ['--noout', svgPath], { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) {
    if (e && e.code === 'ENOENT') die(`xmllint not found on PATH — cannot validate the ${key} SVG; refusing to ship an unverified diagram`);
    const detail = e && e.stderr ? e.stderr.toString().trim() : (e ? e.message : 'unknown error');
    die(`SVG validation failed for ${key} (${svgPath}): ${detail}`);
  }
}

const mobileName = (file) => file.replace(/\.svg$/, '.m.svg');

// Draw one slot that has no verified story: its grounded renderer, or the concept renderer from authored rows.
// Returns the wide rendering and `mobile`, a thunk that draws the SAME model on the phone canvas.
function drawSlot(spec, existing, decision, c) {
  const asConcept = (spec.grounded === 'architecture' && c.archDegenerate) || (spec.grounded === 'flow' && c.flowAuthored);
  if (spec.grounded === 'architecture' && !asConcept) {
    const eyebrow = `${c.name.toUpperCase()} · DEPENDENCY MAP`, title = 'Module dependency map';
    const rendered = renderArchitectureRadial(eyebrow, title, c.archModel, c.archCaption, PAL);
    return { rendered, mobile: () => renderArchitectureMobile(eyebrow, title, c.archModel, c.archCaption, PAL), asciiSrc: null, conceptBack: null,
      altText: defaultAltText(spec, c.dg, c.ep, c.name, rendered.desc, c.archModel, false), strictOverlap: true };
  }
  if (spec.grounded === 'flow' && !asConcept) {
    const eyebrow = `${c.name.toUpperCase()} · LIFECYCLE`, title = 'Build & run lifecycle';
    const rendered = renderFlow(eyebrow, title, c.flowModel, c.flowCaption, PAL);
    return { rendered, mobile: () => renderFlowMobile(eyebrow, title, c.flowModel, c.flowCaption, PAL), asciiSrc: null, conceptBack: null,
      altText: defaultAltText(spec, c.dg, c.ep, c.name, rendered.desc, c.archModel, false) };
  }
  // concept diagram: real glass cards from the structured rows (never typeset ASCII)
  let rows = authoredRows(existing);
  if (!rows.length && spec.grounded) {
    die(`${spec.key}: this repo's dep-graph has ${c.totalModules} module(s) and 0 internal edges, so a dependency map would show nothing. `
      + `Author visuals.${spec.key}.rows — the CONCEPT of how the thing is built (the 3-4 parts a reader must hold in their head, in order) — `
      + `not the package wiring, and not a paragraph. Shape: one connected chain is ONE row of many items, e.g. `
      + `"rows":[{"items":["your text","tokenizer","ternary engine","384 numbers"],"connect":true}]. `
      + `Refusing to ship a diagram of an empty graph.`);
  }
  if (!rows.length) die(`missing structure for ${spec.key}: ${spec.title} needs visuals.${spec.key}.rows — the brain must author it`);
  const eyebrow = spec.grounded ? `${c.name.toUpperCase()} · ${spec.conceptEyebrow}` : spec.conceptEyebrow;
  const heading = (typeof existing.title === 'string' && existing.title.trim()) ? existing.title.trim() : spec.conceptHeading;
  const rawCap = (typeof existing.altText === 'string' && existing.altText.trim()) ? existing.altText.trim() : null;
  const cap = correctedCaption(spec, decision, rawCap, rows);
  const rendered = renderConcept(eyebrow, heading, rows, cap, PAL, decision.variant, spec.key);
  // round-trip the structured source + heading so a re-run (e.g. a refine loop) redraws identically without a brain call
  const conceptBack = { rows: rows.map((r) => ({ items: r.items.map((it) => it.label), connect: r.connectWithin })), title: heading };
  const asciiSrc = rows.map((r) => r.items.map((it) => it.label).join(r.connectWithin ? ' -> ' : '   ·   ')).join('\n');
  // a corrected caption must reach the accessible text too, or a screen reader hears a structure the page never drew
  const altText = (cap && cap !== rawCap) ? cap : (rawCap || defaultAltText(spec, c.dg, c.ep, c.name, rendered.desc, c.archModel, true));
  // a phone draws every chain top to bottom, so a visible "left-to-right" claim is restated, not left false
  const phoneCap = cap ? cap.replace(/left[- ]to[- ]right/gi, 'top-to-bottom') : cap;
  return { rendered, mobile: () => renderConceptMobile(eyebrow, heading, rows, phoneCap, PAL, decision.variant), asciiSrc, conceptBack, altText };
}

// Draw + prove the phone twin (one corrective re-flow, then a loud failure). `render(scale)` returns the finished SVG.
function phoneTwin(key, render) {
  try {
    return drawMobileChecked(key, (scale) => {
      tune.wrap = scale;
      try { return render(); } finally { tune.wrap = 1; }
    });
  } catch (e) { return die(e.message); }
}

function writeSvg(assetsDir, file, svg, key) {
  const p = path.join(assetsDir, file);
  fs.writeFileSync(p, svg, 'utf8');
  assertXmllintClean(p, key);
  return p;
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

  const dgPath = resolveKbPath(kb.depGraphPath, buildDir);
  if (!dgPath) die(`architecture diagram cannot be produced: kb.depGraphPath not found (${kb.depGraphPath ?? 'unset'}) — refusing to invent module structure`);
  const dg = loadJson(dgPath, 'dep-graph');
  // Only a MALFORMED graph dies here. Zero nodes is the most degenerate graph, not a different failure: it has
  // 0 edges, so it takes the authored-concept path below (which dies naming architectureDiagram.rows if none).
  if (!Array.isArray(dg.nodes)) die(`architecture diagram cannot be produced: dep-graph is malformed — no nodes array (${dgPath})`);

  const epPath = resolveKbPath(kb.entrypointsPath, buildDir);
  if (!epPath) die(`flow diagram cannot be produced: kb.entrypointsPath not found (${kb.entrypointsPath ?? 'unset'}) — refusing to invent runtime flow`);
  const ep = loadJson(epPath, 'entrypoints');
  const hasFlow = (Array.isArray(ep.install) && ep.install.length) || (Array.isArray(ep.commands) && ep.commands.length)
    || (Array.isArray(ep.binaries) && ep.binaries.length) || (Array.isArray(ep.quickstart) && ep.quickstart.length);
  // A pure library has no runtime entrypoints: skip the flow diagram rather than invent one (a verified decision story still draws).
  const skipFlow = !hasFlow;
  if (skipFlow) warn(`no runtime entrypoints (install/commands/binaries/quickstart) in ${epPath} — library repo; skipping the lifecycle flow diagram, architecture diagram still produced`);

  const symPath = resolveKbPath(kb.symbolsPath, buildDir);
  let sym = null;
  if (symPath) sym = loadJson(symPath, 'symbols');
  else warn(`kb.symbolsPath not found (${kb.symbolsPath ?? 'unset'}) — architecture diagram will omit symbol counts`);

  const name = (buildJson.understanding && buildJson.understanding.repoName)
    || (buildJson.repo && buildJson.repo.name) || dg.metaName || ep.metaName || dg.target || 'this repo';

  setPalette(buildJson.concept);
  process.stderr.write(`${TOOL}: palette accents ${PAL.accents.slice(0, 3).join(', ')}${buildJson.concept && buildJson.concept.palette ? ' (themed from concept.palette)' : ' (vivid default)'} — dark/glow renderer\n`);

  const assetsDir = path.join(buildDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const visualsIn = (buildJson.visuals && typeof buildJson.visuals === 'object') ? buildJson.visuals : {};
  const storyReaders = (visualsIn.systemMap || visualsIn.decision) ? makeRepoReaders(buildJson, buildDir) : null;
  // verified story diagrams, decided up front: a story slot never needs rows, a graph with edges or runtime entrypoints
  const stories = Object.fromEntries(Object.keys(STORY_SLOT).map((k) => [k, storyFor(k, visualsIn, storyReaders)]));
  const merged = {};

  // captions (mono, lowercase, reference-style)
  const ecos = (Array.isArray(dg.ecosystems) ? dg.ecosystems : []).join(' · ') || 'modules';
  const archModel = buildArchModel(dg, sym);
  const flowModel = skipFlow ? null : buildFlowModel(ep, dg);
  const totalModules = dg.componentCount ?? dg.nodes.length;
  const archCaption = `${totalModules} modules · ${dg.internalEdgeCount ?? archModel.edges.length} internal links · ${ecos}`
    + (archModel.trimmed ? `  ·  showing the ${archModel.nodes.length} most-connected` : '');

  // A dependency map with NO internal edges is a picture of nothing, so it is not drawn: the slot demotes to the
  // concept renderer and draws what the repo IS, from rows the brain authored (INV-18 still requires a diagram).
  const archDegenerate = archModel.edges.length === 0;
  if (archDegenerate) warn(`dep-graph has 0 internal edges (${totalModules} module${totalModules === 1 ? '' : 's'}) — a dependency map would show nothing; drawing the authored CONCEPT architecture instead`);

  // The flow model is a BUILD LIFECYCLE (install/build/run/test), not a runtime data flow, and is named as such.
  // A real runtime flow the brain authored (rows) is preferred; the lifecycle is the fallback.
  const flowAuthored = authoredRows(visualsIn.flowDiagram).length > 0;
  const flowCaption = flowModel ? `${flowModel.steps.length} stages · derived from the project's ${ecos} entrypoints` : null;

  // ── INV-23 FORM RESOLUTION (ADR-0012): decided ONCE for the whole page, before anything renders ──
  const active = DIAGRAMS.filter((spec) => !(spec.grounded === 'flow' && skipFlow && !stories[spec.key]));
  const renderSlots = active.map((spec) => {
    const authored = authoredRows(visualsIn[spec.key]);
    return {
      key: spec.key,
      conceptPrefs: spec.conceptPrefs,
      groundedFamily: spec.groundedFamily,
      // nested frames only when the authored takeaway says one thing contains another
      semanticContainment: CONTAINMENT_CLAIM.test(String(((visualsIn[spec.key] || {}).altText) || '')),
      // cards this slot would draw as a concept diagram: a ribbon's width, and its phone legibility, scale with it
      chainLength: authored.length ? Math.max(...authored.map((r) => r.items.length)) : null,
      // "grounded" = this slot draws its own real model (radial map / lifecycle stack)
      grounded: (spec.grounded === 'architecture' && !archDegenerate)
        || (spec.grounded === 'flow' && !flowAuthored && Boolean(flowModel)),
    };
  });
  const forms = resolveForms(renderSlots);
  process.stderr.write(`${TOOL}: INV-23 forms — ${Object.entries(forms).map(([k, d]) => `${k.replace('Diagram', '')}:${d.family}`).join(' · ')}\n`);

  for (const spec of active) {
    const existing = (visualsIn[spec.key] && typeof visualsIn[spec.key] === 'object') ? visualsIn[spec.key] : {};
    const decision = forms[spec.key];
    const story = stories[spec.key];
    const drawn = story ? null : drawSlot(spec, existing, decision, { name, dg, ep, archModel, flowModel, archCaption, flowCaption, archDegenerate, flowAuthored, totalModules });
    const altText = story ? story.altText : drawn.altText;
    const slug = spec.file.replace(/\.svg$/, '');
    const wrap = (r, id) => wrapSvg({ id, W: r.W, H: r.H, body: r.body, title: `${name} — ${spec.title}`, desc: altText, ascii: drawn.asciiSrc || r.desc });
    const svg = story ? story.svg : wrap(drawn.rendered, `dg-${slug}`);
    const svgPath = writeSvg(assetsDir, spec.file, svg, spec.key);

    // the wide architecture map is the one grounded layout whose labels are placed from real module names: no two may collide
    if (drawn && drawn.strictOverlap) {
      const clash = findTextOverlaps(svg);
      if (clash.length) die(`${spec.key}: labels overlap on the dependency map — ${clash.slice(0, 3).map(([a, b]) => `"${a}" / "${b}"`).join('; ')}`);
    } else if (!story) {
      findTextOverlaps(svg).slice(0, 3).forEach(([a, b]) => warn(`${spec.key}: labels "${a}" and "${b}" overlap on the wide canvas`));
    }

    // the PHONE twin, drawn from the same model, measured, and required to clear the floor
    const twin = phoneTwin(spec.key, () => (story ? story.mobile() : wrap(drawn.mobile(), `dg-${slug}-m`)));
    const mobileSvgPath = writeSvg(assetsDir, mobileName(spec.file), twin.svg, `${spec.key} (phone)`);
    if (twin.pass === 2) warn(`${spec.key}: the phone layout needed its corrective re-flow`);
    // `form` travels with the diagram so INV-23 is AUDITABLE after the fact (a test, or a grader verdict, can check what was drawn)
    merged[spec.key] = { svgPath, mobileSvgPath, altText, asciiFallback: story ? story.altText : (drawn.asciiSrc || drawn.rendered.desc), format: 'svg-vector-dark', xmllintOK: true,
      form: story ? story.kind : decision.family, formVariant: story ? story.kind : decision.variant,
      mobileLabelPx: twin.px, desktopLabelPx: labelPx(svg), ...(story ? {} : (drawn.conceptBack || {})),
      ...(story ? { story: story.kind, storyEvidence: story.evidence, storyNotes: story.notes } : {}) };
  }

  reportLegibility(TOOL, merged);

  // THE HERO ANIMATION — emitted ONLY when the brain authored `visuals.heroAnim` for THIS repo; never another repo's.
  // heroAnim.sceneSvg (INV-23's bespoke scene) is validated and installed as the band; otherwise the chips band is drawn.
  const animSpec = (visualsIn.heroAnim && typeof visualsIn.heroAnim === 'object') ? visualsIn.heroAnim : null;
  const markup = animSpec && typeof animSpec.sceneMarkup === 'string' && animSpec.sceneMarkup.trim() ? animSpec.sceneMarkup : null;
  if (animSpec && (markup || (typeof animSpec.sceneSvg === 'string' && animSpec.sceneSvg.trim()))) {
    // sceneMarkup = authored by the local brain; sceneSvg = a file the hosted agent wrote. Both meet the same strict contract (scoped ids, 390px text floor).
    let scene, srcPath = null;
    if (markup) scene = markup;
    else {
      srcPath = path.isAbsolute(animSpec.sceneSvg) ? animSpec.sceneSvg : path.join(buildDir, animSpec.sceneSvg);
      if (!fs.existsSync(srcPath)) die(`visuals.heroAnim.sceneSvg not found: ${srcPath} — the brain must author the scene before make-diagrams runs`);
      scene = fs.readFileSync(srcPath, 'utf8');
    }
    const defects = validateHeroScene(scene);
    if (defects.length) die(`heroAnim scene refused (${srcPath || 'sceneMarkup'}): ${defects.join('; ')}`);
    const dest = path.join(assetsDir, 'hero-scene.svg');
    if (!srcPath || path.resolve(srcPath) !== path.resolve(dest)) fs.writeFileSync(dest, scene, 'utf8');
    const { sceneMarkup: _drop, ...specRest } = animSpec;
    merged.heroAnim = {
      ...specRest, sceneSvg: 'assets/hero-scene.svg' /* a re-run (refine pass) re-reads the installed file */, svgPath: dest, altText: sceneAltText(scene, animSpec.altText),
      format: 'svg-vector-animated-scene', xmllintOK: true,
    };
    process.stderr.write(`${TOOL}: hero-scene.svg — authored scene installed as the hero animation (reduced-motion safe)\n`);
  } else if (animSpec) {
    const r = renderRefusal(PAL, animSpec);
    const svg = wrapSvg({ id: 'dg-hero', W: r.W, H: r.H, body: r.body, title: `${name} — the one idea, in motion`, desc: r.desc, extraStyle: r.style });
    const p = writeSvg(assetsDir, 'refusal.svg', svg, 'heroAnim');
    const rm = renderRefusalMobile(PAL, animSpec);
    const twin = phoneTwin('heroAnim', () => wrapSvg({ id: 'dg-hero-m', W: rm.W, H: rm.H, body: rm.body, title: `${name} — the one idea, in motion`, desc: rm.desc, extraStyle: rm.style }));
    const px = twin.px;
    const mp = writeSvg(assetsDir, 'refusal.m.svg', twin.svg, 'heroAnim (phone)');
    merged.heroAnim = { ...animSpec, svgPath: p, mobileSvgPath: mp, mobileLabelPx: px, altText: r.desc, format: 'svg-vector-animated', xmllintOK: true };
    process.stderr.write(`${TOOL}: refusal.svg + refusal.m.svg — hero animation (9s loop, reduced-motion safe, phone ${px}px)\n`);
  } else {
    process.stderr.write(`${TOOL}: no visuals.heroAnim authored — skipping the hero animation (never borrowing another repo's)\n`);
  }

  buildJson.visuals = { ...visualsIn, ...merged };
  fs.writeFileSync(buildJsonPath, JSON.stringify(buildJson, null, 2) + '\n', 'utf8');

  const producedKeys = DIAGRAMS.map((d) => d.key).filter((k) => merged[k]);
  const outputs = {
    slot: 'visuals',
    mergedKeys: producedKeys,
    svgPaths: Object.fromEntries(producedKeys.map((k) => [k, merged[k].svgPath])),
    mobileSvgPaths: Object.fromEntries(producedKeys.map((k) => [k, merged[k].mobileSvgPath])),
    groundedIn: { architecture: dgPath, flow: skipFlow ? null : epPath, symbols: symPath || null },
    renderer: 'dark glassmorphic SVG',
  };
  process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n');
  process.exit(0);
}

main();
