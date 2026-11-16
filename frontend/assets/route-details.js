(function (root) {
  "use strict";

  // Pure helpers shared by the planner map and the geographic map:
  // canvas projection, route geometry, elevation profile series, and section risk.
  const MARS_RADIUS_M = 3396190;
  const ROVER_LIMIT_DEG = 15;

  function distanceMeters(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Same projection as backend/app/routes/network.py: equirectangular fitted to the sites' extent,
  // longitude scaled by cos(mean latitude), centered in a width x height canvas with a margin.
  function canvasProjector(canvas) {
    const { width = 1000, height = 700, margin = 60, extent } = canvas || {};
    if (!Array.isArray(extent) || extent.length !== 4) return null;
    const [west, south, east, north] = extent;
    const cos = Math.cos((south + north) * Math.PI / 360);
    const spanX = (east - west) * cos;
    const spanY = north - south;
    const scale = Math.min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY);
    const padX = (width - spanX * scale) / 2;
    const padY = (height - spanY * scale) / 2;
    return {
      project: (lat, lon) => ({ x: padX + (lon - west) * cos * scale, y: padY + (north - lat) * scale }),
      unproject: (x, y) => ({ lat: north - (y - padY) / scale, lon: west + (x - padX) / (cos * scale) }),
    };
  }

  // Risk of a stretch of path, same weights as the backend network risk (sand is unknown here):
  // 100 * (0.50 * min(1, max slope / 30) + 0.35 * min(1, 4 * share of points above 15 deg)).
  function sectionRisk(slopes) {
    if (!slopes.length) return 0;
    const max = Math.max(...slopes);
    const over = slopes.filter((slope) => slope > ROVER_LIMIT_DEG).length / slopes.length;
    return Math.round(100 * (0.5 * Math.min(1, max / 30) + 0.35 * Math.min(1, 4 * over)));
  }

  // Cumulative km along points ({lat, lon}), rescaled so the total matches `totalKm` when given.
  function cumulativeKm(points, totalKm) {
    const km = [0];
    for (let i = 1; i < points.length; i += 1) km.push(km[i - 1] + distanceMeters(points[i - 1], points[i]) / 1000);
    const raw = km.at(-1);
    const factor = totalKm && raw > 0 ? totalKm / raw : 1;
    return km.map((value) => value * factor);
  }

  function findSegment(segments, from, to) {
    const direct = segments.find((segment) => segment.from === from && segment.to === to);
    if (direct) return { segment: direct, reversed: false };
    const back = segments.find((segment) => segment.from === to && segment.to === from);
    return back ? { segment: back, reversed: true } : null;
  }

  // Network route (site to site): dense series from each segment's A* path, oriented along the route.
  function networkRouteGeometry(route, networkSegments, siteById = {}) {
    const series = [];
    const sections = [];
    const geoPath = [];
    let offset = 0;
    route.nodes.slice(0, -1).forEach((from, index) => {
      const to = route.nodes[index + 1];
      const found = findSegment(networkSegments || [], from, to);
      const summary = route.segments[index];
      const raw = found?.segment?.path?.length >= 2 ? found.segment.path : null;
      let points = raw ? raw.map(([lat, lon, elevation]) => ({ lat, lon, elevation })) : null;
      if (points && found.reversed) points = points.reverse();
      if (!points) {
        const a = siteById[from], b = siteById[to];
        points = [a, b].filter(Boolean).map((site) => ({ lat: site.lat, lon: site.lon, elevation: site.elevation }));
      }
      const km = cumulativeKm(points, summary?.distance_km);
      points.forEach((point, i) => {
        if (index && i === 0) return; // shared site between consecutive segments
        series.push({ km: offset + km[i], elevation: point.elevation, lat: point.lat, lon: point.lon });
        geoPath.push({ lat: point.lat, lon: point.lon });
      });
      const length = km.at(-1) || summary?.distance_km || 0;
      sections.push({
        startKm: offset, endKm: offset + length, risk: summary?.risk ?? 0,
        from, to, terrain: summary?.terrain || "", slope_deg: summary?.slope_deg ?? null,
      });
      offset += length;
    });
    return { series, sections, geoPath, totalKm: offset };
  }

  // Two-point route from POST /api/route, split into the guided-journey stages.
  function customRouteGeometry(result, stages) {
    const path = result.path.map((point) => ({ lat: point.lat, lon: point.lon, elevation: point.elevation_m, slope: point.slope_deg }));
    const km = cumulativeKm(path, result.metrics.distance_m / 1000);
    const series = path.map((point, i) => ({ km: km[i], elevation: point.elevation, lat: point.lat, lon: point.lon }));
    const parts = stages?.length ? stages : [{ startIndex: 0, endIndex: path.length - 1 }];
    const sections = parts.map((stage, index) => {
      const slopes = path.slice(stage.startIndex, stage.endIndex + 1).map((point) => point.slope).filter(Number.isFinite);
      return {
        startKm: km[stage.startIndex], endKm: km[stage.endIndex], risk: sectionRisk(slopes),
        from: index ? `Section ${index}` : "A", to: index === parts.length - 1 ? "B" : `Section ${index + 1}`,
        terrain: slopes.length ? `mean slope ${(slopes.reduce((a, b) => a + b, 0) / slopes.length).toFixed(1)}°` : "",
        slope_deg: slopes.length ? +Math.max(...slopes).toFixed(1) : null,
      };
    });
    const total = km.at(-1) || 0;
    const risk = total ? Math.round(sections.reduce((sum, s) => sum + (s.endKm - s.startKm) * s.risk, 0) / total) : 0;
    return { series, sections, geoPath: path.map(({ lat, lon }) => ({ lat, lon })), totalKm: total, risk };
  }

  // Chart coordinates for an elevation series in a 700 x 180 chart (plot area x 34..666, y 32..144).
  function seriesChart(series, { left = 34, right = 666, top = 32, bottom = 144 } = {}) {
    const elevations = series.map((point) => point.elevation).filter(Number.isFinite);
    const min = Math.min(...elevations), max = Math.max(...elevations);
    const span = Math.max(100, max - min);
    const lower = min - Math.max(25, span * 0.15);
    const upper = max + Math.max(25, span * 0.15);
    const total = series.at(-1)?.km || 0;
    const x = (km) => left + (total ? km / total : 0) * (right - left);
    const y = (elevation) => bottom - (elevation - lower) / (upper - lower) * (bottom - top);
    return { lower, upper, total, x, y, points: series.map((point) => ({ ...point, x: x(point.km), y: y(point.elevation) })) };
  }

  const api = { distanceMeters, canvasProjector, sectionRisk, cumulativeKm, networkRouteGeometry, customRouteGeometry, seriesChart };
  root.CLHM_ROUTE_DETAILS = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
