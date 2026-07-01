/* routes-data.js — distance engine: zones, inter-zone matrix, editable config,
   and low-level route/fuel/time math. Pure, no DOM. HQ = Umm Al Quwain. */
window.ROUTES = (function () {
  const HQ = { id: "uaq", name: "Umm Al Quwain", label: "HQ Depot" };

  /* Editable operating assumptions (UI can override via setConfig). */
  const CONFIG = {
    pricePerL: 2.7,        // AED per litre
    kmPerL: 12,            // sedan fuel economy
    windowMin: 300,        // delivery window per car per evening
    stopMin: 5,            // minutes per stop
    bagCap: 16,            // bags per run — car cold-chain cap (16–18 typical)
    avgKmh: 55,            // average road speed incl. city
    costPerCarMonth: 5000  // AED: driver + fuel + maintenance + insurance
  };
  const aedPerKm = () => CONFIG.pricePerL / CONFIG.kmPerL;
  const kmToMin = (km) => Math.round(km / (CONFIG.avgKmh / 60));

  /* 8 zones: one-way km + demand share. */
  const ZONES = [
    { id: "uaq", name: "Umm Al Quwain", km: 5,   weight: 0.05, dir: "north" },
    { id: "ajm", name: "Ajman",          km: 25,  weight: 0.12, dir: "north" },
    { id: "rak", name: "Ras Al Khaimah", km: 50,  weight: 0.06, dir: "north" },
    { id: "shj", name: "Sharjah",        km: 48,  weight: 0.20, dir: "metro" },
    { id: "dxb", name: "Dubai",          km: 70,  weight: 0.40, dir: "metro" },
    { id: "auh", name: "Abu Dhabi",      km: 155, weight: 0.12, dir: "south" },
    { id: "ain", name: "Al Ain",         km: 165, weight: 0.02, dir: "south" },
    { id: "fuj", name: "Fujairah",       km: 110, weight: 0.03, dir: "east"  }
  ];
  const byId = (id) => ZONES.find((z) => z.id === id) || (id === "uaq" ? ZONES[0] : null);

  /* Inter-zone road distances (km, approx). Symmetric; fallback = |Δ from HQ|. */
  const M = {
    "uaq-ajm": 22, "uaq-shj": 45, "uaq-rak": 45, "uaq-dxb": 65, "uaq-fuj": 105, "uaq-auh": 150, "uaq-ain": 160,
    "ajm-shj": 12, "ajm-rak": 62, "ajm-dxb": 35, "ajm-fuj": 115, "ajm-auh": 135, "ajm-ain": 145,
    "shj-rak": 75, "shj-dxb": 25, "shj-fuj": 90, "shj-auh": 160, "shj-ain": 130,
    "rak-dxb": 100, "rak-fuj": 110, "rak-auh": 250, "rak-ain": 250,
    "dxb-fuj": 130, "dxb-auh": 140, "dxb-ain": 125,
    "fuj-auh": 260, "fuj-ain": 230,
    "auh-ain": 160
  };
  function legKm(a, b) {
    if (a === b) return 0;
    return M[`${a}-${b}`] ?? M[`${b}-${a}`] ?? Math.abs(byId(a).km - byId(b).km);
  }

  function coldChain(oneWayMin) {
    if (oneWayMin <= 45) return { cc: "Green", ccCls: "b-green" };
    if (oneWayMin <= 90) return { cc: "Amber", ccCls: "b-amber" };
    return { cc: "Red", ccCls: "b-red" };
  }

  /* Per-zone reference (single dedicated round-trip). */
  function calcZone(z) {
    const oneWay = kmToMin(z.km);
    const rtKm = z.km * 2;
    const rtMin = oneWay * 2;
    const maxByTime = Math.floor((CONFIG.windowMin - rtMin) / CONFIG.stopMin);
    const effective = Math.max(0, Math.min(maxByTime, CONFIG.bagCap));
    const fuelRoute = round1(rtKm * aedPerKm());
    const fuelPerDelivery = effective > 0 ? round1(fuelRoute / effective) : null;
    return { ...z, oneWay, rtKm, rtMin, maxByTime, effective, fuelRoute, fuelPerDelivery, ...coldChain(oneWay) };
  }
  const computedZones = () => ZONES.map(calcZone);
  const round1 = (n) => Math.round(n * 10) / 10;

  /* Build one run's geometry from an ordered list of zone ids (furthest-first). */
  function routeGeometry(orderedIds) {
    if (!orderedIds.length) return { km: 0, driveMin: 0, path: "HQ → HQ" };
    let km = byId(orderedIds[0]).km; // HQ → first
    for (let i = 1; i < orderedIds.length; i++) km += legKm(orderedIds[i - 1], orderedIds[i]);
    km += byId(orderedIds[orderedIds.length - 1]).km; // last → HQ
    const path = "HQ → " + orderedIds.map((id) => byId(id).name).join(" → ") + " → HQ";
    return { km: Math.round(km), driveMin: kmToMin(km), path };
  }

  function setConfig(key, value) { if (key in CONFIG) CONFIG[key] = Number(value); }
  const DEFAULTS = { ...CONFIG };
  function resetConfig() { Object.assign(CONFIG, DEFAULTS); }

  return {
    HQ, ZONES, CONFIG, DEFAULTS,
    byId, legKm, aedPerKm, kmToMin, coldChain,
    calcZone, computedZones, routeGeometry, round1,
    setConfig, resetConfig
  };
})();
