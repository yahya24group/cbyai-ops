/* dispatch-data.js — real-world cost & timing model for C BY AI Smart Dispatch.
   Grounded in the 23 Jun 2026 Full Route Test (not the optimistic defaults).
   Reuses ROUTES for zones + inter-zone geometry; adds tolls, parking, real fuel,
   and per-cluster realistic shift windows. Pure, no DOM. */
window.DISPATCH_DATA = (function () {
  const R = window.ROUTES;

  /* Real operating assumptions — measured on the route test, all UI-editable.
     Current RouteDesk page assumed 2.7 AED/L @ 12 km/L (AED/km 0.225);
     the test burned 13.3 L/100km @ 3.83 AED/L → AED/km ≈ 0.51 (2.3× higher). */
  const COST = {
    pricePerL: 3.83,     // AED/L — actual refuel price on test day
    kmPerL: 7.5,         // 13.3 L/100km measured (loaded delivery van, AC, city)
    salikPerGate: 4,     // AED — Dubai toll per gate pass
    darbPerGate: 4,      // AED — Abu Dhabi toll per gate pass
    parkingPerStop: 5,   // AED — paid-parking allowance in dense zones
    stopMin: 6,          // min/stop incl. parking + handover (test averaged ~6)
    avgKmh: 50           // loaded van, mixed roads (test effective ~48)
  };

  /* Which zones force which tolls / parking. Salik on Dubai, Darb on Abu Dhabi.
     Parking allowance in dense urban zones surfaced by the test (Ajman + metro). */
  const TOLL_ZONES    = { dxb: "salik", auh: "darb" };
  const PARKING_ZONES = new Set(["ajm", "shj", "dxb"]);
  const GATES_PER_RUN = 2; // in + out — one round trip through the toll cordon

  /* Per-cluster realistic shift windows (minutes). The test proved a far East
     batch ran ~565 min end-to-end — it can never be a 5h evening slot. Corridor
     stays an evening slot; far clusters are a full daytime shift. */
  const SHIFT = {
    corridor: { min: 300, label: "Evening slot (4–9pm)" },
    rak:      { min: 420, label: "Half-day shift" },
    south:    { min: 600, label: "Full-day shift" },
    east:     { min: 600, label: "Full-day shift" }
  };

  const aedPerKm = () => COST.pricePerL / COST.kmPerL;
  const kmToMin  = (km) => Math.round(km / (COST.avgKmh / 60));
  const round1   = (n) => Math.round(n * 10) / 10;

  /* Toll cost for a run, from the set of zone ids it visits. */
  function tollCost(zoneIds) {
    let salik = 0, darb = 0;
    const ids = new Set(zoneIds);
    if (ids.has("dxb")) salik = COST.salikPerGate * GATES_PER_RUN;
    if (ids.has("auh")) darb  = COST.darbPerGate  * GATES_PER_RUN;
    return { salik, darb, total: salik + darb };
  }

  /* Parking allowance for a run = parkingPerStop × stops landing in dense zones. */
  function parkingCost(stopParts) {
    const stops = stopParts.reduce(
      (a, p) => a + (PARKING_ZONES.has(p.id) ? p.stops : 0), 0);
    return round1(stops * COST.parkingPerStop);
  }

  /* Full real cost for one optimized run. geom = ROUTES.routeGeometry output. */
  function runCost(geom, stopParts) {
    const fuel    = round1(geom.km * aedPerKm());
    const toll    = tollCost(stopParts.map((p) => p.id));
    const parking = parkingCost(stopParts);
    return {
      fuel,
      salik: toll.salik,
      darb: toll.darb,
      parking,
      total: round1(fuel + toll.total + parking)
    };
  }

  const COST_FIELDS = ["pricePerL", "kmPerL", "salikPerGate", "darbPerGate",
                       "parkingPerStop", "stopMin", "avgKmh"];
  const DEFAULTS = { ...COST };
  function setCost(key, value) { if (key in COST) COST[key] = Number(value); }
  function resetCost() { Object.assign(COST, DEFAULTS); }

  return {
    COST, DEFAULTS, COST_FIELDS, SHIFT,
    TOLL_ZONES, PARKING_ZONES,
    aedPerKm, kmToMin, round1,
    tollCost, parkingCost, runCost,
    setCost, resetCost
  };
})();
