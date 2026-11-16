(function (root) {
  "use strict";

  const RAD_ARCHIVE = "https://spdf.gsfc.nasa.gov/pub/data/aaa_planetary/msl/rad/cdf/obs-l2/";

  // Keep the directly measured silicon dose separate from CLHM's modeled route
  // dose and from NASA's career effective-dose standard. They are not interchangeable.
  function readRadObservation(data) {
    const value = data?.baseline?.absorbed_si_mgy_day;
    const { from, to, days } = data?.period || {};
    if (data?.measured === false || !Number.isFinite(value) || value <= 0 ||
      !Number.isInteger(days) || days < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(from || "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to ||
      data?.source?.url !== RAD_ARCHIVE ||
      !String(data?.method?.dose_column || "").includes("RTG Corrected Dose B")) return null;
    return { value, from, to, days };
  }

  const api = { readRadObservation };
  root.CLHM_RADIATION_CONTEXT = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
