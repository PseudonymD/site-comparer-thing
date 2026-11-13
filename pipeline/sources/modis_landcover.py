"""MODIS yearly land cover CMG (MCD12C1 v061, Earthdata token required).

ice = Land_Cover_Type_1_Percent[..., 15] / 100  (IGBP class 15 = Permanent Snow and Ice)
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import grid_cache_path, is_done, mark_done, save_grid
from . import _modis_cmg as cmg
from ._regrid import cmg_to_grid

NAME = "modis_landcover"
FEATURES = ["ice"]
REQUIRES_TOKEN = True
HOST = "https://e4ftl01.cr.usgs.gov"
SHORT, VERSION = "MCD12C1", "061"
ICE_CLASS = 15


def fetch(cache_dir: Path, grid: Grid | None = None) -> list[Path]:
    cmg.require_pyhdf()
    return cmg.granules(SHORT, VERSION, None, cache_dir)[:1]


def to_grid(grid: Grid, cache_dir: Path, feature: str = "ice", **_) -> np.ndarray:
    gkey = grid_tag(grid)
    path = grid_cache_path(NAME, feature, gkey)
    marker = f"grid_{gkey}_{NAME}"
    if is_done(marker) and path.exists():
        return np.load(path)
    f = fetch(cache_dir, grid)[0]
    data, _ = cmg.read_sds(f, "Land_Cover_Type_1_Percent")
    if data.ndim == 3 and data.shape[0] < data.shape[-1]:  # (17, 3600, 7200) layout
        frac = data[ICE_CLASS].astype(np.float32) / 100.0
    else:
        frac = data[..., ICE_CLASS].astype(np.float32) / 100.0
    save_grid(path, cmg_to_grid(frac, grid))
    mark_done(marker, {"file": f.name})
    return np.load(path)
