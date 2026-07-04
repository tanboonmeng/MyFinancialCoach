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

      var startBtn = e.target.closest("[data-start-coaching]");
      if (startBtn) {
        // Hand off to Ryan's app.js: fire mfc:dashboard-ready (Contract 3),
        // then take the user to the coach chat.
        window.MFC.revealDashboard();
        var coach = document.getElementById("coach");
        if (coach) coach.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  /* ---------- "Chat with your coach" button ---------- */
  // Opens the live Botpress widget once Sammi's embed is present; until then,
  // it guides the user to the setup steps.
  var openCoachBtn = document.querySelector("[data-open-coach]");
  if (openCoachBtn) {
    openCoachBtn.addEventListener("click", function () {
      if (window.botpress && typeof window.botpress.open === "function") {
        window.botpress.open();
      } else {
        var onboard = document.getElementById("onboarding");
        if (onboard) onboard.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

})();
