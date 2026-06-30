/* explainmyrepo — landing interactions
   - orchestrated reveal (staggered, IntersectionObserver) with a screenshot-safe fallback
   - copy-to-clipboard for command wells
   Respects prefers-reduced-motion via CSS; this only adds the `in` class. */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal-up, .reveal-line'));

  // assign per-element stagger from data-d (in 90ms units)
  reveals.forEach(function (el) {
    var d = parseFloat(el.getAttribute('data-d'));
    if (!isNaN(d)) el.style.setProperty('--d', (d * 0.09).toFixed(2) + 's');
  });

  function reveal(el) { el.classList.add('in'); }
  function revealAll() { reveals.forEach(reveal); }

  if (reduce || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });

    // Safety net: reveal everything shortly after load so nothing can stay hidden
    // (also guarantees full-page screenshots capture all content).
    window.addEventListener('load', function () {
      window.setTimeout(revealAll, 1200);
    });
  }

  // ---- copy buttons --------------------------------------------------------
  var status = document.getElementById('copy-status');
  // Decode only the few HTML entities our static command strings use — no innerHTML, no XSS surface.
  function decode(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  function flash(btn, ok) {
    var label = btn.querySelector('.copy-label');
    var original = label ? label.textContent : '';
    btn.classList.add('copied');
    if (label) label.textContent = ok ? 'Copied' : 'Press ⌘C';
    if (status) status.textContent = ok ? 'Command copied to clipboard.' : 'Copy failed — select and press Cmd/Ctrl+C.';
    window.setTimeout(function () {
      btn.classList.remove('copied');
      if (label) label.textContent = original || 'Copy';
    }, 1700);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.copy-btn'), function (btn) {
    btn.addEventListener('click', function () {
      var text = decode(btn.getAttribute('data-copy') || '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { flash(btn, true); }, function () { flash(btn, false); });
      } else {
        flash(btn, false);
      }
    });
  });
})();
