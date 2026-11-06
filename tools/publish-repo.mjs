#!/usr/bin/env node
// publish-repo.mjs — Station 8 tool #11: create the dedicated explainer GitHub repo + ship the site.
//
// CONTRACT (tools/CONTRACT.md): node tools/publish-repo.mjs <build-dir>
//   Reads (declared inputs):  repo.owner, repo.name, repo.slug, page.dir   (+ GitHub token from env)
//   Writes (own slot only):   publish.explainerRepoUrl, publish.ownerInvited
//   stdout = ONE JSON result object; diagnostics → stderr; exit 0 iff ok:true, else non-zero.
//
// Creates  {GITHUB_EXPLAINER_OWNER|stuinfla}/{source-owner}-{source-name}-explainer  (public; owner--name when either part is not plain alphanumeric) via `gh`,
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
import { pathToFileURL } from 'node:url';

import { readContext, mergeSlot } from '../src/build-context.mjs';

const sanitize = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
/**
 * Explainer repo names for a source. GitHub owners never contain '--' and repo names are [A-Za-z0-9._-], so
 * `${owner}--${name}` is injective ('foo-bar/baz' and 'foo/bar-baz' differ). The pre-3.0.1 name
 * `${sanitized owner}-${sanitized name}` is not injective, so it is `primary` ONLY when both parts are plain
 * alphanumerics (then it is injective and unchanged). A hyphenated or dotted source gets the `--` name;
 * `legacy` (the old name) is still consulted, and a topic-only legacy repo STOPS the build (resolveTarget).
 */
export function explainerRepoNames(owner, name) {
  const legacy = `${sanitize(owner)}-${sanitize(name)}`;
  const plain = /^[a-z0-9]+$/i.test(owner) && /^[a-z0-9]+$/i.test(name);
  const enc = (v) => String(v).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  return { primary: plain ? legacy : `${enc(owner)}--${enc(name)}`, legacy };
}

export const MARKER_FILE = '.explainmyrepo.json';
const errText = (e) => (e.stderr ? e.stderr.toString() : '') || e.message || String(e);

function requireGh() {
  try { execFileSync('gh', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] }); }
  catch { throw new Error("GitHub CLI 'gh' not found in PATH (required to publish the explainer repo)"); }
}

const ghRun = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const isNotFound = (msg) => /Not Found|HTTP 404|\b404\b/.test(msg);

/**
 * Ownership of an existing explainer repo, or null if it does not exist. The marker is a FILE in the repo
 * (MARKER_FILE) because repo-seo rewrites the description and topics on every build, so neither can carry it.
 * `gh` is injectable for tests: (args) => stdout string, throwing an error with .stderr on failure.
 */
export function inspectRepo(full, gh = ghRun) {
  let repo;
  try { repo = JSON.parse(gh(['api', `repos/${full}`])); }
  catch (e) {
    const msg = errText(e);
    if (isNotFound(msg)) return null;
    throw new Error(`gh api repos/${full} failed: ${msg.slice(0, 200)}`);
  }
  let marker = null;
  try {
    const f = JSON.parse(gh(['api', `repos/${full}/contents/${MARKER_FILE}`]));
    marker = JSON.parse(Buffer.from(String(f.content || ''), 'base64').toString('utf8'));
  } catch (e) {
    const msg = errText(e);
    if (!isNotFound(msg) && !(e instanceof SyntaxError)) throw new Error(`gh api repos/${full}/contents/${MARKER_FILE} failed: ${msg.slice(0, 200)}`);
  }
  return { description: repo.description || '', topics: repo.topics || [], marker };
}

/**
 * May we force-push over this repo? A marker file naming THIS source is proof. A marker naming another
 * source refuses. No marker = a repo built before markers existed: accept the exact description marker; the
 * 'explainer' topic alone is accepted only when the NAME is injective for this source (`injective`), else it
 * needs the operator's PUBLISH_CLAIM_LEGACY=1 (`claimLegacy`), because another source may map to that name.
 */
export function decideOverwrite(info, source, { injective = true, claimLegacy = false } = {}) {
  const want = String(source).toLowerCase();
  if (info.marker && info.marker.source) {
    return String(info.marker.source).toLowerCase() === want
      ? { ok: true }
      : { ok: false, reason: `its ${MARKER_FILE} says it belongs to ${info.marker.source}` };
  }
  if (info.description === `Explainer site for ${source}`) return { ok: true };
  if (info.topics.includes('explainer') && (injective || claimLegacy)) return { ok: true };
  return { ok: false, reason: `it has no ${MARKER_FILE} and does not look like an explainer repo (description "${info.description}")` };
}

/** The ownership marker pushed with every site: what decideOverwrite reads back next build. */
export function writeMarker(dir, source) {
  fs.writeFileSync(path.join(dir, MARKER_FILE), JSON.stringify({ tool: 'explainmyrepo', source }) + '\n');
}

export const redactToken = (s, token) => (token ? String(s).split(token).join('***') : String(s));

function ghCreateRepo(full, description) {
  try { execFileSync('gh', ['repo', 'create', full, '--public', '--description', description], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error(`gh repo create ${full} failed: ${errText(e).slice(0, 300)}`); }
}
function pushSite(pageDir, full, token, source) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-push-'));
  try {
    fs.cpSync(pageDir, stage, { recursive: true });
    writeMarker(stage, source);
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
    throw new Error(`git push to ${full} failed: ${redactToken(errText(e), token).slice(0, 300)}`);
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

/**
 * Which repo do we publish to? Never force-push over a repo that is not this source's explainer
 * (inspectRepo / decideOverwrite). The old non-injective name is consulted second, only to keep updating an
 * already-published repo. A topic-only legacy repo (no marker) is NOT silently abandoned: creating a second
 * public repo and a second collaborator invite is worse than stopping, so we stop and name the override.
 * `inspect` is injectable for tests: (fullName) => info | null.
 */
export function resolveTarget({ explainerOwner, source, primary, legacy, claimLegacy = false, inspect = inspectRepo }) {
  for (const [i, base] of (primary === legacy ? [primary] : [primary, legacy]).entries()) {
    const cand = `${explainerOwner}/${base}-explainer`;
    const info = inspect(cand);
    if (!info) continue;
    const v = decideOverwrite(info, source, { injective: i === 0, claimLegacy });
    if (v.ok) return { full: cand, exists: true };
    if (i === 0) throw new Error(`refusing to publish: ${cand} already exists but is NOT the explainer repo for ${source} (${v.reason}). This would overwrite an unrelated repo. Set GITHUB_EXPLAINER_OWNER or rename to resolve.`);
    if (!info.marker && info.topics.includes('explainer')) throw new Error(`refusing to publish: ${cand} looks like an older explainer repo (topic only, no ${MARKER_FILE}) but may belong to a different source with the same sanitized name, and publishing would create a SECOND public repo. If ${cand} is the explainer for ${source}, re-run with PUBLISH_CLAIM_LEGACY=1.`);
  }
  return { full: `${explainerOwner}/${primary}-explainer`, exists: false };
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
  const source = `${owner}/${name || slug}`;
  const { primary, legacy } = explainerRepoNames(owner, name || slug);
  const claimLegacy = process.env.PUBLISH_CLAIM_LEGACY === '1';
  const { full, exists } = resolveTarget({ explainerOwner, source, primary, legacy, claimLegacy });
  const explainerRepoUrl = `https://github.com/${full}`;
  if (exists) console.error(`[publish-repo] repo ${full} already exists (ours) — pushing latest site`);
  else { ghCreateRepo(full, `Explainer site for ${source}`); console.error(`[publish-repo] created ${full} (public)`); }

  pushSite(pageDir, full, token, source);
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

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main()
  .then((outputs) => { process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n'); process.exit(0); })
  .catch((e) => { process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error: e.message || String(e) }) + '\n'); process.exit(1); });
