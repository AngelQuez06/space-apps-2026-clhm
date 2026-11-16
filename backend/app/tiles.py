"""Tile fetching, caching, overzooming and LOD compositing."""

import io
import os
import threading

import requests
import numpy as np
from PIL import Image

from .layers import (
    LAYERS,
    SATELLITE_COLOR_ID,
    SATELLITE_ID,
    SATELLITE_STACK,
    TONE_GAIN,
    TREK_URL,
    Layer,
)

TILE_SIZE = 256
_session = requests.Session()
_session.headers["User-Agent"] = "nasa-space-apps-2026-mars-map/0.1"
_lock = threading.Lock()


class UpstreamError(Exception):
    pass


def tile_bounds(z: int, x: int, y: int) -> tuple:
    """(min_lon, min_lat, max_lon, max_lat) of a tile in the Trek/EPSG:4326 scheme."""
    w = 360.0 / 2 ** (z + 1)
    h = 180.0 / 2**z
    lon0 = -180.0 + x * w
    lat1 = 90.0 - y * h
    return (lon0, lat1 - h, lon0 + w, lat1)


def tile_valid(z: int, x: int, y: int) -> bool:
    return 0 <= z <= 30 and 0 <= x < 2 ** (z + 1) and 0 <= y < 2**z


def intersects(a: tuple, b: tuple) -> bool:
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def _cache_path(cache_dir: str, layer: Layer, z: int, x: int, y: int) -> str:
    return os.path.join(cache_dir, layer.id, str(z), str(x), f"{y}.{layer.ext}")


def fetch_native(cache_dir: str, timeout: float, layer: Layer, z: int, x: int, y: int):
    """Raw bytes of a native upstream tile, or None if upstream has no such tile."""
    path = _cache_path(cache_dir, layer, z, x, y)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    if os.path.exists(path + ".none"):
        return None

    url = TREK_URL.format(trek_id=layer.trek_id, z=z, x=x, y=y, ext=layer.ext)
    try:
        resp = _session.get(url, timeout=timeout)
    except requests.RequestException as exc:
        raise UpstreamError(str(exc)) from exc

    os.makedirs(os.path.dirname(path), exist_ok=True)
    if resp.status_code == 404:
        open(path + ".none", "wb").close()
        return None
    if resp.status_code != 200 or not resp.headers.get("content-type", "").startswith("image/"):
        raise UpstreamError(f"upstream {resp.status_code} for {url}")
    tmp = f"{path}.{threading.get_ident()}.tmp"
    with open(tmp, "wb") as f:
        f.write(resp.content)
    os.replace(tmp, path)
    return resp.content


def layer_image(cache_dir, timeout, max_overzoom, layer: Layer, z, x, y):
    """RGBA image of a tile of `layer`, or None when the layer has no data there.

    Above the layer's native max zoom the finest native tile is cropped and upscaled.
    """
    if not intersects(tile_bounds(z, x, y), layer.bbox):
        return None
    dz = max(0, z - layer.max_native_zoom)
    if dz > max_overzoom:
        return None
    nz = z - dz
    data = fetch_native(cache_dir, timeout, layer, nz, x >> dz, y >> dz)
    if data is None:
        return None
    img = Image.open(io.BytesIO(data)).convert("RGBA")
    if dz:
        size = TILE_SIZE >> dz
        left = (x - ((x >> dz) << dz)) * size
        top = (y - ((y >> dz) << dz)) * size
        img = img.crop((left, top, left + size, top + size)).resize(
            (TILE_SIZE, TILE_SIZE), Image.LANCZOS
        )
    return img


def color_base(cache_dir, timeout, z, x, y):
    """Viking color for any zoom: the z7 ancestor is cropped (float box) and smoothly resampled."""
    layer = LAYERS["viking"]
    dz = max(0, z - layer.max_native_zoom)
    data = fetch_native(cache_dir, timeout, layer, z - dz, x >> dz, y >> dz)
    if data is None:
        return None
    img = Image.open(io.BytesIO(data)).convert("RGB")
    if dz:
        size = TILE_SIZE / 2**dz
        left = (x - ((x >> dz) << dz)) * size
        top = (y - ((y >> dz) << dz)) * size
        img = img.resize(
            (TILE_SIZE, TILE_SIZE), Image.BICUBIC, box=(left, top, left + size, top + size)
        )
    return img


def render_color_tile(cache_dir, timeout, over, z, x, y):
    """Pansharpened satellite: luminance from CTX/HiRISE, chroma from the Viking color mosaic.

    The color is approximate (232 m/px source), not a measurement of the real surface color.
    """
    base = color_base(cache_dir, timeout, z, x, y)
    if base is None:
        return None
    detail = None
    for layer in SATELLITE_STACK[1:]:  # CTX, then HiRISE on top
        img = layer_image(cache_dir, timeout, over, layer, z, x, y)
        if img is not None:
            detail = img if detail is None else Image.alpha_composite(detail, img)
    if detail is None:
        return _encode(base.convert("RGBA"), "png")

    y_c, cb, cr = base.convert("YCbCr").split()
    y_base = np.asarray(y_c, dtype=np.float32)
    y_det = np.asarray(detail.convert("L"), dtype=np.float32) * TONE_GAIN
    alpha = np.asarray(detail.getchannel("A"), dtype=np.float32) / 255.0
    y_out = np.clip(y_base * (1 - alpha) + y_det * alpha, 0, 255).astype(np.uint8)
    out = Image.merge("YCbCr", (Image.fromarray(y_out, "L"), cb, cr)).convert("RGBA")
    return _encode(out, "png")


def render_tile(cfg: dict, layer_id: str, z: int, x: int, y: int):
    """Return (bytes, mime) for a tile, or None if there is no data."""
    cache_dir = os.path.abspath(cfg["TILE_CACHE_DIR"])
    timeout, over = cfg["UPSTREAM_TIMEOUT"], cfg["MAX_OVERZOOM"]

    if layer_id == SATELLITE_COLOR_ID:
        return render_color_tile(cache_dir, timeout, over, z, x, y)

    if layer_id == SATELLITE_ID:
        canvas = None
        for layer in SATELLITE_STACK:  # coarse -> fine, finest drawn last
            img = layer_image(cache_dir, timeout, over, layer, z, x, y)
            if img is None:
                continue
            canvas = img if canvas is None else Image.alpha_composite(canvas, img)
        if canvas is None:
            return None
        return _encode(canvas, "png")

    layer = LAYERS[layer_id]
    img = layer_image(cache_dir, timeout, over, layer, z, x, y)
    if img is None:
        return None
    return _encode(img, layer.ext)


def _encode(img: Image.Image, ext: str):
    buf = io.BytesIO()
    if ext == "png":
        img.save(buf, "PNG")
        return buf.getvalue(), "image/png"
    img.convert("RGB").save(buf, "JPEG", quality=88)
    return buf.getvalue(), "image/jpeg"


def max_zoom(layer_id: str, max_overzoom: int) -> int:
    if layer_id in (SATELLITE_ID, SATELLITE_COLOR_ID):
        return max(l.max_native_zoom for l in SATELLITE_STACK) + max_overzoom
    return LAYERS[layer_id].max_native_zoom + max_overzoom
