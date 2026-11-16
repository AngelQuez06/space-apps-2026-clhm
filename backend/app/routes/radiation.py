from flask import Blueprint, abort, jsonify, request

from .. import radiation

bp = Blueprint("radiation", __name__)


@bp.get("/radiation")
def radiation_baseline():
    """Real surface radiation baseline from Curiosity RAD. ?days=0 omits the daily series."""
    data = radiation.load_baseline()
    if data is None:
        abort(503, "radiation baseline not built: run backend/scripts/fetch_rad.py")
    include_days = request.args.get("days", "1") != "0"
    body = {k: v for k, v in data.items() if include_days or k != "days"}
    resp = jsonify(body)
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp
