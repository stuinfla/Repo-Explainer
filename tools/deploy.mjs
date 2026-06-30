#!/usr/bin/env node
// deploy.mjs — Station 8 tool #10: deploy the already-passed page to its own per-build URL.
//
// CONTRACT (tools/CONTRACT.md): node tools/deploy.mjs <build-dir>
//   Reads (declared inputs):  page.dir, repo.slug   (+ deploy-provider token from env)
//   Writes (own slot only):   publish.liveUrl, publish.http200
//   stdout = ONE JSON result object; diagnostics → stderr; exit 0 iff ok:true, else non-zero.
//
// Provider-agnostic adapter, DEFAULT NETLIFY (clean {slug}-explainer.netlify.app subdomain, zero
// DNS work). Vercel is a one-line swap-in via the ADAPTERS map (DEPLOY_PROVIDER=vercel). The deploy
// is a direct, atomic, immutable per-build upload — the owner can later git-connect the published
// repo for auto-redeploy; that is a post-publish owner action, not this station's job.
//
// FAIL LOUD: a missing token, a failed deploy, or a liveUrl that does not return 200 unauthenticated
// is a non-zero exit with a clear message — never a placeholder URL, never a silent green.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sanitize = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

// ---- BuildContext I/O (only the declared slice in, only the owned slot out) ----
function readContext(buildDir) {
  const p = path.join(buildDir, 'build.json');
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch { throw new Error(`build.json not found at ${p} (run earlier stations first)`); }
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`build.json is not valid JSON: ${e.message}`); }
}
function mergeSlot(buildDir, slot, partial) {
  const p = path.join(buildDir, 'build.json');
  const obj = JSON.parse(fs.readFileSync(p, 'utf8'));   // re-read fresh, merge ONLY this slot's keys
  obj[slot] = { ...(obj[slot] || {}), ...partial };
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

// ---- shared helpers ----
async function api(url, opts, label) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} failed: HTTP ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
function zipDir(dir, zipPath) {
  try {
    fs.rmSync(zipPath, { force: true });
    execFileSync('zip', ['-r', '-X', zipPath, '.'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (e) {
    throw new Error(`zip of site dir failed (is the system 'zip' installed?): ${e.message}`);
  }
}
function collectFiles(dir) {
  const out = [];
  const walk = (d, base) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(d, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, rel);
      else if (e.isFile()) out.push({ rel, abs });
    }
  };
  walk(dir, '');
  return out;
}
async function verify200(url, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { redirect: 'follow' }); if (r.status === 200) return true; }
    catch { /* propagation lag — retry */ }
    await sleep(3000);
  }
  return false;
}

// ---- adapter: Netlify (DEFAULT) ----
async function deployNetlify({ pageDir, slug }) {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) throw new Error('NETLIFY_AUTH_TOKEN not set in environment (deploy-provider token required)');
  const auth = { Authorization: `Bearer ${token}` };
  const name = `${sanitize(slug)}-explainer`;

  const sites = await api(`https://api.netlify.com/api/v1/sites?name=${encodeURIComponent(name)}&filter=all`,
    { headers: auth }, 'netlify list sites');
  let site = (Array.isArray(sites) ? sites : []).find((s) => s.name === name) || null;
  if (!site) {
    site = await api('https://api.netlify.com/api/v1/sites',
      { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
      'netlify create site');
  }
  console.error(`[deploy] netlify site '${name}' (id ${site.id})`);

  const zipPath = path.join(os.tmpdir(), `deploy-${name}-${Date.now()}.zip`);
  zipDir(pageDir, zipPath);
  const zipBuf = fs.readFileSync(zipPath);
  const deploy = await api(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`,
    { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: zipBuf },
    'netlify deploy');
  fs.rmSync(zipPath, { force: true });

  for (let i = 0; i < 80; i++) {
    const d = await api(`https://api.netlify.com/api/v1/sites/${site.id}/deploys/${deploy.id}`,
      { headers: auth }, 'netlify deploy status');
    if (d.state === 'ready') { console.error('[deploy] netlify deploy ready'); break; }
    if (d.state === 'error') throw new Error(`netlify deploy errored: ${d.error_message || 'unknown'}`);
    if (i === 79) throw new Error('netlify deploy did not reach state=ready within timeout');
    await sleep(3000);
  }
  return { liveUrl: site.ssl_url || `https://${name}.netlify.app`, provider: 'netlify' };
}

// ---- adapter: Vercel (swappable — DEPLOY_PROVIDER=vercel) ----
async function deployVercel({ pageDir, slug }) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN not set in environment (deploy-provider token required)');
  const auth = { Authorization: `Bearer ${token}` };
  const name = `${sanitize(slug)}-explainer`;
  const teamQ = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : '';

  const files = collectFiles(pageDir).map(({ rel, abs }) => ({ file: rel, data: fs.readFileSync(abs).toString('base64'), encoding: 'base64' }));
  if (!files.length) throw new Error(`no files to deploy under ${pageDir}`);
  const dep = await api(`https://api.vercel.com/v13/deployments${teamQ}`,
    { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, files, target: 'production', projectSettings: { framework: null } }) },
    'vercel deploy');
  const depId = dep.id || dep.uid;
  let ready = dep;
  for (let i = 0; i < 80; i++) {
    const state = ready.readyState || ready.status;
    if (state === 'READY') break;
    if (state === 'ERROR' || state === 'CANCELED') throw new Error(`vercel deploy ${String(state).toLowerCase()}`);
    if (i === 79) throw new Error('vercel deploy did not reach READY within timeout');
    await sleep(3000);
    ready = await api(`https://api.vercel.com/v13/deployments/${depId}${teamQ}`, { headers: auth }, 'vercel deploy status');
  }
  const host = ready.url || dep.url;
  if (!host) throw new Error('vercel deploy returned no url');
  return { liveUrl: `https://${host}`, provider: 'vercel' };
}

// ---- adapter: Vercel via the logged-in CLI (DEPLOY_PROVIDER=vercel-cli) ----
// No token needed when `vercel login` has run. Deploys the static page dir to production and aliases it
// to a clean {slug}-explainer.vercel.app host. This is what makes autonomous shipping work when only an
// interactive CLI session is available (no NETLIFY_AUTH_TOKEN / VERCEL_TOKEN in the environment).
async function deployVercelCli({ pageDir, slug }) {
  const name = `${sanitize(slug)}-explainer`;
  // CRITICAL ISOLATION: deploy from a temp dir NAMED after the dedicated project, with no inherited
  // `.vercel` link. Vercel infers the project from the cwd directory name, so deploying straight from a
  // build dir literally named "site" auto-links to a pre-existing shared "site" project and OVERWRITES
  // its production — which clobbered an unrelated live site (warrior-nation, 2026-06-30). Staging under
  // `${slug}-explainer/` guarantees a UNIQUE dedicated project per repo and never touches anything else.
  const stage = path.join(os.tmpdir(), 'explainmyrepo-deploy', name);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.cpSync(pageDir, stage, { recursive: true });
  fs.rmSync(path.join(stage, '.vercel'), { recursive: true, force: true });
  let out;
  try {
    out = execFileSync('vercel', ['deploy', '--prod', '--yes'], { cwd: stage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const msg = String(e.stderr || e.stdout || e.message || '');
    if (/not authenticated|log ?in|credentials|no existing credentials/i.test(msg)) {
      throw new Error('vercel CLI is not logged in — run `vercel login`, or set DEPLOY_PROVIDER=vercel with VERCEL_TOKEN');
    }
    throw new Error(`vercel CLI deploy failed: ${msg.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 220)}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  const url = (out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/i) || [])[0];
  if (!url) throw new Error('vercel CLI deploy returned no URL');
  let liveUrl = url;
  try { execFileSync('vercel', ['alias', 'set', url, `${name}.vercel.app`], { stdio: ['ignore', 'ignore', 'ignore'] }); liveUrl = `https://${name}.vercel.app`; }
  catch { /* alias is best-effort (subdomain may be taken by another team) — keep the deployment URL */ }
  return { liveUrl, provider: 'vercel-cli' };
}

const ADAPTERS = { netlify: deployNetlify, vercel: deployVercel, 'vercel-cli': deployVercelCli };

// Pick the provider that can actually authenticate right now, unless DEPLOY_PROVIDER forces one:
// a VALID Netlify token → Vercel token → logged-in Vercel CLI. A stale Netlify token (present but
// expired) must not shadow a working CLI, so we verify it instead of trusting its presence.
async function resolveProvider() {
  if (process.env.DEPLOY_PROVIDER) return process.env.DEPLOY_PROVIDER.toLowerCase();
  if (process.env.NETLIFY_AUTH_TOKEN) {
    try {
      const r = await fetch('https://api.netlify.com/api/v1/user', { headers: { Authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}` } });
      if (r.ok) return 'netlify';
      console.error(`[deploy] NETLIFY_AUTH_TOKEN present but not valid (HTTP ${r.status}) — falling back`);
    } catch { /* network issue — fall through to the next option */ }
  }
  if (process.env.VERCEL_TOKEN) return 'vercel';
  try { execFileSync('vercel', ['whoami'], { stdio: ['ignore', 'ignore', 'ignore'] }); return 'vercel-cli'; }
  catch { return 'netlify'; /* nothing usable — fail loud later with the netlify-token message */ }
}

async function main() {
  if (typeof fetch !== 'function') throw new Error('global fetch unavailable — Node 18+ required');
  const buildDir = process.argv[2];
  if (!buildDir) throw new Error('usage: node tools/deploy.mjs <build-dir>');

  const bc = readContext(buildDir);
  const slug = bc.repo?.slug;
  const pageDir = path.resolve(bc.page?.dir || '');
  if (!slug) throw new Error('repo.slug missing in build.json (run clone-repo first)');
  if (!bc.page?.dir) throw new Error('page.dir missing in build.json (run assemble-page first)');
  if (!fs.existsSync(path.join(pageDir, 'index.html'))) throw new Error(`page.dir has no index.html: ${pageDir}`);

  const provider = await resolveProvider();
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`unknown DEPLOY_PROVIDER '${provider}' (supported: ${Object.keys(ADAPTERS).join(', ')})`);

  const { liveUrl } = await adapter({ pageDir, slug });
  console.error(`[deploy] ${provider} → ${liveUrl} (verifying 200 unauthenticated)`);
  const http200 = await verify200(liveUrl);
  if (!http200) throw new Error(`deployed to ${liveUrl} but it did not return 200 unauthenticated within timeout`);

  mergeSlot(buildDir, 'publish', { liveUrl, http200: true });
  return { liveUrl, http200: true, provider, slot: 'publish' };
}

main()
  .then((outputs) => { process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n'); process.exit(0); })
  .catch((e) => { process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error: e.message || String(e) }) + '\n'); process.exit(1); });
