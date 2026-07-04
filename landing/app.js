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

  // ---- Netlify Forms (AJAX submit — no page navigation) --------------------
  // One handler for every form on the page: validate, POST url-encoded to '/'
  // (incl. form-name, as Netlify requires), then swap the form for its thanks
  // block. `validate` returns an error string to block, or '' to proceed;
  // native `required`/type constraints are enforced via reportValidity().
  function wireForm(form, statusEl, thanksEl, validate) {
    if (!form) return;
    function setStatus(msg, isErr) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.classList.toggle('err', !!isErr);
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var problem = validate ? validate(form) : '';
      if (problem) { setStatus(problem, true); return; }
      if (!form.checkValidity()) { form.reportValidity(); return; }

      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      setStatus('Sending…', false);

      var body = [];
      new FormData(form).forEach(function (v, k) {
        body.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      });
      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.join('&')
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        form.hidden = true;
        if (thanksEl) thanksEl.hidden = false;
      }).catch(function () {
        if (btn) btn.disabled = false;
        setStatus('Couldn’t send just then — please try again.', true);
      });
    });
  }

  // Feedback: needs at least a grade or a line of words — no empty noise.
  var fbForm = document.querySelector('form[data-fb]');
  wireForm(
    fbForm,
    fbForm && fbForm.querySelector('[data-fb-status]'),
    document.querySelector('[data-fb-thanks]'),
    function (f) {
      var d = new FormData(f);
      if (!d.get('clarity') && !(d.get('thoughts') || '').toString().trim()) {
        return 'Add a grade or a line of feedback first.';
      }
      return '';
    }
  );

  // ---- Hosted builder: paste a repo -> we build on our keys -> poll -> live link ----
  // querySelectorAll: the hero has its own compact copy of this form in addition to the
  // full one in #get-started — both must wire up independently.
  Array.prototype.forEach.call(document.querySelectorAll('form[data-rq]'), wireBuildForm);

  function wireBuildForm(form) {
    if (!form) return;
    var statusEl = form.querySelector('[data-rq-status]');
    var card = form.closest('.gs-request') || document;
    var progress = card.querySelector('[data-rq-progress]');
    var progLine = card.querySelector('[data-rq-progline]');
    var resultEl = card.querySelector('[data-rq-result]');
    var resultLink = card.querySelector('[data-rq-link]');
    var errEl = card.querySelector('[data-rq-error]');
    var errMsg = card.querySelector('[data-rq-errmsg]');

    function setStatus(msg, isErr) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.classList.toggle('err', !!isErr);
    }
    function show(el) { if (el) el.hidden = false; }
    function hide(el) { if (el) el.hidden = true; }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var fd = new FormData(form);
      var repo = (fd.get('repo') || '').toString().trim();
      var email = (fd.get('email') || '').toString().trim();
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      setStatus('Starting your build…', false);

      fetch('/.netlify/functions/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: repo, email: email })
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (res) {
        if (!res.ok || !res.j || !res.j.statusUrl) {
          throw new Error((res.j && res.j.error) || 'Could not start the build. Please try again.');
        }
        hide(form); show(progress);
        poll(res.j.statusUrl, res.j.repo || repo);
      }).catch(function (err) {
        if (btn) btn.disabled = false;
        setStatus(err.message || 'Something went wrong — try again.', true);
      });
    });

    function poll(statusUrl, repoName) {
      var tries = 0;
      (function tick() {
        tries++;
        fetch(statusUrl).then(function (r) { return r.json(); }).then(function (s) {
          if (progLine && s.stepName) progLine.textContent = s.stepName;
          if (s.status === 'done' && s.result && s.result.liveUrl) {
            hide(progress); show(resultEl);
            if (resultLink) { resultLink.href = s.result.liveUrl; resultLink.textContent = s.result.liveUrl; }
          } else if (s.status === 'failed') {
            hide(progress); show(errEl);
            if (errMsg) errMsg.textContent = s.error || 'The build couldn’t finish. Please try again.';
          } else if (tries > 300) { // ~25 min ceiling
            if (progLine) progLine.textContent = 'Still working — if you left your email, we’ll send the link when it’s ready.';
            setTimeout(tick, 15000);
          } else {
            setTimeout(tick, 5000);
          }
        }).catch(function () {
          if (tries <= 300) setTimeout(tick, 6000);
        });
      })();
    }
  }
})();
