/* decision-engine.js — Decision logic for customer requests.
   Evaluates operational impact: cadence changes, location changes, external drivers.
   Returns cost impact, approval status, and audit log. */
window.DECISIONS = (function () {
  const CFG = window.CONFIG;

  /* Monthly location change tracking. */
  const locationChangeStore = {};

  function resetMonthlyCounter(customerId) {
    locationChangeStore[customerId] = {
      month: new Date().getMonth(),
      count: 0,
    };
  }

  function getLocationChangeCount(customerId) {
    const now = new Date();
    const store = locationChangeStore[customerId];
    if (!store || store.month !== now.getMonth()) {
      resetMonthlyCounter(customerId);
    }
    return locationChangeStore[customerId].count;
  }

  function incrementLocationChangeCount(customerId) {
    const count = getLocationChangeCount(customerId);
    locationChangeStore[customerId].count = count + 1;
    return locationChangeStore[customerId].count;
  }

  /* ─────────────────── DECISION LOGIC ──────────────────── */

  /**
   * Evaluate a cadence change request.
   * Determines: impact on schedule, cost, approval status.
   */
  function evaluateCadenceChange(request) {
    const {
      customerId,
      currentCadence,
      requestedCadence,
      zone,
    } = request;

    const audit = {
      type: "cadence_change",
      timestamp: new Date().toISOString(),
      customerId,
      zone,
      currentCadence,
      requestedCadence,
    };

    // Cadence change does disrupt schedule (requires re-clustering)
    const disrupts_schedule = currentCadence !== requestedCadence;

    let operational_cost_impact = 0;
    let customer_contribution = 0;
    let company_contribution = 0;
    let requires_manual_review = CFG.get("require_manual_review_cadence_change");

    if (disrupts_schedule && CFG.get("cadence_change_fee_applies")) {
      operational_cost_impact = CFG.get("operational_flexibility_fee");
      customer_contribution = operational_cost_impact; // customer pays entire flexibility fee for cadence
      company_contribution = 0;
    }

    audit.disrupts_schedule = disrupts_schedule;
    audit.operational_cost_impact = operational_cost_impact;
    audit.customer_contribution = customer_contribution;
    audit.company_contribution = company_contribution;
    audit.requires_manual_review = requires_manual_review;
    audit.approved = !requires_manual_review;

    return {
      decision: requires_manual_review ? "pending_review" : "approved",
      impacts: {
        affects_schedule: disrupts_schedule,
        operational_cost_impact,
      },
      costs: {
        customer_contribution,
        company_contribution,
        total_operational_cost: operational_cost_impact,
      },
      audit,
    };
  }

  /**
   * Evaluate a location change request.
   * Tracks monthly free changes, applies fee after threshold.
   */
  function evaluateLocationChange(request) {
    const {
      customerId,
      newLocation,
      oldLocation,
    } = request;

    const audit = {
      type: "location_change",
      timestamp: new Date().toISOString(),
      customerId,
      oldLocation,
      newLocation,
    };

    // Determine if this is a location change (comparing zone, not exact address)
    const is_location_change = oldLocation !== newLocation;
    const change_count = incrementLocationChangeCount(customerId);
    const free_allowance = CFG.get("monthly_free_location_changes");
    const exceeds_allowance = change_count > free_allowance;

    let customer_contribution = 0;
    let operational_cost_impact = 0;

    if (is_location_change && exceeds_allowance) {
      operational_cost_impact = CFG.get("location_change_fee");
      customer_contribution = operational_cost_impact;
    }

    audit.is_location_change = is_location_change;
    audit.monthly_change_count = change_count;
    audit.free_allowance = free_allowance;
    audit.exceeds_allowance = exceeds_allowance;
    audit.operational_cost_impact = operational_cost_impact;
    audit.customer_contribution = customer_contribution;
    audit.approved = true; // location changes are always approved (auto-charge if needed)

    return {
      decision: "approved",
      impacts: {
        affects_schedule: is_location_change,
        changes_used: change_count,
        changes_remaining: Math.max(0, free_allowance - change_count),
      },
      costs: {
        customer_contribution,
        company_contribution: 0,
        total_operational_cost: operational_cost_impact,
      },
      audit,
    };
  }

  /**
   * Evaluate external driver dispatch requirement.
   * Determines if route can fit fleet OR if external driver needed.
   * Calculates cost split.
   */
  function evaluateExternalDispatch(request) {
    const {
      customerId,
      zone,
      stops,
      can_fit_existing_route, // boolean: does this fit an existing car's route?
    } = request;

    const audit = {
      type: "external_dispatch",
      timestamp: new Date().toISOString(),
      customerId,
      zone,
      stops,
    };

    const requires_external_driver = !can_fit_existing_route;
    let operational_cost_impact = 0;
    let customer_contribution = 0;
    let company_contribution = 0;

    if (requires_external_driver) {
      // Cost per stop with external driver
      operational_cost_impact = CFG.get("external_driver_cost_per_stop") * stops;

      // Cost split: customer pays flexibility fee + contribution
      const flexibility_fee = CFG.get("operational_flexibility_fee");
      const subsidy_per_stop = CFG.get("company_subsidy_per_external_stop");
      const max_subsidy = CFG.get("max_company_subsidy_per_order");

      customer_contribution = flexibility_fee + (stops * (CFG.get("external_driver_cost_per_stop") - subsidy_per_stop));
      company_contribution = Math.min(subsidy_per_stop * stops, max_subsidy);
    }

    const requires_manual_review = CFG.get("require_manual_review_external_dispatch");

    audit.requires_external_driver = requires_external_driver;
    audit.operational_cost_impact = operational_cost_impact;
    audit.customer_contribution = customer_contribution;
    audit.company_contribution = company_contribution;
    audit.requires_manual_review = requires_manual_review && requires_external_driver;
    audit.approved = !audit.requires_manual_review;

    return {
      decision: requires_external_driver
        ? requires_manual_review ? "pending_review" : "approved"
        : "approved",
      impacts: {
        requires_external_driver,
        operational_cost_impact,
      },
      costs: {
        customer_contribution,
        company_contribution,
        total_operational_cost: operational_cost_impact,
      },
      audit,
    };
  }

  /**
   * Evaluate a generic customer request.
   * Routes to the appropriate decision logic.
   */
  function evaluateRequest(request) {
    const { type } = request;

    switch (type) {
      case "cadence_change":
        return evaluateCadenceChange(request);
      case "location_change":
        return evaluateLocationChange(request);
      case "external_dispatch":
        return evaluateExternalDispatch(request);
      default:
        return {
          decision: "unknown_request_type",
          audit: { type, timestamp: new Date().toISOString() },
        };
    }
  }

  /**
   * Comprehensive evaluation: check all impacts of a customer request.
   * Answer key questions about operational impact.
   */
  function comprehensiveEvaluation(request) {
    const result = evaluateRequest(request);

    return {
      ...result,
      questions_answered: {
        affects_optimized_schedule: result.impacts.affects_schedule ?? false,
        requires_external_driver: result.impacts.requires_external_driver ?? false,
        operational_cost: result.impacts.operational_cost_impact ?? 0,
        customer_should_pay: result.costs.customer_contribution ?? 0,
        company_absorbs: result.costs.company_contribution ?? 0,
        approval_required: result.decision === "pending_review",
      },
    };
  }

  return {
    evaluateCadenceChange,
    evaluateLocationChange,
    evaluateExternalDispatch,
    evaluateRequest,
    comprehensiveEvaluation,
    getLocationChangeCount,
    resetMonthlyCounter,
  };
})();
