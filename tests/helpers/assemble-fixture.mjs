// Shared fixture for tests that run the REAL tools/assemble-page.mjs on a minimal-but-valid build dir.
// `mutate(ctx, dir)` edits the build.json object before it is written; `scene`/`hero3d` add optional slots.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ASSEMBLE = path.join(REPO, 'tools', 'assemble-page.mjs');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>a</title><desc>d</desc><rect width="4" height="4"/></svg>';
const SCENE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>s</title><desc>the scene</desc><style>@keyframes g{0%{opacity:0}100%{opacity:1}}@media (prefers-reduced-motion: reduce){*{animation:none}}</style><rect width="4" height="4"/></svg>';

export function makeBuild({ scene = false, hero3d = false, mutate } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-assemble-'));
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  for (const f of ['hero.png', 'card.png', 'favicon-32.png', 'problem.png']) fs.writeFileSync(path.join(assets, f), PNG);
  fs.writeFileSync(path.join(assets, 'arch.svg'), SVG);
  if (scene) fs.writeFileSync(path.join(assets, 'hero-scene.svg'), SCENE);
  if (hero3d) fs.writeFileSync(path.join(assets, 'hero-3d.js'), 'export async function mount(host){ host.dataset.mounted = "1"; }\n');
  fs.writeFileSync(path.join(dir, 'primer.md'), '# primer\n');
  const ctx = {
    repo: { owner: 'o', name: 'r', slug: 'r', url: 'https://github.com/o/r' },
    concept: { palette: { accent: '#4be3c8' }, metaphor: 'm', tagline: 't' },
    kb: { primerPath: path.join(dir, 'primer.md') },
    visuals: {
      hero: { file: path.join(assets, 'hero.png'), altText: 'h' },
      sections: [{ id: 'problem', role: 'problem illustration', file: path.join(assets, 'problem.png'), alt: 'p' }],
      architectureDiagram: { svgPath: path.join(assets, 'arch.svg'), altText: 'arch' },
      ...(scene ? { heroAnim: { svgPath: path.join(assets, 'hero-scene.svg'), altText: 'scene' } } : {}),
      ...(hero3d ? { hero3d: { module: 'assets/hero-3d.js', altText: 'a room seen by wifi' } } : {}),
    },
    brand: { socialCard: { file: path.join(assets, 'card.png') }, favicon: { set: [path.join(assets, 'favicon-32.png')] } },
    content: {
      sections: {
        hero: { headline: 'H', lede: 'L' },
        problem: { title: 'P', lead: 'l', paragraphs: ['p'] },
        whatItIs: { title: 'W', lead: 'l', paragraphs: ['p'] },
        insight: { title: 'I', oh: 'oh', lead: 'l', paragraphs: ['p'] },
        howItWorks: { title: 'HW', paragraphs: ['p'] },
        useCases: { title: 'U', cases: [{ title: 'c', paragraphs: ['p'] }] },
        getStarted: { title: 'G', install: 'npm i', steps: [{ strong: 's', text: 't' }] },
        pack: { title: 'K', intro: 'i', downloadLabel: 'd' },
      },
    },
  };
  if (mutate) mutate(ctx, dir);
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(ctx, null, 2));
  return dir;
}

/** Runs the real assembler; returns { status, stdout, stderr, html } (html null when no page was written). */
export function assemble(dir) {
  const r = spawnSync(process.execPath, [ASSEMBLE, dir], { encoding: 'utf8' });
  const p = path.join(dir, 'site', 'index.html');
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, html: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null };
}

export const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });
