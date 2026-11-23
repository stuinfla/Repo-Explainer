// leaderboard.js — pure aggregation for the admin "Explainer leaderboard".
// Input: the traffic blob store (track.js keeps one `daily:YYYY-MM-DD` blob per day; explainer
// beacons add per-slug counters under `sites`). Output: top-N explainers by live people for
// today / last 7 days / last 30 days / all time.
//   people = first-visit browsers (a per-slug localStorage flag), views = every page load.
// Only browsers that ran the beacon script are counted, so most robots are left out. Days before
// the beacon shipped have no `sites` data; `since` is the first day that does.

async function readLeaderboard(store, topN, now = new Date()) {
  try {
    const keys = [];
    let cursor;
    do {
      const page = await store.list({ prefix: "daily:", ...(cursor ? { cursor } : {}) });
      for (const b of page.blobs || []) keys.push(b.key);
      cursor = page.cursor;
    } while (cursor);
    keys.sort(); // oldest first; keys are daily:YYYY-MM-DD
    const days = await Promise.all(keys.map(async (k) => ({
      date: k.slice("daily:".length),
      sites: ((await store.get(k, { type: "json" })) || {}).sites || {},
    })));
    const cutoff = (n) => new Date(now.getTime() - (n - 1) * 86400000).toISOString().slice(0, 10);
    const windows = { day: cutoff(1), week: cutoff(7), month: cutoff(30), all: "0000-00-00" };
    const out = { since: null };
    for (const [name, from] of Object.entries(windows)) {
      const agg = {};
      for (const d of days) {
        if (d.date < from) continue;
        for (const [slug, s] of Object.entries(d.sites)) {
          const a = agg[slug] || (agg[slug] = { slug, people: 0, views: 0 });
          a.people += s.newVisitors || 0;
          a.views += s.views || 0;
        }
      }
      out[name] = Object.values(agg)
        .sort((a, b) => b.people - a.people || b.views - a.views || (a.slug < b.slug ? -1 : 1))
        .slice(0, topN);
    }
    const first = days.find((d) => Object.keys(d.sites).length);
    out.since = first ? first.date : null;
    return out;
  } catch (e) {
    return { unavailable: String((e && e.message) || e) };
  }
}

module.exports = { readLeaderboard };
