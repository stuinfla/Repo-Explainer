import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pyGraph } from '../kb/dep-graph.mjs';

function project(root, dir, name, deps, source = '') {
  const p = path.join(root, dir); fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'pyproject.toml'), `[project]\nname = "${name}"\ndependencies = [${deps.map((d) => `"${d}"`).join(', ')}]\n`);
  const pkg = path.join(p, name.replace(/-/g, '')); fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, '__init__.py'), source);
}

test('Python workspaces produce real components and dependency edges, not an empty graph', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-pygraph-'));
  project(root, 'protocol', 'shared-protocol', ['sqlalchemy']);
  project(root, 'server', 'server-app', ['shared-protocol', 'fastapi'], 'from sharedprotocol import model\n');
  project(root, 'client', 'offline-client', ['httpx'], 'import sharedprotocol.sync\n');
  const g = pyGraph(root, new Set(), ['protocol', 'server', 'client']);
  assert.equal(g.ecosystem, 'python');
  assert.deepEqual(new Set(g.nodes.map((n) => n.name)), new Set(['shared-protocol', 'server-app', 'offline-client']));
  assert.deepEqual(new Set(g.internalEdges.map((e) => `${e.from}->${e.to}`)), new Set(['server-app->shared-protocol', 'offline-client->shared-protocol']));
  assert.ok(g.externalDepNames.includes('fastapi'));
  fs.rmSync(root, { recursive: true, force: true });
});
