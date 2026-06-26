/* =============================================================================
   GitHub Repo Explainer — Public Website — main.js
   Progressive enhancement: form handling, smooth navigation, animations.
   ========================================================================== */
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

  /* --- 2. Create form handler --------------------------------------------- */
  var form = document.getElementById("createForm");
  var output = document.getElementById("createOutput");
  var outputTitle = document.getElementById("outputTitle");
  var outputDesc = document.getElementById("outputDesc");
  var outputSteps = document.getElementById("outputSteps");

  function addStep(text, status) {
    var div = document.createElement("div");
    div.className = "output-step " + (status || "");
    var iconChar = "&#9675;";
    if (status === "active") iconChar = "&#9654;";
    if (status === "done") iconChar = "&#10003;";
    if (status === "error") iconChar = "&#10007;";
    div.innerHTML = '<span class="output-step-icon">' + iconChar + "</span>" + text;
    outputSteps.appendChild(div);
    return div;
  }

  function markStep(el, status) {
    el.className = "output-step " + status;
    var icon = el.querySelector(".output-step-icon");
    if (status === "done") icon.innerHTML = "&#10003;";
    else if (status === "error") icon.innerHTML = "&#10007;";
    else if (status === "active") icon.innerHTML = "&#9654;";
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

      // Disable the form while processing
      var submitBtn = form.querySelector('button[type="submit"]');
      var urlInput = document.getElementById("repoUrl");
      submitBtn.disabled = true;
      urlInput.disabled = true;

      // Show the output panel
      output.style.display = "block";
      outputTitle.textContent = "Building explainer for " + fullName;
      outputDesc.textContent = "";
      outputSteps.innerHTML = "";

      // Scroll output into view
      setTimeout(function () {
        output.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);

      // Step 1: Validating
      var stepValidate = addStep("Validating repository...", "active");

      fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { status: res.status, data: data };
          });
        })
        .then(function (result) {
          var data = result.data;

          if (data.error) {
            markStep(stepValidate, "error");
            outputTitle.textContent = "Request failed";
            outputDesc.textContent = data.error;
            submitBtn.disabled = false;
            urlInput.disabled = false;
            return;
          }

          // Validation passed
          markStep(stepValidate, "done");

          // Step 2: Creating request
          var stepCreate = addStep("Creating explainer request...", "active");

          // Small delay so the user sees the transition
          setTimeout(function () {
            markStep(stepCreate, "done");

            // Step 3: Done
            addStep("Request submitted!", "done");

            outputTitle.textContent = "Explainer requested for " + (data.repoName || fullName);

            if (data.issueUrl) {
              outputDesc.innerHTML =
                "Your request has been submitted and is being tracked." +
                "<br><br>" +
                '<a href="' + data.issueUrl + '" target="_blank" rel="noopener" ' +
                'style="color:#6c3ce0;font-weight:600;">View your request on GitHub &rarr;</a>' +
                "<br><br>" +
                "The pipeline will ingest the repo, build the knowledge base, author the explainer, " +
                "generate studio media, and run 5 quality gates. Estimated time: 5-10 minutes." +
                "<br>" +
                "When complete, you will get:" +
                "<br>" +
                "&#8226; A live explainer page on its own Vercel URL<br>" +
                "&#8226; A GitHub repo you control (the original author is invited as collaborator)<br>" +
                "&#8226; A downloadable smart zip with the knowledge base + studio media";
            } else {
              var msg = data.message || "Your request has been received and will be processed.";
              outputDesc.innerHTML =
                msg +
                "<br><br>" +
                "The pipeline will ingest the repo, build the knowledge base, author the explainer, " +
                "generate studio media, and run 5 quality gates. Estimated time: 5-10 minutes." +
                "<br>" +
                "When complete, you will get:" +
                "<br>" +
                "&#8226; A live explainer page on its own Vercel URL<br>" +
                "&#8226; A GitHub repo you control (the original author is invited as collaborator)<br>" +
                "&#8226; A downloadable smart zip with the knowledge base + studio media";
            }

            submitBtn.disabled = false;
            urlInput.disabled = false;
          }, 400);
        })
        .catch(function () {
          markStep(stepValidate, "error");
          outputTitle.textContent = "Request failed";
          outputDesc.textContent =
            "Could not reach the server. Please check your connection and try again.";
          submitBtn.disabled = false;
          urlInput.disabled = false;
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
  style.textContent = ".visible { opacity: 1 !important; transform: translateY(0) !important; }";
  document.head.appendChild(style);
})();
