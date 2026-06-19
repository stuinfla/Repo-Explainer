/* =============================================================================
   MetaHarness ExplainerSite — main.js  (P2 shell; target < 6 KB)
   Progressive enhancement only. The page is fully usable with JS disabled:
   the 9 sections are native <details>/<summary>, so they open/close on their
   own. This script adds:
     1. deep-link: open the <details> a #hash points at, and on nav-click.
     2. dropzone stub: click + keyboard (Enter/Space) + drag-and-drop fallback,
        all three paths converge on one handler. The real .zip download href
        and file handling wire up in P7/P9.
   No dependencies. No build step.
   ========================================================================== */
(function () {
  "use strict";

  /* --- 1. Deep-link a section open ---------------------------------------- */
  function openFromHash() {
    var id = (location.hash || "").replace(/^#/, "");
    if (!id) return;
    var el = document.getElementById(id);
    // Walk up to the enclosing <details> (the hash may target an inner element).
    while (el && el.tagName !== "DETAILS") el = el.parentElement;
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

  /* --- 2. Dropzone stub (click / keyboard / drag) ------------------------- */
  var dz = document.getElementById("dropzone");
  var status = document.getElementById("dzStatus");
  if (!dz) return;

  // P2 stub target. Swapped for the real GitHub Release / downloads/ href in P9.
  var DOWNLOAD_HREF = "downloads/metaharness-dropin.zip";

  function say(msg) {
    if (status) status.textContent = msg;
  }

  function activate() {
    // P2 behaviour: announce intent. In P9 this becomes a real navigation to
    // the published .zip. Kept inert here so the shell ships without a binary.
    say("Drop-in not bundled yet — wires up in P7/P9 (" + DOWNLOAD_HREF + ").");
  }

  // Click path.
  dz.addEventListener("click", activate);

  // Keyboard path (it is role="button" tabindex="0").
  dz.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      activate();
    }
  });

  // Drag path. Prevent the browser from navigating away when a folder is dropped.
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
        ? "Caught " + n + " item(s). Repo analysis is a P4+ feature — preview only."
        : "Nothing detected. Click or press Enter for the drop-in instead."
    );
  });
})();
