"""Weighted A* Martian EVA pathfinding over the Gale Crater / Mount Sharp DEM grid."""

import heapq
import math
from typing import Any

import numpy as np

from .radiation import dose_equivalent_msv_per_day
from .terrain import FOOT_LIMIT_DEG, ROVER_LIMIT_DEG, Terrain

# Curiosity RAD surface baseline in Gale Crater, measured (data/rad_baseline.json, built from
# RAD Level 2 dosimetry by scripts/fetch_rad.py). Falls back to the published 0.64 mSv/day.
RAD_BASELINE_MSV_PER_DAY = dose_equivalent_msv_per_day()
RAD_BASELINE_MSV_PER_HOUR = RAD_BASELINE_MSV_PER_DAY / 24.0
SOLAR_STORM_RAD_MULTIPLIER = 18.0

# 2-astronaut EVA metabolic O2 baseline (~0.055 kg/h per crew member).
CREW_O2_KG_PER_HOUR = 0.11

# 8-connected grid neighbors: (d_row, d_col).
_NEIGHBORS = (
    (-1, 0), (1, 0), (0, -1), (0, 1),
    (-1, -1), (-1, 1), (1, -1), (1, 1),
)


def parse_coord(terrain: Terrain, coord: Any):
    """Resolve [row, col], [lat, lon], or dict into (row, col), or None if invalid/out of bounds."""
    try:
        if isinstance(coord, dict):
            if "row" in coord and "col" in coord:
                r, c = int(coord["row"]), int(coord["col"])
                return (r, c) if terrain.in_bounds(r, c) else None
            if "lat" in coord and "lon" in coord:
                lat, lon = float(coord["lat"]), float(coord["lon"])
                if not (math.isfinite(lat) and math.isfinite(lon)):
                    return None
                return terrain.latlon_to_rc(lat, lon)
            return None

        if not isinstance(coord, (list, tuple)) or len(coord) != 2:
            return None

        a, b = float(coord[0]), float(coord[1])
    except (TypeError, ValueError):
        return None

    if not (math.isfinite(a) and math.isfinite(b)):
        return None

    west, south, east, north = terrain.bbox
    if south <= a <= north and west <= b <= east:
        return terrain.latlon_to_rc(a, b)

    if a.is_integer() and b.is_integer():
        r, c = int(a), int(b)
        return (r, c) if terrain.in_bounds(r, c) else None

    return None


def is_passable(terrain: Terrain, row: int, col: int, rover_support: bool) -> bool:
    """Return True if (row, col) is traversable under the active mobility mode."""
    if not terrain.in_bounds(row, col):
        return False
    slope = float(terrain.slope[row, col])
    if rover_support:
        return slope <= ROVER_LIMIT_DEG and not bool(terrain.sand_ripple[row, col])
    return slope <= FOOT_LIMIT_DEG


def _block_reason(terrain: Terrain, row: int, col: int, rover_support: bool, label: str) -> str:
    if not terrain.in_bounds(row, col):
        return f"{label} outside DEM window"
    slope = float(terrain.slope[row, col])
    if rover_support:
        if bool(terrain.sand_ripple[row, col]):
            return f"Blocked at {label} by loose sand (sand_ripple) for rover"
        if slope > ROVER_LIMIT_DEG:
            return f"Blocked by excessive slope ({slope:.1f} deg) for rover (limit {ROVER_LIMIT_DEG:.0f} deg)"
    elif slope > FOOT_LIMIT_DEG:
        return f"Blocked by excessive slope ({slope:.1f} deg) for foot traverse (limit {FOOT_LIMIT_DEG:.0f} deg)"
    return f"Impassable {label} cell"


def _step_physics(terrain: Terrain, r: int, c: int, nr: int, nc: int, rover_support: bool):
    """Compute physical step distance (m), positive slope (deg), and traversal time (min)."""
    lat = terrain.north - (r + 0.5) * terrain.res
    d_north = (nr - r) * terrain.res_m
    d_east = (nc - c) * terrain.res_m * math.cos(math.radians(lat))
    dist_m = math.hypot(d_east, d_north)

    dz = float(terrain.elevation[nr, nc] - terrain.elevation[r, c])
    uphill_m = max(0.0, dz)
    step_slope_deg = math.degrees(math.atan2(uphill_m, dist_m)) if dist_m > 0 else 0.0
    cell_slope_deg = float(terrain.slope[nr, nc])

    v_base = 1.4 if rover_support else 1.25  # m/s on firm flat Mars regolith
    speed_factor = max(0.25, 1.0 - 0.025 * cell_slope_deg - 0.02 * step_slope_deg)
    time_min = (dist_m / (v_base * speed_factor)) / 60.0
    rad_factor = float(terrain.radiation_factor[nr, nc])
    return dist_m, step_slope_deg, time_min, rad_factor


def _reconstruct_metrics(terrain: Terrain, cells: list, rover_support: bool, solar_storm: bool):
    """Format ordered path waypoints and aggregate physical EVA metrics."""
    total_dist_m = 0.0
    total_time_min = 0.0
    total_o2_kg = 0.0
    total_rad_msv = 0.0

    rad_rate_per_hour = RAD_BASELINE_MSV_PER_HOUR * (
        SOLAR_STORM_RAD_MULTIPLIER if solar_storm else 1.0
    )

    for idx in range(len(cells) - 1):
        r, c = cells[idx]
        nr, nc = cells[idx + 1]
        dist_m, step_slope_deg, time_min, rad_factor = _step_physics(
            terrain, r, c, nr, nc, rover_support
        )
        hours = time_min / 60.0
        total_dist_m += dist_m
        total_time_min += time_min
        total_o2_kg += hours * CREW_O2_KG_PER_HOUR * (1.0 + 0.04 * step_slope_deg)
        total_rad_msv += hours * rad_rate_per_hour * rad_factor

    path = []
    for r, c in cells:
        lat, lon = terrain.rc_to_latlon(r, c)
        path.append(
            {
                "row": int(r),
                "col": int(c),
                "lat": lat,
                "lon": lon,
                "elevation_m": round(float(terrain.elevation[r, c]), 1),
                "slope_deg": round(float(terrain.slope[r, c]), 1),
            }
        )

    metrics = {
        "distance_m": round(total_dist_m, 1),
        "estimated_time_min": round(total_time_min, 1),
        "o2_consumption_kg": round(total_o2_kg, 4),
        "radiation_dose_msv": round(total_rad_msv, 4),
    }
    return path, metrics


def find_route(
    terrain: Terrain,
    start_raw: Any,
    end_raw: Any,
    rover_support: bool = True,
    solar_storm: bool = False,
) -> dict:
    """Run weighted A* on `terrain` and return structured feasibility, path, and EVA metrics."""
    start = parse_coord(terrain, start_raw)
    if start is None:
        return {
            "feasible": False,
            "status": "Invalid or out-of-bounds start coordinates",
            "solar_storm": solar_storm,
            "rover_support": rover_support,
            "shelter_reached": False,
            "path": [],
            "metrics": None,
        }

    if not is_passable(terrain, start[0], start[1], rover_support):
        return {
            "feasible": False,
            "status": _block_reason(terrain, start[0], start[1], rover_support, "start"),
            "solar_storm": solar_storm,
            "rover_support": rover_support,
            "shelter_reached": False,
            "path": [],
            "metrics": None,
        }

    end = None
    if not solar_storm:
        end = parse_coord(terrain, end_raw)
        if end is None:
            return {
                "feasible": False,
                "status": "Invalid or out-of-bounds destination coordinates",
                "solar_storm": solar_storm,
                "rover_support": rover_support,
                "shelter_reached": False,
                "path": [],
                "metrics": None,
            }
        if not is_passable(terrain, end[0], end[1], rover_support):
            return {
                "feasible": False,
                "status": _block_reason(terrain, end[0], end[1], rover_support, "destination"),
                "solar_storm": solar_storm,
                "rover_support": rover_support,
                "shelter_reached": False,
                "path": [],
                "metrics": None,
            }
        if start == end:
            path, metrics = _reconstruct_metrics(terrain, [start], rover_support, solar_storm)
            return {
                "feasible": True,
                "status": "Start and destination are identical",
                "solar_storm": solar_storm,
                "rover_support": rover_support,
                "shelter_reached": False,
                "path": path,
                "metrics": metrics,
            }

    if solar_storm and bool(terrain.is_shelter[start[0], start[1]]):
        path, metrics = _reconstruct_metrics(terrain, [start], rover_support, solar_storm)
        return {
            "feasible": True,
            "status": "Crew is already inside a natural shelter",
            "solar_storm": solar_storm,
            "rover_support": rover_support,
            "shelter_reached": True,
            "path": path,
            "metrics": metrics,
        }

    rows, cols = terrain.elevation.shape
    elev_arr = terrain.elevation
    slope_arr = terrain.slope
    rad_arr = terrain.radiation_factor
    shelter_arr = terrain.is_shelter
    passable = terrain.passable_rover if rover_support else terrain.passable_foot
    dx_arr = terrain.dx_m
    res_m = terrain.res_m
    v_base = 1.4 if rover_support else 1.25

    g_score = np.full((rows, cols), np.inf, dtype=np.float64)
    g_score[start] = 0.0
    came_from = {}
    closed = np.zeros((rows, cols), dtype=bool)

    if solar_storm or end is None:
        h_start = 0.0
    else:
        end_r, end_c = end
        h_start = math.hypot((end_c - start[1]) * float(dx_arr[start[0]]), (end_r - start[0]) * res_m) * 0.0139

    heap = [(h_start, 0.0, start)]
    goal_cell = None
    rad_to_deg = 180.0 / math.pi

    while heap:
        _, cur_g, (r, c) = heapq.heappop(heap)
        if closed[r, c]:
            continue
        closed[r, c] = True

        if solar_storm:
            if shelter_arr[r, c]:
                goal_cell = (r, c)
                break
        elif (r, c) == end:
            goal_cell = (r, c)
            break

        row_dx = float(dx_arr[r])
        cur_elev = float(elev_arr[r, c])

        for dr, dc in _NEIGHBORS:
            nr, nc = r + dr, c + dc
            if not (0 <= nr < rows and 0 <= nc < cols) or closed[nr, nc] or not passable[nr, nc]:
                continue

            d_north = dr * res_m
            d_east = dc * row_dx
            dist_m = math.hypot(d_east, d_north)

            dz = float(elev_arr[nr, nc]) - cur_elev
            uphill_m = dz if dz > 0.0 else 0.0
            step_slope_deg = math.atan2(uphill_m, dist_m) * rad_to_deg if dist_m > 0.0 else 0.0
            cell_slope_deg = float(slope_arr[nr, nc])
            rad_factor = float(rad_arr[nr, nc])

            if solar_storm:
                speed_factor = 1.0 - 0.025 * cell_slope_deg - 0.02 * step_slope_deg
                if speed_factor < 0.25:
                    speed_factor = 0.25
                time_min = (dist_m / (v_base * speed_factor)) / 60.0
                step_cost = time_min * (1.0 + 0.05 * (rad_factor - 1.0))
                h_val = 0.0
            else:
                dist_units = dist_m * 0.01
                step_cost = dist_units * (1.0 + 0.08 * cell_slope_deg + 0.12 * step_slope_deg + 0.6 * rad_factor)
                h_val = math.hypot((end_c - nc) * float(dx_arr[nr]), (end_r - nr) * res_m) * 0.0139

            tentative_g = cur_g + step_cost
            if tentative_g < g_score[nr, nc]:
                g_score[nr, nc] = tentative_g
                came_from[(nr, nc)] = (r, c)
                heapq.heappush(heap, (tentative_g + h_val, tentative_g, (nr, nc)))

    if goal_cell is None:
        msg = (
            "No traversable route to any natural shelter under current constraints"
            if solar_storm
            else "No traversable route between start and destination under slope/sand constraints"
        )
        return {
            "feasible": False,
            "status": msg,
            "solar_storm": solar_storm,
            "rover_support": rover_support,
            "shelter_reached": False,
            "path": [],
            "metrics": None,
        }

    cells = []
    cur = goal_cell
    while cur is not None:
        cells.append(cur)
        cur = came_from.get(cur)
    cells.reverse()

    path, metrics = _reconstruct_metrics(terrain, cells, rover_support, solar_storm)
    status = (
        "Solar storm alert (SPE): fastest evacuation route to natural shelter calculated"
        if solar_storm
        else "Optimal route calculated"
    )
    return {
        "feasible": True,
        "status": status,
        "solar_storm": solar_storm,
        "rover_support": rover_support,
        "shelter_reached": solar_storm,
        "path": path,
        "metrics": metrics,
    }
