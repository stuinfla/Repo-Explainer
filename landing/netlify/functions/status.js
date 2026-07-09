/* =============================================================================
   GET /.netlify/functions/status?id=<buildId>&gist=<gistId>
   Reads the build's status.json from its public gist and returns it. The browser
   polls this every few seconds to show progress and, on done, the live URL.
   ========================================================================== */

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const id = q.id;
  const gist = q.gist;
  if (!id || !gist) return json(400, { error: "Missing id or gist." });

  const token = process.env.EXPLAINER_GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "explainmyrepo-bot" };
  if (token) headers.Authorization = "Bearer " + token; // 60/hr (anon) -> 5000/hr; the client polls this every 5s for up to 25min per build

  let data;
  try {
    const r = await fetch("https://api.github.com/gists/" + gist, { headers });
    if (r.status === 404) return json(404, { error: "Build not found." });
    if (!r.ok) return json(502, { error: "Couldn't read build status — try again." });
    data = await r.json();
  } catch { return json(502, { error: "Couldn't reach GitHub — try again." }); }

  const f = data.files && data.files["status.json"];
  if (!f || !f.content) return json(404, { error: "Build status missing." });

  let status;
  try { status = JSON.parse(f.content); } catch { return json(502, { error: "Build status malformed." }); }
  if (status.buildId !== id) return json(404, { error: "Build id mismatch." });
  if (data.updated_at) status.updatedAt = data.updated_at;

  return json(200, status);
};
