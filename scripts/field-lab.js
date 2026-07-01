/* field-lab.js — point-aware routing + driver-timing + Google Maps deep links
   for the Field Test bench. Pure, no DOM. Straight-line haversine × a road
   winding factor (calibrated to the 23 Jun route test's ~48 km/h effective).
   Node self-check at the bottom (run: `node scripts/field-lab.js`). */
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;

  // Straight-line → road km is not one factor: short city hops detour hard
  // (grid, U-turns), long inter-city legs run near-straight highway. Piecewise
  // matches the route test far better than a single multiplier — it's the fix
  // that stops far Abu Dhabi legs from looking like 1-stop-per-shift deadheads.
  const CITY_LEG_KM = 40;   // ≤ this = city driving
  const CITY_WIND = 1.40;   // dense-grid detour factor
  const HWY_WIND  = 1.18;   // highway factor for long legs

  const DEFAULTS = {
    windingFactor: 1.0,  // global extra multiplier on top of piecewise (user knob)
    avgKmh: 48,          // loaded van, mixed roads (route-test effective)
    stopMin: 6,          // service per stop (parking + handover)
    leaveMin: 16 * 60,   // depart HQ at 16:00 (evening delivery window)
    bagCap: 16,          // cold-chain stops per van-trip
  };

  const R_EARTH = 6371; // km
  const rad = (d) => (d * Math.PI) / 180;

  /* Great-circle km between two {lat,lng}. */
  function haversineKm(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(s));
  }
  function roadKm(a, b, wf) {
    const d = haversineKm(a, b);
    const base = d <= CITY_LEG_KM ? CITY_WIND : HWY_WIND;
    return d * base * (wf ?? DEFAULTS.windingFactor);
  }

  /* Total tour km for an ordered point list, HQ → … → HQ. */
  function tourKm(hq, ordered, wf) {
    if (!ordered.length) return 0;
    let km = roadKm(hq, ordered[0], wf);
    for (let i = 1; i < ordered.length; i++) km += roadKm(ordered[i - 1], ordered[i], wf);
    return km + roadKm(ordered[ordered.length - 1], hq, wf);
  }

  /* Nearest-neighbour seed from HQ, then 2-opt — same shape as the zone
     optimizer in dispatch-planner.js, but on real point geometry. */
  function nearestNeighbour(hq, pts, wf) {
    const rest = pts.slice();
    const route = [];
    let cur = hq;
    while (rest.length) {
      let bestI = 0, bestD = Infinity;
      rest.forEach((p, i) => {
        const d = roadKm(cur, p, wf);
        if (d < bestD) { bestD = d; bestI = i; }
      });
      cur = rest.splice(bestI, 1)[0];
      route.push(cur);
    }
    return route;
  }
  function twoOpt(hq, route, wf) {
    if (route.length < 4) return route;
    let best = route.slice(), improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          const cand = best.slice(0, i)
            .concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
          if (tourKm(hq, cand, wf) + 1e-9 < tourKm(hq, best, wf)) {
            best = cand; improved = true;
          }
        }
      }
    }
    return best;
  }
  function optimizeRoute(hq, pts, wf) {
    if (pts.length <= 2) return pts.slice();
    return twoOpt(hq, nearestNeighbour(hq, pts, wf), wf);
  }

  const hhmm = (min) => {
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };

  /* Full driver timeline for an ordered route. Returns per-leg + totals.
     opts: {windingFactor, avgKmh, stopMin, leaveMin, aedPerKm, shiftMin}. */
  function routeStats(hq, ordered, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const kmPerMin = o.avgKmh / 60;
    const legs = [];
    let cursor = o.leaveMin, totalKm = 0, totalDrive = 0, totalService = 0;
    let prev = hq;

    ordered.forEach((p, idx) => {
      const km = roadKm(prev, p, o.windingFactor);
      const driveMin = km / kmPerMin;
      const arrive = cursor + driveMin;
      const depart = arrive + o.stopMin;
      legs.push({
        seq: idx + 1, point: p, legKm: Math.round(km * 10) / 10,
        driveMin: Math.round(driveMin), arriveMin: arrive, departMin: depart,
        arrive: hhmm(arrive), depart: hhmm(depart),
      });
      totalKm += km; totalDrive += driveMin; totalService += o.stopMin;
      cursor = depart; prev = p;
    });

    // return leg to HQ
    const backKm = roadKm(prev, hq, o.windingFactor);
    const backDrive = backKm / kmPerMin;
    totalKm += backKm; totalDrive += backDrive;
    const finishMin = cursor + backDrive;
    const totalMin = totalDrive + totalService;

    return {
      legs,
      returnLeg: { legKm: Math.round(backKm * 10) / 10, driveMin: Math.round(backDrive) },
      totalKm: Math.round(totalKm),
      driveMin: Math.round(totalDrive),
      serviceMin: Math.round(totalService),
      totalMin: Math.round(totalMin),
      leave: hhmm(o.leaveMin),
      finish: hhmm(finishMin),
      finishMin,
      fuelAed: o.aedPerKm ? Math.round(totalKm * o.aedPerKm * 10) / 10 : null,
      overShift: o.shiftMin ? totalMin > o.shiftMin : false,
    };
  }

  /* Split a city's stops into the fewest van-trips that each fit the shift
     window and bag cap. Order globally first (2-opt), then cut the sequence
     into contiguous shift-bounded trips — same greedy shape as the zone
     packer in dispatch-planner.js, but time-checked against a real timeline.
     Each trip is its own HQ round-trip. Returns trips + how many drivers it
     takes to clear the city in one window vs. one driver doing them back-to-back. */
  function splitIntoRuns(hq, pts, opts = {}) {
    const o = { shiftMin: 300, ...DEFAULTS, ...opts };
    let remaining = pts.slice();
    const buckets = [];
    let guard = 0;
    while (remaining.length && guard++ < 200) {
      // nearest-first from HQ, then take the longest prefix that fits shift + cap.
      const order = nearestNeighbour(hq, remaining, o.windingFactor);
      let take = [];
      for (const p of order) {
        const trial = [...take, p];
        if (trial.length > o.bagCap) break;
        if (take.length && routeStats(hq, trial, o).totalMin > o.shiftMin) break;
        take = trial;
      }
      if (!take.length) take = [order[0]]; // always progress, even if one far stop alone overflows
      const ids = new Set(take.map((p) => p.id));
      buckets.push(optimizeRoute(hq, take, o.windingFactor)); // re-optimize the chosen cluster
      remaining = remaining.filter((p) => !ids.has(p.id));
    }

    // per-trip stats: parallel view (every driver leaves at leaveMin).
    const trips = buckets.map((arr, i) => ({
      idx: i + 1,
      ordered: arr,
      stats: routeStats(hq, arr, o),
      links: gmapsRouteChunks(hq, arr),
    }));
    // one driver, trips back-to-back from the same leave time.
    let cursor = o.leaveMin, seqKm = 0;
    trips.forEach((t) => { cursor += t.stats.totalMin; seqKm += t.stats.totalKm; });
    return {
      trips,
      driversParallel: trips.length,             // clear the city in one window
      soloFinishMin: cursor, soloFinish: hhmm(cursor), // one driver, sequential
      soloOverDay: cursor - o.leaveMin > 12 * 60,
      totalKm: seqKm,
    };
  }

  /* ---------- Google Maps deep links ---------- */
  const q = (p) => `${p.lat},${p.lng}`;

  // Single-pin link for one stop.
  function gmapsPin(p) {
    return `https://www.google.com/maps/search/?api=1&query=${q(p)}`;
  }

  // Continuous driving route split into segments that respect Google's
  // 9-waypoint cap, so each link actually opens instead of silently dropping
  // stops. Segments chain end→start so the driver flows HQ → … → HQ.
  // ponytail: 9-waypoint cap → chunked; collapse to one link if Google lifts it.
  function gmapsRouteChunks(hq, ordered, maxWaypoints = 9) {
    const nodes = [hq, ...ordered, hq];
    const maxPerSeg = maxWaypoints + 2; // origin + waypoints + destination
    const step = maxPerSeg - 1;         // overlap: next origin = prev destination
    const links = [];
    for (let i = 0; i < nodes.length - 1; i += step) {
      const seg = nodes.slice(i, i + maxPerSeg);
      if (seg.length < 2) break;
      const origin = seg[0], dest = seg[seg.length - 1];
      const way = seg.slice(1, -1).map(q).join("|");
      let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving` +
        `&origin=${q(origin)}&destination=${q(dest)}`;
      if (way) url += `&waypoints=${encodeURIComponent(way)}`;
      links.push({ from: origin.area || origin.name, to: dest.area || dest.name, stops: seg.length - 2, url });
    }
    return links;
  }

  root.FIELDLAB = {
    DEFAULTS, haversineKm, roadKm, tourKm,
    optimizeRoute, routeStats, splitIntoRuns, hhmm,
    gmapsPin, gmapsRouteChunks,
  };

  /* ---------- node self-check ---------- */
  if (typeof window === "undefined" && typeof require !== "undefined" && require.main === module) {
    const FP = require("./field-points.js") || root.FIELD_POINTS;
    const { HQ, byCity } = root.FIELD_POINTS;
    const assert = require("assert");

    // haversine sanity: HQ(UAQ) → Dubai Marina ~68 km straight line (~92 km road).
    const marina = byCity("Dubai").find((p) => p.area === "Marina");
    const d = haversineKm(HQ, marina);
    assert(d > 60 && d < 100, `HQ→Marina haversine off: ${d.toFixed(1)}km`);

    // all 32 points inside the UAE bbox.
    root.FIELD_POINTS.POINTS.forEach((p) => {
      assert(p.lat > 22.5 && p.lat < 26.5 && p.lng > 51 && p.lng < 57,
        `point ${p.id} outside UAE bbox`);
    });

    // optimizer never worse than input order.
    ["Dubai", "Abu Dhabi"].forEach((city) => {
      const pts = byCity(city);
      const naive = tourKm(HQ, pts);
      const opt = tourKm(HQ, optimizeRoute(HQ, pts));
      assert(opt <= naive + 1e-6, `${city}: optimized ${opt} > naive ${naive}`);
      console.log(`${city.padEnd(10)} naive ${naive.toFixed(0)}km → optimized ${opt.toFixed(0)}km`);
    });

    // gmaps links well-formed + chunked under the cap.
    const links = gmapsRouteChunks(HQ, byCity("Dubai"));
    assert(links.length >= 2, "16 stops should chunk into ≥2 links");
    links.forEach((l) => {
      assert(l.url.startsWith("https://www.google.com/maps/dir/?api=1"), "bad dir url");
      const wp = (decodeURIComponent(l.url).match(/waypoints=([^&]*)/) || [,""])[1];
      const n = wp ? wp.split("|").length : 0;
      assert(n <= 9, `segment has ${n} waypoints (>9)`);
    });
    const pin = gmapsPin(marina);
    assert(pin.includes(`${marina.lat},${marina.lng}`), "pin missing coords");

    console.log(`gmaps: ${links.length} Dubai route segments, all ≤9 waypoints`);

    // split-into-runs: every trip must fit its shift + cap, and cover all stops.
    [["Dubai", 300], ["Abu Dhabi", 600]].forEach(([city, shiftMin]) => {
      const pts = byCity(city);
      const r = splitIntoRuns(HQ, pts, { shiftMin, bagCap: 16 });
      const covered = r.trips.reduce((a, t) => a + t.stats.legs.length, 0);
      assert(covered === pts.length, `${city}: split covered ${covered}/${pts.length}`);
      r.trips.forEach((t) => {
        assert(t.stats.totalMin <= shiftMin, `${city} trip ${t.idx} over shift: ${t.stats.totalMin}>${shiftMin}`);
        assert(t.stats.legs.length <= 16, `${city} trip ${t.idx} over cap`);
      });
      console.log(`${city.padEnd(10)} → ${r.trips.length} trip(s) fit ${shiftMin}m; 1 driver solo finishes ${r.soloFinish}`);
    });

    console.log("field-lab self-check: ALL GOOD");
  }

  if (typeof module !== "undefined") module.exports = root.FIELDLAB;
})();
