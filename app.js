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
    var targetMin = emergencyTargetMin(inputs.monthly_expenses);
    var targetFull = emergencyTargetFull(inputs.monthly_expenses);
    var cap = premiumCapMonthly(inputs.monthly_take_home_income);
    var investMin = investMinMonthly(inputs.monthly_take_home_income);
    var dtpd = dtpdTarget(annual);
    var ci = ciTarget(annual);
    return {
      emergencyTargetMin:  targetMin,
      emergencyTargetFull: targetFull,   // internal only (A2 transfer sizing); never displayed
      // SINGLE 3-MONTH TARGET (amendment 2026-07-06): progress measures
      // against emergencyTargetMin — ring, plan, fund note and the
      // Botpress payload all read this value.
      savingsProgressPct:  savingsProgressPct(inputs.current_savings, targetMin),
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
     2. LEVEL GATEKEEPING — ITEMS-BASED (team ruling 2026-07-06).
        A level is complete when EVERY action in it is done: see
        levelComplete() and deriveCurrentLevel() below the plan
        builders. The former numeric trio (levelCompletion/
        lowestIncomplete/gatekeep) is retired; the 3x savings threshold
        now lives inside item L1-A3's auto-completion, latched into the
        persisted status map (no-demote). Forward-only preserved:
        statuses are monotone, so the derived level can only rise.
     ================================================================= */

  /* =================================================================
     ACTION PLAN GENERATOR (Plan -> Do -> Check) — DETERMINISTIC ONLY.
     Same inputs -> same plan, every time. No LLM, no network. Reads
     the values computeAll() already derived (never re-derives MAS
     formulas). Null-safe: missing required inputs -> ready:false and
     the UI shows "enter your numbers to generate your plan".
     Action ids are stable (L1-A1...) so statuses persist in
     mfc_state_v1 across regenerations.
     ================================================================= */
  // buildLevel(n, st): the data-driven level model. Fixed action lists,
  // three completion types:
  //   attest — user-set via Mark started / Mark done
  //   auto   — derived from numbers; manual writes refused (L1-A3 only:
  //            completes at 3x expenses, latched in recompute())
  //   learn  — "Open coach" + "Mark as learned"; persisted boolean
  function buildLevel(n, st) {
    var i = st.inputs, d = st.derived || computeAll(st.inputs);
    var statuses = st.actions || {};
    function act(id, text, type, amount, coachTopic) {
      return { id: id, text: text, level: n,
               type: type || "attest",
               status: statuses[id] || "not_started",
               amount: isNum(amount) ? amount : null,
               coachTopic: coachTopic || null };
    }

    if (n === 1) {
      if (!isNum(i.monthly_expenses) || i.monthly_expenses <= 0 ||
          !isNum(i.current_savings) ||
          !isNum(i.monthly_take_home_income) || i.monthly_take_home_income <= 0) {
        return { ready: false, actions: [],
                 reason: "Enter your income, expenses and savings to generate your plan." };
      }
      var targetMin = d.emergencyTargetMin, target6 = d.emergencyTargetFull;
      var shortfall = Math.max(0, target6 - i.current_savings);
      // nearest-$50 of min(shortfall/12, 20% of take-home); floored at
      // $50 so rounding can never suggest a $0 transfer
      var raw = Math.min(shortfall / 12, 0.20 * i.monthly_take_home_income);
      var suggestedMonthly = Math.max(50, Math.round(raw / 50) * 50);
      var monthsToTarget = suggestedMonthly > 0 ? Math.ceil(shortfall / suggestedMonthly) : 0;

      // SINGLE 3-MONTH TARGET (amendment): one target everywhere — the
      // item, the ring and the pct all measure emergencyTargetMin.
      var a3 = act("L1-A3",
        "Build your 3-month safety net (" + fmtSGD(targetMin) + "). Completes automatically when you reach it.",
        "auto", targetMin);
      a3.auto = true;
      a3.progressPct = isNum(d.savingsProgressPct) ? d.savingsProgressPct : 0; // vs 3x, matches the ring
      // Completes + latches (no-demote) at emergencyTargetMin.
      a3.status = (statuses["L1-A3"] === "done" ||
                   (isNum(targetMin) && i.current_savings >= targetMin))
                  ? "done" : "not_started";

      return { ready: true,
        meta: { target6: target6, targetMin: targetMin, shortfall: shortfall,
                suggestedMonthly: suggestedMonthly, monthsToTarget: monthsToTarget },
        actions: [
          act("L1-A1", "Open a high-yield savings account as your emergency-fund home."),
          act("L1-A2", "Set up an automatic " + fmtSGD(suggestedMonthly) + " transfer on payday into that savings account.", "attest", suggestedMonthly),
          a3,
          act("L1-A5", "Learn the Save First, Spend Later rule.", "learn", null, "the Save First, Spend Later rule"),
          act("L1-A6", "Learn to tell needs from wants.", "learn", null, "needs versus wants")
        ] };
    }

    if (n === 2) {
      return { ready: true, actions: [
        act("L2-B1L", "Learn what baseline protection means.", "learn", null, "baseline insurance protection in Singapore"),
        act("L2-B2", "Get insurance cover for Death & TPD (aim 9× annual income).", "attest",
            isNum(d.dtpdTarget) ? d.dtpdTarget : null),
        act("L2-B3", "Get insurance cover for Critical Illness (aim 4× annual income).", "attest",
            isNum(d.ciTarget) ? d.ciTarget : null),
        act("L2-B4L", "Learn what MediShield Life covers.", "learn", null, "MediShield Life"),
        act("L2-B5", "Verify your MediShield Life coverage status.")
      ] };
    }

    if (n === 3) {
      return { ready: true, actions: [
        act("L3-C0", "Learn the main types of investment.", "learn", null, "the main types of investment"),
        act("L3-C2L", "Learn the Rule of 72.", "learn", null, "the Rule of 72"),
        act("L3-C1", "Set up an investment fund and allocate monthly into low-risk, long-term investments (aim ≥10% of take-home pay).", "attest",
            isNum(d.investMinMonthly) ? d.investMinMonthly : null)
      ] };
    }

    // Level 4 — kept exactly as built: official tools only, no regulated
    // figures; unlock precondition routes through levelComplete(3).
    return { ready: true, actions: [
      act("L4-D1", "Use the CPF Home Purchase Planner to see what you can afford."),
      act("L4-D2", "Use HDB's budget calculator before committing to a flat."),
      act("L4-D3", "Make a CPF top-up for tax relief and retirement compounding.")
    ] };
  }

  // All-items gating: level n is complete <=> ready AND every action done.
  function levelComplete(n, st) {
    var lv = buildLevel(n, st);
    return lv.ready && lv.actions.length > 0 &&
           lv.actions.every(function (a) { return a.status === "done"; });
  }

  // Checklist completion for the ring (team ruling 2026-07-06): the dial
  // shows items done / items total — 100% means the level is closed.
  function levelItemsPct(n, st) {
    var lv = buildLevel(n, st);
    if (!lv.ready || lv.actions.length === 0) return { done: 0, total: 0, pct: null };
    var done = lv.actions.filter(function (a) { return a.status === "done"; }).length;
    return { done: done, total: lv.actions.length,
             pct: Math.round(100 * done / lv.actions.length) };
  }

  // currentLevel = the first incomplete level; 4 is the final home.
  function deriveCurrentLevel(st) {
    if (!levelComplete(1, st)) return 1;
    if (!levelComplete(2, st)) return 2;
    if (!levelComplete(3, st)) return 3;
    return 4;
  }

  // Back-compatible single-level view used by getPlan()/renderPlan().
  function generatePlan(st) {
    var lvl = st.currentLevel || deriveCurrentLevel(st);
    var lv = buildLevel(lvl, st);
    return {
      level: lvl, ready: lv.ready, reason: lv.reason, meta: lv.meta,
      complete: lv.ready && lv.actions.length > 0 &&
                lv.actions.every(function (a) { return a.status === "done"; }),
      actions: lv.actions
    };
  }

  // ONE selector for the "THIS WEEK" hero and the Telegram contract:
  // the first incomplete action in the first incomplete level, walking
  // across levels.
  function nextAction(st) {
    for (var n = 1; n <= 4; n++) {
      var lv = buildLevel(n, st);
      if (!lv.ready) return null; // plan can't be generated yet
      for (var k = 0; k < lv.actions.length; k++) {
        if (lv.actions[k].status !== "done") return lv.actions[k];
      }
    }
    return null; // everything done
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
    /* ---- Data-driven level model + items-based gating (2026-07-06) ---- */
    (function () {
      var BASE = {
        monthly_take_home_income: 2800, monthly_expenses: 1400,
        current_savings: 4956, monthly_insurance_premium: null,
        dtpd_coverage_amount: null, critical_illness_coverage_amount: null,
        monthly_investment_amount: null
      };
      function mk(over, actions) {
        var inputs = {};
        Object.keys(BASE).forEach(function (k) { inputs[k] = BASE[k]; });
        Object.keys(over || {}).forEach(function (k) { inputs[k] = over[k]; });
        return { inputs: inputs, derived: computeAll(inputs), actions: actions || {} };
      }
      function merge() {
        var out = {};
        for (var a = 0; a < arguments.length; a++) {
          var m = arguments[a], ks = Object.keys(m);
          for (var j = 0; j < ks.length; j++) out[ks[j]] = m[ks[j]];
        }
        return out;
      }
      var L1_MANUAL = { "L1-A1": "done", "L1-A2": "done", "L1-A5": "done", "L1-A6": "done" };
      var L2_ALL = { "L2-B1L": "done", "L2-B2": "done", "L2-B3": "done", "L2-B4L": "done", "L2-B5": "done" };
      var L3_ALL = { "L3-C0": "done", "L3-C2L": "done", "L3-C1": "done" };

      // Structure
      var l1 = buildLevel(1, mk());
      check("S1 L1: 5 items, attest/attest/auto/learn/learn, ids A1,A2,A3,A5,A6",
        l1.actions.length === 5 &&
        l1.actions.map(function (a) { return a.type; }).join() === "attest,attest,auto,learn,learn" &&
        l1.actions.map(function (a) { return a.id; }).join() === "L1-A1,L1-A2,L1-A3,L1-A5,L1-A6");
      var l2 = buildLevel(2, mk());
      check("S2 L2: 5 fixed items, learn/attest/attest/learn/attest, 2.5 = verify MediShield",
        l2.actions.length === 5 &&
        l2.actions.map(function (a) { return a.type; }).join() === "learn,attest,attest,learn,attest" &&
        l2.actions[4].text.indexOf("Verify your MediShield Life") !== -1);
      var l3 = buildLevel(3, mk());
      check("S3 L3: 3 items, learn/learn/attest",
        l3.actions.length === 3 &&
        l3.actions.map(function (a) { return a.type; }).join() === "learn,learn,attest");
      var l4 = buildLevel(4, mk());
      check("S4 L4 kept as built: 3 attest items D1-D3",
        l4.actions.length === 3 &&
        l4.actions.every(function (a) { return a.type === "attest"; }) &&
        l4.actions[0].id === "L4-D1");
      var allIds = [];
      [1, 2, 3, 4].forEach(function (n) {
        buildLevel(n, mk()).actions.forEach(function (a) { allIds.push(a.id); });
      });
      check("S5 no L1-A4 (SSB) and no L1-A0 remain",
        allIds.indexOf("L1-A4") === -1 && allIds.indexOf("L1-A0") === -1);
      check("S6 dynamic values: A2 $300; A3 exact single-target text",
        l1.actions[1].text.indexOf("$300") !== -1 &&
        l1.actions[2].text === "Build your 3-month safety net ($4,200). Completes automatically when you reach it." &&
        l1.actions[2].amount === 4200);
      check("S7 L1 not ready on null inputs",
        buildLevel(1, { inputs: { monthly_take_home_income: null, monthly_expenses: null,
          current_savings: null, monthly_insurance_premium: null, dtpd_coverage_amount: null,
          critical_illness_coverage_amount: null, monthly_investment_amount: null },
          derived: null, actions: {} }).ready === false);

      // Amendment: 1.3 completes at 3x (emergencyTargetMin), latched
      check("A1 1.3 not done below 3x (savings 4199)",
        buildLevel(1, mk({ current_savings: 4199 })).actions[2].status !== "done");
      check("A2 1.3 auto-done at 3x (savings 4200)",
        buildLevel(1, mk({ current_savings: 4200 })).actions[2].status === "done");
      check("A3 latch survives a later drop below 3x",
        buildLevel(1, mk({ current_savings: 100 }, { "L1-A3": "done" })).actions[2].status === "done");
      check("A4 L1 needs ALL 5: manual 4 done + savings 4199 -> incomplete",
        levelComplete(1, mk({ current_savings: 4199 }, L1_MANUAL)) === false);
      check("A5 L1 complete: manual 4 done + savings >= 3x",
        levelComplete(1, mk({}, L1_MANUAL)) === true);

      // Items-based gating + cross-level selector
      check("N1 4/5 L1 done -> still level 1",
        deriveCurrentLevel(mk({}, { "L1-A1": "done", "L1-A2": "done", "L1-A5": "done" })) === 1);
      check("N2 all L1 done -> level 2; nextAction walks to L2-B1L",
        deriveCurrentLevel(mk({}, L1_MANUAL)) === 2 &&
        nextAction(mk({}, L1_MANUAL)).id === "L2-B1L");
      check("N3 L2 4/5 done -> still level 2",
        deriveCurrentLevel(mk({}, merge(L1_MANUAL,
          { "L2-B1L": "done", "L2-B2": "done", "L2-B3": "done", "L2-B4L": "done" }))) === 2);
      check("N4 all L1+L2 done -> level 3; next is L3-C0",
        deriveCurrentLevel(mk({}, merge(L1_MANUAL, L2_ALL))) === 3 &&
        nextAction(mk({}, merge(L1_MANUAL, L2_ALL))).id === "L3-C0");
      check("N5 L4 unlocks only via levelComplete(3); next is L4-D1",
        deriveCurrentLevel(mk({}, merge(L1_MANUAL, L2_ALL, L3_ALL))) === 4 &&
        nextAction(mk({}, merge(L1_MANUAL, L2_ALL, L3_ALL))).id === "L4-D1");
      var DONE_ALL = merge(L1_MANUAL, L2_ALL, L3_ALL,
        { "L4-D1": "done", "L4-D2": "done", "L4-D3": "done" });
      check("N6 everything done -> nextAction null, level stays 4",
        nextAction(mk({}, DONE_ALL)) === null && deriveCurrentLevel(mk({}, DONE_ALL)) === 4);

      // Every attest/learn item completes via the persisted status map
      var completable = [];
      [1, 2, 3, 4].forEach(function (n) {
        buildLevel(n, mk()).actions.forEach(function (a) {
          if (a.type !== "auto") completable.push(a.id);
        });
      });
      var okAll = completable.every(function (id) {
        var m = {}; m[id] = "done";
        var st2 = mk({}, m);
        var found = null;
        [1, 2, 3, 4].some(function (n) {
          return buildLevel(n, st2).actions.some(function (a) {
            if (a.id === id) { found = a.status; return true; }
            return false;
          });
        });
        return found === "done";
      });
      check("N7 all " + completable.length + " attest/learn items persist done via the status map", okAll === true);

      // Single 3-month target (amendment): pct is 3x-based end to end
      check("T1 computeAll pct vs 3x: savings 3024 -> 72%",
        computeAll(mk({ current_savings: 3024 }).inputs).savingsProgressPct === 72);
      check("T2 computeAll pct vs 3x: savings 5000 -> 100% (clamped)",
        computeAll(mk({ current_savings: 5000 }).inputs).savingsProgressPct === 100);
      check("T3 1.3 done at >= 3x with pct 100",
        (function () {
          var lv = buildLevel(1, mk({ current_savings: 5000 }));
          return lv.actions[2].status === "done" && lv.actions[2].progressPct === 100;
        })());
      // Audit: no user-facing string references the 6-month figure
      check("T4 no '6-month'/'6 months'/'$8,400' in any rendered plan or focus output",
        (function () {
          var texts = [];
          var st6 = mk({ current_savings: 5000 });
          [1, 2, 3, 4].forEach(function (n) {
            buildLevel(n, st6).actions.forEach(function (a) {
              texts.push(a.text || ""); texts.push(a.autoHint || "");
            });
          });
          [2, 3, 4].forEach(function (n) {
            var f = focusFor(n, st6.inputs, st6.derived) || {};
            texts.push(f.detail || ""); texts.push(f.next || "");
          });
          texts.push(fundProgressNote(st6.derived, 2) || "");
          return texts.every(function (t) {
            return t.indexOf("6-month") === -1 && t.indexOf("6 months") === -1 &&
                   t.indexOf("$8,400") === -1;
          });
        })());
    })();
    // Fund-note + focus-ring honesty (rewording per amendment)
    (function () {
      var in5000 = { monthly_take_home_income: 2800, monthly_expenses: 1400,
        current_savings: 5000, monthly_insurance_premium: null,
        dtpd_coverage_amount: null, critical_illness_coverage_amount: null,
        monthly_investment_amount: null };
      var d5000 = computeAll(in5000);
      check("F1 fund note exact wording per single-target amendment",
        fundProgressNote(d5000, 2) === "Emergency fund · 100% of $4,200 (3-month minimum safety net)");
      check("F2 fund note null while still on level 1",
        fundProgressNote(d5000, 1) === null);
      var dNull = computeAll({ monthly_take_home_income: null, monthly_expenses: null,
        current_savings: null, monthly_insurance_premium: null, dtpd_coverage_amount: null,
        critical_illness_coverage_amount: null, monthly_investment_amount: null });
      check("F3 fund note null-safe on missing inputs",
        fundProgressNote(dNull, 2) === null);
      var noCover = in5000;
      check("F4 L2 money-pct is null with no cover data",
        focusFor(2, noCover, computeAll(noCover)).moneyPct === null);
      var withCover = { monthly_take_home_income: 2800, monthly_expenses: 1400,
        current_savings: 5000, monthly_insurance_premium: null, dtpd_coverage_amount: 100000,
        critical_illness_coverage_amount: 50000, monthly_investment_amount: null };
      check("F5 L2 money-pct numeric once both covers entered",
        focusFor(2, withCover, computeAll(withCover)).moneyPct === 33);
      // Cover targets reached but checklist open -> item-count next-step
      var fullCover = { monthly_take_home_income: 2800, monthly_expenses: 1400,
        current_savings: 5000, monthly_insurance_premium: 400, dtpd_coverage_amount: 302400,
        critical_illness_coverage_amount: 134400, monthly_investment_amount: null };
      var f100 = focusFor(2, fullCover, computeAll(fullCover), {});
      check("F6 cover money-pct 100% + items open -> checklist next-step",
        f100.moneyPct === 100 &&
        f100.next === "Cover targets reached — 5 checklist items left to complete this level.");
      var f100b = focusFor(2, fullCover, computeAll(fullCover),
        { "L2-B1L": "done", "L2-B2": "done", "L2-B3": "done", "L2-B4L": "done" });
      check("F7 remaining count reflects statuses (1 item left)",
        f100b.next === "Cover targets reached — 1 checklist item left to complete this level.");
      // RING = checklist completion (team ruling): 1 of 5 done -> 20%
      var stR = { inputs: fullCover, derived: computeAll(fullCover),
                  actions: { "L2-B1L": "done" } };
      check("R1 ring pct is items-based: 1 of 5 L2 items done -> 20%",
        levelItemsPct(2, stR).pct === 20 && levelItemsPct(2, stR).done === 1 &&
        levelItemsPct(2, stR).total === 5);
      var stR1 = { inputs: fullCover, derived: computeAll(fullCover), actions: {} };
      check("R2 uniform at L1: only latched 1.3 done -> 20% (1 of 5)",
        levelItemsPct(1, stR1).pct === 20); // savings 5000 >= 4200 auto-completes 1.3
      check("R3 not-ready level -> pct null (ring em-dash)",
        levelItemsPct(1, { inputs: { monthly_take_home_income: null, monthly_expenses: null,
          current_savings: null, monthly_insurance_premium: null, dtpd_coverage_amount: null,
          critical_illness_coverage_amount: null, monthly_investment_amount: null },
          derived: null, actions: {} }).pct === null);
    })();
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
    currentLevel: 1,     // derived from items-based gating (deriveCurrentLevel)
    actions: {},         // action-plan statuses: id -> not_started|started|done
    settings: {          // coach-event opt-in — BOTH must be set to fire;
      tgChatId: "",      // either blank means events are OFF (no network)
      n8nWebhook: ""
    },
    lastUpdated: null
  };
  FIELDS.forEach(function (k) { state.inputs[k] = null; });

  var ACTION_STATUSES = ["not_started", "started", "done"];

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
        actions: state.actions,
        settings: state.settings,
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
    if (saved.actions && typeof saved.actions === "object") {
      Object.keys(saved.actions).forEach(function (id) {
        if (ACTION_STATUSES.indexOf(saved.actions[id]) !== -1) {
          state.actions[id] = saved.actions[id];
        }
      });
    }
    // settings are additive to the v1 schema — older saves simply keep
    // the blank defaults (events OFF) instead of forcing a version bump.
    if (saved.settings && typeof saved.settings === "object") {
      if (typeof saved.settings.tgChatId === "string") state.settings.tgChatId = saved.settings.tgChatId;
      if (typeof saved.settings.n8nWebhook === "string") state.settings.n8nWebhook = saved.settings.n8nWebhook;
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
  // statuses (optional): the persisted action-status map — used to count
  // remaining checklist items when the money dial reaches 100%, so
  // completion language only ever comes from the checklist.
  function focusFor(level, inputs, d, statuses) {
    function itemsLeft(n) {
      return buildLevel(n, { inputs: inputs, derived: d, actions: statuses || {} })
        .actions.filter(function (a) { return a.status !== "done"; }).length;
    }
    if (level === 2) {
      if (!isNum(d.dtpdTarget)) {
        return { detail: "Add your income so your coach can size your cover targets.",
                 next: "Your Death & TPD and CI targets come from 9x / 4x annual income." };
      }
      var c1 = inputs.dtpd_coverage_amount, c2 = inputs.critical_illness_coverage_amount;
      // pct is NULL (ring shows "—") until BOTH covers are entered —
      // no data is not the same as 0% cover (null discipline).
      var pct = (isNum(c1) && isNum(c2))
        ? Math.min(100, Math.max(0, Math.round(100 * Math.min(c1 / d.dtpdTarget, c2 / d.ciTarget))))
        : null;
      var detail = "Death & TPD " + (isNum(c1) ? fmtSGD(c1) : "—") + " of " + fmtSGD(d.dtpdTarget) +
                   " · CI " + (isNum(c2) ? fmtSGD(c2) : "—") + " of " + fmtSGD(d.ciTarget);
      var next, left2 = itemsLeft(2);
      if (pct === 100 && left2 > 0) {
        // money dial full but the level completes on ITEMS, not amounts
        next = "Cover targets reached — " + left2 + " checklist item" + (left2 === 1 ? "" : "s") + " left to complete this level.";
      } else if (d.coverageCapConflict === true) {
        next = "Full cover may exceed the 15% guideline — ask your coach.";
      } else if (d.premiumOk === false) {
        next = "Your premium is above the 15% guideline — worth a chat with your coach.";
      } else if (!isNum(inputs.monthly_insurance_premium)) {
        next = "Add your monthly premium to check the 15% spending cap.";
      } else {
        next = "Grow your cover toward the MAS targets — premium is within the cap.";
      }
      // moneyPct informational only (ring is items-based upstream)
      return { moneyPct: pct, detail: detail, next: next };
    }
    if (level === 3) {
      if (!isNum(d.investMinMonthly)) {
        return { detail: "Add your income to set your 10% investing floor.",
                 next: "MAS guidance: invest at least 10% of take-home pay." };
      }
      var inv = inputs.monthly_investment_amount;
      var pct3 = isNum(inv) ? Math.min(100, Math.max(0, Math.round(100 * inv / d.investMinMonthly))) : null;
      var left3 = itemsLeft(3);
      return {
        moneyPct: pct3,
        detail: isNum(inv)
          ? fmtSGD(inv) + " of " + fmtSGD(d.investMinMonthly) + " monthly investing target"
          : "Target " + fmtSGD(d.investMinMonthly) + "/month — add your investing amount.",
        next: (pct3 === 100 && left3 > 0)
          ? "Investing target reached — " + left3 + " checklist item" + (left3 === 1 ? "" : "s") + " left to complete this level."
          : "Invest at least 10% of take-home pay, now that you're protected."
      };
    }
    if (level === 4) {
      return { pct: null,   // no numeric target — official calculators own this
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
      // Single 3-month target (amendment): emergencyTarget now carries
      // emergencyTargetMin so the coach's target matches savingsProgress
      // and the dashboard. SAMMI note: Contract 3's emergencyTarget was
      // previously the 6x figure.
      emergencyTarget:     num(d.emergencyTargetMin),
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
  var bpPushedOnce = false; // updateUser succeeded at least once
  var bpEventOnce = false;  // mfc_user_data event delivered at least once

  function buildVarStrings() {
    var vars = botpressUserVars();
    var asStr = function (v) { return v === "" ? "" : String(v); };
    return {
      currentLevel:        String(vars.currentLevel),
      emergencyTarget:     asStr(vars.emergencyTarget),
      currentSavings:      asStr(vars.currentSavings),
      savingsProgress:     vars.savingsProgress,
      insuranceTarget:     asStr(vars.insuranceTarget),
      coverageCapConflict: vars.coverageCapConflict ? "true" : "false"
    };
  }

  function pushBotpressVars(reason) {
    var bp = window.botpress;
    if (!bp) return false;
    var data = buildVarStrings();

    // Channel 1 — user record (Contract 3 as documented): updateUser.
    if (typeof bp.updateUser === "function") {
      try {
        bp.updateUser({ data: data });
        bpPushedOnce = true;
        console.log("[app.js] Botpress user vars pushed (" + reason + "):", data);
      } catch (e) {
        // Quiet while the widget is still starting up; loud only if
        // pushes had worked before.
        if (bpPushedOnce) console.warn("[app.js] Botpress updateUser failed (" + reason + "):", e);
      }
    }

    // Channel 2 — conversation event for the Studio Custom Trigger
    // ("mfc_user_data"): lands bound to the runtime user/conversation,
    // where an Execute Code card writes the user.* variables directly.
    // Wire shape (verified): POST /events with
    //   payload: { type: "custom", data: { type: "mfc_user_data", ... } }
    // so Studio reads the fields at event.payload.data.*
    if (typeof bp.sendEvent === "function") {
      try {
        var evt = { type: "mfc_user_data" };
        Object.keys(data).forEach(function (k) { evt[k] = data[k]; });
        Promise.resolve(bp.sendEvent(evt)).then(function () {
          bpEventOnce = true;
          console.log("[app.js] Botpress mfc_user_data event sent (" + reason + "):", evt);
        }).catch(function (e) {
          // needs an open conversation; init retries + recalcs cover it
          if (bpEventOnce) console.warn("[app.js] mfc_user_data event failed (" + reason + "):", e);
        });
      } catch (e) {
        if (bpEventOnce) console.warn("[app.js] mfc_user_data event failed (" + reason + "):", e);
      }
    }
    return bpPushedOnce;
  }

  (function wireBotpressPush() {
    var bp = window.botpress;
    if (!bp) return; // page without the webchat embed (e.g. index.html)
    if (typeof bp.on === "function") {
      bp.on("webchat:ready", function () { pushBotpressVars("init"); });
      bp.on("webchat:initialized", function () { pushBotpressVars("init"); });
    }
    // Safety net: retry quietly until BOTH channels have delivered once
    // (the event channel needs the conversation the auto-open creates).
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if ((bpPushedOnce && bpEventOnce) || tries > 20) { clearInterval(timer); return; }
      pushBotpressVars("retry");
    }, 1500);
  })();

  /* =================================================================
     5. n8n WORKFLOW C LEVEL SYNC (Contract 4 / spec §3d) — OPTIONAL,
        OFF BY DEFAULT. The Workflow C webhook endpoint isn't built yet,
        so level changes are updated in the CoachStore sheet manually
        for the demo (documented scoping decision). To enable, set
        BEFORE app.js loads (see the RAINIE comment in app.html):
          window.MFC_CONFIG = { workflowCUrl: "<n8n webhook url>" };
        Fires only on a REAL level change, POSTing Contract 4's exact
        body: { "user_id": "user1", "current_level": <n> }.
     ================================================================= */
  function pushLevelSync(newLevel) {
    var cfg = window.MFC_CONFIG || {};
    if (!cfg.workflowCUrl) return; // flag OFF -> skip silently
    try {
      fetch(cfg.workflowCUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: (window.MFC && window.MFC.userId) || "user1",
          current_level: newLevel
        })
      }).then(function (r) {
        console.log("[app.js] Workflow C level sync sent: level " + newLevel + " (HTTP " + r.status + ")");
      }).catch(function (e) {
        console.warn("[app.js] Workflow C level sync failed (non-fatal):", e);
      });
    } catch (e) {
      console.warn("[app.js] Workflow C level sync failed (non-fatal):", e);
    }
  }

  /* =================================================================
     COACH EVENTS — item_done / level_done to the self-hosted n8n
     webhook. Opt-in: fires ONLY when both settings.tgChatId and
     settings.n8nWebhook are set; either blank = hard no-op. The app
     NEVER calls Telegram directly — the bot token stays server-side
     in n8n; we only pass the chat id through. Fire-and-forget: never
     blocks the UI, never throws (try/catch + .catch(()=>{})).
     `var fn = function` so the self-tests can swap in a capture mock.
     ================================================================= */
  var fireCoachEvent = function (payload) {
    try {
      var s = state.settings || {};
      if (!s.tgChatId || !s.n8nWebhook) return; // opt-in not configured
      fetch(s.n8nWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ chatId: s.tgChatId }, payload)),
        keepalive: true // let an in-flight send survive navigation
      }).catch(function () { /* network failure is deliberately silent */ });
    } catch (e) { /* never blocks or throws into the UI */ }
  };

  function emitItemDone(action) {
    var na = nextAction(state);
    fireCoachEvent({
      event: "item_done",
      itemId: action.id,
      itemText: action.text,
      level: action.level,
      nextActionText: na ? na.text : null
    });
  }

  // Session-scope dedupe on top of the monotone currentLevel guards:
  // one level_done per level, whichever call site gets there first.
  var emittedLevels = {};

  function emitLevelDone(levelNum, levelName) {
    if (emittedLevels[levelNum]) return;
    emittedLevels[levelNum] = true;
    var na = nextAction(state);
    fireCoachEvent({
      event: "level_done",
      level: levelNum,
      levelName: levelName,
      nextActionText: na ? na.text : null
    });
  }

  // UX note for the completed Level 1 rows: L1 unlocks at 3x expenses,
  // but the 6x stretch target keeps filling — keep that progress visible
  // so "Done" is never mistaken for "fund complete". Null-safe.
  function fundProgressNote(d, currentLevel) {
    if (currentLevel <= 1) return null;
    if (!isNum(d.savingsProgressPct) || !isNum(d.emergencyTargetMin)) return null;
    return "Emergency fund · " + d.savingsProgressPct + "% of " + fmtSGD(d.emergencyTargetMin) +
           " (3-month minimum safety net)";
  }

  function pushDashboard(celebrateLevel) {
    if (!window.MFC || typeof window.MFC.updateDashboard !== "function") return;
    if (!hasAnyInput()) return; // keep the sample view until real numbers exist
    var d = state.derived;
    var payload = {
      currentLevel: state.currentLevel,
      fundNote: fundProgressNote(d, state.currentLevel),
      savings: {
        current: state.inputs.current_savings,
        // single 3-month target: the ring/bar target is emergencyTargetMin
        target: isNum(d.emergencyTargetMin) ? d.emergencyTargetMin : null,
        pct: isNum(d.savingsProgressPct) ? d.savingsProgressPct : null
      },
      levels: [1, 2, 3, 4].map(function (id) {
        return {
          id: id,
          // the final level has no successor, so "current" must yield to
          // "done" when its own checklist is complete
          state: id < state.currentLevel ? "done"
               : id === state.currentLevel
                 ? (levelComplete(id, state) ? "done" : "current")
                 : "locked"
        };
      }),
      // everything done: lets the dashboard render its all-complete state
      allComplete: state.currentLevel === 4 && levelComplete(4, state)
    };
    // Focus card: detail/next stay money-facts (from focusFor), but the
    // RING is checklist completion — 100% only when the level is closed.
    var focus = focusFor(state.currentLevel, state.inputs, d, state.actions) || {};
    var ip = levelItemsPct(state.currentLevel, state);
    focus.pct = ip.pct;                 // items done / total (null when not ready)
    focus.ringCaption = "level complete";
    payload.focus = focus;
    // Middle stat card: same items-done source as the ring. total === 0
    // means the level isn't ready yet -> site.js keeps its placeholder.
    payload.itemsDone = { done: ip.done, total: ip.total };
    if (isNum(celebrateLevel)) payload.celebrateLevel = celebrateLevel;
    window.MFC.updateDashboard(payload);
  }

  function recompute() {
    state.derived = computeAll(state.inputs);

    // Latch the 1.3 auto-milestone at 3 MONTHS (emergencyTargetMin) into
    // the persisted status map — no-demote: a later savings dip can never
    // re-lock the item or Level 2 (amendment 2026-07-06). The `!== "done"`
    // guard doubles as the once-only gate for the item_done event: on
    // every later save (and on reload) the latch is already done, so the
    // emit below can never re-fire.
    var autoLatched = null;
    if (isNum(state.derived.emergencyTargetMin) &&
        isNum(state.inputs.current_savings) &&
        state.inputs.current_savings >= state.derived.emergencyTargetMin &&
        state.actions["L1-A3"] !== "done") {
      state.actions["L1-A3"] = "done";
      autoLatched = buildLevel(1, state).actions.filter(function (a) {
        return a.id === "L1-A3";
      })[0] || null;
    }

    // Items-based gating: level = first incomplete level (forward-only;
    // statuses are monotone so this can only move up).
    var prev = state.currentLevel;
    var next = Math.max(prev, deriveCurrentLevel(state));
    var leveledUp = next > prev;
    state.currentLevel = next;

    // Coach events — item first, then any level(s) it closed, so the
    // user reads the messages in that order.
    if (autoLatched) emitItemDone(autoLatched);
    if (leveledUp) {
      for (var L = prev; L < next; L++) emitLevelDone(L, PLAN_TITLES[L]);
    }

    state.lastUpdated = new Date().toISOString();
    saveState();
    pushDashboard(leveledUp ? next - 1 : undefined);
    pushBotpressVars("recalc"); // Contract 3: after every recalculation
    if (leveledUp) pushLevelSync(next); // Contract 4 (no-op while flag OFF)
    renderPlan(); // plan amounts/level follow the numbers deterministically
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

    // Blank-hint counts only the three panel fields; the other four
    // (premium, DTPD, CI, investing) arrive via the coach chat.
    var CORE_FIELDS = ["monthly_take_home_income", "monthly_expenses", "current_savings"];
    var missing = CORE_FIELDS.filter(function (k) { return state.inputs[k] === null; }).length;
    showEntryStatus("saved",
      "Got it — " + accepted + " number" + (accepted === 1 ? "" : "s") + " saved." +
      (missing ? " (" + missing + " of 3 still blank — add them any time.)"
               : " Basics all in — share insurance and investing details with your coach any time."));
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
  /* =================================================================
     ACTION PLAN PANEL (Phase 2 UI) — renders generatePlan(state) into
     #planPanel. Current level = active checklist; earlier levels
     collapse to Done rows; later levels show locked previews.
     Status changes persist to mfc_state_v1; completing every action
     of the current level advances the level and fires the existing
     celebration toast (via pushDashboard's celebrateLevel).
     ================================================================= */
  var PLAN_TITLES = {
    1: "Emergency fund & money management",
    2: "Insurance protection",
    3: "Investing",
    4: "Home & retirement"
  };
  var CHECK_PATH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

  function renderPlan() {
    var panel = document.getElementById("planPanel");
    if (!panel) return;
    var q = function (k) { return panel.querySelector('[data-plan="' + k + '"]'); };
    var plan = generatePlan(state);
    var cur = state.currentLevel;

    // Done strip (completed levels) + locked strip (future levels)
    var doneHtml = "", lockedHtml = "";
    for (var n = 1; n <= 4; n++) {
      if (n < cur) {
        var note = (n === 1) ? fundProgressNote(state.derived, cur) : null;
        doneHtml += '<li class="plan-lvl is-done"><span class="plan-lvl-check">' + CHECK_PATH +
                    '</span>Level ' + n + " · " + PLAN_TITLES[n] + '<span class="plan-lvl-tag">Done</span>' +
                    (note ? '<span class="plan-lvl-note">' + note + '</span>' : '') + '</li>';
      } else if (n > cur) {
        lockedHtml += '<li class="plan-lvl is-locked">Level ' + n + " · " + PLAN_TITLES[n] +
                      '<span class="plan-lvl-tag">Locked</span></li>';
      }
    }
    q("done-strip").innerHTML = doneHtml;
    q("locked-strip").innerHTML = lockedHtml;

    var list = q("list"), hero = q("hero"), empty = q("empty"), progress = q("progress");
    list.innerHTML = "";

    if (!plan.ready) {
      hero.hidden = true; progress.hidden = true;
      empty.hidden = false;
      empty.textContent = plan.reason || "Enter your numbers to generate your plan.";
      return;
    }
    if (plan.complete || plan.actions.length === 0) {
      hero.hidden = true; progress.hidden = true;
      empty.hidden = false;
      empty.textContent = "Level " + plan.level + " complete — nice work.";
      return;
    }

    empty.hidden = true;
    var doneCount = plan.actions.filter(function (a) { return a.status === "done"; }).length;
    progress.hidden = false;
    progress.textContent = doneCount + " of " + plan.actions.length + " actions done";

    // Next Best Action = same cross-level selection getCurrentAction() uses
    var nba = nextAction(state);
    if (nba) {
      hero.hidden = false;
      q("hero-text").textContent = nba.text;
    } else {
      hero.hidden = true;
    }

    plan.actions.forEach(function (a) {
      var li = document.createElement("li");
      li.className = "plan-task" + (a.status === "done" ? " is-done" : a.status === "started" ? " is-started" : "");
      if (a.auto) li.className += " is-auto";
      var box = document.createElement("span");
      box.className = "plan-box";
      box.setAttribute("aria-hidden", "true");
      if (a.status === "done") box.innerHTML = CHECK_PATH;
      var text = document.createElement("span");
      text.className = "plan-text";
      text.textContent = a.text;
      if (a.auto && a.status !== "done" && a.autoHint) {
        var hint = document.createElement("span");
        hint.className = "plan-gate-hint";
        hint.textContent = a.autoHint;
        text.appendChild(hint);
      }
      var btns = document.createElement("span");
      btns.className = "plan-btns";
      if (a.type === "auto") {
        // auto milestone: NO buttons — status derives from the numbers
        btns.innerHTML = (a.status === "done")
          ? '<span class="plan-lvl-tag">Done</span>'
          : '<span class="plan-lvl-tag is-auto-tag">' +
            (isNum(a.progressPct) ? a.progressPct + "% there" : "Auto") + '</span>';
      } else if (a.type === "learn") {
        // learn item: open the embedded coach + mark as learned
        btns.innerHTML = (a.status === "done")
          ? '<span class="plan-lvl-tag">Done</span>'
          : '<button class="btn btn-ghost btn-xs" type="button" data-plan-coach>Open coach</button>' +
            '<button class="btn btn-accent btn-xs" type="button" data-plan-set="done" data-id="' + a.id + '">Mark as learned</button>';
      } else if (a.status === "not_started") {
        btns.innerHTML = '<button class="btn btn-ghost btn-xs" type="button" data-plan-set="started" data-id="' + a.id + '">Mark started</button>' +
                         '<button class="btn btn-accent btn-xs" type="button" data-plan-set="done" data-id="' + a.id + '">Mark done</button>';
      } else if (a.status === "started") {
        btns.innerHTML = '<span class="plan-lvl-tag is-started-tag">Started</span>' +
                         '<button class="btn btn-accent btn-xs" type="button" data-plan-set="done" data-id="' + a.id + '">Mark done</button>';
      } else {
        btns.innerHTML = '<span class="plan-lvl-tag">Done</span>';
      }
      li.appendChild(box); li.appendChild(text); li.appendChild(btns);
      list.appendChild(li);
    });
  }

  function setActionStatus(id, status) {
    if (ACTION_STATUSES.indexOf(status) === -1) return;
    // Handler-level guard: auto items (L1-A3) derive their status from
    // the numbers — a manual/forged write can never set OR overwrite
    // them, regardless of which level is current. learn/attest allowed.
    // The same walk captures the action object for the item_done emit.
    var theAction = null;
    for (var n = 1; n <= 4; n++) {
      var lvv = buildLevel(n, state);
      for (var k = 0; k < lvv.actions.length; k++) {
        if (lvv.actions[k].id === id) {
          if (lvv.actions[k].type === "auto") {
            renderPlan(); // refresh any stale buttons
            return;
          }
          theAction = lvv.actions[k];
        }
      }
    }
    // capture the final-level completion transition before writing
    var allBefore = state.currentLevel === 4 && levelComplete(4, state);
    // prior status distinguishes a first-time transition from a re-write
    var prior = state.actions[id];

    state.actions[id] = status;
    state.lastUpdated = new Date().toISOString();
    saveState();

    // Coach event: fire ONLY on the transition INTO "done" — never on
    // re-writes of an already-done item, never on "started". Emitted
    // before the level check below so item_done precedes level_done.
    if (status === "done" && prior !== "done" && theAction) {
      emitItemDone(theAction);
    }

    // Items-based gating: advancing = the derived first-incomplete level.
    var prev = state.currentLevel;
    var next = Math.max(prev, deriveCurrentLevel(state));
    if (next > prev) {
      state.currentLevel = next;
      saveState();
      // level_done AFTER the item's item_done above — messages in order
      for (var L = prev; L < next; L++) emitLevelDone(L, PLAN_TITLES[L]);
      pushDashboard(prev);           // existing celebration toast for the completed level
      pushBotpressVars("plan");
      pushLevelSync(next);           // Contract 4 (no-op while flag OFF)
      console.log("[app.js] level " + prev + " complete — advanced to " + next);
    } else {
      // Level 4 has no successor: celebrate when its checklist completes
      var allAfter = state.currentLevel === 4 && levelComplete(4, state);
      if (!allBefore && allAfter) {
        emitLevelDone(4, PLAN_TITLES[4]); // after the closing item's item_done
        pushDashboard(4);            // toast reads "All four levels complete!"
        console.log("[app.js] level 4 complete — all levels done");
      } else {
        pushDashboard();             // keep focus-card copy (e.g. items-left count) live
      }
      pushBotpressVars("plan");      // keep the coach's variables fresh
    }
    renderPlan();
  }

  (function wirePlanPanel() {
    var panel = document.getElementById("planPanel");
    if (!panel) return;
    panel.addEventListener("click", function (e) {
      var coachBtn = e.target.closest("[data-plan-coach]");
      if (coachBtn) {
        // learn items: open the embedded Botpress webchat (no event
        // bridge — scoping decision; the user marks it learned manually)
        if (window.botpress && typeof window.botpress.open === "function") {
          try { window.botpress.open(); } catch (err) { /* non-fatal */ }
        }
        var coachEl = document.getElementById("coach");
        if (coachEl) coachEl.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      var btn = e.target.closest("[data-plan-set]");
      if (btn) setActionStatus(btn.dataset.id, btn.dataset.planSet);
    });
  })();

  /* =================================================================
     RESET MY DATA — clears saved numbers/progress and returns the
     dashboard to a clean Level-1 view. Confirm dialog is accessible
     (focus management, Escape, focus trap, ARIA on the markup).
     ================================================================= */
  function resetData() {
    try { localStorage.removeItem(STATE_KEY); } catch (e) {}
    FIELDS.forEach(function (k) { state.inputs[k] = null; });
    state.derived = computeAll(state.inputs); // all-null in -> null out, never NaN
    state.currentLevel = 1;
    state.actions = {};                       // action plan back to not_started
    state.settings = { tgChatId: "", n8nWebhook: "" }; // Telegram opt-in back OFF
    state.lastUpdated = null;

    var ef = document.getElementById("entryForm");
    if (ef) ef.reset();
    var es = document.getElementById("entryStatus");
    if (es) { es.hidden = true; es.textContent = ""; }
    var tf = document.getElementById("tgConnectForm");
    if (tf) tf.reset();
    var ts = document.getElementById("tgConnectStatus");
    if (ts) { ts.textContent = "Off"; ts.className = "entry-status"; }

    // Clean Level-1 render + toast (site.js handles the reset flag).
    if (window.MFC && typeof window.MFC.updateDashboard === "function") {
      window.MFC.updateDashboard({ reset: true });
    }
    // Keep the coach's variables in sync with the cleared state.
    pushBotpressVars("reset");
    renderPlan(); // back to "enter your numbers" with all statuses cleared
    console.log("[app.js] data reset — cleared numbers, dashboard back to Level 1.");
  }
  window.MFC.resetData = resetData;

  (function wireResetDialog() {
    var trigger = document.getElementById("resetDataBtn");
    var modal = document.getElementById("resetModal");
    if (!trigger || !modal) return;
    var cancelBtn = document.getElementById("resetCancel");
    var confirmBtn = document.getElementById("resetConfirm");
    var backdrop = document.getElementById("resetBackdrop");
    var lastFocused = null;

    function onKeydown(e) {
      if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
      if (e.key === "Tab") {                       // trap focus in the dialog
        var order = [cancelBtn, confirmBtn];
        var i = order.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); confirmBtn.focus(); }
        else if (!e.shiftKey && i === order.length - 1) { e.preventDefault(); cancelBtn.focus(); }
      }
    }
    function openModal() {
      lastFocused = document.activeElement;
      modal.hidden = false;
      document.addEventListener("keydown", onKeydown, true);
      cancelBtn.focus(); // safe default for a destructive action
    }
    function closeModal() {
      modal.hidden = true;
      document.removeEventListener("keydown", onKeydown, true);
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    }

    trigger.addEventListener("click", openModal);
    cancelBtn.addEventListener("click", closeModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);
    confirmBtn.addEventListener("click", function () { resetData(); closeModal(); });
  })();

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

  // Action plan, generated deterministically from the live state
  // (UI panel + getCurrentAction contract arrive in later phases).
  window.MFC.generatePlan = function () { return generatePlan(state); };
  // Pure variant for testing: pass { inputs, currentLevel, actions? }.
  window.MFC.generatePlanFor = function (st) {
    return generatePlan({ inputs: st.inputs, derived: computeAll(st.inputs),
                          currentLevel: st.currentLevel || 1, actions: st.actions || {} });
  };

  /* =================================================================
     CHECK CONTRACT (Phase 3) — read by Rainie's n8n / the Python
     scheduler so the weekly Telegram nudge can name the user's actual
     next action ("Did you set up the $300 transfer?"). Read-only;
     no n8n changes live in this repo.
     ================================================================= */
  // The current FOCUS action: the first incomplete action in the first
  // incomplete level, walking across levels — the same selector that
  // drives the panel's "THIS WEEK" hero. Null when nothing can be
  // generated yet, or everything is done.
  window.MFC.getCurrentAction = function () {
    var a = nextAction(state);
    return a ? { id: a.id, text: a.text, amount: a.amount } : null;
  };
  // Items-based level gating, exposed read-only for QA.
  window.MFC.levelComplete = function (n) { return levelComplete(n, state); };
  // The full current-level action array (id/text/level/status/amount).
  window.MFC.getPlan = function () {
    return generatePlan(state).actions;
  };
  // Coach-event opt-in: set BOTH to enable item_done/level_done posts to
  // the self-hosted n8n webhook; pass "" for either to switch back off.
  // The Telegram token never appears here — it stays server-side in n8n.
  window.MFC.setCoachEventSettings = function (tgChatId, n8nWebhook) {
    state.settings.tgChatId = (typeof tgChatId === "string") ? tgChatId.trim() : "";
    state.settings.n8nWebhook = (typeof n8nWebhook === "string") ? n8nWebhook.trim() : "";
    saveState();
    return { tgChatId: state.settings.tgChatId, n8nWebhook: state.settings.n8nWebhook };
  };

  /* =================================================================
     COACH-EVENT SELF-TESTS — mock fireCoachEvent (capture, no network),
     stub every other side effect, drive the full item/level lifecycle
     against the real handlers, then restore pristine state BEFORE
     loadState() so the user's saved data is untouched.
     ================================================================= */
  (function eventSelfTest() {
    var pass = true, total = 0;
    function check(label, cond) {
      total++;
      console.assert(cond, "[app.js event-test FAILED] " + label);
      if (!cond) pass = false;
    }

    // ---- sandbox: stubs + snapshots ------------------------------
    var savedLS = null;
    try { savedLS = localStorage.getItem(STATE_KEY); } catch (e) {}
    var snap = JSON.parse(JSON.stringify(state));
    var realFire = fireCoachEvent, realSave = saveState,
        realDash = pushDashboard, realVars = pushBotpressVars,
        realPlan = renderPlan, realSync = pushLevelSync;
    var captured = [];
    fireCoachEvent = function (p) { captured.push(p); };
    saveState = function () {};
    pushDashboard = function () {};
    pushBotpressVars = function () {};
    renderPlan = function () {};
    pushLevelSync = function () {};

    state.inputs = { monthly_take_home_income: 2800, monthly_expenses: 1400,
      current_savings: 1000, monthly_insurance_premium: null,
      dtpd_coverage_amount: null, critical_illness_coverage_amount: null,
      monthly_investment_amount: null };
    state.derived = computeAll(state.inputs);
    state.currentLevel = 1;
    state.actions = {};
    state.settings = { tgChatId: "", n8nWebhook: "" };

    // E1: attest item -> exactly one item_done, correct text + next
    setActionStatus("L1-A1", "done");
    check("E1 one item_done on attest done", captured.length === 1 &&
      captured[0].event === "item_done" && captured[0].itemId === "L1-A1" &&
      captured[0].level === 1 &&
      captured[0].itemText === "Open a high-yield savings account as your emergency-fund home." &&
      captured[0].nextActionText === "Set up an automatic $550 transfer on payday into that savings account.");

    // E2: re-write of an already-done item and a "started" write fire nothing
    setActionStatus("L1-A1", "done");
    setActionStatus("L1-A2", "started");
    check("E2 re-write / started fire nothing", captured.length === 1);

    // E3: auto item 1.3 latches once at target, never re-fires
    state.inputs.current_savings = 4200;
    recompute();
    check("E3 auto latch fires one item_done", captured.length === 2 &&
      captured[1].event === "item_done" && captured[1].itemId === "L1-A3" &&
      captured[1].nextActionText === "Set up an automatic $350 transfer on payday into that savings account.");
    recompute(); // later save — latch guard must block a re-fire
    check("E3b latch never re-fires on later saves", captured.length === 2);

    // E4: closing item of a level -> item_done THEN level_done, in order
    setActionStatus("L1-A2", "done");
    setActionStatus("L1-A5", "done");
    setActionStatus("L1-A6", "done"); // closes Level 1
    var l1close = captured.slice(-2);
    check("E4 item_done then level_done on L1 close",
      captured.length === 6 &&
      l1close[0].event === "item_done" && l1close[0].itemId === "L1-A6" &&
      l1close[1].event === "level_done" && l1close[1].level === 1 &&
      l1close[1].levelName === "Emergency fund & money management" &&
      l1close[0].nextActionText === "Learn what baseline protection means." &&
      l1close[1].nextActionText === "Learn what baseline protection means.");

    // run the rest of the journey to the final level
    ["L2-B1L", "L2-B2", "L2-B3", "L2-B4L", "L2-B5",
     "L3-C0", "L3-C2L", "L3-C1", "L4-D1", "L4-D2"].forEach(function (id) {
      setActionStatus(id, "done");
    });
    setActionStatus("L4-D3", "done"); // closes Level 4 — the final level
    var l4close = captured.slice(-2);

    // E5: final close -> nextActionText null on both events, item first
    check("E5 final close: item_done then level_done, nextActionText null",
      l4close[0].event === "item_done" && l4close[0].itemId === "L4-D3" &&
      l4close[0].nextActionText === null &&
      l4close[1].event === "level_done" && l4close[1].level === 4 &&
      l4close[1].levelName === "Home & retirement" &&
      l4close[1].nextActionText === null);

    // E6: exactly one item_done per item, one level_done per level
    var items = captured.filter(function (p) { return p.event === "item_done"; });
    var levels = captured.filter(function (p) { return p.event === "level_done"; });
    check("E6 16 item_done, 4 level_done, levels 1-4 in order",
      items.length === 16 && levels.length === 4 &&
      levels.map(function (p) { return p.level; }).join(",") === "1,2,3,4");

    // E7: the REAL fireCoachEvent — blank settings mean no fetch at all
    var realFetch = window.fetch, fetchCalls = [];
    window.fetch = function (url, opts) {
      fetchCalls.push({ url: url, opts: opts });
      return { catch: function () {} };
    };
    realFire({ event: "probe" });                       // both blank
    state.settings = { tgChatId: "123", n8nWebhook: "" };
    realFire({ event: "probe" });                       // webhook blank
    check("E7 blank settings -> no fetch attempted", fetchCalls.length === 0);
    state.settings = { tgChatId: "123", n8nWebhook: "https://n8n.example/hook" };
    realFire({ event: "probe" });
    var sent = fetchCalls[0] && JSON.parse(fetchCalls[0].opts.body);
    check("E7b configured -> one POST, chatId merged, keepalive, no TG token",
      fetchCalls.length === 1 &&
      fetchCalls[0].url === "https://n8n.example/hook" &&
      fetchCalls[0].opts.method === "POST" &&
      fetchCalls[0].opts.keepalive === true &&
      sent.chatId === "123" && sent.event === "probe");
    window.fetch = realFetch;

    // spec printout: the captured payloads for level-closing transitions
    console.log("[app.js] L1-close payloads: " + JSON.stringify(l1close));
    console.log("[app.js] L4-close payloads: " + JSON.stringify(l4close));

    // ---- restore: stubs back, pristine state, dedupe map cleared --
    fireCoachEvent = realFire; saveState = realSave;
    pushDashboard = realDash; pushBotpressVars = realVars;
    renderPlan = realPlan; pushLevelSync = realSync;
    state.inputs = snap.inputs; state.derived = snap.derived;
    state.currentLevel = snap.currentLevel; state.actions = snap.actions;
    state.settings = snap.settings; state.lastUpdated = snap.lastUpdated;
    emittedLevels = {};
    try {
      if (savedLS === null) localStorage.removeItem(STATE_KEY);
      else localStorage.setItem(STATE_KEY, savedLS);
    } catch (e) {}

    console.log("[app.js] event self-tests: " + (pass ? "PASS" : "FAIL") +
                " (" + total + "/" + total + " checks" + (pass ? "" : " — see failures above") + ")");
  })();

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
    recompute(); // derives, persists, pushes AND re-renders the plan
  } else {
    renderPlan(); // empty state: "enter your numbers to generate your plan"
  }

  /* =================================================================
     CONNECT TELEGRAM (OPTIONAL) — settings UI wiring only. Reads and
     writes go through window.MFC.setCoachEventSettings (the existing
     save path); runs after loadState() so the pre-fill sees persisted
     values. No plan-engine or completion logic here.
     ================================================================= */
  (function wireTelegramConnect() {
    var form = document.getElementById("tgConnectForm");
    var chatEl = document.getElementById("tgChatId");
    var hookEl = document.getElementById("n8nWebhook");
    var statusEl = document.getElementById("tgConnectStatus");
    if (!form || !chatEl || !hookEl || !statusEl) return;

    function renderTgStatus(s) {
      var on = !!(s.tgChatId && s.n8nWebhook);
      statusEl.textContent = on ? "Connected — you'll get encouragement messages" : "Off";
      statusEl.className = "entry-status" + (on ? " is-ok" : "");
    }

    chatEl.value = state.settings.tgChatId;
    hookEl.value = state.settings.n8nWebhook;
    renderTgStatus(state.settings);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      // setter trims, persists via saveState() and returns what stuck
      renderTgStatus(window.MFC.setCoachEventSettings(chatEl.value, hookEl.value));
    });
  })();

})();
