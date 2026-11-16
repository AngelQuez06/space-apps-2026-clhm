const test = require("node:test");
const assert = require("node:assert/strict");

global.window = {};
require("../assets/data.js");
const { createEngine } = require("../assets/route-engine.js");
const engine = createEngine(window.ARES_DEMO);

test("the default mission offers distinct route priorities with coherent metrics", () => {
  const routes = engine.plan("base", "delta");
  assert.equal(routes.length, 3);
  assert.deepEqual(routes.map((route) => route.id), ["balanced", "fast", "safe"]);
  assert.ok(routes[1].duration_min <= routes[0].duration_min);
  assert.ok(routes[2].risk <= routes[0].risk);
  assert.ok(routes.every((route) => route.distance_km > 0 && route.oxygen_l > 0 && route.dose_msv > 0));
  assert.equal(new Set(routes.map((route) => route.nodes.join("|"))).size, routes.length);
});

test("high-risk avoidance removes every segment rated 60 or above", () => {
  for (const from of window.ARES_DEMO.sites.map((site) => site[0])) {
    for (const to of window.ARES_DEMO.sites.map((site) => site[0])) {
      if (from === to) continue;
      const routes = engine.plan(from, to, true);
      assert.ok(routes.length, `${from} → ${to} should remain connected`);
      assert.ok(routes.every((route) => route.segments.every((segment) => segment.risk < 60)));
    }
  }
});

test("solar alert chooses a shelter and increases the simulated dose", () => {
  const target = engine.nearestShelter("delta");
  assert.ok(["base", "shelter"].includes(target));
  const normal = engine.plan("delta", target, false, false)[0];
  const alert = engine.plan("delta", target, false, true)[0];
  assert.ok(alert.dose_msv > normal.dose_msv);
});

test("Gale network routes sum measured segment model metrics and choose a modeled shelter", () => {
  const network = require("../../backend/data/network.json");
  const projected = {
    sites: network.sites.map((site) => [site.id, site.name, site.type, 0, 0, site.elevation_m, site.note]),
    segments: network.segments.map((segment) => [segment.from, segment.to, segment.distance_km, segment.risk, segment.max_slope_deg, segment.surface]),
  };
  const realEngine = createEngine(projected, network);
  const route = realEngine.plan("habitat", "boxwork_main")[0];
  assert.equal(route.source, "network");
  assert.equal(route.oxygen_l, null);
  const key = (a, b) => [a, b].sort().join("|");
  const segments = new Map(network.segments.map((segment) => [key(segment.from, segment.to), segment]));
  const expectedOxygen = route.nodes.slice(1).reduce((sum, id, index) =>
    sum + segments.get(key(route.nodes[index], id)).foot.o2_consumption_kg, 0);
  assert.ok(Math.abs(route.oxygen_kg - expectedOxygen) < .001);
  const shelter = realEngine.nearestShelter("boxwork_main");
  assert.ok(network.sites.find((site) => site.id === shelter)?.type.startsWith("Shelter"));
  assert.deepEqual(realEngine.plan("habitat", "boxwork_main", true), []);
});
