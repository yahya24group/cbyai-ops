/* planner.js — cluster-isolation dispatch scheduler.
   Core idea: corridor (DXB/SHJ/AJM/UAQ) runs every active day.
   The three secondary clusters each run on exactly 2 fixed days/week,
   offset so no two secondaries ever share the same day.
   Any active day carries: corridor_runs + at most 1 secondary_run.
   Fleet needed = max daily run total across the week.

   Delivery cadence
   ─────────────────
   Corridor 2-day subs → every 2 active days = 3×/week
     Group A: Sat / Mon / Wed
     Group B: Sun / Tue / Thu
   Corridor 3-day subs → every 3 calendar days = 2×/week
     Delivers on: Sun / Wed  (3 cal-days apart; Wed→next Sun = 4 cal-days, avg 3.5)
   Secondary cluster subs → 2×/week on fixed route days (3 cal-days apart)
     RAK   : Sat / Tue
     South : Sun / Wed   (also aligns with corridor-3-day days)
     East  : Mon / Thu
*/
window.PLANNER = (function () {
  const R = window.ROUTES;
  const DAYS  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const ACTIVE = ["Sat","Sun","Mon","Tue","Wed","Thu"]; // Fri = rest/prep

  const CLUSTERS = {
    corridor: ["dxb","shj","ajm","uaq"],
    rak:      ["rak"],
    south:    ["auh","ain"],
    east:     ["fuj"]
  };
  const CLUSTER_ORDER = ["south","east","rak","corridor"]; // build runs far-first

  // Corridor 2-day subscribers — two alternating groups for even daily load
  const TWO_DAY_A        = ["Sat","Mon","Wed"];
  const TWO_DAY_B        = ["Sun","Tue","Thu"];
  // Corridor 3-day subscribers — Sun + Wed (exactly 3 calendar days apart)
  const CORRIDOR_3DAY    = ["Sun","Wed"];

  // Secondary cluster fixed run days — no two secondaries share a day
  const SECONDARY_DAYS = {
    rak:   ["Sat","Tue"],  // Sat→Tue = 3 cal-days ✓
    south: ["Sun","Wed"],  // Sun→Wed = 3 cal-days ✓  (shares with corridor-3-day)
    east:  ["Mon","Thu"]   // Mon→Thu = 3 cal-days ✓
  };

  function getCluster(zoneId) {
    for (const [k, ids] of Object.entries(CLUSTERS)) {
      if (ids.includes(zoneId)) return k;
    }
    return "corridor";
  }

  function splitZone(subs, pct2) {
    const two = Math.round((subs * pct2) / 100);
    return { two, three: subs - two };
  }

  /* Stops for one zone on a given active day.
     Corridor: cadence-based (2-day A/B split + 3-day on Sun/Wed).
     Secondary: all subs served on the cluster's 2 fixed days (2×/week). */
  function dayStops(zoneId, book, day) {
    const { two, three } = splitZone(book.subs[zoneId] || 0, book.pct2);
    const cluster = getCluster(zoneId);

    if (cluster === "corridor") {
      const twoA = Math.floor(two / 2);
      const twoB = two - twoA;
      return (TWO_DAY_A.includes(day)     ? twoA  : 0)
           + (TWO_DAY_B.includes(day)     ? twoB  : 0)
           + (CORRIDOR_3DAY.includes(day) ? three : 0);
    }
    // Secondary: deliver all subs on both cluster run days regardless of plan slider.
    return SECONDARY_DAYS[cluster].includes(day) ? (two + three) : 0;
  }

  function makeRun(stopParts, cluster) {
    const ordered = stopParts.map((p) => p.id);
    const geo     = R.routeGeometry(ordered);
    const totalStops  = stopParts.reduce((a, p) => a + p.stops, 0);
    const serviceMin  = totalStops * R.CONFIG.stopMin;
    const totalMin    = geo.driveMin + serviceMin;
    const fuel        = R.round1(geo.km * R.aedPerKm());
    const cc          = R.coldChain(R.kmToMin(R.byId(ordered[0]).km));
    return {
      cluster, zones: stopParts, totalStops,
      km: geo.km, path: geo.path,
      driveMin: geo.driveMin, serviceMin, totalMin, fuel,
      cc: cc.cc, ccCls: cc.ccCls,
      overWindow: totalMin > R.CONFIG.windowMin
    };
  }

  function smartPlan(book) {
    const cap = R.CONFIG.bagCap;
    const runsByDay = {};
    const dayTotal  = {};
    const grid      = {};
    R.ZONES.forEach((z) => (grid[z.id] = Object.fromEntries(ACTIVE.map((d) => [d, 0]))));

    let maxRuns = 0, peakLoad = 0;

    ACTIVE.forEach((day) => {
      const runs = [];

      CLUSTER_ORDER.forEach((ckey) => {
        const entries = CLUSTERS[ckey]
          .map(R.byId)
          .filter(Boolean)
          .map((z) => ({ id: z.id, name: z.name, km: z.km, stops: dayStops(z.id, book, day) }))
          .filter((e) => e.stops > 0)
          .sort((a, b) => b.km - a.km); // furthest first within cluster

        if (!entries.length) return;

        // Pack zone stops into runs of ≤ bagCap
        let parts = [], runTotal = 0;
        const flush = () => {
          if (parts.length) runs.push(makeRun([...parts], ckey));
          parts = []; runTotal = 0;
        };
        entries.forEach((e) => {
          let rem = e.stops;
          while (rem > 0) {
            if (runTotal >= cap) flush();
            const take = Math.min(rem, cap - runTotal);
            const ex = parts.find((p) => p.id === e.id);
            if (ex) ex.stops += take;
            else parts.push({ id: e.id, name: e.name, stops: take });
            runTotal += take;
            rem    -= take;
          }
        });
        flush();
      });

      runsByDay[day] = runs;
      dayTotal[day]  = runs.reduce((a, r) => a + r.totalStops, 0);
      runs.forEach((r) => r.zones.forEach((z) => (grid[z.id][day] += z.stops)));
      maxRuns   = Math.max(maxRuns, runs.length);
      peakLoad  = Math.max(peakLoad, dayTotal[day]);
    });

    return { runsByDay, dayTotal, grid, maxRuns, peakLoad, unserved: 0, unservedSlots: 0, days: ACTIVE };
  }

  function summary(book) {
    let two = 0, three = 0;
    let corridorTwo = 0, corridorThree = 0, secondaryTotal = 0;
    R.ZONES.forEach((z) => {
      const s = splitZone(book.subs[z.id] || 0, book.pct2);
      two += s.two; three += s.three;
      if (getCluster(z.id) === "corridor") {
        corridorTwo   += s.two;
        corridorThree += s.three;
      } else {
        secondaryTotal += s.two + s.three;
      }
    });
    const totalSubs = two + three;
    const fleet     = book.fleet || 2;
    const sched     = smartPlan(book);

    // Corridor 2-day = 3×/wk, corridor 3-day = 2×/wk, secondary = always 2×/wk
    const weeklyDeliveries  = corridorTwo * 3 + corridorThree * 2 + secondaryTotal * 2;
    const monthlyDeliveries = Math.round(weeklyDeliveries * 4.33);
    const carsNeeded        = sched.maxRuns;
    const feasible          = carsNeeded <= fleet;
    const monthlyCost       = Math.max(carsNeeded, fleet) * R.CONFIG.costPerCarMonth;
    const costPerDelivery   = monthlyDeliveries > 0
      ? R.round1((fleet * R.CONFIG.costPerCarMonth) / monthlyDeliveries)
      : null;

    // maxSubs: bagCap constraint on peak corridor day.
    // On peak days (Sun/Wed), corridor needs (1 - pct2/200) fraction of corridor subs.
    // Fleet reserves 1 car per day for the secondary cluster run.
    const corridorCars  = Math.max(1, fleet - 1);
    const peakFactor    = Math.max(0.01, 1 - book.pct2 / 200);
    const maxCorrSubs   = Math.floor(corridorCars * R.CONFIG.bagCap / peakFactor);
    const corrFrac      = totalSubs > 0 ? (corridorTwo + corridorThree) / totalSubs : 0.77;
    const maxSubs       = carsNeeded > fleet
      ? Math.floor(totalSubs * fleet / carsNeeded)           // over-cap: scale down
      : corrFrac > 0 ? Math.floor(maxCorrSubs / corrFrac) : 0; // under-cap: bagCap limit

    return {
      totalSubs, two, three,
      corridorTwo, corridorThree, secondaryTotal,
      weeklyDeliveries, monthlyDeliveries,
      carsNeeded, feasible, fleet,
      monthlyCost, costPerDelivery,
      maxSubs, sched
    };
  }

  function defaultBook() {
    const total = 25; // fits cleanly in fleet=2 with a few subs of headroom
    const subs  = {};
    R.ZONES.forEach((z) => (subs[z.id] = Math.round(total * z.weight)));
    return { subs, pct2: 60, fleet: 2 };
  }

  return {
    DAYS, ACTIVE, CLUSTERS, SECONDARY_DAYS,
    TWO_DAY_A, TWO_DAY_B, CORRIDOR_3DAY,
    getCluster, splitZone, smartPlan, summary, defaultBook
  };
})();
