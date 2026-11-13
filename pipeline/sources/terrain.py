"""Terrain features from AWS Terrain Tiles (Terrarium PNG encoding, open data, no auth).

  elevation = (R * 256 + G + B / 256) - 32768   [metres]

Features (per grid cell, computed from native DEM pixels that fall inside the cell):
  elevation   mean elevation (pixels below -10 m are treated as sea and ignored when the cell has land pixels)
  slope_mean  mean per-pixel slope (degrees)
  slope_p90   90th percentile per-pixel slope
  tri         Terrain Ruggedness Index: mean |dz| to the 8 neighbours (Wilson et al. 2007 form of Riley 1999)
  relief      max - min elevation

Processing is chunked in 10°x10° grid blocks; each block mosaics only the Web-Mercator tiles it needs
(plus a 1-pixel margin), so memory stays small at any zoom. Tiles that contain no land are never
downloaded. Web-Mercator stops at ±85.05°; cells poleward of that copy the nearest valid row.
"""
from __future__ import annotations

import io
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import download, grid_cache_path, is_done, mark_done, save_grid

log = logging.getLogger("pipeline.terrain")

NAME = "terrain"
FEATURES = ["elevation", "slope_mean", "slope_p90", "tri", "relief"]
REQUIRES_TOKEN = False
HOST = "https://s3.amazonaws.com"
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
PROBE = URL.format(z=0, x=0, y=0)
MAX_LAT = 85.0511287798
EARTH_CIRC = 2 * math.pi * 6378137.0
SEA_LEVEL_CUTOFF = -10.0
CHUNK_DEG = 10.0

_state = {"zoom": 7}


def set_zoom(z: int) -> None:
    _state["zoom"] = int(z)


def zoom() -> int:
    return _state["zoom"]


# --------------------------------------------------------------------------- geometry helpers
def lon_to_px(lon, z):
    return (np.asarray(lon) + 180.0) / 360.0 * 256 * (2 ** z)


def lat_to_px(lat, z):
    lat = np.clip(np.asarray(lat, dtype=np.float64), -MAX_LAT, MAX_LAT)
    s = np.sin(np.radians(lat))
    return (0.5 - np.log((1 + s) / (1 - s)) / (4 * math.pi)) * 256 * (2 ** z)


def px_to_lat(py, z):
    n = math.pi - 2 * math.pi * np.asarray(py, dtype=np.float64) / (256 * 2 ** z)
    return np.degrees(np.arctan(np.sinh(n)))


def tile_path(cache_dir: Path, z: int, x: int, y: int) -> Path:
    return Path(cache_dir) / "terrain" / f"z{z}" / str(x) / f"{y}.png"


def decode_terrarium(png_bytes: bytes) -> np.ndarray:
    from PIL import Image

    im = np.asarray(Image.open(io.BytesIO(png_bytes)).convert("RGB"), dtype=np.float32)
    return im[..., 0] * 256.0 + im[..., 1] + im[..., 2] / 256.0 - 32768.0


# --------------------------------------------------------------------------- tile selection
def tiles_for_bbox(z: int, minlon, minlat, maxlon, maxlat) -> list[tuple[int, int]]:
    n = 2 ** z
    x0 = int(np.floor(lon_to_px(minlon, z) / 256))
    x1 = int(np.floor((lon_to_px(maxlon, z) - 1e-9) / 256))
    y0 = int(np.floor(lat_to_px(min(maxlat, MAX_LAT), z) / 256))
    y1 = int(np.floor((lat_to_px(max(minlat, -MAX_LAT), z) - 1e-9) / 256))
    return [(x % n, y) for x in range(x0, x1 + 1) for y in range(max(0, y0), min(n - 1, y1) + 1)]


def land_tiles(z: int, grid: Grid, land: np.ndarray) -> list[tuple[int, int]]:
    """All tiles overlapping at least one land cell inside the grid bbox."""
    rs, cs = grid.bbox_slices()
    lats, lons = grid.lats(), grid.lons()
    rows, cols = np.nonzero(land[rs, cs])
    rows = rows + rs.start
    cols = cols + cs.start
    half = grid.res / 2
    keep = set()
    # Each cell spans [lon-half, lon+half]; map corners to tile indices.
    for dlat in (-half, half):
        for dlon in (-half, half):
            tx = np.floor(lon_to_px(np.clip(lons[cols] + dlon, -180, 180 - 1e-9), z) / 256).astype(int)
            ty = np.floor(lat_to_px(lats[rows] + dlat, z) / 256).astype(int)
            ty = np.clip(ty, 0, 2 ** z - 1)
            keep.update(zip(tx.tolist(), ty.tolist()))
    return sorted(keep)


def estimate(grid: Grid, land: np.ndarray, z: int) -> tuple[int, float]:
    n = len(land_tiles(z, grid, land))
    return n, n * 0.09  # ~90 kB per tile on average (MB)


def fetch(cache_dir: Path, grid: Grid, land: np.ndarray | None = None, workers: int = 16) -> int:
    from tqdm import tqdm

    z = zoom()
    if land is None:
        from .naturalearth import land_fraction

        land = land_fraction(grid, cache_dir) >= 0.5
    tiles = land_tiles(z, grid, land)
    todo = [t for t in tiles if not tile_path(cache_dir, z, *t).exists()]
    log.info("terrain: %d land tiles at z%d (%d to download)", len(tiles), z, len(todo))
    if not todo:
        return len(tiles)

    def get(t):
        x, y = t
        download(URL.format(z=z, x=x, y=y), tile_path(cache_dir, z, x, y), min_bytes=100, timeout=60)

    with ThreadPoolExecutor(workers) as ex:
        list(tqdm(ex.map(get, todo), total=len(todo), desc=f"terrain tiles z{z}", unit="tile"))
    return len(tiles)


# --------------------------------------------------------------------------- processing
def _make_tile_reader(cache_dir: Path, z: int):
    @lru_cache(maxsize=256)
    def read(x: int, y: int) -> np.ndarray | None:
        p = tile_path(cache_dir, z, x % (2 ** z), y)
        if not p.exists():
            return None
        return decode_terrarium(p.read_bytes())

    return read


def _mosaic(read, z: int, px0: int, px1: int, py0: int, py1: int) -> np.ndarray:
    """Elevation mosaic for global pixel window [px0,px1) x [py0,py1); NaN where no tile."""
    out = np.full((py1 - py0, px1 - px0), np.nan, dtype=np.float32)
    n = 2 ** z
    for ty in range(max(0, py0 // 256), min(n - 1, (py1 - 1) // 256) + 1):
        for tx in range(px0 // 256 - (1 if px0 < 0 else 0), (px1 - 1) // 256 + 1):
            t = read(tx % n, ty)
            if t is None:
                continue
            gx0, gy0 = tx * 256, ty * 256
            ax0, ax1 = max(px0, gx0), min(px1, gx0 + 256)
            ay0, ay1 = max(py0, gy0), min(py1, gy0 + 256)
            if ax0 >= ax1 or ay0 >= ay1:
                continue
            out[ay0 - py0: ay1 - py0, ax0 - px0: ax1 - px0] = t[ay0 - gy0: ay1 - gy0, ax0 - gx0: ax1 - gx0]
    return out


def slope_and_tri(elev: np.ndarray, pix_m_rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-pixel slope (deg) and TRI (m) for a mosaic with a 1-pixel margin.

    elev: (H, W) metres; pix_m_rows: (H,) ground pixel size (m) per row. Returns arrays of
    shape (H-2, W-2) for the interior pixels. Negative elevations (sea) are clamped to 0 so
    coastlines do not look like cliffs.
    """
    # Missing tiles are never-downloaded sea tiles -> treat as sea level too.
    e = np.where(np.isfinite(elev), np.maximum(elev, 0.0), 0.0).astype(np.float64)
    c = e[1:-1, 1:-1]
    dx = pix_m_rows[1:-1, None]
    dzdx = (e[1:-1, 2:] - e[1:-1, :-2]) / (2 * dx)
    dzdy = (e[2:, 1:-1] - e[:-2, 1:-1]) / (2 * dx)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    tri = np.zeros_like(c)
    for dy in (-1, 0, 1):
        for dxo in (-1, 0, 1):
            if dy == 0 and dxo == 0:
                continue
            tri += np.abs(e[1 + dy: e.shape[0] - 1 + dy, 1 + dxo: e.shape[1] - 1 + dxo] - c)
    tri /= 8.0
    return slope.astype(np.float32), tri.astype(np.float32)


def _aggregate(cell: np.ndarray, n_cells: int, elev, slope, tri):
    """Group pixel values by local cell id -> per-cell stats (NaN for empty cells)."""
    out = {k: np.full(n_cells, np.nan, dtype=np.float32) for k in FEATURES}
    if cell.size == 0:
        return out
    cnt = np.bincount(cell, minlength=n_cells)
    has = cnt > 0
    for key, v in (("elevation", elev), ("slope_mean", slope), ("tri", tri)):
        s = np.bincount(cell, weights=v, minlength=n_cells)
        out[key][has] = (s[has] / cnt[has]).astype(np.float32)
    order = np.lexsort((slope, cell))
    cs = cell[order]
    starts = np.flatnonzero(np.r_[True, cs[1:] != cs[:-1]])
    counts = np.diff(np.r_[starts, cs.size])
    ids = cs[starts]
    p90_idx = starts + np.floor(0.9 * (counts - 1)).astype(int)
    out["slope_p90"][ids] = slope[order][p90_idx]
    order_e = np.argsort(cell, kind="stable")
    ce = cell[order_e]
    ev = elev[order_e]
    st = np.flatnonzero(np.r_[True, ce[1:] != ce[:-1]])
    out["relief"][ce[st]] = np.maximum.reduceat(ev, st) - np.minimum.reduceat(ev, st)
    return out


def compute(grid: Grid, cache_dir: Path, land: np.ndarray) -> dict[str, np.ndarray]:
    from tqdm import tqdm

    z = zoom()
    read = _make_tile_reader(cache_dir, z)
    result = {k: np.full(grid.shape, np.nan, dtype=np.float32) for k in FEATURES}
    step = max(1, int(round(CHUNK_DEG / grid.res)))
    rs, cs = grid.bbox_slices()
    chunks = [(r0, c0) for r0 in range(rs.start, rs.stop, step) for c0 in range(cs.start, cs.stop, step)]
    for r0, c0 in tqdm(chunks, desc=f"terrain cells z{z}", unit="block"):
        r1, c1 = min(rs.stop, r0 + step), min(cs.stop, c0 + step)
        if not land[r0:r1, c0:c1].any():
            continue
        lat_top = 90.0 - r0 * grid.res
        lat_bot = 90.0 - r1 * grid.res
        if lat_bot >= MAX_LAT or lat_top <= -MAX_LAT:
            continue
        lon_l = -180.0 + c0 * grid.res
        lon_r = -180.0 + c1 * grid.res
        px0 = int(np.floor(lon_to_px(lon_l, z))) - 1
        px1 = int(np.ceil(lon_to_px(lon_r, z))) + 1
        py0 = int(np.floor(lat_to_px(lat_top, z))) - 1
        py1 = int(np.ceil(lat_to_px(lat_bot, z))) + 1
        elev = _mosaic(read, z, px0, px1, py0, py1)
        if not np.isfinite(elev).any():
            continue
        pys = np.arange(py0, py1) + 0.5
        lat_rows = px_to_lat(pys, z)
        pix_m = EARTH_CIRC / (256 * 2 ** z) * np.cos(np.radians(lat_rows))
        slope, tri = slope_and_tri(elev, pix_m)
        inner = elev[1:-1, 1:-1]
        plat = lat_rows[1:-1]
        plon = (np.arange(px0 + 1, px1 - 1) + 0.5) / (256 * 2 ** z) * 360.0 - 180.0
        rr = np.floor((90.0 - plat) / grid.res).astype(int)
        cc = np.floor((plon + 180.0) / grid.res).astype(int)
        row_ok = (rr >= r0) & (rr < r1)
        col_ok = (cc >= c0) & (cc < c1)
        R, C = np.meshgrid(rr[row_ok] - r0, cc[col_ok] - c0, indexing="ij")
        e = inner[np.ix_(row_ok, col_ok)]
        s = slope[np.ix_(row_ok, col_ok)]
        t = tri[np.ix_(row_ok, col_ok)]
        nr, nc = r1 - r0, c1 - c0
        cell = (R * nc + C).ravel()
        e, s, t = e.ravel(), s.ravel(), t.ravel()
        ok = np.isfinite(e)
        # Ignore sea pixels in cells that also contain land pixels.
        land_px = ok & (e >= SEA_LEVEL_CUTOFF)
        cell_has_land = np.bincount(cell[land_px], minlength=nr * nc) > 0
        use = ok & (land_px | ~cell_has_land[cell])
        agg = _aggregate(cell[use], nr * nc, e[use].astype(np.float64), s[use], t[use])
        for k in FEATURES:
            result[k][r0:r1, c0:c1] = agg[k].reshape(nr, nc)
    _fill_poles(result, grid)
    return result


def _fill_poles(result: dict[str, np.ndarray], grid: Grid) -> None:
    """Copy the nearest valid row poleward of the Mercator limit (Antarctic plateau)."""
    lats = grid.lats()
    for k, a in result.items():
        for sign in (1, -1):
            rows = np.flatnonzero(sign * lats > MAX_LAT - grid.res)
            if rows.size == 0:
                continue
            valid_row = rows.max() + 1 if sign > 0 else rows.min() - 1
            if 0 <= valid_row < grid.n_lat:
                src = a[valid_row]
                for r in rows:
                    a[r] = np.where(np.isfinite(a[r]), a[r], src)


def is_cached(grid: Grid) -> bool:
    return is_done(f"grid_{grid_tag(grid)}_terrain_z{zoom()}")


def to_grid(grid: Grid, cache_dir: Path, feature: str, land: np.ndarray | None = None) -> np.ndarray:
    """Return one terrain feature on the grid (computes + caches all five on first call)."""
    z = zoom()
    tag = f"terrain_z{z}"
    gkey = grid_tag(grid)
    marker = f"grid_{gkey}_{tag}"
    path = grid_cache_path(tag, feature, gkey)
    if is_done(marker) and path.exists():
        return np.load(path)
    if land is None:
        from .naturalearth import land_fraction

        land = land_fraction(grid, cache_dir) >= 0.5
    fetch(cache_dir, grid, land)
    res = compute(grid, cache_dir, land & grid.bbox_mask())
    # At coarse zooms (pixel > cell, e.g. --quick or z<=4) some cells contain no pixel centre:
    # fill those land cells from the nearest computed cell.
    from ._regrid import fill_nearest

    for k in res:
        res[k] = fill_nearest(res[k], land & grid.bbox_mask())
    for k, v in res.items():
        save_grid(path.with_name(f"{tag}__{k}.npy"), v)
    mark_done(marker, {"zoom": z})
    return res[feature]
