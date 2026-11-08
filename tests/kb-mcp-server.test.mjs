// kb-mcp-server defaults `store` to the only configured store. A knowledge pack ships a single-store
// kb.config.mjs; before the fix the default was the registry's defaultTarget (a store the pack does not
// contain), so search_kb without `store` failed for every pack. Runs the real server over stdio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function packDir(configSrc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-mcp-'));
  const kb = path.join(root, 'kb');
  fs.mkdirSync(kb);
  for (const f of ['kb-mcp-server.mjs', 'ask-kb.mjs', 'resolve-deps.mjs']) fs.copyFileSync(path.join(ROOT, 'kb', f), path.join(kb, f));
  fs.writeFileSync(path.join(kb, 'kb.config.mjs'), configSrc);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'));
  return { root, kb };
}

function rpc(kb, messages) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [path.join(kb, 'kb-mcp-server.mjs')], { cwd: kb });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      try { resolve(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))); }
      catch (e) { reject(new Error(`bad server output: ${out}\n${err}`)); }
    });
    for (const m of messages) p.stdin.write(JSON.stringify(m) + '\n');
    p.stdin.end();
  });
}

const SOLE = `export const targets = { mypack: { slug: 'mypack', metaName: 'MyPack' } };
export const defaultTarget = 'agent-harness-generator';
export function getTarget(s) { return targets[s]; }\n`;

test('a single-store pack defaults to its own store, not the registry defaultTarget', async () => {
  const { root, kb } = packDir(SOLE);
  try {
    const res = await rpc(kb, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_kb', arguments: { query: 'anything' } } },
    ]);
    const byId = Object.fromEntries(res.map((r) => [r.id, r]));
    assert.equal(byId[1].result.serverInfo.name, 'mypack-kb');
    const search = byId[2].result.tools.find((t) => t.name === 'search_kb');
    assert.equal(search.inputSchema.properties.store.default, 'mypack');
    // no store argument: the call must reach the sole store (and fail only because the pack has no .rvf here)
    assert.equal(byId[3].error, undefined, JSON.stringify(byId[3].error));
    assert.match(byId[3].result.content[0].text, /rvf not found: .*mypack-kb\.rvf/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a multi-store registry still defaults to its defaultTarget', async () => {
  const { root, kb } = packDir(`export const targets = { a: { slug: 'a' }, b: { slug: 'b' } };
export const defaultTarget = 'b';
export function getTarget(s) { return targets[s]; }\n`);
  try {
    const res = await rpc(kb, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
    const search = res[0].result.tools.find((t) => t.name === 'search_kb');
    assert.equal(search.inputSchema.properties.store.default, 'b');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
