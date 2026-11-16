"""Elevation, slope and hazard classes from the local DEM window.

Data: USGS HRSC+MOLA blended DEM (200 m/px), window saved by scripts/fetch_dem.py.
At 200 m/px, slopes are smoothed: they underestimate steep local features (cliffs, crater walls),
so treat results as a coarse screening, not as a safe-route guarantee.
"""

import functools
import io
import os

import numpy as np
from PIL import Image

from .fine_terrain import load_patches
from .radiation import dose_equivalent_msv_per_day

# Radiation overlay: color ramp over the terrain shielding factor (teal = shielded, yellow = open, red = exposed).
RAD_FACTOR_MIN, RAD_FACTOR_MAX = 0.65, 1.15
RAD_RAMP_STOPS = [0.0, 0.7, 1.0]  # 0.7 corresponds to factor 1.0 (open ground)
RAD_RAMP_COLORS = [(40, 170, 160), (240, 205, 85), (225, 70, 55)]
from .tiles import TILE_SIZE, tile_bounds

DEM_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "gale_dem.npz")

# Thresholds from the project spec: >15 deg no rover-assisted transport, >20 deg no foot traverse.
ROVER_LIMIT_DEG = 15.0
FOOT_LIMIT_DEG = 20.0
CLASSES = ("ok", "no_rover", "no_go")


def classify(slope_deg: float) -> str:
    if slope_deg > FOOT_LIMIT_DEG:
        return "no_go"
    if slope_deg > ROVER_LIMIT_DEG:
        return "no_rover"
    return "ok"


class Terrain:
    def __init__(self, path: str):
        d = np.load(path)
        elev = d["elevation"].astype(np.float32)
        elev[elev == int(d["nodata"])] = np.nan
        self.elevation = elev
        self.west = float(d["west"])
        self.north = float(d["north"])
        self.res = float(d["res_deg"])
        radius = float(d["radius_m"])
        rows, cols = elev.shape
        self.bbox = (
            self.west,
            self.north - rows * self.res,
            self.west + cols * self.res,
            self.north,
        )
        self.res_m = float(np.radians(self.res) * radius)

        lat = self.north - (np.arange(rows) + 0.5) * self.res
        dy = self.res_m
        dx_1d = dy * np.cos(np.radians(lat))
        dx = dx_1d[:, None]
        self.dx_m = dx_1d.astype(np.float64)
        dz_drow, dz_dcol = np.gradient(elev)
        dz_dnorth = -dz_drow / dy  # rows increase southward
        dz_deast = dz_dcol / dx
        self.slope = np.degrees(np.arctan(np.hypot(dz_dnorth, dz_deast))).astype(np.float32)

        # Derived operational layers for A* routing:
        # 1. Sand ripple / low thermal inertia proxy: very flat local depressions where loose aeolian sand accumulates.
        # 2. Topographic shielding: proximity to steep cliffs/walls (>= 18 deg or >= 25 m local relief).
        # 3. Natural shelter cells (is_shelter): passable terrain adjacent to steep walls/overhangs.
        padded_elev = np.pad(elev, 1, mode="edge")
        padded_slope = np.pad(self.slope, 1, mode="edge")
        nbr_elevs = [
            padded_elev[0:rows, 0:cols], padded_elev[0:rows, 1:cols + 1], padded_elev[0:rows, 2:cols + 2],
            padded_elev[1:rows + 1, 0:cols], padded_elev[1:rows + 1, 2:cols + 2],
            padded_elev[2:rows + 2, 0:cols], padded_elev[2:rows + 2, 1:cols + 1], padded_elev[2:rows + 2, 2:cols + 2],
        ]
        nbr_slopes = [
            padded_slope[0:rows, 0:cols], padded_slope[0:rows, 1:cols + 1], padded_slope[0:rows, 2:cols + 2],
            padded_slope[1:rows + 1, 0:cols], padded_slope[1:rows + 1, 2:cols + 2],
            padded_slope[2:rows + 2, 0:cols], padded_slope[2:rows + 2, 1:cols + 1], padded_slope[2:rows + 2, 2:cols + 2],
        ]
        local_mean_elev = np.nanmean(np.stack(nbr_elevs, axis=0), axis=0)
        max_nbr_slope = np.nanmax(np.stack(nbr_slopes, axis=0), axis=0)
        max_relief = np.nanmax(np.stack([ne - elev for ne in nbr_elevs], axis=0), axis=0)

        valid = ~np.isnan(elev) & ~np.isnan(self.slope)
        self.sand_ripple = valid & (self.slope < 1.8) & ((local_mean_elev - elev) > 2.0)

        wall_score = np.clip((max_nbr_slope - 14.0) / 14.0, 0.0, 1.0)
        relief_score = np.clip(max_relief / 45.0, 0.0, 1.0)
        self.cliff_shielding = np.where(valid, np.maximum(wall_score, relief_score), 0.0).astype(np.float32)

        ridge_exposure = np.where(valid & ((elev - local_mean_elev) > 25.0), 0.15, 0.0)
        self.radiation_factor = np.where(
            valid, np.clip(1.0 - 0.35 * self.cliff_shielding + ridge_exposure, 0.65, 1.15), 1.0
        ).astype(np.float32)

        self.passable_rover = valid & (self.slope <= ROVER_LIMIT_DEG) & (~self.sand_ripple)
        self.passable_foot = valid & (self.slope <= FOOT_LIMIT_DEG)

        # Strict natural shelter: passable for rover/foot, next to a high, steep cliff/wall.
        self.is_shelter = self.passable_rover & (self.cliff_shielding >= 0.95) & (max_relief >= 55.0)
        if not np.any(self.is_shelter) and np.any(self.passable_rover):
            thresh = float(np.percentile(self.cliff_shielding[self.passable_rover], 95))
            self.is_shelter = self.passable_rover & (self.cliff_shielding >= thresh)

    def in_bounds(self, row: int, col: int) -> bool:
        rows, cols = self.elevation.shape
        if not (0 <= row < rows and 0 <= col < cols):
            return False
        return not (np.isnan(self.elevation[row, col]) or np.isnan(self.slope[row, col]))

    def latlon_to_rc(self, lat: float, lon: float):
        """Convert (lat, lon) to nearest (row, col) inside the DEM, or None if outside."""
        rows, cols = self.elevation.shape
        r = int(np.floor((self.north - lat) / self.res))
        c = int(np.floor((lon - self.west) / self.res))
        if not self.in_bounds(r, c):
            return None
        return (r, c)

    def rc_to_latlon(self, row: int, col: int) -> tuple:
        """Convert grid (row, col) center to (lat, lon)."""
        lat = self.north - (row + 0.5) * self.res
        lon = self.west + (col + 0.5) * self.res
        return (round(float(lat), 6), round(float(lon), 6))

    def _sample(self, grid, lat, lon):
        """Bilinear sample of `grid` at lat/lon arrays; NaN outside the window."""
        fr = (self.north - np.asarray(lat, dtype=np.float64)) / self.res - 0.5
        fc = (np.asarray(lon, dtype=np.float64) - self.west) / self.res - 0.5
        rows, cols = grid.shape
        inside = (fr >= 0) & (fr <= rows - 1) & (fc >= 0) & (fc <= cols - 1)
        r0 = np.clip(np.floor(fr).astype(int), 0, rows - 2)
        c0 = np.clip(np.floor(fc).astype(int), 0, cols - 2)
        wr, wc = fr - r0, fc - c0
        v = (
            grid[r0, c0] * (1 - wr) * (1 - wc)
            + grid[r0, c0 + 1] * (1 - wr) * wc
            + grid[r0 + 1, c0] * wr * (1 - wc)
            + grid[r0 + 1, c0 + 1] * wr * wc
        )
        return np.where(inside, v, np.nan)

    # 10 m HiRISE patches (app/fine_terrain.py), set by get_terrain(); empty tuple when absent.
    fine = ()

    def at(self, lat: float, lon: float):
        for patch in self.fine:  # finest data first
            pe = float(patch.sample(patch.elevation, lat, lon))
            ps = float(patch.sample(patch.slope, lat, lon))
            if not (np.isnan(pe) or np.isnan(ps)):
                return {
                    "elevation_m": round(pe, 1),
                    "slope_deg": round(ps, 1),
                    "class": classify(ps),
                    "resolution_m": round(patch.res_m),
                    "source": f"HiRISE DTM {patch.id} (reduced to {patch.res_m:.0f} m)",
                }
        e = float(self._sample(self.elevation, lat, lon))
        s = float(self._sample(self.slope, lat, lon))
        if np.isnan(e) or np.isnan(s):
            return None
        return {
            "elevation_m": round(e, 1),
            "slope_deg": round(s, 1),
            "class": classify(s),
            "resolution_m": round(self.res_m),
            "source": "USGS HRSC+MOLA blended DEM (coarse, smoothed)",
        }

    def contains_tile(self, z, x, y) -> bool:
        b = tile_bounds(z, x, y)
        boxes = [self.bbox] + [p.bbox for p in self.fine]
        return any(b[0] < o[2] and b[2] > o[0] and b[1] < o[3] and b[3] > o[1] for o in boxes)

    def _tile_grid(self, z, x, y):
        lon0, lat0, lon1, lat1 = tile_bounds(z, x, y)
        lons = lon0 + (np.arange(TILE_SIZE) + 0.5) / TILE_SIZE * (lon1 - lon0)
        lats = lat1 - (np.arange(TILE_SIZE) + 0.5) / TILE_SIZE * (lat1 - lat0)
        lon_g, lat_g = np.meshgrid(lons, lats)
        return (lon0, lat0, lon1, lat1), lat_g, lon_g

    def overlay_rgba(self, kind, lat_g, lon_g, box):
        """RGBA array for an overlay kind ("slope" | "radiation" | "quality") on a lat/lon grid."""
        rgba = np.zeros(lat_g.shape + (4,), dtype=np.uint8)
        if kind == "quality":  # blue where 10 m HiRISE data exists, transparent where only 200 m exists
            for patch in self.fine:
                if patch.intersects(box):
                    ok = ~np.isnan(patch.sample(patch.elevation, lat_g, lon_g))
                    rgba[ok] = (30, 120, 255, 90)
        elif kind == "slope":
            s = self._sample(self.slope, lat_g, lon_g)
            for patch in self.fine:  # 10 m data replaces the 200 m values where it is valid
                if patch.intersects(box):
                    ps = patch.sample(patch.slope, lat_g, lon_g)
                    s = np.where(np.isnan(ps), s, ps)
            valid = ~np.isnan(s)
            bands = [  # (lower bound deg, RGBA)
                (0.0, (46, 160, 67, 70)),
                (10.0, (240, 200, 40, 110)),
                (ROVER_LIMIT_DEG, (245, 140, 30, 140)),
                (FOOT_LIMIT_DEG, (220, 40, 40, 170)),
            ]
            for lower, color in bands:
                rgba[valid & (s >= lower)] = color
        elif kind == "radiation":
            # Modeled dose rate = measured RAD baseline x terrain shielding factor (200 m grid, 0.65-1.15).
            factor = self._sample(self.radiation_factor, lat_g, lon_g)
            valid = ~np.isnan(self._sample(self.elevation, lat_g, lon_g)) & ~np.isnan(factor)
            t = np.clip((np.nan_to_num(factor, nan=1.0) - RAD_FACTOR_MIN) / (RAD_FACTOR_MAX - RAD_FACTOR_MIN), 0, 1)
            rgb = np.empty(lat_g.shape + (3,), dtype=np.float32)
            for i in range(3):
                rgb[..., i] = np.interp(t, RAD_RAMP_STOPS, [c[i] for c in RAD_RAMP_COLORS])
            rgba[..., :3] = rgb.astype(np.uint8)
            rgba[..., 3] = np.where(valid, 120, 0)
        else:
            raise ValueError(f"unknown overlay {kind}")
        return rgba

    def overlay_png(self, kind, lat_g, lon_g, box) -> bytes:
        buf = io.BytesIO()
        Image.fromarray(self.overlay_rgba(kind, lat_g, lon_g, box), "RGBA").save(buf, "PNG")
        return buf.getvalue()

    def tile_png(self, kind, z, x, y) -> bytes:
        box, lat_g, lon_g = self._tile_grid(z, x, y)
        return self.overlay_png(kind, lat_g, lon_g, box)

    def area_png(self, kind, bbox, width, height) -> bytes:
        """One georeferenced PNG for a lat/lon box (equirectangular), used by the stylized planner map."""
        west, south, east, north = bbox
        lons = west + (np.arange(width) + 0.5) / width * (east - west)
        lats = north - (np.arange(height) + 0.5) / height * (north - south)
        lon_g, lat_g = np.meshgrid(lons, lats)
        return self.overlay_png(kind, lat_g, lon_g, (west, south, east, north))

    def quality_tile_png(self, z, x, y) -> bytes:
        return self.tile_png("quality", z, x, y)

    def slope_tile_png(self, z, x, y) -> bytes:
        return self.tile_png("slope", z, x, y)

    def radiation_tile_png(self, z, x, y) -> bytes:
        return self.tile_png("radiation", z, x, y)

    def radiation_at(self, lat: float, lon: float):
        """Shielding factor and modeled dose rate at a point (200 m grid), or None outside the DEM."""
        factor = float(self._sample(self.radiation_factor, lat, lon))
        if np.isnan(factor) or np.isnan(float(self._sample(self.elevation, lat, lon))):
            return None
        base = dose_equivalent_msv_per_day()
        return {"radiation_factor": round(factor, 3), "dose_rate_msv_day": round(base * factor, 4)}


@functools.lru_cache(maxsize=1)
def get_terrain():
    """Terrain loaded from the DEM window, or None if scripts/fetch_dem.py was not run."""
    path = os.path.abspath(DEM_PATH)
    if not os.path.exists(path):
        return None
    terrain = Terrain(path)
    terrain.fine = tuple(load_patches())
    return terrain
