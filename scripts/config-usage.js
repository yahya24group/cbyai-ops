/* config-usage.js — Examples of Config + Decision Engine usage.
   Shows how to integrate into dispatch logic. */

/*
╔════════════════════════════════════════════════════════════════╗
║                    CONFIG MODULE USAGE                        ║
╚════════════════════════════════════════════════════════════════╝
*/

// Get single config value
const external_cost = CONFIG.get("external_driver_cost_per_stop"); // 50 AED
const flexibility_fee = CONFIG.get("operational_flexibility_fee"); // 20 AED
const cost_per_km = CONFIG.get("cost_per_km"); // auto-calculated

// Get all config
const all = CONFIG.getAll();

// Set single value (persists to localStorage)
CONFIG.set("external_driver_cost_per_stop", 55);

// Set multiple values
CONFIG.setMultiple({
  external_driver_cost_per_stop: 55,
  operational_flexibility_fee: 25,
  monthly_free_location_changes: 3,
});

// Reset to defaults
CONFIG.reset();

/*
╔════════════════════════════════════════════════════════════════╗
║                  DECISION ENGINE USAGE                        ║
╚════════════════════════════════════════════════════════════════╝
*/

// ─── Cadence Change Request ───
const cadenceRequest = {
  type: "cadence_change",
  customerId: "CUST-001",
  currentCadence: 2, // every 2 days
  requestedCadence: 3, // customer wants every 3 days
  zone: "dubai",
};

const cadenceDecision = DECISIONS.evaluateRequest(cadenceRequest);
console.log(cadenceDecision);
/*
{
  decision: "pending_review" | "approved",
  impacts: {
    affects_schedule: true,
    operational_cost_impact: 20
  },
  costs: {
    customer_contribution: 20,
    company_contribution: 0,
    total_operational_cost: 20
  },
  audit: { ... }
}
*/

// ─── Location Change Request ───
const locationRequest = {
  type: "location_change",
  customerId: "CUST-002",
  oldLocation: "dubai",
  newLocation: "sharjah",
};

const locationDecision = DECISIONS.evaluateRequest(locationRequest);
console.log(locationDecision);
/*
First 2 changes per month = FREE
3rd+ = AED 20 fee

{
  decision: "approved",
  impacts: {
    affects_schedule: true,
    changes_used: 1,
    changes_remaining: 1
  },
  costs: {
    customer_contribution: 0, // if within free allowance
    company_contribution: 0,
    total_operational_cost: 0
  },
  audit: { ... }
}
*/

// ─── External Driver Dispatch ───
const externalRequest = {
  type: "external_dispatch",
  customerId: "CUST-003",
  zone: "abudhabi",
  stops: 3,
  can_fit_existing_route: false, // can't fit into existing route
};

const externalDecision = DECISIONS.evaluateRequest(externalRequest);
console.log(externalDecision);
/*
External driver cost: AED 50/stop
Customer flexibility fee: AED 20
Company subsidy: AED 30/stop

For 3 stops:
- Operational cost: 50 × 3 = AED 150
- Customer pays: 20 + (50-30) × 3 = 20 + 60 = AED 80
- Company absorbs: 30 × 3 = AED 90

{
  decision: "approved" | "pending_review",
  impacts: {
    requires_external_driver: true,
    operational_cost_impact: 150
  },
  costs: {
    customer_contribution: 80,
    company_contribution: 90,
    total_operational_cost: 150
  },
  audit: { ... }
}
*/

// ─── Comprehensive Evaluation ───
const fullEval = DECISIONS.comprehensiveEvaluation(cadenceRequest);
console.log(fullEval.questions_answered);
/*
{
  affects_optimized_schedule: true,
  requires_external_driver: false,
  operational_cost: 20,
  customer_should_pay: 20,
  company_absorbs: 0,
  approval_required: true
}
*/

/*
╔════════════════════════════════════════════════════════════════╗
║          INTEGRATION WITH DISPATCH APP (pattern)              ║
╚════════════════════════════════════════════════════════════════╝
*/

// When customer requests a cadence change:
function handleCadenceChangeRequest(customerId, newCadence) {
  const request = {
    type: "cadence_change",
    customerId,
    currentCadence: customerBook.subs[customerId].cadence,
    requestedCadence: newCadence,
    zone: customerBook.subs[customerId].zone,
  };

  const decision = DECISIONS.evaluateRequest(request);

  if (decision.decision === "approved") {
    // Auto-approve: apply the cost and update subscription
    applyCharges(customerId, decision.costs.customer_contribution);
    updateCustomerCadence(customerId, newCadence);
    logAudit(decision.audit);
  } else if (decision.decision === "pending_review") {
    // Send to admin for review, flag customer with cost estimate
    flagForManualReview(customerId, decision);
    notifyCustomer(customerId, {
      message: `Your cadence change request requires review.`,
      estimated_cost: decision.costs.customer_contribution,
    });
  }
}

// When customer changes delivery location:
function handleLocationChange(customerId, newLocation) {
  const request = {
    type: "location_change",
    customerId,
    oldLocation: customerBook.subs[customerId].zone,
    newLocation,
  };

  const decision = DECISIONS.evaluateRequest(request);

  if (decision.costs.customer_contribution > 0) {
    notifyCustomer(customerId, {
      message: "Location change charge applied",
      amount: decision.costs.customer_contribution,
      reason: `Change ${decision.impacts.changes_used} of ${CONFIG.get("monthly_free_location_changes")} free per month`,
    });
    applyCharges(customerId, decision.costs.customer_contribution);
  }

  updateCustomerLocation(customerId, newLocation);
  logAudit(decision.audit);
}

// When dispatch can't fit customer into existing route:
function handleExternalDispatchNeeded(customerId, zone, stops) {
  const request = {
    type: "external_dispatch",
    customerId,
    zone,
    stops,
    can_fit_existing_route: false,
  };

  const decision = DECISIONS.evaluateRequest(request);

  if (decision.decision === "approved") {
    // Auto-approve, hire external driver
    hireExternalDriver(zone, stops);
    applyCharges(customerId, decision.costs.customer_contribution);
    logAudit(decision.audit);
  } else {
    // Flag for manual review
    flagForManualReview(customerId, decision);
  }
}
