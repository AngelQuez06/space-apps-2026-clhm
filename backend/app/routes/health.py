from flask import Blueprint, current_app, jsonify

bp = Blueprint("health", __name__)


@bp.get("/health")
def health():
    return jsonify(
        status="ok",
        zone=current_app.config["ZONE_NAME"] or None,
    )
