"""Real-data planning network: sites and A* route segments inside the Gale block.

Data is precomputed by scripts/build_network.py into data/network.json. The `demo` key returns the
same tuple shape as frontend/assets/data.js so the planner map can switch sources without a redesign.
"""

import functools
import json
import math
import os

from flask import Blueprint, abort, jsonify

bp = Blueprint("network", __name__)
NETWORK_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "network.json")


@functools.lru_cache(maxsize=1)
def load_network():
    path = os.path.abspath(NETWORK_PATH)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    # Same shape as frontend/assets/data.js:
    # sites: [id, name, type, x, y, elevation_m, note] with x/y in a 1000 x 700 canvas (fit, aspect kept)
    # segments: [from, to, km, risk 0-100, max slope deg, surface]

    # Fit the sites' own extent (not the whole block) so they spread over the canvas, with a margin
    # for labels. Degrees of longitude are scaled by cos(latitude) to keep distances proportional.
    margin = 60
    lons = [site["lon"] for site in data["sites"]]
    lats = [site["lat"] for site in data["sites"]]
    w, e, s, n = min(lons), max(lons), min(lats), max(lats)
    width_km = (e - w) * math.cos(math.radians((s + n) / 2))
    height_km = n - s
    scale = min((1000 - 2 * margin) / width_km, (700 - 2 * margin) / height_km)
    pad_x, pad_y = (1000 - width_km * scale) / 2, (700 - height_km * scale) / 2
    sites = []
    for site in data["sites"]:
        x = pad_x + (site["lon"] - w) * math.cos(math.radians((s + n) / 2)) * scale
        y = pad_y + (n - site["lat"]) * scale
        sites.append([site["id"], site["name"], site["type"], round(x, 1), round(y, 1),
                      round(site["elevation_m"]), site["note"]])
    segments = [[g["from"], g["to"], g["distance_km"], g["risk"], g["max_slope_deg"], g["surface"]]
                for g in data["segments"]]
    data["demo"] = {"sites": sites, "segments": segments,
                    "canvas": {"width": 1000, "height": 700, "margin": margin,
                               "projection": "equirectangular fitted to the sites' extent, aspect kept",
                               "extent": [w, s, e, n]}}
    return data


@bp.get("/network")
def network():
    data = load_network()
    if data is None:
        abort(503, "network not built: run backend/scripts/build_network.py")
    resp = jsonify(data)
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp
