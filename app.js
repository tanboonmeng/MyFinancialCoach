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
     ACTION PLAN GENERATOR (Plan -> Do -> Check) — DETERMINISTIC ONLY.
     Same inputs -> same plan, every time. No LLM, no network. Reads
     the values computeAll() already derived (never re-derives MAS
     formulas). Null-safe: missing required inputs -> ready:false and
     the UI shows "enter your numbers to generate your plan".
     Action ids are stable (L1-A1...) so statuses persist in
     mfc_state_v1 across regenerations.
     ================================================================= */
  function generatePlan(st) {
    var i = st.inputs, d = st.derived || computeAll(st.inputs);
    var lvl = st.currentLevel || 1;
    var statuses = st.actions || {};
    function act(id, text, amount) {
      return { id: id, text: text, level: lvl,
               status: statuses[id] || "not_started",
               amount: isNum(amount) ? amount : null };
    }
    var plan = { level: lvl, ready: true, complete: false, actions: [] };

    if (lvl === 1) {
      if (!isNum(i.monthly_expenses) || i.monthly_expenses <= 0 ||
          !isNum(i.current_savings) ||
          !isNum(i.monthly_take_home_income) || i.monthly_take_home_income <= 0) {
        return { level: 1, ready: false, complete: false, actions: [],
                 reason: "Enter your income, expenses and savings to generate your plan." };
      }
      var target6 = d.emergencyTargetFull;                       // 6x expenses (existing calc)
      var shortfall = Math.max(0, target6 - i.current_savings);
      if (shortfall === 0) return { level: 1, ready: true, complete: true, actions: [] };
      // nearest-$50 of min(shortfall/12, 20% of take-home); floored at
      // $50 so rounding can never suggest a $0 transfer
      var raw = Math.min(shortfall / 12, 0.20 * i.monthly_take_home_income);
      var suggestedMonthly = Math.max(50, Math.round(raw / 50) * 50);
      var monthsToTarget = Math.ceil(shortfall / suggestedMonthly);
      plan.meta = { target6: target6, shortfall: shortfall,
                    suggestedMonthly: suggestedMonthly, monthsToTarget: monthsToTarget };
      // Auto-transfer binds to the SAVINGS ACCOUNT only — SSBs are bought
      // in manual monthly issues, so they are the optional final step,
      // never the auto-transfer destination.
      // L1-A3 is an AUTO-MILESTONE: no buttons; its status derives from
      // the live progress (savingsProgressPct >= 100 -> done). Manual
      // status writes to it are refused in setActionStatus.
      var a3 = act("L1-A3", "Build your fund to " + fmtSGD(target6) + " (6 months of expenses) — about " + monthsToTarget + " months at this rate.", target6);
      a3.auto = true;
      a3.progressPct = isNum(d.savingsProgressPct) ? d.savingsProgressPct : 0;
      a3.status = (a3.progressPct >= 100) ? "done" : "not_started";
      a3.autoHint = "Completes automatically when your fund reaches " + fmtSGD(target6) + ".";
      var a4 = act("L1-A4", "(Optional, once your buffer grows) Move a portion into Singapore Savings Bonds (SSBs) — government-guaranteed and exitable any month — to earn more while staying liquid.");
      a4.optional = true;
      plan.actions = [
        act("L1-A1", "Open a high-yield savings account as your emergency-fund home."),
        act("L1-A2", "Set up an automatic " + fmtSGD(suggestedMonthly) + " transfer on payday into that savings account.", suggestedMonthly),
        a3,
        a4
      ];
      return plan;
    }

    if (lvl === 2) {
      if (!isNum(d.dtpdTarget)) {
        return { level: 2, ready: false, complete: false, actions: [],
                 reason: "Enter your income so your cover targets can be sized." };
      }
      plan.actions = [act("L2-B1", "Confirm your MediShield Life and check if you need an Integrated Shield Plan.")];
      if (!isNum(i.dtpd_coverage_amount) || i.dtpd_coverage_amount < d.dtpdTarget) {
        plan.actions.push(act("L2-B2", "Get term insurance for Death & TPD to reach " + fmtSGD(d.dtpdTarget) + " cover.", d.dtpdTarget));
      }
      if (!isNum(i.critical_illness_coverage_amount) || i.critical_illness_coverage_amount < d.ciTarget) {
        plan.actions.push(act("L2-B3", "Add Critical Illness term cover to reach " + fmtSGD(d.ciTarget) + ".", d.ciTarget));
      }
      if (d.coverageCapConflict === true) {
        plan.actions.push(act("L2-B4", "Full cover may exceed 15% of take-home — prioritise Death/TPD + DPS first, use term not bundled, and consider Direct Purchase Insurance."));
      }
      return plan;
    }

    if (lvl === 3) {
      if (!isNum(d.investMinMonthly)) {
        return { level: 3, ready: false, complete: false, actions: [],
                 reason: "Enter your income to set your 10% investing floor." };
      }
      plan.actions = [
        act("L3-C1", "Set up a monthly investment of at least " + fmtSGD(d.investMinMonthly) + " into a diversified low-cost ETF or a CPF top-up.", d.investMinMonthly),
        act("L3-C2", "Automate it on payday so it happens without willpower.")
      ];
      return plan;
    }

    // Level 4 — concepts + official tools only, no regulated figures.
    plan.level = 4;
    plan.actions = [
      act("L4-D1", "Use the CPF Home Purchase Planner to see what you can afford."),
      act("L4-D2", "Use HDB's budget calculator before committing to a flat."),
      act("L4-D3", "Make a CPF top-up for tax relief and retirement compounding.")
    ];
    return plan;
  }

  // The user's CURRENT focus action: the first incomplete NON-OPTIONAL
  // action (started or not); optional actions only once every
  // non-optional action is done. Used by getCurrentAction() and the
  // panel's "This week" hero, so both always agree.
  function nextAction(p) {
    if (!p || !p.ready || p.complete) return null;
    var k, a;
    for (k = 0; k < p.actions.length; k++) {
      a = p.actions[k];
      if (!a.optional && a.status !== "done") return a;
    }
    for (k = 0; k < p.actions.length; k++) {
      a = p.actions[k];
      if (a.optional && a.status !== "done") return a;
    }
    return null;
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
    // P1: action-plan generator — 2800/1400/4956 profile, exact values.
    // Rounding rule: suggestedMonthly = max($50, nearest-$50 of
    // min(shortfall/12, 20% take-home)) = max(50, round(287/50)*50) = 300.
    (function () {
      var inputs = {
        monthly_take_home_income: 2800, monthly_expenses: 1400,
        current_savings: 4956, monthly_insurance_premium: null,
        dtpd_coverage_amount: null, critical_illness_coverage_amount: null,
        monthly_investment_amount: null
      };
      var p = generatePlan({ inputs: inputs, derived: computeAll(inputs), currentLevel: 1, actions: {} });
      check("P1 plan ready (4 actions incl. optional SSB)", p.ready === true && p.actions.length === 4);
      check("P1 target6 8400", p.meta.target6 === 8400);
      check("P1 shortfall 3444", p.meta.shortfall === 3444);
      check("P1 suggestedMonthly 300 (nearest-$50 of min(287,560))", p.meta.suggestedMonthly === 300);
      check("P1 monthsToTarget 12", p.meta.monthsToTarget === 12);
      check("P1 A2 renders $300", p.actions[1].text.indexOf("$300") !== -1);
      check("P1 A3 renders $8,400 and 12 months",
        p.actions[2].text.indexOf("$8,400") !== -1 && p.actions[2].text.indexOf("12 months") !== -1);
      check("P1 A4 is the optional SSB step",
        p.actions[3].id === "L1-A4" &&
        p.actions[3].text.indexOf("Optional") !== -1 &&
        p.actions[3].text.indexOf("Singapore Savings Bonds") !== -1 &&
        p.actions[3].amount === null);
      check("P1 auto-transfer binds to the savings account only",
        p.actions[1].text.indexOf("savings account") !== -1 &&
        p.actions[1].text.indexOf("SSB") === -1 &&
        p.actions[3].text.indexOf("automatic") === -1);
      // M-series: A3 auto-milestone + focus selection
      (function () {
        function st(savings, actions) {
          var inputs = {
            monthly_take_home_income: 2800, monthly_expenses: 1400,
            current_savings: savings, monthly_insurance_premium: null,
            dtpd_coverage_amount: null, critical_illness_coverage_amount: null,
            monthly_investment_amount: null
          };
          return generatePlan({ inputs: inputs, derived: computeAll(inputs),
                                currentLevel: 1, actions: actions || {} });
        }
        var p36 = st(3024, { "L1-A1": "done", "L1-A2": "done" }); // 3024/8400 = 36%
        check("M1 A3 is an auto milestone, not done below 100%",
          p36.actions[2].auto === true && p36.actions[2].status !== "done" &&
          p36.actions[2].progressPct === 36);
        var p100 = st(8399, {});                                  // rounds to 100%, shortfall $1
        check("M2 A3 auto-done at 100% live progress",
          p100.ready === true && p100.actions[2].status === "done");
        var na36 = nextAction(p36);
        check("M3 current action is A3 (never A4) while A3 incomplete",
          na36 !== null && na36.id === "L1-A3" && na36.id !== "L1-A4");
        var naAfter = nextAction(st(8399, { "L1-A1": "done", "L1-A2": "done" }));
        check("M4 optional A4 becomes current only after all non-optional done",
          naAfter !== null && naAfter.id === "L1-A4");
      })();
      var pNull = generatePlan({ inputs: { monthly_take_home_income: null, monthly_expenses: null,
        current_savings: null, monthly_insurance_premium: null, dtpd_coverage_amount: null,
        critical_illness_coverage_amount: null, monthly_investment_amount: null },
        derived: null, currentLevel: 1, actions: {} });
      check("P1 null inputs -> ready:false, no actions", pNull.ready === false && pNull.actions.length === 0);
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
    currentLevel: 1,     // gatekeeping arrives in Phase 3
    actions: {},         // action-plan statuses: id -> not_started|started|done
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
        doneHtml += '<li class="plan-lvl is-done"><span class="plan-lvl-check">' + CHECK_PATH +
                    '</span>Level ' + n + " · " + PLAN_TITLES[n] + '<span class="plan-lvl-tag">Done</span></li>';
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

    // Next Best Action = same selection getCurrentAction() uses
    var nba = nextAction(plan);
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
      if (a.auto) {
        // auto milestone: NO buttons — status derives from live progress
        btns.innerHTML = (a.status === "done")
          ? '<span class="plan-lvl-tag">Done</span>'
          : '<span class="plan-lvl-tag is-auto-tag">' +
            (isNum(a.progressPct) ? a.progressPct + "% there" : "Auto") + '</span>';
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

  function completeLevelViaPlan() {
    var completed = state.currentLevel;
    if (state.currentLevel < 4) state.currentLevel += 1; // forward-only
    state.lastUpdated = new Date().toISOString();
    saveState();
    pushDashboard(completed);        // re-renders cards + existing toast
    pushBotpressVars("plan");
    if (state.currentLevel > completed) pushLevelSync(state.currentLevel);
    renderPlan();
    console.log("[app.js] plan complete — level " + completed + " done" +
      (state.currentLevel > completed ? ", advanced to " + state.currentLevel : ""));
  }

  function setActionStatus(id, status) {
    if (ACTION_STATUSES.indexOf(status) === -1) return;
    // Handler-level gate re-check: auto milestones derive their status
    // from live progress — a stale-DOM tap can never set them manually.
    var current = generatePlan(state);
    for (var k = 0; k < current.actions.length; k++) {
      if (current.actions[k].id === id && current.actions[k].auto) {
        renderPlan(); // refresh any stale buttons
        return;
      }
    }
    state.actions[id] = status;
    state.lastUpdated = new Date().toISOString();
    saveState();
    var plan = generatePlan(state);
    var allDone = plan.ready && plan.actions.length > 0 &&
      plan.actions.every(function (a) { return a.status === "done"; });
    if (allDone) { completeLevelViaPlan(); return; }
    renderPlan();
  }

  (function wirePlanPanel() {
    var panel = document.getElementById("planPanel");
    if (!panel) return;
    panel.addEventListener("click", function (e) {
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
    state.lastUpdated = null;

    var ef = document.getElementById("entryForm");
    if (ef) ef.reset();
    var es = document.getElementById("entryStatus");
    if (es) { es.hidden = true; es.textContent = ""; }

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
  // The current FOCUS action for the current level: first incomplete
  // non-optional action (auto milestones like L1-A3 count until their
  // derived status is done); optional actions (L1-A4) are excluded
  // until every non-optional action is complete. Null when the level's
  // checklist is done or no plan can be generated yet.
  window.MFC.getCurrentAction = function () {
    var a = nextAction(generatePlan(state));
    return a ? { id: a.id, text: a.text, amount: a.amount } : null;
  };
  // The full current-level action array (id/text/level/status/amount).
  window.MFC.getPlan = function () {
    return generatePlan(state).actions;
  };

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

})();
