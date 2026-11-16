(function (root) {
  "use strict";

  function createEngine(data, network = null) {
    const graph = Object.fromEntries(data.sites.map(([id]) => [id, []]));
    const pairKey = (a, b) => [a, b].sort().join("|");
    const details = network?.segments ? new Map(network.segments.map((segment) => [pairKey(segment.from, segment.to), segment])) : null;
    for (const segment of data.segments) {
      graph[segment[0]].push([segment[1], segment]);
      graph[segment[1]].push([segment[0], segment]);
    }
    const cache = new Map();

    function* paths(start, end, avoidHighRisk) {
      const stack = [[start, [start], []]];
      while (stack.length) {
        const [current, nodes, segments] = stack.pop();
        if (current === end) { yield [nodes, segments]; continue; }
        if (nodes.length >= 9) continue;
        for (const [next, segment] of graph[current] || []) {
          if (nodes.includes(next) || (avoidHighRisk && segment[3] >= 60)) continue;
          stack.push([next, [...nodes, next], [...segments, segment]]);
        }
      }
    }

    function measure(nodes, segments) {
      const distance = segments.reduce((sum, segment) => sum + segment[2], 0);
      const risk = segments.reduce((sum, segment) => sum + segment[2] * segment[3], 0) / distance;
      if (details) {
        const metrics = segments.map((_, index) => details.get(pairKey(nodes[index], nodes[index + 1]))?.foot);
        if (metrics.some((item) => !item)) throw new Error("The terrain network is missing route metrics.");
        return {
          distance: metrics.reduce((sum, item) => sum + item.distance_m, 0) / 1000,
          risk,
          minutes: metrics.reduce((sum, item) => sum + item.estimated_time_min, 0),
          oxygenKg: metrics.reduce((sum, item) => sum + item.o2_consumption_kg, 0),
          doseMsv: metrics.reduce((sum, item) => sum + item.radiation_dose_msv, 0),
        };
      }
      // EVA pace and consumption values below are illustrative, not physiological forecasts.
      const minutes = 60 * segments.reduce(
        (sum, segment) => sum + segment[2] / (1.7 * (1 - segment[3] / 240) * (1 - segment[4] / 75)), 0,
      ) + Math.max(0, nodes.length - 2) * 6;
      return { distance, risk, minutes };
    }

    function describe(nodes, segments, id, label, emergency) {
      const { distance, risk, minutes, oxygenKg, doseMsv } = measure(nodes, segments);
      const hours = minutes / 60;
      return {
        id, label, nodes,
        distance_km: Math.round(distance * 100) / 100,
        risk: Math.round(risk),
        duration_min: Math.round(minutes),
        oxygen_l: details ? null : Math.round(hours * 65),
        oxygen_kg: details ? +oxygenKg.toFixed(3) : null,
        dose_msv: details ? +(doseMsv * (emergency ? 18 : 1)).toFixed(3) : +(hours * (emergency ? .42 : .025)).toFixed(2),
        source: details ? "network" : "illustrative",
        max_slope_deg: Math.max(...segments.map((segment) => segment[4])),
        waypoints: nodes.length - 2,
        segments: segments.map((segment, i) => ({
          from: nodes[i], to: nodes[i + 1], distance_km: segment[2],
          risk: segment[3], slope_deg: segment[4], terrain: segment[5],
        })),
      };
    }

    function plan(start, end, avoidHighRisk = false, emergency = false) {
      if (!graph[start] || !graph[end] || start === end) return [];
      const key = `${start}|${end}|${Number(avoidHighRisk)}|${Number(emergency)}`;
      if (cache.has(key)) return cache.get(key);
      const best = {};
      let shortest = Infinity;
      for (const [nodes, segments] of paths(start, end, avoidHighRisk)) {
        const { distance, risk, minutes } = measure(nodes, segments);
        shortest = Math.min(shortest, distance);
        for (const [profile, score] of [["balanced", minutes + risk * 4], ["fast", minutes]]) {
          if (!best[profile] || score < best[profile].score) best[profile] = { score, nodes, segments };
        }
      }
      // Limit detours so a long loop cannot lower the displayed average risk artificially.
      for (const [nodes, segments] of paths(start, end, avoidHighRisk)) {
        const { distance, risk } = measure(nodes, segments);
        if (distance > shortest * 1.5) continue;
        if (!best.safe || risk < best.safe.score) best.safe = { score: risk, nodes, segments };
      }
      const result = [];
      const used = new Set();
      for (const [id, label] of [["balanced", "Balanced"], ["fast", "Fastest"], ["safe", "Lowest risk"]]) {
        const choice = best[id];
        if (choice && !used.has(choice.nodes.join("|"))) {
          result.push(describe(choice.nodes, choice.segments, id, label, emergency));
          used.add(choice.nodes.join("|"));
        }
      }
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, result);
      return result;
    }

    function nearestShelter(start, avoidHighRisk = false) {
      let best = null;
      const shelters = details ? data.sites.filter((site) => String(site[2]).toLowerCase().startsWith("shelter")).map((site) => site[0]) : ["base", "shelter"];
      for (const destination of shelters) {
        if (destination === start) continue;
        const routes = plan(start, destination, avoidHighRisk, true);
        const fastest = routes.reduce((winner, route) => !winner || route.duration_min < winner.duration_min ? route : winner, null);
        if (fastest && (!best || fastest.duration_min < best.minutes)) best = { id: destination, minutes: fastest.duration_min };
      }
      return best?.id || null;
    }

    return { plan, nearestShelter };
  }

  const api = { createEngine };
  root.ARES_ROUTE_ENGINE = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
