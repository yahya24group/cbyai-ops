/* field-points.js — 32 TEST customer points (approx real coords) for the
   Field Test bench: 16 Dubai + 16 Abu Dhabi, scattered coastal↔inland so the
   route optimizer and driver-timing model have real variance to chew on.
   Pure data, no DOM. Coords are planning-grade (test/approx), not survey-grade. */
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;

  const HQ = { id: "hq", name: "HQ Depot — Umm Al Quwain", area: "Umm Al Quwain", lat: 25.5647, lng: 55.5551 };
  // Optional forward base for the south run — Mussafah/ICAD is the AD logistics belt.
  const SOUTH_DEPOT = { id: "depot-s", name: "South Depot — Mussafah (ICAD)", area: "Mussafah", lat: 24.3600, lng: 54.5100 };

  // 7 diet profiles from the pilot dashboard, rotated across the book.
  const DIETS = ["high-protein", "balanced", "low-carb", "vegan", "keto", "vegetarian", "low-calorie"];
  const diet = (i) => DIETS[i % DIETS.length];
  // Alternate cadence so daily load + SLA both get exercised.
  const cad = (i) => (i % 2 === 0 ? 2 : 3);

  /* Dubai — 16 stops, ~35 km span (Marina/Palm coast → Int'l City/Mirdif inland). */
  const DXB = [
    ["Marina",            25.0805, 55.1403],
    ["JBR",               25.0757, 55.1327],
    ["Palm Jumeirah",     25.1124, 55.1390],
    ["Downtown",          25.1972, 55.2744],
    ["Business Bay",      25.1857, 55.2650],
    ["DIFC",              25.2110, 55.2796],
    ["Deira",             25.2710, 55.3095],
    ["Bur Dubai",         25.2637, 55.2972],
    ["Karama",            25.2470, 55.3050],
    ["Al Quoz",           25.1400, 55.2300],
    ["Al Barsha",         25.1120, 55.1980],
    ["Mirdif",            25.2170, 55.4180],
    ["Silicon Oasis",     25.1210, 55.3770],
    ["International City", 25.1620, 55.4090],
    ["Dubai Hills",       25.1050, 55.2450],
    ["Al Nahda",          25.2940, 55.3720],
  ];

  /* Abu Dhabi — 16 stops, ~45 km span (Corniche island → Yas/Al Shamkha mainland). */
  const AUH = [
    ["Corniche",       24.4750, 54.3300],
    ["Al Reem Island", 24.4990, 54.4020],
    ["Al Maryah",      24.5000, 54.3880],
    ["Al Bateen",      24.4560, 54.3300],
    ["Al Mushrif",     24.4460, 54.3820],
    ["Khalifa City",   24.4190, 54.5760],
    ["Al Raha Beach",  24.4560, 54.6060],
    ["Yas Island",     24.4880, 54.6070],
    ["Saadiyat",       24.5430, 54.4340],
    ["Masdar City",    24.4270, 54.6150],
    ["Mussafah",       24.3510, 54.4980],
    ["MBZ City",       24.3330, 54.5400],
    ["Baniyas",        24.3200, 54.6300],
    ["Al Shamkha",     24.4060, 54.7280],
    ["Al Falah",       24.4550, 54.7250],
    ["Al Reef",        24.4360, 54.6720],
  ];

  // Test customer names — one per stop, city-flavoured, arbitrary.
  const NAMES = [
    "A. Rahman", "S. Khan", "M. Ali", "F. Hassan", "L. Ahmed", "N. Yusuf",
    "R. Saeed", "H. Omar", "K. Nabil", "T. Zayed", "D. Farouk", "G. Salem",
    "B. Rashid", "J. Karim", "P. Nair", "V. Menon",
  ];

  function build(list, city, prefix) {
    return list.map(([area, lat, lng], i) => ({
      id: `${prefix}-${String(i + 1).padStart(2, "0")}`,
      name: `${NAMES[i]} (${area})`,
      area, city, lat, lng,
      cadence: cad(i),
      diet: diet(i),
    }));
  }

  const POINTS = [...build(DXB, "Dubai", "DXB"), ...build(AUH, "Abu Dhabi", "AUH")];
  const byCity = (city) => POINTS.filter((p) => p.city === city);

  root.FIELD_POINTS = { HQ, SOUTH_DEPOT, POINTS, byCity, DIETS };
})();
