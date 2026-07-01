/* app.js — interactive smart planner UI. Inputs → weekly schedule. Saves locally. */
(function () {
  const R = window.ROUTES;
  const P = window.PLANNER;
  const $ = (s) => document.querySelector(s);
  const KEY = "routedesk.plan.v4";

  const CFG_FIELDS = ["pricePerL", "kmPerL", "windowMin", "stopMin", "bagCap", "avgKmh", "costPerCarMonth"];
  const CLUSTER_LABEL = { corridor: "Corridor (Dubai→UAQ)", rak: "Ras Al Khaimah", south: "Abu Dhabi / Al Ain", east: "Fujairah" };
  const FULL_DAY = { Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday" };

  const CHECKLIST = [
    "<b>Furthest first.</b> Deliver the most distant stops earliest so cold bags arrive in time.",
    "<b>Beat the traffic.</b> Leave before 7pm — Dubai roads (E311 / Sheikh Zayed) jam in the evening peak.",
    "<b>Load in reverse.</b> Pack furthest-stop bags first, nearest on top.",
    "<b>Peak days are Sun and Wed</b> — corridor 3-day subs AND South cluster both run. Each day has at most 1 secondary route (RAK: Sat/Tue · South: Sun/Wed · East: Mon/Thu), so fleet&nbsp;2 always covers all 4 clusters.",
    "<b>Over-window runs</b> (red) exceed the 5-hour window — Abu Dhabi / Al Ain need a depot or a 5+ cluster to be worth it.",
    "<b>If it says over capacity,</b> trim far zones, shift more customers to the 3-day plan, or add a car."
  ];

  let book = P.defaultBook();

  /* ---------- persistence ---------- */
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ book, cfg: R.CONFIG })); } catch (e) {} }
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || "null");
      if (data && data.book && data.book.subs) book = data.book;
      if (data && data.cfg) CFG_FIELDS.forEach((k) => { if (k in data.cfg) R.setConfig(k, data.cfg[k]); });
    } catch (e) {}
  }

  /* ---------- inputs ---------- */
  function renderZoneInputs() {
    $("#zoneInputs").innerHTML = R.ZONES.map((z) =>
      `<label class="zin">
        <span class="zin-name"><span class="zin-dir dir-${z.dir}"></span>${z.name}</span>
        <input type="number" min="0" step="1" data-zone="${z.id}" value="${book.subs[z.id] || 0}" />
      </label>`).join("");
    $("#slPct").value = book.pct2;
  }
  function syncCfgInputs() { CFG_FIELDS.forEach((k) => { const el = $(`#cfg-${k}`); if (el) el.value = R.CONFIG[k]; }); }

  /* ---------- KPIs ---------- */
  function renderKpis(s) {
    const kpis = [
      { v: s.totalSubs, l: "Subscribers", sub: `${s.two} × 2-day · ${s.three} × 3-day`, cls: "" },
      { v: s.weeklyDeliveries, l: "Deliveries / week", sub: `${s.monthlyDeliveries} / month`, cls: "blue" },
      { v: s.carsNeeded, l: "Runs / day (peak)", sub: `fleet of ${s.fleet}`, cls: s.feasible ? "green" : "red" },
      { v: s.maxSubs, l: `Max subs @ ${s.fleet} cars`, sub: "at this plan mix", cls: "amber" },
      { v: s.costPerDelivery != null ? "AED " + s.costPerDelivery : "—", l: "Cost / delivery", sub: `AED ${s.monthlyCost.toLocaleString()} / mo`, cls: "" }
    ];
    $("#kpis").innerHTML = kpis.map((k) =>
      `<div class="kpi ${k.cls}"><div class="v">${k.v}</div><div class="l">${k.l}</div><div class="s">${k.sub}</div></div>`).join("");
  }

  /* ---------- feasibility banner ---------- */
  function renderBanner(s) {
    const b = $("#feasBanner");
    if (s.feasible) {
      b.className = "feas-banner ok";
      b.innerHTML = `✓ Fits ${s.fleet} car${s.fleet === 1 ? "" : "s"}. <span class="fb-sub">Whole book scheduled — peak ${s.carsNeeded} run${s.carsNeeded === 1 ? "" : "s"}/day, ${s.maxSubs - s.totalSubs} subscribers of headroom.</span>`;
    } else {
      const over = s.totalSubs - s.maxSubs;
      const unservedNote = s.sched.unserved > 0 ? `${s.sched.unserved} deliveries/week can't be placed. ` : "";
      b.className = "feas-banner bad";
      b.innerHTML = `✗ Over capacity for ${s.fleet} cars. <span class="fb-sub">${unservedNote}${s.fleet} cars max ≈ ${s.maxSubs} subscribers; you have ${s.totalSubs}${over > 0 ? ` (${over} over)` : ""}. Add a car, trim far zones, or shift to the 3-day plan.</span>`;
    }
  }

  /* ---------- weekly schedule ---------- */
  function runCard(run, carNo) {
    const stops = run.zones.map((z) => `<span class="stop-chip">${z.name} <b>${z.stops}</b></span>`).join("");
    const metrics = [
      { v: run.km + " km", l: "Round-trip" },
      { v: run.totalMin + " min", l: "Time", flag: run.overWindow },
      { v: "AED " + run.fuel.toFixed(1), l: "Fuel" }
    ];
    return `<article class="run ${run.overWindow ? "over" : ""}">
      <div class="run-top">
        <div class="run-badge">${carNo}</div>
        <div><div class="run-title">Car ${carNo} — ${CLUSTER_LABEL[run.cluster] || run.cluster}</div><div class="run-path">${run.path}</div></div>
      </div>
      <div class="run-stops">${stops}</div>
      <div class="run-flags">
        <span class="badge ${run.ccCls}"><span class="dot"></span>${run.cc}</span>
        <span class="badge b-amber">${run.totalStops} stops</span>
        ${run.overWindow ? '<span class="badge b-red">⚠ Over window</span>' : ""}
      </div>
      <div class="run-metrics">
        ${metrics.map((m) => `<div class="metric ${m.flag ? "flag" : ""}"><div class="mv">${m.v}</div><div class="ml">${m.l}</div></div>`).join("")}
      </div>
    </article>`;
  }

  function renderSchedule(s) {
    const sched = s.sched;
    const cols = P.DAYS.map((day) => {
      if (day === "Fri") {
        return `<div class="sched-day rest"><div class="sd-name">Fri <span class="sd-sub">rest</span></div>
          <div class="sd-rest">No deliveries. Restock, clean cars, plan next week.</div></div>`;
      }
      const runs = sched.runsByDay[day] || [];
      const total = sched.dayTotal[day] || 0;
      const cards = runs.length
        ? runs.map((r, i) => runCard(r, i + 1)).join("")
        : `<div class="sd-rest">No runs scheduled.</div>`;
      return `<div class="sched-day"><div class="sd-name">${day} <span class="sd-sub">${total} stops · ${runs.length}/${s.fleet} cars</span></div>${cards}</div>`;
    }).join("");
    $("#sched").innerHTML = cols;
  }

  /* ---------- weekly load table ---------- */
  function renderLoadTable(s) {
    const sched = s.sched;
    let peakDay = P.ACTIVE[0];
    P.ACTIVE.forEach((d) => { if ((sched.dayTotal[d] || 0) > (sched.dayTotal[peakDay] || 0)) peakDay = d; });
    const head = `<thead><tr><th>Zone</th>${P.DAYS.map((d) => `<th class="num">${d}</th>`).join("")}<th class="num">Week</th></tr></thead>`;
    const rows = R.ZONES.map((z) => {
      let wk = 0;
      const cells = P.DAYS.map((d) => {
        const v = (sched.grid[z.id] && sched.grid[z.id][d]) || 0; wk += v;
        return `<td class="num ${v === 0 ? "cell-zero" : ""}">${v || "·"}</td>`;
      }).join("");
      return `<tr><td><span class="zname">${z.name}</span></td>${cells}<td class="num">${wk}</td></tr>`;
    }).join("");
    let weekAll = 0;
    const totals = `<tr class="total-row"><td>All zones</td>${P.DAYS.map((d) => {
      const t = sched.dayTotal[d] || 0; weekAll += t;
      return `<td class="num ${d === peakDay ? "cell-peak" : ""}">${t || "·"}</td>`;
    }).join("")}<td class="num">${weekAll}</td></tr>`;
    $("#loadTable").innerHTML = head + `<tbody>${rows}${totals}</tbody>`;
  }

  /* ---------- distance reference ---------- */
  function renderDistTable() {
    const head = `<thead><tr><th>Zone</th><th class="num">km</th><th class="num">One-way</th><th class="num">Round-trip</th><th class="num">Max stops</th><th class="num">Fuel/route</th><th>Cold-chain</th></tr></thead>`;
    const rows = R.computedZones().map((z) =>
      `<tr><td><span class="zname">${z.name}</span></td>
        <td class="num">${z.km}</td><td class="num">${z.oneWay} min</td><td class="num">${z.rtMin} min</td>
        <td class="num">${z.effective}</td><td class="num">AED ${z.fuelRoute.toFixed(1)}</td>
        <td><span class="badge ${z.ccCls}"><span class="dot"></span>${z.cc}</span></td></tr>`).join("");
    $("#distTable").innerHTML = head + `<tbody>${rows}</tbody>`;
  }

  function renderChecklist() { $("#checklist").innerHTML = CHECKLIST.map((c) => `<li>${c}</li>`).join(""); }

  /* ---------- recompute ---------- */
  function recompute() {
    const s = P.summary(book);
    $("#lblPct").textContent = book.pct2 + "%";
    $("#splitNote").textContent = `Corridor: ${s.corridorTwo} on 2-day (3×/wk) · ${s.corridorThree} on 3-day (2×/wk). Far zones (${s.secondaryTotal} subs): fixed 2×/wk on their route days regardless of slider.`;
    $("#fleetInput").value = s.fleet;
    renderKpis(s);
    renderBanner(s);
    renderSchedule(s);
    renderLoadTable(s);
    renderDistTable();
    save();
  }

  /* ---------- CSV ---------- */
  function exportCsv() {
    const s = P.summary(book);
    const rows = [["Zone", ...P.DAYS, "Week total"]];
    R.ZONES.forEach((z) => {
      let wk = 0; const cells = P.DAYS.map((d) => { const v = (s.sched.grid[z.id] && s.sched.grid[z.id][d]) || 0; wk += v; return v; });
      rows.push([z.name, ...cells, wk]);
    });
    rows.push(["All zones", ...P.DAYS.map((d) => s.sched.dayTotal[d] || 0), s.weeklyDeliveries]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "routedesk-weekly-schedule.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  /* ---------- init ---------- */
  function init() {
    load();
    if (!book.fleet) book.fleet = 2; // default fleet, stays until changed
    renderZoneInputs();
    syncCfgInputs();
    renderChecklist();
    recompute();

    $("#zoneInputs").addEventListener("input", (e) => {
      const inp = e.target.closest("[data-zone]");
      if (!inp) return;
      book.subs[inp.dataset.zone] = Math.max(0, parseInt(inp.value, 10) || 0);
      recompute();
    });
    $("#slPct").addEventListener("input", (e) => { book.pct2 = +e.target.value; recompute(); });
    $("#fleetInput").addEventListener("input", (e) => { book.fleet = Math.max(1, parseInt(e.target.value, 10) || 1); recompute(); });
    CFG_FIELDS.forEach((k) => $(`#cfg-${k}`).addEventListener("change", (e) => { R.setConfig(k, e.target.value); syncCfgInputs(); recompute(); }));
    $("#resetBtn").addEventListener("click", () => {
      if (!confirm("Reset book and assumptions to defaults?")) return;
      book = P.defaultBook(); R.resetConfig(); renderZoneInputs(); syncCfgInputs(); recompute();
    });
    $("#exportBtn").addEventListener("click", exportCsv);
    $("#printBtn").addEventListener("click", () => window.print());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
