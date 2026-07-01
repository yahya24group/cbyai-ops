/* config.js — Business Rules & Operations Configuration Engine.
   Centralized store for all operational variables.
   No hardcoded costs, rules, or policies. */
window.CONFIG = (function () {
  const DEFAULTS = {
    /* Operational Costs */
    external_driver_cost_per_stop: 50,      // AED: hired driver cost per delivery
    operational_flexibility_fee: 20,        // AED: fee for disrupting optimized schedule
    company_subsidy_per_external_stop: 30,  // AED: company absorbs this much per external stop

    /* Location Change Management */
    monthly_free_location_changes: 2,       // free changes per calendar month
    location_change_fee: 20,                // AED: fee per change after free allowance

    /* Subscription Cadence */
    default_cadence_days: 2,                // every N days (optimized default)
    alternative_cadence_days: 3,            // alternative option
    cadence_change_fee_applies: true,       // charge flexibility fee for cadence changes?

    /* Route & Dispatch Constraints */
    bag_cap_per_run: 16,                    // max stops per vehicle
    delivery_window_minutes: 300,           // 5h evening window for corridor
    minutes_per_stop: 5,                    // service time per delivery
    avg_speed_kmh: 55,                      // planning speed

    /* Fuel & Travel */
    fuel_price_per_liter: 3.83,             // AED (from route test)
    fuel_economy_kmh: 7.5,                  // km per liter
    cost_per_km: null,                      // auto-calculated: fuel_price / fuel_economy

    /* Tolls & Parking (from 23 Jun route test) */
    salik_per_gate: 20,                     // AED: Salik toll
    darb_per_gate: 15,                      // AED: Darb toll
    parking_per_stop: 5,                    // AED: parking cost per delivery

    /* Fleet Management */
    cost_per_car_per_month: 5000,           // AED: driver + maintenance + insurance

    /* SLA & Promise */
    sla_hours: 48,                          // delivery promise window
    corridor_runs_daily: true,              // corridor always available

    /* Decision Rules */
    require_manual_review_external_dispatch: false, // auto-approve external driver requests?
    require_manual_review_cadence_change: true,     // cadence changes need approval?
    max_company_subsidy_per_order: 30,              // cap subsidy amount
  };

  let config = { ...DEFAULTS };

  // Auto-calculate derived values
  function updateDerivedValues() {
    config.cost_per_km = parseFloat(
      (config.fuel_price_per_liter / config.fuel_economy_kmh).toFixed(2)
    );
  }
  updateDerivedValues();

  function get(key) {
    return config[key] !== undefined ? config[key] : DEFAULTS[key];
  }

  function set(key, value) {
    if (key in DEFAULTS) {
      config[key] = value;
      updateDerivedValues();
      save();
      return true;
    }
    return false;
  }

  function getAll() {
    return { ...config };
  }

  function setMultiple(obj) {
    Object.keys(obj).forEach((k) => set(k, obj[k]));
  }

  function reset() {
    config = { ...DEFAULTS };
    updateDerivedValues();
    save();
  }

  /* Persistence: localStorage */
  const KEY = "routedesk.config.v1";
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(config));
    } catch (e) {
      console.error("Config save failed", e);
    }
  }

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || "null");
      if (stored && typeof stored === "object") {
        Object.keys(stored).forEach((k) => {
          if (k in DEFAULTS) config[k] = stored[k];
        });
        updateDerivedValues();
      }
    } catch (e) {
      console.error("Config load failed", e);
    }
  }

  load();

  return {
    DEFAULTS,
    get,
    set,
    getAll,
    setMultiple,
    reset,
    load,
    save,
  };
})();
