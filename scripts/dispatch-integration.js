/* dispatch-integration.js — Decision engine + cost tracking for Smart Dispatch.
   Manages customer subscriptions, charges, approval workflows, audit logs. */
window.DISPATCH_INTEGRATION = (function () {
  const CFG = window.CONFIG;
  const DECISIONS = window.DECISIONS;

  /* Customer account tracking: subscriptions, charges, audit trail. */
  const accounts = {};
  const auditLog = [];
  const KEY_ACCOUNTS = "cbyai.dispatch.accounts.v1";
  const KEY_AUDIT = "cbyai.dispatch.audit.v1";

  /* Customer subscription state. */
  function getAccount(customerId) {
    if (!accounts[customerId]) {
      accounts[customerId] = {
        customerId,
        zone: null,
        cadence: 2, // default: 2-day
        totalCharges: 0,
        monthlyCharges: {}, // month -> amount
        pendingApprovals: [],
        createdAt: new Date().toISOString(),
      };
    }
    return accounts[customerId];
  }

  /* Charge customer. Track by month for reporting. */
  function chargeCustomer(customerId, amount, reason) {
    const account = getAccount(customerId);
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    account.totalCharges += amount;
    if (!account.monthlyCharges[month]) account.monthlyCharges[month] = 0;
    account.monthlyCharges[month] += amount;

    console.log(
      `[CHARGE] ${customerId}: AED ${amount} (${reason}). Total: AED ${account.totalCharges}`
    );
    saveAccounts();
  }

  /* Approve a pending request. */
  function approvePendingRequest(requestId, adminNotes) {
    const idx = auditLog.findIndex((a) => a.id === requestId);
    if (idx >= 0) {
      auditLog[idx].approvedAt = new Date().toISOString();
      auditLog[idx].approvedBy = "admin";
      auditLog[idx].adminNotes = adminNotes || "";
      saveAudit();
      return true;
    }
    return false;
  }

  /* Reject a pending request. */
  function rejectPendingRequest(requestId, reason) {
    const idx = auditLog.findIndex((a) => a.id === requestId);
    if (idx >= 0) {
      auditLog[idx].rejectedAt = new Date().toISOString();
      auditLog[idx].rejectionReason = reason;
      saveAudit();
      return true;
    }
    return false;
  }

  /* ─────────────────────────────── DECISION HANDLING ──────────────────────────────── */

  /**
   * Handle cadence change request (2-day ↔ 3-day).
   */
  function handleCadenceChange(customerId, zone, newCadence) {
    const account = getAccount(customerId);
    const oldCadence = account.cadence;

    const request = {
      type: "cadence_change",
      customerId,
      currentCadence: oldCadence,
      requestedCadence: newCadence,
      zone,
    };

    const decision = DECISIONS.evaluateRequest(request);
    const auditEntry = {
      id: `${customerId}-${Date.now()}`,
      ...decision.audit,
      handledAt: new Date().toISOString(),
    };

    if (decision.decision === "approved") {
      // Auto-approve: apply charge and update subscription
      account.cadence = newCadence;
      if (decision.costs.customer_contribution > 0) {
        chargeCustomer(
          customerId,
          decision.costs.customer_contribution,
          `Cadence change ${oldCadence}-day → ${newCadence}-day`
        );
      }
      auditEntry.approvedAt = new Date().toISOString();
      auditEntry.approved = true;
    } else {
      // Pending review: hold the subscription, notify admin
      account.pendingApprovals.push(auditEntry.id);
      auditEntry.status = "pending_review";
    }

    auditLog.push(auditEntry);
    saveAccounts();
    saveAudit();

    return {
      decision: decision.decision,
      cadence: account.cadence,
      charges: decision.costs.customer_contribution,
      audit: auditEntry,
    };
  }

  /**
   * Handle location change request (zone to zone).
   */
  function handleLocationChange(customerId, newZone) {
    const account = getAccount(customerId);
    const oldZone = account.zone;

    const request = {
      type: "location_change",
      customerId,
      oldLocation: oldZone,
      newLocation: newZone,
    };

    const decision = DECISIONS.evaluateRequest(request);
    const auditEntry = {
      id: `${customerId}-${Date.now()}`,
      ...decision.audit,
      handledAt: new Date().toISOString(),
      approved: true, // location changes are always auto-approved
      approvedAt: new Date().toISOString(),
    };

    // Update zone
    account.zone = newZone;

    // Apply charges if any
    if (decision.costs.customer_contribution > 0) {
      chargeCustomer(
        customerId,
        decision.costs.customer_contribution,
        `Location change ${oldZone} → ${newZone} (change ${decision.impacts.changes_used}/${CFG.get("monthly_free_location_changes")})`
      );
      auditEntry.charges_applied = decision.costs.customer_contribution;
    }

    auditLog.push(auditEntry);
    saveAccounts();
    saveAudit();

    return {
      decision: "approved",
      zone: account.zone,
      changes_used: decision.impacts.changes_used,
      changes_remaining: decision.impacts.changes_remaining,
      charges: decision.costs.customer_contribution,
      audit: auditEntry,
    };
  }

  /**
   * Handle external dispatch request (can't fit existing route).
   */
  function handleExternalDispatch(customerId, zone, stops) {
    const request = {
      type: "external_dispatch",
      customerId,
      zone,
      stops,
      can_fit_existing_route: false,
    };

    const decision = DECISIONS.evaluateRequest(request);
    const auditEntry = {
      id: `${customerId}-${Date.now()}`,
      ...decision.audit,
      handledAt: new Date().toISOString(),
    };

    if (decision.decision === "approved") {
      // Auto-approve: hire external driver, charge customer
      chargeCustomer(
        customerId,
        decision.costs.customer_contribution,
        `External dispatch: ${stops} stops in ${zone}`
      );
      auditEntry.approvedAt = new Date().toISOString();
      auditEntry.approved = true;
      auditEntry.charges_applied = decision.costs.customer_contribution;
    } else {
      // Pending review
      getAccount(customerId).pendingApprovals.push(auditEntry.id);
      auditEntry.status = "pending_review";
    }

    auditLog.push(auditEntry);
    saveAccounts();
    saveAudit();

    return {
      decision: decision.decision,
      charges: decision.costs.customer_contribution,
      company_absorbs: decision.costs.company_contribution,
      audit: auditEntry,
    };
  }

  /* ─────────────────────────────── QUERIES ──────────────────────────────── */

  function getAccountSummary(customerId) {
    const account = getAccount(customerId);
    const month = new Date().toISOString().slice(0, 7);
    return {
      customerId,
      zone: account.zone,
      cadence: account.cadence,
      totalCharges: account.totalCharges,
      monthlyCharges: account.monthlyCharges[month] || 0,
      pendingApprovals: account.pendingApprovals.length,
    };
  }

  function getAuditLog(filters = {}) {
    let result = [...auditLog];
    if (filters.customerId) result = result.filter((a) => a.customerId === filters.customerId);
    if (filters.type) result = result.filter((a) => a.type === filters.type);
    if (filters.approved !== undefined) result = result.filter((a) => (a.approved ? true : false) === filters.approved);
    return result;
  }

  function getPendingApprovals() {
    return auditLog.filter((a) => a.status === "pending_review" && !a.approvedAt && !a.rejectedAt);
  }

  /* ─────────────────────────────── PERSISTENCE ──────────────────────────────── */

  function saveAccounts() {
    try {
      localStorage.setItem(KEY_ACCOUNTS, JSON.stringify(accounts));
    } catch (e) {
      console.error("Failed to save accounts", e);
    }
  }

  function loadAccounts() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY_ACCOUNTS) || "{}");
      Object.assign(accounts, stored);
    } catch (e) {
      console.error("Failed to load accounts", e);
    }
  }

  function saveAudit() {
    try {
      localStorage.setItem(KEY_AUDIT, JSON.stringify(auditLog));
    } catch (e) {
      console.error("Failed to save audit log", e);
    }
  }

  function loadAudit() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY_AUDIT) || "[]");
      auditLog.length = 0;
      auditLog.push(...stored);
    } catch (e) {
      console.error("Failed to load audit log", e);
    }
  }

  function reset() {
    Object.keys(accounts).forEach((k) => delete accounts[k]);
    auditLog.length = 0;
    try {
      localStorage.removeItem(KEY_ACCOUNTS);
      localStorage.removeItem(KEY_AUDIT);
    } catch (e) {}
  }

  // Load on init
  loadAccounts();
  loadAudit();

  return {
    getAccount,
    getAccountSummary,
    chargeCustomer,
    approvePendingRequest,
    rejectPendingRequest,
    handleCadenceChange,
    handleLocationChange,
    handleExternalDispatch,
    getAuditLog,
    getPendingApprovals,
    reset,
  };
})();
