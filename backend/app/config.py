import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    DEBUG = os.getenv("FLASK_DEBUG", "0") == "1"
    PORT = int(os.getenv("PORT", "5000"))
    # Comma-separated allowed origins. Restrictive by default; use "*" only for local dev.
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "https://clhm.study,https://www.clhm.study")
    # Number of reverse proxies in front of the app (Cloud Run = 1, local = 0).
    TRUSTED_PROXY_HOPS = int(os.getenv("TRUSTED_PROXY_HOPS", "0"))
    ENABLE_HSTS = os.getenv("ENABLE_HSTS", "0") == "1"
    RATE_LIMIT_DEFAULT = os.getenv("RATE_LIMIT_DEFAULT", "120 per minute")
    RATE_LIMIT_TILES = os.getenv("RATE_LIMIT_TILES", "1200 per minute")
    RATE_LIMIT_ROUTE = os.getenv("RATE_LIMIT_ROUTE", "10 per minute")
    # Mount Sharp (Aeolis Mons), Gale Crater, per PROBLEM_BACKGROUND.md.
    ZONE_NAME = os.getenv("ZONE_NAME", "Gale Crater and Mount Sharp (Aeolis Mons)")
    ZONE_CENTER_LAT = float(os.getenv("ZONE_CENTER_LAT", "-5.4"))
    ZONE_CENTER_LON = float(os.getenv("ZONE_CENTER_LON", "137.8"))
    # Optional "min_lon,min_lat,max_lon,max_lat". When set, tiles outside it return 404.
    ZONE_BBOX = os.getenv("ZONE_BBOX", "")
    TILE_CACHE_DIR = os.getenv(
        "TILE_CACHE_DIR", os.path.join(os.path.dirname(__file__), "..", "cache", "tiles")
    )
    UPSTREAM_TIMEOUT = float(os.getenv("UPSTREAM_TIMEOUT", "20"))
    # Extra zoom levels served beyond a layer's native max by upscaling its finest tile.
    MAX_OVERZOOM = int(os.getenv("MAX_OVERZOOM", "3"))
