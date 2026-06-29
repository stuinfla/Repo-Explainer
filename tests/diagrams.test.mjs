// Conformance test — INV-15 (StructuralDiagramsAsSVG) + INV-18 (ArchitectureAndFlowRequired).
//
// THE keystone test. It encodes the exact failure the owner caught: make-diagrams emitted raw
// ASCII rendered as SVG <text> inside one background <rect>, NOT a real vector diagram with node
// boxes and connectors. A real diagram (post-fix, via the ascii-to-svg skill) draws node boxes
// (multiple <rect>) and/or connectors (<path>/<line>/<polyline>). This test FAILS RED against the
// current tool and turns GREEN only when make-diagrams produces genuine vectors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'make-diagrams.mjs');

// Self-contained fixture: a minimal-but-real kb extraction (3 components, 2 internal deps) +
// brain-authored ASCII for the two judgment diagrams, so make-diagrams has everything it needs.
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-diag-'));
  const kb = path.join(dir, 'kb');
  fs.mkdirSync(kb, { recursive: true });
  fs.writeFileSync(path.join(kb, 'dep-graph.json'), JSON.stringify({
    nodes: [{ name: 'app' }, { name: 'core' }, { name: 'util' }],
    internalEdges: [{ from: 'app', to: 'core' }, { from: 'core', to: 'util' }],
    componentCount: 3, internalEdgeCount: 2, ecosystems: ['node'],
    externalDepNames: ['left-pad'], externalDepCount: 1,
  }));
  fs.writeFileSync(path.join(kb, 'entrypoints.json'), JSON.stringify({
    install: ['npm i'],
    commands: [{ category: 'build', cmd: 'npm run build' }, { category: 'test', cmd: 'npm test' }],
    binaries: [{ name: 'fixrepo' }], quickstart: ['npx fixrepo'], workspace: { kind: 'single' },
  }));
  fs.writeFileSync(path.join(kb, 'symbols.json'), JSON.stringify({ count: 10, byCrate: { core: 5 } }));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    understanding: { repoName: 'fixrepo' },
    kb: {
      depGraphPath: path.join(kb, 'dep-graph.json'),
      entrypointsPath: path.join(kb, 'entrypoints.json'),
      symbolsPath: path.join(kb, 'symbols.json'),
    },
    visuals: {
      bigIdeaDiagram: { ascii: 'Big Idea\n[A] -> [B] -> [C]' },
      insightDiagram: { ascii: 'The Insight\nthe one clever move' },
    },
  }, null, 2));
  return dir;
}

function runMakeDiagrams(dir) {
  return execFileSync(process.execPath, [TOOL, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
}

test('INV-18 — make-diagrams renders the ARCHITECTURE diagram as REAL vectors (node boxes + connectors), not raw ASCII as <text>', () => {
  const dir = makeFixture();
  runMakeDiagrams(dir);
  const svg = fs.readFileSync(path.join(dir, 'assets', 'architecture.svg'), 'utf8');

  const rects = (svg.match(/<rect\b/g) || []).length;
  const connectors = (svg.match(/<(path|line|polyline|polygon)\b/g) || []).length;
  const texts = (svg.match(/<text\b/g) || []).length;

  // ASCII-as-text == exactly ONE <rect> (the background card) + many <text> + ZERO connectors.
  // A real architecture diagram draws a box per component and a line/arrow per dependency.
  assert.ok(
    rects >= 2 || connectors >= 1,
    `architecture.svg is ASCII-as-text, not a real diagram: ${rects} <rect>, ${connectors} connectors, ${texts} <text>. ` +
    'A real diagram needs node boxes (>=2 <rect>) or connectors (<path>/<line>). This is exactly the failure the owner caught.',
  );
});

test('INV-18 — make-diagrams renders the PROCESS/DATA-FLOW diagram as REAL vectors (steps + arrows), not raw ASCII as <text>', () => {
  const dir = makeFixture();
  runMakeDiagrams(dir);
  const svg = fs.readFileSync(path.join(dir, 'assets', 'flow.svg'), 'utf8');

  const rects = (svg.match(/<rect\b/g) || []).length;
  const connectors = (svg.match(/<(path|line|polyline|polygon)\b/g) || []).length;
  const texts = (svg.match(/<text\b/g) || []).length;

  assert.ok(
    rects >= 2 || connectors >= 1,
    `flow.svg is ASCII-as-text, not a real diagram: ${rects} <rect>, ${connectors} connectors, ${texts} <text>. ` +
    'A real flow diagram needs step boxes (>=2 <rect>) or arrows (<path>/<line>).',
  );
});
