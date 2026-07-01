/* dispatch-integration-demo.js — Test scenarios for dispatch integration.
   Run in browser console to see decision engine + cost tracking in action. */

window.DISPATCH_DEMO = (function () {
  const DI = window.DISPATCH_INTEGRATION;
  const CFG = window.CONFIG;

  function log(title, obj) {
    console.log(
      `%c${title}`,
      "font-size: 14px; font-weight: bold; color: #ffc500",
      obj
    );
  }

  function testCadenceChangeAutoApprove() {
    log("TEST 1: Cadence Change (Auto-Approved)", "");

    const result = DI.handleCadenceChange("CUST-DEMO-001", "dubai", 3);

    console.log("Customer changed cadence: 2-day → 3-day");
    console.log("Decision:", result.decision);
    console.log("Charges:", result.charges, "AED");
    console.log("Account:", DI.getAccountSummary("CUST-DEMO-001"));
    console.log("Audit:", result.audit);
    console.log("—".repeat(60));
  }

  function testLocationChangeFreeThenCharged() {
    log("TEST 2: Location Changes (Free → Charged)", "");

    // 1st change: free
    const r1 = DI.handleLocationChange("CUST-DEMO-002", "sharjah");
    console.log("Change 1 (Dubai → Sharjah): AED", r1.charges, "· Used:", r1.changes_used, "Remaining:", r1.changes_remaining);

    // 2nd change: free
    const r2 = DI.handleLocationChange("CUST-DEMO-002", "ajman");
    console.log("Change 2 (Sharjah → Ajman): AED", r2.charges, "· Used:", r2.changes_used, "Remaining:", r2.changes_remaining);

    // 3rd change: charged (exceeds allowance)
    const r3 = DI.handleLocationChange("CUST-DEMO-002", "fujairah");
    console.log("Change 3 (Ajman → Fujairah): AED", r3.charges, "· Used:", r3.changes_used, "Remaining:", r3.changes_remaining);

    console.log("Account:", DI.getAccountSummary("CUST-DEMO-002"));
    console.log("—".repeat(60));
  }

  function testExternalDispatchCostSplit() {
    log("TEST 3: External Dispatch (Cost Split)", "");

    const config = {
      external_driver_cost_per_stop: CFG.get("external_driver_cost_per_stop"),
      operational_flexibility_fee: CFG.get("operational_flexibility_fee"),
      company_subsidy_per_external_stop: CFG.get("company_subsidy_per_external_stop"),
    };

    console.log("Current config:", config);

    // 2 stops in Abu Dhabi
    const result = DI.handleExternalDispatch("CUST-DEMO-003", "abudhabi", 2);

    console.log("\nExternal dispatch: 2 stops in Abu Dhabi");
    console.log("Decision:", result.decision);
    console.log("Operational cost:", result.audit.operational_cost_impact, "AED");
    console.log("Customer pays:", result.charges, "AED");
    console.log("Company absorbs:", result.company_absorbs, "AED");

    console.log("\nAccount:", DI.getAccountSummary("CUST-DEMO-003"));
    console.log("—".repeat(60));
  }

  function testPendingApproval() {
    log("TEST 4: Pending Approval (Cadence Change with Review Required)", "");

    // Temporarily enable manual review for cadence changes
    const wasRequired = CFG.get("require_manual_review_cadence_change");
    CFG.set("require_manual_review_cadence_change", true);

    const result = DI.handleCadenceChange("CUST-DEMO-004", "dubai", 3);

    console.log("Cadence change triggered with manual review enabled");
    console.log("Decision:", result.decision);
    console.log("Status:", result.audit.status || "approved");
    console.log("Request ID:", result.audit.id);

    if (result.decision === "pending_review") {
      console.log("\nPending approvals:", DI.getPendingApprovals().length);

      // Simulate admin approval
      console.log("\nAdmin approves...");
      DI.approvePendingRequest(result.audit.id, "Approved by dispatch manager");

      // Check approval
      const all = DI.getAuditLog();
      const approved = all.find((a) => a.id === result.audit.id);
      if (approved) {
        console.log("Approved at:", approved.approvedAt);
        console.log("Approved by:", approved.approvedBy);
        console.log("Notes:", approved.adminNotes);
      }
    }

    // Restore config
    CFG.set("require_manual_review_cadence_change", wasRequired);
    console.log("—".repeat(60));
  }

  function testConfigImpact() {
    log("TEST 5: Config Change Impact on Costs", "");

    const originalCost = CFG.get("external_driver_cost_per_stop");
    console.log("Original external driver cost:", originalCost, "AED/stop");

    // Dispatch with original cost
    const r1 = DI.handleExternalDispatch("CUST-DEMO-05A", "dubai", 2);
    console.log("Result 1 (2 stops):", "Customer pays", r1.charges, "AED");

    // Change config
    CFG.set("external_driver_cost_per_stop", 60);
    console.log("\nConfig updated: external_driver_cost_per_stop = 60 AED");

    // Dispatch with new cost
    const r2 = DI.handleExternalDispatch("CUST-DEMO-05B", "dubai", 2);
    console.log("Result 2 (2 stops):", "Customer pays", r2.charges, "AED");

    console.log("\nCost difference: AED", r2.charges - r1.charges);

    // Restore
    CFG.set("external_driver_cost_per_stop", originalCost);
    console.log("Config restored to original:", originalCost, "AED");
    console.log("—".repeat(60));
  }

  function testAuditLogQueries() {
    log("TEST 6: Audit Log Queries", "");

    // Get all decisions
    const all = DI.getAuditLog();
    console.log("Total decisions logged:", all.length);

    // By customer
    const c001 = DI.getAuditLog({ customerId: "CUST-DEMO-001" });
    console.log("Decisions for CUST-DEMO-001:", c001.length);

    // By type
    const cadence = DI.getAuditLog({ type: "cadence_change" });
    console.log("Cadence change decisions:", cadence.length);

    const location = DI.getAuditLog({ type: "location_change" });
    console.log("Location change decisions:", location.length);

    const external = DI.getAuditLog({ type: "external_dispatch" });
    console.log("External dispatch decisions:", external.length);

    // Approved only
    const approved = DI.getAuditLog({ approved: true });
    console.log("Approved decisions:", approved.length);

    console.log("\nSample audit entry:");
    if (all.length > 0) {
      console.log(all[0]);
    }
    console.log("—".repeat(60));
  }

  function testMonthlyChargeTracking() {
    log("TEST 7: Monthly Charge Tracking", "");

    const month = new Date().toISOString().slice(0, 7);

    // Charge same customer multiple times
    DI.chargeCustomer("CUST-DEMO-006", 50, "Location change");
    DI.chargeCustomer("CUST-DEMO-006", 20, "Cadence adjustment");
    DI.chargeCustomer("CUST-DEMO-006", 30, "External dispatch");

    const account = DI.getAccountSummary("CUST-DEMO-006");
    console.log("Customer: CUST-DEMO-006");
    console.log("Total charges:", account.totalCharges, "AED");
    console.log("This month (" + month + "):", account.monthlyCharges, "AED");
    console.log("Account:", account);
    console.log("—".repeat(60));
  }

  function runAllTests() {
    console.clear();
    log("DISPATCH INTEGRATION DEMO", "Running all tests...\n");

    testCadenceChangeAutoApprove();
    testLocationChangeFreeThenCharged();
    testExternalDispatchCostSplit();
    testPendingApproval();
    testConfigImpact();
    testAuditLogQueries();
    testMonthlyChargeTracking();

    console.log("\n%cAll tests completed", "font-size: 12px; color: green");
  }

  return {
    runAllTests,
    testCadenceChangeAutoApprove,
    testLocationChangeFreeThenCharged,
    testExternalDispatchCostSplit,
    testPendingApproval,
    testConfigImpact,
    testAuditLogQueries,
    testMonthlyChargeTracking,
  };
})();

// Auto-run info
if (typeof window !== "undefined") {
  console.log(
    "%cDispatch Integration Demo loaded. Run: DISPATCH_DEMO.runAllTests()",
    "font-size: 12px; color: #ffc500"
  );
}
