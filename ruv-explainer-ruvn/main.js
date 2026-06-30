/* =============================================================================
   ruvn ExplainerSite — main.js  (progressive enhancement only; < 6 KB)
   The page is fully usable with JS disabled: all sections and gallery cards
   are native <details>/<summary>. This script adds, on top:
     1. deep-link: open the <details> a #hash points at, and on nav-click.
     2. drop-in stub: click / keyboard / drag-and-drop converge on one handler;
        the real .zip href wires up when the Drop-in Smart Zip is published.
   No dependencies. No build step.
   ========================================================================== */
(function () {
  "use strict";

  /* --- 1. Deep-link a section open ---------------------------------------- */
  function openFromHash() {
    var id = (location.hash || "").replace(/^#/, "");
    if (!id) return;
    var el = document.getElementById(id);
    while (el && el.tagName !== "DETAILS") el = el.parentElement;
    if (el && !el.open) el.open = true;
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
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

  /* --- 2. Drop-in stub (click / keyboard / drag) -------------------------- */
  var dz = document.getElementById("dropzone");
  var status = document.getElementById("dzStatus");
  if (!dz) return;

  // The drop-in Smart Zip ships alongside the site under downloads/.
  var DOWNLOAD_HREF = "downloads/ruvn-dropin.zip";

  function say(msg) { if (status) status.textContent = msg; }

  function activate() {
    say("Downloading ruvn-dropin.zip … (unzip → cd for-ai → npm i → node ask-kb.mjs ruvn \"what does ruvn do\")");
    var a = document.createElement("a");
    a.href = DOWNLOAD_HREF;
    a.download = "ruvn-dropin.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
        ? "Caught " + n + " item(s). The drop-in is a download, not an upload — click or press Enter to get it."
        : "Nothing detected. Click or press Enter to get the drop-in instead."
    );
  });
})();
