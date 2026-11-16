(function (root) {
  "use strict";

  function buildProfile(route, sites, routes) {
    const byId = Object.fromEntries(sites.map((site) => [site.id, site]));
    const elevations = route.nodes.map((id) => byId[id]?.elevation ?? 0);
    const minElevation = Math.min(...elevations);
    const maxElevation = Math.max(...elevations);
    const span = Math.max(100, maxElevation - minElevation);
    const lower = minElevation - Math.max(25, span * .15);
    const upper = maxElevation + Math.max(25, span * .15);
    const total = route.segments.reduce((sum, segment) => sum + segment.distance_km, 0);
    let distance = 0;
    const points = route.nodes.map((id, index) => {
      if (index) distance += route.segments[index - 1].distance_km;
      return {
        id, name: byId[id]?.name || id, elevation: elevations[index],
        distance: +distance.toFixed(2),
        x: 34 + (total ? distance / total : 0) * 632,
        y: 144 - (elevations[index] - lower) / (upper - lower) * 112,
      };
    });
    const critical = route.segments.reduce((winner, segment) =>
      !winner || segment.risk > winner.risk ? segment : winner, null);
    const fast = routes.find((candidate) => candidate.id === "fast") ||
      routes.reduce((winner, candidate) => !winner || candidate.duration_min < winner.duration_min ? candidate : winner, null);
    const safe = routes.find((candidate) => candidate.id === "safe") ||
      routes.reduce((winner, candidate) => !winner || candidate.risk < winner.risk ? candidate : winner, null);
    let comparison = "This is the only route available with the current filters.";
    if (routes.length > 1) {
      const reference = route.id === fast.id ? safe : fast;
      const minutes = route.duration_min - reference.duration_min;
      const risk = route.risk - reference.risk;
      const timeText = minutes === 0 ? "the same travel time" : `${Math.abs(minutes)} min ${minutes > 0 ? "longer" : "shorter"}`;
      const riskText = risk === 0 ? "the same risk index" : `${Math.abs(risk)} risk points ${risk > 0 ? "higher" : "lower"}`;
      comparison = `Compared with ${reference.label.toLowerCase()}: ${timeText} and ${riskText}.`;
    }
    return { points, lower, upper, total, critical, comparison };
  }

  const api = { buildProfile };
  root.CLHM_PROFILE = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
