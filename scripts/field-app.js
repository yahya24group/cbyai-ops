/* field-app.js — UI for the Field Test bench. 32 test points → per-city
   optimized route, driver timeline, and clickable Google Maps links.
   DOM only; all routing/timing lives in FIELDLAB (pure). */
(function () {
  const FP = window.FIELD_POINTS;
  const FL = window.FIELDLAB;
  const DD = window.DISPATCH_DATA; // real fuel/shift model (optional)
  const $ = (s) => document.querySelector(s);
  const KEY = "cbyai.field.v1";

  // Dubai = evening slot, Abu Dhabi = full-day shift (per the route test).
  const CITY_SHIFT = { Dubai: (DD && DD.SHIFT.corridor.min) || 300,
                       "Abu Dhabi": (DD && DD.SHIFT.south.min) || 600 };
  const aedPerKm = () => (DD ? DD.aedPerKm() : 0.51);

  const UI_DEF = { useSouthDepot: false }; // UI-only state, not part of the lab model
  const DEF = { ...FL.DEFAULTS, ...UI_DEF };
  let opts = { ...DEF };

  /* ---------- persistence ---------- */
  function save() { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch (e) {} }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s && typeof s === "object") opts = { ...DEF, ...s };
    } catch (e) {}
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const timeToMin = (v) => { const [h, m] = String(v).split(":").map(Number); return (h || 0) * 60 + (m || 0); };

  /* ---------- i18n (lang from <html lang>) ---------- */
  const AR = (document.documentElement.lang || "en").toLowerCase().startsWith("ar");
  const tt = (en, ar) => (AR ? ar : en);      // pick a string
  const CITY_AR = { "Dubai": "دبي", "Abu Dhabi": "أبوظبي" };
  const DIET_AR = {
    "high-protein": "عالي البروتين", "balanced": "متوازن", "low-carb": "قليل الكربوهيدرات",
    "vegan": "نباتي صرف", "keto": "كيتو", "vegetarian": "نباتي", "low-calorie": "قليل السعرات",
  };
  const cityName = (c) => (AR && CITY_AR[c]) ? CITY_AR[c] : c;
  const dietName = (d) => (AR && DIET_AR[d]) ? DIET_AR[d] : d;
  const originName = (o) => AR
    ? (o.id === "depot-s" ? "مستودع الجنوب — مصفح" : "المقر — أم القيوين")
    : o.name;

  /* ---------- one city → ONE optimized trip covering all stops ----------
     Both vans leave HQ together at opts.leaveMin; each city is a single run,
     every point in one go. Abu Dhabi may dispatch from the southern depot. */
  function originFor(city) {
    return city === "Abu Dhabi" && opts.useSouthDepot ? FP.SOUTH_DEPOT : FP.HQ;
  }
  function oneRun(origin, pts, shiftMin) {
    const base = { ...opts, aedPerKm: aedPerKm(), shiftMin };
    const ordered = FL.optimizeRoute(origin, pts, opts.windingFactor);
    const stats = FL.routeStats(origin, ordered, base);
    return { idx: 1, ordered, stats, links: FL.gmapsRouteChunks(origin, ordered) };
  }
  function planCity(city) {
    const pts = FP.byCity(city);
    const shiftMin = CITY_SHIFT[city];
    const origin = originFor(city);
    const run = oneRun(origin, pts, shiftMin);
    // Abu Dhabi: always compute the HQ baseline run to show the depot's saving.
    let hqAlt = null;
    if (city === "Abu Dhabi") {
      const hs = oneRun(FP.HQ, pts, shiftMin).stats;
      hqAlt = { finish: hs.finish, totalKm: hs.totalKm, fuelAed: hs.fuelAed };
    }
    return { city, shiftMin, origin, run, hqAlt, fuelAed: run.stats.fuelAed };
  }

  /* ---------- render ---------- */
  const stat = (v, l, cls = "") => `<div class="s ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;

  function tripBlock(trip, shiftMin) {
    const { stats, links } = trip;
    const fits = stats.totalMin <= shiftMin;
    const km = tt("km", "كم");
    const segBtns = links.map((l, i) =>
      `<a class="seg-btn" href="${l.url}" target="_blank" rel="noopener">
         🗺 ${links.length > 1 ? tt("Seg ", "مقطع ") + (i + 1) : tt("Open route", "افتح المسار")} <small>${l.stops} ${tt("stops", "نقطة")}</small>
       </a>`).join("");

    const rows = stats.legs.map((leg) => {
      const p = leg.point;
      return `<li class="stop-row">
        <span class="seq">${leg.seq}</span>
        <div class="who">
          <div class="nm">${esc(p.name)}</div>
          <div class="meta">
            <span class="chip">${esc(p.area)}</span>
            <span class="chip">${tt(`${p.cadence}-day`, `كل ${p.cadence} أيام`)}</span>
            <span class="chip">${esc(dietName(p.diet))}</span>
            <span class="chip">${leg.legKm} ${km}</span>
          </div>
        </div>
        <div class="eta"><div class="t">${leg.arrive}</div><div class="d">${tt(`+${leg.driveMin}m drive`, `+${leg.driveMin}د قيادة`)}</div></div>
        <a class="pin" href="${FL.gmapsPin(p)}" target="_blank" rel="noopener" title="${tt("Open", "افتح")} ${esc(p.area)}">📍</a>
      </li>`;
    }).join("");

    const overMin = stats.totalMin - shiftMin;
    return `<div class="trip">
      <div class="trip-head">
        <span class="trip-no">${tt("Full run", "الجولة الكاملة")}</span>
        <span class="trip-sum">${stats.legs.length} ${tt("stops", "نقطة")} · ${stats.totalKm} ${km} · ${tt("leave", "انطلاق")} ${stats.leave} → ${tt("back", "عودة")} ${stats.finish}
          <b class="${fits ? "ok" : "bad"}">${fits ? tt("within shift", "ضمن الوردية") : "+" + overMin + tt("m past shift", "د بعد الوردية")}</b></span>
      </div>
      <div class="route-links">${segBtns}</div>
      <ul class="stop-list">${rows}</ul>
    </div>`;
  }

  function cityCard(plan) {
    const { city, shiftMin, run, fuelAed, origin, hqAlt } = plan;
    const s = run.stats;
    const fits = !s.overShift;
    const hrs = Math.round(shiftMin / 60);
    const badge = fits
      ? `<span class="badge">${tt("back", "عودة")} ${s.finish} · ${tt("within shift", "ضمن الوردية")}</span>`
      : `<span class="badge over">${tt("back", "عودة")} ${s.finish} · ${tt("past shift", "بعد الوردية")}</span>`;
    const fromDepot = origin.id === "depot-s";

    // Depot saving line (Abu Dhabi only): compare single-run finish vs HQ.
    let depotLine = "";
    if (hqAlt) {
      if (fromDepot) {
        const savedFuel = Math.round((hqAlt.fuelAed - fuelAed) * 10) / 10;
        const dKm = hqAlt.totalKm - s.totalKm;
        depotLine = `<p class="note depot-win" style="margin:.2rem 0 1rem">🏭 ${tt(
          `<b>South depot on:</b> back <b>${s.finish}</b> vs <b>${hqAlt.finish}</b> from HQ — ${dKm} km${savedFuel > 0 ? ` and AED ${savedFuel} fuel` : ""} saved. Deadhead gone: van starts in the AD belt, not 175 km north.`,
          `<b>مستودع الجنوب مُفعّل:</b> العودة <b>${s.finish}</b> مقابل <b>${hqAlt.finish}</b> من المقر — توفير ${dKm} كم${savedFuel > 0 ? ` و${savedFuel} درهم وقود` : ""}. لا مسافة فارغة: الشاحنة تنطلق من حزام أبوظبي، لا من ١٧٥ كم شمالاً.`)}</p>`;
      } else {
        depotLine = `<p class="note" style="margin:.2rem 0 1rem">💡 ${tt(
          `Abu Dhabi's one run finishes <b>${s.finish}</b> from the UAQ HQ. Flip the <b>southern depot</b> above — from Mussafah the same 16 stops finish far earlier.`,
          `جولة أبوظبي الواحدة تنتهي <b>${s.finish}</b> من مقر أم القيوين. فعّل <b>مستودع الجنوب</b> أعلاه — من مصفح تنتهي نفس الـ١٦ نقطة أبكر بكثير.`)}</p>`;
      }
    }

    const windowNote = fits
      ? tt(`Inside the ${hrs}h ${city} window.`, `ضمن نافذة ${cityName(city)} البالغة ${hrs} ساعات.`)
      : `<span style="color:var(--red)">${tt(
          `${s.totalMin - shiftMin}m past the ${hrs}h window — needs a late/overnight run or a depot.`,
          `${s.totalMin - shiftMin}د بعد نافذة الـ${hrs} ساعات — يلزم جولة ليلية متأخرة أو مستودع.`)}</span>`;

    return `<div class="card">
      <div class="city-head"><h2>${esc(cityName(city))}</h2>${badge}</div>
      <div class="origin-tag">🚚 ${tt("leaves", "ينطلق من")} ${esc(originName(origin))} ${tt("at", "الساعة")} ${s.leave}</div>
      <div class="city-stats">
        ${stat(s.totalKm + " " + tt("km", "كم"), tt("route", "المسار"), "amber")}
        ${stat("16", tt("stops", "نقطة"))}
        ${stat(s.finish, tt("back at base", "العودة للقاعدة"), fits ? "" : "red")}
        ${stat("AED " + fuelAed, tt("fuel", "الوقود"))}
      </div>
      <p class="note" style="margin:0 0 .2rem">${tt(
        `One trip, all 16 stops: leave <b>${s.leave}</b> → drive ${s.driveMin}m + ${s.serviceMin}m service → back <b>${s.finish}</b> (${s.totalMin}m total).`,
        `جولة واحدة، كل الـ١٦ نقطة: انطلاق <b>${s.leave}</b> ← قيادة ${s.driveMin}د + خدمة ${s.serviceMin}د ← عودة <b>${s.finish}</b> (${s.totalMin}د إجمالاً).`)} ${windowNote}</p>
      ${depotLine}
      ${tripBlock(run, shiftMin)}
    </div>`;
  }

  function kpiRow(dxb, auh) {
    const km = dxb.run.stats.totalKm + auh.run.stats.totalKm;
    const fuel = Math.round((dxb.fuelAed + auh.fuelAed) * 10) / 10;
    const bothFits = !dxb.run.stats.overShift && !auh.run.stats.overShift;
    const kpi = (v, l, s, cls) =>
      `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div><div class="s">${s}</div></div>`;
    return [
      kpi("32", tt("customers, 1 day", "عميل، يوم واحد"), tt("16 Dubai · 16 Abu Dhabi", "١٦ دبي · ١٦ أبوظبي"), "amber"),
      kpi(km + " " + tt("km", "كم"), tt("combined route", "إجمالي المسار"), `${dxb.run.stats.totalKm} + ${auh.run.stats.totalKm}`, "blue"),
      kpi(dxb.run.stats.finish + " / " + auh.run.stats.finish, tt("DXB / AUH back", "عودة دبي / أبوظبي"), tt(`both leave ${dxb.run.stats.leave} together`, `ينطلقان معاً ${dxb.run.stats.leave}`), bothFits ? "green" : "red"),
      kpi("AED " + fuel, tt("fuel both vans", "وقود الشاحنتين"), tt(`@ AED ${aedPerKm().toFixed(2)}/km`, `${aedPerKm().toFixed(2)} درهم/كم`), "green"),
    ].join("");
  }

  /* ---------- Leaflet map (optional; degrades if CDN blocked) ---------- */
  const TRIP_COLORS = ["#f5a524", "#38bdf8", "#34d399", "#f472b6", "#c084fc", "#fb923c", "#facc15", "#4ade80"];
  let map = null, mapLayer = null;

  function ensureMap() {
    if (map || typeof L === "undefined") return;
    map = L.map("map", { scrollWheelZoom: false }).setView([24.9, 55.0], 8);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap © CARTO", maxZoom: 19, subdomains: "abcd",
    }).addTo(map);
    mapLayer = L.layerGroup().addTo(map);
  }

  function depotMarker(d, label) {
    return L.marker([d.lat, d.lng], {
      icon: L.divIcon({ className: "depot-pin", html: `🏭`, iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).bindPopup(`<b>${label}</b><br>${d.name}`);
  }

  function drawMap(plans) {
    ensureMap();
    if (!map) { // CDN blocked / offline
      const el = $("#map");
      if (el && !el.dataset.warned) { el.dataset.warned = "1"; el.innerHTML = `<div class="map-off">🗺 Map needs internet (Leaflet CDN). Routing + Google Maps links still work.</div>`; }
      return;
    }
    mapLayer.clearLayers();
    const bounds = [];

    // HQ always shown; south depot only when a plan uses it.
    depotMarker(FP.HQ, tt("HQ Depot", "المقر")).addTo(mapLayer);
    bounds.push([FP.HQ.lat, FP.HQ.lng]);
    if (plans.some((p) => p.origin.id === "depot-s")) {
      depotMarker(FP.SOUTH_DEPOT, tt("South Depot", "مستودع الجنوب")).addTo(mapLayer);
      bounds.push([FP.SOUTH_DEPOT.lat, FP.SOUTH_DEPOT.lng]);
    }

    let colorI = 0;
    const legendItems = [];
    plans.forEach((plan) => {
      const trip = plan.run; // one run per city
      const color = TRIP_COLORS[colorI++ % TRIP_COLORS.length];
      const legLatLngs = [[plan.origin.lat, plan.origin.lng]];
      trip.stats.legs.forEach((leg) => {
        const p = leg.point;
        bounds.push([p.lat, p.lng]);
        legLatLngs.push([p.lat, p.lng]);
        L.circleMarker([p.lat, p.lng], {
          radius: 6, color: "#0b0e14", weight: 1.5, fillColor: color, fillOpacity: 0.95,
        }).bindPopup(`<b>${p.name}</b><br>${cityName(plan.city)} · ${tt("stop", "نقطة")} ${leg.seq}<br>${tt("ETA", "الوصول")} ${leg.arrive} · ${leg.legKm} ${tt("km", "كم")}`).addTo(mapLayer);
      });
      legLatLngs.push([plan.origin.lat, plan.origin.lng]); // back to base
      L.polyline(legLatLngs, { color, weight: 2.5, opacity: 0.75 }).addTo(mapLayer);
      legendItems.push(`<span class="lg-item"><span class="lg-dot" style="background:${color}"></span>${cityName(plan.city)} · ${trip.stats.legs.length} ${tt("stops", "نقطة")} · ${tt("back", "عودة")} ${trip.stats.finish}</span>`);
    });

    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
    const lg = $("#mapLegend"); if (lg) lg.innerHTML = legendItems.join("");
  }

  function render() {
    const dxb = planCity("Dubai");
    const auh = planCity("Abu Dhabi");
    $("#kpis").innerHTML = kpiRow(dxb, auh);
    $("#cities").innerHTML = cityCard(dxb) + cityCard(auh);
    drawMap([dxb, auh]);

    const leave = dxb.run.stats.leave;
    const dxbFinish = dxb.run.stats.finish, auhFinish = auh.run.stats.finish;
    const bothFits = !dxb.run.stats.overShift && !auh.run.stats.overShift;
    $("#feasBanner").className = "feas-banner " + (bothFits ? "ok" : "bad");
    $("#feasBanner").innerHTML = bothFits
      ? tt(
          `✓ Both vans leave HQ ${leave} together — <span class="fb-sub">Dubai back ${dxbFinish}, Abu Dhabi back ${auhFinish}. All 32 stops in one day. Tap 🗺 for a van's live route, 📍 for a stop.</span>`,
          `✓ الشاحنتان تنطلقان من المقر ${leave} معاً — <span class="fb-sub">دبي عودة ${dxbFinish}، أبوظبي عودة ${auhFinish}. كل الـ٣٢ نقطة في يوم واحد. اضغط 🗺 لمسار الشاحنة، 📍 لنقطة.</span>`)
      : tt(
          `⏱ Both vans leave HQ ${leave} together — Dubai back ${dxbFinish}, Abu Dhabi back <b>${auhFinish}</b>. <span class="fb-sub">Abu Dhabi's single run runs past its window${opts.useSouthDepot ? "" : " — flip the southern-depot toggle and it finishes far earlier"}. Cold chain on a run this long needs a refrigerated van or a depot.</span>`,
          `⏱ الشاحنتان تنطلقان من المقر ${leave} معاً — دبي عودة ${dxbFinish}، أبوظبي عودة <b>${auhFinish}</b>. <span class="fb-sub">جولة أبوظبي الواحدة تتجاوز نافذتها${opts.useSouthDepot ? "" : " — فعّل مستودع الجنوب لتنتهي أبكر بكثير"}. سلسلة التبريد لجولة بهذا الطول تلزمها شاحنة مبردة أو مستودع.</span>`);
  }

  /* ---------- CSV trip sheet ---------- */
  function exportCsv() {
    const cols = ["City", "Origin", "Seq", "Customer", "Area", "Cadence", "Diet",
      "LeaveHQ", "ArriveETA", "DriveMin", "LegKm", "MapsPin"];
    const rows = [cols.join(",")];
    const cell = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    ["Dubai", "Abu Dhabi"].forEach((city) => {
      const plan = planCity(city);
      const leave = plan.run.stats.leave;
      plan.run.stats.legs.forEach((leg) => {
        const p = leg.point;
        rows.push([city, plan.origin.area, leg.seq, p.name, p.area, `${p.cadence}-day`,
          p.diet, leave, leg.arrive, leg.driveMin, leg.legKm, FL.gmapsPin(p)].map(cell).join(","));
      });
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "field-test-trip-sheet.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  /* ---------- inputs ---------- */
  function syncInputs() {
    $("#cfg-leave").value = minToTime(opts.leaveMin);
    $("#cfg-avgKmh").value = opts.avgKmh;
    $("#cfg-stopMin").value = opts.stopMin;
    $("#cfg-winding").value = opts.windingFactor;
    $("#cfg-southDepot").checked = !!opts.useSouthDepot;
  }
  function wire() {
    $("#cfg-leave").addEventListener("input", (e) => { opts.leaveMin = timeToMin(e.target.value); save(); render(); });
    const num = (id, key, min) => $(id).addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v >= min) { opts[key] = v; save(); render(); }
    });
    num("#cfg-avgKmh", "avgKmh", 10);
    num("#cfg-stopMin", "stopMin", 1);
    num("#cfg-winding", "windingFactor", 1);
    $("#cfg-southDepot").addEventListener("change", (e) => { opts.useSouthDepot = e.target.checked; save(); render(); });
    $("#resetBtn").addEventListener("click", () => { opts = { ...DEF }; save(); syncInputs(); render(); });
    $("#exportBtn").addEventListener("click", exportCsv);
    $("#printBtn").addEventListener("click", () => window.print());
  }

  load();
  syncInputs();
  wire();
  render();
})();
