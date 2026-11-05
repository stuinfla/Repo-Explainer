// tests/make-pack.test.mjs — the knowledge-pack station, run as the orchestrator runs it (child process,
// one JSON line on stdout), against a fixture store. Every assertion bounds a value the old tool got wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { singleStoreConfigSource, localImportClosure } from '../tools/make-pack.mjs';
import { targets } from '../kb/kb.config.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = Object.keys(targets)[0];                       // any slug the engine registry knows
const SHA = '0123456789abcdef0123456789abcdef01234567';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pack-test-'));

function fixture({ passages = 3, sha = SHA, slug = SLUG, extraSlots = {}, rvf = 'RVFBYTES', structured = ['symbols', 'dep-graph', 'entrypoints'] } = {}) {
  const dir = tmp(); const store = path.join(dir, 'store'); fs.mkdirSync(store);
  const w = (f, c) => fs.writeFileSync(path.join(store, `${slug}-${f}`), c);
  w('kb.rvf', rvf); w('kb.rvf.idmap.json', '{}'); w('kb.rvf.embed.json', '{"model":"m"}'); w('kb.ids.json', '{}');
  w('kb.passages.jsonl', Array.from({ length: passages }, (_, i) => JSON.stringify({ id: String(i), text: `t${i}`, path: `f${i}.md` })).join('\n'));
  for (const k of structured) w(`${k}.json`, '{}');
  w('primer.md', '# primer');
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    repo: { slug, url: `https://github.com/o/${slug}`, ...(sha ? { sha } : {}) },
    kb: { storeDir: store, embedModel: 'Xenova/bge-small-en-v1.5' }, quality: { passed: true }, ...extraSlots,
  }));
  return dir;
}
const run = (dir) => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'make-pack.mjs'), dir], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `stdout must be exactly one JSON line, got: ${r.stdout}`);
  return { status: r.status, out: JSON.parse(lines[0]), stderr: r.stderr };
};
const unzipTo = (zip) => { const d = tmp(); execFileSync('unzip', ['-q', zip, '-d', d]); return d; };

test('pack: ships a single-store config — no registry copy, no build-machine path', () => {
  const dir = fixture(); const r = run(dir); assert.equal(r.status, 0, r.stderr);
  const x = unzipTo(r.out.outputs.zipPath);
  const cfg = fs.readFileSync(path.join(x, 'for-ai', 'kb.config.mjs'), 'utf8');
  assert.ok(cfg.length < 20000, `config must be one store, not the registry (${cfg.length} bytes)`);
  assert.doesNotMatch(cfg, /repoDir|\/Users\//);
  const shipped = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(path.join(x, 'for-ai', 'kb.config.mjs'))}); console.log(JSON.stringify({ keys: Object.keys(m.targets), def: m.defaultTarget }));`], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(shipped), { keys: [SLUG], def: SLUG });
});

test('pack: manifest carries the real clone sha and no invented gate or version', () => {
  const dir = fixture(); const r = run(dir); assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(unzipTo(r.out.outputs.zipPath), 'manifest.json'), 'utf8'));
  assert.equal(m.source.sha, SHA);
  assert.equal(m.source.url, `https://github.com/o/${SLUG}`);
  assert.equal(m.passageCount, 3);
  assert.ok(!('gateA' in m) && !('version' in m), `invented fields are back: ${Object.keys(m)}`);
  assert.ok(Math.abs(Date.now() - Date.parse(m.builtAt)) < 120000, `builtAt is not now: ${m.builtAt}`);
});

test('pack: a build with no recorded sha ships null, never a made-up one', () => {
  const r = run(fixture({ sha: null })); assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(unzipTo(r.out.outputs.zipPath), 'manifest.json'), 'utf8'));
  assert.equal(m.source.sha, null);
});

test('pack: an older build without repo.sha takes the clone HEAD', () => {
  const clone = tmp(); const g = (...a) => execFileSync('git', ['-C', clone, ...a], { encoding: 'utf8' });
  g('init', '-q'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
  const dir = fixture({ sha: null });
  const bj = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')); bj.repo.clonePath = clone;
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(bj));
  const r = run(dir); assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(unzipTo(r.out.outputs.zipPath), 'manifest.json'), 'utf8'));
  assert.equal(m.source.sha, g('rev-parse', 'HEAD').trim());
  assert.match(m.source.sha, /^[0-9a-f]{40}$/);
});

test('pack: the README promises no NotebookLM media; the pack slot is just the zip path; other slots survive', () => {
  const dir = fixture({ extraSlots: { notify: { emailSent: true } } }); const r = run(dir); assert.equal(r.status, 0, r.stderr);
  const readme = fs.readFileSync(path.join(unzipTo(r.out.outputs.zipPath), 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /NotebookLM|for-humans\/studio|studio-less|follow up later/i);
  const bj = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
  assert.deepEqual(Object.keys(bj.pack), ['zipPath']);
  assert.equal(bj.pack.zipPath, path.join(dir, 'site', `${SLUG}-knowledge-pack.zip`));
  assert.deepEqual(bj.notify, { emailSent: true });
});

test('pack: every ./import of a shipped engine file is in the zip, and deps come from the root package.json', () => {
  const r = run(fixture()); assert.equal(r.status, 0, r.stderr);
  const x = unzipTo(r.out.outputs.zipPath); const forAi = path.join(x, 'for-ai');
  for (const f of fs.readdirSync(forAi).filter((n) => n.endsWith('.mjs'))) {
    for (const m of fs.readFileSync(path.join(forAi, f), 'utf8').matchAll(/from\s*['"]\.\/([\w.-]+)['"]/g)) assert.ok(fs.existsSync(path.join(forAi, m[1])), `${f} imports ./${m[1]} which is not in the pack`);
  }
  const root = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).dependencies;
  const pkg = JSON.parse(fs.readFileSync(path.join(forAi, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies, { '@ruvector/rvf': root['@ruvector/rvf'], '@xenova/transformers': root['@xenova/transformers'] });
});

test('pack: refuses an empty KB and an unregistered store, loudly', () => {
  const empty = run(fixture({ passages: 0 })); assert.equal(empty.status, 1); assert.match(empty.out.error, /empty pack/);
  const unknown = run(fixture({ slug: 'not-a-registered-store' })); assert.equal(unknown.status, 1); assert.match(unknown.out.error, /no target "not-a-registered-store"/);
});

test('singleStoreConfigSource: drops repoDir, keeps everything else, rejects other slugs', async () => {
  const dir = tmp(); const f = path.join(dir, 'kb.config.mjs');
  fs.writeFileSync(f, singleStoreConfigSource('demo', { slug: 'demo', repoDir: '/Users/someone/secret/repo', metaName: 'Demo', componentRoots: ['packages'] }));
  const m = await import(`${f}?t=${Date.now()}`);
  assert.deepEqual(m.targets.demo, { slug: 'demo', metaName: 'Demo', componentRoots: ['packages'] });
  assert.equal(m.defaultTarget, 'demo');
  assert.throws(() => m.getTarget('other'), /holds only "demo"/);
});

test('localImportClosure: follows imports transitively, once each, and fails on a missing file', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'a.mjs'), "import { b } from './b.mjs';\nconst x = await import('./d.mjs');");
  fs.writeFileSync(path.join(d, 'b.mjs'), "import { c } from './c.mjs';");
  fs.writeFileSync(path.join(d, 'c.mjs'), "import fs from 'node:fs'; import { a } from './a.mjs';");
  fs.writeFileSync(path.join(d, 'd.mjs'), '// leaf');
  assert.deepEqual(localImportClosure(d, ['a.mjs']).sort(), ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs']);
  fs.writeFileSync(path.join(d, 'e.mjs'), "import './nope.mjs'; import x from './nope.mjs';");
  assert.throws(() => localImportClosure(d, ['e.mjs']), /missing required input/);
});

test('pack: refuses a zero-byte vector file (an empty rvf is not a knowledge base)', () => {
  const r = run(fixture({ rvf: '' }));
  assert.equal(r.status, 1);
  assert.match(r.out.error, /empty pack: .*kb\.rvf is zero bytes/);
});

test('pack: the shipped README lists exactly the structured indexes that are in the zip (manifest.structured is the truth)', () => {
  const r = run(fixture({ structured: ['symbols'] })); assert.equal(r.status, 0, r.stderr);
  const x = unzipTo(r.out.outputs.zipPath);
  const readme = fs.readFileSync(path.join(x, 'README.md'), 'utf8');
  const m = JSON.parse(fs.readFileSync(path.join(x, 'manifest.json'), 'utf8'));
  assert.deepEqual(m.structured, { symbols: `${SLUG}-symbols.json`, depGraph: null, entrypoints: null });
  assert.match(readme, new RegExp(`${SLUG}-symbols\\.json\\s+— exact public API`));
  assert.doesNotMatch(readme, /dep-graph\.json|entrypoints\.json/);
  assert.doesNotMatch(readme, /384-dim bge/, 'the model name comes only from the embedder line (sidecar), never hard-coded in the file list');
  assert.ok(fs.existsSync(path.join(x, 'for-ai', `${SLUG}-symbols.json`)));
  assert.ok(!fs.existsSync(path.join(x, 'for-ai', `${SLUG}-dep-graph.json`)));
});

test('pack: a zip that lacks a required entry is fatal, even though zip itself exited 0', () => {
  // A `zip` shim that behaves, then drops ask-kb.mjs from the archive it just wrote.
  const realZip = execFileSync('which', ['zip']).toString().trim();
  const shimDir = tmp();
  fs.writeFileSync(path.join(shimDir, 'zip'), `#!/bin/sh\n"${realZip}" "$@" || exit $?\n"${realZip}" -q -d "$3" 'for-ai/ask-kb.mjs' >&2\nexit 0\n`, { mode: 0o755 });
  const dir = fixture();
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'make-pack.mjs'), dir], { encoding: 'utf8', env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` } });
  assert.equal(r.status, 1, r.stdout);
  assert.match(JSON.parse(r.stdout.trim()).error, /pack is missing required entries after zip: for-ai\/ask-kb\.mjs/);
});

test('pack: a store registered only in the build overlay (what kb:register writes) is packed — the tracked config is not needed', () => {
  const slug = 'overlay-only-store';
  const dir = fixture({ slug });
  fs.writeFileSync(path.join(dir, 'kb-targets.overlay.json'), JSON.stringify({ [slug]: JSON.parse(JSON.stringify(targets[SLUG])) }));
  const r = run(dir); assert.equal(r.status, 0, r.stderr);
  const x = unzipTo(r.out.outputs.zipPath);
  const shipped = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(path.join(x, 'for-ai', 'kb.config.mjs'))}); console.log(JSON.stringify(Object.keys(m.targets)));`], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(shipped), [slug]);
});
