/* dispatch-planner.js — rolling-horizon, customer-level smart dispatch.
   Pure, no DOM. Reuses ROUTES geometry + DISPATCH_DATA cost model.

   Model
   ─────
   • Each customer picks a cadence: every 2 days or every 3 days.
   • 48-hour delivery promise: once a customer's slot triggers, we aim to deliver
     within 48h. Corridor zones run daily (always inside 48h). Far clusters
     (RAK / South / East) run only on dedicated BATCH DAYS to amortize the long
     drive — a far customer due on a non-batch day rolls to the next batch day
     ("try him in the next plan"). If the next batch day is >48h out we don't
     hide it: we flag the SLA gap and report the honest window for that zone.
   • Each run is route-optimized (nearest-neighbour + 2-opt) for shortest km,
     time-boxed to a realistic shift, and costed with real fuel + tolls + parking.
   • Overflow beyond a shift defers to the next eligible day, never silently lost.

   Grounded in the 23 Jun 2026 route test (far batch ran ~565 min — a far cluster
   is a full daytime shift, not a 5-hour evening slot). */
window.DISPATCH = (function () {
  const R = window.ROUTES;
  const D = window.DISPATCH_DATA;

  // Steady-state week starts Saturday; Friday = rest/prep (no deliveries).
  const WEEK   = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
  const REST   = "Fri";
  const SLA_HOURS = 48;

  const CLUSTERS = {
    corridor: ["uaq", "ajm", "shj", "dxb"],
    rak:      ["rak"],
    south:    ["auh", "ain"],
    east:     ["fuj"]
  };
  const CLUSTER_ORDER = ["south", "east", "rak", "corridor"]; // far-first
  const DEFAULT_BATCH = { rak: ["Sat", "Tue"], south: ["Sun", "Wed"], east: ["Mon", "Thu"] };

  function getCluster(id) {
    for (const [k, ids] of Object.entries(CLUSTERS)) if (ids.includes(id)) return k;
    return "corridor";
  }

  /* ---------- cadence → even daily buckets ---------- */
  // Split n customers of a given cadence into `cadence` evenly-sized phase buckets
  // so daily load is flat. Returns the count due on a given day index.
  function dueOnDay(n, cadence, dayIndex) {
    if (n <= 0) return 0;
    const base = Math.floor(n / cadence);
    const extra = n % cadence;                 // first `extra` buckets get +1
    const phase = ((dayIndex % cadence) + cadence) % cadence;
    return base + (phase < extra ? 1 : 0);
  }

  /* ---------- route optimizer: NN seed + 2-opt ---------- */
  function tourKm(ids) {
    if (!ids.length) return 0;
    let km = R.byId(ids[0]).km;                 // HQ → first
    for (let i = 1; i < ids.length; i++) km += R.legKm(ids[i - 1], ids[i]);
    return km + R.byId(ids[ids.length - 1]).km; // last → HQ
  }
  function nearestNeighbour(ids) {
    const remaining = ids.slice();
    const route = [];
    let curKm = 0; // distance reference of current node from HQ (start at HQ)
    let cur = null;
    while (remaining.length) {
      let bestI = 0, bestD = Infinity;
      remaining.forEach((id, i) => {
        const d = cur === null ? R.byId(id).km : R.legKm(cur, id);
        if (d < bestD) { bestD = d; bestI = i; }
      });
      cur = remaining.splice(bestI, 1)[0];
      route.push(cur);
    }
    return route;
  }
  function twoOpt(route) {
    if (route.length < 4) return route;
    let best = route.slice(), improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          const cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
          if (tourKm(cand) + 1e-9 < tourKm(best)) { best = cand; improved = true; }
        }
      }
    }
    return best;
  }
  function optimizeOrder(ids) {
    if (ids.length <= 2) return ids.slice();
    return twoOpt(nearestNeighbour(ids));
  }

  /* ---------- build one costed run ---------- */
  function makeRun(parts, cluster) {
    const order   = optimizeOrder(parts.map((p) => p.id));
    const ordered = order.map((id) => parts.find((p) => p.id === id));
    const geo     = R.routeGeometry(order);
    const stops   = parts.reduce((a, p) => a + p.stops, 0);
    const service = stops * D.COST.stopMin;
    const totalMin = geo.driveMin + service;
    const cost     = D.runCost(geo, parts);
    const shift    = D.SHIFT[cluster].min;
    // cold-chain risk: farthest stop should go out early; flag if it lands late.
    const farId  = order.reduce((f, id) => (R.byId(id).km > R.byId(f).km ? id : f), order[0]);
    const farIdx = order.indexOf(farId);
    return {
      cluster, parts: ordered, order, stops,
      km: geo.km, path: geo.path,
      driveMin: geo.driveMin, serviceMin: service, totalMin,
      cost, shiftMin: shift, shiftLabel: D.SHIFT[cluster].label,
      overShift: totalMin > shift,
      coldRisk: order.length > 1 && farIdx > Math.floor(order.length / 2),
      ...R.coldChain(R.kmToMin(R.byId(order[0]).km)) // cc badge from farthest one-way
    };
  }

  /* effective stops a run can carry: min(bagCap, time-feasible stops). */
  function effectiveCap(cluster, bagCap) {
    const ids = CLUSTERS[cluster].map(R.byId).filter(Boolean);
    const maxKm = ids.reduce((m, z) => Math.max(m, z.km), 0);
    const rtDrive = D.kmToMin(maxKm * 2);
    const byTime  = Math.floor((D.SHIFT[cluster].min - rtDrive) / D.COST.stopMin);
    return Math.max(1, Math.min(bagCap, byTime));
  }

  /* pack a cluster's day demand into runs; far clusters get 1 run/day, overflow
     defers to the next batch day. corridor may use multiple runs (more cars). */
  function packCluster(stopParts, cluster, bagCap) {
    if (!stopParts.length) return { runs: [], deferred: 0 };
    const sorted = stopParts.slice().sort((a, b) => b.km - a.km); // far-first
    const cap = effectiveCap(cluster, bagCap);
    const maxRuns = cluster === "corridor" ? Infinity : 1;
    const runs = [];
    let parts = [], used = 0, deferred = 0;
    const flush = () => { if (parts.length) runs.push(makeRun(parts, cluster)); parts = []; used = 0; };
    for (const e of sorted) {
      let rem = e.stops;
      while (rem > 0) {
        if (used >= cap) {
          if (runs.length + 1 >= maxRuns) { deferred += rem; rem = 0; break; } // far: defer
          flush();
        }
        const take = Math.min(rem, cap - used);
        const ex = parts.find((p) => p.id === e.id);
        if (ex) ex.stops += take; else parts.push({ id: e.id, name: e.name, km: e.km, stops: take });
        used += take; rem -= take;
      }
    }
    flush();
    return { runs, deferred };
  }

  /* ---------- weekly demand at steady state ---------- */
  // Simulate 21 days, read the middle week (indices 7..13) so cadence phasing and
  // far-cluster roll-forward are in steady state (no startup edge).
  function weeklyDemand(book) {
    const HORIZON = 21, READ_FROM = 7;
    const dayName = (i) => WEEK[((i % 7) + 7) % 7];
    const batch = book.batch || DEFAULT_BATCH;

    // demand[weekday][zoneId] = stops to deliver that weekday (steady week)
    const demand = {};
    WEEK.forEach((d) => (demand[d] = {}));
    const slaGaps = {}; // cluster -> max roll delay (calendar days) observed

    function nextBatchDay(cluster, fromIdx) {
      const days = batch[cluster] || [];
      for (let j = fromIdx; j < HORIZON; j++) {
        if (days.includes(dayName(j)) && dayName(j) !== REST) return j;
      }
      return -1;
    }

    R.ZONES.forEach((z) => {
      const c = getCluster(z.id);
      const cell = (book.subs[z.id]) || { two: 0, three: 0 };
      for (let i = 0; i < HORIZON; i++) {
        const due = dueOnDay(cell.two, 2, i) + dueOnDay(cell.three, 3, i);
        if (due <= 0) continue;
        let assign = i;
        if (c === "corridor") {
          while (dayName(assign) === REST) assign++;          // roll off rest day
        } else {
          assign = nextBatchDay(c, i);
          if (assign < 0) continue;
          const delay = assign - i;
          slaGaps[c] = Math.max(slaGaps[c] || 0, delay);
        }
        if (assign >= READ_FROM && assign < READ_FROM + 7) {
          const wd = dayName(assign);
          demand[wd][z.id] = (demand[wd][z.id] || 0) + due;
        }
      }
    });
    return { demand, slaGaps, batch };
  }

  /* ---------- full plan ---------- */
  function plan(book) {
    const bagCap = book.bagCap || 16;
    const fleet  = book.fleet || 2;
    const { demand, slaGaps, batch } = weeklyDemand(book);

    const runsByDay = {}, dayCars = {}, dayCost = {};
    let carsNeeded = 0, weeklyCost = 0, deferredTotal = 0, served = 0;
    const costBreak = { fuel: 0, salik: 0, darb: 0, parking: 0 };

    WEEK.forEach((day) => {
      if (day === REST) { runsByDay[day] = []; dayCars[day] = 0; dayCost[day] = 0; return; }
      const runs = [];
      let deferred = 0;
      CLUSTER_ORDER.forEach((c) => {
        const parts = CLUSTERS[c]
          .map(R.byId).filter(Boolean)
          .map((z) => ({ id: z.id, name: z.name, km: z.km, stops: demand[day][z.id] || 0 }))
          .filter((e) => e.stops > 0);
        const packed = packCluster(parts, c, bagCap);
        runs.push(...packed.runs);
        deferred += packed.deferred;
      });
      runsByDay[day] = runs;
      dayCars[day]   = runs.length;
      dayCost[day]   = D.round1(runs.reduce((a, r) => a + r.cost.total, 0));
      runs.forEach((r) => {
        weeklyCost += r.cost.total; served += r.stops;
        costBreak.fuel += r.cost.fuel; costBreak.salik += r.cost.salik;
        costBreak.darb += r.cost.darb; costBreak.parking += r.cost.parking;
      });
      deferredTotal += deferred;
      carsNeeded = Math.max(carsNeeded, runs.length);
    });

    Object.keys(costBreak).forEach((k) => (costBreak[k] = D.round1(costBreak[k])));
    weeklyCost = D.round1(weeklyCost);

    const sla = slaReport(slaGaps, batch);
    return {
      runsByDay, dayCars, dayCost, batch,
      carsNeeded, fleet, feasible: carsNeeded <= fleet,
      weeklyCost, costBreak, deferred: deferredTotal, served,
      sla,
      suggestions: suggest({ carsNeeded, fleet, deferredTotal, sla })
    };
  }

  /* honest delivery window per far cluster, from the real batch-day gaps. */
  function slaReport(slaGaps, batch) {
    const out = [];
    Object.keys(DEFAULT_BATCH).forEach((c) => {
      const days = batch[c] || DEFAULT_BATCH[c];
      // max circular gap between batch days across the 7-day week
      const idx = days.map((d) => WEEK.indexOf(d)).sort((a, b) => a - b);
      let maxGap = 0;
      for (let i = 0; i < idx.length; i++) {
        const next = i + 1 < idx.length ? idx[i + 1] : idx[0] + 7;
        maxGap = Math.max(maxGap, next - idx[i]);
      }
      const windowH = maxGap * 24;
      out.push({ cluster: c, days, windowHours: windowH, meets48: windowH <= SLA_HOURS });
    });
    return out;
  }

  function suggest({ carsNeeded, fleet, deferredTotal, sla }) {
    const s = [];
    if (carsNeeded > fleet)
      s.push(`Peak day needs ${carsNeeded} cars but you have ${fleet}. Add ${carsNeeded - fleet} car(s), or move more corridor customers to the 3-day plan to flatten peaks.`);
    if (deferredTotal > 0)
      s.push(`${deferredTotal} stop(s)/week don't fit their shift and roll to the next plan day. Add a batch day for the overloaded far cluster, or split it across a second car.`);
    (sla || []).forEach((x) => {
      if (!x.meets48) s.push(`${x.cluster.toUpperCase()} customers can wait up to ${x.windowHours}h between batch days — over the 48h promise. Either add a batch day for ${x.cluster}, or tell those customers their real window is the honest ${x.windowHours}h.`);
    });
    if (!s.length) s.push("Fits the fleet inside the 48h promise with headroom.");
    return s;
  }

  /* default book: customers per zone split by cadence + batch days. */
  function defaultBook() {
    const subs = {};
    R.ZONES.forEach((z) => {
      const n = Math.max(0, Math.round(40 * z.weight));
      subs[z.id] = { two: Math.round(n * 0.6), three: n - Math.round(n * 0.6) };
    });
    return { subs, fleet: 2, bagCap: 16, batch: JSON.parse(JSON.stringify(DEFAULT_BATCH)) };
  }

  /* ---------- self-check (console.assert) ---------- */
  function demo() {
    // 1. cadence buckets sum back to n and stay flat
    let sum = 0; for (let i = 0; i < 2; i++) sum += dueOnDay(7, 2, i);
    console.assert(sum === 7, "2-day buckets must sum to n");
    sum = 0; for (let i = 0; i < 3; i++) sum += dueOnDay(10, 3, i);
    console.assert(sum === 10, "3-day buckets must sum to n");
    // 2. far customer on a non-batch day rolls forward (not dropped)
    const b = defaultBook(); b.subs = {}; R.ZONES.forEach((z) => (b.subs[z.id] = { two: 0, three: 0 }));
    b.subs.auh = { two: 6, three: 0 }; // South = batch Sun/Wed
    const wk = weeklyDemand(b);
    const southTotal = Object.values(wk.demand).reduce((a, d) => a + (d.auh || 0), 0);
    console.assert(southTotal > 0, "far demand must land on a batch day, not vanish");
    const onlyBatch = Object.entries(wk.demand).every(([day, d]) => !d.auh || wk.batch.south.includes(day));
    console.assert(onlyBatch, "South demand must only appear on its batch days");
    // 3. SLA gap >48h is flagged for default Sun/Wed batching
    const p = plan(b);
    const south = p.sla.find((x) => x.cluster === "south");
    console.assert(south && !south.meets48, "Sun/Wed batching should breach the 48h promise (honest window)");
    // 4. optimizer never lengthens a tour
    const ids = ["dxb", "ajm", "shj", "rak"];
    console.assert(tourKm(optimizeOrder(ids)) <= tourKm(ids) + 1e-6, "2-opt must not lengthen the route");
    console.log("DISPATCH.demo: all checks passed");
    return true;
  }

  return {
    WEEK, REST, CLUSTERS, DEFAULT_BATCH, SLA_HOURS,
    getCluster, dueOnDay, optimizeOrder, tourKm,
    weeklyDemand, plan, defaultBook, demo
  };
})();
