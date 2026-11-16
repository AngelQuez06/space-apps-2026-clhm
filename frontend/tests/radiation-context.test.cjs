const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { readRadObservation } = require("../assets/radiation-context.js");

const root = path.resolve(__dirname, "../..");
const full = JSON.parse(fs.readFileSync(path.join(root, "backend/data/rad_baseline.json"), "utf8"));
const snapshot = JSON.parse(fs.readFileSync(path.join(root, "frontend/assets/rad-reference.json"), "utf8"));

test("bundled RAD observation exactly matches the NASA-derived backend record", () => {
  assert.deepEqual(snapshot.period.from, full.period.from);
  assert.deepEqual(snapshot.period.to, full.period.to);
  assert.deepEqual(snapshot.period.days, full.period.days);
  assert.equal(snapshot.baseline.absorbed_si_mgy_day, full.baseline.absorbed_si_mgy_day);
  assert.equal(snapshot.method.dose_column, full.method.dose_column);
  assert.equal(snapshot.source.url, full.source.url);
  assert.deepEqual(readRadObservation(snapshot), {
    value: full.baseline.absorbed_si_mgy_day,
    from: full.period.from,
    to: full.period.to,
    days: full.period.days,
  });
});

test("a fallback constant or unrelated source cannot appear as a RAD measurement", () => {
  assert.equal(readRadObservation({ ...snapshot, measured: false }), null);
  assert.equal(readRadObservation({ ...snapshot, source: { url: "https://example.com/" } }), null);
  assert.equal(readRadObservation({ ...snapshot, baseline: { absorbed_si_mgy_day: null } }), null);
});
