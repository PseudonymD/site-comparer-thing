"""MERRA-2 monthly aerosol diagnostics (M2TMNXAER, GES DISC, Earthdata token required).

aod = annual mean of TOTEXTTAU (total aerosol extinction AOT at 550 nm), 0.5° x 0.625°, bilinear to grid.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import grid_cache_path, is_done, mark_done, save_grid
from . import earthdata
from ._regrid import regular_to_grid

NAME = "merra2"
FEATURES = ["aod"]
REQUIRES_TOKEN = True
HOST = "https://goldsmr4.gesdisc.eosdis.nasa.gov"
SHORT = "M2TMNXAER"
YEAR = 2023


def fetch(cache_dir: Path, grid: Grid | None = None) -> list[Path]:
    entries = earthdata.search(SHORT, f"{YEAR}-01-01T00:00:00Z,{YEAR}-12-31T23:59:59Z")
    files = []
    for e in entries:
        url = earthdata.data_url(e, (".nc4",))
        if url:
            files.append(earthdata.fetch_file(url, Path(cache_dir) / "merra2"))
    if not files:
        raise RuntimeError("no M2TMNXAER granules found")
    return files


def to_grid(grid: Grid, cache_dir: Path, feature: str = "aod", **_) -> np.ndarray:
    import h5py

    gkey = grid_tag(grid)
    path = grid_cache_path(NAME, feature, gkey)
    marker = f"grid_{gkey}_{NAME}"
    if is_done(marker) and path.exists():
        return np.load(path)
    files = fetch(cache_dir, grid)
    acc, lat, lon = None, None, None
    for f in files:
        with h5py.File(f, "r") as hf:
            v = hf["TOTEXTTAU"][()].astype(np.float64)
            v = v[0] if v.ndim == 3 else v
            v[v > 1e10] = np.nan
            lat, lon = hf["lat"][()], hf["lon"][()]
        acc = v if acc is None else acc + v
    mean = acc / len(files)
    arr = regular_to_grid(mean, lat, lon, grid)
    save_grid(path, arr)
    mark_done(marker, {"files": len(files)})
    return arr
