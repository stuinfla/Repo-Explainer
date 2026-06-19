/* =============================================================================
   RuField MFS ExplainerSite — main.js  (progressive enhancement; < 6 KB)
   The page is fully usable with JS disabled: all sections AND the use-case
   gallery items are native <details>/<summary>, so they open/close on their own.
   This script adds:
     1. deep-link: open the <details> a #hash points at, and on nav-click.
     2. dropzone stub: click + keyboard (Enter/Space) + drag-and-drop fallback,
        all three paths converge on one handler. The real .zip download href
        wires up when downloads/rufield-dropin.zip is published.
   No dependencies. No build step.
   ========================================================================== */
(function () {
  "use strict";

  /* --- 1. Deep-link a section (or gallery item) open ---------------------- */
  function openFromHash() {
    var id = (location.hash || "").replace(/^#/, "");
    if (!id) return;
    var el = document.getElementById(id);
    // Walk up: open EVERY enclosing <details> (a gallery item lives inside §06).
    while (el) {
      if (el.tagName === "DETAILS" && !el.open) el.open = true;
      el = el.parentElement;
    }
    var target = document.getElementById(id);
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  window.addEventListener("hashchange", openFromHash);
  openFromHash();

  // Clicking an in-page nav link should also expand its target section.
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function () {
      var id = a.getAttribute("href").slice(1);
      var el = document.getElementById(id);
      while (el) {
        if (el.tagName === "DETAILS" && !el.open) el.open = true;
        el = el.parentElement;
      }
    });
  });

  /* --- 2. Dropzone stub (click / keyboard / drag) ------------------------- */
  var dz = document.getElementById("dropzone");
  var status = document.getElementById("dzStatus");
  if (!dz) return;

  // Stub target. Swapped for the real GitHub Release / downloads/ href on publish.
  var DOWNLOAD_HREF = "downloads/rufield-dropin.zip";

  function say(msg) { if (status) status.textContent = msg; }

  function activate() {
    // Announce intent. Becomes a real navigation to the published .zip on publish.
    say("Drop-in pack not bundled yet — ships via the GitHub Release (" + DOWNLOAD_HREF + ").");
  }

  dz.addEventListener("click", activate);

  dz.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      activate();
    }
  });

  ["dragenter", "dragover"].forEach(function (evt) {
    dz.addEventListener(evt, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add("is-dragover");
    });
  });
  ["dragleave", "dragend"].forEach(function (evt) {
    dz.addEventListener(evt, function (e) {
      e.preventDefault();
      dz.classList.remove("is-dragover");
    });
  });
  dz.addEventListener("drop", function (e) {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove("is-dragover");
    var n = (e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items.length) || 0;
    say(
      n
        ? "Caught " + n + " item(s). The drop-in is a knowledge pack you copy in — preview only here."
        : "Nothing detected. Click or press Enter for the drop-in pack instead."
    );
  });
})();
