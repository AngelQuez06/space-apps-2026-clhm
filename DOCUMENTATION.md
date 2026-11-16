# CLHM: Martian EVA route planner for Gale Crater

**NASA Space Apps Challenge 2026 · Mexico City**
Version: November 14, 2026

> CLHM is a demonstration and planning tool. Its routes and metrics are model estimates. It is not validated for real navigation or crew safety.

## 1. Summary

CLHM is a web map of Gale Crater and Mount Sharp (Mars) that works like a map app on Earth. You can zoom from the whole crater down to about 1 m per pixel, overlay terrain layers (slope, relief, thermal), and draw a route between two points. The system then reports the distance, walking time, oxygen use for a two-person crew, and radiation dose. A "solar storm" mode finds the fastest path to a natural shelter.

The website opens the stylized planner map with real sites and terrain-model segments from `/api/network`; its background contours are decorative. NASA/USGS geographic imagery is available from the map source selector. Data loads automatically, with a Retry button if the network is unavailable.

Imagery and elevation data come from public NASA and USGS sources. Route, oxygen, time, and dose values are model estimates, not validated safety data. No API keys are needed.

| | Address |
| --- | --- |
| Website (frontend) | https://www.clhm.cooking |
| API (backend) | https://api.clhm.study |
| Code | https://github.com/AngelQuez06/space-apps-2026-clhm |

## 2. Main features

| Feature | What it does |
| --- | --- |
| **Zoomable map** | Satellite imagery that gets sharper as you zoom in: about 232 m/pixel for all of Mars, about 6 m for Gale Crater, and down to about 1 m along Curiosity's route. |
| **Map modes** | Approximate color satellite (grayscale fallback), MOLA relief, and THEMIS night thermal. |
| **Slope layer** | Colors terrain by steepness: green (0–10°), yellow (10–15°), orange (15–20°, no rover), red (more than 20°, no walking). |
| **Data quality layer** | Shows in blue where we have fine 10 m terrain data. The rest uses coarse 200 m data. |
| **Radiation layer** | Modeled surface dose rate in mSv/day: the Curiosity RAD baseline (0.364) × the terrain shielding factor. Teal = shielded by walls (0.237), yellow = open ground (0.364), red = exposed ridge (0.418). It is a model, not a measurement at each point. |
| **Overlays in every mode** | Slope, Radiation, and Data quality are picked with one selector (one at a time, click again to hide) on the planner map and on every geographic map, with a legend. Geographic maps use tiles; the planner map uses one image for its whole area (`area.png`). |
| **Scale bar** | Shown in every mode. On geographic maps it follows the zoom and latitude (5 m to 100 km). |
| **Terrain inspector** | Click any point to see its elevation, slope, risk class, modeled dose rate, and which data source was used. |
| **Route planner (every mode)** | Two kinds of route on any map (planner, satellite, relief, thermal): **Gale sites** (dropdowns or a click on a site) or **two free points** (one click for A, one for B; calculated automatically). While picking, clicking a site snaps the point to that site. The 15 sites are drawn in every mode, and entering a geographic map frames the active route. |
| **Full details and profile** | For both kinds of route and in every mode: distance, time, O₂, dose, risk, sections, alternatives, and an elevation profile along the real A* path, with the riskiest section. |
| **Human exposure context** | Route details place an illustrative figure beside the modeled route dose, Curiosity RAD's measured silicon absorbed-dose median (0.1227 mGy/day, January 1–November 11, 2026), and NASA's less-than-600 mSv career effective-dose standard. These are different quantities: no percentage of the limit or personal/organ dose is inferred. |
| **Mobility modes** | Rover (stricter: 15° maximum slope, avoids loose sand), On foot (20° maximum), and Storm shelter. |
| **Solar storm mode** | Needs only a start point. It finds the fastest route to the nearest natural shelter, with radiation 18 times the normal level. |
| **Route metrics** | Distance (km), time (minutes), oxygen (kg, two crew), and radiation dose (mSv). |
| **Guided journey** | Splits the route into up to 8 sections. The optional voice view automatically chooses an English browser voice, welcomes the visitor, then reads route information and subsequent sections aloud. |
| **Planner map (real network)** | The stylized map loads 15 Gale sites and 23 terrain-model segments from `GET /api/network`; unavailable data shows a retry state rather than a fictional route. The geographic NASA/USGS view remains available. |
| **Export** | Saves the plan as a JSON file. |

## 3. How it works

```
 User's browser
      │
      ▼
 Frontend (static HTML/CSS/JS) ── hosted on Vercel ── www.clhm.cooking
      │   /api/* is forwarded by Vercel to the backend
      ▼
 Backend (Python + Flask) ── Google Cloud Run ── api.clhm.study
      │   • Serves map tiles (with cache)
      │   • Calculates slope and terrain data
      │   • Calculates routes (A* algorithm)
      ▼
 Public data sources
      • JPL Mars Trek (images, downloaded on demand)
      • USGS and HiRISE (elevation, preprocessed and stored with the code)
```

- **Frontend:** plain HTML, CSS, and JavaScript, without frameworks. It draws its own tile map, so it does not depend on Google Maps or Leaflet.
- **Backend:** Flask, running with gunicorn inside a Docker container.
- **Map grid:** geographic coordinates (EPSG:4326), with 2 × 1 tiles of 256 px at zoom 0, the same scheme Mars Trek uses.

## 4. Algorithms

### 4.1 Level of detail (sharper as you zoom)
The satellite layer stacks three image sources and draws the finest one available on top:

| Source | Resolution | Coverage | Native maximum zoom |
| --- | --- | --- | --- |
| Viking MDIM 2.1 (color) | 232 m/px | All of Mars | 7 |
| MRO CTX, Gale mosaic | ~6 m/px | Gale Crater | 12 |
| MRO HiRISE, Curiosity mosaic | ~0.25–1 m/px | Curiosity's route | 16 |

Past each source's maximum zoom, the backend enlarges its finest image up to 3 more levels, to zoom 19.

### 4.2 Approximate color
CTX and HiRISE images are black and white. To add color, the backend takes the brightness from CTX/HiRISE and the color from Viking (a technique called pansharpening). Brightness is multiplied by 0.76 so both match, a factor measured over 54 Gale tiles. **The color is approximate, not a measurement of the real rock color.**

### 4.3 Slope
For each cell of an elevation grid, slope is the angle of steepest change in height, calculated from the neighboring cells. It accounts for the shorter east-west distance per degree away from the equator.

**Two levels of detail:**
- **Base:** 200 m/px grid (USGS HRSC+MOLA) covering 137.20–138.40°E and 6.20–4.60°S, about 120 × 180 km.
- **Fine:** 22 HiRISE elevation models reduced from 1 m to 10 m/px. They cover 15.2% of that window. Wherever they exist, they replace the base value.

**Why it matters:** in the same places, 10 m data shows 13.7% of the terrain above 20°, against 2.5% in the 200 m data. The coarse grid smooths out cliffs and underestimates steep ground about five-fold.

### 4.4 Derived hazard layers (for routing)
- **Loose sand (`sand_ripple`):** very flat cells (less than 1.8°) at least 2 m below their neighbors, where wind-blown sand tends to collect. Rovers avoid them. This is an estimate from elevation only.
- **Wall shielding (`cliff_shielding`, 0 to 1):** how close a cell is to steep walls or high relief.
- **Radiation factor (0.65 to 1.15):** walls reduce exposure by up to 35%. Exposed ridges increase it by 15%. The exact formula is in 4.9.
- **Natural shelter (`is_shelter`):** passable cells next to very steep walls with at least 55 m of relief. About 7.4% of cells qualify.

### 4.5 Route search: weighted A*
The terrain is treated as a grid where each cell connects to its 8 neighbors. A* finds the lowest-cost path.

**Cost of each step (normal mode):**
`cost = distance × (1 + 0.08 × cell slope + 0.12 × uphill slope + 0.6 × radiation factor)`

So the route prefers short, flat, and shielded paths. Cells above the slope limit, or loose sand with the rover, cannot be entered.

**Solar storm mode:** it minimizes travel time and stops at the first shelter reached, a Dijkstra-style search with no fixed destination.

**Performance:** typical routes take 0.05–0.6 s. A 47 km route took 0.58 s, and an evacuation took 0.03 s.

### 4.6 Planner network (real sites and segments)
`backend/scripts/build_network.py` builds the network once and saves it as `backend/data/network.json`, which takes about 6 s:
- **Sites:** Curiosity positions at known sols (boxwork first approach at sol 4570, main boxwork area at sol 4623, latest position), HiRISE science targets (center of each official DTM), Mars Trek landmarks, a modeled habitat (flattest firm ground next to the first traverse point inside the block), and two modeled natural shelters.
- **Segments:** each site connects to its 3 nearest sites. Each link is an A* route on foot, plus a rover check. A pair is dropped when no route exists, as with the original quadrant.
- **Segment risk (0–100):** `100 × (0.50 × min(1, max slope / 30°) + 0.35 × min(1, 4 × share above 15°) + 0.15 × min(1, 5 × sand share))`, using the finest slope data at each path point.

### 4.7 Route metrics

| Metric | How it is calculated |
| --- | --- |
| Speed | 1.4 m/s (rover) or 1.25 m/s (on foot), reduced by slope, with a minimum of 25% |
| Oxygen | 0.11 kg/h for two crew, plus 4% per degree of uphill slope |
| Radiation | 0.364 mSv/day, measured by Curiosity RAD in 2026 (see 4.8), × radiation factor, × 18 during a storm (modeled scenario) |

### 4.8 Real radiation baseline (Curiosity RAD)
`backend/scripts/fetch_rad.py` downloads Curiosity's Radiation Assessment Detector (RAD) Level 2 dosimetry from NASA SPDF, one file per day, and saves the result to `backend/data/rad_baseline.json` (66 KB):
1. **Daily dose:** for each day, it averages the "RTG Corrected Dose B" column, which is the silicon detector with Curiosity's own nuclear power source removed. Observations are weighted by their measuring time, and flagged observations are excluded.
2. **Baseline:** the median of 315 days (January 1 to November 11, 2026, sols 4765–5071) is 0.123 mGy/day.
3. **Tissue:** converted from silicon using the measured ratio between the tissue-equivalent detector and the silicon detector (0.972), which gives 0.119 mGy/day.
4. **Dose equivalent:** multiplied by the mean quality factor 3.05 published by the RAD team (Hassler et al., 2014, *Science*), which gives **0.364 mSv/day**. The quality factor is not in the Level 2 file.

Days varied by 7.9%. The highest day (November 6) was 1.09 times the median, so no strong solar storm was recorded in 2026. The previous constant (0.64 mSv/day) came from 2012–2013, near solar minimum. In 2026 the Sun is close to its maximum, which reduces the cosmic rays that reach Mars.

### 4.9 Radiation index per place
Every 200 m cell of the terrain grid gets a **radiation factor**, a number without units where 1.0 means open, flat ground. The backend computes it once at startup (`Terrain.__init__` in `backend/app/terrain.py`) from the HRSC+MOLA elevation model, looking at the 8 cells around each cell:

1. **Wall score:** `clip((steepest neighbor slope − 14°) / 14°, 0, 1)`. It is 0 at 14° and reaches 1 at 28°.
2. **Relief score:** `clip(height of the highest neighbor above the cell / 45 m, 0, 1)`.
3. **Shielding** (`cliff_shielding`): the larger of the two scores, from 0 to 1.
4. **Ridge exposure:** +0.15 when the cell is more than 25 m above the mean of its neighbors, otherwise 0.
5. **Factor:** `clip(1 − 0.35 × shielding + ridge exposure, 0.65, 1.15)`.

**Dose rate at a place** = RAD baseline (0.364 mSv/day, see 4.8) × factor:

| Place | Factor | Dose rate |
| --- | --- | --- |
| Foot of a wall (≥ 28° next to it or ≥ 45 m of relief) | 0.65 | 0.237 mSv/day |
| Open, flat ground | 1.00 | 0.364 mSv/day |
| Exposed ridge | 1.15 | 0.418 mSv/day |

These are the three values in the Radiation layer legend. `GET /api/terrain/point` returns `radiation_factor` and `dose_rate_msv_day` for any point, and the Radiation layer samples the same grid for each pixel.

**From place to route:** for each step of an A* path, the dose is `step hours × (0.364 / 24) × factor of the cell entered`, multiplied by 18 during a solar storm (modeled scenario). The route dose is the sum of all steps. Planner segments use the same calculation on foot (`foot.radiation_dose_msv` in `network.json`), and a planner route adds up its segments.

The same factor also enters the route cost (`0.6 × factor`, see 4.5), and it defines natural shelters (shielding ≥ 0.95 and at least 55 m of relief, see 4.4). It uses only the 200 m grid, not the 10 m patches; see the limitation in section 9.

## 5. Data sources

| Data | Provider | Used for |
| --- | --- | --- |
| Viking, CTX, and HiRISE images | NASA/JPL Mars Trek (WMTS) | Satellite map |
| MGS MOLA color hillshade | NASA/JPL Mars Trek | Relief mode |
| THEMIS night infrared (~100 m) | NASA/JPL Mars Trek | Thermal mode (dark means fine material, bright means rock) |
| HRSC+MOLA blended DEM, 200 m v2 | USGS Astrogeology | Base slope and elevation |
| 22 HiRISE DTMs, 1 m, reduced to 10 m | HiRISE PDS archive (University of Arizona) | Fine slope and elevation |
| Curiosity RAD Level 2 dosimetry, 315 days of 2026 | NASA SPDF (`msl/rad/cdf/obs-l2`), RAD PI D. Hassler, SwRI | Real radiation baseline for route dose |
| Mean quality factor 3.05 | Hassler et al. (2014), *Science* 343 | Absorbed dose to dose equivalent |
| Curiosity traverse, 1,389 points (sol 3 to 5073) | NASA MMGIS (`MSL_waypoints.json`) | Real planner sites (boxwork area, latest position) |
| HiRISE target descriptions | HiRISE PDS DTM index | Names of the science-target sites |

All of these are public and free. Images are downloaded on demand and cached. Elevation data was processed once and stored with the code (about 19 MB).

## 6. API (backend endpoints)

| Endpoint | Returns |
| --- | --- |
| `GET /api/health` | Service status |
| `GET /api/zone` | Zone name, center (5.4°S, 137.8°E), area of interest (the whole block), and the original quadrant |
| `GET /api/layers` | List of map layers with their URL templates |
| `GET /api/tiles/{layer}/{z}/{x}/{y}.{ext}` | Map tile image |
| `GET /api/terrain/slope/{z}/{x}/{y}.png` | Slope overlay tile |
| `GET /api/terrain/quality/{z}/{x}/{y}.png` | Data quality overlay tile |
| `GET /api/terrain/radiation/{z}/{x}/{y}.png` | Modeled radiation overlay tile |
| `GET /api/terrain/{slope\|radiation\|quality}/area.png?bbox=w,s,e,n&width=&height=` | One overlay image for a lat/lon box (max 1200 px, 10°), used by the planner map |
| `GET /api/terrain/point?lat=&lon=` | Elevation, slope, class, resolution, source, `radiation_factor`, and `dose_rate_msv_day` at a point |
| `GET /api/terrain/info` | Terrain coverage and list of fine patches |
| `POST /api/route` | Route path and metrics |
| `GET /api/network` | Real planner network: sites, A* segments, and a `demo` key with the same shape as the old demo data |
| `GET /api/radiation` | Real RAD radiation baseline, method, and daily series (`?days=0` omits the series) |

Example route request:
```json
{ "start": {"lat": -5.927, "lon": 137.40}, "end": {"lat": -5.927, "lon": 137.749},
  "rover_support": true, "solar_storm": false }
```

## 7. Infrastructure and security

- **Hosting:** Google Cloud Run (us-central1, 1 GiB memory, at most 3 instances) with HTTPS and a Google-managed certificate. The frontend runs on Vercel, which forwards `/api/*` to the backend.
- **Domains:** `clhm.study` (from the GoDaddy sponsorship) for the API, and `clhm.cooking` for the website.
- **CORS:** the API only accepts browser requests from `clhm.study`. The website uses the Vercel forwarding, so it does not need its own exception.
- **Rate limits per IP:** 120 requests per minute in general, 1200 for tiles, and 10 for routes. Going over returns error 429.
- **Other protections:** security headers and HSTS, the container runs as an unprivileged user, only GET/POST are allowed, inputs are validated, and there are no secrets in the code.
- **Data storage:** there is no database, because the product has no user accounts or saved data (the per-user radiation diary in section 10 would change this). Tiles are cached in the instance's temporary memory.

## 8. Advantages

- **Real data, no cost:** everything comes from NASA, JPL, and USGS, with no API keys and no paid services besides hosting.
- **Detail where it exists:** imagery reaches about 1 m/px, and terrain reaches 10 m in the zones with HiRISE models. The rest is still covered at 200 m.
- **Honest about uncertainty:** each point reports its resolution and source, and the data quality layer shows where the data is fine or coarse.
- **Fast:** routes take less than a second, and the map loads only the tiles visible on screen.
- **Mission-oriented:** the slope limits (15° rover, 20° on foot), the two-crew oxygen estimate, radiation, and storm shelters come from the challenge specification.
- **Simple and portable:** a static frontend and a small backend, deployable in minutes, with HTTPS, CORS, and rate limits.

## 9. Disadvantages and limitations

- **The original 5 × 5 km quadrant cannot be routed.** It sits on the north flank of Mount Sharp, with a mean slope of 28°, and only 2.3% of its cells are passable for a rover. Since the area of interest is now the whole block, it remains only as a landmark.
- **Bradbury Landing is outside the block.** Curiosity's landing site is about 0.8 km north of the block edge, so the planner network uses a modeled habitat at the first traverse point inside the block instead.
- **High risk on most real segments.** With 10 m slopes, most planner segments score 60 or more, so "avoid high risk" often finds no route. This reflects the steep terrain of the Mount Sharp foothills.
- **Routes use only the 200 m grid.** They do not yet use the 10 m patches, so they may cross steep ground that the fine data would block.
- **Coarse terrain in most of the area:** at 200 m, slopes are underestimated and small obstacles (rocks, small craters) are invisible.
- **Metrics are simple models:** speed and oxygen use fixed constants, not real crew or rover telemetry.
- **Radiation is measured, but simplified:** the baseline is a 2026 median from Curiosity, measured at one moving location and applied to the whole block. The quality factor comes from the literature, the solar-storm factor (× 18) is a modeled scenario, and the value is not live space weather. It must be rebuilt with `fetch_rad.py` to stay current.
- **The radiation layer leans toward "shielded".** The terrain factor treats steep 200 m cells as walls, so 25% of the block is at the lowest value (≤ 0.66), 72% is between 0.66 and 0.99, 2.6% is open ground, and no cell reaches "exposed ridge". A sky-view model (how much sky each point sees) would be more realistic.
- **Approximate hazards:** loose sand and shelters are estimated from elevation only. THEMIS is a visual guide, not calibrated thermal inertia.
- **Approximate color:** it is tinted from a low-resolution source.
- **Dependence on Mars Trek:** new tiles are downloaded from NASA, and the cache is lost when an instance restarts. Heavy traffic or a Mars Trek outage would slow the map.
- **Planner map:** site coordinates and segment metrics derive from NASA/USGS terrain sources, while the background art is decorative. The habitat and shelters are modeled proposals; route estimates are not validated for navigation or safety.
- **Voice on Linux:** the voice view needs the operating system's text-to-speech. On Linux Firefox, that means installing `speech-dispatcher` and `espeak-ng`.
- **Scale:** rate limits are per instance, and route search uses CPU in pure Python. This is fine for a demo, but it would need work for hundreds of users.

## 10. Opportunities for improvement

| Priority | Improvement | Benefit |
| --- | --- | --- |
| High | Use the 10 m patches in route search (coarse route first, then refine in a corridor) | Safer, more realistic routes |
| High | Extend the block about 1 km north (and ideally to the full crater) so Bradbury Landing and the whole crater rim fit | Landing site usable in routes |
| Medium | Compute the quality factor from RAD's LET spectrum, and refresh the RAD baseline automatically | Fully measured dose equivalent that stays current |
| Medium | Accumulated radiation diary per user (details below) | Each crew member sees their running dose against mission limits before accepting a new EVA |
| Medium | Add APXS rock composition as science waypoints (already identified in `Resources`) | Real targets for sampling |
| Medium | Add rover photos (Mastcam/Navcam) at waypoints | First-person preview, as the specification asks |
| Medium | Use CRISM minerals and THEMIS thermal inertia in route cost | Better detection of sand and boxwork targets |
| Medium | Pregenerate tiles into a Cloud Storage bucket with a CDN | Faster, independent of Mars Trek, ready for more users |
| Low | Add a cap to the tile cache | Avoids filling memory |
| Low | Move route search to compiled code (SciPy or Numba) | More users at once |
| Low | Detect rocks and small craters from HiRISE images | Hazards the elevation data cannot see |

**Accumulated radiation diary per user (future opportunity).** Today each route reports only its own dose. The diary would keep a per-person log:
- **Entries:** one per EVA, with date or sol, route, planned dose (`radiation_dose_msv` from the route) and, after the walk, the completed dose. Time inside the habitat would be added at a shielded rate.
- **Totals:** daily, 30-day, yearly and mission totals. They would be compared with the limits the mission sets; for reference, NASA's career limit is 600 mSv (NASA-STD-3001).
- **In the planner:** before an EVA is accepted, show "this route adds X mSv; your 30-day total would be Y". Warn when a route would cross a limit, and give storm days their own line.
- **Implementation:** a first version can store the diary in the browser (`localStorage`) with no accounts. A shared crew diary needs user accounts and a small database. That data is personal health data, so it needs access control, encryption, and consent.

## 11. Run it locally (short)

```bash
# Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # keep CORS_ORIGINS=* only for local use
.venv/bin/python run.py       # http://127.0.0.1:5000

# Frontend (in another terminal)
python3 -m http.server 8000 --directory frontend
# open http://127.0.0.1:8000/index.html?api=http://127.0.0.1:5000
```

Deployment steps are in `backend/DEPLOY.md`. Data scripts are `backend/scripts/fetch_dem.py` and `backend/scripts/fetch_dtm.py`.

## 12. Team

- **Imanol:** backend, NASA/USGS data processing, deployment, and pitch deck
- **Angel (AngelQuez06):** route engine (A*) and presentation
- **setzedich:** frontend
- **Karina:** data research (see `Resources/README.md`)
