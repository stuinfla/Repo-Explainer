// admin-insights.js — pure, dependency-free computation behind the admin page's "is this helping
// people?" view. Kept out of admin-stats.js so it can be unit-tested with plain objects.
//
//   our score vs theirs  ·  a funnel (views -> accepted -> built -> rated)  ·  owner test builds
//   separated from real ones  ·  a plain-English summary  ·  what the next build is told (lessons)

const OWNER_TAG = " [owner-test]";           // appended to the status-gist description by build.js
const WINDOW_DAYS = 14;

// Same mapping the build-time lessons use (tools/feedback-lessons.mjs classify): the one-tap
// verdict wins; older ratings fall back to the numeric score (85 / 55).
function classify(r) {
  const v = r.verdict;
  if (v === "nailed" || v === "close" || v === "missed") return v;
  if (r.score == null || !Number.isFinite(r.score)) return null;
  return r.score >= 85 ? "nailed" : r.score >= 55 ? "close" : "missed";
}
// A one-tap verdict has no number; this is the same midpoint the rate page's slider uses.
const VERDICT_SCORE = { nailed: 92, close: 70, missed: 35 };

// Reader comments are untrusted text that this page renders (it always escapes) and that the
// builder reads (it sanitizes with the same rules in tools/feedback-lessons.mjs). Cap here too.
function clean(t) {
  return String(t || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function isTestRating(r) {
  return /^selftest\//i.test(String(r.repo || ""));
}

function parseRepo(description) {
  const raw = String(description || "").replace("explainmyrepo build: ", "");
  const owner = raw.endsWith(OWNER_TAG);
  return { repo: owner ? raw.slice(0, -OWNER_TAG.length) : raw, ownerTest: owner };
}

function mean(xs) {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

function buildInsights({ builds, ratings, traffic, doors, ledger, ownerEmails, now }) {
  const nowMs = (now ? new Date(now) : new Date()).getTime();
  const since = nowMs - WINDOW_DAYS * 86400000;
  const inWindow = (iso) => iso && new Date(iso).getTime() >= since;

  const real = builds.filter((b) => !b.ownerTest);
  const test = builds.filter((b) => b.ownerTest);

  // The ledger counts every build per email, including ours; builds made before the marker
  // existed cannot be told apart, so say how many are probably unmarked instead of guessing which.
  const owners = new Set((ownerEmails || []).map((e) => e.toLowerCase()));
  const ledgerOwnerBuilds = Object.entries(ledger || {})
    .filter(([email]) => owners.has(email.toLowerCase()))
    .reduce((a, [, v]) => a + (v.count || 0), 0);
  const unmarkedOwnerEstimate = Math.max(0, ledgerOwnerBuilds - test.length);

  const reader = (ratings || []).filter((r) => !isTestRating(r)).map((r) => ({ ...r, kind: classify(r) })).filter((r) => r.kind);
  const tally = { nailed: 0, close: 0, missed: 0 };
  for (const r of reader) tally[r.kind]++;

  // Our score vs theirs, per page: our synthesized score against the reader's verdict.
  const compared = [];
  for (const r of reader) {
    const b = real.find((x) => r.buildId && x.buildId && x.buildId === r.buildId) || real.find((x) => x.repo && x.repo === r.repo);
    const ours = b && b.grades ? b.grades.overall : null;
    compared.push({
      repo: r.repo || (b && b.repo) || "unknown",
      ours,
      theirs: r.score != null ? r.score : VERDICT_SCORE[r.kind],
      verdict: r.kind,
      comment: clean(r.thoughts) || null,
      at: r.at,
      matched: !!b,
    });
  }
  const withOurs = compared.filter((c) => c.ours != null);
  const ourMean = mean(withOurs.map((c) => c.ours));
  const theirMean = mean(withOurs.map((c) => c.theirs));
  const gap = ourMean != null && theirMean != null ? ourMean - theirMean : null;

  // Funnel over the last 14 days.
  const siteDays = Array.isArray(traffic) ? traffic : [];
  const views = siteDays.reduce((a, t) => a + (t.views || 0), 0);
  const accepted = Object.entries(doors || {})
    .filter(([day]) => new Date(day + "T23:59:59Z").getTime() >= since)
    .reduce((a, [, v]) => a + ((v && v.accepted) || 0), 0);
  const built = real.filter((b) => b.status === "done" && inWindow(b.createdAt)).length;
  const rated = reader.filter((r) => inWindow(r.at)).length;
  const funnel = [
    { key: "views", label: "Visited the site", n: views },
    { key: "accepted", label: "Asked for a page (accepted)", n: accepted },
    { key: "built", label: "Got a finished page", n: built },
    { key: "rated", label: "Told us how it went", n: rated },
  ];

  // What the next build is told (mirrors tools/feedback-lessons.mjs: negatives with comments
  // first, newest first, capped).
  const byRecent = (a, b) => String(b.at).localeCompare(String(a.at));
  const learned = {
    fix: reader.filter((r) => r.thoughts && (r.kind === "close" || r.kind === "missed")).sort(byRecent).slice(0, 8)
      .map((r) => ({ repo: r.repo || "?", verdict: r.kind, text: clean(r.thoughts) })).filter((l) => l.text),
    keep: reader.filter((r) => r.thoughts && r.kind === "nailed").sort(byRecent).slice(0, 3)
      .map((r) => ({ repo: r.repo || "?", verdict: r.kind, text: clean(r.thoughts) })).filter((l) => l.text),
  };

  // Plain English, no jargon.
  const lines = [];
  lines.push(built + " finished page" + (built === 1 ? "" : "s") + " in the last " + WINDOW_DAYS + " days"
    + (views ? ", from " + views + " site visit" + (views === 1 ? "" : "s") : "")
    + (unmarkedOwnerEstimate > 0 ? " (some of these are your own older test builds, which could not be tagged after the fact: about " + unmarkedOwnerEstimate + " in all time)" : "") + ".");
  if (reader.length) {
    lines.push(reader.length + " reader" + (reader.length === 1 ? " has" : "s have") + " rated a page: "
      + tally.nailed + " nailed it, " + tally.close + " close, " + tally.missed + " missed.");
  } else {
    lines.push("No reader has rated a page yet.");
  }
  if (gap != null && withOurs.length >= 2) {
    lines.push("Our own grader averages " + ourMean + " on those pages; readers imply about " + theirMean + "."
      + (gap >= 15 ? " The grader is more generous than readers: trust readers." : gap <= -15 ? " Readers like pages more than our grader does." : " They roughly agree."));
  } else if (withOurs.length === 1) {
    lines.push("Only one rated page has a grader score to compare with, so no agreement figure yet.");
  }
  if (learned.fix.length) lines.push(learned.fix.length + " reader complaint" + (learned.fix.length === 1 ? " is" : "s are") + " being passed to every new build.");
  if (built > 0 && rated === 0) lines.push("Nobody rated in this window: the email ask is optional, so low volume is normal.");

  return {
    windowDays: WINDOW_DAYS,
    summary: lines,
    funnel,
    ratings: { total: reader.length, tally, compared: compared.sort(byRecent), ourMean, theirMean, gap },
    learned,
    owner: { markedTestBuilds: test.length, ledgerBuilds: ledgerOwnerBuilds, unmarkedEstimate: unmarkedOwnerEstimate },
    realBuilds: real.length,
  };
}

module.exports = { buildInsights, classify, parseRepo, clean, OWNER_TAG, VERDICT_SCORE };
