"""ISRIC SoilGrids 2.0, 5 km aggregated product (CC-BY 4.0, no auth): https://files.isric.org/soilgrids/latest/

soc  = topsoil (0-5 cm) organic carbon, dg/kg -> g/kg
sand = topsoil (0-5 cm) sand fraction,  g/kg  -> %
The rasters are in Interrupted Goode Homolosine; they are warped to EPSG:4326 with average resampling.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import download, grid_cache_path, is_done, mark_done, save_grid

NAME = "soilgrids"
FEATURES = ["soc", "sand"]
REQUIRES_TOKEN = False
HOST = "https://files.isric.org"
BASE = "https://files.isric.org/soilgrids/latest/data_aggregated/5000m"
FILES = {"soc": ("soc", "soc_0-5cm_mean_5000.tif", 0.1), "sand": ("sand", "sand_0-5cm_mean_5000.tif", 0.1)}


def _path(cache_dir: Path, feature: str) -> Path:
    return Path(cache_dir) / "soilgrids" / FILES[feature][1]


def fetch(cache_dir: Path, grid: Grid | None = None) -> None:
    for f, (var, fname, _) in FILES.items():
        download(f"{BASE}/{var}/{fname}", _path(cache_dir, f), min_bytes=100_000, timeout=600)


def warp_to_grid(src_path: Path, grid: Grid, scale: float) -> np.ndarray:
    import rasterio
    from rasterio.warp import Resampling, reproject

    dst = np.full(grid.shape, np.nan, dtype=np.float32)
    with rasterio.open(src_path) as src:
        nodata = src.nodata if src.nodata is not None else -32768
        reproject(
            source=rasterio.band(src, 1), destination=dst,
            src_transform=src.transform, src_crs=src.crs, src_nodata=nodata,
            dst_transform=grid.transform, dst_crs="EPSG:4326", dst_nodata=np.nan,
            resampling=Resampling.average, num_threads=2,
        )
    dst[dst < 0] = np.nan
    return (dst * scale).astype(np.float32)


def to_grid(grid: Grid, cache_dir: Path, feature: str, **_) -> np.ndarray:
    gkey = grid_tag(grid)
    path = grid_cache_path(NAME, feature, gkey)
    marker = f"grid_{gkey}_{NAME}_{feature}"
    if is_done(marker) and path.exists():
        return np.load(path)
    fetch(cache_dir, grid)
    arr = warp_to_grid(_path(cache_dir, feature), grid, FILES[feature][2])
    save_grid(path, arr)
    mark_done(marker, files=[_path(cache_dir, feature)])
    return arr
