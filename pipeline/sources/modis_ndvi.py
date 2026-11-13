"""MODIS Terra Vegetation Indices monthly CMG (MOD13C2 v061, Earthdata token required).

ndvi = mean of four seasonal months (Jan, Apr, Jul, Oct) of YEAR - captures both hemispheres'
growing seasons while keeping the download to ~4 x 170 MB.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import grid_cache_path, is_done, mark_done, save_grid
from . import _modis_cmg as cmg
from ._regrid import cmg_to_grid

NAME = "modis_ndvi"
FEATURES = ["ndvi"]
REQUIRES_TOKEN = True
HOST = "https://e4ftl01.cr.usgs.gov"
SHORT, VERSION = "MOD13C2", "061"
MONTHS = [1, 4, 7, 10]
SDS = "CMG 0.05 Deg Monthly NDVI"


def fetch(cache_dir: Path, grid: Grid | None = None) -> list[Path]:
    cmg.require_pyhdf()
    return cmg.granules(SHORT, VERSION, MONTHS, cache_dir)


def to_grid(grid: Grid, cache_dir: Path, feature: str = "ndvi", **_) -> np.ndarray:
    gkey = grid_tag(grid)
    path = grid_cache_path(NAME, feature, gkey)
    marker = f"grid_{gkey}_{NAME}"
    if is_done(marker) and path.exists():
        return np.load(path)
    files = fetch(cache_dir, grid)
    s = n = None
    for f in files:
        data, attrs = cmg.read_sds(f, SDS)
        v = data.astype(np.float64)
        v[(data < -2000) | (data > 10000)] = np.nan
        v /= 10000.0
        if s is None:
            s, n = np.zeros_like(v), np.zeros_like(v)
        ok = np.isfinite(v)
        s[ok] += v[ok]
        n[ok] += 1
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(n > 0, s / n, np.nan)
    save_grid(path, cmg_to_grid(mean, grid))
    mark_done(marker, {"granules": len(files)})
    return np.load(path)
