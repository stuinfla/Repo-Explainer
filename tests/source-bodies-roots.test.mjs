// sourceBodies must honour EXPLICIT roots, not only a /src/ path convention: a Next.js app keeps its code
// in app/, lib/ and components/, and ingesting zero source silently is a KB with no grounding (INV-06).
// Naming a root IS the scope decision; /src/ is only the fallback. Tests/minified stay out either way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceBodies } from '../kb/corpus-rules.mjs';

// Minimal stand-in for the chunker's ctx: walks a dir tree and records what the rule ingests.
function makeCtx(repoDir) {
  const docs = [];
  const fullBody = new Set();
  const walk = function* (dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else yield p;
    }
  };
  return {
    repoDir,
    walk,
    rel: (p) => path.relative(repoDir, p),
    isFullBody: (p) => fullBody.has(p),
    markFullBody: (p) => fullBody.add(p),
    addDoc: (rel) => docs.push(rel),
    docs,
  };
}

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-srcroots-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

test('explicit roots ingest source even with no src/ dir (Next.js app-router shape)', () => {
  const dir = fixture({
    'app/page.tsx': 'export default function Page() { return null; }',
    'lib/mcp-server.ts': 'export const server = 1;',
    'components/ui/button.tsx': 'export const Button = () => null;',
  });
  try {
    const ctx = makeCtx(dir);
    const n = sourceBodies(ctx, { roots: ['app', 'lib', 'components'], ext: ['.ts', '.tsx'] });
    assert.equal(n, 3, 'every source file under the named roots must be ingested');
    assert.deepEqual(ctx.docs.sort(), ['app/page.tsx', 'components/ui/button.tsx', 'lib/mcp-server.ts']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('explicit roots still exclude tests and minified bundles', () => {
  const dir = fixture({
    'app/page.tsx': 'export default function Page() { return null; }',
    'app/__tests__/page.test.tsx': 'test("x", () => {});',
    'lib/vendor.min.js': 'var a=1;',
  });
  try {
    const ctx = makeCtx(dir);
    sourceBodies(ctx, { roots: ['app', 'lib'], ext: ['.ts', '.tsx', '.js'] });
    assert.deepEqual(ctx.docs, ['app/page.tsx'], 'tests and minified output stay out');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('with NO roots given, the /src/ convention still decides (unchanged fallback)', () => {
  const dir = fixture({
    'src/index.ts': 'export const a = 1;',
    'random/thing.ts': 'export const b = 2;',
  });
  try {
    const ctx = makeCtx(dir);
    sourceBodies(ctx, { roots: ['.'], ext: ['.ts'] });
    assert.deepEqual(ctx.docs, ['src/index.ts'], 'a bare "." root must not turn the whole repo into source');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
