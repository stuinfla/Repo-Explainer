// tools/diagrams/scene.mjs — the ONE validator for an authored hero scene (visuals.heroAnim.sceneSvg, INV-23).
// Used by make-diagrams (installs the scene), generate-image (decides whether the raster hero is skipped) and
// the local brain (one repair pass, then fall back with a disclosed reason). A scene that fails any check never ships.
//
// Rules, each of which has bitten a real page:
//   - a root <svg> with its own id and a viewBox (it must scale);
//   - real animation (@keyframes or <animate>) AND a prefers-reduced-motion static end state;
//   - everything scoped under the root id: every CSS selector starts with #<id>, every keyframe name and every
//     inner id starts with <id> (the SVG is inlined into the page, so unscoped rules would restyle the page);
//   - no script, foreignObject, event handlers or external references;
//   - the smallest text, scaled to a phone (312 css px of content width), is >= MOBILE_FLOOR_PX;
//   - xmllint-clean and <= MAX_SCENE_BYTES.

import { execFileSync } from 'node:child_process';
import { MOBILE_FLOOR_PX, minTextPx } from './legibility.mjs';

export const MAX_SCENE_BYTES = 25_000;

function cssBlocks(css) {
  // yields { header, body } for each top-level block of a stylesheet
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    out.push({ header: css.slice(i, open).trim(), body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

function scopeDefects(css, id, defects) {
  for (const { header, body } of cssBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    if (/^@keyframes\b/i.test(header)) {
      const name = header.replace(/^@keyframes\s+/i, '').trim();
      if (!name.startsWith(id)) defects.push(`keyframes "${name}" is not prefixed with the scene id "${id}"`);
    } else if (/^@(media|supports)\b/i.test(header)) {
      scopeDefects(body, id, defects);
    } else if (header.startsWith('@')) {
      defects.push(`at-rule "${header.slice(0, 30)}" is not allowed in a scene`);
    } else {
      for (const sel of header.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean)) {
        if (!sel.startsWith(`#${id}`)) defects.push(`selector "${sel.slice(0, 40)}" is not scoped under #${id}`);
      }
    }
  }
}

/** Every defect of a scene's markup; [] means it may ship. One contract for both doors: the SVG is inlined into the page. */
export function validateHeroScene(svg) {
  const defects = [];
  if (typeof svg !== 'string' || !svg.trim()) return ['scene is empty'];
  if (Buffer.byteLength(svg) > MAX_SCENE_BYTES) defects.push(`scene is ${Buffer.byteLength(svg)} bytes (max ${MAX_SCENE_BYTES})`);
  const root = /<svg\b[^>]*>/i.exec(svg);
  if (!root) return ['no <svg> root element'];
  const id = (/\bid="([^"]+)"/.exec(root[0]) || [])[1];
  if (!id) defects.push('root <svg> has no id (every selector must be scoped under it)');
  if (!/viewBox="0 0 [0-9.]+ [0-9.]+"/i.test(root[0])) defects.push('root <svg> has no viewBox of the form "0 0 W H" (it cannot scale on the page)');
  if (!/@keyframes|<animate/i.test(svg)) defects.push('scene carries no animation (@keyframes or <animate>)');
  if (!/prefers-reduced-motion/i.test(svg)) defects.push('scene must honour prefers-reduced-motion with a static end state');
  if (/<script\b|<foreignObject\b|\son[a-z]+\s*=|javascript:|(?:href|src)\s*=\s*"(?!#)|url\(\s*["']?(?!#)|@import/i.test(svg)) {
    defects.push('scene contains a script, foreignObject, event handler or external reference');
  }
  if (id) {
    for (const m of svg.matchAll(/\sid="([^"]+)"/g)) if (!m[1].startsWith(id)) defects.push(`inner id "${m[1]}" is not prefixed with "${id}"`);
    for (const m of svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) scopeDefects(m[1], id, defects);
  }
  const px = minTextPx(svg);
  if (px == null) defects.push('scene declares no text size (it needs real <text> labels)');
  else if (px < MOBILE_FLOOR_PX) defects.push(`smallest text is ${px}px on a 390px phone (floor ${MOBILE_FLOOR_PX}px); use a ~400-unit-wide viewBox and text >= 14 units`);
  try { execFileSync('xmllint', ['--noout', '-'], { input: svg, stdio: ['pipe', 'ignore', 'pipe'] }); }
  catch (e) {
    defects.push(e && e.code === 'ENOENT' ? 'xmllint not found on PATH — cannot verify the scene' : `not well-formed XML: ${String(e?.stderr || e?.message || e).trim().slice(0, 200)}`);
  }
  return [...new Set(defects)];
}

export const sceneAltText = (svg, fallback = 'The one idea, in motion') => ((/<desc[^>]*>([\s\S]*?)<\/desc>/i.exec(svg) || [])[1] || fallback).trim();
