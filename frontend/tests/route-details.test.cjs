const test = require("node:test");
const assert = require("node:assert/strict");
const details = require("../assets/route-details.js");

const canvas = { width: 1000, height: 700, margin: 60, extent: [137.3, -5.6, 138.3, -4.6] };

test("canvas projection round-trips and keeps the sites' extent inside the margin", () => {
  const p = details.canvasProjector(canvas);
  for (const [lat, lon] of [[-4.6, 137.3], [-5.6, 138.3], [-5.1, 137.8]]) {
    const xy = p.project(lat, lon);
    const back = p.unproject(xy.x, xy.y);
    assert.ok(Math.abs(back.lat - lat) < 1e-9 && Math.abs(back.lon - lon) < 1e-9);
    assert.ok(xy.x >= 60 - 1e-6 && xy.x <= 940 + 1e-6 && xy.y >= 60 - 1e-6 && xy.y <= 640 + 1e-6);
  }
  assert.equal(details.canvasProjector({}), null);
});

test("section risk follows the backend weights without sand", () => {
  assert.equal(details.sectionRisk([]), 0);
  assert.equal(details.sectionRisk([3, 4, 5]), Math.round(100 * 0.5 * 5 / 30));
  assert.equal(details.sectionRisk([30, 30]), 85); // 50 + 35
});

test("network geometry orients reversed segments and chains them without duplicate sites", () => {
  const segments = [
    { from: "a", to: "b", path: [[-5, 137, -4000], [-5, 137.01, -3990], [-5, 137.02, -3980]] },
    { from: "c", to: "b", path: [[-5, 137.04, -3900], [-5, 137.03, -3950], [-5, 137.02, -3980]] },
  ];
  const route = { nodes: ["a", "b", "c"], segments: [
    { distance_km: 1.2, risk: 10, terrain: "Plain", slope_deg: 3 },
    { distance_km: 1.2, risk: 70, terrain: "Steep slope", slope_deg: 25 },
  ] };
  const geo = details.networkRouteGeometry(route, segments);
  assert.equal(geo.series.length, 5);
  assert.deepEqual(geo.series.map((p) => p.elevation), [-4000, -3990, -3980, -3950, -3900]);
  assert.ok(Math.abs(geo.totalKm - 2.4) < 1e-9);
  assert.equal(geo.sections[1].risk, 70);
  assert.ok(Math.abs(geo.sections[1].startKm - 1.2) < 1e-9);
  assert.equal(geo.geoPath.length, 5);
});

test("custom geometry splits into stages, scales distance and weights risk", () => {
  const path = [0, 1, 2, 3, 4].map((i) => ({ lat: -5, lon: 137 + i * 0.01, elevation_m: -4000 + i * 10, slope_deg: i < 3 ? 2 : 20 }));
  const result = { path, metrics: { distance_m: 2000 } };
  const geo = details.customRouteGeometry(result, [{ startIndex: 0, endIndex: 2 }, { startIndex: 2, endIndex: 4 }]);
  assert.ok(Math.abs(geo.totalKm - 2) < 1e-9);
  assert.equal(geo.sections.length, 2);
  assert.equal(geo.sections[0].from, "A");
  assert.equal(geo.sections[1].to, "B");
  assert.ok(geo.sections[1].risk > geo.sections[0].risk);
  const single = details.customRouteGeometry(result, []);
  assert.equal(single.sections.length, 1);
  assert.equal(single.sections[0].to, "B");
});

test("series chart spans the plot area", () => {
  const chart = details.seriesChart([{ km: 0, elevation: -4000 }, { km: 5, elevation: -3800 }]);
  assert.equal(chart.points[0].x, 34);
  assert.equal(chart.points[1].x, 666);
  assert.ok(chart.points[1].y < chart.points[0].y);
});
