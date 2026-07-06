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

    // Level-aware hero caption (the middle stat card is now the
    // deterministic items-done metric fed by app.js — no sample framing).
    var LEVEL_METRICS = {
      1: { heroCaption: "MAS benchmark · 3 months of expenses (minimum safety net)" },
      2: { heroCaption: "MAS benchmark · 9x / 4x annual income cover" },
      3: { heroCaption: "MAS benchmark · invest at least 10% of take-home pay" },
      4: { heroCaption: "Plan with official HDB/CPF calculators" }
    };

    // Sample per-level state. Ryan overwrites the active level via updateDashboard().
    var levels = [
      { title: "Emergency fund", pct: 59,
        detail: "$2,478 saved of $4,200 sample target",
        next: "You're 59% of the way to your 3-month safety net." },
      { title: "Insurance protection", pct: 8,
        detail: "Just getting started on protection.",
        next: "Set up your income protection to grow your safety net." },
      { title: "Investing", pct: 0,
        detail: "Unlocks once you're protected.",
        next: "Invest at least 10% of take-home pay — after Levels 1–2." },
      { title: "Home & retirement", pct: 0,
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
      var override = state.levelOverride || null;
      var doneCount;
      if (override) {
        doneCount = Object.keys(override).filter(function (k) {
          return override[k] === "done";
        }).length;
      } else {
        doneCount = state.allComplete ? levels.length : cur - 1;
      }

      // Level-aware benchmark caption from the map (used further down).
      var metric = LEVEL_METRICS[state.allComplete ? levels.length : cur];

      // (The stat-tile fund pill was removed 2026-07-06 as redundant —
      // fund progress lives in the focus-card bar and the L1 Done rows.)

      // Focus-card emergency-fund tracker bar: visible past Level 1 so the
      // fund's 6x progress keeps its visual tracker (values from app.js).
      var fb = get("fundbar");
      if (fb) {
        var showBar = (state.allComplete || cur > 1) &&
          typeof state.fundPct === "number" && typeof state.fundTarget === "number";
        fb.hidden = !showBar;
        if (showBar) {
          setText("fundbar-pct", state.fundPct + "%");
          setText("fundbar-target", fmtMoney(state.fundTarget));
          var fill = get("fundbar-fill");
          if (fill) fill.style.width = Math.min(100, Math.max(0, state.fundPct)) + "%";
        }
      }

      if (state.allComplete) {
        setText("level", levels.length);
        setText("level-title", "All levels complete");
        setText("hero-caption", "You've built the full plan");
        setText("detail", "You've completed all four levels — brilliant work.");
        setText("next", "Keep your weekly check-ins going.");
        setText("pct", "100%");
        setText("ring-cap", "level complete");
        var ringDone = get("ring");
        if (ringDone) ringDone.style.strokeDashoffset = "0";
      } else {
        var lvl = levels[cur - 1];
        setText("level", cur);
        setText("level-title", lvl.title);
        setText("hero-caption", metric.heroCaption);
        setText("detail", lvl.detail);
        setText("next", lvl.next);
        // pct null = no data for this level yet: show "—", empty ring
        var hasPct = typeof lvl.pct === "number";
        setText("pct", hasPct ? lvl.pct + "%" : "—");
        // caption follows the level's dial ("of cover target" at L2 etc.)
        setText("ring-cap", lvl.ringCaption || "of target");
        var ring = get("ring");
        if (ring) ring.style.strokeDashoffset = hasPct
          ? (CIRCUMFERENCE * (1 - lvl.pct / 100)).toFixed(1)
          : String(CIRCUMFERENCE);
      }

      setText("completed", doneCount);
      var overall = get("overall");
      if (overall) overall.style.width = (doneCount / levels.length * 100) + "%";

      section.querySelectorAll(".dash-lvl").forEach(function (li) {
        var n = Number(li.dataset.lvl);
        li.classList.remove("is-done", "is-current", "is-locked");
        var badge = li.querySelector(".dash-lvl-badge");
        var status = li.querySelector(".dash-lvl-status");
        // an explicit levels[] payload (spec §3c) wins over derivation
        var st = override ? override[n] : null;
        // L1's bench line shows live fund progress once the level is done
        // ("Emergency fund · 100% of $4,200 ..."); default text otherwise.
        var bench = li.querySelector(".dash-lvl-bench");
        if (bench && !bench.dataset.defaultText) bench.dataset.defaultText = bench.textContent;
        var isDone = st === "done" || (!st && (state.allComplete || n < cur));
        if (bench) {
          bench.textContent = (n === 1 && isDone && state.fundNote)
            ? state.fundNote : bench.dataset.defaultText;
        }
        if (isDone) {
          li.classList.add("is-done");
          badge.innerHTML = CHECK_SVG;
          status.textContent = "Done";
        } else if (st === "current" || (!st && n === cur)) {
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

    function fmtMoney(n) {
      return "$" + Math.round(n).toLocaleString("en-SG");
    }

    // Accepts both the original shape ({ currentLevel, savingsProgress,
    // streakWeeks, detail, next }) and Ryan's spec §3c payload
    // ({ currentLevel, streakCount, savings:{current,target,pct},
    //    levels:[{id, state}] }). Rendering-only extension.
    function update(data) {
      if (!data) return;

      // Reset-my-data: clean Level-1 view (empty ring, cleared targets,
      // L2-L4 locked) + a confirmation toast. No NaN, no computed figures.
      if (data.reset === true) {
        state.currentLevel = 1;
        state.allComplete = false;
        state.levelOverride = null;
        state.fundNote = null;
        state.fundPct = null;
        state.fundTarget = null;
        var l1 = levels[0];
        l1.pct = 0;
        l1.detail = "Enter your numbers below to see your emergency-fund progress.";
        l1.next = "Start with Level 1 — build your emergency fund.";
        setText("items-done", "—");
        setText("items-total", "—");
        var subEl = section.querySelector(".dash-sub");
        if (subEl) subEl.innerHTML = "Fresh start — enter your numbers below to see live progress.";
        if (!section.hidden) render();
        var rt = get("toast");
        if (rt) {
          setText("toast-text", "Your data has been cleared — starting fresh.");
          rt.hidden = false;
          clearTimeout(rt._timer);
          rt._timer = setTimeout(function () { rt.hidden = true; }, 2600);
        }
        return;
      }

      if (typeof data.currentLevel === "number") {
        state.currentLevel = Math.min(Math.max(data.currentLevel, 1), levels.length);
        state.allComplete = false;
      }
      // app.js signals every level's checklist is done -> render the
      // existing all-complete state (100% ring, all cards Done)
      if (data.allComplete === true) state.allComplete = true;
      var active = levels[state.currentLevel - 1];
      if (active) {
        if (typeof data.savingsProgress !== "undefined") {
          active.pct = parseInt(data.savingsProgress, 10) || 0;
        }
        if (data.detail) active.detail = data.detail;
        if (data.next) active.next = data.next;

        // spec §3c: real numbers from app.js (null-safe copy per C2).
        // savings{} describes the EMERGENCY FUND, so it fills the focus
        // card only while Level 1 is current; for levels 2-4 app.js
        // sends a level-appropriate focus{} instead.
        if (data.savings && typeof data.savings === "object" && state.currentLevel === 1) {
          var s = data.savings;
          if (s.target === null || typeof s.target === "undefined") {
            active.pct = 0;
            active.detail = "Enter your monthly expenses to set your emergency-fund target.";
          } else if (s.current === null || typeof s.current === "undefined") {
            active.pct = 0;
            active.detail = "Target " + fmtMoney(s.target) + " — add your current savings to see progress.";
          } else {
            active.pct = (typeof s.pct === "number") ? Math.min(Math.max(s.pct, 0), 100) : 0;
            active.detail = fmtMoney(s.current) + " saved of " + fmtMoney(s.target) + " target";
            if (!data.next) active.next = "You're " + active.pct + "% of the way to your 3-month safety net (" + fmtMoney(s.target) + ").";
          }
        }
        // focus{} from app.js: display-ready content for the current level.
        // pct null means "no data yet" -> ring renders "—", never a false 0%.
        if (data.focus && typeof data.focus === "object") {
          if (typeof data.focus.pct === "number") {
            active.pct = Math.min(Math.max(data.focus.pct, 0), 100);
          } else if (data.focus.pct === null) {
            active.pct = null;
          }
          if (data.focus.detail) active.detail = data.focus.detail;
          if (data.focus.next) active.next = data.focus.next;
          active.ringCaption = data.focus.ringCaption || null;
        }
        if (data.savings || data.focus) {
          // Real numbers are in: relabel the sub line (streak stays sample).
          var sub = section.querySelector(".dash-sub");
          if (sub) sub.innerHTML = "Updated as you complete each step.";
        }
      }
      if (Array.isArray(data.levels)) {
        state.levelOverride = {};
        data.levels.forEach(function (l) {
          if (l && typeof l.id === "number") state.levelOverride[l.id] = l.state;
        });
      }
      // live fund-progress note for the completed Level 1 row (app.js owns
      // the value; null clears it)
      if ("fundNote" in data) state.fundNote = data.fundNote || null;
      // raw fund numbers for the focus card's emergency-fund tracker bar
      if (data.savings && typeof data.savings === "object") {
        state.fundPct = (typeof data.savings.pct === "number") ? data.savings.pct : null;
        state.fundTarget = (typeof data.savings.target === "number") ? data.savings.target : null;
      }
      // "This level" stat card: deterministic items-done from app.js
      // (same refresh path as the focus ring). total 0 = level not ready
      // yet -> keep the neutral placeholder, never a fake denominator.
      if (data.itemsDone && typeof data.itemsDone === "object") {
        var itd = data.itemsDone;
        var itReady = typeof itd.total === "number" && itd.total > 0;
        setText("items-done", itReady ? itd.done : "—");
        setText("items-total", itReady ? itd.total : "—");
      }
      if (!section.hidden) render();
      // real level-up from app.js gatekeeping -> existing celebration toast
      if (typeof data.celebrateLevel === "number") celebrate(data.celebrateLevel);
    }

    return { reveal: reveal, update: update, init: init };
  })();

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
