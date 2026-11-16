from flask import Blueprint, Response, abort, current_app, jsonify, request

from .. import tiles
from ..layers import LAYERS, SATELLITE_COLOR_ID, SATELLITE_ID, SATELLITE_STACK

bp = Blueprint("tiles", __name__)


def _zone_bbox():
    raw = current_app.config["ZONE_BBOX"].strip()
    if not raw:
        return None
    try:
        vals = tuple(float(v) for v in raw.split(","))
    except ValueError:
        return None
    return vals if len(vals) == 4 else None


def _describe():
    cfg = current_app.config
    base = request.host_url.rstrip("/") + "/api/tiles"
    out = [
        {
            "id": SATELLITE_ID,
            "title": "Satellite (LOD composite: Viking -> CTX -> HiRISE)",
            "format": "png",
            "max_zoom": tiles.max_zoom(SATELLITE_ID, cfg["MAX_OVERZOOM"]),
            "sources": [l.id for l in SATELLITE_STACK],
            "url_template": f"{base}/{SATELLITE_ID}/{{z}}/{{x}}/{{y}}.png",
        },
        {
            "id": SATELLITE_COLOR_ID,
            "title": "Satellite, approximate color (CTX/HiRISE detail tinted with Viking color)",
            "format": "png",
            "max_zoom": tiles.max_zoom(SATELLITE_COLOR_ID, cfg["MAX_OVERZOOM"]),
            "sources": [l.id for l in SATELLITE_STACK],
            "url_template": f"{base}/{SATELLITE_COLOR_ID}/{{z}}/{{x}}/{{y}}.png",
        },
    ]
    for layer in LAYERS.values():
        out.append(
            {
                "id": layer.id,
                "title": layer.title,
                "format": layer.ext,
                "resolution": layer.resolution,
                "bbox": layer.bbox,
                "native_max_zoom": layer.max_native_zoom,
                "max_zoom": tiles.max_zoom(layer.id, cfg["MAX_OVERZOOM"]),
                "url_template": f"{base}/{layer.id}/{{z}}/{{x}}/{{y}}.{layer.ext}",
            }
        )
    from .terrain import describe_quality_layer, describe_radiation_layer, describe_slope_layer

    for layer in (describe_slope_layer(), describe_radiation_layer(), describe_quality_layer()):
        if layer:
            out.append(layer)
    return out


@bp.get("/layers")
def layers():
    return jsonify(
        scheme={
            "crs": "EPSG:4326",
            "tile_size": tiles.TILE_SIZE,
            "z0_tiles": [2, 1],
            "origin": [-180, 90],
            "y_axis": "down (row 0 at north)",
            "note": "Leaflet: L.CRS.EPSG4326, no TMS flag",
        },
        layers=_describe(),
    )


@bp.get("/tiles/<layer_id>/<int:z>/<int:x>/<int:y>.<ext>")
def tile(layer_id, z, x, y, ext):
    if layer_id in (SATELLITE_ID, SATELLITE_COLOR_ID):
        expected = "png"
    else:
        expected = getattr(LAYERS.get(layer_id), "ext", None)
    if expected is None or ext != expected:
        abort(404, "unknown layer or wrong extension")
    if not tiles.tile_valid(z, x, y) or z > tiles.max_zoom(layer_id, current_app.config["MAX_OVERZOOM"]):
        abort(404, "tile out of range")
    zone = _zone_bbox()
    if zone and not tiles.intersects(tiles.tile_bounds(z, x, y), zone):
        abort(404, "tile outside the configured zone")

    try:
        result = tiles.render_tile(current_app.config, layer_id, z, x, y)
    except tiles.UpstreamError as exc:
        current_app.logger.warning("upstream tile error: %s", exc)
        abort(502, "upstream tile service unavailable")
    if result is None:
        abort(404, "no data for this tile")

    body, mime = result
    return Response(body, mimetype=mime, headers={"Cache-Control": "public, max-age=86400"})


@bp.get("/zone")
def zone():
    cfg = current_app.config
    from ..terrain import get_terrain

    t = get_terrain()
    # The area of interest is the whole terrain block, not only the
    # original 5x5 km quadrant. It is informative: tiles outside it are still served.
    area = [round(v, 5) for v in t.bbox] if t else None
    return jsonify(
        name=cfg["ZONE_NAME"],
        center={"lat": cfg["ZONE_CENTER_LAT"], "lon": cfg["ZONE_CENTER_LON"]},
        bbox=_zone_bbox(),
        area_of_interest={"name": "Gale Crater block (about 120 x 180 km)", "bbox": area},
        legacy_quadrant={"name": "Original 5 x 5 km quadrant", "bbox": [137.76, -5.44, 137.84, -5.36]},
    )
