"use strict";

(function (root) {
  const MARS_RADIUS_M = 3396190;

  function distanceMeters(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function validResult(result) {
    if (!result || result.feasible !== true || !Array.isArray(result.path) || result.path.length < 2) return false;
    if (!result.path.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon) && Number.isFinite(point.slope_deg))) return false;
    const metrics = result.metrics;
    return Boolean(metrics && [metrics.distance_m, metrics.estimated_time_min, metrics.o2_consumption_kg, metrics.radiation_dose_msv]
      .every((value) => Number.isFinite(value) && value >= 0));
  }

  function buildStages(result) {
    if (!validResult(result)) throw new Error("A feasible route with geographic points and metrics is required.");
    const path = result.path;
    const distances = path.slice(1).map((point, index) => distanceMeters(path[index], point));
    const total = distances.reduce((sum, distance) => sum + distance, 0);
    const count = Math.min(path.length - 1, 8, Math.max(1, Math.ceil(total / 700)));
    const target = total / count;
    const stages = [];
    let startIndex = 0;
    let stageDistance = 0;
    for (let index = 1; index < path.length; index += 1) {
      stageDistance += distances[index - 1];
      const remainingSteps = path.length - 1 - index;
      const remainingStages = count - stages.length - 1;
      if ((stageDistance >= target && remainingSteps >= remainingStages) || remainingSteps === remainingStages) {
        const slice = path.slice(startIndex, index + 1);
        stages.push({
          startIndex, endIndex: index, start: path[startIndex], end: path[index],
          distance_m: stageDistance,
          max_slope_deg: slice.reduce((max, point) => Math.max(max, point.slope_deg), 0),
        });
        startIndex = index;
        stageDistance = 0;
      }
    }
    if (startIndex < path.length - 1) {
      const slice = path.slice(startIndex);
      stages.push({ startIndex, endIndex: path.length - 1, start: path[startIndex], end: path.at(-1),
        distance_m: stageDistance, max_slope_deg: slice.reduce((max, point) => Math.max(max, point.slope_deg), 0) });
    }
    return stages;
  }

  function describeStage(route, index) {
    const count = route.stages.length;
    if (index >= count) {
      const message = "The terrain-model route walkthrough is complete. This was a simulation, not live navigation.";
      return { title: "Walkthrough complete", message, speech: message, progress: "ROUTE COMPLETE", tone: "complete", done: true };
    }
    const stage = route.stages[index];
    const km = (stage.distance_m / 1000).toFixed(2);
    const slope = stage.max_slope_deg.toFixed(1);
    const caution = stage.max_slope_deg >= 15;
    const advice = caution ? "This modeled section includes a steep slope; review the terrain data before any real mission." :
      "Follow the highlighted path toward the next marker, one section at a time.";
    return {
      title: `Next map section ${index + 1}`,
      message: `${km} km along the drawn route · DEM slope up to ${slope}°. ${advice}`,
      speech: `Section ${index + 1} of ${count}. Follow the highlighted terrain-model route for about ${km} kilometers toward the next marker. The maximum sampled slope is ${slope} degrees. ${advice}`,
      progress: `SECTION ${index + 1} OF ${count}`, tone: caution ? "caution" : "calm", done: false,
    };
  }

  const api = { distanceMeters, validResult, buildStages, describeStage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CLHM_GEO_ROUTE = api;
})(typeof window !== "undefined" ? window : null);
