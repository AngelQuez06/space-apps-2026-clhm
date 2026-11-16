const test = require("node:test");
const assert = require("node:assert/strict");
const map = require("../assets/backend-map.js");

test("backend URL is normalized and unsafe mixed content is rejected", () => {
  assert.equal(map.normalizeBaseUrl("http://127.0.0.1:5000/api"), "http://127.0.0.1:5000");
  assert.equal(map.normalizeBaseUrl("https://example.com/mars/"), "https://example.com/mars");
  assert.throws(() => map.normalizeBaseUrl("http://example.com", "https:"), /HTTPS/);
  assert.throws(() => map.normalizeBaseUrl("https://user:pass@example.com"), /credentials/);
});

test("Mars tile coordinates round-trip and use the backend's 2-by-1 geographic grid", () => {
  for (const zoom of [0, 5, 13]) {
    const pixel = map.worldPixel(-5.4, 137.8, zoom);
    const point = map.geoFromWorldPixel(pixel.x, pixel.y, zoom);
    assert.ok(Math.abs(point.lat + 5.4) < 1e-10);
    assert.ok(Math.abs(point.lon - 137.8) < 1e-10);
  }
  assert.deepEqual(map.visibleTiles({ lat: 0, lon: 0 }, 0, 512, 256).map(({ x, y }) => [x, y]), [[0, 0], [1, 0]]);
  assert.deepEqual(map.visibleTiles({ lat: 0, lon: 0 }, 1, 512, 512).map(({ x, y }) => [x, y]),
    [[1, 0], [2, 0], [1, 1], [2, 1]]);
});

test("connector reads the Flask contract and creates usable tile and terrain URLs", async () => {
  const previous = global.fetch;
  const called = [];
  global.fetch = async (url) => {
    called.push(url);
    const data = url.endsWith("/api/zone")
      ? { name: "Mount Sharp", center: { lat: -5.4, lon: 137.8 }, bbox: null }
      : url.endsWith("/api/layers")
        ? { scheme: { crs: "EPSG:4326", tile_size: 256, z0_tiles: [2, 1] }, layers: [{ id: "satellite", format: "png", max_zoom: 19 }, { id: "relief", format: "jpg", max_zoom: 10 }, { id: "slope", format: "png", max_zoom: 16 }] }
        : { elevation_m: -4300, slope_deg: 12, class: "ok", resolution_m: 200 };
    return { ok: true, headers: { get: () => "application/json" }, json: async () => data };
  };
  try {
    const client = await map.connect("http://127.0.0.1:5000/api");
    assert.equal(client.zone.center.lat, -5.4);
    assert.equal(client.tileUrl("satellite", 13, 7231, 4340), "http://127.0.0.1:5000/api/tiles/satellite/13/7231/4340.png");
    assert.equal(client.tileUrl("slope", 13, 7231, 4340), "http://127.0.0.1:5000/api/terrain/slope/13/7231/4340.png");
    assert.equal((await client.point(-5.4, 137.8)).slope_deg, 12);
    assert.equal(called.length, 3);
  } finally { global.fetch = previous; }
});

test("connector exposes optional color and THEMIS layers when advertised", async () => {
  const previous = global.fetch;
  global.fetch = async (url) => {
    const data = url.endsWith("/api/zone")
      ? { name: "Mount Sharp", center: { lat: -5.4, lon: 137.8 } }
      : { scheme: { crs: "EPSG:4326", tile_size: 256, z0_tiles: [2, 1] }, layers: [
        { id: "satellite", format: "png", max_zoom: 19 },
        { id: "satellite_color", format: "png", max_zoom: 19, sources: ["viking", "ctx", "hirise"] },
        { id: "themis_night", format: "png", max_zoom: 12 },
        { id: "relief", format: "jpg", max_zoom: 10 },
      ] };
    return { ok: true, headers: { get: () => "application/json" }, json: async () => data };
  };
  try {
    const client = await map.connect("https://mars.example");
    assert.equal(client.tileUrl("satellite_color", 13, 7231, 4340),
      "https://mars.example/api/tiles/satellite_color/13/7231/4340.png");
    assert.equal(client.layers.satellite_color.sources.at(-1), "hirise");
    assert.equal(client.tileUrl("themis_night", 9, 814, 271),
      "https://mars.example/api/tiles/themis_night/9/814/271.png");
  } finally { global.fetch = previous; }
});

test("route request sends map-picked coordinates and reports an unavailable route service", async () => {
  const previous = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/route")) {
      if (calls.length === 3) return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ feasible: true, path: [], metrics: {} }) };
      return { ok: false, status: 404, headers: { get: () => "application/json" }, json: async () => ({}) };
    }
    const data = url.endsWith("/api/zone")
      ? { name: "Mount Sharp", center: { lat: -5.4, lon: 137.8 } }
      : { scheme: { crs: "EPSG:4326", tile_size: 256, z0_tiles: [2, 1] }, layers: [
        { id: "satellite", format: "png", max_zoom: 19 }, { id: "relief", format: "jpg", max_zoom: 10 },
      ] };
    return { ok: true, headers: { get: () => "application/json" }, json: async () => data };
  };
  try {
    const client = await map.connect("https://mars.example");
    const payload = { start: { lat: -5.4, lon: 137.8 }, end: { lat: -5.39, lon: 137.81 }, rover_support: true, solar_storm: false };
    assert.deepEqual(await client.route(payload), { feasible: true, path: [], metrics: {} });
    assert.equal(calls[2].url, "https://mars.example/api/route");
    assert.equal(calls[2].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[2].options.body), payload);
    await assert.rejects(client.route(payload), /route service is unavailable/);
  } finally { global.fetch = previous; }
});
