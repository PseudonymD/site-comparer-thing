"""NASA POWER climatology (no auth): https://power.larc.nasa.gov/docs/services/api/temporal/climatology/

Uses the *regional* climatology endpoint in 10°x10° boxes (only boxes containing land), cached as JSON.
Native resolution is 0.5° x 0.625° (MERRA-2 meteorology) and 1° (CERES/SRB solar); values are
bilinearly interpolated to the grid. Temperatures are downscaled with a 6.5 K/km lapse rate using the
fine-scale DEM when POWER reports the elevation of its own grid points.

Features: temp_mean (T2M), temp_range (T2M_RANGE), temp_min (min monthly T2M_MIN), precip (PRECTOTCORR),
humidity (RH2M), solar (ALLSKY_SFC_SW_DWN).
"""
from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import DownloadError, get_json, grid_cache_path, is_done, mark_done, save_grid
from ._regrid import points_to_grid

log = logging.getLogger("pipeline.power")

NAME = "power"
FEATURES = ["temp_mean", "temp_range", "temp_min", "precip", "humidity", "solar"]
REQUIRES_TOKEN = False
HOST = "https://power.larc.nasa.gov"
URL = "https://power.larc.nasa.gov/api/temporal/climatology/regional"
PROBE = "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M&community=RE&longitude=0&latitude=0&format=JSON"
PARAMS = ["T2M", "T2M_RANGE", "T2M_MIN", "PRECTOTCORR", "RH2M", "ALLSKY_SFC_SW_DWN"]
BOX = 10
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
LAPSE = -0.0065  # K per m


def boxes(grid: Grid, land: np.ndarray) -> list[tuple[int, int]]:
    """(lon0, lat0) of each 10° box that contains land inside the bbox."""
    lat, lon = grid.lat_lon_mesh()
    m = land & grid.bbox_mask()
    lo = (np.floor((lon[m] + 180) / BOX) * BOX - 180).astype(int)
    la = (np.floor((lat[m] + 90) / BOX) * BOX - 90).astype(int)
    return sorted(set(zip(lo.tolist(), la.tolist())))


def _box_path(cache_dir: Path, lon0: int, lat0: int, param: str) -> Path:
    return Path(cache_dir) / "power" / f"{param}_{lon0}_{lat0}.json"


def _request(lon0: int, lat0: int, params: list[str]) -> dict:
    q = {
        "latitude-min": lat0, "latitude-max": lat0 + BOX,
        "longitude-min": lon0, "longitude-max": lon0 + BOX,
        "parameters": ",".join(params), "community": "RE", "format": "JSON",
    }
    return get_json(URL, params=q, timeout=300, retries=5)


def fetch(cache_dir: Path, grid: Grid, land: np.ndarray | None = None, workers: int = 4) -> None:
    from tqdm import tqdm

    if land is None:
        from .naturalearth import land_fraction

        land = land_fraction(grid, cache_dir) >= 0.5
    todo = [(b, p) for b in boxes(grid, land) for p in PARAMS if not _box_path(cache_dir, *b, p).exists()]
    if not todo:
        return
    log.info("POWER: %d box/parameter requests to make", len(todo))

    def get(item):
        (lon0, lat0), p = item
        data = _request(lon0, lat0, [p])
        path = _box_path(cache_dir, lon0, lat0, p)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.replace(path)

    errors = 0
    with ThreadPoolExecutor(workers) as ex:
        for fut in tqdm([ex.submit(get, it) for it in todo], desc="NASA POWER", unit="req"):
            try:
                fut.result()
            except Exception as e:  # keep going; missing boxes are filled by nearest neighbour
                errors += 1
                log.debug("POWER request failed: %s", e)
                if errors > max(10, len(todo) // 5):
                    raise DownloadError(f"too many POWER failures ({errors}); last: {e}")


def parse_points(data: dict, param: str):
    """Yield (lon, lat, elev|None, monthly dict) from a POWER regional/point response."""
    feats = data.get("features")
    if feats is None and "geometry" in data:
        feats = [data]
    for f in feats or []:
        coords = f["geometry"]["coordinates"]
        vals = f["properties"]["parameter"].get(param)
        if vals is None:
            continue
        elev = coords[2] if len(coords) > 2 else None
        yield coords[0], coords[1], elev, vals


def _collect(cache_dir: Path, grid: Grid, land: np.ndarray, param: str, reducer):
    lons, lats, elevs, vals = [], [], [], []
    for b in boxes(grid, land):
        p = _box_path(cache_dir, *b, param)
        if not p.exists():
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        for lon, lat, elev, monthly in parse_points(data, param):
            v = reducer(monthly)
            if v is None or v <= -998:
                continue
            lons.append(lon)
            lats.append(lat)
            elevs.append(np.nan if elev is None else elev)
            vals.append(v)
    return np.array(lons), np.array(lats), np.array(elevs, dtype=float), np.array(vals, dtype=float)


def _native_res(lats: np.ndarray, lons: np.ndarray) -> tuple[float, float]:
    def step(v):
        u = np.unique(np.round(v, 4))
        d = np.diff(u)
        d = d[d > 1e-6]
        return float(np.median(d)) if d.size else 0.5

    return step(lats), step(lons)


REDUCERS = {
    "temp_mean": ("T2M", lambda m: m.get("ANN")),
    "temp_range": ("T2M_RANGE", lambda m: m.get("ANN")),
    "temp_min": ("T2M_MIN", lambda m: min(v for k, v in m.items() if k in MONTHS and v > -998)
                 if any(k in MONTHS for k in m) else m.get("ANN")),
    "precip": ("PRECTOTCORR", lambda m: None if m.get("ANN") is None or m["ANN"] <= -998 else m["ANN"] * 365.25),
    "humidity": ("RH2M", lambda m: m.get("ANN")),
    "solar": ("ALLSKY_SFC_SW_DWN", lambda m: m.get("ANN")),
}


def to_grid(grid: Grid, cache_dir: Path, feature: str, land: np.ndarray | None = None,
            elevation: np.ndarray | None = None) -> np.ndarray:
    gkey = grid_tag(grid)
    path = grid_cache_path(NAME, feature, gkey)
    marker = f"grid_{gkey}_{NAME}_{feature}"
    if is_done(marker) and path.exists():
        return np.load(path)
    if land is None:
        from .naturalearth import land_fraction

        land = land_fraction(grid, cache_dir) >= 0.5
    fetch(cache_dir, grid, land)
    param, reducer = REDUCERS[feature]
    lons, lats, elevs, vals = _collect(cache_dir, grid, land, param, reducer)
    if vals.size < 10:
        raise DownloadError(f"POWER returned no usable points for {param}")
    dlat, dlon = _native_res(lats, lons)
    out = points_to_grid(lons, lats, vals, grid, dlat, dlon)
    if feature in ("temp_mean", "temp_min") and elevation is not None and np.isfinite(elevs).mean() > 0.9:
        coarse_e = points_to_grid(lons, lats, elevs, grid, dlat, dlon)
        fine_e = np.nan_to_num(np.maximum(elevation, 0), nan=0.0)
        out = out + LAPSE * (fine_e - np.maximum(coarse_e, 0))
        log.info("POWER %s: applied lapse-rate downscaling", feature)
    out = np.where(grid.bbox_mask(), out, np.nan).astype(np.float32)
    save_grid(path, out)
    mark_done(marker, {"points": int(vals.size), "native_res": [dlat, dlon]})
    return out
