"""Build a real radiation baseline from Curiosity RAD Level 2 dosimetry (NASA SPDF).

Source: https://spdf.gsfc.nasa.gov/pub/data/aaa_planetary/msl/rad/cdf/obs-l2/<year>/ (one CDF per day,
the highest version is used). Variable DOSIMETRY_TOTAL (uGy/day) has 3 columns:
  0 = Total Dose B (silicon), 1 = RTG Corrected Dose B (silicon, Curiosity's MMRTG removed),
  2 = Total Dose E (tissue-equivalent plastic, MMRTG not removed).
Per day: alive-time weighted mean of observations without FLAGGED_DATA.

Dose equivalent (what matters for crew):
  ambient tissue absorbed dose = RTG-corrected B (Si) x median(E total / B total)   (Si -> tissue)
  dose equivalent              = tissue absorbed dose x Q, Q = 3.05 (Hassler et al. 2014, Science 343)
Q is a published mean quality factor for Gale; it is not in the Level 2 dosimetry file.

Output: backend/data/rad_baseline.json (committed). Needs cdflib (requirements-data.txt).
Usage: .venv/bin/python scripts/fetch_rad.py [year ...]   (default: current year)
"""

import concurrent.futures as cf
import json
import os
import re
import sys
import time

import cdflib
import numpy as np
import requests

BASE = "https://spdf.gsfc.nasa.gov/pub/data/aaa_planetary/msl/rad/cdf/obs-l2"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "cache", "rad")
OUT = os.path.join(HERE, "..", "data", "rad_baseline.json")
QUALITY_FACTOR = 3.05
QUALITY_FACTOR_SOURCE = "Hassler et al. (2014), Science 343, 1244797: mean quality factor 3.05 +/- 0.26 at Gale"
FILL = -1e30


def list_files(year):
    html = requests.get(f"{BASE}/{year}/", timeout=60).text
    best = {}
    for name in set(re.findall(r"msl_rad_obs-l2_(\d{7})_v(\d+)\.cdf", html)):
        day, ver = name
        if day not in best or int(ver) > int(best[day]):
            best[day] = ver
    return [f"{year}/msl_rad_obs-l2_{d}_v{v}.cdf" for d, v in sorted(best.items())]


def fetch(rel):
    path = os.path.join(CACHE, os.path.basename(rel))
    if not os.path.exists(path):
        for attempt in range(5):  # SPDF sometimes drops connections; retry with backoff
            try:
                r = requests.get(f"{BASE}/{rel}", timeout=120)
                r.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 4:
                    raise
                time.sleep(2 * (attempt + 1))
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(r.content)
        os.replace(tmp, path)
    return path


def daily(path):
    f = cdflib.CDF(path)
    g = f.globalattsget()
    dose = np.asarray(f.varget("DOSIMETRY_TOTAL"), dtype=float).reshape(-1, 3)
    alive = np.asarray(f.varget("ALIVE_TIME"), dtype=float).reshape(-1)
    flags = np.asarray(f.varget("FLAGGED_DATA")).reshape(-1)
    ok = (np.char.strip(flags.astype(str)) == "") & np.all(dose > FILL, axis=1) & (alive > 0)
    if ok.sum() < 10:  # less than about 3 h of clean data
        return None
    w = alive[ok]
    mean = (dose[ok] * w[:, None]).sum(axis=0) / w.sum()
    start = str(g.get("Start_time", [""])[0])
    return {
        "date": f"{start[0:4]}-{start[4:6]}-{start[6:8]}",
        "sol": int(str(g.get("Start_sol", ["0"])[0])),
        "total_b_si_ugy_day": round(float(mean[0]), 2),
        "rtg_corrected_b_si_ugy_day": round(float(mean[1]), 2),
        "total_e_tissue_ugy_day": round(float(mean[2]), 2),
        "observations": int(ok.sum()),
        "alive_hours": round(float(w.sum()) / 3600, 2),
        "file": os.path.basename(path),
    }


def main(years):
    os.makedirs(CACHE, exist_ok=True)
    files = [rel for y in years for rel in list_files(y)]
    print("files:", len(files), flush=True)
    t0 = time.time()
    with cf.ThreadPoolExecutor(4) as ex:
        paths = list(ex.map(fetch, files))
    print(f"downloaded in {time.time() - t0:.0f}s", flush=True)
    days, skipped = [], []
    for p in paths:
        try:
            d = daily(p)
        except Exception as exc:  # corrupt or unexpected file
            skipped.append([os.path.basename(p), repr(exc)[:80]])
            continue
        if d is None:
            skipped.append([os.path.basename(p), "not enough clean observations"])
        else:
            days.append(d)
    days.sort(key=lambda d: d["date"])
    rtg = np.array([d["rtg_corrected_b_si_ugy_day"] for d in days])
    ratio = np.array([d["total_e_tissue_ugy_day"] / d["total_b_si_ugy_day"] for d in days])
    si_to_tissue = float(np.median(ratio))
    median_rtg = float(np.median(rtg))
    recent = rtg[-30:]
    absorbed_tissue = median_rtg * si_to_tissue / 1000  # mGy/day
    equivalent = absorbed_tissue * QUALITY_FACTOR       # mSv/day
    peak = int(np.argmax(rtg))
    out = {
        "generated": time.strftime("%Y-%m-%d"),
        "period": {"from": days[0]["date"], "to": days[-1]["date"], "sol_from": days[0]["sol"], "sol_to": days[-1]["sol"], "days": len(days)},
        "baseline": {
            "absorbed_si_mgy_day": round(median_rtg / 1000, 4),
            "absorbed_tissue_mgy_day": round(absorbed_tissue, 4),
            "dose_equivalent_msv_day": round(equivalent, 4),
            "dose_equivalent_msv_hour": round(equivalent / 24, 5),
            "recent_30_days_absorbed_si_mgy_day": round(float(np.median(recent)) / 1000, 4),
            "day_to_day_spread_pct": round(float(np.std(rtg) / np.mean(rtg) * 100), 1),
        },
        "peak_day": {**days[peak], "ratio_to_median": round(float(rtg[peak] / median_rtg), 2)},
        "method": {
            "statistic": "median over days of the alive-time weighted daily mean, flagged observations excluded",
            "dose_column": "RTG Corrected Dose B (silicon), Curiosity MMRTG contribution removed",
            "si_to_tissue_factor": round(si_to_tissue, 4),
            "si_to_tissue_note": "median ratio Total Dose E (tissue-equivalent) / Total Dose B (silicon)",
            "quality_factor": QUALITY_FACTOR,
            "quality_factor_source": QUALITY_FACTOR_SOURCE,
            "previous_constant_msv_day": 0.64,
        },
        "source": {"name": "MSL RAD Level 2 dosimetry (RAD_RDR obs-l2), NASA SPDF", "url": f"{BASE}/",
                   "acknowledgement": "RAD PI D. Hassler, Southwest Research Institute Boulder"},
        "days": days,
        "skipped_files": skipped,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    b = out["baseline"]
    print(f"days {len(days)} ({days[0]['date']}..{days[-1]['date']}, sols {days[0]['sol']}-{days[-1]['sol']}), skipped {len(skipped)}", flush=True)
    print(f"absorbed Si {b['absorbed_si_mgy_day']} mGy/d, tissue {b['absorbed_tissue_mgy_day']} mGy/d (x{si_to_tissue:.3f}), "
          f"equivalent {b['dose_equivalent_msv_day']} mSv/d; recent30 Si {b['recent_30_days_absorbed_si_mgy_day']}; spread {b['day_to_day_spread_pct']}%; "
          f"peak {out['peak_day']['date']} x{out['peak_day']['ratio_to_median']}", flush=True)
    print("saved", os.path.abspath(OUT), os.path.getsize(OUT), "bytes", flush=True)


if __name__ == "__main__":
    years = [int(a) for a in sys.argv[1:]] or [int(time.strftime("%Y"))]
    main(years)
