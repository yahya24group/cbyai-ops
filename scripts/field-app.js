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

  /* ---------- one city → optimized route + shift-feasible trips ---------- */
  // Abu Dhabi can dispatch from the southern depot; everything else runs from HQ.
  function originFor(city) {
    return city === "Abu Dhabi" && opts.useSouthDepot ? FP.SOUTH_DEPOT : FP.HQ;
  }
  function planCity(city) {
    const pts = FP.byCity(city);
    const shiftMin = CITY_SHIFT[city];
    const origin = originFor(city);
    const base = { ...opts, aedPerKm: aedPerKm(), shiftMin };
    const full = FL.routeStats(origin, FL.optimizeRoute(origin, pts, opts.windingFactor), base);
    const split = FL.splitIntoRuns(origin, pts, base);
    const fuelAed = split.trips.reduce((a, t) => a + (t.stats.fuelAed || 0), 0);
    // For Abu Dhabi, always compute the HQ baseline so we can show the depot's saving.
    let hqAlt = null;
    if (city === "Abu Dhabi") {
      const hqSplit = FL.splitIntoRuns(FP.HQ, pts, base);
      hqAlt = {
        trips: hqSplit.trips.length,
        fuelAed: Math.round(hqSplit.trips.reduce((a, t) => a + (t.stats.fuelAed || 0), 0) * 10) / 10,
        soloFinish: hqSplit.soloFinish,
      };
    }
    return { city, shiftMin, origin, full, split, hqAlt, fuelAed: Math.round(fuelAed * 10) / 10 };
  }

  /* ---------- render ---------- */
  const stat = (v, l, cls = "") => `<div class="s ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;

  function tripBlock(trip, shiftMin) {
    const { idx, stats, links } = trip;
    const fits = stats.totalMin <= shiftMin;
    const segBtns = links.map((l, i) =>
      `<a class="seg-btn" href="${l.url}" target="_blank" rel="noopener">
         🗺 ${links.length > 1 ? "Seg " + (i + 1) : "Open route"} <small>${l.stops} stops</small>
       </a>`).join("");

    const rows = stats.legs.map((leg) => {
      const p = leg.point;
      return `<li class="stop-row">
        <span class="seq">${leg.seq}</span>
        <div class="who">
          <div class="nm">${esc(p.name)}</div>
          <div class="meta">
            <span class="chip">${esc(p.area)}</span>
            <span class="chip">${p.cadence}-day</span>
            <span class="chip">${esc(p.diet)}</span>
            <span class="chip">${leg.legKm} km</span>
          </div>
        </div>
        <div class="eta"><div class="t">${leg.arrive}</div><div class="d">+${leg.driveMin}m drive</div></div>
        <a class="pin" href="${FL.gmapsPin(p)}" target="_blank" rel="noopener" title="Open ${esc(p.area)} in Google Maps">📍</a>
      </li>`;
    }).join("");

    return `<div class="trip">
      <div class="trip-head">
        <span class="trip-no">Trip ${idx}</span>
        <span class="trip-sum">${stats.legs.length} stops · ${stats.totalKm} km · leave ${stats.leave} → back ${stats.finish}
          <b class="${fits ? "ok" : "bad"}">${fits ? "fits" : "over +" + (stats.totalMin - shiftMin) + "m"}</b></span>
      </div>
      <div class="route-links">${segBtns}</div>
      <ul class="stop-list">${rows}</ul>
    </div>`;
  }

  function cityCard(plan) {
    const { city, shiftMin, split, full, fuelAed, origin, hqAlt } = plan;
    const n = split.trips.length;
    const badge = n === 1
      ? `<span class="badge">1 trip fits ${Math.round(shiftMin / 60)}h shift</span>`
      : `<span class="badge over">${n} trips to clear</span>`;
    const fromDepot = origin.id === "depot-s";

    // Depot saving line (Abu Dhabi only).
    let depotLine = "";
    if (hqAlt) {
      if (fromDepot) {
        const saved = hqAlt.trips - n;
        const savedFuel = Math.round((hqAlt.fuelAed - fuelAed) * 10) / 10;
        depotLine = `<p class="note depot-win" style="margin:.2rem 0 1rem">🏭 <b>South depot on:</b> ${n} trips vs <b>${hqAlt.trips}</b> from HQ${saved > 0 ? ` — cuts ${saved} trip${saved > 1 ? "s" : ""}` : ""}${savedFuel > 0 ? ` and AED ${savedFuel} fuel` : ""}. Deadhead gone: vans start in the AD belt, not 175 km north.</p>`;
      } else {
        depotLine = `<p class="note" style="margin:.2rem 0 1rem">💡 Toggle the <b>southern depot</b> above — from Mussafah this drops to fewer trips and less fuel.</p>`;
      }
    }

    const trips = split.trips.map((t) => tripBlock(t, shiftMin)).join("");

    return `<div class="card">
      <div class="city-head"><h2>${esc(city)}</h2>${badge}</div>
      <div class="origin-tag">🚚 from ${esc(origin.name)}</div>
      <div class="city-stats">
        ${stat(full.totalKm + " km", "1-pass route", "amber")}
        ${stat("16", "stops")}
        ${stat(n, "van-trips", n > 1 ? "red" : "")}
        ${stat("AED " + fuelAed, "fuel (all trips)")}
      </div>
      <p class="note" style="margin:0 0 .2rem">One optimized pass would run <b>${full.totalMin}m</b> (leave ${full.leave} → ${full.finish}) — ${full.overShift ? `over the ${Math.round(shiftMin / 60)}h shift, so it splits into ${n} trips` : `inside the ${Math.round(shiftMin / 60)}h shift`}. One driver doing all trips back-to-back finishes <b>${split.soloFinish}</b>; ${n} drivers clear it in parallel.</p>
      ${depotLine}
      ${trips}
    </div>`;
  }

  function kpiRow(dxb, auh) {
    const km = dxb.full.totalKm + auh.full.totalKm;
    const fuel = Math.round((dxb.fuelAed + auh.fuelAed) * 10) / 10;
    const trips = dxb.split.trips.length + auh.split.trips.length;
    const kpi = (v, l, s, cls) =>
      `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div><div class="s">${s}</div></div>`;
    return [
      kpi("32", "test customers", "16 Dubai · 16 Abu Dhabi", "amber"),
      kpi(km + " km", "combined 1-pass", `${dxb.full.totalKm} + ${auh.full.totalKm}`, "blue"),
      kpi(trips + " trips", "to clear both", `${dxb.split.trips.length} DXB · ${auh.split.trips.length} AUH`, trips > 4 ? "red" : "green"),
      kpi("AED " + fuel, "fuel both cities", `@ AED ${aedPerKm().toFixed(2)}/km`, "green"),
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
    depotMarker(FP.HQ, "HQ Depot").addTo(mapLayer);
    bounds.push([FP.HQ.lat, FP.HQ.lng]);
    if (plans.some((p) => p.origin.id === "depot-s")) {
      depotMarker(FP.SOUTH_DEPOT, "South Depot").addTo(mapLayer);
      bounds.push([FP.SOUTH_DEPOT.lat, FP.SOUTH_DEPOT.lng]);
    }

    let colorI = 0;
    const legendItems = [];
    plans.forEach((plan) => {
      plan.split.trips.forEach((trip) => {
        const color = TRIP_COLORS[colorI++ % TRIP_COLORS.length];
        const legLatLngs = [[plan.origin.lat, plan.origin.lng]];
        trip.stats.legs.forEach((leg) => {
          const p = leg.point;
          bounds.push([p.lat, p.lng]);
          legLatLngs.push([p.lat, p.lng]);
          L.circleMarker([p.lat, p.lng], {
            radius: 6, color: "#0b0e14", weight: 1.5, fillColor: color, fillOpacity: 0.95,
          }).bindPopup(`<b>${p.name}</b><br>${plan.city} · trip ${trip.idx} · stop ${leg.seq}<br>ETA ${leg.arrive} · ${leg.legKm} km`).addTo(mapLayer);
        });
        legLatLngs.push([plan.origin.lat, plan.origin.lng]); // back to depot
        L.polyline(legLatLngs, { color, weight: 2.5, opacity: 0.75 }).addTo(mapLayer);
        legendItems.push(`<span class="lg-item"><span class="lg-dot" style="background:${color}"></span>${plan.city.slice(0, 3).toUpperCase()} trip ${trip.idx} · ${trip.stats.legs.length} stops</span>`);
      });
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

    const trips = dxb.split.trips.length + auh.split.trips.length;
    const heavy = trips > 4;
    const depotOn = opts.useSouthDepot;
    $("#feasBanner").className = "feas-banner " + (heavy ? "bad" : "ok");
    if (depotOn) {
      const saved = auh.hqAlt ? auh.hqAlt.trips - auh.split.trips.length : 0;
      $("#feasBanner").className = "feas-banner ok";
      $("#feasBanner").innerHTML = `✓ South depot active — <span class="fb-sub">Abu Dhabi now clears in ${auh.split.trips.length} trips${saved > 0 ? ` (was ${auh.hqAlt.trips} from HQ, −${saved})` : ""}. ${trips} van-trips total for both cities. Tap 🗺 for any trip's live route.</span>`;
    } else {
      $("#feasBanner").innerHTML = heavy
        ? `⚠ ${trips} van-trips to clear both cities — <span class="fb-sub">Abu Dhabi's ${auh.split.trips.length} trips are the deadhead tax: ~175 km each way from the UAQ depot means a van carries only a few AUH stops per shift. Flip the southern-depot toggle to see the fix. Tap 🗺 for any trip's live route.</span>`
        : `✓ ${trips} trips clear all 32 stops inside shift — <span class="fb-sub">Tap 🗺 to open a trip's live driving route, 📍 for a single stop.</span>`;
    }
  }

  /* ---------- CSV trip sheet ---------- */
  function exportCsv() {
    const cols = ["City", "Origin", "Trip", "Seq", "Customer", "Area", "Cadence", "Diet",
      "ArriveETA", "DriveMin", "LegKm", "MapsPin"];
    const rows = [cols.join(",")];
    const cell = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    ["Dubai", "Abu Dhabi"].forEach((city) => {
      const plan = planCity(city);
      plan.split.trips.forEach((t) => {
        t.stats.legs.forEach((leg) => {
          const p = leg.point;
          rows.push([city, plan.origin.area, t.idx, leg.seq, p.name, p.area, `${p.cadence}-day`,
            p.diet, leg.arrive, leg.driveMin, leg.legKm, FL.gmapsPin(p)].map(cell).join(","));
        });
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
    $("#cfg-bagCap").value = opts.bagCap;
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
    num("#cfg-bagCap", "bagCap", 1);
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
