"""MODIS Terra Land Surface Temperature monthly CMG (MOD11C3 v061, Earthdata token required).

temp_mean  = annual mean of (LST_Day + LST_Night) / 2   [°C]
temp_range = annual mean of (LST_Day - LST_Night)       [°C]
temp_min   = coldest monthly mean night LST             [°C]
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import grid_cache_path, is_done, mark_done, save_grid
from . import _modis_cmg as cmg
from ._regrid import cmg_to_grid

NAME = "modis_lst"
FEATURES = ["temp_mean", "temp_range", "temp_min"]
REQUIRES_TOKEN = True
HOST = "https://e4ftl01.cr.usgs.gov"
SHORT, VERSION = "MOD11C3", "061"


def fetch(cache_dir: Path, grid: Grid | None = None) -> list[Path]:
    cmg.require_pyhdf()
    return cmg.granules(SHORT, VERSION, None, cache_dir)


def to_grid(grid: Grid, cache_dir: Path, feature: str, **_) -> np.ndarray:
    gkey = grid_tag(grid)
    path = grid_cache_path(NAME, feature, gkey)
    marker = f"grid_{gkey}_{NAME}"
    if is_done(marker) and path.exists():
        return np.load(path)
    files = fetch(cache_dir, grid)
    s_mean = s_range = None
    n_mean = n_range = None
    tmin = None
    for f in files:
        day = cmg.scaled(*cmg.read_sds(f, "LST_Day_CMG")) - 273.15
        night = cmg.scaled(*cmg.read_sds(f, "LST_Night_CMG")) - 273.15
        mean = (day + night) / 2
        rng = day - night
        if s_mean is None:
            s_mean = np.zeros_like(mean); n_mean = np.zeros_like(mean)
            s_range = np.zeros_like(mean); n_range = np.zeros_like(mean)
            tmin = np.full_like(mean, np.inf)
        ok = np.isfinite(mean)
        s_mean[ok] += mean[ok]; n_mean[ok] += 1
        ok = np.isfinite(rng)
        s_range[ok] += rng[ok]; n_range[ok] += 1
        tmin = np.where(np.isfinite(night), np.minimum(tmin, night), tmin)
    with np.errstate(invalid="ignore", divide="ignore"):
        layers = {
            "temp_mean": np.where(n_mean > 0, s_mean / n_mean, np.nan),
            "temp_range": np.where(n_range > 0, s_range / n_range, np.nan),
            "temp_min": np.where(np.isfinite(tmin), tmin, np.nan),
        }
    for k, v in layers.items():
        save_grid(grid_cache_path(NAME, k, gkey), cmg_to_grid(v, grid))
    mark_done(marker, {"granules": len(files)})
    return np.load(path)
