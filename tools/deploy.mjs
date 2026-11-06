#!/usr/bin/env node
// deploy.mjs — Station 8: deliver the assembled page to its own Netlify site.
// Refuses on INTEGRITY only (ADR-0011): unassembled page, INV-21 identity mismatch, broken site, or no
// scorecard with no recorded reason. A low score is disclosed, never a refusal.
//
// CONTRACT (tools/CONTRACT.md): node tools/deploy.mjs <build-dir>
//   Reads:  repo.url/owner/name/slug, page.dir, quality.{scorecard,passed,gateRefusal,graderUnavailable,graderError};
//           NETLIFY_AUTH_TOKEN and EXPLAINER_SUBMITTED_REPO from env
//   Writes: publish.{liveUrl, http200, belowBar, graderUnavailable, gateRefusal, weakest}
//   stdout = ONE JSON result object; diagnostics -> stderr; exit 0 iff ok:true.
//
// Netlify only, one site per explainer; no fallback provider (a provider fallback once overwrote an
// unrelated live site, be60a1c). FAIL LOUD: a missing token, a failed deploy or a liveUrl that is not
// 200 unauthenticated is a non-zero exit, never a placeholder URL.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { finalize as finalizeAsk } from '../src/ask.mjs';
import { checkSite, formatResults, blockingFailures, metaContent, verifyLiveShareCard } from '../src/site-check.mjs';

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

// ---- Netlify ----
// Cross-owner guard. The slug drops the owner, so upstream/foo and attacker/foo would both map to
// `foo-explainer`. Every deployed site's llms.txt names its canonical GitHub URL, so the LIVE SITE is the
// ownership record (works on both doors, needs no local state). On a mismatch deploy to `<owner>-<name>`
// instead of overwriting (67b3623). `fetchImpl` is injectable for tests.
export async function resolveSiteName({ name, ownerName, site, fetchImpl = fetch }) {
  if (!site || !ownerName) return { name, incumbent: null };
  let incumbent = null;
  try {
    const probe = await fetchImpl(`${site.ssl_url || `https://${name}.netlify.app`}/llms.txt`, { redirect: 'follow' });
    if (probe.ok) {
      const m = (await probe.text()).match(/https:\/\/github\.com\/([^/\s]+)\/([^/\s)"']+)/i);
      if (m) incumbent = `${m[1]}/${m[2]}`.replace(/\.git$/i, '').toLowerCase();
    }
  } catch { /* unreachable/new site — nothing to protect */ }
  if (incumbent && incumbent !== ownerName.toLowerCase()) {
    return { name: `${sanitize(ownerName.split('/')[0])}-${name}`, incumbent };
  }
  return { name, incumbent: null };
}

// The page bakes `<slug>-explainer.netlify.app` into og:url/og:image/twitter:image, but the real host can
// differ (NETLIFY_SITE_NAME override, cross-owner rename). Rewrite the baked host to the final one, then
// re-run the blocking site checks against it, so the shipped share card points at the live URL.
export function retargetHost(pageDir, host) {
  const htmlPath = path.join(pageDir, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  let old = null;
  try { old = new URL(metaContent(html, 'og:url') || metaContent(html, 'og:image') || '').host; } catch { /* none baked */ }
  if (!old || old === host) return { rewritten: false, from: old };
  for (const f of ['index.html', 'sitemap.xml', 'robots.txt', 'llms.txt']) {
    const fp = path.join(pageDir, f);
    if (fs.existsSync(fp)) fs.writeFileSync(fp, fs.readFileSync(fp, 'utf8').split(`https://${old}`).join(`https://${host}`));
  }
  return { rewritten: true, from: old };
}

// After deploy: the card must be served from the live host. A just-ready deploy can lag, so retry briefly.
export async function verifyShareCardLive({ pageDir, liveUrl, fetchImpl, tries = 6, delayMs = 3000 }) {
  const html = fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8');
  let r;
  for (let i = 0; i < tries; i++) {
    r = await verifyLiveShareCard({ html, liveUrl, fetchImpl });
    if (r.ok || /points at/.test(r.msg)) break;   // a host mismatch will not heal by waiting
    if (i < tries - 1) await sleep(delayMs);
  }
  return r;
}

async function deployNetlify({ pageDir, slug, ownerName }) {
  const auth = { Authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}` };
  // NETLIFY_SITE_NAME deploys onto an existing site (e.g. 'helix-explainer') instead of minting {slug}-explainer.
  let name = process.env.NETLIFY_SITE_NAME || `${sanitize(slug)}-explainer`;

  const sites = await api(`https://api.netlify.com/api/v1/sites?name=${encodeURIComponent(name)}&filter=all`,
    { headers: auth }, 'netlify list sites');
  let site = (Array.isArray(sites) ? sites : []).find((s) => s.name === name) || null;

  const resolved = await resolveSiteName({ name, ownerName, site });
  if (resolved.name !== name) {
    console.error(`[deploy] CROSS-OWNER COLLISION: '${name}' already serves ${resolved.incumbent}, not ${ownerName}. `
      + `Refusing to overwrite another owner's live page — deploying to '${resolved.name}' instead.`);
    name = resolved.name;
    const alt = await api(`https://api.netlify.com/api/v1/sites?name=${encodeURIComponent(name)}&filter=all`,
      { headers: auth }, 'netlify list sites (disambiguated)');
    site = (Array.isArray(alt) ? alt : []).find((s) => s.name === name) || null;
  }
  if (!site) {
    site = await api('https://api.netlify.com/api/v1/sites',
      { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
      'netlify create site');
  }
  console.error(`[deploy] netlify site '${name}' (id ${site.id})`);

  // The Ask box's credential is bound to the FINAL host, which is only known here (name may have been
  // disambiguated above). No secret → the box ships in closest-passages mode and says so.
  const host = `${name}.netlify.app`;
  const moved = retargetHost(pageDir, host);
  if (moved.rewritten) console.error(`[deploy] share-card host rewritten ${moved.from} -> ${host}`);
  const bad = blockingFailures(checkSite(pageDir, { host, allowAskPlaceholder: true }));   // the Ask credential is filled in just below
  if (bad.length) throw new Error(`SITE INTEGRITY: the page does not match its final host ${host} —\n${formatResults(bad)}`);

  const askResult = finalizeAsk(pageDir, `${name}.netlify.app`, process.env.ASK_SIGNING_SECRET);
  if (askResult.ask !== 'absent') console.error(`[deploy] ask: ${JSON.stringify(askResult)}`);

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
  return { liveUrl: site.ssl_url || `https://${host}`, deployId: deploy.id };
}

// Netlify is the only target. A missing or invalid token fails loud with how to refresh it.
async function assertNetlifyToken() {
  if (!process.env.NETLIFY_AUTH_TOKEN) {
    throw new Error('NETLIFY_AUTH_TOKEN is not set. Create a Netlify personal access token at https://app.netlify.com/user/applications#personal-access-tokens and put NETLIFY_AUTH_TOKEN=… in .env, then retry. Deploys go to Netlify only.');
  }
  const r = await fetch('https://api.netlify.com/api/v1/user', { headers: { Authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}` } }).catch(() => null);
  if (!r || !r.ok) throw new Error(`NETLIFY_AUTH_TOKEN is set but not valid (HTTP ${r ? r.status : 'network error'}). Refresh it at https://app.netlify.com/user/applications#personal-access-tokens and update NETLIFY_AUTH_TOKEN in .env. Deploys go to Netlify only — no fallback.`);
}

async function main() {
  if (typeof fetch !== 'function') throw new Error('global fetch unavailable — Node 18+ required');
  const buildDir = process.argv[2];
  if (!buildDir) throw new Error('usage: node tools/deploy.mjs <build-dir>');

  const bc = readContext(buildDir);

  // SOURCE-IDENTITY pin (INV-21): the published page must be built from the repo the human submitted,
  // never a mid-build substitute (an agent once deployed a lookalike's page).
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

  // SITE INTEGRITY (blocking): refuse a page that links a file it does not ship or carries a dead Ask box.
  // The Ask credential is filled in later in this step, so its placeholder is allowed here.
  {
    const checks = checkSite(pageDir, { allowAskPlaceholder: true });
    const bad = blockingFailures(checks);
    if (bad.length) throw new Error(`SITE INTEGRITY: refusing to deploy a broken page —\n${formatResults(checks.filter((c) => !c.ok))}`);
    const warn = checks.filter((c) => !c.ok);
    if (warn.length) console.error(`[deploy] site checks (advisory):\n${formatResults(warn)}`);
  }

  // ADR-0011: quality is disclosure, never a delivery condition. Refuse only on integrity.
  const q = bc.quality;
  const ungraded = !q || !Array.isArray(q.scorecard) || q.scorecard.length === 0;
  // A recorded grader outage (graderUnavailable) or pre-check refusal (gateRefusal) is a known, disclosable
  // reason; an empty scorecard with neither is an unrun station.
  const gateRefusal = (typeof q?.gateRefusal === 'string' && q.gateRefusal.trim()) ? q.gateRefusal.trim() : null;
  if (ungraded && q?.graderUnavailable !== true && !gateRefusal) {
    throw new Error('INTEGRITY: refusing to deploy — build.json has no quality scorecard and no recorded grader failure. '
      + 'We ship below-bar pages and we ship ungraded pages when the grader is genuinely down (quality.graderUnavailable), '
      + 'but never a page whose quality was simply never assessed (ADR-0011 D1).');
  }
  if (ungraded && gateRefusal) {
    console.error(`[deploy] ADR-0011 — delivering a page that failed a deterministic pre-check before vision grading (${gateRefusal}). `
      + 'The requester is told plainly what failed; there is no vision scorecard for this copy.');
  } else if (ungraded) {
    console.error('[deploy] ADR-0011 — delivering UNGRADED: the grader was recorded unavailable '
      + `(${q.graderError || 'no detail recorded'}). The requester is told plainly that this page was not graded.`);
  }

  // Compute the disclosure the delivery email needs: which device/axis is weakest, in human terms.
  const AXIS_LABEL = {
    A1: 'how compelling the page looks', A2: 'storytelling', A3: 'taking a stranger from clueless to convinced',
    A4: 'explaining why it matters to the reader', A5: 'completeness of the explanation',
    A6: 'confidence about what to do next', B1: 'typography and hierarchy', B2: 'alignment and grid',
    B3: 'spacing and rhythm', B4: 'overall polish', B5: 'the diagrams and imagery',
  };
  const OPERATOR_LABEL = {
    believeIUnderstand: 'whether a reader finishes believing they understand it',
    approachable: 'how approachable the page feels',
    explainsToNovice: 'explaining it to someone new to the subject',
    architectureConfidence: 'confidence about how the thing is built',
    makesMeSmile: 'the craft and delight of it',
    zeroKnowledgeReader: 'being readable with zero prior knowledge',
  };
  // A genuinely weak number (<70) is named first; otherwise a failed operator or INV-18 is the real blocker,
  // not the lowest number (naming "spacing 83" when a diagram is invisible is a confident wrong answer).
  let lowestAxis = null, nonNumeric = null;
  // The pre-check measured THIS copy, so the refusal outranks any numbers.
  const refusalWeakest = gateRefusal
    ? { axis: (gateRefusal.match(/^INV-\d+/) || ['pre-check'])[0], score: null, device: 'both', label: OPERATOR_LABEL.zeroKnowledgeReader }
    : null;
  for (const dev of (q?.scorecard || [])) {
    for (const [axis, score] of Object.entries({ ...(dev.gateA || {}), ...(dev.gateB || {}) })) {
      if (typeof score !== 'number') continue;
      if (!lowestAxis || score < lowestAxis.score) lowestAxis = { axis, score, device: dev.device, label: AXIS_LABEL[axis] || axis };
    }
    if (!nonNumeric && dev.inv18 && dev.inv18.passed === false) {
      nonNumeric = { axis: 'INV-18', score: null, device: dev.device, label: 'the architecture and flow diagrams' };
    }
    for (const [op, ok] of Object.entries(dev.operatorQuestions || {})) {
      if (ok === false && !nonNumeric) nonNumeric = { axis: `operator:${op}`, score: null, device: dev.device, label: OPERATOR_LABEL[op] || op };
    }
  }
  const weakest = refusalWeakest || ((lowestAxis && lowestAxis.score < 70) ? lowestAxis : (nonNumeric || lowestAxis));
  const belowBar = q?.passed !== true;
  const graderUnavailable = ungraded && !gateRefusal;
  if (belowBar) {
    console.error(`[deploy] ADR-0011 — shipping BELOW THE BAR (weakest: ${weakest?.device} ${weakest?.axis}=${weakest?.score}, "${weakest?.label}"). `
      + 'The page is delivered with an honest note; the scorecard is unchanged and fully recorded.');
  }

  await assertNetlifyToken();

  // ownerName = the canonical "owner/name" this build is FOR, so the guard can tell a redeploy from
  // another owner's same-named repo.
  const ownerName = (bc.repo?.owner && bc.repo?.name) ? `${bc.repo.owner}/${bc.repo.name}` : null;
  const { liveUrl, deployId } = await deployNetlify({ pageDir, slug, ownerName });
  // Recorded before the 200 check so a deploy that landed but failed verification is still visible to the cure stage.
  mergeSlot(buildDir, 'publish', { liveUrl, deployId });
  console.error(`[deploy] netlify → ${liveUrl} (verifying 200 unauthenticated)`);
  const http200 = await verify200(liveUrl);
  if (!http200) throw new Error(`deployed to ${liveUrl} but it did not return 200 unauthenticated within timeout`);
  const card = await verifyShareCardLive({ pageDir, liveUrl });
  if (!card.ok) {
    // The page is live, so record that and WHY the share card failed before refusing (disclosed, non-zero exit).
    mergeSlot(buildDir, 'publish', { liveUrl, http200: true, shareCardError: card.msg });
    throw new Error(`SHARE CARD: ${liveUrl} is live but ${card.msg}`);
  }

  // The disclosure travels with the publish record so notify can tell the requester where this landed,
  // and the build registry can measure which axes hold pages back.
  mergeSlot(buildDir, 'publish', {
    liveUrl,
    http200: true,
    belowBar,
    graderUnavailable,
    gateRefusal,
    weakest: weakest ? { axis: weakest.axis, score: weakest.score, device: weakest.device, label: weakest.label } : null,
  });
  return { liveUrl, http200: true, slot: 'publish', belowBar, graderUnavailable, gateRefusal, weakest };
}

// Run only when invoked directly (so tests can import resolveSiteName). realpath: argv[1] is not
// symlink-resolved but import.meta.url is.
const isDirectRun = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isDirectRun) {
  main()
    .then((outputs) => { process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n'); process.exit(0); })
    .catch((e) => { process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error: e.message || String(e) }) + '\n'); process.exit(1); });
}
