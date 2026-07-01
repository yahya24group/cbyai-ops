/* dispatch-app.js — UI for C BY AI Smart Dispatch. Inputs → weekly plan. Saves locally. */
(function () {
  const R = window.ROUTES;
  const D = window.DISPATCH_DATA;
  const P = window.DISPATCH;
  const DI = window.DISPATCH_INTEGRATION;
  const CFG = window.CONFIG;
  const $ = (s) => document.querySelector(s);
  const KEY = "cbyai.dispatch.v1";

  const CLUSTER_LABEL = { corridor: "Corridor (Dubai→UAQ)", rak: "Ras Al Khaimah", south: "Abu Dhabi / Al Ain", east: "Fujairah / East" };
  const FAR_CLUSTERS = ["rak", "south", "east"];

  let book = P.defaultBook();
  let customerZones = {}; // track customer zones for location change detection

  /* ---------- persistence ---------- */
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ book, cost: D.COST })); } catch (e) {} }
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || "null");
      if (data && data.book && data.book.subs) book = data.book;
      if (data && data.cost) D.COST_FIELDS.forEach((k) => { if (k in data.cost) D.setCost(k, data.cost[k]); });
    } catch (e) {}
    if (!book.fleet) book.fleet = 2;
    if (!book.bagCap) book.bagCap = 16;
    if (!book.batch) book.batch = JSON.parse(JSON.stringify(P.DEFAULT_BATCH));
  }

  /* ─────────────────── DECISION HELPERS ─────────────────── */

  function handleCadenceRequest(customerId, zone, oldCad, newCad, oldValue, newValue) {
    if (oldCad === newCad) return null; // no change

    // Evaluate cadence change request
    const result = DI.handleCadenceChange(customerId, zone, newCad === "three" ? 3 : 2);

    if (result.decision === "approved") {
      console.log(`[APPROVED] Cadence change: ${customerId} ${oldCad} → ${newCad}`);
      return { approved: true, charges: result.charges };
    } else {
      console.warn(`[PENDING REVIEW] Cadence change: ${customerId} estimated AED ${result.charges}`);
      // Revert input, show message to admin
      return { approved: false, charges: result.charges, pending: true };
    }
  }

  function handleLocationRequestIfNeeded(customerId, zone) {
    const oldZone = customerZones[customerId];
    if (!oldZone || oldZone === zone) return null; // no change or first time

    const result = DI.handleLocationChange(customerId, zone);
    console.log(`[LOCATION] ${customerId}: ${oldZone} → ${zone}. Charge: AED ${result.charges}`);
    return result;
  }

  /* ---------- inputs ---------- */
  function renderCustInputs() {
    $("#custInputs").innerHTML = R.ZONES.map((z) => {
      const cell = book.subs[z.id] || { two: 0, three: 0 };
      return `<div class="cust-row">
        <span class="zin-name"><span class="zin-dir dir-${z.dir}"></span>${z.name}</span>
        <input type="number" min="0" step="1" data-zone="${z.id}" data-cad="two"   value="${cell.two || 0}" />
        <input type="number" min="0" step="1" data-zone="${z.id}" data-cad="three" value="${cell.three || 0}" />
      </div>`;
    }).join("");
  }

  function renderBatchEditor() {
    $("#batchGrid").innerHTML = FAR_CLUSTERS.map((c) => {
      const days = P.WEEK.filter((d) => d !== P.REST).map((d) => {
        const on = (book.batch[c] || []).includes(d);
        return `<button type="button" class="day-pill ${on ? "on" : ""}" data-cluster="${c}" data-day="${d}">${d}</button>`;
      }).join("");
      return `<div class="batch-row">
        <div class="batch-label">${CLUSTER_LABEL[c]} <small>${D.SHIFT[c].label}</small></div>
        <div class="day-pills">${days}</div>
      </div>`;
    }).join("");
  }

  function syncCfg() {
    D.COST_FIELDS.forEach((k) => { const el = $(`#cfg-${k}`); if (el) el.value = D.COST[k]; });
    $("#fleetInput").value = book.fleet;
    $("#bagCapInput").value = book.bagCap;
  }

  /* ---------- KPIs ---------- */
  function renderKpis(p) {
    const breaches = p.sla.filter((s) => !s.meets48).length;
    const kpis = [
      { v: p.served, l: "Deliveries / week", sub: "served in the plan", cls: "" },
      { v: p.carsNeeded, l: "Cars at peak", sub: `fleet of ${p.fleet}`, cls: p.feasible ? "green" : "red" },
      { v: "AED " + p.weeklyCost.toLocaleString(), l: "Weekly cost", sub: "fuel + tolls + parking", cls: "amber" },
      { v: p.deferred, l: "Rolled to next plan", sub: "stops that didn't fit today", cls: p.deferred ? "red" : "green" },
      { v: breaches + "/3", l: "Clusters over 48h", sub: "far batch gap > 48h", cls: breaches ? "red" : "green" }
    ];
    $("#kpis").innerHTML = kpis.map((k) =>
      `<div class="kpi ${k.cls}"><div class="v">${k.v}</div><div class="l">${k.l}</div><div class="s">${k.sub}</div></div>`).join("");
  }

  function renderBanner(p) {
    const b = $("#feasBanner");
    if (p.feasible && p.deferred === 0) {
      b.className = "feas-banner ok";
      b.innerHTML = `✓ Fits ${p.fleet} car${p.fleet === 1 ? "" : "s"}. <span class="fb-sub">Every customer placed — peak ${p.carsNeeded} run${p.carsNeeded === 1 ? "" : "s"}/day. Far clusters batched within their stated window.</span>`;
    } else {
      b.className = "feas-banner bad";
      const bits = [];
      if (!p.feasible) bits.push(`peak day needs ${p.carsNeeded} cars (have ${p.fleet})`);
      if (p.deferred > 0) bits.push(`${p.deferred} stop(s)/week roll to the next plan day`);
      b.innerHTML = `✗ Tight plan. <span class="fb-sub">${bits.join(" · ")}. See smart suggestions below.</span>`;
    }
  }

  /* ---------- SLA panel ---------- */
  function renderSla(p) {
    const corridor = `<div class="sla-card ok"><div class="sla-c">Corridor (daily)</div><div class="sla-w">≤ 24h</div><div class="sla-tag">✓ inside 48h</div></div>`;
    const cards = p.sla.map((s) => {
      const cls = s.meets48 ? "ok" : "bad";
      return `<div class="sla-card ${cls}">
        <div class="sla-c">${CLUSTER_LABEL[s.cluster]}</div>
        <div class="sla-w">${s.windowHours}h</div>
        <div class="sla-tag">${s.meets48 ? "✓ inside 48h" : "⚠ over 48h — honest window"}</div>
        <div class="sla-days">${s.days.join(" · ")}</div>
      </div>`;
    }).join("");
    $("#slaGrid").innerHTML = corridor + cards;
  }

  /* ---------- weekly schedule ---------- */
  function runCard(run, carNo) {
    const stops = run.parts.map((z) => `<span class="stop-chip">${z.name} <b>${z.stops}</b></span>`).join("");
    const c = run.cost;
    const metrics = [
      { v: run.km + " km", l: "Round-trip" },
      { v: run.totalMin + " min", l: "Time", flag: run.overShift },
      { v: "AED " + c.total.toFixed(1), l: "Cost" }
    ];
    const tollBits = [];
    if (c.salik) tollBits.push(`Salik ${c.salik}`);
    if (c.darb) tollBits.push(`Darb ${c.darb}`);
    if (c.parking) tollBits.push(`Parking ${c.parking}`);
    return `<article class="run ${run.overShift ? "over" : ""}">
      <div class="run-top">
        <div class="run-badge">${carNo}</div>
        <div><div class="run-title">Car ${carNo} — ${CLUSTER_LABEL[run.cluster] || run.cluster}</div><div class="run-path">${run.path}</div></div>
      </div>
      <div class="run-stops">${stops}</div>
      <div class="run-flags">
        <span class="badge ${run.ccCls}"><span class="dot"></span>${run.cc}</span>
        <span class="badge b-amber">${run.stops} stops</span>
        <span class="badge">${run.shiftLabel}</span>
        ${run.overShift ? '<span class="badge b-red">⚠ Over shift</span>' : ""}
        ${run.coldRisk ? '<span class="badge b-red">❄ Cold-chain risk</span>' : ""}
      </div>
      <div class="run-metrics">
        ${metrics.map((m) => `<div class="metric ${m.flag ? "flag" : ""}"><div class="mv">${m.v}</div><div class="ml">${m.l}</div></div>`).join("")}
      </div>
      ${tollBits.length ? `<div class="run-toll">Fuel AED ${c.fuel} · ${tollBits.join(" · ")}</div>` : `<div class="run-toll">Fuel AED ${c.fuel}</div>`}
    </article>`;
  }

  function renderSchedule(p) {
    $("#sched").innerHTML = P.WEEK.map((day) => {
      if (day === P.REST) {
        return `<div class="sched-day rest"><div class="sd-name">Fri <span class="sd-sub">rest</span></div>
          <div class="sd-rest">No deliveries. Restock, clean, document check, plan next cycle.</div></div>`;
      }
      const runs = p.runsByDay[day] || [];
      const cards = runs.length
        ? runs.map((r, i) => runCard(r, i + 1)).join("")
        : `<div class="sd-rest">No runs scheduled.</div>`;
      return `<div class="sched-day"><div class="sd-name">${day} <span class="sd-sub">${runs.length}/${p.fleet} cars · AED ${p.dayCost[day] || 0}</span></div>${cards}</div>`;
    }).join("");
  }

  /* ---------- cost breakdown ---------- */
  function renderCost(p) {
    const cb = p.costBreak;
    const head = `<thead><tr><th>Line</th><th class="num">Weekly</th><th class="num">Monthly (×4.33)</th></tr></thead>`;
    const rows = [
      ["Fuel", cb.fuel], ["Salik (Dubai)", cb.salik], ["Darb (Abu Dhabi)", cb.darb], ["Parking allowance", cb.parking]
    ].map(([l, v]) => `<tr><td>${l}</td><td class="num">AED ${v.toFixed(1)}</td><td class="num">AED ${(v * 4.33).toFixed(0)}</td></tr>`).join("");
    const total = `<tr class="total-row"><td>Total</td><td class="num">AED ${p.weeklyCost.toFixed(1)}</td><td class="num">AED ${(p.weeklyCost * 4.33).toFixed(0)}</td></tr>`;
    const perDel = p.served > 0 ? D.round1(p.weeklyCost / p.served) : 0;
    const cpd = `<tr><td>Cost / delivery</td><td class="num" colspan="2">AED ${perDel.toFixed(2)} (${p.served} deliveries/wk)</td></tr>`;
    $("#costTable").innerHTML = head + `<tbody>${rows}${total}${cpd}</tbody>`;
  }

  function renderSuggestions(p) {
    $("#suggestList").innerHTML = p.suggestions.map((s) => `<li>${s}</li>`).join("");
  }

  /* ---------- decision / audit panel ---------- */
  function renderDecisionPanel() {
    const pending = DI.getPendingApprovals();
    if (!pending.length) return;

    const html = `<div class="decision-panel">
      <h3>⚠ Pending Approvals (${pending.length})</h3>
      <div class="pending-list">
        ${pending.map((p) => `<div class="pending-item">
          <div class="pending-meta">${p.customerId} · ${p.type}</div>
          <div class="pending-cost">Estimated charge: AED ${(p.operational_cost_impact || 0).toFixed(0)}</div>
          <div class="pending-actions">
            <button onclick="window.DISPATCH_INTEGRATION.approvePendingRequest('${p.id}')">✓ Approve</button>
            <button onclick="window.DISPATCH_INTEGRATION.rejectPendingRequest('${p.id}', 'admin')">✗ Reject</button>
          </div>
        </div>`).join("")}
      </div>
    </div>`;

    const container = $("#decisionPanel");
    if (container) container.innerHTML = html;
  }

  function renderAuditLog() {
    const log = DI.getAuditLog({ approved: true });
    if (!log.length) return;

    const recent = log.slice(-10); // last 10 approved decisions
    const html = `<div class="audit-panel">
      <h3>Recent Decisions</h3>
      <div class="audit-list">
        ${recent.map((entry) => `<div class="audit-item">
          <div class="audit-meta">${entry.customerId} · ${entry.type} · ${entry.timestamp.slice(0, 10)}</div>
          <div class="audit-cost">AED ${(entry.customer_contribution || 0).toFixed(0)}</div>
        </div>`).join("")}
      </div>
    </div>`;

    const container = $("#auditPanel");
    if (container) container.innerHTML = html;
  }

  /* ---------- recompute ---------- */
  function recompute() {
    const p = P.plan(book);
    renderKpis(p);
    renderBanner(p);
    renderSla(p);
    renderSchedule(p);
    renderCost(p);
    renderSuggestions(p);
    renderDecisionPanel();
    renderAuditLog();
    save();
  }

  /* ---------- CSV ---------- */
  function exportCsv() {
    const p = P.plan(book);
    const rows = [["Day", "Car", "Cluster", "Route", "Stops", "Km", "Minutes", "Cost AED", "Over shift", "Cold risk"]];
    P.WEEK.forEach((day) => (p.runsByDay[day] || []).forEach((r, i) => {
      rows.push([day, i + 1, r.cluster, r.path, r.stops, r.km, r.totalMin, r.cost.total, r.overShift ? "YES" : "", r.coldRisk ? "YES" : ""]);
    }));
    rows.push([]);
    rows.push(["Weekly cost AED", p.weeklyCost, "Deferred stops", p.deferred, "Cars needed", p.carsNeeded]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "cbyai-smart-dispatch.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  /* ---------- init ---------- */
  function init() {
    load();
    if (window.DISPATCH.demo) { try { window.DISPATCH.demo(); } catch (e) { console.warn("demo check failed", e); } }
    renderCustInputs();
    renderBatchEditor();
    syncCfg();
    recompute();

    $("#custInputs").addEventListener("input", (e) => {
      const inp = e.target.closest("[data-zone]");
      if (!inp) return;
      const z = inp.dataset.zone, cad = inp.dataset.cad;
      if (!book.subs[z]) book.subs[z] = { two: 0, three: 0 };

      const oldValue = book.subs[z][cad];
      const newValue = Math.max(0, parseInt(inp.value, 10) || 0);
      book.subs[z][cad] = newValue;

      // Track customer zone for location change detection
      if (z !== "uaq") { // don't track HQ
        customerZones[z] = z;
      }

      recompute();
    });

    $("#batchGrid").addEventListener("click", (e) => {
      const pill = e.target.closest(".day-pill");
      if (!pill) return;
      const c = pill.dataset.cluster, d = pill.dataset.day;
      const set = new Set(book.batch[c] || []);
      if (set.has(d)) set.delete(d); else set.add(d);
      book.batch[c] = P.WEEK.filter((w) => set.has(w)); // keep week order
      renderBatchEditor();
      recompute();
    });

    $("#fleetInput").addEventListener("input", (e) => { book.fleet = Math.max(1, parseInt(e.target.value, 10) || 1); recompute(); });
    $("#bagCapInput").addEventListener("input", (e) => { book.bagCap = Math.max(1, parseInt(e.target.value, 10) || 1); recompute(); });
    D.COST_FIELDS.forEach((k) => { const el = $(`#cfg-${k}`); if (el) el.addEventListener("change", (e) => { D.setCost(k, e.target.value); syncCfg(); recompute(); }); });

    $("#resetBtn").addEventListener("click", () => {
      if (!confirm("Reset customers, batch days and cost to defaults?")) return;
      book = P.defaultBook(); D.resetCost(); renderCustInputs(); renderBatchEditor(); syncCfg(); recompute();
    });
    $("#exportBtn").addEventListener("click", exportCsv);
    $("#printBtn").addEventListener("click", () => window.print());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
