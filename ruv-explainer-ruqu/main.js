/* =============================================================================
   ruqu ExplainerSite — main.js
   Progressive enhancement only. The page is fully usable with JS disabled:
   every section and gallery item is a native <details>/<summary>, so they
   open/close on their own. This script adds:
     1. deep-link: open the <details> a #hash points at, and on nav-click.
     2. live provenance: best-effort fetch of /kb/.last-built.json to refresh
        the "Updated … · source @sha" line if a real build manifest is present.
        Silent no-op if the file is absent (the static fallback already shows
        the build this page was authored against).
   No dependencies. No build step.
   ========================================================================== */
(function () {
  "use strict";

  /* --- 1. Deep-link a section open ---------------------------------------- */
  function openFromHash() {
    var id = (location.hash || "").replace(/^#/, "");
    if (!id) return;
    var el = document.getElementById(id);
    while (el && el.tagName !== "DETAILS") el = el.parentElement; // walk up to the <details>
    if (el && !el.open) el.open = true;
  }
  window.addEventListener("hashchange", openFromHash);
  openFromHash();

  // Clicking an in-page nav link should also expand its target section.
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function () {
      var id = a.getAttribute("href").slice(1);
      var sec = document.getElementById(id);
      while (sec && sec.tagName !== "DETAILS") sec = sec.parentElement;
      if (sec && !sec.open) sec.open = true;
    });
  });

  /* --- 2. Live provenance (best-effort, optional) -------------------------- */
  // If a real build manifest ships at /kb/.last-built.json, update the provenance
  // line so a visitor can verify they're looking at the current build. Absent =>
  // keep the authored static line. Never throws on the page.
  fetch("/kb/.last-built.json", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (m) {
      if (!m) return;
      // Sanitize: keep only safe chars (hex sha, ISO date, version string).
      var sha = (m.sha || m.head || "").toString().replace(/[^0-9a-fA-F]/g, "").slice(0, 7);
      var date = (m.date || m.builtAt || "").toString().replace(/[^0-9-]/g, "").slice(0, 10);
      var version = (m.version || "").toString().replace(/[^0-9A-Za-z.\-_ ]/g, "").slice(0, 40);
      if (!sha && !date) return;
      var live = document.querySelector(".prov-live");
      if (!live) return;

      // Build the line with safe DOM nodes only (no innerHTML, no markup injection).
      while (live.firstChild) live.removeChild(live.firstChild);
      var dot = document.createElement("span");
      dot.className = "prov-dot";
      dot.setAttribute("aria-hidden", "true");
      dot.textContent = "●";
      live.appendChild(dot);

      var parts = [];
      if (date) parts.push(document.createTextNode(" Updated " + date));
      if (sha) {
        if (parts.length) parts.push(document.createTextNode(" · source "));
        else parts.push(document.createTextNode(" source "));
        var codeEl = document.createElement("code");
        codeEl.textContent = "@ " + sha;
        parts.push(codeEl);
      }
      if (version) parts.push(document.createTextNode(" · " + version));
      parts.forEach(function (n) { live.appendChild(n); });
    })
    .catch(function () { /* offline / absent manifest — keep static line */ });
})();
