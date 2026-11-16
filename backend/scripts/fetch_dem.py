"""Download a DEM window around Gale Crater from the USGS HRSC+MOLA blend (200 m/px).

Source: https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif
(geographic, int16 metres, strip layout without overviews, so the read takes a few minutes).
Output: backend/data/gale_dem.npz (committed so teammates do not need to refetch).

Usage: .venv/bin/python scripts/fetch_dem.py [min_lon min_lat max_lon max_lat]
"""

import os
import sys

import numpy as np
import rasterio
from rasterio.windows import Window

URL = (
    "/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/"
    "Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
)
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "gale_dem.npz")
DEFAULT_BBOX = (137.2, -6.2, 138.4, -4.6)  # lon/lat, covers Mount Sharp and the traverse


def main(bbox):
    min_lon, min_lat, max_lon, max_lat = bbox
    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"
    ):
        with rasterio.open(URL) as ds:
            res = ds.res[0]
            row0, col0 = ds.index(min_lon, max_lat)  # top-left
            row1, col1 = ds.index(max_lon, min_lat)  # bottom-right
            win = Window(col0, row0, col1 - col0 + 1, row1 - row0 + 1)
            data = ds.read(1, window=win)
            west, north = ds.xy(row0, col0, offset="ul")
            nodata = ds.nodata
    data = data.astype(np.int16)
    print("shape", data.shape, "min/max", data.min(), data.max(), "nodata", nodata)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    np.savez_compressed(
        OUT,
        elevation=data,
        west=west,
        north=north,
        res_deg=res,
        nodata=int(nodata),
        radius_m=3396190.0,
    )
    print("saved", os.path.abspath(OUT), "bytes", os.path.getsize(OUT))


if __name__ == "__main__":
    args = [float(a) for a in sys.argv[1:5]]
    main(tuple(args) if len(args) == 4 else DEFAULT_BBOX)
