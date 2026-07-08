#!/usr/bin/env node
// clone-repo.mjs — Station 0–1 (VALIDATE + CLONE).
//
// Validate that the target repo URL is reachable, then clone it into <build-dir>/repo. Supports
// PUBLIC repos and PRIVATE / owner repos via a GitHub token supplied with the top-level
// `git -c http.extraheader=...` option — which is process-scoped and is NEVER written into the
// cloned repo's config (so no credentials are baked into the saved remote).
//
// Uniform tool convention (tools/CONTRACT.md §b): `node tools/clone-repo.mjs <build-dir>`.
//   reads  : <build-dir>/build.json -> repo.url   (+ GITHUB_TOKEN / GH_TOKEN from env for private)
//   writes : the `repo` slot (owner/name/slug/private/defaultBranch/clonePath/reachable) and the
//            top-level buildId (set first, here); the working tree at <build-dir>/repo/
//   stdout : exactly ONE JSON result object; all diagnostics go to stderr; exit 0 iff ok:true.
//
// PURE: reads only repo.url (its declared slice) + the env token; writes only the repo slot +
// buildId + its own working tree. FAIL LOUD: any failure exits non-zero with a clear reason and
// never writes a placeholder / partial clone past an error (tools/CONTRACT.md §b·6, INV-04).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ---------- uniform result protocol ----------
function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function fail(error) { console.error(`[clone-repo] FAIL: ${error}`); emit({ ok: false, outputs: {}, error }); process.exit(1); }
function done(outputs) { emit({ ok: true, outputs, error: null }); process.exit(0); }

// ---------- url parsing (https | scp-like git@host:owner/name) ----------
function parseRepoUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  const scp = s.match(/^git@([^:]+):(.+)$/);          // git@github.com:owner/name(.git)
  if (scp) s = `https://${scp[1]}/${scp[2]}`;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;     // bare github.com/owner/name
  s = s.replace(/\/+$/, '');
  let u;
  try { u = new URL(s); } catch { return null; }
  const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, '');
  if (!owner || !name) return null;
  return { host: u.host, owner, name, cloneUrl: `https://${u.host}/${owner}/${name}.git` };
}

// ---------- git helpers (token never logged) ----------
function runGit(args, { capture = true, timeout = 120000 } = {}) {
  try {
    const out = execFileSync('git', args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },   // never block on an interactive prompt
      // Run from a NEUTRAL directory: if this tool is invoked from inside a git checkout (e.g. the
      // CI runner's own actions/checkout tree, whose local config carries an AUTHORIZATION
      // extraheader), git would inherit that repo's config and stack a second auth header —
      // GitHub rejects it with `Duplicate header: "Authorization"` (hit live 2026-07-08). A
      // neutral cwd also keeps the unauthenticated probe honestly unauthenticated.
      cwd: os.tmpdir(),
      stdio: ['ignore', capture ? 'pipe' : 2, 'pipe'],     // non-captured stdout -> our stderr (fd 2)
      timeout, maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, stdout: capture && out ? out.toString() : '', stderr: '' };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, stdout: '', stderr: 'git executable not found on PATH' };
    return { ok: false, stdout: e.stdout ? e.stdout.toString() : '', stderr: e.stderr ? e.stderr.toString().trim() : (e.message || 'git failed'), code: e.status };
  }
}

function defaultBranchFromSymref(lsRemoteStdout) {
  const m = (lsRemoteStdout || '').match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
  return m ? m[1] : null;
}

function main() {
  const buildDir = process.argv[2];
  if (!buildDir) fail('usage: node tools/clone-repo.mjs <build-dir>  (missing build dir argument)');
  const buildDirAbs = path.resolve(buildDir);
  const buildJsonPath = path.join(buildDirAbs, 'build.json');
  if (!fs.existsSync(buildJsonPath)) fail(`build.json not found at ${buildJsonPath} — the brain must create the build dir + build.json (with repo.url) first`);

  let ctx;
  try { ctx = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8')); }
  catch (e) { fail(`build.json is not valid JSON: ${e.message}`); }

  const url = ctx?.repo?.url;
  if (!url) fail('build.json has no repo.url — clone-repo requires repo.url as its declared input');

  const parsed = parseRepoUrl(url);
  if (!parsed) fail(`could not parse owner/name from repo.url "${url}" (expected https://host/owner/name or git@host:owner/name)`);
  const { host, owner, name, cloneUrl } = parsed;

  // SOURCE-IDENTITY pin (INV-21): when the harness pins the submitted repo, build.json's repo.url
  // must BE that repo — an agent that edits repo.url to a lookalike dies here, before any network.
  // (Incident 2026-07-08: submitted mamd69/SONA-Trader, an agent swapped in Dar-41's repo.)
  const pinned = (process.env.EXPLAINER_SUBMITTED_REPO || '').trim().toLowerCase();
  if (pinned && `${owner}/${name}`.toLowerCase() !== pinned) {
    fail(`SOURCE-IDENTITY VIOLATION (INV-21): build.json repo.url is ${owner}/${name} but this build was submitted for ${pinned}. The submitted repo is the only permitted source — never substitute a similar-looking repo.`);
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const base = `https://${host}/`;
  const authArgs = token
    ? ['-c', `http.${base}.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`]
    : [];
  // Probe args neutralise any ambient credential helper so "public vs private" is an HONEST signal.
  const noAuthProbe = ['-c', 'credential.helper=', 'ls-remote', '--symref', cloneUrl, 'HEAD'];
  const authProbe = [...authArgs, '-c', 'credential.helper=', 'ls-remote', '--symref', cloneUrl, 'HEAD'];

  // ---- Station 0: reachability + public/private detection ----
  console.error(`[clone-repo] probing ${owner}/${name} on ${host} (unauthenticated)`);
  let isPrivate;
  let symref;
  const pub = runGit(noAuthProbe);
  if (pub.ok) {
    isPrivate = false;
    symref = pub.stdout;
  } else if (token) {
    console.error('[clone-repo] unauthenticated probe failed — retrying with token');
    const prv = runGit(authProbe);
    if (!prv.ok) fail(`repo not reachable even with a token: ${owner}/${name} — check the URL and that the token can access it (git: ${prv.stderr || `exit ${prv.code}`})`);
    isPrivate = true;
    symref = prv.stdout;
  } else {
    fail(`repo not reachable unauthenticated: ${owner}/${name} — if it is PRIVATE set GITHUB_TOKEN or GH_TOKEN; if PUBLIC check the URL (git: ${pub.stderr || `exit ${pub.code}`})`);
  }

  // ---- Station 1: clone into <build-dir>/repo (idempotent: replace any prior tree) ----
  const dest = path.join(buildDirAbs, 'repo');
  try { fs.rmSync(dest, { recursive: true, force: true }); }
  catch (e) { fail(`could not clear prior clone at ${dest}: ${e.message}`); }
  fs.mkdirSync(buildDirAbs, { recursive: true });

  // Top-level `git -c ...` (BEFORE the `clone` subcommand) applies the auth header to THIS process
  // only; it is NOT persisted into <dest>/.git/config, so the saved remote stays credential-free.
  const cloneArgs = [...authArgs, 'clone', '--depth', '1', '--no-tags', '--single-branch', cloneUrl, dest];
  console.error(`[clone-repo] cloning ${cloneUrl} -> ${dest} (private=${isPrivate})`);
  const cloned = runGit(cloneArgs, { capture: false, timeout: 600000 });
  if (!cloned.ok) fail(`git clone failed for ${owner}/${name}: ${cloned.stderr || `exit ${cloned.code}`}`);

  // Guard: never bake creds into the saved remote (defence-in-depth on the §1 invariant).
  try {
    const savedCfg = fs.readFileSync(path.join(dest, '.git', 'config'), 'utf8');
    if (/extraheader/i.test(savedCfg)) fail('refusing to finish: an http.extraheader leaked into the cloned repo config (credentials would be baked into the remote)');
  } catch { /* no .git/config readable — handled by the working-tree check below */ }

  if (!fs.existsSync(path.join(dest, '.git'))) fail(`clone produced no .git directory at ${dest}`);

  // defaultBranch: prefer the remote symref; fall back to the checked-out HEAD.
  let defaultBranch = defaultBranchFromSymref(symref);
  if (!defaultBranch) {
    const head = runGit(['-C', dest, 'rev-parse', '--abbrev-ref', 'HEAD']);
    defaultBranch = head.ok ? head.stdout.trim() : null;
  }
  if (!defaultBranch) fail('cloned successfully but could not determine the default branch');

  // ---- merge ONLY the repo slot (+ buildId, set first here) ----
  const repoSlot = {
    url,
    owner,
    name,
    slug: name,
    private: isPrivate,
    defaultBranch,
    clonePath: dest,
    reachable: true,
  };
  ctx.buildId = ctx.buildId || randomUUID();   // correlation + idempotency key; set first (clone-repo)
  ctx.repo = { ...(ctx.repo || {}), ...repoSlot };
  try { fs.writeFileSync(buildJsonPath, JSON.stringify(ctx, null, 2) + '\n'); }
  catch (e) { fail(`could not write build.json: ${e.message}`); }

  console.error(`[clone-repo] OK ${owner}/${name} (${defaultBranch}${isPrivate ? ', private' : ', public'}) -> ${dest}`);
  done({ slot: 'repo', buildId: ctx.buildId, repo: repoSlot, clonePath: dest });
}

main();
