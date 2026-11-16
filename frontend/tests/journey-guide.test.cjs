const test = require("node:test");
const assert = require("node:assert/strict");
const { describe } = require("../assets/journey-guide.js");

const sites = { base: { name: "Habitat" }, ridge: { name: "Ridge" }, goal: { name: "Goal" } };
const route = {
  nodes: ["base", "ridge", "goal"],
  segments: [
    { from: "base", to: "ridge", terrain: "Firm ground", distance_km: 0.8, risk: 18, slope_deg: 4 },
    { from: "ridge", to: "goal", terrain: "Rocky ascent", distance_km: 1.2, risk: 68, slope_deg: 16 },
  ],
};

test("guided notices describe only the selected simulated segment", () => {
  const first = describe(route, sites, 0);
  const second = describe(route, sites, 1);
  assert.match(first.message, /Firm ground ahead/);
  assert.match(first.progress, /1 OF 2/);
  assert.equal(first.tone, "calm");
  assert.match(second.message, /high-risk demo segment/);
  assert.match(second.speech, /From Ridge, follow the planned route toward Goal/);
  assert.match(second.speech, /1\.20 kilometers/);
  assert.match(second.speech, /16 degrees/);
  assert.match(second.speech, /68 out of 100/);
  assert.equal(second.tone, "caution");
  assert.doesNotMatch(first.message, /Rocky ascent/);
});

test("finishing the guided route reports demo completion", () => {
  const last = describe(route, sites, 2);
  assert.equal(last.done, true);
  assert.match(last.message, /Goal in this guided demo/);
});

test("network guidance names modeled risk without claiming physical arrival", () => {
  const networkRoute = { ...route, source: "network" };
  const warning = describe(networkRoute, sites, 1);
  assert.match(warning.speech, /terrain model routes toward Goal/);
  assert.match(warning.speech, /modeled risk score/);
  assert.doesNotMatch(warning.speech, /demo|simulated|illustrative/);
  const finished = describe(networkRoute, sites, 2);
  assert.match(finished.message, /reviewed the modeled route/);
  assert.doesNotMatch(finished.message, /You reached/);
});
