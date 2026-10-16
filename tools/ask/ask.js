/* ask.js — "Ask this project". The reader's browser finds the best passages from this page and the repo's own
   files (free, instant, BM25) and asks the central ask service to write one short, cited answer from them.
   Only the question and the ids of the chosen passages leave the page — the service rebuilds the passage text
   from this site's own published index, so it cannot be used to run arbitrary text through the model.
   If the service is unreachable the box falls back to showing the closest passages, labelled as such. */
(function () {
  var root = document.getElementById('ask');
  if (!root) return;
  var cfg = { index: root.dataset.index, repo: root.dataset.repo, name: root.dataset.name || 'this project', fn: root.dataset.fn || '', token: root.dataset.token || '' };
  var $ = function (s) { return root.querySelector(s); };
  var input = $('.ask-input'), form = $('.ask-form'), scan = $('.ask-scan'), scanTxt = $('.ask-scan span');
  var ans = $('.ask-ans'), chipsEl = $('.ask-chips');

  var STOP = new Set('a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those do does did how what why when where who which can could should would will i you we they he she my your our their me us them there here so than then too very just not no yes about into over under again also any all some more most other such only own same up down out off'.split(' '));
  function stem(w) { return w.length > 4 ? w.replace(/(ing|edly|ed|es|s|ly)$/, '') : w; }
  function tok(s) { return (s.toLowerCase().match(/[a-z0-9_]+/g) || []).filter(function (w) { return w.length > 1 && !STOP.has(w); }).map(stem); }
  // plain-words question -> the words repos actually use. Generic on purpose: no repo names.
  var SYN = {
    install: 'setup npm npx brew pip cargo getting started quickstart', setup: 'install configure getting started',
    start: 'quickstart getting started run usage begin', run: 'usage command cli start execute', use: 'usage example how guide',
    store: 'save persist storage database data ledger write', save: 'store persist storage write', data: 'store storage database record',
    private: 'privacy local security permission', privacy: 'local security permission private', secure: 'security permission auth',
    cost: 'price pricing license free', price: 'cost pricing license free', free: 'license price cost',
    work: 'support compatible integrate', support: 'compatible integrate work', integrate: 'support compatible plugin connect',
    fail: 'error unknown unsupported limit unreached', cannot: 'unknown unsupported limit unreached error', error: 'fail unknown limit',
    build: 'architecture design structure', built: 'architecture design structure layers', architecture: 'design structure layers built',
    contribute: 'contributing pull request develop', test: 'tests testing verify', slow: 'performance speed benchmark', fast: 'performance speed benchmark'
  };
  function expand(q) {
    var out = q.slice(); out.orig = q.slice(); out.w = Object.create(null);
    q.forEach(function (w) { out.w[w] = 1; });
    q.forEach(function (w) { if (SYN[w]) tok(SYN[w]).forEach(function (x) { if (out.indexOf(x) < 0) { out.push(x); out.w[x] = 0.35; } }); });
    return out;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- tiny BM25, built in slices so a phone's main thread is never blocked for long ---------- */
  function Bm25(docs, done) {
    var self = this; this.n = docs.length; this.tf = []; this.len = []; this.df = Object.create(null); var tot = 0, i = 0;
    (function step() {
      var end = Math.min(i + 250, docs.length);
      for (; i < end; i++) {
        var t = tok(docs[i]), m = Object.create(null);
        for (var j = 0; j < t.length; j++) m[t[j]] = (m[t[j]] || 0) + 1;
        for (var k in m) self.df[k] = (self.df[k] || 0) + 1;
        self.tf.push(m); self.len.push(t.length); tot += t.length;
      }
      if (i < docs.length) return setTimeout(step, 0);
      self.avg = tot / Math.max(1, self.n); done(self);
    })();
  }
  Bm25.prototype.score = function (q, i) {
    var s = 0, m = this.tf[i], K1 = 1.3, B = 0.72;
    for (var a = 0; a < q.length; a++) {
      var f = m[q[a]]; if (!f) continue;
      var idf = Math.log(1 + (this.n - this.df[q[a]] + 0.5) / (this.df[q[a]] + 0.5));
      s += (q.w ? q.w[q[a]] : 1) * idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * this.len[i] / this.avg));
    }
    return s;
  };
  Bm25.prototype.top = function (q, k, boost) {
    var out = [];
    for (var i = 0; i < this.n; i++) { var s = this.score(q, i); if (s > 0) out.push({ i: i, s: s * (boost ? boost(i) : 1) }); }
    out.sort(function (a, b) { return b.s - a.s; });
    return out.slice(0, k);
  };

  /* ---------- the published index: this page's sections + the repo's passages (lazy, once) ---------- */
  var data = null, loading = null, CODE = /\.(m?[jt]sx?|rs|py|go|java|c|cc|cpp|h|cs|rb|php|swift|kt|sh|sql|json|ya?ml|toml)$/i;
  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    loading = fetch(cfg.index).then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); }).then(function (d) {
      return new Promise(function (resolve) {
        new Bm25(d.docs.map(function (x) { return x.t + ' ' + x.t + ' ' + x.p.replace(/[\/._-]/g, ' ') + ' ' + x.x; }), function (docIdx) {
          new Bm25((d.sections || []).map(function (b) { return b.h + ' ' + b.h + ' ' + b.q + ' ' + b.q + ' ' + b.text; }), function (secIdx) {
            data = { docs: d.docs, sections: d.sections || [], docIdx: docIdx, secIdx: secIdx }; resolve(data);
          });
        });
      });
    });
    return loading;
  }
  function kindBoost(p) {
    if (/^(README|docs\/|website\/|CONTRIBUTING|SECURITY)/i.test(p)) return 1.4;
    if (/CHANGELOG|\.lock|package-lock/i.test(p)) return 0.4;
    if (/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\./i.test(p)) return 0.3;
    if (CODE.test(p)) return 0.75;
    return 1;
  }
  var ghUrl = function (p) { return 'https://github.com/' + cfg.repo + '/blob/HEAD/' + p.split('/').map(encodeURIComponent).join('/'); };
  function clean(x) { return x.replace(/```[a-z]*\n?/g, '').replace(/^#+\s*/gm, '').replace(/[*_`]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1'); }
  function mark(text, q) {
    var raw = esc(text), terms = {};
    (text.toLowerCase().match(/[a-z0-9_]+/g) || []).forEach(function (w) { if (q.indexOf(stem(w)) > -1) terms[w] = 1; });
    var ks = Object.keys(terms); if (!ks.length) return raw;
    return raw.replace(new RegExp('\\b(' + ks.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\b', 'gi'), '<mark>$1</mark>');
  }
  function jumpers(scope) {
    scope.querySelectorAll('[data-jump]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var s = document.getElementById(a.dataset.jump); if (!s) return; e.preventDefault();
        if (s.tagName === 'DETAILS') s.open = true; s.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ---------- ask: pick passages, send ids, stream the written answer ---------- */
  function run(question) {
    question = question.trim(); if (question.length < 2) return;
    var q = expand(tok(question));
    ans.classList.remove('on'); scan.classList.add('on'); scanTxt.textContent = 'opening the project…';
    var t0 = Date.now(), ticker;
    load().then(function (D) {
      var sample = []; for (var k = 0; k < 40; k++) sample.push(D.docs[(k * 97 + 13) % D.docs.length].p);
      var n = 0; ticker = setInterval(function () { scanTxt.textContent = 'reading ' + sample[n++ % sample.length]; }, 70);
      var hits = D.docIdx.top(q, 12, function (i) { return kindBoost(D.docs[i].p); });
      var sec = D.secIdx.top(q, 1)[0]; if (sec && sec.s < 1.0) sec = null;
      var seen = {}, picked = [];
      hits.forEach(function (h) { var d = D.docs[h.i], key = d.p + '|' + d.t; if (!seen[key] && picked.length < 6) { seen[key] = 1; picked.push(h.i); } });
      var wait = Math.max(0, 700 - (Date.now() - t0));
      setTimeout(function () {
        var stop = function () { clearInterval(ticker); scan.classList.remove('on'); };
        if (!cfg.fn || !cfg.token) { stop(); return fallback(question, q, D, picked, sec, false); }
        written(question, q, D, picked, sec, stop).catch(function () { stop(); fallback(question, q, D, picked, sec, true); });
      }, wait);
    }).catch(function () {
      clearInterval(ticker); scan.classList.remove('on');
      ans.innerHTML = '<p class="ask-none">The project index did not load. Please try again in a moment.</p>'; ans.classList.add('on');
    });
  }

  function mdLite(t) {
    var h = esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    var out = [], list = false;
    h.split('\n').forEach(function (l) {
      var m = /^\s*[-*•]\s+(.*)$/.exec(l);
      if (m) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + m[1] + '</li>'); }
      else { if (list) { out.push('</ul>'); list = false; } if (l.trim()) out.push('<p>' + l + '</p>'); }
    });
    if (list) out.push('</ul>');
    return out.join('');
  }

  function written(question, q, D, picked, sec, started) {
    var meta = [];   // same order the service builds its numbered passages: the page section first, then the files
    if (sec) meta.push({ href: '#' + D.sections[sec.i].id, label: D.sections[sec.i].h, page: true });
    picked.forEach(function (i) { var d = D.docs[i]; meta.push({ href: ghUrl(d.p), label: d.t || d.p, path: d.p }); });
    var body = JSON.stringify({ token: cfg.token, q: question, ids: { s: sec ? sec.i : null, d: picked } });
    return fetch(cfg.fn, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body }).then(function (r) {
      if (!r.ok || !r.body) throw new Error('service ' + r.status);
      var rd = r.body.getReader(), dec = new TextDecoder(), text = '', first = true;
      ans.innerHTML = '<p class="ask-q">You asked · ' + esc(question) + '</p><div class="ask-prose" aria-live="polite"></div>';
      ans.classList.add('on');
      var prose = ans.querySelector('.ask-prose');
      var paint = function (fin) {
        var html = mdLite(text).replace(/\[(\d{1,2})\]/g, function (m, n) {
          var x = meta[+n - 1]; if (!x) return '';
          return '<a class="ask-cite" href="' + x.href + '"' + (x.page ? ' data-jump="' + x.href.slice(1) + '"' : ' target="_blank" rel="noopener"') + ' title="' + esc(x.path || x.label) + '">' + n + '</a>';
        });
        prose.innerHTML = html + (fin ? '' : '<span class="ask-caret"></span>');
      };
      var finish = function () {
        if (!text.trim()) throw new Error('empty');
        var used = {}; (text.match(/\[(\d{1,2})\]/g) || []).forEach(function (m) { used[+m.slice(1, -1)] = 1; });
        var idx = Object.keys(used).map(Number).filter(function (n) { return meta[n - 1]; });
        if (!idx.length) idx = meta.map(function (m, i) { return i + 1; }).slice(0, 3);
        ans.insertAdjacentHTML('beforeend', '<h3 class="ask-h">Where this comes from</h3><div class="ask-srcs">' + idx.map(function (n) {
          var x = meta[n - 1];
          return '<a class="ask-src" ' + (x.page ? 'data-jump="' + x.href.slice(1) + '" href="' + x.href + '"' : 'target="_blank" rel="noopener" href="' + x.href + '"') + '><b><span class="ask-n">' + n + '</span>' + esc(x.label) + '</b><code>' + esc(x.page ? 'on this page' : x.path) + '</code></a>';
        }).join('') + '</div><p class="ask-foot">Written by a small AI model from this page and the project’s own files. If something matters, check the source.</p>');
        jumpers(ans);
      };
      var pump = function () {
        return rd.read().then(function (c) {
          if (c.done) { paint(true); return finish(); }
          if (first) { first = false; started(); }
          text += dec.decode(c.value, { stream: true }); paint(false); return pump();
        });
      };
      return pump();
    });
  }

  /* closest passages, shown plainly when the writer is unavailable */
  function fallback(question, q, D, picked, sec, wasError) {
    var html = '<p class="ask-q">You asked · ' + esc(question) + '</p>';
    if (wasError) html += '<p class="ask-from">The writer is busy right now, so here are the closest passages instead.</p>';
    if (!picked.length && !sec) html += '<p class="ask-none">Nothing in ' + esc(cfg.name) + ' matches that. Try a feature, a command or a file name.</p>';
    else {
      if (sec) html += '<a class="ask-page" href="#' + D.sections[sec.i].id + '" data-jump="' + D.sections[sec.i].id + '">Read “' + esc(D.sections[sec.i].h) + '” on this page ↓</a>';
      html += '<h3 class="ask-h">Closest passages</h3><div class="ask-srcs">' + picked.slice(0, 4).map(function (i) {
        var d = D.docs[i];
        return '<a class="ask-src" target="_blank" rel="noopener" href="' + ghUrl(d.p) + '"><b>' + esc(d.t || d.p) + '</b><code>' + esc(d.p) + '</code><p>' + mark(clean(d.x).replace(/\s+/g, ' ').slice(0, 260), q) + '</p></a>';
      }).join('') + '</div>';
    }
    ans.innerHTML = html; ans.classList.add('on'); jumpers(ans);
  }

  /* ---------- wiring ---------- */
  form.addEventListener('submit', function (e) { e.preventDefault(); run(input.value); });
  chipsEl.addEventListener('click', function (e) { var b = e.target.closest('.ask-chip'); if (!b) return; input.value = b.textContent; run(b.textContent); });
  input.addEventListener('focus', function () { load().catch(function () {}); }, { once: true });
  var qs = Array.prototype.map.call(chipsEl.querySelectorAll('.ask-chip'), function (b) { return b.textContent; }), pi = 0;
  if (qs.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(function () { if (document.activeElement !== input && !input.value) input.placeholder = 'Try: ' + qs[pi++ % qs.length]; }, 3200);
  }
  // floating button: only after the first screen has been read, and never on top of the Ask box itself
  var fab = document.querySelector('.ask-fab');
  if (fab) {
    var inView = false, pastHero = false, paintFab = function () { fab.classList.toggle('hide', inView || !pastHero); };
    fab.classList.add('hide');
    window.addEventListener('scroll', function () { var p = window.scrollY > window.innerHeight * 0.9; if (p !== pastHero) { pastHero = p; paintFab(); } }, { passive: true });
    new IntersectionObserver(function (en) { inView = en[0].isIntersecting; paintFab(); }, { threshold: 0.2 }).observe(root);
    fab.addEventListener('click', function () { root.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(function () { input.focus({ preventScroll: true }); }, 450); });
  }
})();
