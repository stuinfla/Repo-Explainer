(function () {
  "use strict";

  /* --- 1. Smooth deep-link scroll ----------------------------------------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href").slice(1);
      var target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.pushState(null, "", "#" + id);
      }
    });
  });

  /* --- 2. Create form handler — real pipeline progress -------------------- */
  var form = document.getElementById("createForm");
  var output = document.getElementById("createOutput");
  var outputTitle = document.getElementById("outputTitle");
  var outputDesc = document.getElementById("outputDesc");
  var outputSteps = document.getElementById("outputSteps");
  // Estimates are calibrated to real pipeline runs (~2–3 min end to end), not
  // padded — an honest countdown makes the wait feel shorter, not longer.
  var PIPELINE_STEPS = [
    { name: "Setting up",              desc: "Preparing the build runner and tools", est: "~25s" },
    { name: "Cloning repository",      desc: "Downloading your repo's code and documentation", est: "~5s" },
    { name: "Analyzing the codebase",  desc: "Mapping structure, languages, symbols, and docs", est: "~5s" },
    { name: "Scaffolding explainer",   desc: "Creating the site structure from our explainer template", est: "~5s" },
    { name: "Authoring content",       desc: "Writing the sections that explain your project in plain language", est: "~45s" },
    { name: "Generating images",       desc: "Creating the hero image and section illustrations with AI", est: "~50s" },
    { name: "Running quality gates",   desc: "Checking accuracy, completeness, and visual quality (5 gates)", est: "~5s" },
    { name: "Publishing to GitHub",    desc: "Creating your explainer repo and granting you push access", est: "~10s" },
    { name: "Deploying to Vercel",     desc: "Launching your live, public site", est: "~35s" }
  ];

  var TOTAL_ESTIMATED_SECONDS = 200;

  var ICON_PENDING = "○";   // ○
  var ICON_ACTIVE  = "▶";   // ▶
  var ICON_DONE    = "✓";   // ✓
  var ICON_FAILED  = "✗";   // ✗

  /* Create a single step DOM element with description and estimate */
  function createStepEl(step, index) {
    var div = document.createElement("div");
    div.className = "output-step";

    var icon = document.createElement("span");
    icon.className = "output-step-icon";
    icon.textContent = ICON_PENDING;

    var content = document.createElement("span");
    content.className = "output-step-content";

    var title = document.createElement("span");
    title.className = "output-step-title";
    title.textContent = step.name;

    var est = document.createElement("span");
    est.className = "output-step-est";
    est.textContent = step.est;

    var desc = document.createElement("span");
    desc.className = "output-step-desc";
    desc.textContent = step.desc;

    content.appendChild(title);
    content.appendChild(est);
    content.appendChild(desc);
    div.appendChild(icon);
    div.appendChild(content);
    return div;
  }

  function setStepStatus(el, status) {
    el.className = "output-step " + status;
    var icon = el.querySelector(".output-step-icon");
    if (status === "done") icon.textContent = ICON_DONE;
    else if (status === "error") icon.textContent = ICON_FAILED;
    else if (status === "active") icon.textContent = ICON_ACTIVE;
    else icon.textContent = ICON_PENDING;
  }

  function fmtElapsed(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* Render all 9 pipeline step elements and return their DOM refs */
  function renderPipelineSteps() {
    outputSteps.innerHTML = "";
    var refs = [];
    for (var i = 0; i < PIPELINE_STEPS.length; i++) {
      var el = createStepEl(PIPELINE_STEPS[i], i);
      outputSteps.appendChild(el);
      refs.push(el);
    }
    var timerRow = document.createElement("div");
    timerRow.className = "output-elapsed";
    timerRow.textContent = "Elapsed: 0:00 — Estimated total: ~3 minutes";
    outputSteps.appendChild(timerRow);

    var statusMsg = document.createElement("div");
    statusMsg.className = "output-status-msg";
    statusMsg.textContent = "Pipeline starting up…";
    outputSteps.appendChild(statusMsg);

    return { stepEls: refs, timerEl: timerRow, statusMsgEl: statusMsg };
  }

  /* Update step elements from a status response */
  function applyStepStatuses(stepEls, steps) {
    if (!steps || !steps.length) return;
    for (var i = 0; i < stepEls.length; i++) {
      if (i < steps.length) {
        setStepStatus(stepEls[i], steps[i].status || "pending");
      }
    }
  }

  /* Build one result row: label, the full URL as text, a Copy button, and Open */
  function makeLinkRow(label, url, primary) {
    var row = document.createElement("div");
    row.className = "output-link-row" + (primary ? " primary" : "");

    var lbl = document.createElement("span");
    lbl.className = "output-link-label";
    lbl.textContent = label;
    row.appendChild(lbl);

    var urlEl = document.createElement("a");
    urlEl.className = "output-link-url";
    urlEl.href = url; urlEl.target = "_blank"; urlEl.rel = "noopener";
    urlEl.textContent = url;
    row.appendChild(urlEl);

    var actions = document.createElement("span");
    actions.className = "output-link-actions";

    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "output-copy-btn";
    copyBtn.textContent = "Copy link";
    copyBtn.addEventListener("click", function () {
      function done() {
        copyBtn.textContent = "Copied!";
        copyBtn.classList.add("copied");
        setTimeout(function () { copyBtn.textContent = "Copy link"; copyBtn.classList.remove("copied"); }, 2000);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(function () { window.prompt("Copy this link:", url); });
      } else {
        window.prompt("Copy this link:", url);
      }
    });
    actions.appendChild(copyBtn);

    var openBtn = document.createElement("a");
    openBtn.className = "output-open-btn" + (primary ? " primary" : "");
    openBtn.href = url; openBtn.target = "_blank"; openBtn.rel = "noopener";
    openBtn.textContent = "Open ↗";
    actions.appendChild(openBtn);

    row.appendChild(actions);
    return row;
  }

  /* Show success result with clickable + copyable links (XSS-safe) */
  function showSuccessResult(data) {
    outputTitle.textContent = "Your explainer is live! 🎉";
    outputDesc.innerHTML = "";

    var intro = document.createElement("p");
    intro.className = "output-success-intro";
    intro.textContent = "Your explainer page is deployed and public — copy either link to share it with anyone, no login required. You also have push access to the GitHub repo.";
    outputDesc.appendChild(intro);

    var wrap = document.createElement("div");
    wrap.className = "output-result-links";
    if (data.siteUrl) wrap.appendChild(makeLinkRow("Explainer page", data.siteUrl, true));
    if (data.repoUrl) wrap.appendChild(makeLinkRow("GitHub repo", data.repoUrl, false));
    outputDesc.appendChild(wrap);

    if (!data.siteUrl && !data.repoUrl) {
      var note = document.createElement("p");
      note.className = "output-error-msg";
      note.textContent = "The build finished but returned no links. Check the GitHub Actions run for details.";
      outputDesc.appendChild(note);
    }
  }

  /* Show failure result with error message and Try Again button */
  function showFailureResult(message) {
    outputTitle.textContent = "Build failed";
    outputDesc.innerHTML = "";

    var errP = document.createElement("p");
    errP.className = "output-error-msg";
    errP.textContent = message || "An unexpected error occurred.";
    outputDesc.appendChild(errP);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary output-retry-btn";
    btn.textContent = "Try Again";
    btn.addEventListener("click", function () {
      resetForm();
    });
    outputDesc.appendChild(btn);
  }

  /* Reset form to initial state */
  function resetForm() {
    var submitBtn = form.querySelector('button[type="submit"]');
    var urlInput = document.getElementById("repoUrl");
    var emailInput = document.getElementById("submitterEmail");
    submitBtn.disabled = false;
    urlInput.disabled = false;
    urlInput.value = "";
    if (emailInput) {
      emailInput.disabled = false;
      emailInput.value = "";
    }
    output.style.display = "none";
    outputSteps.innerHTML = "";
    outputDesc.innerHTML = "";
    outputTitle.textContent = "";
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var url = document.getElementById("repoUrl").value.trim();
      if (!url) return;

      var match = url.match(/github\.com\/([^\/]+)\/([^\/\?\#]+)/);
      if (!match) {
        alert(
          "Please enter a valid GitHub repository URL (e.g., https://github.com/owner/repo)"
        );
        return;
      }

      var owner = match[1];
      var repo = match[2].replace(/\.git$/, "");
      var fullName = owner + "/" + repo;

      var emailInput = document.getElementById("submitterEmail");
      var email = emailInput ? emailInput.value.trim() : "";

      // Disable the form while processing
      var submitBtn = form.querySelector('button[type="submit"]');
      var urlInput = document.getElementById("repoUrl");
      submitBtn.disabled = true;
      urlInput.disabled = true;
      if (emailInput) emailInput.disabled = true;

      // Show the output panel
      output.style.display = "block";
      outputTitle.textContent = "Building explainer for " + fullName;
      outputDesc.textContent = "Submitting build request…";
      outputSteps.innerHTML = "";

      // Scroll output into view
      setTimeout(function () {
        output.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);

      // POST to /api/build
      var body = { url: url };
      if (email) body.email = email;

      fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { status: res.status, data: data };
          });
        })
        .then(function (result) {
          var data = result.data;

          if (data.error) {
            outputTitle.textContent = "Request failed";
            outputDesc.textContent = data.error;
            submitBtn.disabled = false;
            urlInput.disabled = false;
            if (emailInput) emailInput.disabled = false;
            return;
          }

          // Build accepted — start pipeline tracking
          var buildId   = data.buildId   || "";
          var gistId    = data.gistId    || "";
          var repoName  = data.repoName  || fullName;

          if (!buildId) {
            showFailureResult("Server did not return a build ID. Please try again.");
            return;
          }

          outputTitle.textContent = "Building explainer for " + repoName;
          outputDesc.textContent = "Pipeline is running — this usually takes about 3 minutes";

          var ui = renderPipelineSteps();
          var startTime = Date.now();
          var elapsedInterval = null;
          var pollTimer = null;
          var consecutiveErrors = 0;
          var currentDelay = 5000;
          var stopped = false;
          var MAX_WAIT_MS = 15 * 60 * 1000;
          var MAX_CONSECUTIVE_ERRORS = 10;
          var STALE_THRESHOLD_MS = 3 * 60 * 1000;
          var lastProgressStep = -1;
          var lastProgressTime = Date.now();

          // Elapsed clock — update every second with estimated remaining
          elapsedInterval = setInterval(function () {
            var secs = Math.floor((Date.now() - startTime) / 1000);
            var remaining = Math.max(0, TOTAL_ESTIMATED_SECONDS - secs);
            var timeText = "Elapsed: " + fmtElapsed(secs);
            if (remaining > 0 && !stopped) {
              timeText += " — About " + fmtElapsed(remaining) + " remaining";
            }
            ui.timerEl.textContent = timeText;
          }, 1000);

          function stopTracking() {
            stopped = true;
            if (elapsedInterval) clearInterval(elapsedInterval);
            if (pollTimer) clearTimeout(pollTimer);
          }

          function poll() {
            if (stopped) return;

            if (Date.now() - startTime > MAX_WAIT_MS) {
              stopTracking();
              showFailureResult("Build timed out after 15 minutes. The pipeline may still be running — check back shortly or try again.");
              return;
            }

            var statusUrl = "/api/status?id=" +
              encodeURIComponent(buildId) +
              "&gist=" + encodeURIComponent(gistId);

            fetch(statusUrl)
              .then(function (res) { return res.json(); })
              .then(function (statusData) {
                // Successful response — reset error tracking
                consecutiveErrors = 0;
                currentDelay = 5000;

                var currentStep = typeof statusData.step === "number" ? statusData.step : -1;

                if (currentStep > lastProgressStep) {
                  lastProgressStep = currentStep;
                  lastProgressTime = Date.now();
                } else if (Date.now() - lastProgressTime > STALE_THRESHOLD_MS) {
                  stopTracking();
                  showFailureResult("Build appears stuck — no progress for 3 minutes. The pipeline may have encountered an issue. Please try again.");
                  return;
                }
                for (var i = 0; i < ui.stepEls.length; i++) {
                  if (i < currentStep) {
                    setStepStatus(ui.stepEls[i], "done");
                  } else if (i === currentStep) {
                    setStepStatus(ui.stepEls[i], statusData.status === "running" ? "active" : "done");
                  } else {
                    setStepStatus(ui.stepEls[i], "pending");
                  }
                }

                // Update status message with what's happening now
                if (currentStep >= 0 && currentStep < PIPELINE_STEPS.length) {
                  var stepInfo = PIPELINE_STEPS[currentStep];
                  ui.statusMsgEl.textContent = stepInfo.desc;
                  outputDesc.textContent = "Step " + (currentStep + 1) + " of " + PIPELINE_STEPS.length + ": " + stepInfo.name;
                }

                // Check terminal states
                if (statusData.status === "done") {
                  stopTracking();
                  for (var j = 0; j < ui.stepEls.length; j++) {
                    setStepStatus(ui.stepEls[j], "done");
                  }
                  var result = statusData.result || {};
                  showSuccessResult({
                    siteUrl:  result.explainerUrl || "",
                    repoUrl:  result.repoUrl      || ""
                  });
                  return;
                }

                if (statusData.status === "failed") {
                  stopTracking();
                  if (currentStep >= 0) {
                    setStepStatus(ui.stepEls[currentStep], "error");
                  }
                  showFailureResult(statusData.error);
                  return;
                }

                // Still running — schedule next poll
                pollTimer = setTimeout(poll, currentDelay);
              })
              .catch(function () {
                consecutiveErrors++;
                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                  stopTracking();
                  showFailureResult("Lost connection to the build server after multiple attempts. Please check your internet connection and try again.");
                  return;
                }
                if (consecutiveErrors >= 3) {
                  outputDesc.textContent = "Lost connection — retrying… (" + consecutiveErrors + "/" + MAX_CONSECUTIVE_ERRORS + ")";
                }
                currentDelay = Math.min(currentDelay * 2, 20000);
                pollTimer = setTimeout(poll, currentDelay);
              });
          }

          // Start polling
          pollTimer = setTimeout(poll, currentDelay);
        })
        .catch(function () {
          outputTitle.textContent = "Request failed";
          outputDesc.textContent =
            "Could not reach the server. Please check your connection and try again.";
          submitBtn.disabled = false;
          urlInput.disabled = false;
          if (emailInput) emailInput.disabled = false;
        });
    });
  }

  /* --- 3. Transformation pipeline animation ------------------------------ */
  (function initTransformAnim() {
    var before = document.getElementById("taBefore");
    var after  = document.getElementById("taAfter");
    var pipeline = document.getElementById("taPipeline");
    if (!before || !after || !pipeline) return;

    var steps = pipeline.querySelectorAll(".ta-step");
    var played = false;

    function runAnimation() {
      if (played) return;
      played = true;

      pipeline.classList.add("active");
      before.classList.add("animating");

      steps.forEach(function (step, i) {
        setTimeout(function () {
          if (i > 0) {
            steps[i - 1].classList.remove("active");
            steps[i - 1].classList.add("done");
          }
          step.classList.add("active");
        }, 600 + i * 700);
      });

      var totalTime = 600 + steps.length * 700;
      setTimeout(function () {
        steps[steps.length - 1].classList.remove("active");
        steps[steps.length - 1].classList.add("done");
        after.classList.add("revealed");
      }, totalTime);
    }

    if ("IntersectionObserver" in window) {
      var animObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            runAnimation();
            animObs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.3 });
      animObs.observe(pipeline);
    } else {
      runAnimation();
    }
  })();

  /* --- 4. Intersection Observer for scroll animations --------------------- */
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );

    document
      .querySelectorAll(".step, .feature-card, .gallery-card, .principle, .problem-card")
      .forEach(function (el) {
        el.style.opacity = "0";
        el.style.transform = "translateY(24px)";
        el.style.transition = "opacity 0.6s cubic-bezier(0.22, 0.61, 0.36, 1), transform 0.6s cubic-bezier(0.22, 0.61, 0.36, 1)";
        observer.observe(el);
      });
  }

  // Add visible class styles
  var style = document.createElement("style");
  style.textContent = [
    ".visible { opacity: 1 !important; transform: translateY(0) !important; }",
    ".output-link-row { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:12px 14px; border:1px solid rgba(255,255,255,0.12); border-radius:10px; background:rgba(255,255,255,0.04); margin-bottom:10px; }",
    ".output-link-row.primary { border-color:rgba(52,211,153,0.5); background:rgba(52,211,153,0.08); }",
    ".output-link-label { font-family:var(--sans); font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:rgba(255,255,255,0.55); min-width:92px; }",
    ".output-link-url { flex:1 1 200px; font-family:var(--mono); font-size:0.82rem; color:#c4b5fd; word-break:break-all; text-decoration:none; }",
    ".output-link-row.primary .output-link-url { color:#6ee7b7; }",
    ".output-link-url:hover { text-decoration:underline; }",
    ".output-link-actions { display:flex; gap:8px; align-items:center; }",
    ".output-copy-btn { cursor:pointer; font-family:var(--sans); font-size:0.78rem; font-weight:600; padding:7px 12px; border-radius:7px; border:1px solid rgba(255,255,255,0.25); background:transparent; color:#fff; transition:background 0.15s, border-color 0.15s; }",
    ".output-copy-btn:hover { background:rgba(255,255,255,0.12); }",
    ".output-copy-btn.copied { background:#34d399; border-color:#34d399; color:#0b1020; }",
    ".output-open-btn { font-family:var(--sans); font-size:0.78rem; font-weight:600; padding:7px 12px; border-radius:7px; text-decoration:none; border:1px solid transparent; background:rgba(108,60,224,0.28); color:#c4b5fd; }",
    ".output-open-btn.primary { background:#34d399; color:#0b1020; }",
    ".output-open-btn:hover { filter:brightness(1.1); }"
  ].join("\n");
  document.head.appendChild(style);
})();
