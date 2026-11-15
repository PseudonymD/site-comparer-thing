"""ISRIC SoilGrids 2.0, 5 km aggregated product (CC-BY 4.0, no auth): https://files.isric.org/soilgrids/latest/

soc  = topsoil (0-5 cm) organic carbon, dg/kg -> g/kg
sand = topsoil (0-5 cm) sand fraction,  g/kg  -> %
The rasters are in Interrupted Goode Homolosine; they are warped to EPSG:4326 with average resampling.

Gaps: SoilGrids does not map Antarctica, ice sheets or large lakes (~32% of 0.1° land cells, mostly Antarctic,
because polar cells are small). Plain nearest-neighbour filling copied peat-rich sub-Antarctic and tundra
soils (SOC > 100 g/kg) onto the Antarctic ice sheet and the McMurdo Dry Valleys. `fill_gaps` therefore:
  1. fills gaps within MAX_FILL_CELLS of mapped soil with the nearest value (coastlines, raster edges);
  2. sets SOC = 0 g/kg in remaining gaps that are ice-covered or south of 60°S (no soil on ice; ice-free
     Antarctic soils hold < 1 g/kg, Burkins et al. 2000, Ecology 81, 2377-2391);
  3. sets sand = 0 % in remaining ice-covered gaps (no fine regolith on an ice sheet);
  4. fills whatever is left (lakes, ice-free polar desert) with the nearest value, as before.
See docs/decisions.md.
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


MAX_FILL_CELLS = 3  # nearest-fill only this close (in cells) to mapped soil
NO_SOIL_ICE = 0.5  # ice fraction at/above which a far gap counts as "no soil"


def fill_gaps(arr: np.ndarray, land: np.ndarray, feature: str, grid: Grid, ice: np.ndarray | None = None
              ) -> tuple[np.ndarray, dict]:
    """Gap policy for SoilGrids (see module docstring). Returns the filled array and counts per rule."""
    from scipy import ndimage

    from ._regrid import fill_nearest

    bad = ~np.isfinite(arr)
    if not bad.any():
        return arr, {}
    dist = ndimage.distance_transform_edt(bad)
    nearest = fill_nearest(arr)
    out = arr.copy()
    near = bad & land & (dist <= MAX_FILL_CELLS)
    out[near] = nearest[near]
    far = bad & land & (dist > MAX_FILL_CELLS)
    icy = far & (ice >= NO_SOIL_ICE) if ice is not None else np.zeros_like(far)
    lat, _ = grid.lat_lon_mesh()
    if feature == "soc":
        zero = icy | (far & (lat < -60.0))
    else:
        zero = icy
    out[zero] = 0.0
    rest = far & ~zero
    out[rest] = nearest[rest]
    n = int(land.sum())
    counts = {"nearest_near": int(near.sum()), "no_soil_zero": int(zero.sum()), "nearest_far": int(rest.sum())}
    counts["note"] = (f"{(near.sum() + zero.sum() + rest.sum()) / n * 100:.1f}% of land cells are outside SoilGrids: "
                      f"{zero.sum() / n * 100:.1f}% set to 0 (no soil: ice sheets"
                      f"{' and Antarctica' if feature == 'soc' else ''}), "
                      f"{near.sum() / n * 100:.1f}% filled from soil within {MAX_FILL_CELLS} cells, "
                      f"{rest.sum() / n * 100:.1f}% filled from the nearest mapped soil (lakes, ice-free polar desert).")
    return out, counts


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
