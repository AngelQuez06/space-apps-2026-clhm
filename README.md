# CLHM: Interplanetary Survival Guide (Martian Map)

**NASA Space Apps Challenge 2026 · Mexico City**

CLHM is a live EVA route planner for Mount Sharp in Gale Crater, Mars, built on real NASA and USGS open data. It works like a map app on Earth: choose a science target and CLHM returns a safe route with its distance, time, oxygen for a two-person crew, and radiation dose. It also simulates a solar storm and finds the fastest path to a natural shelter.

> Routes and metrics are model estimates. CLHM is not validated for real navigation or crew safety.

## Live links
- **Web app:** https://www.clhm.cooking
- **API:** https://api.clhm.study (health check: `/api/health`)

## Repository
| Path | Contents |
| --- | --- |
| [`frontend/`](frontend/README.md) | Web app (static HTML/CSS/JS, deployed on Vercel) |
| `backend/` | Flask API: map tiles, terrain layers, A* route search, Curiosity RAD radiation ([deploy guide](backend/DEPLOY.md)) |
| `backend/scripts/` | Scripts that download and process the NASA/USGS data |
| `backend/data/` | Processed terrain (200 m DEM, 22 HiRISE DTMs at 10 m), radiation baseline, and planner network |
| [`DOCUMENTATION.md`](DOCUMENTATION.md) / [`DOCUMENTACION.md`](DOCUMENTACION.md) | Full technical documentation in English / Spanish: algorithms, data sources, API, limitations |
| [`PROBLEM_BACKGROUND.md`](PROBLEM_BACKGROUND.md) | Challenge background and project scope |
| [`Resources/`](Resources/README.md) | Data research and sample NASA files |
| `index.html` + `assets/` | 7-slide pitch presentation (English) |
| [`presentation/`](presentation/README.md) | Full 17-slide pitch deck (Spanish), Spanish 7-slide version, speaker script, and artwork |

## Open the presentation
1. Clone the repository:
   ```bash
   git clone https://github.com/AngelQuez06/space-apps-2026-clhm.git
   cd space-apps-2026-clhm
   ```
2. Open `index.html` (short version, English) or `presentation/index.html` (full deck, Spanish) in Chrome, Edge, Safari, or Firefox. A local server also works: `python -m http.server 8000`, then open `http://localhost:8000`.
3. Controls: `→` / `←` (or click / swipe) to change slides, `F` for full screen.

## Run the app locally
```bash
# Backend (Python 3.14, the same version as the Docker image)
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/python run.py            # http://127.0.0.1:5000/api/health

# Frontend (in another terminal, from the repository root)
python3 -m http.server 8000 --directory frontend
# open http://127.0.0.1:8000/index.html?api=http://127.0.0.1:5000
```

Tests: `node --test frontend/tests/` and, from `backend/`, `.venv/bin/python -m unittest discover -s tests`.

## Data
Viking, CTX, and HiRISE imagery, MOLA relief, and THEMIS night infrared (JPL Mars Trek); HRSC+MOLA blended DEM (USGS Astrogeology); 22 HiRISE DTMs (University of Arizona PDS); Curiosity RAD dosimetry (NASA SPDF); Curiosity traverse (NASA MMGIS). All are public and need no API keys. Details and citations are in [`DOCUMENTATION.md`](DOCUMENTATION.md#5-data-sources).

## Team
- **Imanol:** backend, NASA/USGS data processing, deployment, and pitch deck
- **Angel (AngelQuez06):** route engine (A*) and presentation
- **setzedich:** frontend
- **Karina:** data research
