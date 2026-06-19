/* PhotonLayer ExplainerSite — interaction layer
   - collapsible sections (remember "open" via aria)
   - smooth in-page nav + active section highlight
   - "expand all / collapse all" control
   - provenance line: static by default, live-refreshable if a build manifest exists
   No frameworks, no CDN. Progressive-enhancement only. */
(function () {
  "use strict";

  /* ---- 1. Collapsible <details> — animate height + scroll into view ------- */
  var allDetails = Array.prototype.slice.call(document.querySelectorAll("details.sec, details.uc"));

  function setExpandLabel() {
    var btn = document.getElementById("expand-toggle");
    if (!btn) return;
    var anyClosed = allDetails.some(function (d) { return !d.open; });
    btn.textContent = anyClosed ? "Expand all sections" : "Collapse all sections";
    btn.setAttribute("aria-expanded", String(!anyClosed));
  }

  var expandBtn = document.getElementById("expand-toggle");
  if (expandBtn) {
    expandBtn.addEventListener("click", function () {
      var anyClosed = allDetails.some(function (d) { return !d.open; });
      allDetails.forEach(function (d) { d.open = anyClosed; });
      setExpandLabel();
    });
  }
  allDetails.forEach(function (d) {
    d.addEventListener("toggle", setExpandLabel);
  });
  setExpandLabel();

  /* ---- 2. Smooth-scroll for in-page nav, open target if collapsed -------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href").slice(1);
      if (!id) return;
      var target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      var det = target.closest("details");
      if (det && !det.open) det.open = true;
      if (target.tagName === "DETAILS" && !target.open) target.open = true;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", "#" + id);
    });
  });

  /* ---- 3. Active-section highlight in the side rail ---------------------- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".rail a"));
  var byId = {};
  navLinks.forEach(function (l) { byId[l.getAttribute("href").slice(1)] = l; });
  var sections = Array.prototype.slice.call(document.querySelectorAll("section[id]"));
  if ("IntersectionObserver" in window && sections.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var link = byId[en.target.id];
        if (!link) return;
        if (en.isIntersecting) {
          navLinks.forEach(function (l) { l.classList.remove("active"); });
          link.classList.add("active");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* ---- 4. Live provenance (optional). Static line ships in the HTML;
            if a /build-manifest.json is later added, refresh it in place. -- */
  var prov = document.getElementById("prov-live");
  if (prov) {
    fetch("/build-manifest.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        if (!m) return;
        // Sanitize: only hex chars for sha, only date-ish chars for date.
        var sha = String(m.sourceSha || "").replace(/[^0-9a-fA-F]/g, "").slice(0, 7);
        var date = String(m.builtAt || m.updated || "").replace(/[^0-9A-Za-z:\-\s.]/g, "");
        if (!sha) return;
        // Build via safe DOM nodes (textContent only) — never innerHTML.
        prov.textContent = "";
        prov.appendChild(document.createTextNode("Updated "));
        var t = document.createElement("time");
        t.textContent = date || "—";
        prov.appendChild(t);
        prov.appendChild(document.createTextNode(" · source @ "));
        var c = document.createElement("code");
        c.textContent = sha;
        prov.appendChild(c);
      })
      .catch(function () { /* keep static line */ });
  }

  /* ---- 5. Copy-to-clipboard on command blocks --------------------------- */
  document.querySelectorAll("[data-copy]").forEach(function (el) {
    el.addEventListener("click", function () {
      var text = el.getAttribute("data-copy");
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(function () {
        var prev = el.getAttribute("data-label") || "";
        el.classList.add("copied");
        var hint = el.querySelector(".copy-hint");
        if (hint) { hint.textContent = "copied ✓"; }
        setTimeout(function () {
          el.classList.remove("copied");
          if (hint) hint.textContent = "copy";
        }, 1400);
      });
    });
  });
})();
