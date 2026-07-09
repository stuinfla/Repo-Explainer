// track.js — first-party page-view counter, so the website is no longer invisible
// (owner ask 2026-07-09). No cookies, no IPs stored, no third-party service: the landing
// page sends one beacon per view; this function keeps daily counters in Netlify Blobs.
// "New visitor" is a localStorage first-visit flag the CLIENT reports — approximate and
// privacy-clean, which is the trade we want.
//
// Known trade-off: read-modify-write can drop a count under heavy concurrency.
// Analytics-grade tolerance — trends matter here, not billing-grade precision.

const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "" };

  try {
    // Lambda-compat functions need the blob context wired from the event.
    try { connectLambda(event); } catch { /* v2 runtime wires itself */ }
    const store = getStore("traffic");

    let b = {};
    try { b = JSON.parse(event.body || "{}"); } catch { /* count the view anyway */ }

    const day = new Date().toISOString().slice(0, 10);
    const key = "daily:" + day;
    const cur = (await store.get(key, { type: "json" })) || { views: 0, newVisitors: 0, paths: {}, referrers: {} };

    cur.views += 1;
    if (b.n) cur.newVisitors += 1;

    const p = String(b.p || "/").slice(0, 80);
    cur.paths[p] = (cur.paths[p] || 0) + 1;

    const r = String(b.r || "").replace(/^https?:\/\//, "").split("/")[0].slice(0, 80);
    if (r && !r.startsWith("explainmyrepo")) cur.referrers[r] = (cur.referrers[r] || 0) + 1;

    await store.setJSON(key, cur);
  } catch (e) {
    console.error("track failed:", e && e.message);
  }
  // Always 204 — analytics must never break or slow the page.
  return { statusCode: 204, headers: cors(), body: "" };
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Cache-Control": "no-store",
  };
}
