from flask import Flask
from flask_cors import CORS

from .config import Config


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    origins = [o.strip() for o in app.config["CORS_ORIGINS"].split(",") if o.strip()]
    # POST is needed by /api/route (JSON body triggers a CORS preflight).
    CORS(app, origins=origins, methods=["GET", "HEAD", "POST", "OPTIONS"], allow_headers=["Content-Type"])

    from .routes.health import bp as health_bp

    from .routes.index import bp as index_bp

    from .routes.tiles import bp as tiles_bp

    from .routes.terrain import bp as terrain_bp

    from .routes.route import bp as route_bp

    from .routes.network import bp as network_bp

    from .routes.radiation import bp as radiation_bp

    app.register_blueprint(tiles_bp, url_prefix="/api")
    app.register_blueprint(terrain_bp, url_prefix="/api")
    app.register_blueprint(route_bp, url_prefix="/api")
    app.register_blueprint(network_bp, url_prefix="/api")
    app.register_blueprint(radiation_bp, url_prefix="/api")
    app.register_blueprint(index_bp)
    app.register_blueprint(health_bp, url_prefix="/api")

    from .security import init_security

    init_security(app)
    return app
