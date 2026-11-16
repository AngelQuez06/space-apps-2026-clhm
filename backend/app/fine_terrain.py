"""Fine-resolution terrain patches (HiRISE DTMs reduced to 10 m/px) over the 200 m base DEM.

Patches are produced by scripts/fetch_dtm.py. Each patch has its own elevation and slope grid.
Slopes at 10 m are steeper than at 200 m for the same terrain (the coarse grid smooths cliffs),
so values change abruptly where a patch starts: that is real, not a seam bug.
"""

import glob
import os

import numpy as np

DTM_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "dtm")


def bilinear(grid, west, north, res_lat, res_lon, lat, lon):
    """Bilinear sample of `grid` at lat/lon arrays; NaN outside the grid or next to NaN cells."""
    fr = (north - np.asarray(lat, dtype=np.float64)) / res_lat - 0.5
    fc = (np.asarray(lon, dtype=np.float64) - west) / res_lon - 0.5
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


class FinePatch:
    def __init__(self, path: str):
        d = np.load(path)
        q = d["elevation"]
        elev = q.astype(np.float32) * float(d["step_m"]) + float(d["offset_m"])
        elev[q == int(d["nodata"])] = np.nan
        self.id = os.path.splitext(os.path.basename(path))[0]
        self.elevation = elev
        self.west = float(d["west"])
        self.north = float(d["north"])
        self.res = float(d["res_deg"])  # degrees of latitude per cell
        # degrees of longitude per cell (differs from `res` when the DTM projection is not centered on 0)
        self.res_lon = float(d["res_lon_deg"]) if "res_lon_deg" in d.files else self.res
        rows, cols = elev.shape
        self.bbox = (
            self.west, self.north - rows * self.res, self.west + cols * self.res_lon, self.north
        )
        radius = float(d["radius_m"])
        self.res_m = float(np.radians(self.res) * radius)

        lat = self.north - (np.arange(rows) + 0.5) * self.res
        dx = (np.radians(self.res_lon) * radius * np.cos(np.radians(lat)))[:, None]
        dz_drow, dz_dcol = np.gradient(elev)
        dz_dnorth = -dz_drow / self.res_m
        dz_deast = dz_dcol / dx
        self.slope = np.degrees(np.arctan(np.hypot(dz_dnorth, dz_deast))).astype(np.float32)

    def intersects(self, bbox) -> bool:
        b = self.bbox
        return b[0] < bbox[2] and b[2] > bbox[0] and b[1] < bbox[3] and b[3] > bbox[1]

    def sample(self, grid, lat, lon):
        return bilinear(grid, self.west, self.north, self.res, self.res_lon, lat, lon)


def load_patches(directory: str = DTM_DIR):
    paths = sorted(glob.glob(os.path.join(os.path.abspath(directory), "*.npz")))
    return [FinePatch(p) for p in paths]
