/* decision-engine-demo.js — Live test scenarios for decision engine.
   Load this in browser console or wrap in a test UI.
   Demonstrates all decision types and cost calculations. */

window.DEMO = (function () {
  const $ = (s) => document.querySelector(s);

  function log(title, obj) {
    console.log(
      `%c${title}`,
      "font-size: 14px; font-weight: bold; color: #ffc500",
      obj
    );
  }

  function testCadenceChange() {
    log("TEST 1: Cadence Change (2-day → 3-day)", "");

    const request = {
      type: "cadence_change",
      customerId: "CUST-001",
      currentCadence: 2,
      requestedCadence: 3,
      zone: "dubai",
    };

    const decision = DECISIONS.evaluateRequest(request);

    console.log("Request:", request);
    console.log("Decision:", decision.decision);
    console.log("Costs:", decision.costs);
    console.log("Audit:", decision.audit);
    console.log("—".repeat(60));

    return decision;
  }

  function testLocationChange() {
    log("TEST 2: Location Change (within free allowance)", "");

    const request = {
      type: "location_change",
      customerId: "CUST-002",
      oldLocation: "dubai",
      newLocation: "sharjah",
    };

    const decision = DECISIONS.evaluateRequest(request);

    console.log("Request:", request);
    console.log("Decision:", decision.decision);
    console.log("Changes used:", decision.impacts.changes_used);
    console.log("Changes remaining:", decision.impacts.changes_remaining);
    console.log("Cost charged:", decision.costs.customer_contribution);
    console.log("—".repeat(60));

    return decision;
  }

  function testLocationChangeOverLimit() {
    log("TEST 3: Location Change (exceeds free allowance)", "");

    // First, use up free allowance (2 changes)
    DECISIONS.evaluateLocationChange({
      customerId: "CUST-003",
      oldLocation: "dubai",
      newLocation: "ajman",
    });
    DECISIONS.evaluateLocationChange({
      customerId: "CUST-003",
      oldLocation: "ajman",
      newLocation: "sharjah",
    });

    // Now this one will be charged
    const request = {
      type: "location_change",
      customerId: "CUST-003",
      oldLocation: "sharjah",
      newLocation: "fujairah",
    };

    const decision = DECISIONS.evaluateRequest(request);

    console.log("Request:", request);
    console.log("Decision:", decision.decision);
    console.log("Changes used:", decision.impacts.changes_used);
    console.log("Changes remaining:", decision.impacts.changes_remaining);
    console.log("Cost charged:", decision.costs.customer_contribution, "AED");
    console.log("—".repeat(60));

    return decision;
  }

  function testExternalDispatchNoSubsidy() {
    log("TEST 4: External Dispatch (2 stops, company absorbs AED 30)", "");

    const request = {
      type: "external_dispatch",
      customerId: "CUST-004",
      zone: "abudhabi",
      stops: 2,
      can_fit_existing_route: false,
    };

    const decision = DECISIONS.evaluateRequest(request);

    console.log("Request:", request);
    console.log("Decision:", decision.decision);
    console.log("Requires external driver:", decision.impacts.requires_external_driver);
    console.log("Costs breakdown:");
    console.log("  - Operational cost:", decision.impacts.operational_cost_impact, "AED");
    console.log("  - Customer pays:", decision.costs.customer_contribution, "AED");
    console.log("  - Company absorbs:", decision.costs.company_contribution, "AED");
    console.log("  - Total:", decision.costs.total_operational_cost, "AED");
    console.log("—".repeat(60));

    return decision;
  }

  function testExternalDispatchHighCost() {
    log("TEST 5: External Dispatch (5 stops, high cost)", "");

    const request = {
      type: "external_dispatch",
      customerId: "CUST-005",
      zone: "fujairah",
      stops: 5,
      can_fit_existing_route: false,
    };

    const decision = DECISIONS.evaluateRequest(request);

    console.log("Request:", request);
    console.log("Decision:", decision.decision);
    console.log("Costs breakdown:");
    console.log("  - Driver cost:", 5 * CONFIG.get("external_driver_cost_per_stop"), "AED");
    console.log("  - Flexibility fee:", CONFIG.get("operational_flexibility_fee"), "AED");
    console.log("  - Customer contribution:", decision.costs.customer_contribution, "AED");
    console.log("  - Company subsidy:", decision.costs.company_contribution, "AED");
    console.log("  - Company subsidy cap:", CONFIG.get("max_company_subsidy_per_order"), "AED");
    console.log("—".repeat(60));

    return decision;
  }

  function testComprehensiveEvaluation() {
    log("TEST 6: Comprehensive Evaluation", "");

    const request = {
      type: "cadence_change",
      customerId: "CUST-006",
      currentCadence: 2,
      requestedCadence: 3,
      zone: "dubai",
    };

    const result = DECISIONS.comprehensiveEvaluation(request);

    console.log("Request:", request);
    console.log("Comprehensive answers:");
    console.log("  - Affects schedule:", result.questions_answered.affects_optimized_schedule);
    console.log("  - Requires external driver:", result.questions_answered.requires_external_driver);
    console.log("  - Operational cost:", result.questions_answered.operational_cost, "AED");
    console.log("  - Customer should pay:", result.questions_answered.customer_should_pay, "AED");
    console.log("  - Company absorbs:", result.questions_answered.company_absorbs, "AED");
    console.log("  - Approval required:", result.questions_answered.approval_required);
    console.log("—".repeat(60));

    return result;
  }

  function testConfigModification() {
    log("TEST 7: Modify Config & Re-evaluate", "");

    console.log("Current config:");
    console.log("  - External driver cost:", CONFIG.get("external_driver_cost_per_stop"), "AED");
    console.log("  - Flexibility fee:", CONFIG.get("operational_flexibility_fee"), "AED");
    console.log("  - Cost per km:", CONFIG.get("cost_per_km"), "AED");

    // Change fuel price
    CONFIG.set("fuel_price_per_liter", 4.0);
    console.log("\nAfter changing fuel price to 4.0 AED/L:");
    console.log("  - Cost per km (auto-calculated):", CONFIG.get("cost_per_km"), "AED");

    // Change operational variables
    CONFIG.setMultiple({
      external_driver_cost_per_stop: 60,
      operational_flexibility_fee: 30,
    });

    console.log("\nAfter changing operational costs:");
    console.log("  - External driver cost:", CONFIG.get("external_driver_cost_per_stop"), "AED");
    console.log("  - Flexibility fee:", CONFIG.get("operational_flexibility_fee"), "AED");

    // Re-evaluate with new costs
    const request = {
      type: "external_dispatch",
      customerId: "CUST-007",
      zone: "dubai",
      stops: 2,
      can_fit_existing_route: false,
    };

    const decision = DECISIONS.evaluateRequest(request);
    console.log("\nRe-evaluated external dispatch with new config:");
    console.log("  - Customer pays:", decision.costs.customer_contribution, "AED");

    // Reset for other tests
    CONFIG.reset();
    console.log("\nConfig reset to defaults");
    console.log("—".repeat(60));
  }

  function runAllTests() {
    console.clear();
    log("DECISION ENGINE DEMO", "Running all tests...\n");

    testCadenceChange();
    testLocationChange();
    testLocationChangeOverLimit();
    testExternalDispatchNoSubsidy();
    testExternalDispatchHighCost();
    testComprehensiveEvaluation();
    testConfigModification();

    console.log("\n%cAll tests completed", "font-size: 12px; color: green");
  }

  return {
    runAllTests,
    testCadenceChange,
    testLocationChange,
    testLocationChangeOverLimit,
    testExternalDispatchNoSubsidy,
    testExternalDispatchHighCost,
    testComprehensiveEvaluation,
    testConfigModification,
  };
})();

// Auto-run if in browser
if (typeof window !== "undefined") {
  console.log(
    "%cDecision Engine Demo loaded. Run: DEMO.runAllTests()",
    "font-size: 12px; color: #ffc500"
  );
}
