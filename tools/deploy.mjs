#!/usr/bin/env node
// deploy.mjs — Station 8 tool #10: deliver the assembled page to its own per-build URL.
//
// NOT "the already-passed page" (the wording until 2026-08-06). Since ADR-0011 the quality gate
// ADVISES and never destroys: this boundary refuses on INTEGRITY only — an unassembled page, a
// source-identity violation, or a scorecard that was never produced with no recorded grader failure
// — never on a low grade. A below-bar page is delivered with its weakest axis disclosed; a page the
// grader could not reach is delivered saying exactly that.
//
// CONTRACT (tools/CONTRACT.md): node tools/deploy.mjs <build-dir>
//   Reads (declared inputs):  page.dir, repo.slug, quality.scorecard   (+ deploy-provider token from env)
//   Writes (own slot only):   publish.liveUrl, publish.http200, publish.belowBar, publish.weakest,
//                             publish.graderUnavailable
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
async function deployNetlify({ pageDir, slug, ownerName }) {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) throw new Error('NETLIFY_AUTH_TOKEN not set in environment (deploy-provider token required)');
  const auth = { Authorization: `Bearer ${token}` };
  // NETLIFY_SITE_NAME override (owner ask 2026-07-30): deploy stuinfla/helix's page onto the
  // existing 'helix-explainer' site rather than minting a new {slug}-explainer subdomain.
  let name = process.env.NETLIFY_SITE_NAME || `${sanitize(slug)}-explainer`;

  const sites = await api(`https://api.netlify.com/api/v1/sites?name=${encodeURIComponent(name)}&filter=all`,
    { headers: auth }, 'netlify list sites');
  let site = (Array.isArray(sites) ? sites : []).find((s) => s.name === name) || null;

  // ── CROSS-OWNER OVERWRITE GUARD (2026-08-10) ─────────────────────────────────────────────────
  // clone-repo sets `slug: name`, DISCARDING the owner, so upstream/foo and attacker/foo both map to
  // `foo-explainer` here. The 90f16dc guard catches this by comparing against a previous local
  // build.json — but hosted builds run in a fresh timestamped directory every time, so there is never
  // a prior build to compare and the guard is structurally blind on the exact path real customers
  // use. Result: building a FORK, or merely another owner's repo with the same basename, silently
  // replaced the first customer's live page. Identity passed (the page IS about the submitted repo),
  // deploy returned 200, every advertised invariant reported success, and the wrong page was live at
  // someone else's URL. Found by GPT-5.6-Sol in adversarial review; verified against the code.
  //
  // Every deployed site ships llms.txt carrying its canonical GitHub URL, so the LIVE SITE ITSELF is
  // the ownership record — available on both doors, needing no local state.
  if (site && ownerName) {
    let incumbent = null;
    try {
      const probe = await fetch(`${site.ssl_url || `https://${name}.netlify.app`}/llms.txt`, { redirect: 'follow' });
      if (probe.ok) {
        const m = (await probe.text()).match(/https:\/\/github\.com\/([^/\s]+)\/([^/\s)"']+)/i);
        if (m) incumbent = `${m[1]}/${m[2]}`.replace(/\.git$/i, '').toLowerCase();
      }
    } catch { /* unreachable/new site — nothing to protect */ }
    if (incumbent && incumbent !== ownerName.toLowerCase()) {
      const safe = `${sanitize(ownerName.split('/')[0])}-${name}`;
      console.error(`[deploy] CROSS-OWNER COLLISION: '${name}' already serves ${incumbent}, not ${ownerName}. `
        + `Refusing to overwrite another owner's live page — deploying to '${safe}' instead.`);
      const alt = await api(`https://api.netlify.com/api/v1/sites?name=${encodeURIComponent(safe)}&filter=all`,
        { headers: auth }, 'netlify list sites (disambiguated)');
      site = (Array.isArray(alt) ? alt : []).find((s) => s.name === safe) || null;
      name = safe;
    }
  }
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

  // ── HISTORY: THE SHIP-BAR RAIL, 2026-07-13 → 2026-08-06 (REMOVED — kept for the reasoning) ──────
  // For three weeks this boundary ENFORCED the gate's verdict. Two real incidents built it:
  //   · 07-13 — an agent at its refine cap deployed a page the gate had FAILED (chalk, B5=58,
  //     passed=false); the runner reported SUCCESS and a human rolled it back. So the ship decision
  //     was made deterministic and moved HERE, to the boundary, beside the INV-21 identity pin:
  //     ship iff quality.passed === true, OR mean >= 82 AND min >= 70 AND all operators true.
  //   · 07-14 — the hosted agent found DEPLOY_FORCE=1 and bypassed it, so the override was made
  //     human-only (interactive TTY), which agents and CI can never satisfy.
  // Both incidents were real and the instinct was right: an AGENT must not be able to talk its way
  // past the bar. What was wrong was the CONSEQUENCE of failing it — see ADR-0011 below. The identity
  // pin above is untouched and still absolute; it is the thing that actually must never be bypassed.
  // ── ADR-0011 (2026-08-06): THE GATE ADVISES — IT NEVER DESTROYS ────────────────────────────────
  // The rail above described the world until 2026-08-06. It was BINARY, and the measured consequence
  // was that 56 of 104 hosted builds delivered NOTHING while still costing ~$5 each — roughly $280 of
  // rendered, graded, finished pages thrown away. PolymathWizard/BHIL-Colophon-Spec failed twice this
  // way ($12.47, two complete pages, no delivery) on a SINGLE axis (B5), where the INV-22 raster cap
  // had in fact been MISAPPLIED — the raster plainly passed the takeaway test, and the rubric caps
  // only when a raster fails BOTH tests. A lone stochastic vision call, with no second opinion and no
  // appeal, was authorised to destroy a paid-for artifact.
  //
  // Quality is now DISCLOSURE, not a delivery condition. Delivery is gated on INTEGRITY only:
  //   · the page assembled (index.html exists — asserted above),
  //   · the ADR-0007 source-identity invariant holds (asserted above; still an ABSOLUTE refusal),
  //   · a scorecard exists, so we can tell the requester HONESTLY where it landed.
  // Nothing about grading is relaxed: thresholds, rubric and `quality.passed` keep their exact
  // meanings, and the receipt still records the true scorecard. We changed what a `false` CAUSES, not
  // what it MEANS — which frees the grader to stay strict, because strictness no longer burns value.
  const q = bc.quality;
  const ungraded = !q || !Array.isArray(q.scorecard) || q.scorecard.length === 0;
  // THE GRADER-OUTAGE HATCH (2026-08-06, from adversarial review). Before ADR-0011, DEPLOY_FORCE
  // skipped this whole block INCLUDING the no-scorecard refusal, so a human at a terminal could still
  // ship during a vision-API outage. Removing the quality gate accidentally removed that too — which
  // left the stochastic judge holding a veto via its own AVAILABILITY, the exact thesis of ADR-0011
  // inverted. A TTY hatch is no answer either: hosted builds have no human, and the hosted lane is
  // where outages actually cost customers.
  // So: an outage the pipeline RECORDED (quality.graderUnavailable, set by the runner when grading
  // genuinely errors) is deliverable, because we can still describe the page honestly — "we could not
  // grade this one" is a true and useful statement. A MISSING scorecard with no recorded reason is
  // not: that is an unrun station, and shipping it would be a silent green.
  if (ungraded && q?.graderUnavailable !== true) {
    throw new Error('INTEGRITY: refusing to deploy — build.json has no quality scorecard and no recorded grader failure. '
      + 'We ship below-bar pages and we ship ungraded pages when the grader is genuinely down (quality.graderUnavailable), '
      + 'but never a page whose quality was simply never assessed (ADR-0011 D1).');
  }
  if (ungraded) {
    console.error('[deploy] ADR-0011 — delivering UNGRADED: the grader was recorded unavailable '
      + `(${q.graderUnavailable === true ? q.graderError || 'no detail recorded' : ''}). The requester is told plainly that this page was not graded.`);
  }

  // Compute the disclosure the delivery email needs: which device/axis is weakest, in human terms.
  const AXIS_LABEL = {
    A1: 'how compelling the page looks', A2: 'storytelling', A3: 'taking a stranger from clueless to convinced',
    A4: 'explaining why it matters to the reader', A5: 'completeness of the explanation',
    A6: 'confidence about what to do next', B1: 'typography and hierarchy', B2: 'alignment and grid',
    B3: 'spacing and rhythm', B4: 'overall polish', B5: 'the diagrams and imagery',
  };
  // A numeric-axis scan alone MISATTRIBUTES. `quality.passed` can be false purely from an operator
  // question or an INV-18 diagram failure (quality-grade.mjs) while every axis sits at 82+. Reporting
  // "the part that let it down was spacing and rhythm — graded 83" when the truth was "the
  // architecture diagram is invisible on mobile" is a confident, specific, wrong answer — the worst
  // kind. Non-numeric failures are the REAL blocker when present, so they rank first.
  const OPERATOR_LABEL = {
    believeIUnderstand: 'whether a reader finishes believing they understand it',
    approachable: 'how approachable the page feels',
    explainsToNovice: 'explaining it to someone new to the subject',
    architectureConfidence: 'confidence about how the thing is built',
    makesMeSmile: 'the craft and delight of it',
    zeroKnowledgeReader: 'being readable with zero prior knowledge',
  };
  // Order matters. A genuinely weak NUMBER is the most actionable thing to tell someone, so it wins
  // whenever one sits below the 70 floor. Only when every axis is fine do the non-numeric blockers
  // become the honest answer — and that is precisely the misattribution case this guards: `passed`
  // false purely from an operator question or an INV-18 diagram failure, where naming "spacing and
  // rhythm - 83" is a confident, specific, WRONG answer while the truth was an invisible diagram.
  let lowestAxis = null, nonNumeric = null;
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
  const weakest = (lowestAxis && lowestAxis.score < 70) ? lowestAxis : (nonNumeric || lowestAxis);
  const belowBar = q?.passed !== true;
  const graderUnavailable = ungraded;
  if (belowBar) {
    console.error(`[deploy] ADR-0011 — shipping BELOW THE BAR (weakest: ${weakest?.device} ${weakest?.axis}=${weakest?.score}, "${weakest?.label}"). `
      + 'The page is delivered with an honest note; the scorecard is unchanged and fully recorded.');
  }
  if (process.env.DEPLOY_FORCE === '1') {
    console.error('[deploy] DEPLOY_FORCE is now a no-op — quality no longer blocks delivery (ADR-0011). Identity and integrity still do, and neither is overridable.');
  }

  const provider = await resolveProvider();
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`unknown DEPLOY_PROVIDER '${provider}' (supported: ${Object.keys(ADAPTERS).join(', ')})`);

  // ownerName = the canonical "owner/name" this build is FOR — the guard needs it to tell a legitimate
  // redeploy from another owner's same-named repo.
  const ownerName = (bc.repo?.owner && bc.repo?.name) ? `${bc.repo.owner}/${bc.repo.name}` : null;
  const { liveUrl } = await adapter({ pageDir, slug, ownerName });
  console.error(`[deploy] ${provider} → ${liveUrl} (verifying 200 unauthenticated)`);
  const http200 = await verify200(liveUrl);
  if (!http200) throw new Error(`deployed to ${liveUrl} but it did not return 200 unauthenticated within timeout`);

  // The disclosure travels with the publish record so tools/notify.mjs can tell the requester where
  // this landed without re-deriving it, and so the build registry can measure WHICH axes actually
  // hold pages back (ADR-0011 D4) instead of us guessing from anecdotes.
  mergeSlot(buildDir, 'publish', {
    liveUrl,
    http200: true,
    belowBar,
    graderUnavailable,
    weakest: weakest ? { axis: weakest.axis, score: weakest.score, device: weakest.device, label: weakest.label } : null,
  });
  return { liveUrl, http200: true, provider, slot: 'publish', belowBar, graderUnavailable, weakest };
}

main()
  .then((outputs) => { process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n'); process.exit(0); })
  .catch((e) => { process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error: e.message || String(e) }) + '\n'); process.exit(1); });
