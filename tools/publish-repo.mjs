#!/usr/bin/env node
// publish-repo.mjs — Station 8 tool #11: create the dedicated explainer GitHub repo + ship the site.
//
// CONTRACT (tools/CONTRACT.md): node tools/publish-repo.mjs <build-dir>
//   Reads (declared inputs):  repo.owner, repo.name, repo.slug, page.dir   (+ GitHub token from env)
//   Writes (own slot only):   publish.explainerRepoUrl, publish.ownerInvited
//   stdout = ONE JSON result object; diagnostics → stderr; exit 0 iff ok:true, else non-zero.
//
// Creates  stuinfla/{slug}-explainer  (public; org overridable via GITHUB_EXPLAINER_OWNER) via `gh`,
// pushes the assembled site to it, then invites the SOURCE repo owner as a collaborator (best-effort
// per CONTRACT) and surfaces the invite link in stderr + outputs.
//
// FAIL LOUD: the core job (create repo + push site) fails non-zero with a clear message on any error
// — never a placeholder URL. The collaborator invite is best-effort: a failure is a WARNING that sets
// ownerInvited:false, it never inverts a successfully-published repo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const sanitize = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

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
const errText = (e) => (e.stderr ? e.stderr.toString() : '') || e.message || String(e);

function requireGh() {
  try { execFileSync('gh', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] }); }
  catch { throw new Error("GitHub CLI 'gh' not found in PATH (required to publish the explainer repo)"); }
}

function ghRepoExists(full) {
  try { execFileSync('gh', ['api', `repos/${full}`], { stdio: ['ignore', 'ignore', 'pipe'] }); return true; }
  catch (e) {
    const msg = errText(e);
    if (/Not Found|HTTP 404|\b404\b/.test(msg)) return false;
    throw new Error(`gh api repos/${full} failed: ${msg.slice(0, 200)}`);
  }
}
function ghCreateRepo(full, description) {
  try { execFileSync('gh', ['repo', 'create', full, '--public', '--description', description], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error(`gh repo create ${full} failed: ${errText(e).slice(0, 300)}`); }
}
function pushSite(pageDir, full, token) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-push-'));
  try {
    fs.cpSync(pageDir, stage, { recursive: true });
    const remote = `https://x-access-token:${token}@github.com/${full}.git`;
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    const run = (args) => execFileSync('git', args, { cwd: stage, env, stdio: ['ignore', 'pipe', 'pipe'] });
    run(['init', '-q']);
    run(['config', 'user.email', 'explainer-bot@users.noreply.github.com']);
    run(['config', 'user.name', 'Explainer Bot']);
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'Publish explainer site']);
    run(['branch', '-M', 'main']);
    run(['remote', 'add', 'origin', remote]);
    run(['push', '-f', '-u', 'origin', 'main']);
  } catch (e) {
    throw new Error(`git push to ${full} failed: ${errText(e).replace(token, '***').slice(0, 300)}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
function ghInvite(full, username) {
  // PUT collaborators → 201 with an invitation body (html_url) for a non-member, or 204 (empty) if
  // the user is already a collaborator. Either is a success.
  try {
    const out = execFileSync('gh', ['api', '-X', 'PUT', `repos/${full}/collaborators/${username}`, '-f', 'permission=push'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out && out.trim() ? JSON.parse(out) : {};
  } catch (e) {
    throw new Error(`invite ${username} to ${full} failed: ${errText(e).slice(0, 200)}`);
  }
}

async function main() {
  const buildDir = process.argv[2];
  if (!buildDir) throw new Error('usage: node tools/publish-repo.mjs <build-dir>');

  const bc = readContext(buildDir);
  const owner = bc.repo?.owner;          // SOURCE repo owner — the person to invite
  const name = bc.repo?.name;
  const slug = bc.repo?.slug;
  const pageDir = path.resolve(bc.page?.dir || '');
  if (!owner) throw new Error('repo.owner missing in build.json (run clone-repo first)');
  if (!slug) throw new Error('repo.slug missing in build.json (run clone-repo first)');
  if (!bc.page?.dir) throw new Error('page.dir missing in build.json (run assemble-page first)');
  if (!fs.existsSync(path.join(pageDir, 'index.html'))) throw new Error(`page.dir has no index.html: ${pageDir}`);

  requireGh();
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN (or GH_TOKEN) not set in environment (required to create + push the explainer repo)');

  const explainerOwner = process.env.GITHUB_EXPLAINER_OWNER || 'stuinfla';
  // COLLISION-PROOF BY CONSTRUCTION: encode BOTH the source owner AND name. Two different users'
  // same-named repos (e.g. two "helix" repos) would previously BOTH map to "{name}-explainer" and
  // the second build's force-push would silently overwrite the first. "{owner}-{name}-explainer" is
  // globally unique per source repo, so a re-run updates the SAME repo (force-push is safe) and no
  // two distinct sources can ever clobber each other. (See deploy-safety-incident.)
  const repoBase = `${sanitize(owner)}-${sanitize(name || slug)}`;
  const full = `${explainerOwner}/${repoBase}-explainer`;
  const explainerRepoUrl = `https://github.com/${full}`;

  // Guard: if a repo of this exact name already exists, confirm it is genuinely OUR explainer repo for
  // THIS source (description marker) before force-pushing — never overwrite an unrelated repo.
  if (ghRepoExists(full)) {
    const expectMarker = `Explainer site for ${owner}/${name || slug}`;
    let desc = '';
    try { desc = JSON.parse(execFileSync('gh', ['api', `repos/${full}`, '--jq', '.description'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '""'); } catch { desc = ''; }
    if (desc && desc !== expectMarker) {
      throw new Error(`refusing to publish: ${full} already exists but is NOT the explainer repo for ${owner}/${name || slug} (its description is "${desc}"). This would overwrite an unrelated repo. Set GITHUB_EXPLAINER_OWNER or rename to resolve.`);
    }
    console.error(`[publish-repo] repo ${full} already exists (ours) — pushing latest site`);
  } else { ghCreateRepo(full, `Explainer site for ${owner}/${name || slug}`); console.error(`[publish-repo] created ${full} (public)`); }

  pushSite(pageDir, full, token);
  console.error(`[publish-repo] pushed site → ${explainerRepoUrl}`);

  // The collaborator invite emails a real person, so it is a DELIBERATE opt-out: set
  // EXPLAINER_SKIP_INVITE=1 to publish the hub repo without contacting the source owner.
  let ownerInvited = false;
  let inviteUrl = null;
  if (process.env.EXPLAINER_SKIP_INVITE) {
    console.error(`[publish-repo] collaborator invite SKIPPED (EXPLAINER_SKIP_INVITE set) — ${owner} not contacted`);
  } else {
    try {
      const inv = ghInvite(full, owner);
      ownerInvited = true;
      inviteUrl = inv?.html_url || `https://github.com/${full}/invitations`;
      console.error(`[publish-repo] invited ${owner} as collaborator — invite: ${inviteUrl}`);
    } catch (e) {
      console.error(`[publish-repo] WARN: collaborator invite failed (best-effort, build continues): ${e.message}`);
    }
  }

  mergeSlot(buildDir, 'publish', { explainerRepoUrl, ownerInvited });
  return { explainerRepoUrl, ownerInvited, inviteUrl, slot: 'publish' };
}

main()
  .then((outputs) => { process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n'); process.exit(0); })
  .catch((e) => { process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error: e.message || String(e) }) + '\n'); process.exit(1); });
