/* =====================================================================
   My Financial Coach — app.js (Ryan's calculation layer)
   Team Alpha Minds | C240 FA

   THE ONLY PLACE CALCULATIONS HAPPEN. Pure MAS formulas per
   Ryan_AppJS_Build_Spec.txt §1; contracts per
   AlphaMinds_Integration_Handoff.txt (Contract 2 in, Contracts 3/4 out).

   Null discipline (spec §1): if ANY required input for a formula is
   null -> that formula returns null. Never NaN, never divide-by-zero,
   never default-substitution. A null field in a payload NEVER
   overwrites an existing state value (spec §3a).
   ===================================================================== */

(function () {
  "use strict";

  /* =================================================================
     1. PURE MAS CALCULATIONS (spec §1) — same input, same output,
        no side effects, no network. All money values are monthly SGD
        unless noted. Raw floats kept; rounding happens at display.
     ================================================================= */

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // Emergency fund: 3x expenses = unlock threshold, 6x = displayed target.
  // Expenses null or 0 -> no target (spec: "enter your expenses", C2).
  function emergencyTargetMin(monthlyExpenses) {
    return (isNum(monthlyExpenses) && monthlyExpenses > 0) ? 3 * monthlyExpenses : null;
  }
  function emergencyTargetFull(monthlyExpenses) {
    return (isNum(monthlyExpenses) && monthlyExpenses > 0) ? 6 * monthlyExpenses : null;
  }
  function savingsProgressPct(currentSavings, targetFull) {
    if (!isNum(currentSavings) || !isNum(targetFull) || targetFull <= 0) return null;
    return Math.min(100, Math.max(0, Math.round(100 * currentSavings / targetFull)));
  }

  // Insurance: derived annual income (JS derives, never the LLM).
  function annualIncome(monthlyTakeHome) {
    return (isNum(monthlyTakeHome) && monthlyTakeHome > 0) ? 12 * monthlyTakeHome : null;
  }
  function dtpdTarget(annual) { return isNum(annual) ? 9 * annual : null; }
  function ciTarget(annual)   { return isNum(annual) ? 4 * annual : null; }
  function premiumCapMonthly(monthlyTakeHome) {
    return (isNum(monthlyTakeHome) && monthlyTakeHome > 0) ? 0.15 * monthlyTakeHome : null;
  }
  function premiumOk(monthlyPremium, cap) {
    if (!isNum(monthlyPremium) || !isNum(cap)) return null;
    return monthlyPremium <= cap;
  }

  // Investing: at least 10% of take-home.
  function investMinMonthly(monthlyTakeHome) {
    return (isNum(monthlyTakeHome) && monthlyTakeHome > 0) ? 0.10 * monthlyTakeHome : null;
  }
  function investOk(monthlyInvestment, minMonthly) {
    if (!isNum(monthlyInvestment) || !isNum(minMonthly)) return null;
    return monthlyInvestment >= minMonthly;
  }

  // Compute every derived value from the 7 raw inputs (nulls propagate).
  function computeAll(inputs) {
    var annual = annualIncome(inputs.monthly_take_home_income);
    var targetFull = emergencyTargetFull(inputs.monthly_expenses);
    var cap = premiumCapMonthly(inputs.monthly_take_home_income);
    var investMin = investMinMonthly(inputs.monthly_take_home_income);
    return {
      emergencyTargetMin:  emergencyTargetMin(inputs.monthly_expenses),
      emergencyTargetFull: targetFull,
      savingsProgressPct:  savingsProgressPct(inputs.current_savings, targetFull),
      annualIncome:        annual,
      dtpdTarget:          dtpdTarget(annual),
      ciTarget:            ciTarget(annual),
      premiumCapMonthly:   cap,
      premiumOk:           premiumOk(inputs.monthly_insurance_premium, cap),
      investMinMonthly:    investMin,
      investOk:            investOk(inputs.monthly_investment_amount, investMin)
    };
  }

  // Display helper: whole dollars with thousands separators (C6).
  function fmtSGD(n) {
    if (!isNum(n)) return null;
    return "$" + Math.round(n).toLocaleString("en-SG");
  }

  /* =================================================================
     SELF-TESTS (spec §7.1) — the exact values from the spec + the
     null-discipline edge cases. Logs one PASS/FAIL line on load.
     ================================================================= */
  (function selfTest() {
    var pass = true;
    function check(label, cond) {
      console.assert(cond, "[app.js self-test FAILED] " + label);
      if (!cond) pass = false;
    }
    // C1: income 2800 / expenses 1400
    check("emergencyTargetFull(1400) === 8400", emergencyTargetFull(1400) === 8400);
    check("emergencyTargetMin(1400) === 4200", emergencyTargetMin(1400) === 4200);
    check("savingsProgressPct(4956, 8400) === 59", savingsProgressPct(4956, 8400) === 59);
    // C4: annual income 33600 (12 x 2800)
    check("annualIncome(2800) === 33600", annualIncome(2800) === 33600);
    check("dtpdTarget(33600) === 302400", dtpdTarget(33600) === 302400);
    check("ciTarget(33600) === 134400", ciTarget(33600) === 134400);
    // 15% cap and 10% floor on 2800
    check("premiumCapMonthly(2800) === 420", premiumCapMonthly(2800) === 420);
    check("investMinMonthly(2800) === 280", Math.abs(investMinMonthly(2800) - 280) < 1e-9);
    check("premiumOk(400, 420) === true", premiumOk(400, 420) === true);
    check("investOk(200, 280) === false", investOk(200, 280) === false);
    // C2 / null discipline: no NaN, no divide-by-zero, nulls propagate
    check("emergencyTargetFull(0) === null", emergencyTargetFull(0) === null);
    check("emergencyTargetFull(null) === null", emergencyTargetFull(null) === null);
    check("savingsProgressPct(4956, null) === null", savingsProgressPct(4956, null) === null);
    check("savingsProgressPct(null, 8400) === null", savingsProgressPct(null, 8400) === null);
    check("premiumOk(null, 420) === null", premiumOk(null, 420) === null);
    // clamp + C6 large input
    check("savingsProgressPct(99999, 8400) === 100", savingsProgressPct(99999, 8400) === 100);
    check("fmtSGD(12 * 999999 * 9) formats cleanly", fmtSGD(dtpdTarget(annualIncome(999999))) === "$107,999,892");
    console.log(pass
      ? "[app.js] self-tests: PASS (17/17)"
      : "[app.js] self-tests: FAIL — see assertions above");
  })();

  /* =================================================================
     STATE (in-memory for Phase 1; localStorage arrives in Phase 2)
     ================================================================= */
  var FIELDS = [
    "monthly_take_home_income",
    "monthly_expenses",
    "current_savings",
    "monthly_insurance_premium",
    "dtpd_coverage_amount",
    "critical_illness_coverage_amount",
    "monthly_investment_amount"
  ];

  var state = {
    inputs: {},          // the 7 raw fields, null until provided
    derived: {},         // computeAll() output
    currentLevel: 1,     // gatekeeping arrives in Phase 3
    lastUpdated: null
  };
  FIELDS.forEach(function (k) { state.inputs[k] = null; });

  function recompute() {
    state.derived = computeAll(state.inputs);
    state.lastUpdated = new Date().toISOString();
    // Phase 2: persist + window.MFC.updateDashboard(...)
    // Phase 3: gatekeeping state machine
    // Phase 4: Botpress variable push
    console.log("[app.js] recomputed:", JSON.parse(JSON.stringify({
      inputs: state.inputs, derived: state.derived
    })));
  }

  /* =================================================================
     2. INGESTION SEAM (Contract 2 / spec §3a, §5)
        ONE entry point, two doors: Gemini-in-Botpress calls it, and
        the "Enter my numbers" panel calls the very same function.
     ================================================================= */
  window.MFC = window.MFC || {};
  window.MFC.ingestExtraction = function (json) {
    var data = json;

    // Gemini output is text — accept a string and parse defensively.
    if (typeof data === "string") {
      try { data = JSON.parse(data); }
      catch (e) {
        console.warn("[app.js] extraction payload failed to parse — ignored.", e);
        return { ok: false, reason: "parse-error" };
      }
    }
    if (!data || typeof data !== "object") {
      console.warn("[app.js] extraction payload not an object — ignored.");
      return { ok: false, reason: "bad-payload" };
    }

    // Ambiguous -> do NOT compute; surface the note as a coach follow-up (C7).
    if (data.ambiguous === true) {
      var note = (typeof data.ambiguity_note === "string" && data.ambiguity_note) ||
                 "Could you confirm that figure with your coach?";
      showEntryStatus("needs-check", "Your coach needs a quick check: " + note);
      return { ok: false, reason: "ambiguous", note: note };
    }

    // Merge: only finite, non-negative numbers land; null NEVER
    // overwrites an existing value (C3).
    var accepted = 0;
    FIELDS.forEach(function (k) {
      var v = data[k];
      if (isNum(v) && v >= 0) { state.inputs[k] = v; accepted++; }
    });

    if (accepted === 0) {
      showEntryStatus("empty", "No numbers found in that update — nothing changed.");
      return { ok: false, reason: "no-fields" };
    }

    recompute();

    var missing = FIELDS.filter(function (k) { return state.inputs[k] === null; }).length;
    showEntryStatus("saved",
      "Got it — " + accepted + " number" + (accepted === 1 ? "" : "s") + " saved." +
      (missing ? " (" + missing + " of 7 still blank — add them any time.)" : " All 7 in — nice!"));
    return { ok: true, derived: state.derived };
  };

  /* =================================================================
     3. "ENTER MY NUMBERS" FALLBACK PANEL (spec §5 — built first).
        Presentation only; submits through the same ingestExtraction.
     ================================================================= */
  var entryForm = document.getElementById("entryForm");
  var entryStatus = document.getElementById("entryStatus");

  function showEntryStatus(kind, text) {
    if (!entryStatus) return;
    entryStatus.hidden = false;
    entryStatus.textContent = text;
    entryStatus.className = "entry-status" +
      (kind === "needs-check" ? " is-warn" : kind === "saved" ? " is-ok" : "");
  }

  if (entryForm) {
    entryForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var payload = { ambiguous: false, ambiguity_note: null };
      FIELDS.forEach(function (k) {
        var input = entryForm.querySelector('[name="' + k + '"]');
        if (!input || input.value.trim() === "") { payload[k] = null; return; }
        var v = Number(input.value);
        payload[k] = (isFinite(v) && v >= 0) ? v : null;
      });
      window.MFC.ingestExtraction(payload);
    });
  }

  /* =================================================================
     Expose the pure functions for Ezann's C-series testing in DevTools
     (read-only surface; not part of the team contracts).
     ================================================================= */
  window.MFC.calc = {
    emergencyTargetMin: emergencyTargetMin,
    emergencyTargetFull: emergencyTargetFull,
    savingsProgressPct: savingsProgressPct,
    annualIncome: annualIncome,
    dtpdTarget: dtpdTarget,
    ciTarget: ciTarget,
    premiumCapMonthly: premiumCapMonthly,
    premiumOk: premiumOk,
    investMinMonthly: investMinMonthly,
    investOk: investOk,
    computeAll: computeAll,
    fmtSGD: fmtSGD
  };

})();
