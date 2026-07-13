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

// ---- Vercel adapters DELETED 2026-06-30 (at the owner's instruction) ----
// A Vercel auto-fallback once deployed a demo into a shared personal-Vercel "site" project and overwrote
// an unrelated LIVE site (warrior-nation). ALL Vercel deploy code (REST adapter + CLI adapter) was removed.
// Deploys go to NETLIFY ONLY — each explainer to its OWN {slug}-explainer.netlify.app site. Do NOT
// reintroduce Vercel or any silent provider fallback; if another provider is ever truly needed, add a
// new, ISOLATED, opt-in adapter deliberately and review it for the shared-target failure mode.
const ADAPTERS = { netlify: deployNetlify };

// Netlify is the ONLY target. If its token is missing or invalid we FAIL LOUD with exactly how to refresh
// it — never a guess, never a different provider, never another account.
async function resolveProvider() {
  if (!process.env.NETLIFY_AUTH_TOKEN) {
    throw new Error('NETLIFY_AUTH_TOKEN is not set. Create a Netlify personal access token at https://app.netlify.com/user/applications#personal-access-tokens and put NETLIFY_AUTH_TOKEN=… in .env, then retry. Deploys go to Netlify only.');
  }
  const r = await fetch('https://api.netlify.com/api/v1/user', { headers: { Authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}` } }).catch(() => null);
  if (!r || !r.ok) throw new Error(`NETLIFY_AUTH_TOKEN is set but not valid (HTTP ${r ? r.status : 'network error'}). Refresh it at https://app.netlify.com/user/applications#personal-access-tokens and update NETLIFY_AUTH_TOKEN in .env. Deploys go to Netlify only — no fallback.`);
  return 'netlify';
}

async function main() {
  if (typeof fetch !== 'function') throw new Error('global fetch unavailable — Node 18+ required');
  const buildDir = process.argv[2];
  if (!buildDir) throw new Error('usage: node tools/deploy.mjs <build-dir>');

  const bc = readContext(buildDir);

  // SOURCE-IDENTITY pin (INV-21) — deploy is the outward-facing boundary: the page being published
  // must be built from the repo the human actually submitted, never a mid-build substitute
  // (incident 2026-07-08: an agent, unable to clone a private repo, deployed a lookalike's page).
  const pinned = (process.env.EXPLAINER_SUBMITTED_REPO || '').trim().toLowerCase();
  if (pinned) {
    const m = String(bc.repo?.url || '').trim().replace(/\/+$/, '').match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
    const actual = m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
    if (actual !== pinned) throw new Error(`SOURCE-IDENTITY VIOLATION (INV-21): refusing to deploy — build.json repo.url (${bc.repo?.url || 'missing'}) is not the submitted repo (${pinned}).`);
  }

  const slug = bc.repo?.slug;
  const pageDir = path.resolve(bc.page?.dir || '');
  if (!slug) throw new Error('repo.slug missing in build.json (run clone-repo first)');
  if (!bc.page?.dir) throw new Error('page.dir missing in build.json (run assemble-page first)');
  if (!fs.existsSync(path.join(pageDir, 'index.html'))) throw new Error(`page.dir has no index.html: ${pageDir}`);

  // SHIP-BAR RAIL (2026-07-13) — deploy is where the gate's verdict becomes ENFORCED, not advisory.
  // Incident, same day: an agent at its refine cap deployed a page the gate had FAILED (B5=58,
  // passed=false) and the runner reported SUCCESS; a human had to roll it back within minutes. The
  // ship decision is deterministic and lives HERE, at the boundary, like the INV-21 pin above:
  //   exemplar bar: quality.passed === true, OR
  //   ship-best-effort bar (the brief's floor): mean >= 82 AND min axis >= 70 on EVERY graded
  //   device AND all operator questions true.
  // No quality slot at all → refuse (an ungraded page is not deployable). Manual redeploys of a
  // previously-passing build sail through on their recorded verdict; DEPLOY_FORCE=1 is the explicit,
  // logged override for emergency ops.
  if (process.env.DEPLOY_FORCE === '1') {
    console.error('[deploy] DEPLOY_FORCE=1 — ship-bar rail bypassed EXPLICITLY (emergency override)');
  } else {
    const q = bc.quality;
    if (!q || !Array.isArray(q.scorecard) || q.scorecard.length === 0) {
      throw new Error('SHIP BAR: refusing to deploy — build.json has no quality scorecard (run quality-grade first; an ungraded page never ships).');
    }
    if (q.passed !== true) {
      const failures = [];
      for (const dev of q.scorecard) {
        const axes = [...Object.values(dev.gateA || {}), ...Object.values(dev.gateB || {})].filter((n) => typeof n === 'number');
        const mean = axes.reduce((a, b) => a + b, 0) / (axes.length || 1);
        const min = Math.min(...axes);
        const opsOk = Object.values(dev.operatorQuestions || {}).every(Boolean);
        if (mean < 82) failures.push(`${dev.device}: mean ${mean.toFixed(1)} < 82`);
        if (min < 70) failures.push(`${dev.device}: min axis ${min} < 70`);
        if (!opsOk) failures.push(`${dev.device}: operator questions not all true`);
      }
      if (failures.length) {
        throw new Error(`SHIP BAR: refusing to deploy — gate verdict is below the ship-best-effort floor (${failures.join('; ')}). Fix the page and re-grade; the bar is not negotiable at this boundary.`);
      }
      console.error('[deploy] ship-best-effort bar met (gate not exemplar-passed but mean>=82, min>=70, operators true) — shipping the best honest version');
    }
  }

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
