from flask import Blueprint, current_app, jsonify

bp = Blueprint("index", __name__)


@bp.get("/")
def index():
    endpoints = sorted(
        r.rule
        for r in current_app.url_map.iter_rules()
        if r.endpoint != "static" and "GET" in r.methods
    )
    return jsonify(name="Martian map backend", endpoints=endpoints)
