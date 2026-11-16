# Resources: NASA data research

Data research by **Karina**, with additions from the team while building the backend. Everything listed here is public and needs no API key.

## Portals
- **JPL Mars Trek** (https://trek.nasa.gov/mars/): NASA web portal for Mars exploration, with data from the landing sites.
- **USGS-NASA Planetary Geologic Mapping Program** (https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars): standardized geologic maps of Mars.
- **NASA Worldview** (https://worldview.earthdata.nasa.gov/): satellite imagery explorer, part of NASA Earthdata.
- **Mars Perseverance raw images** (https://mars.nasa.gov/mars2020/multimedia/raw-images/): over a million rover images of the Martian surface.

## Files in this folder
| File | Data | Source | Use |
| --- | --- | --- | --- |
| `msl_rad_obs-l2_2026001_v06.cdf` | Curiosity RAD Level 2 dosimetry, day 1 of 2026 | NASA SPDF, `https://spdf.gsfc.nasa.gov/pub/data/aaa_planetary/msl/rad/cdf/obs-l2/2026/` | Sample of the set used for the real radiation baseline (`backend/scripts/fetch_rad.py`) |
| `ds01_2020je006536rr.csv`, `.xml` | APXS elemental composition, sols 0–2301 (Berger, 2020) | PDS Geosciences Node | Candidate geological points of interest for sampling |
| `ESP_019777_1745_COLOR.LBL` | Label of a HiRISE color image of Gale | HiRISE PDS archive | Reference; the image itself (JP2) is not stored here |
| `t0902_mrral_05s138_0327_4.hdr` | Header of a CRISM MRDR (multispectral) tile | PDS Geosciences Node | Reference for boxwork and sulfate targets; the image is not stored here |
| `I35862016BTR.IMG` | THEMIS infrared strip (320 × 7184 px, centered near 2.3° S, 138.3° E) | THEMIS PDS archive | Reference; the app uses the THEMIS night mosaic from Mars Trek instead |

Large rasters are not stored in the repository. The HiRISE DTM `DTEEC_001488_1750_001752_1750_U02` (360 MB) and the other 21 DTMs used by the app are public at https://hirise-pds.lpl.arizona.edu/PDS/DTM/ (index: https://hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB); `backend/scripts/fetch_dtm.py` downloads them and keeps a 10 m version in `backend/data/dtm/`.

## Data used by the app
- **Map tiles: JPL Mars Trek WMTS.** `https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{row}/{col}.{png|jpg}` (EPSG:4326, zoom 0 = 2 × 1 tiles of 256 px). Layers: `Mars_Viking_MDIM21_ClrMosaic_global_232m`, `Gale_CTX_BlockAdj_dd`, `curiosity_hirise_mosaic`, `Mars_MGS_MOLA_ClrShade_merge_global_463m`, `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`. The backend proxies and caches them (`backend/app/tiles.py`).
- **Elevation (200 m): USGS HRSC+MOLA blended DEM v2.** `https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif`, read by window (`backend/scripts/fetch_dem.py`, saved in `backend/data/gale_dem.npz`).
- **Elevation (10 m): 22 HiRISE DTMs** reduced from 1 m (`backend/scripts/fetch_dtm.py`, 19 MB in `backend/data/dtm/`).
- **Radiation: Curiosity RAD Level 2**, 315 days of 2026, variable `DOSIMETRY_TOTAL` column "RTG Corrected Dose B", which removes the radiation of Curiosity's own nuclear power source (`backend/scripts/fetch_rad.py`, result in `backend/data/rad_baseline.json`). Median 0.1227 mGy/day (silicon), 0.364 mSv/day with quality factor 3.05 (Hassler et al., 2014).
- **Curiosity traverse: NASA MMGIS.** `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json` (1,389 points with sol, latitude, longitude, and elevation), used for the planner sites (`backend/scripts/build_network.py`).

## Original study quadrant
5 km × 5 km centered on Mount Sharp (5.4° S, 137.8° E): latitude −5.44° to −5.36°, longitude 137.76° to 137.84°. The area of interest was later extended to the whole terrain block (longitude 137.20–138.40° E, latitude 6.20–4.60° S); see `PROBLEM_BACKGROUND.md`.
