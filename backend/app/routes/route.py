from flask import Blueprint, abort, jsonify, request

from .. import terrain as terrain_mod
from ..pathfinder import find_route

bp = Blueprint("route", __name__)


def _to_bool(value, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


@bp.post("/route")
def route():
    t = terrain_mod.get_terrain()
    if t is None:
        abort(503, "DEM not available: run backend/scripts/fetch_dem.py")

    payload = request.get_json(silent=True) or {}
    if "start" not in payload:
        abort(400, "start coordinate is required ([row, col] or [lat, lon])")

    solar_storm = _to_bool(payload.get("solar_storm"), False)
    if not solar_storm and "end" not in payload:
        abort(400, "end coordinate is required when solar_storm is false")

    rover_support = _to_bool(payload.get("rover_support"), True)
    result = find_route(
        t,
        start_raw=payload.get("start"),
        end_raw=payload.get("end"),
        rover_support=rover_support,
        solar_storm=solar_storm,
    )
    return jsonify(result)
