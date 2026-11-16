"""Production hardening: proxy headers, rate limiting and security headers."""

from flask import Flask
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix


def init_security(app: Flask) -> None:
    # Cloud Run puts the real client IP in X-Forwarded-For (one trusted proxy hop).
    if app.config["TRUSTED_PROXY_HOPS"] > 0:
        hops = app.config["TRUSTED_PROXY_HOPS"]
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops, x_host=hops)

    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=[app.config["RATE_LIMIT_DEFAULT"]],
        storage_uri="memory://",  # per instance: a soft cap, not a global one
    )
    # Limits are set per blueprint (per-view limits added after registration are not applied).
    # A map view requests dozens of tiles at once, so tile and terrain routes get a higher cap.
    # Route search is CPU-bound (about 2 s for long routes) and holds the GIL, so cap it hard.
    per_blueprint = {
        "tiles": app.config["RATE_LIMIT_TILES"],
        "terrain": app.config["RATE_LIMIT_TILES"],
        "route": app.config["RATE_LIMIT_ROUTE"],
    }
    for name, limit in per_blueprint.items():
        if name in app.blueprints:
            limiter.limit(limit)(app.blueprints[name])

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Cross-Origin-Resource-Policy", "cross-origin")
        if app.config["ENABLE_HSTS"]:
            resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        return resp
