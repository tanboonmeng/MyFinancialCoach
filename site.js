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

  /* ---------- Onboarding step state (built in phase 3) ---------- */
  // Step counter 1 -> 2 -> 3 per Ezann build spec; added in phase 3.

})();
