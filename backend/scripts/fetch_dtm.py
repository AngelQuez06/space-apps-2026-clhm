"""Download HiRISE DTMs (1 m/px) that overlap the Gale DEM window and reduce them to 10 m/px.

Source: public HiRISE PDS archive (https://hirise-pds.lpl.arizona.edu/PDS/DTM/), listed in
DTMCUMINDEX.TAB. Each DTM is an uncompressed PDS3 float32 raster of about 360 MB. The file is
streamed once and block-averaged 10x10 on the fly, so only the reduced result is kept.
Output: backend/data/dtm/<product id>.npz (uint16, 0.25 m steps, committed to git).

Usage: .venv/bin/python scripts/fetch_dtm.py [--factor 10] [--only DTEEC_...] [--list]
"""

import argparse
import csv
import io
import os
import re
import sys
import time

import numpy as np
import requests

BASE = "https://hirise-pds.lpl.arizona.edu/PDS"
INDEX_URL = f"{BASE}/INDEX/DTMCUMINDEX.TAB"
HERE = os.path.dirname(__file__)
DEM_PATH = os.path.join(HERE, "..", "data", "gale_dem.npz")
OUT_DIR = os.path.join(HERE, "..", "data", "dtm")
MISSING_BELOW = -1e30  # PDS missing constant is about -3.4e38
OFFSET_M = -5000.0
STEP_M = 0.25
NODATA = 65535


def dem_window():
    d = np.load(DEM_PATH)
    rows, cols = d["elevation"].shape
    res = float(d["res_deg"])
    west, north = float(d["west"]), float(d["north"])
    return (west, north - rows * res, west + cols * res, north)  # lon0, lat0, lon1, lat1


def select_dtms(window):
    """DTEEC rows of the PDS index that overlap `window`; one per orbit pair (latest version)."""
    text = requests.get(INDEX_URL, timeout=120).text
    best = {}
    for p in csv.reader(io.StringIO(text), skipinitialspace=True):
        p = [c.strip() for c in p]
        if len(p) < 20 or not p[4].startswith("DTEEC") or not p[1].upper().endswith(".IMG"):
            continue
        try:
            minlat, maxlat, minlon, maxlon = (float(p[15]), float(p[16]), float(p[17]), float(p[18]))
        except ValueError:
            continue
        if not (minlon < window[2] and maxlon > window[0] and minlat < window[3] and maxlat > window[1]):
            continue
        pid = p[4]
        pair = "_".join(pid.split("_")[1:5])
        if pair not in best or pid > best[pair]["id"]:
            best[pair] = {"id": pid, "path": p[1], "bbox": (minlon, minlat, maxlon, maxlat), "title": p[7]}
    return sorted(best.values(), key=lambda r: r["id"])


def read_label(url):
    head = requests.get(url, headers={"Range": "bytes=0-16383"}, timeout=60).content
    text = head.decode("latin-1")
    end = text.find("\r\nEND\r\n")
    lab = text[: end + 7]

    def num(key):
        m = re.search(rf"^\s*{re.escape(key)}\s*=\s*([-+0-9.eE]+)", lab, re.M)
        return float(m.group(1)) if m else None

    info = {
        "record_bytes": int(num("RECORD_BYTES")),
        "image_record": int(num("^IMAGE")),
        "lines": int(num("LINES")),
        "samples": int(num("LINE_SAMPLES")),
        "res": num("MAP_RESOLUTION"),  # pixels per degree
        "center_lon": num("CENTER_LONGITUDE"),
        "lpo": num("LINE_PROJECTION_OFFSET"),
        "spo": num("SAMPLE_PROJECTION_OFFSET"),
        "bits": int(num("SAMPLE_BITS")),
    }
    if info["bits"] != 32 or "PC_REAL" not in lab or "EQUIRECTANGULAR" not in lab:
        raise ValueError("unexpected DTM format")
    # Equirectangular with latitude of true scale CENTER_LATITUDE: a pixel spans 1/res degrees of
    # latitude and 1/(res*cos(center_lat)) degrees of longitude (checked against the label edges).
    info["center_lat"] = num("CENTER_LATITUDE")
    return info


def reduce_dtm(url, info, factor):
    s, n = info["samples"], info["lines"]
    cols = (s // factor) * factor
    offset = (info["image_record"] - 1) * info["record_bytes"]
    row_bytes = s * 4
    group_rows = factor * 8  # process 80 lines per chunk
    out = []
    resp = requests.get(url, headers={"Range": f"bytes={offset}-"}, stream=True, timeout=(30, 120))
    resp.raise_for_status()
    buf = b""
    rows_done = 0
    for chunk in resp.iter_content(chunk_size=1 << 20):
        buf += chunk
        while len(buf) >= row_bytes * group_rows and rows_done + group_rows <= n:
            block = np.frombuffer(buf[: row_bytes * group_rows], dtype="<f4").reshape(group_rows, s)
            buf = buf[row_bytes * group_rows :]
            rows_done += group_rows
            out.append(_block_mean(block[:, :cols], factor))
    rest = (min(n, rows_done + len(buf) // row_bytes) - rows_done) // factor * factor
    if rest > 0:
        block = np.frombuffer(buf[: row_bytes * rest], dtype="<f4").reshape(rest, s)
        out.append(_block_mean(block[:, :cols], factor))
    return np.vstack(out)


def _block_mean(block, factor):
    r, c = block.shape
    b = np.where(block < MISSING_BELOW, np.nan, block).reshape(r // factor, factor, c // factor, factor)
    valid = np.isfinite(b).sum(axis=(1, 3))
    total = np.nansum(b, axis=(1, 3))
    mean = np.where(valid >= (factor * factor) // 2, total / np.maximum(valid, 1), np.nan)
    return mean.astype(np.float32)


def save(pid, grid, info, factor, url):
    res_px_deg = info["res"]
    cos_c = np.cos(np.radians(info["center_lat"]))
    res_lat = factor / res_px_deg
    res_lon = factor / (res_px_deg * cos_c)
    # lat = (LPO - (line - 1)) / res (line 1 = top edge); lon = center_lon + (sample - SPO - 1) / (res*cos)
    north = info["lpo"] / res_px_deg
    west = info["center_lon"] - info["spo"] / (res_px_deg * cos_c)
    q = np.full(grid.shape, NODATA, dtype=np.uint16)
    ok = np.isfinite(grid)
    q[ok] = np.clip(np.round((grid[ok] - OFFSET_M) / STEP_M), 0, NODATA - 1).astype(np.uint16)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{pid}.npz")
    np.savez_compressed(
        path, elevation=q, west=west, north=north, res_deg=res_lat, res_lon_deg=res_lon, offset_m=OFFSET_M,
        step_m=STEP_M, nodata=NODATA, radius_m=3396190.0, source=url, factor=factor,
    )
    return path, west, north, res_lat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--factor", type=int, default=10)
    ap.add_argument("--only")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    window = dem_window()
    print("window lon/lat:", [round(v, 3) for v in window], flush=True)
    dtms = select_dtms(window)
    for d in dtms:
        print(d["id"], [round(v, 3) for v in d["bbox"]], "|", d["title"], flush=True)
    if args.list:
        return
    for d in dtms:
        if args.only and args.only != d["id"]:
            continue
        out = os.path.join(OUT_DIR, f"{d['id']}.npz")
        if os.path.exists(out) and not args.force:
            print("skip (exists)", d["id"], flush=True)
            continue
        url = f"{BASE}/{d['path']}"
        t = time.time()
        try:
            info = read_label(url)
            grid = reduce_dtm(url, info, args.factor)
            path, west, north, res = save(d["id"], grid, info, args.factor, url)
        except Exception as exc:  # keep going with the other DTMs
            print("FAILED", d["id"], repr(exc), flush=True)
            continue
        valid = float(np.isfinite(grid).mean())
        print(
            f"ok {d['id']} grid={grid.shape} valid={valid:.2f} west={west:.4f} north={north:.4f} "
            f"res={res:.6f} deg bytes={os.path.getsize(path)} {time.time() - t:.0f}s",
            flush=True,
        )


if __name__ == "__main__":
    sys.exit(main())
