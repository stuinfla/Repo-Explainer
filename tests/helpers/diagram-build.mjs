// Shared build-dir fixtures for the make-diagrams tests: a kb dep-graph + entrypoints (+ optional cloned repo), run through the real tool.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = path.join(REPO, 'tools', 'make-diagrams.mjs');

const APP_ENTRYPOINTS = {
  install: ['npm i'], commands: [{ category: 'build', cmd: 'npm run build' }, { category: 'test', cmd: 'npm test' }],
  binaries: [{ name: 'fixrepo' }], quickstart: ['npx fixrepo'], workspace: { kind: 'single' },
};

/**
 * Write a build dir. `edges` is [[from,to],...] over `nodes` (names). `entrypoints: false` = a library with none.
 * `clone` is { 'path/in/repo': 'file text' } written under <dir>/clone and wired into build.json repo.clonePath.
 */
export function makeBuild({ nodes = ['app', 'core', 'util'], edges = [['app', 'core'], ['core', 'util']], entrypoints = true,
  visuals = {}, clone = null, repoName = 'fixrepo' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-dg-'));
  const kb = path.join(dir, 'kb');
  fs.mkdirSync(kb, { recursive: true });
  fs.writeFileSync(path.join(kb, 'dep-graph.json'), JSON.stringify({
    nodes: nodes.map((name) => ({ name })), internalEdges: edges.map(([from, to]) => ({ from, to })),
    componentCount: nodes.length, internalEdgeCount: edges.length, ecosystems: ['node'],
    externalDepNames: ['left-pad'], externalDepCount: 1,
  }));
  fs.writeFileSync(path.join(kb, 'entrypoints.json'), JSON.stringify(entrypoints ? APP_ENTRYPOINTS : {}));
  const bj = {
    understanding: { repoName },
    kb: { depGraphPath: path.join(kb, 'dep-graph.json'), entrypointsPath: path.join(kb, 'entrypoints.json') },
    visuals,
  };
  if (clone) {
    const root = path.join(dir, 'clone');
    for (const [file, text] of Object.entries(clone)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
    bj.repo = { name: repoName, clonePath: root };
  }
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(bj, null, 2));
  return dir;
}

/** Run the real tool; returns { status, stdout, stderr } (stderr is kept on success too). */
export function runTool(dir, tool = TOOL) {
  const r = spawnSync(process.execPath, [tool, dir], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}

export const visualsOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).visuals;
export const svgOf = (dir, file) => fs.readFileSync(path.join(dir, 'assets', file), 'utf8');
export const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// A chain of authored concept rows for the two judgment slots (so every fixture draws all four diagrams).
export const chain = (items) => ({ rows: [{ items, connect: true }] });
export const CONCEPT_SLOTS = { bigIdeaDiagram: chain(['front matter', 'document body', 'colophon']), insightDiagram: chain(['granted', 'dispatch', 'quarantine']) };
