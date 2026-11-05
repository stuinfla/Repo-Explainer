// src/overview-block.mjs — the narrated-overview band in the page. ONE definition, used by make-overview (first
// injection) and assemble-page (re-injection after any re-assemble, so a refine or resume cannot drop the video).
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function overviewBlock({ name, url, secs, infographicPath = null }) {
  return `<section class="overview-band" data-overview aria-label="A ${secs}-second narrated overview of ${esc(name)}">
    <div class="wrap"><figure class="overview-fig">
      <video controls preload="metadata" playsinline poster="assets/overview-poster.jpg" width="1280" height="720"><source src="assets/overview.mp4" type="video/mp4">Your browser can't play this video. <a href="assets/overview.mp4" target="_blank" rel="noopener">Open the ${secs}-second overview</a>.</video>
      <figcaption>The ${secs}-second narrated overview, made with Google NotebookLM from the repo. It is a machine-made summary, so treat the sections below and <a href="${esc(url)}" target="_blank" rel="noopener">the repo</a> as the source of truth.</figcaption>
    </figure>${infographicPath ? `
    <figure class="overview-fig"><img src="${esc(infographicPath)}" alt="Infographic summarising how ${esc(name)} works" loading="lazy" style="width:100%;height:auto;border-radius:18px;margin-top:18px"></figure>` : ''}</div>
  </section>
  <style>.overview-band{padding:0 0 28px}.overview-fig{margin:0}.overview-fig video{display:block;width:100%;height:auto;border-radius:18px;background:#000}.overview-fig figcaption{font-size:.95rem;margin-top:10px;opacity:.8}</style>
  `;
}

// Idempotent: a page that already carries the band is returned unchanged. injected=false + reason when it cannot be placed.
export function injectOverview(html, opts) {
  if (/data-overview/.test(html)) return { html, injected: false, reason: 'already present' };
  const anchor = html.indexOf('<div class="sections">');
  if (anchor === -1) return { html, injected: false, reason: 'no <div class="sections"> anchor' };
  return { html: html.slice(0, anchor) + overviewBlock(opts) + html.slice(anchor), injected: true };
}
