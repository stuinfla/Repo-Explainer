#!/usr/bin/env node
// repo-seo.mjs — Station 8 tool #12: make the explainer repo discoverable + suggest source-repo SEO.
//
// CONTRACT (tools/CONTRACT.md): node tools/repo-seo.mjs <build-dir>
//   Reads (declared inputs):  publish.explainerRepoUrl, concept, understanding.summary (+ GitHub token)
//   Writes (own slot only):   publish.repoTopics, publish.repoDescription, publish.sourceRepoSeoSuggested
//   stdout = ONE JSON result object; diagnostics → stderr; exit 0 iff ok:true, else non-zero.
//
// Sets GitHub TOPICS + a strong description on the EXPLAINER repo via the GitHub API (GitHub is the
// new AI-world social media). Topics/description are derived MECHANICALLY from the brain-authored
// concept + understanding.summary — the tool never invents judgement. For the SOURCE repo it only
// EMITS suggestions (offered, never set — INV-16).
//
// FAIL LOUD: a missing input, a failed API write, or a write that does not persist (verified by a
// read-back) is a non-zero exit with a clear message — never a silent green.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readContext, mergeSlot } from '../src/build-context.mjs';

const STOP = new Set(('the a an and or of to in for with on is are be this that it its as by from into how what why your you our we their they them use uses using via not no yes can will built make makes new one two repo repository project code library tool app site web page based simple easy fast just like more most all any each other than then over under between'.split(' ')));

const errText = (e) => (e.stderr ? e.stderr.toString() : '') || e.message || String(e);

function requireGh() {
  try { execFileSync('gh', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] }); }
  catch { throw new Error("GitHub CLI 'gh' not found in PATH (required to set explainer-repo SEO)"); }
}
export function parseRepoUrl(url) {
  const m = String(url).match(/github\.com[/:]([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`cannot parse owner/repo from publish.explainerRepoUrl: ${url}`);
  return { owner: m[1], repo: m[2] };
}

// ---- mechanical topic / description derivation ----
const toTopic = (w) => w.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
function keywords(text, limit) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/[^A-Za-z0-9]+/)) {
    const t = toTopic(raw);
    if (t.length < 3 || STOP.has(t) || /^\d+$/.test(t) || seen.has(t)) continue;
    seen.add(t); out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}
function buildTopics(concept, summary, baseSlug, { source }) {
  const base = source ? [] : ['explainer', 'documentation', 'knowledge-base'];
  const slug = source ? [] : keywords(baseSlug, 2);
  const metaphor = keywords(concept?.metaphor, 2);
  const tagline = keywords(concept?.tagline, 4);
  const fromSummary = keywords(summary, 10);
  const seen = new Set();
  const out = [];
  for (const t of [...base, ...slug, ...metaphor, ...tagline, ...fromSummary]) {
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    if (out.length >= 20) break;   // GitHub caps topics at 20
  }
  if (!out.length) throw new Error('could not derive any valid topics from concept + understanding.summary');
  return out;
}
const clamp = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
function buildDescription(concept, summary) {
  const tag = concept?.tagline ? `${String(concept.tagline).trim()} — ` : '';
  const d = clamp(`${tag}${summary}`, 350);   // GitHub repo description practical cap
  if (!d) throw new Error('could not derive a repo description from concept.tagline + understanding.summary');
  return d;
}

// ---- GitHub API via gh ----
function ghSetDescription(owner, repo, description) {
  try { execFileSync('gh', ['api', '-X', 'PATCH', `repos/${owner}/${repo}`, '-f', `description=${description}`], { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) { throw new Error(`set description on ${owner}/${repo} failed: ${errText(e).slice(0, 200)}`); }
}
function ghSetTopics(owner, repo, topics) {
  try { execFileSync('gh', ['api', '-X', 'PUT', `repos/${owner}/${repo}/topics`, '--input', '-'], { input: JSON.stringify({ names: topics }), stdio: ['pipe', 'ignore', 'pipe'] }); }
  catch (e) { throw new Error(`set topics on ${owner}/${repo} failed: ${errText(e).slice(0, 200)}`); }
}
function ghGetTopics(owner, repo) {
  try { return JSON.parse(execFileSync('gh', ['api', `repos/${owner}/${repo}/topics`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).names || []; }
  catch (e) { throw new Error(`read-back of topics on ${owner}/${repo} failed: ${errText(e).slice(0, 200)}`); }
}
function ghGetDescription(owner, repo) {
  try { return execFileSync('gh', ['api', `repos/${owner}/${repo}`, '--jq', '.description // ""'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (e) { throw new Error(`read-back of description on ${owner}/${repo} failed: ${errText(e).slice(0, 200)}`); }
}

async function main() {
  const buildDir = process.argv[2];
  if (!buildDir) throw new Error('usage: node tools/repo-seo.mjs <build-dir>');

  const bc = readContext(buildDir);
  const explainerRepoUrl = bc.publish?.explainerRepoUrl;
  if (!explainerRepoUrl) throw new Error('publish.explainerRepoUrl missing in build.json (run publish-repo first)');
  const concept = bc.concept || {};
  const summary = bc.understanding?.summary;
  if (!summary) throw new Error('understanding.summary missing in build.json (run build-kb first)');

  requireGh();
  if (!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)) throw new Error('GITHUB_TOKEN (or GH_TOKEN) not set in environment (required to set explainer-repo SEO)');

  const { owner, repo } = parseRepoUrl(explainerRepoUrl);
  const topics = buildTopics(concept, summary, repo.replace(/-explainer$/, ''), { source: false });
  const description = buildDescription(concept, summary);

  ghSetDescription(owner, repo, description);
  ghSetTopics(owner, repo, topics);
  console.error(`[repo-seo] set ${topics.length} topics + description on ${owner}/${repo}`);

  // verify the writes actually persisted (fail loud, never a silent green)
  const repoTopics = ghGetTopics(owner, repo);
  const repoDescription = ghGetDescription(owner, repo);
  if (!repoTopics.length) throw new Error(`topics did not persist on ${owner}/${repo} (GitHub API read-back returned none)`);
  if (!repoDescription) throw new Error(`description did not persist on ${owner}/${repo} (GitHub API read-back returned empty)`);

  // SUGGESTED only for the SOURCE repo (offered, never set — INV-16)
  const sourceRepoSeoSuggested = {
    topics: buildTopics(concept, summary, '', { source: true }),
    description: clamp(summary, 350),
  };

  mergeSlot(buildDir, 'publish', { repoTopics, repoDescription, sourceRepoSeoSuggested });
  return { repoTopics, repoDescription, sourceRepoSeoSuggested, slot: 'publish' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main()
  .then((outputs) => { process.stdout.write(JSON.stringify({ ok: true, outputs, error: null }) + '\n'); process.exit(0); })
  .catch((e) => { process.stdout.write(JSON.stringify({ ok: false, outputs: {}, error: e.message || String(e) }) + '\n'); process.exit(1); });
