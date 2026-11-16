# CLHM frontend

Static interface for Mount Sharp in Gale Crater. It opens the stylized planner map with real sites and terrain-model segments from `/api/network`, keeping CLHM's terracotta and green palette. The map source selector also offers NASA/USGS geographic imagery and point-picked routes from `/api/route`.

**Site coordinates and segment data come from NASA/USGS-derived sources; route metrics are model estimates, not validated safety data.** The habitat and shelters are modeled proposals. The base DEM is about 200 m/pixel outside fine HiRISE patches and may miss local slopes and obstacles. Do not use CLHM for real navigation. Live weather and Mastcam/Navcam imagery are not connected.

CLHM connects automatically. The planner map uses real network values and presents **Relief** (decorative contours), **Risk** (terrain-model segment scores), and **Science** (actual science-target positions) display controls. The background art remains illustrative. The map source selector switches to geographic imagery; approximate color combines grayscale CTX/HiRISE detail with Viking color and **is not a direct measurement of local surface color**. Every map mode (planner and geographic) offers one terrain overlay at a time, **Slope**, **Radiation** (modeled dose rate: Curiosity RAD baseline × terrain shielding), or **Data quality** (10 m HiRISE vs 200 m DEM), with a legend, plus a scale bar.

When `/api/layers` advertises `themis_night`, the geographic selector includes THEMIS night infrared. It depicts nighttime brightness (about 100 m/pixel at native resolution), a qualitative surface clue rather than calibrated temperature or a safety measure.

The **Sources and limitations** section explains the imagery and model limits. If `/api/network` fails, the stylized map shows **Retry data** instead of fictional routes. Geographic tile failures show **Retry map**. The tile viewer requests only visible tiles.

The real network supplies 15 sites and 23 segments. The old spatial radiation circles are not shown because a measured baseline is not a location-specific radiation map. The connection button is removed; the data loads automatically.

**Two kinds of route, on every map.** The planner map, satellite, relief and THEMIS views all share one *active route*:
- **Gale sites (A in the planner panel):** pick start and destination in the dropdowns or click a site marker. Routes, Balanced / Fastest / Lowest risk alternatives and metrics come from `/api/network`. **Avoid high risk** can return no feasible route.
- **Custom points (B in the planner panel):** the first map click sets start (A), the second destination (B), and `/api/route` calculates automatically, on the planner map too (clicks are converted with the same projection as the backend). While a pick is armed, clicking a site or its label snaps the point to that site. Rover / On foot / Storm shelter, Pick start / Pick destination and Clear points work in every mode; Clear points returns to the site route. Rover routes reject loose-sand cells, so a click can be refused even on flat ground.

The 15 Gale sites are drawn on the geographic maps with the planner style (labels skip when they would overlap), and the active route is drawn on both the planner map and the geographic maps. Entering a geographic map from the planner frames the active route.

The **Mission profile** samples elevation along the real A* path (site routes chain each segment's path; custom routes use the returned path) and colors each section by modeled risk. It is available in every mode, for both kinds of route.

**Human exposure context** appears below the route dose. Its person silhouette is illustrative, not an anatomical map. The measured value is the RTG-corrected silicon absorbed-dose median from Curiosity RAD Level 2 observations (2026-01-01 through 2026-11-11); `assets/rad-reference.json` is a small dated copy of the corresponding fields in `backend/data/rad_baseline.json`. If `/api/radiation?days=0` provides a newer, valid NASA observation, the card uses it. The NASA-STD-3001 career standard of **less than 600 mSv effective dose** is cited separately. The measured silicon dose, CLHM's modeled route dose, and NASA's career effective-dose standard are different quantities: the interface does not calculate a percentage of a career limit or claim a personal or organ dose. The linked 2021 OCHMO overview supplied the reference, and the current NASA-STD-3001 page confirms the career standard.

The map stays central while a **Mission details** sheet slides in from the right on desktop or up from the bottom on narrow screens. The compact **Route** button opens Route, Profile, and Sources in every map mode. Route values come from network segment metrics or a feasible `/api/route` response. The sheet closes by button, backdrop, or Escape and supports keyboard navigation.

The route planner on the left can also slide closed using its header chevron or the route icon in the narrow navigation rail. On desktop this gives its width back to the map; on phones it starts closed and opens as a left overlay, with a backdrop that closes it. The route icon remains available and its expanded state is exposed to assistive technology. Choosing a geographic point or clearing points closes the mobile drawer so the map is ready for the next click. Returning to desktop width restores the open planner.

**Start guided journey** switches to a slightly lighter charcoal and sage palette and opens an Earth guidance card. It narrates network legs or up to eight sections of a point-picked geographic path. This is a timed walkthrough of a modeled route: there is no live location, hazard detection, or actual movement tracking. Closing voice view stops speech; changing the route ends the walkthrough.

The voice view automatically selects the calmest English voice the browser reports (`assets/voice-choice.js`). It prefers neural and premium voices (Edge "Online (Natural)", Apple "Enhanced"/"Premium", Chrome "Google"), then well-known clear voices such as Aria, Ava or Samantha, and penalizes novelty or robotic voices (macOS/iOS Albert, Zarvox, Bad News, Eloquence voices, eSpeak variants such as Robosoft). It speaks slightly slower than normal (rate 0.9–0.94), keeps neural voices at their natural pitch, and queues the narration as short sentence groups, which adds natural pauses and avoids Chrome cutting off its network voices after about 15 seconds. When opened, it welcomes the visitor in English, explains that it will share route information, then narrates the current route section; subsequent sections continue automatically unless paused. It waits briefly for late-loading voices and spells CLHM and EVA as initials. If the device has no English voice, CLHM keeps the directions readable and asks the visitor to add one instead of using a Spanish default voice. Voice quality depends on the browser and installed voices; no external voice service or key is required.

On phones, the companion launcher and voice sphere keep a circular outline at small viewport sizes. The liquid light inside continues to move; short screens can scroll the voice view instead of squeezing the sphere. The voice view shows section progress and uses concise, touch-sized Replay, Pause/Resume, and Next controls; Pause also stops the current browser narration until Resume. The Earth notice keeps its actions in a clear row on phones.

## Run locally

Serve `frontend/` locally or open it on Vercel. The planner and geographic maps require the CLHM service. On `clhm.cooking`, `www.clhm.cooking`, and `*.vercel.app`, requests use same-origin `/api`, forwarded by Vercel to `https://api.clhm.study`. Local development requires an allowed origin in `CORS_ORIGINS` or a same-origin proxy.

For development with another service, open `index.html?api=https://your-backend.example` or edit `assets/config.js`.

Run the frontend tests with:

```bash
node --test frontend/tests/*.test.cjs
```

## Deploy to Vercel

When importing this repository, set **Root Directory** to `frontend` and **Framework Preset** to **Other**. No build command is needed. `vercel.json` publishes this directory and forwards `/api/*` to `https://api.clhm.study/api/*` through the site's domain. Add `clhm.cooking` under **Settings → Domains** in the Vercel project and apply the exact DNS records Vercel provides in Porkbun. The backend remains at `api.clhm.study`.

## Current backend contract

The connection requests `/api/zone` and `/api/layers`. Tiles come from `/api/tiles/{layer}/{z}/{x}/{y}.{ext}` (including `satellite_color` when advertised), and overlays come from `/api/terrain/{slope|radiation|quality}/{z}/{x}/{y}.png` on geographic maps and from one `/api/terrain/{kind}/area.png?bbox=w,s,e,n&width=1000&height=700` image on the planner map (bbox = the planner canvas corners, unprojected). Clicking the geographic map calls `/api/terrain/point?lat=&lon=`. The viewer uses the backend's EPSG:4326 grid with 2 × 1 tiles at zoom 0.

The geographic planner posts `{start: {lat, lon}, end: {lat, lon}, rover_support, solar_storm}` to `/api/route`. Storm shelter mode omits `end` and lets the backend find a modeled shelter. A feasible response supplies `path` waypoints with latitude, longitude, and DEM slope plus `metrics.distance_m`, `metrics.estimated_time_min`, `metrics.o2_consumption_kg`, and `metrics.radiation_dose_msv`. Oxygen is displayed in modeled kilograms for two crew. The route line, stage guidance, metrics, and geographic JSON export use only this response. An unavailable endpoint shows an explicit error; no demo path is presented as a geographic route.

On November 14, 2026, both `https://api.clhm.study/api/network` and the website's `/api/network` returned the real Gale network, and both `/api/route` endpoints returned the documented 21.19 km path with 105 waypoints. `/api/radiation` had not yet reached the public deployment at this check; the interface does not present its 2026 RAD baseline as a spatial map.

The exported plan uses English JSON field names. Consumers of earlier Spanish exports must update their field mapping.
