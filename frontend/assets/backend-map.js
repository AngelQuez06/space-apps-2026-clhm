(function (root) {
  "use strict";

  const TILE_SIZE = 256;
  // Terrain overlays drawn over any base map: layer id -> path under /api/terrain.
  const OVERLAY_PATHS = { slope: "slope", radiation: "radiation", data_quality: "quality" };

  function normalizeBaseUrl(input, pageProtocol = "http:") {
    const value = String(input || "").trim().replace(/\/+$/, "");
    if (!value) throw new Error("Enter the backend URL.");
    let url;
    try { url = new URL(value); } catch { throw new Error("Enter a full URL, for example https://api.example.com."); }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("The backend must use HTTP or HTTPS.");
    if (url.username || url.password) throw new Error("Do not include credentials in the URL.");
    if (pageProtocol === "https:" && url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      throw new Error("An HTTPS page requires an HTTPS backend.");
    }
    let path = url.pathname.replace(/\/+$/, "");
    if (path.endsWith("/api")) path = path.slice(0, -4);
    return `${url.origin}${path}`;
  }

  function worldPixel(lat, lon, zoom) {
    const scale = 2 ** zoom;
    return {
      x: (lon + 180) / 360 * TILE_SIZE * 2 * scale,
      y: (90 - lat) / 180 * TILE_SIZE * scale,
    };
  }

  function geoFromWorldPixel(x, y, zoom) {
    const scale = 2 ** zoom;
    return {
      lat: 90 - y / (TILE_SIZE * scale) * 180,
      lon: x / (TILE_SIZE * 2 * scale) * 360 - 180,
    };
  }

  function visibleTiles(center, zoom, width, height) {
    const pixel = worldPixel(center.lat, center.lon, zoom);
    const left = pixel.x - width / 2;
    const top = pixel.y - height / 2;
    const columns = 2 ** (zoom + 1);
    const rows = 2 ** zoom;
    const result = [];
    const minX = Math.max(0, Math.floor(left / TILE_SIZE));
    const maxX = Math.min(columns - 1, Math.ceil((left + width) / TILE_SIZE) - 1);
    const minY = Math.max(0, Math.floor(top / TILE_SIZE));
    const maxY = Math.min(rows - 1, Math.ceil((top + height) / TILE_SIZE) - 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        result.push({ x, y, left: Math.round(x * TILE_SIZE - left), top: Math.round(y * TILE_SIZE - top) });
      }
    }
    return result;
  }

  async function fetchJson(url, timeoutMs = 7000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal, credentials: "omit" });
      if (!response.ok) throw new Error(`The backend returned ${response.status}.`);
      if (!(response.headers.get("content-type") || "").includes("json")) throw new Error("The URL did not return API JSON.");
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  async function postJson(url, payload, timeoutMs = 20000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: controller.signal, credentials: "omit",
      });
      if (response.status === 404) throw new Error("The route service is unavailable.");
      if (!response.ok) throw new Error(`The route API returned ${response.status}.`);
      if (!(response.headers.get("content-type") || "").includes("json")) throw new Error("The route API did not return JSON.");
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  async function connect(input, pageProtocol = "http:") {
    const baseUrl = normalizeBaseUrl(input, pageProtocol);
    const [zone, catalog] = await Promise.all([
      fetchJson(`${baseUrl}/api/zone`),
      fetchJson(`${baseUrl}/api/layers`),
    ]);
    if (catalog?.scheme?.crs !== "EPSG:4326" || catalog.scheme.tile_size !== TILE_SIZE ||
      catalog.scheme.z0_tiles?.[0] !== 2 || catalog.scheme.z0_tiles?.[1] !== 1) {
      throw new Error("The backend uses an incompatible tile scheme.");
    }
    if (!Number.isFinite(zone?.center?.lat) || !Number.isFinite(zone?.center?.lon)) {
      throw new Error("The backend did not return a valid geographic center.");
    }
    const layers = Object.fromEntries(catalog.layers.map((layer) => [layer.id, layer]));
    if (!layers.satellite || !layers.relief) throw new Error("The backend does not provide satellite and relief layers.");
    return {
      baseUrl, zone, layers,
      tileUrl(layer, z, x, y) {
        if (OVERLAY_PATHS[layer]) return `${baseUrl}/api/terrain/${OVERLAY_PATHS[layer]}/${z}/${x}/${y}.png`;
        const extension = layers[layer]?.format;
        if (!extension) throw new Error(`Unknown layer: ${layer}`);
        return `${baseUrl}/api/tiles/${layer}/${z}/${x}/${y}.${extension}`;
      },
      point(lat, lon) {
        return fetchJson(`${baseUrl}/api/terrain/point?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
      },
      route(payload) {
        return postJson(`${baseUrl}/api/route`, payload);
      },
    };
  }

  function createTileMap({ viewport, baseLayer, slopeLayer, loading, onCoordinate, onPoint, onViewChange }) {
    const state = { client: null, center: null, zoom: 13, mode: "satellite", overlay: null, dragging: null, loaded: false };
    const tiles = { base: new Map(), slope: new Map() };
    const loadingText = loading.querySelector("#liveMapLoadingText") || loading;
    const fallbackButton = loading.querySelector("#mapFallback");
    let frame = 0;
    let loadTimer = 0;

    function availableZoom() {
      const selected = state.client.layers[state.mode];
      if (!["satellite", "satellite_color"].includes(state.mode) || !Array.isArray(selected.sources)) return selected.max_zoom;
      const matches = selected.sources.map((id) => state.client.layers[id]).filter((layer) => {
        if (!layer) return false;
        if (!Array.isArray(layer.bbox)) return true;
        const [west, south, east, north] = layer.bbox;
        return state.center.lon >= west && state.center.lon <= east && state.center.lat >= south && state.center.lat <= north;
      });
      return matches.length ? Math.max(...matches.map((layer) => layer.max_zoom)) : selected.max_zoom;
    }

    function beginLoading() {
      state.loaded = false;
      loading.hidden = false;
      loadingText.textContent = "Loading map tiles…";
      if (fallbackButton) fallbackButton.hidden = true;
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => {
        if (!state.loaded) {
          loadingText.textContent = "No map tiles arrived. Check the connection or map coverage.";
          if (fallbackButton) fallbackButton.hidden = false;
        }
      }, 12000);
    }

    function clear(group) {
      for (const image of tiles[group].values()) image.remove();
      tiles[group].clear();
    }

    function paint(group, layer, parent, positions) {
      const active = new Set();
      for (const tile of positions) {
        const key = `${layer}/${state.zoom}/${tile.x}/${tile.y}`;
        active.add(key);
        let image = tiles[group].get(key);
        if (!image) {
          image = document.createElement("img");
          image.alt = "";
          image.decoding = "async";
          image.draggable = false;
          image.onload = () => {
            if (tiles[group].get(key) !== image) return;
            if (group === "base") { state.loaded = true; loading.hidden = true; clearTimeout(loadTimer); }
          };
          image.onerror = () => { image.style.visibility = "hidden"; };
          image.src = state.client.tileUrl(layer, state.zoom, tile.x, tile.y);
          parent.append(image);
          tiles[group].set(key, image);
        }
        image.style.left = `${tile.left}px`;
        image.style.top = `${tile.top}px`;
      }
      for (const [key, image] of tiles[group]) {
        if (!active.has(key)) { image.remove(); tiles[group].delete(key); }
      }
    }

    function render() {
      if (!state.client || !state.center || !viewport.clientWidth || !viewport.clientHeight) return;
      const positions = visibleTiles(state.center, state.zoom, viewport.clientWidth, viewport.clientHeight);
      paint("base", state.mode, baseLayer, positions);
      const overlay = state.overlay && state.client.layers[state.overlay];
      if (overlay && state.zoom <= overlay.max_zoom) paint("slope", state.overlay, slopeLayer, positions);
      else clear("slope");
      onCoordinate?.(state.center, state.zoom);
      onViewChange?.();
    }

    function scheduleRender() {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; render(); });
    }

    function setSource(client, mode) {
      state.client = client;
      state.center = { ...client.zone.center };
      state.mode = mode;
      state.zoom = Math.min(["satellite", "satellite_color"].includes(mode) ? 13 : 9, availableZoom());
      beginLoading();
      clear("base");
      clear("slope");
      render();
    }

    function setMode(mode) {
      if (!state.client || !state.client.layers[mode]) return;
      state.mode = mode;
      state.zoom = Math.min(state.zoom, availableZoom());
      beginLoading();
      clear("base");
      render();
    }

    // Draws one terrain overlay ("slope" | "radiation" | "data_quality") over the base map, or none with null.
    function setOverlay(id) {
      const next = id && OVERLAY_PATHS[id] ? id : null;
      if (next === state.overlay) return;
      state.overlay = next;
      clear("slope");
      scheduleRender();
    }
    function setSlope(active) { setOverlay(active ? "slope" : null); }
    function zoom(step) {
      if (!state.client) return;
      const next = Math.max(2, Math.min(availableZoom(), state.zoom + step));
      if (next === state.zoom) return;
      state.zoom = next;
      beginLoading();
      clear("base");
      clear("slope");
      scheduleRender();
    }
    function reset() { if (state.client) setSource(state.client, state.mode); }

    // Centers on a lat/lon box and picks the largest zoom that fits it with `padding` pixels on each side.
    function fitBounds([west, south, east, north], padding = 50) {
      if (!state.client || ![west, south, east, north].every(Number.isFinite)) return;
      const width = Math.max(1, viewport.clientWidth - 2 * padding);
      const height = Math.max(1, viewport.clientHeight - 2 * padding);
      state.center = { lat: (south + north) / 2, lon: (west + east) / 2 };
      let zoom = 2;
      for (let z = availableZoom(); z >= 2; z -= 1) {
        const a = worldPixel(north, west, z), b = worldPixel(south, east, z);
        if (b.x - a.x <= width && b.y - a.y <= height) { zoom = z; break; }
      }
      state.zoom = Math.min(zoom, availableZoom());
      beginLoading();
      clear("base");
      clear("slope");
      render();
    }

    viewport.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button") || event.target.closest(".terrain-readout")) return;
      state.dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, center: worldPixel(state.center.lat, state.center.lon, state.zoom), moved: false };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("dragging");
    });
    viewport.addEventListener("pointermove", (event) => {
      const drag = state.dragging;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      const pixel = { x: drag.center.x - dx, y: drag.center.y - dy };
      state.center = geoFromWorldPixel(pixel.x, pixel.y, state.zoom);
      state.center.lat = Math.max(-89, Math.min(89, state.center.lat));
      state.center.lon = Math.max(-179, Math.min(179, state.center.lon));
      scheduleRender();
    });
    viewport.addEventListener("pointerup", (event) => {
      const drag = state.dragging;
      if (!drag || drag.id !== event.pointerId) return;
      state.dragging = null;
      viewport.classList.remove("dragging");
      if (!drag.moved) {
        const bounds = viewport.getBoundingClientRect();
        const center = worldPixel(state.center.lat, state.center.lon, state.zoom);
        const clicked = geoFromWorldPixel(
          center.x + event.clientX - bounds.left - bounds.width / 2,
          center.y + event.clientY - bounds.top - bounds.height / 2,
          state.zoom,
        );
        onPoint?.(clicked);
      }
    });
    viewport.addEventListener("pointercancel", () => { state.dragging = null; viewport.classList.remove("dragging"); });
    viewport.addEventListener("wheel", (event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1 : -1); }, { passive: false });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(scheduleRender).observe(viewport);

    function project(point) {
      if (!state.center) return null;
      const center = worldPixel(state.center.lat, state.center.lon, state.zoom);
      const pixel = worldPixel(point.lat, point.lon, state.zoom);
      return { x: pixel.x - center.x + viewport.clientWidth / 2, y: pixel.y - center.y + viewport.clientHeight / 2 };
    }

    return { setSource, setMode, setOverlay, setSlope, zoom, reset, render, project, fitBounds, getState: () => ({ ...state }) };
  }

  const api = { normalizeBaseUrl, worldPixel, geoFromWorldPixel, visibleTiles, connect, createTileMap };
  root.ARES_BACKEND = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
