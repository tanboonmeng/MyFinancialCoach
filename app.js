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

  // Coverage-cap conflict (CoverageCap_Conflict_Handling.txt Part A):
  // the user still needs more cover to reach the 9x/4x MAS targets, but
  // their premium is already at/above the 15% affordability cap.
  // Null-safe: if any required input (incl. a derived target) is null,
  // the sub-flag is null and the conflict is false — we never warn on
  // numbers we don't have.
  function coverageCapConflict(inputs, dtpdTgt, ciTgt, cap) {
    var dtpdShortfall = (!isNum(inputs.dtpd_coverage_amount) || !isNum(dtpdTgt))
      ? null : (inputs.dtpd_coverage_amount < dtpdTgt);
    var ciShortfall = (!isNum(inputs.critical_illness_coverage_amount) || !isNum(ciTgt))
      ? null : (inputs.critical_illness_coverage_amount < ciTgt);
    var premiumAtCap = (!isNum(inputs.monthly_insurance_premium) || !isNum(cap))
      ? null : (inputs.monthly_insurance_premium >= cap);
    return (dtpdShortfall === true || ciShortfall === true) && (premiumAtCap === true);
  }

  // Compute every derived value from the 7 raw inputs (nulls propagate).
  function computeAll(inputs) {
    var annual = annualIncome(inputs.monthly_take_home_income);
    var targetFull = emergencyTargetFull(inputs.monthly_expenses);
    var cap = premiumCapMonthly(inputs.monthly_take_home_income);
    var investMin = investMinMonthly(inputs.monthly_take_home_income);
    var dtpd = dtpdTarget(annual);
    var ci = ciTarget(annual);
    return {
      emergencyTargetMin:  emergencyTargetMin(inputs.monthly_expenses),
      emergencyTargetFull: targetFull,
      savingsProgressPct:  savingsProgressPct(inputs.current_savings, targetFull),
      annualIncome:        annual,
      dtpdTarget:          dtpd,
      ciTarget:            ci,
      premiumCapMonthly:   cap,
      premiumOk:           premiumOk(inputs.monthly_insurance_premium, cap),
      investMinMonthly:    investMin,
      investOk:            investOk(inputs.monthly_investment_amount, investMin),
      coverageCapConflict: coverageCapConflict(inputs, dtpd, ci, cap)
    };
  }

  // Display helper: whole dollars with thousands separators (C6).
  function fmtSGD(n) {
    if (!isNum(n)) return null;
    return "$" + Math.round(n).toLocaleString("en-SG");
  }

  /* =================================================================
     2. LEVEL GATEKEEPING (spec §2) — pure state machine.
        L1 complete <=> savings >= 3x expenses (3x unlocks; 6x stays
        the displayed stretch target — documented design decision).
        L2 complete <=> DTPD >= 9x annual AND CI >= 4x annual AND
        premium within the 15% cap.
        L3 reachable only after L1+L2 (MAS sequence); complete when
        investOk. L4 has no auto-completion (official calculators).
        Null discipline: missing data can never complete a level.
        Forward-only: gatekeep() never returns below prevLevel.
     ================================================================= */
  function levelCompletion(inputs, derived) {
    var l1 = isNum(inputs.current_savings) &&
             isNum(derived.emergencyTargetMin) &&
             inputs.current_savings >= derived.emergencyTargetMin;
    var l2 = isNum(inputs.dtpd_coverage_amount) &&
             isNum(derived.dtpdTarget) &&
             inputs.dtpd_coverage_amount >= derived.dtpdTarget &&
             isNum(inputs.critical_illness_coverage_amount) &&
             isNum(derived.ciTarget) &&
             inputs.critical_illness_coverage_amount >= derived.ciTarget &&
             derived.premiumOk === true;
    var l3 = derived.investOk === true;
    return { 1: l1, 2: l2, 3: l3, 4: false };
  }

  function lowestIncomplete(completion) {
    if (!completion[1]) return 1;
    if (!completion[2]) return 2;
    if (!completion[3]) return 3;
    return 4;
  }

  function gatekeep(prevLevel, inputs) {
    var derived = computeAll(inputs);
    var computed = lowestIncomplete(levelCompletion(inputs, derived));
    var prev = (isNum(prevLevel) && prevLevel >= 1) ? Math.round(prevLevel) : 1;
    return Math.max(prev, computed); // forward-only, never auto-demote
  }

  /* =================================================================
     SELF-TESTS (spec §7.1) — the exact values from the spec + the
     null-discipline edge cases. Logs one PASS/FAIL line on load.
     ================================================================= */
  (function selfTest() {
    var pass = true, total = 0;
    function check(label, cond) {
      total++;
      console.assert(cond, "[app.js self-test FAILED] " + label);
      if (!cond) pass = false;
    }
    // helper: gatekeep from a fresh level-1 profile
    function gk(overrides) {
      var inputs = {
        monthly_take_home_income: 2800, monthly_expenses: 1400,
        current_savings: null, monthly_insurance_premium: null,
        dtpd_coverage_amount: null, critical_illness_coverage_amount: null,
        monthly_investment_amount: null
      };
      Object.keys(overrides || {}).forEach(function (k) { inputs[k] = overrides[k]; });
      return gatekeep(1, inputs);
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
    // Gatekeeping (spec §2): 3x boundary, L2 gates, sequence, forward-only
    check("G1 savings 4199 (<3x) -> level 1", gk({ current_savings: 4199 }) === 1);
    check("G2 savings 4200 (=3x) -> level 2", gk({ current_savings: 4200 }) === 2);
    check("G3 full cover + premium at cap -> level 3", gk({
      current_savings: 4200, dtpd_coverage_amount: 302400,
      critical_illness_coverage_amount: 134400, monthly_insurance_premium: 420
    }) === 3);
    check("G4 premium above cap blocks L2", gk({
      current_savings: 4200, dtpd_coverage_amount: 302400,
      critical_illness_coverage_amount: 134400, monthly_insurance_premium: 421
    }) === 2);
    check("G5 investOk after L1+L2 -> level 4", gk({
      current_savings: 4200, dtpd_coverage_amount: 302400,
      critical_illness_coverage_amount: 134400, monthly_insurance_premium: 420,
      monthly_investment_amount: 280
    }) === 4);
    check("G6 investOk alone cannot skip the sequence", gk({
      monthly_investment_amount: 999
    }) === 1);
    check("G7 null coverage never completes L2", gk({
      current_savings: 4200, monthly_insurance_premium: 100
    }) === 2);
    check("G8 forward-only: level never demotes", gatekeep(3, {
      monthly_take_home_income: 2800, monthly_expenses: 1400,
      current_savings: 100, monthly_insurance_premium: null,
      dtpd_coverage_amount: null, critical_illness_coverage_amount: null,
      monthly_investment_amount: null
    }) === 3);
    // Coverage-cap conflict (CoverageCap_Conflict_Handling.txt Part E)
    // helper: compute the flag for an income-2500 profile (cap = $375)
    function ccFlag(o) {
      var inputs = {
        monthly_take_home_income: 2500, monthly_expenses: 1000,
        current_savings: null, monthly_insurance_premium: null,
        dtpd_coverage_amount: null, critical_illness_coverage_amount: null,
        monthly_investment_amount: null
      };
      Object.keys(o || {}).forEach(function (k) { inputs[k] = o[k]; });
      return computeAll(inputs).coverageCapConflict;
    }
    // CC1: under-covered (DTPD 100k < 270k target) AND premium >= 15% cap
    check("CC1 under-covered + premium at cap -> conflict true",
      ccFlag({ dtpd_coverage_amount: 100000, monthly_insurance_premium: 400 }) === true);
    // CC2: fully covered (>= 9x and >= 4x) -> false even with high premium
    check("CC2 fully covered -> conflict false",
      ccFlag({ dtpd_coverage_amount: 300000, critical_illness_coverage_amount: 130000, monthly_insurance_premium: 400 }) === false);
    // CC3: a required field null (premium) -> conflict false, no false alarm
    check("CC3 null premium -> conflict false",
      ccFlag({ dtpd_coverage_amount: 100000, monthly_insurance_premium: null }) === false);
    console.log(pass
      ? "[app.js] self-tests: PASS (" + total + "/" + total + ")"
      : "[app.js] self-tests: FAIL — see assertions above");
  })();

  /* =================================================================
     STATE & PERSISTENCE (spec §4) — localStorage "mfc_state_v1",
     version-guarded: parse failure or version mismatch resets cleanly.
     The streak is NOT persisted here — it is owned by the n8n/Sheets
     loop; the dashboard keeps its clearly-labelled sample value.
     ================================================================= */
  var STATE_KEY = "mfc_state_v1";
  var STATE_VERSION = 1;

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

  function hasAnyInput() {
    return FIELDS.some(function (k) { return state.inputs[k] !== null; });
  }

  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        version: STATE_VERSION,
        inputs: state.inputs,
        derived: state.derived,
        currentLevel: state.currentLevel,
        lastUpdated: state.lastUpdated
      }));
    } catch (e) { /* private mode / quota — state stays in memory */ }
  }

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(STATE_KEY); } catch (e) { return; }
    if (!raw) return;
    var saved = null;
    try { saved = JSON.parse(raw); } catch (e) { saved = null; }
    if (!saved || saved.version !== STATE_VERSION || typeof saved.inputs !== "object") {
      // schema change or corrupt state -> reset cleanly, never crash
      try { localStorage.removeItem(STATE_KEY); } catch (e) {}
      console.warn("[app.js] stored state invalid or old version — reset to empty.");
      return;
    }
    FIELDS.forEach(function (k) {
      var v = saved.inputs[k];
      if (isNum(v) && v >= 0) state.inputs[k] = v;
    });
    if (isNum(saved.currentLevel) && saved.currentLevel >= 1 && saved.currentLevel <= 4) {
      state.currentLevel = Math.round(saved.currentLevel);
    }
    if (typeof saved.lastUpdated === "string") state.lastUpdated = saved.lastUpdated;
  }

  /* =================================================================
     DASHBOARD OUT (spec §3c) — window.MFC.updateDashboard payload:
     { currentLevel, savings:{current,target,pct}, levels:[{id,state}] }
     streakCount is intentionally omitted: the streak belongs to n8n/
     Sheets, so the dashboard keeps its labelled sample value.
     Level-aware labels re-render from LEVEL_METRICS via currentLevel
     inside site.js — no label logic here.
     ================================================================= */
  // Focus-card content for levels 2-4 (level 1 renders from savings{}).
  // Derivation + formatting live here; site.js only displays the strings.
  function focusFor(level, inputs, d) {
    if (level === 2) {
      if (!isNum(d.dtpdTarget)) {
        return { pct: 0, detail: "Add your income so your coach can size your cover targets.",
                 next: "Your Death & TPD and CI targets come from 9x / 4x annual income." };
      }
      var c1 = inputs.dtpd_coverage_amount, c2 = inputs.critical_illness_coverage_amount;
      var pct = (isNum(c1) && isNum(c2))
        ? Math.min(100, Math.max(0, Math.round(100 * Math.min(c1 / d.dtpdTarget, c2 / d.ciTarget))))
        : 0;
      var detail = "Death & TPD " + (isNum(c1) ? fmtSGD(c1) : "—") + " of " + fmtSGD(d.dtpdTarget) +
                   " · CI " + (isNum(c2) ? fmtSGD(c2) : "—") + " of " + fmtSGD(d.ciTarget);
      var next;
      if (d.coverageCapConflict === true) {
        next = "Full cover may exceed the 15% guideline — ask your coach.";
      } else if (d.premiumOk === false) {
        next = "Your premium is above the 15% guideline — worth a chat with your coach.";
      } else if (!isNum(inputs.monthly_insurance_premium)) {
        next = "Add your monthly premium to check the 15% spending cap.";
      } else {
        next = "Grow your cover toward the MAS targets — premium is within the cap.";
      }
      return { pct: pct, detail: detail, next: next };
    }
    if (level === 3) {
      if (!isNum(d.investMinMonthly)) {
        return { pct: 0, detail: "Add your income to set your 10% investing floor.",
                 next: "MAS guidance: invest at least 10% of take-home pay." };
      }
      var inv = inputs.monthly_investment_amount;
      return {
        pct: isNum(inv) ? Math.min(100, Math.max(0, Math.round(100 * inv / d.investMinMonthly))) : 0,
        detail: isNum(inv)
          ? fmtSGD(inv) + " of " + fmtSGD(d.investMinMonthly) + " monthly investing target"
          : "Target " + fmtSGD(d.investMinMonthly) + "/month — add your investing amount.",
        next: "Invest at least 10% of take-home pay, now that you're protected."
      };
    }
    if (level === 4) {
      return { pct: 0,
        detail: "Plan your first home and retirement with the official calculators.",
        next: "Use the CPF Home Purchase Planner and HDB calculators with your coach." };
    }
    return null; // level 1: rendered from savings{}
  }

  // Contract 3 (spec §3b + CoverageCap Part B): the SIX Botpress user
  // variables. Built here and staged for Phase 4's push (init + every
  // recalculation). Null -> "" per spec ("pass empty"); coverageCapConflict
  // is a boolean defaulting to false.
  function botpressUserVars() {
    var d = state.derived, i = state.inputs;
    var num = function (v) { return isNum(v) ? v : ""; };
    return {
      currentLevel:        state.currentLevel,
      emergencyTarget:     num(d.emergencyTargetFull),
      currentSavings:      num(i.current_savings),
      savingsProgress:     isNum(d.savingsProgressPct) ? (d.savingsProgressPct + "%") : "",
      insuranceTarget:     num(d.dtpdTarget),
      coverageCapConflict: d.coverageCapConflict === true   // 6th variable
    };
  }

  /* =================================================================
     4. BOTPRESS VARIABLE PUSH (Contract 3 §3b + coverageCapConflict)
        Method: window.botpress.updateUser({ data: {...} }) — the
        webchat client's user-data API from the existing v3.3 inject
        embed. Values travel as STRINGS (webchat user data is a
        string map); null -> "" per spec 3b ("pass empty" — coach v4
        handles the not-entered case). The bot reads them as
        {{user.currentLevel}} etc. once Sammi maps the user variables
        in Studio (coverageCapConflict arrives as "true"/"false").
        Pushed on webchat init AND after every recalculation.
     ================================================================= */
  var bpPushedOnce = false;

  function pushBotpressVars(reason) {
    var bp = window.botpress;
    if (!bp || typeof bp.updateUser !== "function") return false;
    var vars = botpressUserVars();
    var asStr = function (v) { return v === "" ? "" : String(v); };
    var data = {
      currentLevel:        String(vars.currentLevel),
      emergencyTarget:     asStr(vars.emergencyTarget),
      currentSavings:      asStr(vars.currentSavings),
      savingsProgress:     vars.savingsProgress,
      insuranceTarget:     asStr(vars.insuranceTarget),
      coverageCapConflict: vars.coverageCapConflict ? "true" : "false"
    };
    try {
      bp.updateUser({ data: data });
      bpPushedOnce = true;
      console.log("[app.js] Botpress user vars pushed (" + reason + "):", data);
      return true;
    } catch (e) {
      // Quiet while the widget is still starting up (the init/retry
      // push covers that window); loud only if pushes had worked before.
      if (bpPushedOnce) console.warn("[app.js] Botpress updateUser failed (" + reason + "):", e);
      return false;
    }
  }

  (function wireBotpressPush() {
    var bp = window.botpress;
    if (!bp) return; // page without the webchat embed (e.g. index.html)
    if (typeof bp.on === "function") {
      bp.on("webchat:ready", function () { pushBotpressVars("init"); });
      bp.on("webchat:initialized", function () { pushBotpressVars("init"); });
    }
    // Safety net: if ready fired before we subscribed (or the event
    // name differs), retry quietly until the first successful push.
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (bpPushedOnce || tries > 20) { clearInterval(timer); return; }
      pushBotpressVars("retry");
    }, 1500);
  })();

  function pushDashboard(celebrateLevel) {
    if (!window.MFC || typeof window.MFC.updateDashboard !== "function") return;
    if (!hasAnyInput()) return; // keep the sample view until real numbers exist
    var d = state.derived;
    var payload = {
      currentLevel: state.currentLevel,
      savings: {
        current: state.inputs.current_savings,
        target: isNum(d.emergencyTargetFull) ? d.emergencyTargetFull : null,
        pct: isNum(d.savingsProgressPct) ? d.savingsProgressPct : null
      },
      levels: [1, 2, 3, 4].map(function (id) {
        return {
          id: id,
          state: id < state.currentLevel ? "done"
               : id === state.currentLevel ? "current" : "locked"
        };
      })
    };
    var focus = focusFor(state.currentLevel, state.inputs, d);
    if (focus) payload.focus = focus;
    if (isNum(celebrateLevel)) payload.celebrateLevel = celebrateLevel;
    window.MFC.updateDashboard(payload);
  }

  function recompute() {
    state.derived = computeAll(state.inputs);

    // Gatekeeping (spec §2): forward-only; celebrate real level-ups only.
    var prev = state.currentLevel;
    var next = gatekeep(prev, state.inputs);
    var leveledUp = next > prev;
    state.currentLevel = next;

    state.lastUpdated = new Date().toISOString();
    saveState();
    pushDashboard(leveledUp ? next - 1 : undefined);
    pushBotpressVars("recalc"); // Contract 3: after every recalculation
    console.log("[app.js] recomputed:", JSON.parse(JSON.stringify({
      inputs: state.inputs, derived: state.derived,
      currentLevel: state.currentLevel, leveledUp: leveledUp
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
    coverageCapConflict: coverageCapConflict,
    fmtSGD: fmtSGD
  };

  // Read-only inspection surface for the staged Contract 3 variables
  // (Phase 4 will push these to Botpress; exposed now for verification).
  window.MFC.getUserVars = botpressUserVars;

  /* =================================================================
     STARTUP (Phase 2)
     - site.js fires 'mfc:dashboard-ready' when the dashboard section
       initialises; on app.html that happens BEFORE this file loads, so
       we also push directly after loading persisted state.
     - With an empty state we push nothing: the dashboard keeps its
       clearly-labelled sample view until real numbers exist.
     ================================================================= */
  document.addEventListener("mfc:dashboard-ready", function () {
    pushDashboard();
  });

  loadState();
  if (hasAnyInput()) {
    recompute(); // derives, persists, and pushes the restored numbers
  }

})();
