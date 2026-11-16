"use strict";

const $ = (selector) => document.querySelector(selector);
const SVG_NS = "http://www.w3.org/2000/svg";
let sites = [];
let siteById = {};
let engine = null;
let networkData = null;
const state = {
  routes: [], selected: "balanced", priority: "balanced", zoom: 1,
  layers: { topography: true, risk: false, science: false },
  emergency: false, previousDestination: "delta",
  // Which route the details, profile and both maps show: "network" (Gale sites) or "custom" (two map points).
  active: "network",
};
const RD = window.CLHM_ROUTE_DETAILS;
const backend = { client: null, map: null, mode: "demo", request: 0 };
const geo = { start: null, end: null, picking: null, result: null, stages: [], request: 0, calculating: false, error: "" };
const journey = { active: false, index: 0, utterance: null, utterances: null, speechRun: 0, startTimer: null, autoTimer: null, auto: true, completedSpeech: false };
const plannerBreakpoint = window.matchMedia("(max-width: 760px)");
let sheetReturnFocus = null;
let radObservation = null;

function svg(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 3200);
}

function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h ${String(rest).padStart(2, "0")}` : `${rest} min`;
}

function siteName(id) { return siteById[id]?.name || id; }

function populateSites() {
  for (const select of [$("#startSelect"), $("#endSelect")]) {
    select.replaceChildren();
    for (const site of sites) {
      const option = document.createElement("option");
      option.value = site.id;
      option.textContent = site.name;
      select.append(option);
    }
  }
  $("#startSelect").value = siteById.habitat ? "habitat" : sites[0]?.id;
  $("#endSelect").value = siteById.boxwork_main ? "boxwork_main" : sites.find((site) => site.id !== $("#startSelect").value)?.id;
}

function renderNetwork() {
  const group = $("#mapNetwork");
  group.replaceChildren();
  for (const [a, b, , risk] of networkData.demo.segments) {
    const from = siteById[a], to = siteById[b];
    if (!from || !to) continue;
    const level = risk >= 60 ? "high" : risk >= 35 ? "mid" : "low";
    group.append(svg("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: `network-line risk-${level}` }));
  }
}

function updateNetworkScale() {
  const extent = networkData?.demo?.canvas?.extent;
  if (!Array.isArray(extent) || extent.length !== 4) return;
  const [west, south, east, north] = extent;
  const margin = networkData.demo.canvas.margin || 60;
  const widthDeg = (east - west) * Math.cos((south + north) * Math.PI / 360);
  const heightDeg = north - south;
  const canvasScale = Math.min((1000 - 2 * margin) / widthDeg, (700 - 2 * margin) / heightDeg);
  const stage = $("#mapStage");
  const screenScale = Math.min(stage.clientWidth / 1000, stage.clientHeight / 700) * state.zoom;
  const kmPerPixel = 3396.19 * Math.PI / 180 / canvasScale / screenScale;
  if (!Number.isFinite(kmPerPixel) || kmPerPixel <= 0) return;
  const choices = [.5, 1, 2, 5, 10, 20, 50, 100];
  const distance = choices.reduce((best, choice) => Math.abs(Math.log(choice / (kmPerPixel * 60))) < Math.abs(Math.log(best / (kmPerPixel * 60))) ? choice : best);
  $("#mapScaleBar").style.width = `${Math.round(distance / kmPerPixel)}px`;
  $("#mapScaleText").textContent = `${distance} KM`;
}

// Scale bar for the geographic (tile) maps: EPSG:4326 tiles with 2x1 tiles of 256 px at z0, Mars radius 3396.19 km.
function updateGeoScale(zoom, lat) {
  const metersPerPixel = 180 / (2 ** zoom * 256) * (Math.PI / 180) * 3396190 * Math.cos(lat * Math.PI / 180);
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return;
  const choices = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  const target = metersPerPixel * 70;
  const distance = choices.reduce((best, choice) => Math.abs(Math.log(choice / target)) < Math.abs(Math.log(best / target)) ? choice : best);
  $("#mapScaleBar").style.width = `${Math.round(distance / metersPerPixel)}px`;
  $("#mapScaleText").textContent = distance >= 1000 ? `${distance / 1000} KM` : `${distance} M`;
}

// Terrain overlays (one at a time) shared by every map mode: tiles on geographic maps, one area image on the planner map.
const OVERLAY_AREA_KIND = { slope: "slope", radiation: "radiation", data_quality: "quality" };
const SLOPE_LEGEND_COLORS = { green: "#2ea043", yellow: "#f0c828", orange: "#f58c1e", red: "#dc2828" };
let overlayId = null;

function updateOverlayControls() {
  for (const button of document.querySelectorAll("#overlayControls [data-overlay]")) {
    const id = button.dataset.overlay;
    button.disabled = !backend.client?.layers[id];
    const active = id === overlayId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function setOverlay(id) {
  overlayId = id && backend.client?.layers[id] ? id : null;
  updateOverlayControls();
  backend.map?.setOverlay(overlayId);
  updatePlannerOverlay();
  renderOverlayLegend();
}

function updatePlannerOverlay() {
  const image = $("#mapOverlay");
  const projector = canvasProjector();
  if (!overlayId || backend.mode !== "demo" || !projector || !backend.client) { image.setAttribute("visibility", "hidden"); return; }
  const nw = projector.unproject(0, 0), se = projector.unproject(1000, 700);
  const bbox = [nw.lon, se.lat, se.lon, nw.lat].map((value) => value.toFixed(5)).join(",");
  const href = `${backend.client.baseUrl}/api/terrain/${OVERLAY_AREA_KIND[overlayId]}/area.png?bbox=${bbox}&width=1000&height=700`;
  if (image.getAttribute("href") !== href) image.setAttribute("href", href);
  image.setAttribute("visibility", "visible");
}

function renderOverlayLegend() {
  const legend = $("#overlayLegend");
  const layer = overlayId && backend.client?.layers[overlayId];
  legend.hidden = !layer;
  legend.replaceChildren();
  if (!layer) return;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const swatches = (entries) => {
    const row = element("div", "overlay-swatches");
    for (const [color, text] of entries) {
      const item = element("span");
      const swatch = element("i");
      swatch.style.background = color;
      if (color === "transparent") swatch.classList.add("empty");
      item.append(swatch, text);
      row.append(item);
    }
    return row;
  };
  if (overlayId === "slope") {
    legend.append(element("strong", "", "SLOPE · USGS DEM"),
      swatches((layer.legend || []).map((entry) => [SLOPE_LEGEND_COLORS[entry.color] || entry.color, `${entry.range_deg}°`])),
      element("small", "", "10 m inside HiRISE DTM patches, 200 m elsewhere (smoothed)."));
  } else if (overlayId === "radiation") {
    const [low, open, high] = layer.legend || [];
    legend.append(element("strong", "", "RADIATION · MODELED DOSE RATE"));
    const bar = element("div", "radiation-gradient");
    bar.setAttribute("aria-hidden", "true");
    legend.append(bar);
    if (low && open && high) {
      const scale = element("div", "radiation-scale");
      const position = (factor) => `${((factor - low.factor) / (high.factor - low.factor)) * 100}%`;
      for (const entry of [low, open, high]) {
        const label = element("span", "", `${entry.dose_msv_day}`);
        label.style.left = position(entry.factor);
        scale.append(label);
      }
      legend.append(scale, element("small", "", `mSv/day. Curiosity RAD baseline ${layer.baseline_msv_day} mSv/day × terrain shielding (model, solar storms not included).`));
    }
  } else if (overlayId === "data_quality") {
    legend.append(element("strong", "", "TERRAIN DATA QUALITY"),
      swatches((layer.legend || []).map((entry) => [entry.color, entry.label])),
      element("small", "", "Slope and routes are most reliable inside the blue patches."));
  }
}

function renderSites() {
  const group = $("#mapSites");
  group.replaceChildren();
  const origin = $("#startSelect").value, destination = $("#endSelect").value;
  for (const site of sites) {
    const endpoint = site.id === origin || site.id === destination;
    const marker = svg("g", {
      class: `site-group${endpoint ? " endpoint" : ""}${site.id === origin ? " origin" : ""}${site.type.toLowerCase().includes("science") ? " science-site" : ""}`,
      tabindex: "0", role: "button", "aria-label": `Choose ${site.name} as destination`,
    });
    marker.append(svg("circle", { cx: site.x, cy: site.y, r: endpoint ? 13 : 8, class: "site-ring" }));
    marker.append(svg("circle", { cx: site.x, cy: site.y, r: endpoint ? 7 : 5, class: "site-dot" }));
    if (endpoint || site.type.toLowerCase().includes("science")) {
      const label = svg("text", { x: site.x + 14, y: site.y - 12, class: `site-label${endpoint ? "" : " secondary"}` });
      label.textContent = site.name;
      marker.append(label);
    }
    const chooseDestination = () => chooseSite(site);
    marker.addEventListener("click", chooseDestination);
    marker.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseDestination(); }
    });
    group.append(marker);
  }
}

function renderAlternatives() {
  const list = $("#routeList");
  list.replaceChildren();
  $("#routeCount").textContent = String(state.routes.length).padStart(2, "0");
  for (const route of state.routes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `route-option${route.id === state.selected ? " active" : ""}`;
    button.setAttribute("aria-pressed", String(route.id === state.selected));
    const top = document.createElement("div");
    top.className = "route-option-top";
    const name = document.createElement("span");
    name.className = "route-option-name";
    const indicator = document.createElement("i");
    indicator.className = "route-option-indicator";
    name.append(indicator, document.createTextNode(route.label));
    const tag = document.createElement("span");
    tag.className = "route-option-tag";
    tag.textContent = route.id === "balanced" ? "RECOMMENDED" : route.id === "safe" ? "SAFER" : "FASTER";
    top.append(name, tag);
    const detail = document.createElement("div");
    detail.className = "route-option-detail";
    for (const value of [`${route.distance_km.toFixed(2)} km`, formatTime(route.duration_min), `Risk ${route.risk}`]) {
      const span = document.createElement("span");
      span.textContent = value;
      detail.append(span);
    }
    button.append(top, detail);
    button.addEventListener("click", () => { stopJourney(); state.active = "network"; state.selected = route.id; renderRoute(); });
    list.append(button);
  }
}

// Elevation profile along the real path (A* geometry) for both site routes and two-point routes.
function renderMissionProfile(detail) {
  const chart = $("#profileChart");
  chart.replaceChildren();
  const series = detail.geometry.series.filter((point) => Number.isFinite(point.elevation));
  if (series.length < 2) {
    $("#profileRange").textContent = "—";
    $("#profileDistance").textContent = "—";
    return;
  }
  const plot = RD.seriesChart(series);
  for (const y of [34, 88, 142]) chart.append(svg("line", { x1: 34, y1: y, x2: 666, y2: y, class: "profile-grid-line" }));
  const pts = plot.points;
  const area = `M ${pts[0].x} 146 L ${pts.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" L ")} L ${pts.at(-1).x} 146 Z`;
  chart.append(svg("path", { d: area, class: "profile-area" }));
  for (const section of detail.geometry.sections) {
    const inside = pts.filter((point) => point.km >= section.startKm - 1e-9 && point.km <= section.endKm + 1e-9);
    if (inside.length < 2) continue;
    const level = section.risk >= 60 ? "high" : section.risk >= 40 ? "mid" : "low";
    const line = svg("polyline", { points: inside.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "), class: `profile-segment ${level}`, fill: "none" });
    const title = svg("title");
    title.textContent = `${section.label}: ${(section.endKm - section.startKm).toFixed(2)} km, modeled risk ${section.risk}/100${section.slope_deg != null ? `, max slope ${section.slope_deg}°` : ""}`;
    line.append(title);
    chart.append(line);
  }
  for (const marker of detail.markers) {
    const near = pts.reduce((best, point) => Math.abs(point.km - marker.km) < Math.abs(best.km - marker.km) ? point : best, pts[0]);
    const dot = svg("circle", { cx: near.x, cy: near.y, r: 4, class: "profile-point" });
    const title = svg("title");
    title.textContent = `${marker.name}: ${Math.round(near.elevation).toLocaleString("en-US")} m (terrain model)`;
    dot.append(title);
    chart.append(dot);
  }
  $("#profileRange").textContent = `${Math.round(plot.lower).toLocaleString("en-US")} to ${Math.round(plot.upper).toLocaleString("en-US")} m`;
  $("#profileDistance").textContent = `${plot.total.toFixed(2)} km`;
  $("#profileComparison").textContent = detail.comparison;
  $("#profileCritical").textContent = detail.critical?.label || "No segments";
  $("#profileCriticalDetail").textContent = detail.critical?.detail || "";
  chart.setAttribute("aria-label", `Terrain-model elevation along the route from ${detail.from} to ${detail.to}, ${plot.total.toFixed(2)} kilometers`);
}

// Route shown by the details sheet and both maps, in one shape for site routes and two-point routes.
function networkDetail(route) {
  const geometry = RD.networkRouteGeometry(route, networkData?.segments, siteById);
  geometry.sections.forEach((section) => { section.label = `${siteName(section.from)} → ${siteName(section.to)}`; });
  const profile = window.CLHM_PROFILE.buildProfile(route, sites, state.routes);
  const critical = profile.critical;
  return {
    kind: "network", route, geometry,
    title: state.emergency ? `Evacuation · ${route.label.toLowerCase()}` : route.label,
    from: siteName(route.nodes[0]), to: siteName(route.nodes.at(-1)),
    distance_km: route.distance_km, duration_min: route.duration_min,
    oxygen: route.oxygen_kg?.toFixed(3) ?? route.oxygen_l, dose_msv: route.dose_msv,
    risk: route.risk, max_slope_deg: route.max_slope_deg, caption: `${route.waypoints} intermediate sites`,
    waypointCount: `${route.nodes.length} SITES`,
    waypoints: route.nodes.map((id, index) => ({
      name: siteName(id),
      detail: index ? `${route.segments[index - 1].distance_km.toFixed(2)} km · R${route.segments[index - 1].risk}` : "START",
      title: index ? `${route.segments[index - 1].terrain} · slope ${route.segments[index - 1].slope_deg}°` : "",
    })),
    markers: route.nodes.map((id, index) => ({ km: index ? geometry.sections[index - 1]?.endKm ?? 0 : 0, name: siteName(id) })),
    comparison: profile.comparison,
    critical: critical ? { label: `${siteName(critical.from)} → ${siteName(critical.to)}`, detail: `${critical.terrain} · risk ${critical.risk}/100 · slope ${critical.slope_deg}°` } : null,
  };
}

function customDetail() {
  const result = geo.result;
  const geometry = RD.customRouteGeometry(result, geo.stages);
  const last = geometry.sections.length - 1;
  geometry.sections.forEach((section, index) => { section.label = `Section ${index + 1}`; });
  const shelter = geoShelterMode();
  const mode = { rover: "Rover", foot: "On foot", shelter: "Storm shelter" }[$("#geoMobility").value] || "Route";
  const maxSlope = Math.max(...result.path.map((point) => point.slope_deg));
  const critical = geometry.sections.reduce((best, section) => !best || section.risk > best.risk ? section : best, null);
  return {
    kind: "custom", geometry,
    title: `Custom route · ${mode}`,
    from: `A · ${geoPointLabel(geo.start || result.path[0])}`,
    to: shelter ? "Nearest modeled shelter" : `B · ${geoPointLabel(geo.end || result.path.at(-1))}`,
    distance_km: result.metrics.distance_m / 1000, duration_min: Math.round(result.metrics.estimated_time_min),
    oxygen: result.metrics.o2_consumption_kg.toFixed(3), dose_msv: result.metrics.radiation_dose_msv,
    risk: geometry.risk, max_slope_deg: +maxSlope.toFixed(1),
    caption: `${result.path.length} DEM waypoints · ${geometry.sections.length} sections`,
    waypointCount: `${geometry.sections.length} SECTIONS`,
    waypoints: [{ name: "A · start", detail: "START", title: "" }, ...geometry.sections.map((section, index) => ({
      name: index === last ? (shelter ? "Shelter" : "B · destination") : `End of section ${index + 1}`,
      detail: `${(section.endKm - section.startKm).toFixed(2)} km · R${section.risk}`,
      title: `${section.terrain} · max slope ${section.slope_deg}°`,
    }))],
    markers: [{ km: 0, name: "A" }, ...geometry.sections.map((section, index) => ({ km: section.endKm, name: index === last ? (shelter ? "Shelter" : "B") : `Section ${index + 1} end` }))],
    comparison: `Single terrain-model route for ${mode.toLowerCase()} mode. Switch between Rover and On foot to compare.`,
    critical: critical ? { label: critical.label, detail: `${critical.terrain} · risk ${critical.risk}/100 · max slope ${critical.slope_deg}°` } : null,
  };
}

function activeDetail() {
  if (state.active === "custom") return window.CLHM_GEO_ROUTE.validResult(geo.result) ? customDetail() : null;
  const route = state.routes.find((item) => item.id === state.selected) || state.routes[0];
  return route && networkData ? networkDetail(route) : null;
}

function canvasProjector() { return RD.canvasProjector(networkData?.demo?.canvas); }

// [west, south, east, north] of the active route plus the custom points; all Gale sites when there is no route.
function activeRouteBounds() {
  const detail = activeDetail();
  const points = [...(detail?.geometry?.geoPath || []), ...[geo.start, geo.end].filter(Boolean)];
  const list = points.length >= 2 ? points : sites.filter((site) => Number.isFinite(site.lat));
  if (!list.length) return null;
  const lats = list.map((point) => point.lat), lons = list.map((point) => point.lon);
  const pad = 0.01;
  return [Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad];
}

// Two-point route and its A/B markers on the planner map.
function drawCustomOnCanvas() {
  const group = $("#mapCustom");
  group.replaceChildren();
  const projector = canvasProjector();
  if (!projector) return;
  if (state.active === "custom" && window.CLHM_GEO_ROUTE.validResult(geo.result)) {
    const d = geo.result.path.map((point, index) => {
      const xy = projector.project(point.lat, point.lon);
      return `${index ? "L" : "M"} ${xy.x.toFixed(1)} ${xy.y.toFixed(1)}`;
    }).join(" ");
    group.append(svg("path", { d, class: "custom-halo" }), svg("path", { d, class: "custom-path" }));
  }
  for (const [point, label, kind] of [[geo.start, "A", "start"], [geoShelterMode() ? null : geo.end, "B", "end"]]) {
    if (!point) continue;
    const xy = projector.project(point.lat, point.lon);
    const marker = svg("g", { class: `custom-marker ${kind}` });
    marker.append(svg("circle", { cx: xy.x, cy: xy.y, r: 11 }));
    const text = svg("text", { x: xy.x, y: xy.y });
    text.textContent = label;
    marker.append(text);
    group.append(marker);
  }
  $("#mapSvg").classList.toggle("picking", Boolean(geo.picking));
}

function svgPointFromEvent(event) {
  const map = $("#mapSvg");
  const matrix = map.getScreenCTM();
  if (!matrix) return null;
  const point = map.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(matrix.inverse());
}

// Planner map background click: same picking flow as the geographic map.
function onPlannerMapClick(event) {
  if (event.target.closest(".site-group")) return;
  if (!geo.picking) return;
  const projector = canvasProjector();
  const xy = svgPointFromEvent(event);
  if (!projector || !xy) return;
  selectGeoPoint(projector.unproject(xy.x, xy.y));
}

// A site clicked on any map: while a pick is armed it becomes that custom point; otherwise the site destination.
function chooseSite(site) {
  if (geo.picking && Number.isFinite(site.lat) && Number.isFinite(site.lon)) {
    selectGeoPoint({ lat: site.lat, lon: site.lon });
    return;
  }
  if (state.emergency) { toast("Turn off the alert to choose another destination."); return; }
  if (site.id === $("#startSelect").value) { toast("That site is already the starting point."); return; }
  $("#endSelect").value = site.id;
  loadRoutes();
}

function setPlannerDrawer(open) {
  const drawer = $("#plannerDrawer");
  drawer.dataset.open = String(open);
  drawer.setAttribute("aria-hidden", String(!open));
  if (open) drawer.removeAttribute("inert");
  else drawer.setAttribute("inert", "");
  document.body.classList.toggle("planner-drawer-open", open);
  const toggle = $("#plannerToggle");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close route planner" : "Open route planner");
  toggle.title = open ? "Close route planner" : "Open route planner";
  if (!open && (drawer.contains(document.activeElement) || document.activeElement === $("#plannerScrim"))) toggle.focus();
  if (open && plannerBreakpoint.matches) requestAnimationFrame(() => $("#plannerCloseButton").focus());
}

function selectSheetTab(name, focus = false) {
  const selected = name;
  for (const tabName of ["route", "profile", "sources"]) {
    const key = tabName[0].toUpperCase() + tabName.slice(1);
    const tab = $(`#sheetTab${key}`);
    const active = tabName === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`#sheetPane${key}`).hidden = !active;
    if (active && focus) tab.focus();
  }
  $("#sheetTitle").textContent = { route: "Route details", profile: "Mission profile", sources: "Sources & limits" }[selected];
}

function openMissionSheet(name = "route") {
  if (plannerBreakpoint.matches) setPlannerDrawer(false);
  selectSheetTab(name);
  const sheet = $("#missionSheet");
  if (sheet.dataset.open !== "true") sheetReturnFocus = document.activeElement;
  sheet.dataset.open = "true";
  sheet.removeAttribute("inert");
  sheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("sheet-open");
  $("#sheetLauncher").setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => $("#sheetClose").focus());
}

function closeMissionSheet() {
  const sheet = $("#missionSheet");
  if (sheet.dataset.open !== "true") return;
  sheet.dataset.open = "false";
  sheet.setAttribute("inert", "");
  sheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("sheet-open");
  $("#sheetLauncher").setAttribute("aria-expanded", "false");
  (sheetReturnFocus?.isConnected && !sheetReturnFocus.closest("[hidden], [inert]") ? sheetReturnFocus : $("#sheetLauncher")).focus();
}

function showRadObservation(data) {
  const observation = window.CLHM_RADIATION_CONTEXT.readRadObservation(data);
  if (!observation || (radObservation && observation.to < radObservation.to)) return false;
  radObservation = observation;
  $("#radMeasuredValue").textContent = `${observation.value.toFixed(4)} mGy/day`;
  $("#radMeasuredPeriod").textContent = `Silicon · ${observation.from} to ${observation.to} · ${observation.days} days`;
  return true;
}

async function loadBundledRadiation() {
  try {
    const response = await fetch("./assets/rad-reference.json", { credentials: "omit" });
    if (!response.ok || !showRadObservation(await response.json())) throw new Error("RAD snapshot unavailable");
  } catch {
    if (!radObservation) {
      $("#radMeasuredValue").textContent = "Unavailable";
      $("#radMeasuredPeriod").textContent = "The NASA RAD observation could not be loaded.";
    }
  }
}

async function loadRadiationFromApi(client) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${client.baseUrl}/api/radiation?days=0`, {
      headers: { Accept: "application/json" }, credentials: "omit", signal: controller.signal,
    });
    if (response.ok) showRadObservation(await response.json());
  } catch {
    // The dated NASA RAD snapshot remains visible when this optional endpoint is unavailable.
  } finally { clearTimeout(timeout); }
}

function renderEmptyDetails(title, caption) {
  $("#routeTitle").textContent = title;
  for (const id of ["#distanceValue", "#timeValue", "#oxygenValue", "#doseValue", "#riskValue", "#waypointCount"]) $(id).textContent = "—";
  $("#humanRouteDose").textContent = "—";
  $("#riskBar").style.width = "0";
  $("#riskCaption").textContent = caption;
  $("#waypointList").replaceChildren();
  $("#profileChart").replaceChildren();
  $("#startJourneyButton").disabled = true;
  $("#exportButton").disabled = true;
  $("#sheetLauncherLabel").textContent = "Route";
}

// Renders the active route (site route or two-point route) in the details, the profile and both maps.
function renderRoute() {
  const network = state.routes.find((item) => item.id === state.selected) || state.routes[0];
  if (network) state.selected = network.id;
  const detail = activeDetail();
  const svgPath = detail?.kind === "network"
    ? detail.route.nodes.map((id, i) => `${i ? "L" : "M"} ${siteById[id].x} ${siteById[id].y}`).join(" ") : "";
  $("#mapRoute").replaceChildren(...(svgPath ? [
    svg("path", { d: svgPath, class: "route-halo" }),
    svg("path", { d: svgPath, class: `route-path ${detail.route.id}` }),
  ] : []));
  renderSites();
  drawCustomOnCanvas();
  drawGeoRoute();
  renderGeoPanel();
  if (!detail) return;
  $("#startJourneyButton").disabled = false;
  $("#exportButton").disabled = false;
  $("#routeTitle").textContent = detail.title;
  $("#fromName").textContent = detail.from;
  $("#toName").textContent = detail.to;
  $("#distanceValue").textContent = detail.distance_km.toFixed(2);
  $("#timeValue").textContent = formatTime(detail.duration_min);
  $("#oxygenValue").textContent = detail.oxygen;
  $("#doseValue").textContent = detail.dose_msv.toFixed(3);
  $("#humanRouteDose").textContent = Number.isFinite(detail.dose_msv) ? detail.dose_msv.toFixed(3) : "—";
  $("#riskValue").textContent = `${detail.risk} / 100`;
  $("#riskBar").style.width = `${detail.risk}%`;
  const riskLabel = detail.risk < 30 ? "Low" : detail.risk < 50 ? "Moderate" : "High";
  $("#riskCaption").textContent = `${riskLabel} · max slope ${detail.max_slope_deg}° · ${detail.caption}`;
  $("#waypointCount").textContent = detail.waypointCount;
  const list = $("#waypointList");
  list.replaceChildren();
  detail.waypoints.forEach((waypoint, index) => {
    const item = document.createElement("div");
    item.className = "waypoint";
    const number = document.createElement("span");
    number.className = "waypoint-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.className = "waypoint-name";
    name.textContent = waypoint.name;
    const info = document.createElement("span");
    info.className = "waypoint-detail";
    info.textContent = waypoint.detail;
    if (waypoint.title) info.title = waypoint.title;
    item.append(number, name, info);
    list.append(item);
  });
  if (detail.kind === "network") renderAlternatives();
  else {
    $("#routeCount").textContent = "01";
    $("#routeList").textContent = "Two-point route from the terrain model. Choose Gale sites to compare Balanced, Fastest and Lowest risk alternatives, or switch Rover / On foot.";
  }
  renderMissionProfile(detail);
  $("#sheetLauncherLabel").textContent = `${detail.distance_km.toFixed(2)} km · ${detail.kind === "custom" ? "custom" : "route"}`;
}

function loadRoutes() {
  if (!engine) return;
  stopJourney();
  const start = $("#startSelect").value;
  let end = $("#endSelect").value;
  if (state.emergency) {
    end = engine.nearestShelter(start, $("#avoidRisk").checked);
    if (end) $("#endSelect").value = end;
  }
  if (start === end) { toast("Start and destination must be different."); return; }
  state.routes = end ? engine.plan(start, end, $("#avoidRisk").checked, state.emergency) : [];
  // Choosing Gale sites makes the site route the active one on every map.
  state.active = "network";
  if (!state.routes.length) {
    renderRoute();
    renderEmptyDetails("No route with these filters", "Try another destination or turn off Avoid high risk.");
    $("#routeList").textContent = "No feasible alternative for these settings.";
    $("#routeCount").textContent = "00";
    toast("No modeled route is available with these filters.");
    return;
  }
  state.selected = state.routes.find((route) => route.id === (state.emergency ? "fast" : state.priority))?.id || state.routes[0].id;
  renderRoute();
}

function geoPointLabel(point) {
  if (!point) return "choose on map";
  return `${Math.abs(point.lat).toFixed(3)}° ${point.lat < 0 ? "S" : "N"}, ${Math.abs(point.lon).toFixed(3)}° ${point.lon < 0 ? "W" : "E"}`;
}

function geoShelterMode() { return $("#geoMobility").value === "shelter"; }

// Which point the next map click sets: the start first, then the destination, then none (click = inspect).
function advanceGeoPicking() {
  geo.picking = !geo.start ? "start" : (!geo.end && !geoShelterMode()) ? "end" : null;
}

function updateGeoHint() {
  if (!backend.client) { $("#mapHint").textContent = "Connecting to Mars data…"; return; }
  if (!geo.picking && !geo.start && !geo.calculating) {
    $("#mapHint").textContent = "Click a site to change the destination, or use Pick start for two custom points.";
    return;
  }
  $("#mapHint").textContent = geo.picking === "start" ? "Click the map to set the start point." :
    geo.picking === "end" ? "Click the map to set the destination." :
      geo.calculating ? "Calculating the route…" :
        geo.start && (geo.end || geoShelterMode()) ? "Click a site for a Gale-site route, or use Pick start / Pick destination to move a point." :
          "Pick two map points to request a terrain-model route.";
}

function updateGeoControls() {
  const shelter = geoShelterMode();
  // Two-point routes need the route API, on the planner map as well as on the geographic maps.
  const available = Boolean(backend.client);
  $("#geoPickStart").setAttribute("aria-pressed", String(geo.picking === "start"));
  $("#geoPickEnd").setAttribute("aria-pressed", String(geo.picking === "end"));
  $("#geoPickStart").disabled = !available;
  $("#geoPickEnd").disabled = !available || shelter;
  $("#geoMobility").disabled = !available;
  $("#geoClear").disabled = !geo.start && !geo.end && !geo.result;
  $("#geoStartLabel").textContent = `Start: ${geoPointLabel(geo.start)}`;
  $("#geoEndLabel").textContent = shelter ? "Destination: nearest modeled shelter" : `Destination: ${geoPointLabel(geo.end)}`;
  $("#liveMap").classList.toggle("picking", Boolean(geo.picking));
  $("#mapSvg").classList.toggle("picking", Boolean(geo.picking));
  $("#planButton").disabled = !networkData && !available || geo.calculating;
  $("#planButton span").textContent = geo.calculating ? "Calculating…" : "Calculate route";
  updateGeoHint();
}

let geoRouteTimer = 0;
// Recalculates automatically whenever both points (or the start, in shelter mode) are known, in every map mode.
function scheduleGeoRoute() {
  clearTimeout(geoRouteTimer);
  if (!backend.client || !geo.start || (!geo.end && !geoShelterMode())) return;
  geoRouteTimer = setTimeout(() => calculateGeoRoute(), 250);
}

function resetGeoRoute() {
  stopJourney();
  clearTimeout(geoRouteTimer);
  geo.result = null; geo.stages = []; geo.error = ""; geo.request += 1; geo.calculating = false;
}

// Status card for two-point routes: shown only while calculating or when the terrain model rejects the points.
// Feasible routes use the full route details instead, like Gale-site routes.
function renderGeoPanel() {
  const result = geo.result;
  const valid = window.CLHM_GEO_ROUTE.validResult(result);
  $("#geoRoutePanel").hidden = !(state.active === "custom" && (geo.calculating || geo.error || (result && !valid)));
  $("#geoRouteTitle").textContent = geo.calculating ? "Calculating terrain route…" :
    valid ? "Terrain route ready" : (geo.error || result) ? "Route unavailable" : "Choose two map points";
  $("#geoRouteStatus").textContent = geo.calculating ? "The Mars terrain model is searching for a path." :
    geo.error || result?.status || "Pick start and destination on the map to calculate a route.";
  $("#geoDistance").textContent = valid ? (result.metrics.distance_m / 1000).toFixed(2) : "—";
  $("#geoTime").textContent = valid ? Math.round(result.metrics.estimated_time_min) : "—";
  $("#geoOxygen").textContent = valid ? result.metrics.o2_consumption_kg.toFixed(3) : "—";
  $("#geoDose").textContent = valid ? result.metrics.radiation_dose_msv.toFixed(3) : "—";
  const maxSlope = valid ? result.path.reduce((max, point) => Math.max(max, point.slope_deg), 0).toFixed(1) : null;
  $("#geoRouteDetail").textContent = valid
    ? `${result.path.length} DEM waypoints · maximum sampled slope ${maxSlope}°. This modeled path is not validated for EVA navigation or safety.`
    : "The terrain model may reject a route when slopes or coverage prevent a safe path under its rules.";
  $("#routeSourceNote").textContent = valid
    ? "This route and its metrics come from the terrain model. Weather is not included. The path is not validated for real navigation or safety."
    : "Pick two points on the map for a terrain-model route. No route metrics are shown until the service returns a feasible path.";
  if (backend.mode !== "demo") $("#sourceSummary").textContent = valid ? "Geographic imagery · terrain-model route" : "Geographic imagery · route pending";
}

// Gale planner sites on the geographic map, styled like the planner map; clicks reuse chooseSite().
function drawGeoSites(project, width, height) {
  const group = $("#geoSites");
  group.replaceChildren();
  const origin = $("#startSelect").value, destination = $("#endSelect").value;
  const networkActive = state.active === "network";
  // Labels are placed greedily (route endpoints first) and skipped when they would overlap another label.
  const placed = [];
  const fits = (box) => !placed.some((other) => box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1);
  const ordered = [...sites].sort((a, b) => Number([origin, destination].includes(b.id)) - Number([origin, destination].includes(a.id)));
  for (const site of ordered) {
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
    const pixel = project(site);
    if (pixel.x < -40 || pixel.y < -40 || pixel.x > width + 40 || pixel.y > height + 40) continue;
    const endpoint = networkActive && (site.id === origin || site.id === destination);
    const science = site.type.toLowerCase().includes("science");
    const marker = svg("g", {
      class: `geo-site${endpoint ? " endpoint" : ""}${networkActive && site.id === origin ? " origin" : ""}`,
      tabindex: "0", role: "button", "aria-label": `${site.name}: ${geo.picking ? "use as custom point" : "choose as destination"}`,
    });
    marker.append(svg("circle", { cx: pixel.x, cy: pixel.y, r: endpoint ? 11 : 7, class: "site-ring" }));
    marker.append(svg("circle", { cx: pixel.x, cy: pixel.y, r: endpoint ? 6 : 4.5, class: "site-dot" }));
    const label = svg("text", { x: pixel.x + 11, y: pixel.y - 9, class: endpoint ? "" : "secondary" });
    label.textContent = site.name;
    const box = { x1: pixel.x + 9, y1: pixel.y - 21, x2: pixel.x + 13 + site.name.length * 6.2, y2: pixel.y - 5 };
    if ((endpoint || science || backend.map.getState().zoom >= 11) && fits(box)) {
      marker.append(label);
      placed.push(box);
    }
    const title = svg("title");
    title.textContent = `${site.name} · ${site.type} · ${site.elevation.toLocaleString("en-US")} m`;
    marker.append(title);
    marker.addEventListener("click", (event) => { event.stopPropagation(); chooseSite(site); });
    marker.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseSite(site); }
    });
    group.append(marker);
  }
}

function drawGeoRoute() {
  const overlay = $("#geoRouteOverlay");
  if (backend.mode === "demo" || !backend.map) return;
  const width = $("#liveMap").clientWidth, height = $("#liveMap").clientHeight;
  if (!width || !height) return;
  overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const project = (point) => backend.map.project(point);
  const customValid = window.CLHM_GEO_ROUTE.validResult(geo.result);
  const network = state.active === "network" ? state.routes.find((item) => item.id === state.selected) : null;
  // Active route: the two-point A* path, or the chained A* paths of the selected Gale-site route.
  const path = state.active === "custom" ? (customValid ? geo.result.path : [])
    : network && networkData ? RD.networkRouteGeometry(network, networkData.segments, siteById).geoPath : [];
  overlay.classList.toggle("network-route", state.active === "network");
  const pointString = (points) => points.map((point, index) => {
    const pixel = project(point);
    return `${index ? "L" : "M"}${pixel.x.toFixed(1)} ${pixel.y.toFixed(1)}`;
  }).join(" ");
  $("#geoRoutePath").setAttribute("d", pointString(path));
  const customJourney = journey.active && state.active === "custom" && geo.stages.length;
  const progressIndex = customJourney
    ? journey.index >= geo.stages.length ? path.length - 1 : geo.stages[journey.index].startIndex : 0;
  // Outside the guided journey the whole route is highlighted; during it, only the part already covered.
  $("#geoRouteActivePath").setAttribute("d", pointString(path.slice(0, (customJourney ? progressIndex : path.length - 1) + 1)));
  drawGeoSites(project, width, height);
  const networkProgress = journey.active && network ? siteById[network.nodes[Math.min(journey.index, network.nodes.length - 1)]] : null;
  // The markers show the points the user picked (the route snaps to the DEM grid, so the path ends may differ slightly).
  const shelter = geoShelterMode();
  const customPath = customValid ? geo.result.path : [];
  for (const [selector, label, point] of [["#geoStartMarker", "#geoStartText", geo.start || customPath[0]],
    ["#geoEndMarker", "#geoEndText", shelter ? customPath.at(-1) : (geo.end || customPath.at(-1))],
    ["#geoProgressMarker", null, customJourney && path.length ? path[progressIndex] : networkProgress]]) {
    const marker = $(selector), text = label ? $(label) : null;
    marker.style.display = point ? "" : "none";
    if (text) text.style.display = point ? "" : "none";
    if (point) {
      const pixel = project(point);
      marker.setAttribute("cx", pixel.x); marker.setAttribute("cy", pixel.y);
      if (text) { text.setAttribute("x", pixel.x); text.setAttribute("y", pixel.y); }
    }
  }
}

function selectGeoPoint(point) {
  if (!geo.picking) { if (backend.mode !== "demo") inspectRealTerrain(point); return; }
  resetGeoRoute();
  geo[geo.picking] = { lat: Number(point.lat.toFixed(6)), lon: Number(point.lon.toFixed(6)) };
  advanceGeoPicking();
  // Picking custom points makes the two-point route the active one; until it exists the details wait for it.
  state.active = "custom";
  updateGeoControls();
  renderRoute();
  if (!(geo.start && (geo.end || geoShelterMode()))) {
    renderEmptyDetails("Choose the destination (B)", "Click the map or a site to set the destination of the custom route.");
  }
  scheduleGeoRoute();
}

// openSheet: true only for an explicit "Find geographic route" press. Automatic recalculation after a
// map pick must not open the sliding sheet, because its scrim would cover the map while picking.
async function calculateGeoRoute({ openSheet = false } = {}) {
  clearTimeout(geoRouteTimer);
  if (!backend.client || !geo.start) { toast("Pick a start point on the map."); return; }
  const mode = $("#geoMobility").value;
  if (mode !== "shelter" && !geo.end) { toast("Pick a destination on the map."); return; }
  stopJourney();
  state.active = "custom";
  const request = ++geo.request;
  geo.result = null;
  geo.stages = [];
  geo.error = "";
  geo.calculating = true;
  updateGeoControls();
  renderRoute();
  renderEmptyDetails("Calculating terrain route…", "The Mars terrain model is searching for a path.");
  if (openSheet) openMissionSheet("route");
  try {
    const payload = { start: geo.start, rover_support: mode === "rover", solar_storm: mode === "shelter" };
    if (mode !== "shelter") payload.end = geo.end;
    const result = await backend.client.route(payload);
    if (request !== geo.request) return;
    if (window.CLHM_GEO_ROUTE.validResult(result)) {
      geo.result = result;
      geo.stages = window.CLHM_GEO_ROUTE.buildStages(result);
    } else {
      geo.result = result;
      geo.error = result?.feasible && result?.path?.length < 2 ? "Choose points farther apart so the terrain model can draw a route." :
        result?.feasible ? "The route service returned an incomplete path." : result?.status || "No route is available for those points.";
    }
  } catch (error) {
    if (request !== geo.request) return;
    geo.error = error.name === "AbortError" ? "The route search timed out. Try closer points." :
      error instanceof TypeError ? "Could not reach the route service. Try again shortly." : error.message;
  } finally {
    if (request === geo.request) {
      geo.calculating = false;
      updateGeoControls();
      renderRoute();
      if (!window.CLHM_GEO_ROUTE.validResult(geo.result)) {
        renderEmptyDetails("Route unavailable", geo.error || "No route is available for those points.");
      }
    }
  }
}

// The guided journey follows the active route, in any map mode.
function currentJourneyRoute() {
  if (state.active === "custom") {
    return window.CLHM_GEO_ROUTE.validResult(geo.result) ? { kind: "geo", stages: geo.stages, path: geo.result.path } : null;
  }
  return state.routes.find((route) => route.id === state.selected) || null;
}

function currentJourneyGuide(route) {
  return route.kind === "geo" ? window.CLHM_GEO_ROUTE.describeStage(route, journey.index) :
    window.CLHM_JOURNEY_GUIDE.describe(route, siteById, journey.index);
}

function cancelJourneySpeech() {
  journey.speechRun += 1;
  clearTimeout(journey.startTimer);
  journey.startTimer = null;
  clearTimeout(journey.autoTimer);
  journey.autoTimer = null;
  journey.completedSpeech = false;
  if (journey.utterance && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
  }
  journey.utterance = null;
  journey.utterances = null;
  $("#voiceDialog").classList.remove("speaking");
  $("#voicePlaybackStatus").textContent = "Ready to speak";
}

function renderJourney() {
  const route = currentJourneyRoute();
  if (!journey.active || !route) return;
  const guide = currentJourneyGuide(route);
  $("#earthNotice").dataset.tone = guide.tone;
  $("#journeyProgress").textContent = guide.progress;
  $("#journeyTitle").textContent = guide.title;
  $("#journeyMessage").textContent = guide.message;
  $("#journeyModeNote").textContent = route.kind === "geo" ? "Terrain-model walkthrough · no live tracking" : "Terrain-model route · advance manually";
  $("#journeyNextButton").textContent = guide.done ? "Finish journey" : route.kind === "geo" ? "Next section" : "Next leg";
  $("#voiceTitle").textContent = guide.done ? "Route reviewed" : "Here with you";
  $("#voiceCaption").textContent = guide.message;
  const sectionCount = Math.max(1, route.kind === "geo" ? route.stages.length : route.segments.length);
  const currentSection = Math.min(sectionCount, journey.index + 1);
  $("#voiceStep").textContent = guide.progress;
  $("#voiceStepTrack").setAttribute("aria-valuemax", String(sectionCount));
  $("#voiceStepTrack").setAttribute("aria-valuenow", String(currentSection));
  $("#voiceStepTrack").setAttribute("aria-valuetext", guide.progress);
  $("#voiceStepFill").style.width = `${currentSection / sectionCount * 100}%`;
  $("#voiceNextButton").textContent = guide.done ? "Finish" : "Next";
  $("#voiceNextButton").setAttribute("aria-label", guide.done ? "Finish guided journey" : "Next route section");
  drawGeoRoute();
}

function stopJourney() {
  if (!journey.active) return;
  journey.active = false;
  journey.index = 0;
  if ($("#voiceDialog").open) $("#voiceDialog").close();
  cancelJourneySpeech();
  document.body.classList.remove("journey-active");
  $("#earthNotice").hidden = true;
  $("#startJourneyButton").setAttribute("aria-pressed", "false");
  $("#startJourneyButton span").textContent = "Start guided journey";
  drawGeoRoute();
}

function startJourney() {
  if (journey.active) { stopJourney(); return; }
  if (!currentJourneyRoute()) { toast("Choose a modeled route before starting guidance."); return; }
  journey.active = true;
  journey.index = 0;
  document.body.classList.add("journey-active");
  $("#earthNotice").hidden = false;
  $("#startJourneyButton").setAttribute("aria-pressed", "true");
  $("#startJourneyButton span").textContent = "End guided journey";
  renderJourney();
}

function waitForEnglishVoices(synth, timeoutMs = 2800) {
  const available = window.CLHM_VOICE.englishVoices(synth.getVoices());
  if (available.length) return Promise.resolve(available);
  return new Promise((resolve) => {
    let timer;
    const changed = () => {
      const voices = window.CLHM_VOICE.englishVoices(synth.getVoices());
      if (!voices.length) return;
      clearTimeout(timer);
      synth.removeEventListener?.("voiceschanged", changed);
      resolve(voices);
    };
    timer = setTimeout(() => {
      synth.removeEventListener?.("voiceschanged", changed);
      resolve(window.CLHM_VOICE.englishVoices(synth.getVoices()));
    }, timeoutMs);
    synth.addEventListener?.("voiceschanged", changed);
    changed();
  });
}

async function speakJourney(welcome = false) {
  cancelJourneySpeech();
  const run = journey.speechRun;
  const supported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  $("#voiceFallback").hidden = true;
  $("#voiceReplayButton").disabled = !supported;
  if (!supported) {
    $("#voicePlaybackStatus").textContent = "Voice unavailable";
    $("#voiceFallback").textContent = "Voice is unavailable in this browser. You can still read each message here.";
    return;
  }
  if (!journey.active) return;
  const route = currentJourneyRoute();
  if (!route) return;
  const guide = currentJourneyGuide(route);
  const synth = window.speechSynthesis;
  let voices = window.CLHM_VOICE.englishVoices(synth.getVoices());
  if (!voices.length) {
    $("#voicePlaybackStatus").textContent = "Finding English voice…";
    voices = await waitForEnglishVoices(synth);
  }
  if (run !== journey.speechRun || !$("#voiceDialog").open) return;
  const englishVoice = window.CLHM_VOICE.chooseEnglishVoice(voices);
  if (!englishVoice) {
    $("#voicePlaybackStatus").textContent = "English voice unavailable";
    $("#voiceFallback").textContent = "Add an English voice in your browser or device settings, then choose Replay voice. Directions remain on screen.";
    $("#voiceFallback").hidden = false;
    return;
  }
  const narration = welcome ? window.CLHM_VOICE.openingGuidance(guide.speech) : guide.speech;
  const chunks = window.CLHM_VOICE.speechChunks(window.CLHM_VOICE.prepareSpeech(narration));
  if (!chunks.length) return;
  const { rate, pitch } = window.CLHM_VOICE.speechSettings(englishVoice);
  // One utterance per sentence group, queued together; pause/resume/cancel act on the whole queue.
  const utterances = chunks.map((text) => {
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = englishVoice.lang;
    u.voice = englishVoice;
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1;
    return u;
  });
  const utterance = utterances[0];
  const lastUtterance = utterances[utterances.length - 1];
  let failed = false;
  const speaking = (event) => {
    if (run !== journey.speechRun || !$("#voiceDialog").open) return;
    if (event?.target) journey.utterance = event.target;
    clearTimeout(journey.startTimer);
    journey.startTimer = null;
    if (!journey.auto && synth.pause) {
      synth.pause();
      $("#voiceDialog").classList.remove("speaking");
      $("#voicePlaybackStatus").textContent = "Paused";
      return;
    }
    $("#voiceDialog").classList.add("speaking");
    $("#voicePlaybackStatus").textContent = welcome ? "Welcoming you · speaking directions" : "Speaking directions";
    $("#voiceFallback").hidden = true;
  };
  const finished = () => {
    if (run !== journey.speechRun || failed) return;
    clearTimeout(journey.startTimer);
    journey.startTimer = null;
    journey.utterance = null;
    journey.utterances = null;
    journey.completedSpeech = true;
    $("#voiceDialog").classList.remove("speaking");
    $("#voicePlaybackStatus").textContent = "Directions finished";
    if (journey.auto && journey.active && $("#voiceDialog").open && !guide.done) {
      journey.autoTimer = setTimeout(nextJourneyLeg, 1200);
    }
  };
  const failedToPlay = () => {
    if (run !== journey.speechRun || failed) return;
    failed = true;
    clearTimeout(journey.startTimer);
    journey.startTimer = null;
    journey.utterance = null;
    journey.utterances = null;
    try { synth.cancel(); } catch { /* nothing queued */ }
    $("#voiceDialog").classList.remove("speaking");
    $("#voicePlaybackStatus").textContent = "Voice could not play";
    $("#voiceFallback").textContent = "Check your device sound, then choose Replay voice.";
    $("#voiceFallback").hidden = false;
  };
  for (const u of utterances) {
    u.onstart = speaking;
    u.onboundary = speaking;
    u.onerror = failedToPlay;
  }
  lastUtterance.onend = finished;
  journey.utterance = utterance;
  // Keep references: Safari drops queued utterances that are garbage-collected and never fires onend.
  journey.utterances = utterances;
  $("#voicePlaybackStatus").textContent = "Preparing voice…";
  journey.startTimer = setTimeout(() => {
    if (run !== journey.speechRun || !$("#voiceDialog").open || $("#voiceDialog").classList.contains("speaking")) return;
    $("#voicePlaybackStatus").textContent = "Voice did not start";
    $("#voiceFallback").textContent = "Check your browser sound settings, then choose Replay voice.";
    $("#voiceFallback").hidden = false;
  }, 3000);
  try { for (const u of utterances) synth.speak(u); } catch {
    clearTimeout(journey.startTimer);
    journey.startTimer = null;
    journey.utterance = null;
    $("#voicePlaybackStatus").textContent = "Voice could not play";
    $("#voiceFallback").textContent = "Check your device sound, then choose Replay voice.";
    $("#voiceFallback").hidden = false;
  }
}

function showVoiceJourney() {
  if (!journey.active) return;
  journey.auto = true;
  $("#voiceAutoButton").setAttribute("aria-pressed", "true");
  $("#voiceAutoButton").textContent = "Pause";
  $("#voiceAutoButton").setAttribute("aria-label", "Pause automatic guidance");
  $("#voiceDialog").showModal();
  speakJourney(true);
}

function openCompanion() {
  if (!journey.active) startJourney();
  if (journey.active) showVoiceJourney();
  else if (backend.mode !== "demo") setPlannerDrawer(true);
}

function nextJourneyLeg() {
  if (!journey.active) return;
  const route = currentJourneyRoute();
  const count = route?.kind === "geo" ? route.stages.length : route?.segments.length;
  if (!route || journey.index >= count) { stopJourney(); return; }
  journey.index += 1;
  renderJourney();
  if ($("#voiceDialog").open) speakJourney();
}

function toggleVoiceAuto() {
  journey.auto = !journey.auto;
  $("#voiceAutoButton").setAttribute("aria-pressed", String(journey.auto));
  $("#voiceAutoButton").textContent = journey.auto ? "Pause" : "Resume";
  $("#voiceAutoButton").setAttribute("aria-label", journey.auto ? "Pause automatic guidance" : "Resume automatic guidance");
  const synth = window.speechSynthesis;
  if (!journey.auto) {
    clearTimeout(journey.autoTimer);
    journey.autoTimer = null;
    if (journey.utterance && synth?.pause) {
      synth.pause();
      $("#voiceDialog").classList.remove("speaking");
      $("#voicePlaybackStatus").textContent = "Paused";
    }
  } else if (journey.utterance && synth?.paused && synth.resume) {
    synth.resume();
    $("#voiceDialog").classList.add("speaking");
    $("#voicePlaybackStatus").textContent = "Speaking directions";
  } else if (!journey.utterance && journey.completedSpeech && $("#voiceDialog").open && journey.active) {
    const route = currentJourneyRoute();
    if (route && !currentJourneyGuide(route).done) journey.autoTimer = setTimeout(nextJourneyLeg, 1200);
  }
}

function updateLayers() {
  $(".contours").classList.toggle("hidden-network", !state.layers.topography);
  $("#mapStage").classList.toggle("show-risk", state.layers.risk);
  $("#mapStage").classList.toggle("show-science", state.layers.science);
  document.querySelectorAll("[data-layer]").forEach((button) => {
    const active = state.layers[button.dataset.layer];
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function toggleEmergency() {
  state.emergency = !state.emergency;
  const button = $("#emergencyButton");
  button.classList.toggle("active", state.emergency);
  button.setAttribute("aria-pressed", String(state.emergency));
  button.querySelector("span:nth-child(2)").textContent = state.emergency ? "End solar alert" : "Simulate solar alert";
  $("#endSelect").disabled = state.emergency;
  $("#conditionName").textContent = state.emergency ? "Solar scenario · modeled" : "USGS terrain data";
  $("#conditionDetail").textContent = state.emergency ? "Shelter route" : "Route estimates";
  $("#mapStage").classList.toggle("emergency", state.emergency);
  if (state.emergency) {
    state.previousDestination = $("#endSelect").value;
    toast("Modeled solar alert: finding a route to shelter.");
  } else {
    $("#endSelect").value = state.previousDestination;
  }
  updateLayers();
  loadRoutes();
}

function inspectSite() {
  const site = siteById[$("#endSelect").value];
  if (!site) return;
  $("#siteDialogTitle").textContent = site.name;
  $("#siteDialogType").textContent = site.type;
  $("#siteDialogElevation").textContent = `${site.elevation.toLocaleString("en-US")} m`;
  $("#siteDialogNote").textContent = site.note;
  $("#siteDialogSource").textContent = site.source;
  $("#siteDialog").showModal();
}

function exportPlan() {
  if (state.active === "custom") {
    if (!window.CLHM_GEO_ROUTE.validResult(geo.result)) { toast("Calculate a two-point route before exporting."); return; }
    downloadPlan({ notice: "Terrain-model route. Not validated for real navigation or safety.",
      source: "CLHM backend /api/route", mode: $("#geoMobility").value,
      start: geo.start, destination: geo.result.path.at(-1), metrics: geo.result.metrics,
      path: geo.result.path }, "clhm-geographic-route.json");
    return;
  }
  const route = state.routes.find((item) => item.id === state.selected);
  if (!route) return;
  const data = {
    notice: "NASA/USGS-derived terrain network. Model estimates; not validated for navigation or safety.",
    source: "CLHM /api/network",
    region: networkData.area_of_interest,
    solar_alert: state.emergency,
    start: siteName(route.nodes[0]), destination: siteName(route.nodes.at(-1)),
    route: route.label, distance_km: route.distance_km, duration_min: route.duration_min,
    modeled_oxygen_kg: route.oxygen_kg, modeled_dose_msv: route.dose_msv,
    risk_0_100: route.risk, max_slope_deg: route.max_slope_deg,
    sites: route.nodes.map(siteName), segments: route.segments,
  };
  downloadPlan(data, `clhm-route-${route.nodes[0]}-${route.nodes.at(-1)}.json`);
}

function downloadPlan(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Plan exported as JSON.");
}

function showMapMode(mode) {
  if (mode !== "demo" && !backend.client) return;
  if (mode !== "demo" && !backend.client.layers[mode]) mode = "satellite";
  if ((backend.mode === "demo") !== (mode === "demo")) stopJourney();
  const enteringGeo = backend.mode === "demo" && mode !== "demo";
  backend.mode = mode;
  $("#mapMode").value = mode;
  const source = {
    demo: ["Gale terrain network", "Map: stylized view of georeferenced Gale sites and terrain-model route segments. Background contours are decorative; site positions and route metrics come from NASA/USGS-derived data."],
    satellite_color: ["NASA imagery · approximate color", "Map: grayscale CTX/HiRISE detail tinted with approximate Viking color. This is not a local color measurement."],
    satellite: ["NASA orbital imagery · grayscale", "Map: NASA Mars Trek orbital tiles (Viking, CTX, and HiRISE, depending on coverage and zoom)."],
    relief: ["NASA relief · MOLA", "Map: MOLA relief served by NASA Mars Trek. It does not show small obstacles."],
    themis_night: ["THEMIS · night infrared", "Map: NASA Mars Odyssey THEMIS nighttime infrared brightness (~100 m/native pixel). Darker tones often indicate surfaces that cool faster, such as dust or fine sand; brighter tones can indicate heat-retaining material such as rock. This is a qualitative clue, not a calibrated temperature or traversability measurement."],
  }[mode];
  $("#sourceSummary").textContent = `${source[0]} · terrain-model routes`;
  $("#mapSource").textContent = source[1];
  const live = mode !== "demo";
  document.body.classList.toggle("geographic-mode", live);
  // Route details, profile, Gale sites and custom points are available in every map mode.
  $("#plannerIntro").textContent = "Plan across Gale Crater: choose Gale sites or two points on any map.";
  $("#plannerSafetyNote").lastChild.textContent = " Terrain-model estimates. No live position or safety monitoring.";
  $("#mapStage").classList.toggle("live", live);
  $("#liveMap").hidden = !live;
  // SVG elements have no .hidden property, so the attribute must be toggled explicitly.
  $("#geoRouteOverlay").toggleAttribute("hidden", !live);
  $("#thermalLegend").hidden = mode !== "themis_night";
  $(".layer-controls").hidden = live;
  $("#mapSubtitle").textContent = mode === "satellite_color" ? "CTX/HiRISE detail · approximate Viking color" :
    mode === "satellite" ? "NASA Mars Trek mosaic · grayscale" :
      mode === "relief" ? "MOLA relief · georeferenced" :
        mode === "themis_night" ? "THEMIS · nighttime infrared brightness" : `Gale terrain network · ${sites.length} sites`;

  if (live) {
    if (!backend.map) {
      backend.map = window.ARES_BACKEND.createTileMap({
        viewport: $("#liveMap"), baseLayer: $("#liveTileBase"), slopeLayer: $("#liveTileSlope"),
        loading: $("#liveMapLoading"),
        onCoordinate: (point, zoom) => {
          $("#mapCoordinate").textContent = `${Math.abs(point.lat).toFixed(3)}° ${point.lat < 0 ? "S" : "N"} / ${Math.abs(point.lon).toFixed(3)}° ${point.lon < 0 ? "W" : "E"} · Z${zoom}`;
          if (backend.mode !== "demo") updateGeoScale(zoom, point.lat);
        },
        onPoint: selectGeoPoint,
        onViewChange: drawGeoRoute,
      });
    }
    if (backend.map.getState().client === backend.client) backend.map.setMode(mode);
    else backend.map.setSource(backend.client, mode);
    // Coming from the planner map, frame the active route (or all Gale sites) instead of the zone center.
    if (enteringGeo) {
      const bounds = activeRouteBounds();
      if (bounds) backend.map.fitBounds(bounds);
    }
    backend.map.setOverlay(overlayId);
    $("#terrainReadout").textContent = "Click to inspect slope and elevation";
    // Read the terrain at the center of what is on screen (after framing the route), not the zone center.
    inspectRealTerrain(backend.map.getState().center || backend.client.zone.center);
  } else {
    $("#mapCoordinate").textContent = "GALE CRATER · TERRAIN MODEL";
    updateNetworkScale();
    $("#routeSourceNote").textContent = "Site coordinates and segment routes are from the Gale terrain network. The habitat and shelters are modeled; route metrics are estimates, not validated safety data.";
  }
  updatePlannerOverlay();
  advanceGeoPicking();
  updateGeoControls();
  renderRoute();
  if (state.active === "custom" && !window.CLHM_GEO_ROUTE.validResult(geo.result)) {
    renderEmptyDetails(geo.calculating ? "Calculating terrain route…" : geo.error ? "Route unavailable" : "Choose the destination (B)",
      geo.calculating ? "The Mars terrain model is searching for a path." : geo.error || "Click the map or a site to set the destination.");
  }
}

async function inspectRealTerrain({ lat, lon }) {
  if (!backend.client) return;
  const readout = $("#terrainReadout");
  readout.textContent = "Checking terrain…";
  try {
    const point = await backend.client.point(lat.toFixed(6), lon.toFixed(6));
    const hazard = { ok: "traversable in DEM", no_rover: "not suitable for rover", no_go: "critical slope" }[point.class] || point.class;
    const dose = Number.isFinite(point.dose_rate_msv_day) ? ` · ~${point.dose_rate_msv_day.toFixed(2)} mSv/day (model)` : "";
    readout.textContent = `${point.elevation_m.toFixed(0)} m · ${point.slope_deg.toFixed(1)}° · ${hazard}${dose} (DEM ~${point.resolution_m} m/px)`;
  } catch (error) {
    readout.textContent = error.message.includes("404") ? "Site outside DEM coverage." : "Could not inspect terrain.";
  }
}

let networkRequest = 0;
async function loadNetwork(client) {
  const request = ++networkRequest;
  const loading = $("#networkLoading");
  loading.hidden = false;
  $("#networkLoadingText").textContent = "Loading real Gale network…";
  $("#networkRetry").hidden = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${client.baseUrl}/api/network`, {
      headers: { Accept: "application/json" }, credentials: "omit", signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Gale network unavailable (${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data?.demo?.sites) || data.demo.sites.length < 2 ||
        !Array.isArray(data?.demo?.segments) || !Array.isArray(data?.segments) ||
        data.segments.some((segment) => !Number.isFinite(segment?.foot?.distance_m) ||
          !Number.isFinite(segment?.foot?.estimated_time_min) ||
          !Number.isFinite(segment?.foot?.o2_consumption_kg) ||
          !Number.isFinite(segment?.foot?.radiation_dose_msv))) {
      throw new Error("The Gale network response is incomplete.");
    }
    if (request !== networkRequest) return false;
    networkData = data;
    const metadata = Object.fromEntries(data.sites.map((site) => [site.id, site]));
    sites = data.demo.sites.map(([id, name, type, x, y, elevation, note]) =>
      ({ id, name, type, x, y, elevation, note, source: metadata[id]?.source || "Terrain model", lat: metadata[id]?.lat, lon: metadata[id]?.lon }));
    siteById = Object.fromEntries(sites.map((site) => [site.id, site]));
    engine = window.ARES_ROUTE_ENGINE.createEngine(data.demo, data);
    populateSites();
    renderNetwork();
    updateLayers();
    loadRoutes();
    updateGeoControls();
    updateNetworkScale();
    $("#inspectButton").disabled = false;
    loading.hidden = true;
    if (backend.mode === "demo") showMapMode("demo");
    return true;
  } catch (error) {
    if (request !== networkRequest) return false;
    networkData = null; engine = null; state.routes = [];
    $("#planButton").disabled = true;
    $("#startJourneyButton").disabled = true;
    $("#exportButton").disabled = true;
    $("#inspectButton").disabled = true;
    $("#networkLoadingText").textContent = error.name === "AbortError" ? "Gale network timed out." : error.message;
    $("#networkRetry").hidden = false;
    $("#mapSubtitle").textContent = "Gale network unavailable";
    $("#mapHint").textContent = "Could not load Gale routes. Retry data.";
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function connectBackend(input, silent = false) {
  const request = ++backend.request;
  const loading = $("#liveMapLoading");
  loading.hidden = false;
  $("#liveMapLoadingText").textContent = "Connecting to Mars data…";
  $("#mapFallback").hidden = true;
  try {
    const client = await window.ARES_BACKEND.connect(input, location.protocol);
    if (request !== backend.request) return;
    backend.client = client;
    loadRadiationFromApi(client);
    geo.start = null; geo.end = null; geo.result = null; geo.stages = []; geo.error = ""; geo.picking = null; geo.request += 1; geo.calculating = false;
    for (const mode of ["satellite_color", "themis_night"]) {
      const option = $(`#mapMode option[value="${mode}"]`);
      option.hidden = !client.layers[mode];
      option.disabled = !client.layers[mode];
    }
    $("#mapMode").disabled = false;
    setOverlay(overlayId);
    const loaded = await loadNetwork(client);
    if (!silent && loaded) toast("Gale routes ready.");
  } catch (error) {
    if (request !== backend.request) return;
    const message = error.name === "AbortError" ? "The Mars service took too long." :
      error instanceof TypeError ? "Could not reach the Mars service." : error.message;
    geo.error = message;
    renderGeoPanel();
    updateGeoControls();
    $("#liveMapLoadingText").textContent = `${message} Try again.`;
    $("#mapFallback").hidden = false;
    $("#mapSubtitle").textContent = "Map unavailable";
    $("#mapHint").textContent = "Map unavailable. Use Retry map to reconnect.";
    $("#networkLoadingText").textContent = message;
    $("#networkRetry").hidden = false;
    if (!silent) toast(message);
  }
}

function autoConnectBackend() {
  const query = new URLSearchParams(location.search).get("api");
  const candidate = query || window.ARES_CONFIG?.backendUrl || "https://api.clhm.study";
  connectBackend(candidate, true);
}

function bindControls() {
  $("#plannerToggle").addEventListener("click", () => setPlannerDrawer($("#plannerDrawer").dataset.open !== "true"));
  $("#plannerCloseButton").addEventListener("click", () => setPlannerDrawer(false));
  $("#plannerScrim").addEventListener("click", () => setPlannerDrawer(false));
  plannerBreakpoint.addEventListener("change", (event) => setPlannerDrawer(!event.matches && !document.body.classList.contains("sheet-open")));
  $("#plannerDrawer").addEventListener("transitionend", (event) => { if (event.target === $("#plannerDrawer")) { backend.map?.render(); updateNetworkScale(); } });
  window.addEventListener("resize", updateNetworkScale);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#plannerDrawer").dataset.open === "true" &&
      !document.body.classList.contains("sheet-open") && !event.target.closest("dialog[open]")) setPlannerDrawer(false);
  });
  $("#planButton").addEventListener("click", () => {
    // Recalculates the active route: the two-point route when custom points are in use, else the Gale-site route.
    if (state.active === "custom" && geo.start && (geo.end || geoShelterMode())) calculateGeoRoute({ openSheet: true });
    else { loadRoutes(); openMissionSheet("route"); }
  });
  $("#sheetLauncher").addEventListener("click", () => openMissionSheet("route"));
  $("#sheetClose").addEventListener("click", closeMissionSheet);
  $("#sheetScrim").addEventListener("click", closeMissionSheet);
  for (const name of ["route", "profile", "sources"]) {
    const key = name[0].toUpperCase() + name.slice(1);
    $(`#sheetTab${key}`).addEventListener("click", () => selectSheetTab(name));
  }
  $("#missionSheet").addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeMissionSheet(); }
    if (event.key === "Tab") {
      const focusable = [...$("#missionSheet").querySelectorAll("button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), summary")]
        .filter((item) => !item.closest("[hidden]") && item.getClientRects().length);
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
      return;
    }
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || event.target.getAttribute("role") !== "tab") return;
    event.preventDefault();
    const names = ["route", "profile", "sources"];
    const current = names.findIndex((name) => $(`#sheetTab${name[0].toUpperCase() + name.slice(1)}`) === event.target);
    const next = (current + (event.key === "ArrowRight" ? 1 : -1) + names.length) % names.length;
    selectSheetTab(names[next], true);
  });
  $("#startJourneyButton").addEventListener("click", startJourney);
  $("#journeyNextButton").addEventListener("click", nextJourneyLeg);
  $("#journeyEndButton").addEventListener("click", stopJourney);
  $("#voiceButton").addEventListener("click", showVoiceJourney);
  $("#companionLauncher").addEventListener("click", openCompanion);
  $("#voiceNextButton").addEventListener("click", nextJourneyLeg);
  $("#voiceReplayButton").addEventListener("click", () => speakJourney());
  $("#voiceAutoButton").addEventListener("click", toggleVoiceAuto);
  $("#closeVoiceButton").addEventListener("click", () => $("#voiceDialog").close());
  $("#voiceDialog").addEventListener("close", cancelJourneySpeech);
  $("#startSelect").addEventListener("change", loadRoutes);
  $("#endSelect").addEventListener("change", loadRoutes);
  $("#avoidRisk").addEventListener("change", loadRoutes);
  $("#swapButton").addEventListener("click", () => {
    if (state.emergency) { toast("Turn off the alert to change destination."); return; }
    const start = $("#startSelect").value;
    $("#startSelect").value = $("#endSelect").value;
    $("#endSelect").value = start;
    loadRoutes();
  });
  document.querySelectorAll("[data-priority]").forEach((button) => button.addEventListener("click", () => {
    stopJourney();
    state.priority = button.dataset.priority;
    document.querySelectorAll("[data-priority]").forEach((item) => item.classList.toggle("selected", item === button));
    if (!state.emergency) {
      state.active = "network";
      state.selected = state.routes.find((route) => route.id === state.priority)?.id || state.routes[0]?.id;
      renderRoute();
    }
  }));
  document.querySelectorAll("[data-layer]").forEach((button) => button.addEventListener("click", () => {
    state.layers[button.dataset.layer] = !state.layers[button.dataset.layer];
    updateLayers();
  }));
  $("#layersShortcut").addEventListener("click", () => {
    if (backend.mode !== "demo") { setOverlay(overlayId === "slope" ? null : "slope"); return; }
    state.layers.topography = !state.layers.topography;
    updateLayers();
    toast(state.layers.topography ? "Relief visible" : "Relief hidden");
  });
  $("#sitesShortcut").addEventListener("click", () => $("#mapStage").scrollIntoView({ behavior: "smooth", block: "center" }));
  const zoom = (step) => {
    if (backend.mode !== "demo") { backend.map?.zoom(step > 0 ? 1 : -1); return; }
    state.zoom = Math.min(2, Math.max(1, state.zoom + step));
    $("#mapSvg").style.transform = `scale(${state.zoom})`;
    updateNetworkScale();
  };
  $("#zoomIn").addEventListener("click", () => zoom(.2));
  $("#zoomOut").addEventListener("click", () => zoom(-.2));
  $("#zoomReset").addEventListener("click", () => {
    if (backend.mode !== "demo") { backend.map?.reset(); return; }
    state.zoom = 1;
    $("#mapSvg").style.transform = "scale(1)";
    updateNetworkScale();
  });
  $("#mapMode").addEventListener("change", (event) => showMapMode(event.target.value));
  for (const [selector, target] of [["#geoPickStart", "start"], ["#geoPickEnd", "end"]]) {
    $(selector).addEventListener("click", () => {
      geo.picking = geo.picking === target ? null : target;
      updateGeoControls();
      if (geo.picking && plannerBreakpoint.matches) setPlannerDrawer(false);
    });
  }
  $("#geoMobility").addEventListener("change", () => {
    resetGeoRoute();
    advanceGeoPicking();
    updateGeoControls();
    if (geo.start && (geo.end || geoShelterMode())) scheduleGeoRoute();
    else renderRoute();
  });
  $("#geoClear").addEventListener("click", () => {
    resetGeoRoute();
    geo.start = null; geo.end = null;
    advanceGeoPicking();
    // Without custom points the Gale-site route is shown again.
    state.active = "network";
    updateGeoControls();
    renderRoute();
    if (plannerBreakpoint.matches) setPlannerDrawer(false);
  });
  $("#mapSvg").addEventListener("click", onPlannerMapClick);
  // An older backend without /api/terrain/<kind>/area.png: hide the planner overlay instead of showing a broken image.
  $("#mapOverlay").addEventListener("error", () => $("#mapOverlay").setAttribute("visibility", "hidden"));
  $("#mapFallback").addEventListener("click", autoConnectBackend);
  $("#networkRetry").addEventListener("click", () => backend.client ? loadNetwork(backend.client) : autoConnectBackend());
  // Clicking the active overlay again turns it off.
  $("#overlayControls").addEventListener("click", (event) => {
    const button = event.target.closest("[data-overlay]");
    if (!button || button.disabled) return;
    setOverlay(button.dataset.overlay === overlayId ? null : button.dataset.overlay);
  });
  $("#emergencyButton").addEventListener("click", toggleEmergency);
  $("#inspectButton").addEventListener("click", inspectSite);
  $("#closeDialog").addEventListener("click", () => $("#siteDialog").close());
  $("#exportButton").addEventListener("click", exportPlan);
}

bindControls();
setPlannerDrawer(!plannerBreakpoint.matches);
$("#plannerDrawer").dataset.ready = "true";
if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
updateGeoControls();
loadBundledRadiation();
autoConnectBackend();
