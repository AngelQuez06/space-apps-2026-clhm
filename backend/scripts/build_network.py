"""Build the real-data planning network (sites + route segments) for the planner map.

Replaces the fictional sites/segments of frontend/assets/data.js with:
  * Sites with real coordinates: Curiosity positions by sol (NASA MMGIS traverse), official
    HiRISE DTM target descriptions (HiRISE PDS index), Mars Trek features, and modeled sites
    (habitat and natural shelters) chosen from the terrain model and labeled as modeled.
  * Segments computed with the A* route engine (backend/app/pathfinder.py) over the DEM,
    with distance, time, O2, dose, slope (finest data available along the path), risk and surface.

Output: backend/data/network.json (committed). Run: .venv/bin/python scripts/build_network.py
"""

import io
import csv
import json
import math
import os
import sys
import time

import numpy as np
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from app.pathfinder import find_route  # noqa: E402
from app.terrain import FOOT_LIMIT_DEG, ROVER_LIMIT_DEG, get_terrain  # noqa: E402

OUT = os.path.join(HERE, "..", "data", "network.json")
MMGIS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
HIRISE_INDEX_URL = "https://hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB"
NEIGHBORS = 3  # each site is linked to its 3 nearest sites
MAX_PATH_POINTS = 80
R_MARS = 3396190.0

# Curiosity stops (sol numbers from NASA mission blogs, positions from the MMGIS traverse).
CURIOSITY_SITES = [
    ("bradbury", "Bradbury Landing", "Curiosity landing site", 3,
     "Where Curiosity landed in August 2012 (traverse point at sol 3)."),
    ("boxwork_approach", "Boxwork unit, first approach", "Science target", 4570,
     "End of the first boxwork approach (sols 4534-4570), when the team chose the Altadena drill site."),
    ("boxwork_main", "Main boxwork area", "Science target", 4623,
     "Curiosity working in the main boxwork area (Aug 2025). Boxwork ridges suggest late groundwater flow."),
    ("curiosity_now", "Curiosity latest position", "Rover position", None,
     "Most recent traverse point published by NASA."),
]

# HiRISE DTM products whose official PDS descriptions name science targets (center of each DTM).
HIRISE_SITES = [
    ("dunes", "DTEEC_008147_1750_007356_1750_H01", "Science target"),
    ("canyon", "DTEEC_012340_1750_012195_1750_A01", "Science target"),
    ("fan_alcove", "DTEEC_063319_1745_052242_1745_A01", "Science target"),
    ("south_sulfates", "DTEEC_014186_1745_020410_1745_A01", "Science target"),
    ("east_layers", "DTEEC_008437_1750_008938_1750_U01", "Science target"),
    ("north_mound", "DTEEC_018788_1755_018287_1755_A01", "Science target"),
    ("channel_fan", "DTEEC_009149_1750_009294_1750_U01", "Science target"),
]

# Mars Trek features (feature / mosaic centers from the Trek catalog).
TREK_SITES = [
    ("pahrump", "Pahrump Hills", "Science target", -4.663, 137.3775,
     "Lower Mount Sharp outcrop studied by Curiosity (Mars Trek mosaic center)."),
    ("aeolis_mons", "Aeolis Mons (Mount Sharp)", "Landmark", -5.0834, 137.8453,
     "Central mound of Gale Crater, about 5 km tall (IAU feature center, Mars Trek)."),
    ("old_quadrant", "Original 5x5 km quadrant", "Landmark", -5.40, 137.80,
     "Initial mission quadrant on the steep north flank of Mount Sharp; routes are not possible there with current data."),
]


def find_nearest_cell(t, lat, lon, mask, max_km):
    """Nearest cell (lat, lon) where `mask` is True, within max_km; None if none."""
    rows, cols = mask.shape
    r0, c0 = t.latlon_to_rc(lat, lon) or (None, None)
    if r0 is None:
        return None
    rad = int(max_km * 1000 / t.res_m) + 1
    rs, cs = slice(max(0, r0 - rad), min(rows, r0 + rad + 1)), slice(max(0, c0 - rad), min(cols, c0 + rad + 1))
    sub = mask[rs, cs]
    if not sub.any():
        return None
    rr, cc = np.nonzero(sub)
    rr, cc = rr + rs.start, cc + cs.start
    d = np.hypot((rr - r0) * t.res_m, (cc - c0) * t.res_m * math.cos(math.radians(lat)))
    i = int(np.argmin(d))
    if d[i] > max_km * 1000:
        return None
    return t.rc_to_latlon(int(rr[i]), int(cc[i]))


def ground_km(a, b):
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dl, dp = math.radians(b["lon"] - a["lon"]), p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_MARS * math.asin(math.sqrt(h)) / 1000


def describe_path(t, path):
    """Slope stats with the finest data available at each path point, plus the sand share."""
    slopes, sources, sand = [], set(), 0
    for p in path:
        info = t.at(p["lat"], p["lon"])
        if info:
            slopes.append(info["slope_deg"])
            sources.add(info["resolution_m"])
        if bool(t.sand_ripple[p["row"], p["col"]]):
            sand += 1
    s = np.array(slopes or [0.0])
    over15 = float((s > ROVER_LIMIT_DEG).mean())
    over20 = float((s > FOOT_LIMIT_DEG).mean())
    sand_share = sand / max(1, len(path))
    # Risk 0-100: steepest point (50%), share of path above the rover limit (35%), loose sand (15%).
    risk = 100 * (0.50 * min(1.0, float(s.max()) / 30.0) + 0.35 * min(1.0, over15 * 4) + 0.15 * min(1.0, sand_share * 5))
    mean = float(s.mean())
    surface = "Flat plain" if mean < 5 else "Gentle slope" if mean < 10 else "Slope" if mean < 15 else "Steep slope"
    if sand_share > 0.05:
        surface += " with loose sand"
    return {
        "max_slope_deg": round(float(s.max()), 1), "mean_slope_deg": round(mean, 1),
        "share_over_15_deg": round(over15, 3), "share_over_20_deg": round(over20, 3),
        "sand_share": round(sand_share, 3), "risk": int(round(min(100.0, risk))),
        "surface": surface, "slope_resolutions_m": sorted(sources),
    }


def thin(path):
    if len(path) <= MAX_PATH_POINTS:
        return [[round(p["lat"], 6), round(p["lon"], 6), p["elevation_m"]] for p in path]
    idx = np.linspace(0, len(path) - 1, MAX_PATH_POINTS).round().astype(int)
    return [[round(path[i]["lat"], 6), round(path[i]["lon"], 6), path[i]["elevation_m"]] for i in idx]


def main():
    t0 = time.time()
    t = get_terrain()
    west, south, east, north = t.bbox
    print("terrain window", [round(v, 3) for v in t.bbox], "fine patches", len(t.fine), flush=True)

    traverse = requests.get(MMGIS_URL, timeout=60).json()["features"]
    traverse_props = [f["properties"] for f in traverse]
    latest_sol = max(p["sol"] for p in traverse_props)

    index = requests.get(HIRISE_INDEX_URL, timeout=120).text
    dtm = {}
    for p in csv.reader(io.StringIO(index), skipinitialspace=True):
        p = [c.strip() for c in p]
        if len(p) > 18 and p[4].startswith("DTEEC") and p[1].upper().endswith(".IMG"):
            dtm[p[4]] = {"title": p[7], "bbox": tuple(float(v) for v in (p[17], p[15], p[18], p[16]))}

    raw = []
    for sid, name, kind, sol, note in CURIOSITY_SITES:
        sol = latest_sol if sol is None else sol
        pt = min(traverse_props, key=lambda q: abs(q["sol"] - sol))
        raw.append({"id": sid, "name": name, "type": kind, "lat": pt["lat"], "lon": pt["lon"], "note": note,
                    "source": f"NASA MMGIS Curiosity traverse, sol {pt['sol']}", "sol": pt["sol"]})
    for sid, pid, kind in HIRISE_SITES:
        w, s, e, n = dtm[pid]["bbox"]
        raw.append({"id": sid, "name": dtm[pid]["title"], "type": kind, "lat": (s + n) / 2, "lon": (w + e) / 2,
                    "note": f"HiRISE stereo target with a 1 m elevation model ({pid}).",
                    "source": "HiRISE PDS DTM index (target description, DTM center)"})
    for sid, name, kind, lat, lon, note in TREK_SITES:
        raw.append({"id": sid, "name": name, "type": kind, "lat": lat, "lon": lon, "note": note,
                    "source": "NASA/JPL Mars Trek catalog"})

    # Modeled habitat: flattest firm ground (slope <= 2 deg, no sand) next to the first Curiosity traverse
    # point inside the block. (Bradbury Landing itself is about 0.8 km north of the block edge.)
    inside = [q for q in traverse_props if west <= q["lon"] <= east and south <= q["lat"] <= north
              and t.latlon_to_rc(q["lat"], q["lon"])]
    first_in = min(inside, key=lambda q: q["sol"])
    flat = t.passable_rover & (t.slope <= 2.0)
    hab = find_nearest_cell(t, first_in["lat"], first_in["lon"], flat, 10)
    if hab is None:
        raise SystemExit("no flat firm cell near the traverse for the habitat")
    raw.insert(0, {"id": "habitat", "name": "CLHM Habitat (proposed)", "type": "Habitat (modeled)",
                   "lat": hab[0], "lon": hab[1],
                   "note": f"Modeled habitat: flattest firm ground (slope 2 deg or less) next to Curiosity's traverse at sol {first_in['sol']}, the first traverse point inside the block.",
                   "source": "CLHM terrain model (USGS DEM) + NASA MMGIS traverse"})
    # Modeled shelters: nearest natural shelter cells to the habitat and to the main boxwork area.
    for sid, name, ref in (("shelter_habitat", "Natural shelter near habitat", raw[0]),
                           ("shelter_boxwork", "Natural shelter near boxwork", next(s for s in raw if s["id"] == "boxwork_main"))):
        cell = find_nearest_cell(t, ref["lat"], ref["lon"], t.is_shelter, 30)
        if cell:
            raw.append({"id": sid, "name": name, "type": "Shelter (modeled)", "lat": cell[0], "lon": cell[1],
                        "note": "Modeled natural shelter: passable ground next to steep walls (55 m or more of relief).",
                        "source": "CLHM terrain model (cliff shielding)"})

    sites = []
    for s in raw:
        if not (west <= s["lon"] <= east and south <= s["lat"] <= north):
            print("skip (outside window)", s["id"], flush=True)
            continue
        info = t.at(s["lat"], s["lon"])
        if not info or t.latlon_to_rc(s["lat"], s["lon"]) is None:
            print("skip (no base terrain cell; routes need the 200 m grid)", s["id"], flush=True)
            continue
        s.update(elevation_m=info["elevation_m"], slope_deg=info["slope_deg"], terrain_class=info["class"],
                 terrain_resolution_m=info["resolution_m"],
                 x_norm=round((s["lon"] - west) / (east - west), 5), y_norm=round((north - s["lat"]) / (north - south), 5))
        s["lat"], s["lon"] = round(s["lat"], 6), round(s["lon"], 6)
        sites.append(s)
    print("sites:", len(sites), [s["id"] for s in sites], flush=True)

    pairs = set()
    for a in sites:
        near = sorted((ground_km(a, b), b["id"]) for b in sites if b["id"] != a["id"])
        for _, bid in near[:NEIGHBORS]:
            pairs.add(tuple(sorted((a["id"], bid))))
    by_id = {s["id"]: s for s in sites}

    segments, skipped = [], []
    for a_id, b_id in sorted(pairs):
        a, b = by_id[a_id], by_id[b_id]
        foot = find_route(t, {"lat": a["lat"], "lon": a["lon"]}, {"lat": b["lat"], "lon": b["lon"]}, rover_support=False)
        if not foot["feasible"] or len(foot["path"]) < 2:
            skipped.append((a_id, b_id, foot["status"]))
            continue
        rover = find_route(t, {"lat": a["lat"], "lon": a["lon"]}, {"lat": b["lat"], "lon": b["lon"]}, rover_support=True)
        stats = describe_path(t, foot["path"])
        rover_ok = bool(rover["feasible"])
        segments.append({
            "from": a_id, "to": b_id,
            "distance_km": round(foot["metrics"]["distance_m"] / 1000, 2),
            "foot": foot["metrics"],
            "rover": rover["metrics"] if rover_ok else None,
            "rover_ok": rover_ok,
            **stats,
            "path": thin(foot["path"]),
        })
        print(f"seg {a_id}-{b_id}: {segments[-1]['distance_km']} km risk {stats['risk']} max {stats['max_slope_deg']} rover {rover_ok}", flush=True)

    out = {
        "generated": time.strftime("%Y-%m-%d"),
        "area_of_interest": {"name": "Gale Crater block (about 120 x 180 km)", "bbox": [round(v, 5) for v in t.bbox]},
        "limits_deg": {"rover": ROVER_LIMIT_DEG, "foot": FOOT_LIMIT_DEG},
        "risk_formula": "100 * (0.50*min(1, max_slope/30) + 0.35*min(1, 4*share_above_15deg) + 0.15*min(1, 5*sand_share)); slopes use the finest data at each path point",
        "segment_mode": "Geometry and distance from the on-foot A* route; rover metrics included when a rover route exists",
        "sources": {"curiosity": MMGIS_URL, "hirise_targets": HIRISE_INDEX_URL, "trek": "https://trek.nasa.gov/mars/"},
        "sites": sites,
        "segments": segments,
        "skipped_pairs": [{"from": a, "to": b, "reason": r} for a, b, r in skipped],
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"saved {os.path.abspath(OUT)} ({os.path.getsize(OUT)} bytes), {len(segments)} segments, {len(skipped)} skipped, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
