from flask import Blueprint, Response, abort, jsonify, request

import functools

from .. import radiation
from .. import terrain as terrain_mod
from ..tiles import tile_valid

bp = Blueprint("terrain", __name__)
SLOPE_MAX_ZOOM = 16
OVERLAY_KINDS = ("slope", "radiation", "quality")
AREA_MAX_PX = 1200


def _terrain():
    t = terrain_mod.get_terrain()
    if t is None:
        abort(503, "DEM not available: run backend/scripts/fetch_dem.py")
    return t


def describe_quality_layer():
    t = terrain_mod.get_terrain()
    if t is None or not t.fine:
        return None
    base = request.host_url.rstrip("/") + "/api/terrain"
    return {
        "id": "data_quality",
        "title": "Terrain data quality: blue = 10 m HiRISE DTM, transparent = 200 m only",
        "format": "png",
        "bbox": t.bbox,
        "max_zoom": SLOPE_MAX_ZOOM,
        "url_template": f"{base}/quality/{{z}}/{{x}}/{{y}}.png",
        "legend": [
            {"label": f"{round(t.fine[0].res_m)} m HiRISE DTM ({len(t.fine)} patches)", "color": "#1e78ff"},
            {"label": f"{t.res_m:.0f} m HRSC+MOLA DEM only", "color": "transparent"},
        ],
    }


def describe_radiation_layer():
    t = terrain_mod.get_terrain()
    if t is None:
        return None
    base = request.host_url.rstrip("/") + "/api/terrain"
    rad = radiation.describe()
    dose = rad["dose_equivalent_msv_day"]
    lo, hi = terrain_mod.RAD_FACTOR_MIN, terrain_mod.RAD_FACTOR_MAX
    return {
        "id": "radiation",
        "title": "Modeled surface dose rate: Curiosity RAD baseline x terrain shielding factor",
        "format": "png",
        "resolution": f"~{t.res_m:.0f} m/px",
        "bbox": t.bbox,
        "max_zoom": SLOPE_MAX_ZOOM,
        "url_template": f"{base}/radiation/{{z}}/{{x}}/{{y}}.png",
        "baseline_msv_day": dose,
        "baseline_source": rad["source"],
        "legend": [
            {"factor": lo, "dose_msv_day": round(dose * lo, 3), "label": "shielded by walls", "color": "#28aaa0"},
            {"factor": 1.0, "dose_msv_day": round(dose, 3), "label": "open ground (RAD baseline)", "color": "#f0cd55"},
            {"factor": hi, "dose_msv_day": round(dose * hi, 3), "label": "exposed ridge", "color": "#e14637"},
        ],
        "note": "Model: the factor comes from terrain shielding in the DEM; the baseline is the 2026 median of Curiosity RAD. Solar storms are not included.",
    }


def describe_slope_layer():
    t = terrain_mod.get_terrain()
    if t is None:
        return None
    base = request.host_url.rstrip("/") + "/api/terrain"
    fine = f" and {round(t.fine[0].res_m)} m inside HiRISE DTM patches" if t.fine else ""
    return {
        "id": "slope",
        "title": "Slope hazard overlay (transparent PNG, drawn over satellite)",
        "format": "png",
        "resolution": f"~{t.res_m:.0f} m/px (coarse, smoothed){fine}",
        "bbox": t.bbox,
        "max_zoom": SLOPE_MAX_ZOOM,
        "url_template": f"{base}/slope/{{z}}/{{x}}/{{y}}.png",
        "legend": [
            {"range_deg": "0-10", "class": "ok", "color": "green"},
            {"range_deg": "10-15", "class": "ok", "color": "yellow"},
            {"range_deg": "15-20", "class": "no_rover", "color": "orange"},
            {"range_deg": ">20", "class": "no_go", "color": "red"},
        ],
    }


@bp.get("/terrain/slope/<int:z>/<int:x>/<int:y>.png")
def slope_tile(z, x, y):
    t = _terrain()
    if z > SLOPE_MAX_ZOOM or not tile_valid(z, x, y) or not t.contains_tile(z, x, y):
        abort(404, "no slope data for this tile")
    return Response(
        t.slope_tile_png(z, x, y),
        mimetype="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@bp.get("/terrain/point")
def point():
    try:
        lat = float(request.args["lat"])
        lon = float(request.args["lon"])
    except (KeyError, ValueError):
        abort(400, "lat and lon query parameters are required numbers")
    t = _terrain()
    data = t.at(lat, lon)
    if data is None:
        abort(404, "point outside the DEM window")
    rad = t.radiation_at(lat, lon) or {}
    return jsonify(lat=lat, lon=lon, **data, **rad)


@bp.get("/terrain/radiation/<int:z>/<int:x>/<int:y>.png")
def radiation_tile(z, x, y):
    t = _terrain()
    if z > SLOPE_MAX_ZOOM or not tile_valid(z, x, y) or not t.contains_tile(z, x, y):
        abort(404, "no terrain data for this tile")
    return Response(
        t.radiation_tile_png(z, x, y),
        mimetype="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@functools.lru_cache(maxsize=32)
def _area_png(kind, bbox, width, height):
    return terrain_mod.get_terrain().area_png(kind, bbox, width, height)


@bp.get("/terrain/<kind>/area.png")
def area_image(kind):
    """One overlay image for a lat/lon box: ?bbox=west,south,east,north&width=&height= (max 1200 px)."""
    if kind not in OVERLAY_KINDS:
        abort(404, "unknown overlay")
    _terrain()
    try:
        bbox = tuple(round(float(v), 5) for v in request.args["bbox"].split(","))
        width = int(request.args.get("width", 1000))
        height = int(request.args.get("height", 700))
    except (KeyError, ValueError):
        abort(400, "bbox=west,south,east,north and integer width/height are required")
    if len(bbox) != 4 or not (bbox[0] < bbox[2] and bbox[1] < bbox[3]) or abs(bbox[2] - bbox[0]) > 10 or abs(bbox[3] - bbox[1]) > 10:
        abort(400, "invalid bbox (west < east, south < north, at most 10 degrees)")
    if not (16 <= width <= AREA_MAX_PX and 16 <= height <= AREA_MAX_PX):
        abort(400, f"width and height must be between 16 and {AREA_MAX_PX}")
    return Response(
        _area_png(kind, bbox, width, height),
        mimetype="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@bp.get("/terrain/quality/<int:z>/<int:x>/<int:y>.png")
def quality_tile(z, x, y):
    t = _terrain()
    if z > SLOPE_MAX_ZOOM or not tile_valid(z, x, y) or not t.contains_tile(z, x, y):
        abort(404, "no terrain data for this tile")
    return Response(
        t.quality_tile_png(z, x, y),
        mimetype="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@bp.get("/terrain/info")
def info():
    t = _terrain()
    return jsonify(
        bbox=t.bbox,
        resolution_m=round(t.res_m),
        fine_patches=[
            {"id": p.id, "bbox": p.bbox, "resolution_m": round(p.res_m)} for p in t.fine
        ],
        limits_deg={"rover": terrain_mod.ROVER_LIMIT_DEG, "foot": terrain_mod.FOOT_LIMIT_DEG},
        source="USGS HRSC+MOLA blended DEM 200 m v2, plus HiRISE DTM patches reduced to 10 m",
    )
