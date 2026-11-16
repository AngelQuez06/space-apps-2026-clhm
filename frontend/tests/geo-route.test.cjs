const test = require("node:test");
const assert = require("node:assert/strict");
const geo = require("../assets/geo-route.js");

const path = Array.from({ length: 9 }, (_, index) => ({ lat: -5.0, lon: 137.3 + index * .003, slope_deg: index === 6 ? 17 : 8 }));
const result = { feasible: true, path, metrics: { distance_m: 1400, estimated_time_min: 45, o2_consumption_kg: .1, radiation_dose_msv: .02 } };

test("geographic route stages cover every point in order and flag steep sections", () => {
  assert.equal(geo.validResult(result), true);
  const stages = geo.buildStages(result);
  assert.ok(stages.length >= 2 && stages.length <= 8);
  assert.equal(stages[0].startIndex, 0);
  assert.equal(stages.at(-1).endIndex, path.length - 1);
  for (let index = 1; index < stages.length; index += 1) assert.equal(stages[index].startIndex, stages[index - 1].endIndex);
  assert.ok(stages.some((stage) => stage.max_slope_deg === 17));
  const warning = geo.describeStage({ stages }, stages.findIndex((stage) => stage.max_slope_deg === 17));
  assert.match(warning.speech, /terrain-model route/);
  assert.equal(warning.tone, "caution");
  assert.equal(geo.describeStage({ stages }, stages.length).done, true);
});

test("invalid or infeasible route data cannot become a spoken route", () => {
  assert.equal(geo.validResult({ ...result, feasible: false }), false);
  assert.equal(geo.validResult({ ...result, path: [{ lat: NaN, lon: 137, slope_deg: 0 }] }), false);
  assert.throws(() => geo.buildStages({ ...result, feasible: false }));
});
