"""Radiation baseline for route dose, from real Curiosity RAD measurements.

Built by scripts/fetch_rad.py into data/rad_baseline.json. If the file is missing, the previous
published constant (0.64 mSv/day, Hassler et al. 2014) is used so the API keeps working.
"""

import functools
import json
import os

RAD_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "rad_baseline.json")
FALLBACK_MSV_PER_DAY = 0.64
FALLBACK_SOURCE = "Published Curiosity RAD average (Hassler et al. 2014); rad_baseline.json not found"


@functools.lru_cache(maxsize=1)
def load_baseline():
    """Parsed rad_baseline.json, or None when it was not built."""
    path = os.path.abspath(RAD_PATH)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dose_equivalent_msv_per_day() -> float:
    data = load_baseline()
    return float(data["baseline"]["dose_equivalent_msv_day"]) if data else FALLBACK_MSV_PER_DAY


def describe() -> dict:
    """Short summary for API responses."""
    data = load_baseline()
    if not data:
        return {"dose_equivalent_msv_day": FALLBACK_MSV_PER_DAY, "source": FALLBACK_SOURCE, "measured": False}
    return {
        "dose_equivalent_msv_day": data["baseline"]["dose_equivalent_msv_day"],
        "absorbed_tissue_mgy_day": data["baseline"]["absorbed_tissue_mgy_day"],
        "period": data["period"],
        "source": data["source"]["name"],
        "measured": True,
    }
