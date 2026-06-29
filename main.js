/* =============================================================================
   Repo Explainer — Public Website — main.js
   Static site. Implementation is the npx one-liner / Claude Code plugin.
   Progressive enhancement: smooth navigation, copy buttons, animations.
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

  /* --- 2. Copy-to-clipboard buttons --------------------------------------- */
  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy") || "";
      var done = function () {
        var orig = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(function () { btn.textContent = orig; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { window.prompt("Copy this command:", text); });
      } else {
        window.prompt("Copy this command:", text);
      }
    });
  });

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
