#!/usr/bin/env node
// readme-enhance.mjs — Station 8b, tool #13 of tools/CONTRACT.md (OFF the critical path, NON-BLOCKING).
//
// JOB (ADR-0015): offer the maintainer of the SOURCE repo a better README — their README exactly as
// written plus (a) an explainer link under the title and (b) their own ASCII diagrams drawn as animated
// SVGs above the originals, or, when they have none, the explainer's two generated diagrams just after
// the intro. The diagrams are the per-repo "story" diagrams (ADR-0014), verified against the source.
//
// CHANNEL (owner's decision 2026-10-10, after measuring claude-swap: 143 open PRs, 3 new a day):
//   default  README_OUTREACH=issue : open an ISSUE that shows the finished work — a one-click rendered
//            README, the images, the explainer link — and offers a PR "on request". Nothing in their
//            repo is touched, no CI is triggered, nothing is asked of them but a glance.
//   follow-up README_OUTREACH=pr   : open the PR (fork + branch). Used after a yes, via
//            `explainmyrepo outreach open-pr <owner/name>`, and referencing the issue.
//
// GOOD-CITIZEN RULES (enforced here, pinned in tests/readme-pr.test.mjs + tests/outreach.test.mjs):
//   • never your own repo, never a private repo, never without a live page;
//   • one contact per repo, ever; a closed/merged item is never re-sent;
//   • a daily cap (README_OUTREACH_DAILY_CAP, default 5);
//   • additions only — their words are never changed;
//   • every send is recorded in the outreach ledger so we can see who responds.
//
// OFF SWITCH: README_ENHANCE=0 (or --no-readme-pr on the CLI). ON by default.
// DRY RUN:    README_OUTREACH_DRYRUN=1 does everything locally — stages the proposal, writes the exact
//             issue/PR text to <build>/readme-proposal/ — and touches no network, gh, or ledger.
//
// Uniform invocation:  node tools/readme-enhance.mjs <build-dir>
//
// Reads (declared inputs): build.json repo{owner,name,clonePath,defaultBranch,private}, publish.liveUrl,
//   publish.explainerRepoUrl, visuals.architectureDiagram/.flowDiagram{svgPath,altText}.
// Writes (own slot): build.json readmePr; <build>/readme-proposal/**; the explainer repo's
//   readme-proposal/ folder (preview host); the outreach ledger; the issue or PR itself.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rewriteReadme } from '../src/readme-ascii.mjs';
import {
  buildPrBody, buildPrTitle, buildIssueTitle, decideSend, readmePrEnabled,
} from '../src/readme-pr.mjs';
import {
  ledgerPath, readLedger, appendLedger, underDailyCap, priorContacts, DEFAULT_DAILY_CAP,
} from '../src/outreach.mjs';

const TOOL = 'readme-enhance';
const BRANCH = 'explainer/readme-enhancement';
const SVG_DIR = 'docs/explainer';
const PROPOSAL_DIR = 'readme-proposal';

function emit(result) { process.stdout.write(`${JSON.stringify(result)}\n`); }
function log(msg) { process.stderr.write(`[${TOOL}] ${msg}\n`); }
function fail(message) { log(message); emit({ ok: false, outputs: {}, error: message }); process.exit(1); }

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
  } catch (err) {
    const stderr = (err.stderr || '').toString().trim();
    const e = new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${stderr || err.message}`);
    e.stderr = stderr;
    throw e;
  }
}
const redact = (s, token) => (token ? String(s).split(token).join('***') : String(s));
const resolveIn = (buildDir, p) => (path.isAbsolute(p) ? p : path.resolve(buildDir, p));

/** First ≤2 sentences of the diagram's alt text, ≤240 chars: a caption, not a transcript. */
function caption(alt, fallback) {
  const t = String(alt || '').replace(/\s+/g, ' ').trim();
  if (!t) return fallback;
  const sentences = t.match(/[^.!?]+[.!?]+/g) || [t];
  let out = '';
  for (const s of sentences) { if ((out + s).length > 240) break; out += s; if (out.split(/[.!?]/).filter(Boolean).length >= 2) break; }
  return (out || t.slice(0, 240)).trim();
}

async function rasterize(svgPath, outPath) {
  try {
    const sharp = (await import('sharp')).default;
    await sharp(fs.readFileSync(svgPath)).resize({ width: 1200 }).png().toFile(outPath);
    return true;
  } catch (e) {
    log(`preview image skipped for ${path.basename(svgPath)}: ${String(e.message).slice(0, 120)}`);
    return false;
  }
}

function pushProposalToExplainerRepo(full, token, proposalDir) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-proposal-'));
  try {
    const remote = `https://x-access-token:${token}@github.com/${full}.git`;
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    const git = (args, cwd) => execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    git(['clone', '--depth', '1', remote, 'repo'], stage);
    const repo = path.join(stage, 'repo');
    fs.rmSync(path.join(repo, PROPOSAL_DIR), { recursive: true, force: true });
    fs.cpSync(proposalDir, path.join(repo, PROPOSAL_DIR), { recursive: true });
    git(['config', 'user.email', 'explainer-bot@users.noreply.github.com'], repo);
    git(['config', 'user.name', 'explainmyrepo'], repo);
    git(['add', '-A', PROPOSAL_DIR], repo);
    const dirty = git(['status', '--porcelain'], repo).trim();
    if (dirty) { git(['commit', '-m', 'docs: proposed README for the source repo (preview)'], repo); git(['push', 'origin', 'HEAD:main'], repo); }
    return true;
  } catch (e) {
    log(`could not publish the preview to ${full}: ${redact(e.stderr || e.message, token).slice(0, 240)}`);
    return false;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

async function main() {
  const buildDir = process.argv[2];
  if (!buildDir) fail('usage: node tools/readme-enhance.mjs <build-dir>');
  const env = process.env;
  const buildJsonPath = path.join(buildDir, 'build.json');
  let ctx;
  try { ctx = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8')); } catch (err) { fail(`cannot read ${buildJsonPath}: ${err.message}`); }
  const record = (slot) => { ctx.readmePr = slot; fs.writeFileSync(buildJsonPath, `${JSON.stringify(ctx, null, 2)}\n`); };
  const done = (slot, extra = {}) => { record(slot); emit({ ok: true, outputs: { readmePr: slot, ...extra }, error: null }); process.exit(0); };

  const dry = /^(1|true|yes|on)$/i.test(String(env.README_OUTREACH_DRYRUN || ''));
  const channel = /^pr$/i.test(String(env.README_OUTREACH || '')) ? 'pr' : 'issue';

  // ── opt-out ──────────────────────────────────────────────────────────────────────────────────────
  if (!readmePrEnabled(env)) {
    log('README_ENHANCE is off — not contacting the maintainer.');
    done({ prUrl: 'declined', kind: null, reason: 'opted-out', svgsShared: [] });
  }

  // ── declared inputs (loud when enabled and missing) ──────────────────────────────────────────────
  const repo = ctx.repo;
  if (!repo || !repo.owner || !repo.name || !repo.clonePath) fail('repo slot incomplete — need repo.owner, repo.name, repo.clonePath (run clone-repo first).');
  const arch = ctx.visuals && ctx.visuals.architectureDiagram;
  const flow = ctx.visuals && ctx.visuals.flowDiagram;
  if (!arch || !arch.svgPath) fail('visuals.architectureDiagram.svgPath is absent — run make-diagrams (Station 4) first.');
  if (!flow || !flow.svgPath) fail('visuals.flowDiagram.svgPath is absent — run make-diagrams (Station 4) first.');
  const archSvg = resolveIn(buildDir, arch.svgPath);
  const flowSvg = resolveIn(buildDir, flow.svgPath);
  if (!fs.existsSync(archSvg)) fail(`architecture SVG not found on disk: ${archSvg}`);
  if (!fs.existsSync(flowSvg)) fail(`flow SVG not found on disk: ${flowSvg}`);
  const clone = resolveIn(buildDir, repo.clonePath);
  if (!fs.existsSync(clone)) fail(`source clone not found: ${clone} (run clone-repo first).`);

  const liveUrl = ctx.publish && ctx.publish.liveUrl;
  const explainerUrl = ctx.publish && ctx.publish.explainerRepoUrl;
  const explainerFull = explainerUrl ? explainerUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '') : null;
  const repoFull = `${repo.owner}/${repo.name}`;
  const ledger = ledgerPath(env);

  // ── identity ─────────────────────────────────────────────────────────────────────────────────────
  let ghLogin, ghName;
  if (dry) { ghLogin = env.README_OUTREACH_AS || 'dry-run-user'; ghName = ghLogin; }
  else {
    try {
      const u = JSON.parse(run('gh', ['api', 'user']));
      ghLogin = u.login; ghName = u.name || u.login;
    } catch (e) { fail(`cannot identify the sending account via gh: ${e.message}`); }
  }

  // ── who may be contacted ─────────────────────────────────────────────────────────────────────────
  if (!explainerFull) { log('no explainer repo to host the preview (publish-repo skipped?) — not contacting.'); done({ prUrl: 'skipped', kind: channel, reason: 'no-explainer-repo', svgsShared: [] }); }
  const entries = readLedger(ledger);
  if (channel === 'issue') {
    if (priorContacts(entries, repoFull).length) { log(`already contacted ${repoFull} — one contact per repo.`); done({ prUrl: 'skipped', kind: 'issue', reason: 'already-contacted', svgsShared: [] }); }
    const cap = underDailyCap(entries, Number(env.README_OUTREACH_DAILY_CAP) || DEFAULT_DAILY_CAP);
    if (!cap.ok) { log(cap.reason); done({ prUrl: 'skipped', kind: 'issue', reason: cap.reason, svgsShared: [] }); }
  }
  const title = channel === 'pr' ? buildPrTitle(repo.name) : buildIssueTitle(repo.name);
  let existing = [];
  if (!dry) {
    try {
      const flag = channel === 'pr' ? 'pr' : 'issue';
      const rows = JSON.parse(run('gh', [flag, 'list', '--repo', repoFull, '--author', ghLogin, '--state', 'all', '--limit', '30', '--json', 'number,state,url,title']));
      existing = rows.filter((r) => r.title === title).map((r) => ({ state: r.state, url: r.url, author: ghLogin }));
    } catch (e) { log(`could not list existing items (continuing): ${String(e.message).slice(0, 120)}`); }
  }
  const verdict = decideSend({ owner: repo.owner, ghLogin, isPrivate: Boolean(repo.private), liveUrl, existing });
  if (verdict.action === 'skip') { log(`not sending: ${verdict.reason}`); done({ prUrl: 'skipped', kind: channel, reason: verdict.reason, svgsShared: [] }); }
  if (verdict.action === 'reuse') { log(`an open item of ours already exists: ${verdict.url}`); done({ prUrl: verdict.url, kind: channel, reason: 'reused', svgsShared: [] }); }

  // ── the rewrite (additions only) ─────────────────────────────────────────────────────────────────
  const readmeName = fs.readdirSync(clone).find((f) => /^readme(\.md|\.markdown)?$/i.test(f)) || 'README.md';
  const original = fs.existsSync(path.join(clone, readmeName)) ? fs.readFileSync(path.join(clone, readmeName), 'utf8') : '';
  const rw = rewriteReadme(original, {
    liveUrl, repoName: repo.name, svgDir: SVG_DIR,
    fallback: [
      { alt: caption(arch.altText, `How ${repo.name} is put together.`), rel: `${SVG_DIR}/architecture.svg` },
      { alt: caption(flow.altText, `How ${repo.name} works.`), rel: `${SVG_DIR}/flow.svg` },
    ],
  });
  const addedLines = Math.max(0, rw.markdown.replace(/\n$/, '').split('\n').length - original.replace(/\n$/, '').split('\n').length);

  // ── stage the proposal (also the preview that gets hosted) ───────────────────────────────────────
  const proposal = path.join(buildDir, PROPOSAL_DIR);
  fs.rmSync(proposal, { recursive: true, force: true });
  fs.mkdirSync(path.join(proposal, SVG_DIR), { recursive: true });
  fs.mkdirSync(path.join(proposal, 'preview'), { recursive: true });
  fs.writeFileSync(path.join(proposal, readmeName), rw.markdown);
  const files = [];
  if (rw.mode === 'ascii') {
    for (const d of rw.diagrams) { fs.writeFileSync(path.join(proposal, SVG_DIR, d.file), d.svg); files.push(`${SVG_DIR}/${d.file}`); }
  } else if (rw.mode === 'fallback') {
    fs.copyFileSync(archSvg, path.join(proposal, SVG_DIR, 'architecture.svg'));
    fs.copyFileSync(flowSvg, path.join(proposal, SVG_DIR, 'flow.svg'));
    files.push(`${SVG_DIR}/architecture.svg`, `${SVG_DIR}/flow.svg`);
  }
  const haveArchPng = await rasterize(archSvg, path.join(proposal, 'preview', 'architecture.png'));
  const haveFlowPng = await rasterize(flowSvg, path.join(proposal, 'preview', 'flow.png'));

  // ── host the preview in the explainer repo ───────────────────────────────────────────────────────
  const rawBase = explainerFull ? `https://raw.githubusercontent.com/${explainerFull}/main` : null;
  let hosted = false;
  if (!dry && explainerFull) {
    const token = env.GITHUB_TOKEN || env.GH_TOKEN;
    hosted = token ? pushProposalToExplainerRepo(explainerFull, token, proposal) : false;
    if (!token) log('no GITHUB_TOKEN/GH_TOKEN — cannot host the preview; the message would have no rendered README link.');
  }
  const previewReadmeUrl = explainerFull ? `https://github.com/${explainerFull}/blob/main/${PROPOSAL_DIR}/${readmeName}` : null;
  if (!dry && !hosted && channel === 'issue') {
    // An issue whose whole point is "see it rendered" is worthless without the rendered link: stand down.
    done({ prUrl: 'skipped', kind: 'issue', reason: 'preview-not-hosted', svgsShared: [] });
  }
  const images = { hero: rawBase ? `${rawBase}/assets/hero.png` : undefined };
  if (haveArchPng && rw.mode === 'fallback') images.architecture = `${rawBase}/${PROPOSAL_DIR}/preview/architecture.png`;
  if (haveFlowPng && rw.mode === 'fallback') images.flow = `${rawBase}/${PROPOSAL_DIR}/preview/flow.png`;

  // ── PR channel: branch + fork + push ─────────────────────────────────────────────────────────────
  let readmeUrl = previewReadmeUrl;
  let prHead = null;
  if (channel === 'pr' && !dry) {
    const base = repo.defaultBranch || 'main';
    try {
      run('git', ['-C', clone, 'checkout', '-B', BRANCH]);
      fs.cpSync(path.join(proposal, SVG_DIR), path.join(clone, SVG_DIR), { recursive: true });
      fs.writeFileSync(path.join(clone, readmeName), rw.markdown);
      run('git', ['-C', clone, 'add', '--', readmeName, SVG_DIR]);
      run('git', ['-C', clone, '-c', `user.name=${ghName}`, '-c', `user.email=${ghLogin}@users.noreply.github.com`,
        'commit', '-m', 'docs: add an explainer link and diagrams to the README']);
    } catch (e) { fail(`failed to stage the README change: ${e.message}`); }
    let pushedToOrigin = false;
    try { run('git', ['-C', clone, 'push', '--force-with-lease', '-u', 'origin', BRANCH]); pushedToOrigin = true; } catch { /* no write access */ }
    let headOwner = repo.owner;
    prHead = BRANCH;
    if (!pushedToOrigin) {
      try {
        run('gh', ['repo', 'fork', repoFull, '--clone=false']);
        try { run('git', ['-C', clone, 'remote', 'remove', 'explainer-fork']); } catch { /* none */ }
        run('git', ['-C', clone, 'remote', 'add', 'explainer-fork', `https://github.com/${ghLogin}/${repo.name}.git`]);
        run('git', ['-C', clone, 'push', '--force-with-lease', '-u', 'explainer-fork', BRANCH]);
      } catch (e) { fail(`could not push the branch to a fork: ${e.message}`); }
      headOwner = ghLogin;
      prHead = `${ghLogin}:${BRANCH}`;
    }
    readmeUrl = `https://github.com/${headOwner}/${repo.name}/blob/${BRANCH}/${readmeName}`;
  }

  // ── the message ──────────────────────────────────────────────────────────────────────────────────
  let body = buildPrBody({
    repoName: repo.name, liveUrl, readmeUrl: readmeUrl || liveUrl, mode: rw.mode, addedLines, files, images,
    intro: env.README_PR_INTRO, signoff: env.README_PR_SIGNOFF || ghName, kind: channel === 'pr' ? 'pr' : 'issue',
  });
  if (channel === 'pr' && env.README_ENHANCE_ISSUE) body = `Follow-up to #${String(env.README_ENHANCE_ISSUE).replace(/\D/g, '')}, as offered.\n\n${body}`;

  if (dry) {
    const out = path.join(proposal, channel === 'pr' ? 'PR.md' : 'ISSUE.md');
    fs.writeFileSync(out, `# ${title}\n\n${body}`);
    log(`dry run — wrote ${path.relative(process.cwd(), out) || out}; nothing was sent.`);
    done({ prUrl: 'dry-run', kind: channel, mode: rw.mode, previewUrl: previewReadmeUrl, addedLines, svgsShared: files },
      { title, bodyFile: out });
  }

  const bodyFile = path.join(proposal, channel === 'pr' ? 'PR.md' : 'ISSUE.md');
  fs.writeFileSync(bodyFile, body);
  let url;
  try {
    if (channel === 'pr') {
      url = run('gh', ['pr', 'create', '--repo', repoFull, '--base', repo.defaultBranch || 'main', '--head', prHead, '--title', title, '--body-file', bodyFile]);
    } else {
      url = run('gh', ['issue', 'create', '--repo', repoFull, '--title', title, '--body-file', bodyFile]);
    }
    url = url.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  } catch (e) { fail(`gh ${channel === 'pr' ? 'pr' : 'issue'} create failed: ${e.message}`); }
  if (!/^https?:\/\//.test(url || '')) fail(`could not determine the created URL (got ${JSON.stringify(url)}).`);

  appendLedger(ledger, {
    type: 'sent', ts: new Date().toISOString(), repo: repoFull, kind: channel, url,
    number: Number((url.match(/\/(\d+)$/) || [])[1]) || null, previewUrl: previewReadmeUrl, liveUrl,
    explainerRepo: explainerUrl, buildDir: path.resolve(buildDir), mode: rw.mode, sentBy: ghLogin,
  });
  log(`sent ${channel}: ${url}`);
  done({ prUrl: url, kind: channel, mode: rw.mode, previewUrl: previewReadmeUrl, addedLines, svgsShared: files }, { url });
}

main().catch((e) => fail(`unexpected: ${e && e.message}`));
