// admin-stats.js — owner-only intelligence aggregate for explainmyrepo:
// monthly meter · every build ever attempted (with GRADES + cost where recorded) · the email
// ledger · door tallies (accepted vs private vs unreachable) · website traffic (first-party
// blobs) · GitHub stars/forks/traffic · npm downloads with daily trend · day-over-day deltas.
//
// Auth: requires the ADMIN_KEY env var to be set in Netlify, and the same value passed as
// the `x-admin-key` header (or ?key=). No key configured → everything refused (fail closed):
// the ledger holds real user emails (PII) and must never be readable from an open endpoint.

const { getStore, connectLambda } = require("@netlify/blobs");
const crypto = require("node:crypto");

const REPO = "stuinfla/Repo-Explainer";
const SITE_ID = "df4e3cd8-a71e-4668-8da7-c8d168edd341";
const FEEDBACK_FORM_ID = "6a456c9b29c67900095b060f";

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, x-admin-key",
    },
    body: JSON.stringify(body),
  };
}

function gh(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "User-Agent": "explainmyrepo-bot",
  };
}

async function readGist(token, gistId, file) {
  try {
    const r = await fetch("https://api.github.com/gists/" + gistId, { headers: gh(token) });
    if (!r.ok) return null;
    const data = await r.json();
    const f = data.files && data.files[file];
    if (!f || !f.content) return {};
    return JSON.parse(f.content);
  } catch { return null; }
}

// Compact a runner scorecard (result.scorecard in the status gist) into admin-friendly grades.
// "overall" = mean of every axis on both devices (the synthesized 1-100 the owner asked for);
// "headline" = the WORST axis (the gate's own anti-slop headline number).
function grades(sc) {
  if (!sc || !Array.isArray(sc.devices) || !sc.devices.length) return null;
  const axes = [];
  const perDevice = {};
  for (const d of sc.devices) {
    const vals = [...Object.values(d.gateA || {}), ...Object.values(d.gateB || {})].filter((v) => typeof v === "number");
    axes.push(...vals);
    perDevice[(d.device || "?").toLowerCase().includes("mobile") ? "mobile" : "desktop"] = {
      headline: d.headline ?? null,
      mean: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    };
  }
  return {
    overall: axes.length ? Math.round(axes.reduce((a, b) => a + b, 0) / axes.length) : null,
    headline: axes.length ? Math.min(...axes) : null,
    passed: !!sc.passed,
    exemplary: !!sc.exemplary,
    iterations: sc.iterations ?? null,
    perDevice,
  };
}

// Every hosted build creates one public gist "explainmyrepo build: owner/name" holding
// status.json — the list of those gists IS the complete build history. Contents come from
// raw_url (gist.githubusercontent.com), which doesn't spend API rate limit.
async function listBuilds(token) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, { headers: gh(token) });
    if (!r.ok) break;
    const gists = await r.json();
    if (!gists.length) break;
    for (const g of gists) {
      if (!(g.description || "").startsWith("explainmyrepo build:")) continue;
      out.push(g);
    }
    if (gists.length < 100) break;
  }
  const builds = await Promise.all(out.map(async (g) => {
    const base = {
      repo: (g.description || "").replace("explainmyrepo build: ", ""),
      createdAt: g.created_at,
      updatedAt: g.updated_at,
      gistUrl: g.html_url,
      status: "unknown",
      liveUrl: null,
      costUsd: null,
      grades: null,
      error: null,
    };
    try {
      const f = g.files && g.files["status.json"];
      if (!f || !f.raw_url) return base;
      const s = await (await fetch(f.raw_url)).json();
      base.status = s.status || "unknown";
      base.liveUrl = (s.result && s.result.liveUrl) || null;
      base.costUsd = (s.result && s.result.costUsd) ?? null;
      base.grades = grades(s.result && s.result.scorecard);
      // WHY it failed — the whole point of this table (owner, 2026-07-10: a wall of red "failed"
      // chips with no reason reads as an active outage even when it's resolved history).
      // internalReason (owner-only, added same day) is the real cause; the public `error` on
      // the submitter's own status page is deliberately generic — prefer the real one here.
      base.error = s.internalReason || s.error || null;
      return base;
    } catch { return base; }
  }));
  builds.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return builds;
}

// The landing page's own feedback form (Netlify Forms, "How clearly did it land?" 1-5 + free
// text) — needs a Netlify Personal Access Token (Netlify user settings -> Applications -> New
// access token), NOT the GitHub token. Degrades honestly, never throws, if unset/expired.
async function readSiteFeedback() {
  const npat = process.env.NETLIFY_API_TOKEN;
  if (!npat) return { configured: false, submissions: [] };
  try {
    const r = await fetch(`https://api.netlify.com/api/v1/forms/${FEEDBACK_FORM_ID}/submissions`, {
      headers: { Authorization: `Bearer ${npat}` },
    });
    if (!r.ok) return { configured: false, submissions: [], error: `Netlify API ${r.status} — token may be expired` };
    const rows = await r.json();
    return {
      configured: true,
      submissions: rows.map((s) => ({
        clarity: s.data?.clarity ? Number(s.data.clarity) : null,
        thoughts: s.data?.thoughts || null,
        email: s.data?.email || null,
        at: s.created_at,
      })).sort((a, b) => (a.at < b.at ? 1 : -1)),
    };
  } catch (e) {
    return { configured: false, submissions: [], error: String(e && e.message || e) };
  }
}

// Last N days of first-party page views from the traffic blob store (written by track.js).
async function readTraffic(days) {
  try {
    const store = getStore("traffic");
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const v = await store.get("daily:" + d, { type: "json" });
      out.push({ date: d, views: v?.views || 0, newVisitors: v?.newVisitors || 0, referrers: v?.referrers || {} });
    }
    return out; // newest first
  } catch (e) {
    return { unavailable: String(e && e.message || e) };
  }
}

const delta = (today, yesterday) => ({
  today, yesterday,
  trend: today > yesterday ? "up" : today < yesterday ? "down" : "flat",
});

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return json(204, {});

  const token = process.env.EXPLAINER_GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return json(500, { error: "Server misconfigured: missing EXPLAINER_GH_TOKEN." });

  // The password lives as a SALTED SHA-256 HASH in admin.json inside the secret counter gist
  // (the Netlify MCP env-var write reported success but persisted nothing — 2026-07-10 — so the
  // credential rides infrastructure this function already reads). ADMIN_KEY env still wins if
  // someone sets it later. Header only — a ?key= fallback would leak into logs/history.
  // timingSafeEqual closes the timing side channel (per security review).
  const given = (event.headers && (event.headers["x-admin-key"] || event.headers["X-Admin-Key"])) || "";
  let pass = false;
  if (process.env.ADMIN_KEY) {
    const a = Buffer.from(String(given));
    const b = Buffer.from(String(process.env.ADMIN_KEY));
    pass = a.length === b.length && crypto.timingSafeEqual(a, b);
  } else {
    const counterGist = process.env.GLOBAL_COUNTER_GIST_ID;
    const cfg = counterGist ? await readGist(token, counterGist, "admin.json") : null;
    if (!cfg || !cfg.salt || !cfg.hash) return json(503, { error: "Admin access is not configured — the admin API stays closed until it is." });
    const h = crypto.createHash("sha256").update(cfg.salt + String(given)).digest("hex");
    const a = Buffer.from(h);
    const b = Buffer.from(String(cfg.hash));
    pass = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!pass) return json(401, { error: "Wrong or missing admin key." });

  try { connectLambda(event); } catch { /* v2 runtime wires itself */ }

  const ledgerId = process.env.EMAIL_LEDGER_GIST_ID;
  const counterId = process.env.GLOBAL_COUNTER_GIST_ID;

  const [ledger, counter, doors, builds, traffic, feedback, repoResp, viewsResp, clonesResp, npmRange] = await Promise.all([
    ledgerId ? readGist(token, ledgerId, "ledger.json") : null,
    counterId ? readGist(token, counterId, "counter.json") : null,
    counterId ? readGist(token, counterId, "doors.json") : null,
    listBuilds(token),
    readTraffic(14),
    readSiteFeedback(),
    fetch(`https://api.github.com/repos/${REPO}`, { headers: gh(token) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`https://api.github.com/repos/${REPO}/traffic/views`, { headers: gh(token) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`https://api.github.com/repos/${REPO}/traffic/clones`, { headers: gh(token) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("https://api.npmjs.org/downloads/range/last-month/explainmyrepo").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const people = Object.entries(ledger || {}).map(([email, v]) => ({
    email, count: v.count || 0, first: v.first || null, last: v.last || null, lastRepo: v.lastRepo || null,
  })).sort((a, b) => (a.last < b.last ? 1 : -1));

  const done = builds.filter((b) => b.status === "done");
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const byDay = (arr, day) => arr.filter((b) => (b.createdAt || "").slice(0, 10) === day).length;

  // Quality trend the owner asked for: rolling average of the synthesized score, last 5 graded
  // pages vs the 5 before them → is the factory getting better, worse, or the same?
  const graded = builds.filter((b) => b.grades && b.grades.overall != null); // newest first
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const last5 = avg(graded.slice(0, 5).map((b) => b.grades.overall));
  const prev5 = avg(graded.slice(5, 10).map((b) => b.grades.overall));

  const npmDaily = npmRange && Array.isArray(npmRange.downloads) ? npmRange.downloads : [];
  const npmByDay = Object.fromEntries(npmDaily.map((d) => [d.day, d.downloads]));

  const trafficArr = Array.isArray(traffic) ? traffic : [];
  const tToday = trafficArr.find((t) => t.date === today) || { views: 0, newVisitors: 0 };
  const tYest = trafficArr.find((t) => t.date === yesterday) || { views: 0, newVisitors: 0 };

  // The single most important line on this page: is the hosted door doing anything RIGHT NOW,
  // or is everything below history? (owner, 2026-07-10: a wall of "failed" chips read as an
  // active outage when the door had been paused for hours — nothing here explained that.)
  const newestBuild = builds[0] || null;
  const doorStatus = {
    paused: !!(counter && counter.pausedForCredits),
    pausedReason: counter && counter.pausedForCredits ? "Anthropic API credit balance ran out — paused until topped up." : null,
    mostRecentAttempt: newestBuild ? { repo: newestBuild.repo, status: newestBuild.status, at: newestBuild.createdAt } : null,
  };

  return json(200, {
    generatedAt: new Date().toISOString(),
    doorStatus,
    feedback,
    meter: counter || null,
    totals: {
      buildAttempts: builds.length,
      pagesLive: done.length,
      distinctRepos: new Set(builds.map((b) => b.repo.toLowerCase())).size,
      people: people.length,
    },
    deltas: {
      siteViews: delta(tToday.views, tYest.views),
      newVisitors: delta(tToday.newVisitors, tYest.newVisitors),
      builds: delta(byDay(builds, today), byDay(builds, yesterday)),
      npmDownloads: delta(npmByDay[today] ?? 0, npmByDay[yesterday] ?? 0),
    },
    quality: {
      gradedPages: graded.length,
      avgLast5: last5,
      avgPrev5: prev5,
      // Chronological series for the admin chart (owner ask 2026-07-15: "the quality should be
      // a graph that shows me the totals over time", not a two-number sentence).
      series: graded.slice().reverse().map((b) => ({ at: (b.createdAt || "").slice(0, 10), repo: b.repo, overall: b.grades.overall })),
      trend: last5 == null || prev5 == null ? "not enough graded builds yet" : last5 > prev5 ? "better" : last5 < prev5 ? "worse" : "same",
      note: graded.length === 0 ? "Grades attach to each build's status record from v0.2.5 onward — older builds predate score persistence." : null,
    },
    doors: doors || {},
    traffic: {
      site: Array.isArray(traffic) ? traffic : null,
      siteUnavailable: Array.isArray(traffic) ? null : traffic.unavailable,
      repoViews14d: viewsResp ? { total: viewsResp.count, uniques: viewsResp.uniques } : null,
      repoClones14d: clonesResp ? { total: clonesResp.count, uniques: clonesResp.uniques, caveat: "includes our own CI checkouts — every hosted build clones this repo" } : null,
    },
    npm: {
      lastWeek: npmDaily.slice(-7).reduce((a, d) => a + d.downloads, 0) || null,
      lastMonth: npmDaily.reduce((a, d) => a + d.downloads, 0) || null,
      daily: npmDaily.slice(-14),
    },
    people,
    builds,
    repo: repoResp ? {
      stars: repoResp.stargazers_count, forks: repoResp.forks_count,
      watchers: repoResp.subscribers_count, openIssues: repoResp.open_issues_count,
    } : null,
  });
};
