/* =====================================================================
   My Financial Coach — site.js
   Team Alpha Minds | C240 FA

   UI behaviour only: nav, scrolling, onboarding step state (phase 3).

   RYAN: do NOT add MAS calculation logic here — that lives in app.js.
   site.js exposes window.MFC as the mount point between the two files:
     - MFC.revealDashboard()  -> called when onboarding finishes; your
       app.js can listen for the "mfc:dashboard-ready" event on document
       to init the Botpress widget and pass the 5 user variables
       (Contract 3 in AlphaMinds_Integration_Handoff.txt).
     - MFC.userId             -> fixed single-user id "user1".
   ===================================================================== */

(function () {
  "use strict";

  /* ---------- Public mount point for Ryan's app.js ---------- */
  window.MFC = {
    userId: "user1",
    revealDashboard: function () {
      document.dispatchEvent(new CustomEvent("mfc:dashboard-ready", {
        detail: { userId: window.MFC.userId }
      }));
    }
  };

  /* ---------- Workspace access gate ----------
     The app page (app.html) is only meant to open AFTER onboarding. We set
     this flag when the user finishes onboarding ("Start coaching"); app.html
     redirects to onboarding if it isn't set. The dummy "Send" button on the
     coach preview also sets it, as a testing shortcut into the workspace. */
  var ONBOARDED_KEY = "mfc_onboarded";
  function unlockWorkspace() {
    try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch (e) { /* private mode */ }
  }

  /* ---------- Mobile nav toggle ---------- */
  var navToggle = document.getElementById("navToggle");
  var navLinks = document.getElementById("navLinks");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      var open = navLinks.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Close the menu after tapping any link (mobile)
    navLinks.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        navLinks.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---------- Active nav link on scroll ---------- */
  var sectionIds = ["journey", "coach", "how"];
  var linkFor = {};
  sectionIds.forEach(function (id) {
    var link = document.querySelector('.nav-link[href="#' + id + '"]');
    if (link) linkFor[id] = link;
  });

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = linkFor[entry.target.id];
        if (!link) return;
        if (entry.isIntersecting) {
          Object.keys(linkFor).forEach(function (id) {
            linkFor[id].classList.remove("is-active");
          });
          link.classList.add("is-active");
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px" });

    sectionIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) observer.observe(el);
    });
  }

  /* ---------- Locked-level hint toggles (the 4-level journey) ---------- */
  var hintToggles = document.querySelectorAll(".level-hint-toggle");
  hintToggles.forEach(function (btn) {
    var hint = btn.nextElementSibling;
    if (!hint || !hint.classList.contains("level-hint")) return;

    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      hint.hidden = open;
      btn.textContent = open ? "Why is this locked?" : "Got it — hide";
    });
  });

  /* ---------- Onboarding step flow (Ezann's 3-step spec) ---------- */
  var onboarding = document.getElementById("onboarding-flow");
  if (onboarding) {
    var panels = onboarding.querySelectorAll(".onboard-panel");
    var dots = onboarding.querySelectorAll(".step-dot");

    function goToStep(n) {
      panels.forEach(function (panel) {
        panel.hidden = Number(panel.dataset.step) !== n;
      });
      dots.forEach(function (dot) {
        var dn = Number(dot.dataset.dot);
        dot.classList.toggle("is-active", dn === n);
        dot.classList.toggle("is-done", dn < n);
      });
      // Move focus to the newly shown heading for keyboard/screen-reader users
      var heading = onboarding.querySelector('.onboard-panel[data-step="' + n + '"] .step-heading');
      if (heading) heading.focus();
    }

    onboarding.addEventListener("click", function (e) {
      var goBtn = e.target.closest("[data-goto]");
      if (goBtn) {
        goToStep(Number(goBtn.dataset.goto));
        return;
      }
      // "Start coaching" is an <a> to app.html — unlock the workspace first,
      // then let the link navigate.
      if (e.target.closest("[data-start-coaching]")) {
        unlockWorkspace();
      }
    });
  }

  /* ---------- Testing shortcut: the dummy "Send" opens the workspace ----- */
  var openAppBtn = document.querySelector("[data-open-app]");
  if (openAppBtn) {
    openAppBtn.addEventListener("click", function () {
      unlockWorkspace();
      window.location.href = "app.html";
    });
  }

  /* ---------- "Open coach" / "Chat with your coach" buttons ---------- */
  // Opens the live Botpress widget once Sammi's embed is present; until then,
  // it scrolls to a fallback section (data-coach-fallback, default "coach").
  document.querySelectorAll("[data-open-coach]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (window.botpress && typeof window.botpress.open === "function") {
        window.botpress.open();
        return;
      }
      var target = document.getElementById(btn.dataset.coachFallback || "coach");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  /* ---------- Progress dashboard (presentation only) ---------- */
  // The website renders the VIEW; Ryan's app.js supplies the real numbers via
  // window.MFC.updateDashboard({ currentLevel, savingsProgress, streakWeeks, ... }).
  // Values below are clearly-labelled SAMPLE data for the demo — no financial
  // calculation happens here.
  var dashboard = (function () {
    var section = document.getElementById("dashboard");
    if (!section) return null;

    var CIRCUMFERENCE = 326.7; // 2 * pi * r, r = 52
    var CHECK_SVG = '<svg viewBox="0 0 24 24" style="width:1rem;height:1rem;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round"><path d="M20 6L9 17l-5-5"/></svg>';

    // Sample per-level state. Ryan overwrites the active level via updateDashboard().
    var levels = [
      { title: "Emergency fund", benchmark: "3–6 months of expenses", pct: 59,
        detail: "$4,956 saved of $8,400 sample target",
        next: "You're 59% there — keep going to unlock insurance." },
      { title: "Insurance protection", benchmark: "9x / 4x annual income cover", pct: 8,
        detail: "Just getting started on protection.",
        next: "Set up your income protection to grow your safety net." },
      { title: "Investing", benchmark: "≥10% of take-home pay", pct: 0,
        detail: "Unlocks once you're protected.",
        next: "Invest at least 10% of take-home pay — after Levels 1–2." },
      { title: "Home & retirement", benchmark: "Plan with official calculators", pct: 0,
        detail: "The big-picture planning stage.",
        next: "Plan your first home and retirement with official tools." }
    ];
    var state = { currentLevel: 1, allComplete: false };

    function setText(key, value) {
      section.querySelectorAll('[data-dash="' + key + '"]').forEach(function (el) {
        el.textContent = value;
      });
    }
    function get(key) { return section.querySelector('[data-dash="' + key + '"]'); }

    function render() {
      var cur = state.currentLevel;
      var doneCount = state.allComplete ? levels.length : cur - 1;

      if (state.allComplete) {
        setText("level", levels.length);
        setText("level-title", "All levels complete");
        setText("benchmark", "You've built the full plan");
        setText("detail", "You've completed all four levels — brilliant work.");
        setText("next", "Keep your streak going with your weekly check-ins.");
        setText("pct", "100%");
        var ringDone = get("ring");
        if (ringDone) ringDone.style.strokeDashoffset = "0";
      } else {
        var lvl = levels[cur - 1];
        setText("level", cur);
        setText("level-title", lvl.title);
        setText("benchmark", lvl.benchmark);
        setText("detail", lvl.detail);
        setText("next", lvl.next);
        setText("pct", lvl.pct + "%");
        var ring = get("ring");
        if (ring) ring.style.strokeDashoffset = (CIRCUMFERENCE * (1 - lvl.pct / 100)).toFixed(1);
      }

      setText("completed", doneCount);
      var overall = get("overall");
      if (overall) overall.style.width = (doneCount / levels.length * 100) + "%";

      section.querySelectorAll(".dash-lvl").forEach(function (li) {
        var n = Number(li.dataset.lvl);
        li.classList.remove("is-done", "is-current", "is-locked");
        var badge = li.querySelector(".dash-lvl-badge");
        var status = li.querySelector(".dash-lvl-status");
        if (state.allComplete || n < cur) {
          li.classList.add("is-done");
          badge.innerHTML = CHECK_SVG;
          status.textContent = "Done";
        } else if (n === cur) {
          li.classList.add("is-current");
          badge.textContent = n;
          status.textContent = "In progress";
        } else {
          li.classList.add("is-locked");
          badge.textContent = n;
          status.textContent = "Locked";
        }
      });
    }

    function celebrate(completedLevel) {
      var li = section.querySelector('.dash-lvl[data-lvl="' + completedLevel + '"]');
      if (li) {
        li.classList.add("just-completed");
        setTimeout(function () { li.classList.remove("just-completed"); }, 600);
      }
      var toast = get("toast");
      if (toast) {
        setText("toast-text", state.allComplete
          ? "All four levels complete!"
          : "Level " + completedLevel + " complete!");
        toast.hidden = false;
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function () { toast.hidden = true; }, 2600);
      }
    }

    function levelUp() {
      if (state.allComplete) return;
      var completed = state.currentLevel;
      // fill the ring to 100% first, then advance
      var ring = get("ring");
      if (ring) ring.style.strokeDashoffset = "0";
      setText("pct", "100%");
      setTimeout(function () {
        if (state.currentLevel < levels.length) {
          state.currentLevel += 1;
        } else {
          state.allComplete = true;
        }
        render();
        celebrate(completed);
      }, 450);
    }

    function reveal() {
      section.hidden = false;
      render();
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function init() {
      // app page: render in place without scrolling
      section.hidden = false;
      render();
    }

    function update(data) {
      if (!data) return;
      if (typeof data.currentLevel === "number") {
        state.currentLevel = Math.min(Math.max(data.currentLevel, 1), levels.length);
        state.allComplete = false;
      }
      var active = levels[state.currentLevel - 1];
      if (active) {
        if (typeof data.savingsProgress !== "undefined") {
          active.pct = parseInt(data.savingsProgress, 10) || 0;
        }
        if (data.detail) active.detail = data.detail;
        if (data.next) active.next = data.next;
      }
      if (typeof data.streakWeeks !== "undefined") setText("streak", data.streakWeeks);
      if (!section.hidden) render();
    }

    return { reveal: reveal, update: update, levelUp: levelUp, init: init };
  })();

  // Wire the "Preview a level-up" demo button
  var levelUpBtn = document.querySelector("[data-levelup]");
  if (levelUpBtn && dashboard) {
    levelUpBtn.addEventListener("click", function () { dashboard.levelUp(); });
  }

  // Extend the public mount point for Ryan's app.js
  window.MFC.revealDashboard = function () {
    document.dispatchEvent(new CustomEvent("mfc:dashboard-ready", {
      detail: { userId: window.MFC.userId }
    }));
    if (dashboard) dashboard.reveal();
  };
  window.MFC.updateDashboard = function (data) {
    if (dashboard) dashboard.update(data);
  };

  // On the app page (app.html) the dashboard is present and shown on load:
  // render it and fire mfc:dashboard-ready so Ryan's app.js can initialise.
  var dashOnLoad = document.getElementById("dashboard");
  if (dashboard && dashOnLoad && !dashOnLoad.hidden) {
    dashboard.init();
    document.dispatchEvent(new CustomEvent("mfc:dashboard-ready", {
      detail: { userId: window.MFC.userId }
    }));
  }

})();
