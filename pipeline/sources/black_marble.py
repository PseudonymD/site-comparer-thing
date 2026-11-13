"""NASA Black Marble annual night-time lights (VNP46A4, Earthdata token required).

lights = AllAngle_Composite_Snow_Free radiance (nW/cm²/sr), mean per cell.
VNP46A4 is delivered as 10°x10° sinusoidal-named but geographic (15 arc-second, 2400x2400) HDF5 tiles
hHHvVV; only tiles that contain land are downloaded (~300 tiles, ~5-9 GB).
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import grid_cache_path, is_done, mark_done, save_grid
from . import earthdata

log = logging.getLogger("pipeline.black_marble")

NAME = "black_marble"
FEATURES = ["lights"]
REQUIRES_TOKEN = True
HOST = "https://ladsweb.modaps.eosdis.nasa.gov"
SHORT = "VNP46A4"
YEAR = 2023
DATASET = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields/AllAngle_Composite_Snow_Free"
TILE_RE = re.compile(r"\.h(\d\d)v(\d\d)\.")


def _land_tiles(grid: Grid, land: np.ndarray) -> set[tuple[int, int]]:
    lat, lon = grid.lat_lon_mesh()
    m = land & grid.bbox_mask()
    h = np.floor((lon[m] + 180) / 10).astype(int)
    v = np.floor((90 - lat[m]) / 10).astype(int)
    return set(zip(h.tolist(), v.tolist()))


def fetch(cache_dir: Path, grid: Grid, land: np.ndarray | None = None) -> dict[tuple[int, int], Path]:
    from tqdm import tqdm

    if land is None:
        from .naturalearth import land_fraction

        land = land_fraction(grid, cache_dir) >= 0.5
    want = _land_tiles(grid, land)
    entries = earthdata.search(SHORT, f"{YEAR}-01-01T00:00:00Z,{YEAR}-12-31T23:59:59Z")
    todo = {}
    for e in entries:
        url = earthdata.data_url(e, (".h5",))
        m = TILE_RE.search(url or "")
        if url and m and (int(m.group(1)), int(m.group(2))) in want:
            todo[(int(m.group(1)), int(m.group(2)))] = url
    if not todo:
        raise RuntimeError("no VNP46A4 granules found")
    out = {}
    for k, url in tqdm(sorted(todo.items()), desc="Black Marble tiles", unit="tile"):
        out[k] = earthdata.fetch_file(url, Path(cache_dir) / "black_marble")
    return out


def to_grid(grid: Grid, cache_dir: Path, feature: str = "lights", land=None, **_) -> np.ndarray:
    import h5py

    gkey = grid_tag(grid)
    path = grid_cache_path(NAME, feature, gkey)
    marker = f"grid_{gkey}_{NAME}"
    if is_done(marker) and path.exists():
        return np.load(path)
    tiles = fetch(cache_dir, grid, land)
    out = np.full(grid.shape, np.nan, dtype=np.float32)
    cells_per_tile = int(round(10 / grid.res))
    for (h, v), f in tiles.items():
        with h5py.File(f, "r") as hf:
            ds = hf[DATASET]
            raw = ds[()]
            fill = ds.attrs.get("_FillValue", 65535)
            scale = float(np.ravel(ds.attrs.get("scale_factor", [0.1]))[0])
            off = float(np.ravel(ds.attrs.get("add_offset", [0.0]))[0])
        a = raw.astype(np.float32) * scale + off
        a[raw == np.ravel([fill])[0]] = np.nan
        k = a.shape[0] // cells_per_tile
        a = a[: k * cells_per_tile, : k * cells_per_tile]
        with np.errstate(invalid="ignore"):
            pooled = np.nanmean(a.reshape(cells_per_tile, k, cells_per_tile, k), axis=(1, 3))
        r0, c0 = v * cells_per_tile, h * cells_per_tile
        out[r0:r0 + cells_per_tile, c0:c0 + cells_per_tile] = pooled
    save_grid(path, out)
    mark_done(marker, {"tiles": len(tiles), "year": YEAR})
    return out
