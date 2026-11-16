const test = require("node:test");
const assert = require("node:assert/strict");
const { buildProfile } = require("../assets/mission-profile.js");

const sites = [
  { id: "a", name: "Base", elevation: -4500 },
  { id: "b", name: "Pass", elevation: -4400 },
  { id: "c", name: "Goal", elevation: -4450 },
];
const selected = {
  id: "safe", label: "Lowest risk", nodes: ["a", "b", "c"],
  duration_min: 90, risk: 20,
  segments: [
    { from: "a", to: "b", distance_km: 1, risk: 15, slope_deg: 4, terrain: "Plain" },
    { from: "b", to: "c", distance_km: 2, risk: 30, slope_deg: 8, terrain: "Ridge" },
  ],
};
const fast = { ...selected, id: "fast", label: "Fastest", duration_min: 70, risk: 45 };

test("profile distributes points by cumulative distance and elevation", () => {
  const profile = buildProfile(selected, sites, [selected, fast]);
  assert.equal(profile.total, 3);
  assert.deepEqual(profile.points.map((point) => point.distance), [0, 1, 3]);
  assert.ok(profile.points[1].x < profile.points[2].x);
  assert.ok(profile.points[1].y < profile.points[0].y);
  assert.equal(profile.critical.terrain, "Ridge");
});

test("comparison explains the cost of choosing lower risk", () => {
  const profile = buildProfile(selected, sites, [selected, fast]);
  assert.match(profile.comparison, /20 min longer/);
  assert.match(profile.comparison, /25 risk points lower/);
  assert.match(buildProfile(selected, sites, [selected]).comparison, /only route/);
});
