"use strict";

(function (root) {
  function describe(route, sites, index) {
    if (!route?.segments?.length) throw new Error("A route with segments is required.");
    const count = route.segments.length;
    const realNetwork = route.source === "network";
    const destination = sites[route.nodes.at(-1)]?.name || route.nodes.at(-1);
    if (index >= count) {
      const message = realNetwork ? `You have reviewed the modeled route to ${destination}. Confirm every step with mission procedures before travel.` :
        `You reached ${destination} in this guided demo. Take a moment to look back at the route you explored.`;
      return { title: "Journey complete", message, speech: message, progress: "ROUTE COMPLETE", tone: "complete", done: true };
    }
    const leg = route.segments[Math.max(0, index)];
    const from = sites[leg.from]?.name || leg.from;
    const to = sites[leg.to]?.name || leg.to;
    const terrain = leg.terrain.toLowerCase();
    const tone = leg.risk >= 60 ? "caution" : leg.risk >= 40 ? "care" : "calm";
    const advice = tone === "caution" ? (realNetwork ? "The model rates this segment high risk. Review it before continuing." : "This is a high-risk demo segment. Review it before continuing.") :
      tone === "care" ? "A more demanding stretch is ahead. Take it one step at a time." :
        "A gentler stretch is ahead. Take it one step at a time.";
    const title = `Next: ${to}`;
    const message = `${from} → ${to}. ${leg.terrain} ahead · ${leg.distance_km.toFixed(2)} km · risk ${leg.risk}/100 · slope ${leg.slope_deg}°. ${advice}`;
    const speech = realNetwork ? `From ${from}, the terrain model routes toward ${to} for about ${leg.distance_km.toFixed(2)} kilometers. The mapped surface is ${terrain}. The sampled maximum slope is ${leg.slope_deg} degrees, and the modeled risk score is ${leg.risk} out of 100. ${advice}` :
      `From ${from}, follow the planned route toward ${to} for about ${leg.distance_km.toFixed(2)} kilometers. The simulated terrain is ${terrain}. The illustrative slope is ${leg.slope_deg} degrees, and the demo risk score is ${leg.risk} out of 100. ${advice}`;
    return { title, message, speech, progress: `LEG ${Math.max(0, index) + 1} OF ${count}`, tone, done: false };
  }

  const api = { describe };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CLHM_JOURNEY_GUIDE = api;
})(typeof window !== "undefined" ? window : null);
