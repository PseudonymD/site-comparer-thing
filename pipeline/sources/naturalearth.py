"""Natural Earth (public domain) vector data, fetched from the natural-earth-vector GitHub mirror.

Provides:
  * the land mask (fraction of land per cell, used to mask ocean)
  * the admin-0 country index per cell (offline reverse geocoding in the web app)
  * a no-auth fallback for the permanent ice/snow fraction (glaciated areas + ice shelves)

Small 0.1° versions of the land fraction and country index are committed in pipeline/assets/
so the pipeline (and the synthetic generator) also work fully offline.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np

from ..config import ASSETS_DIR
from ..grid import Grid, block_reduce_mean
from ..util import download

log = logging.getLogger("pipeline.naturalearth")

NAME = "naturalearth"
FEATURES = ["ice"]
REQUIRES_TOKEN = False
HOST = "https://raw.githubusercontent.com"
BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"
PROBE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/README.md"
FILES = {
    "land": "ne_10m_land.geojson",
    "countries": "ne_50m_admin_0_countries.geojson",
    "glaciers": "ne_10m_glaciated_areas.geojson",
    "iceshelves": "ne_10m_antarctic_ice_shelves_polys.geojson",
}
SUPERSAMPLE = 5  # rasterise at res/5 then average -> fractional coverage


def _path(cache_dir: Path, key: str) -> Path:
    return Path(cache_dir) / "naturalearth" / FILES[key]


def fetch(cache_dir: Path, grid: Grid | None = None, keys=("land", "countries", "glaciers", "iceshelves")) -> None:
    for k in keys:
        download(f"{BASE}/{FILES[k]}", _path(cache_dir, k), min_bytes=1000, timeout=300)


def _geoms(path: Path):
    import shapely.geometry

    with open(path, encoding="utf-8") as f:
        gj = json.load(f)
    out = []
    for feat in gj["features"]:
        if feat.get("geometry"):
            out.append((shapely.geometry.shape(feat["geometry"]), feat.get("properties", {})))
    return out


def rasterize_fraction(geoms, grid: Grid, supersample: int = SUPERSAMPLE) -> np.ndarray:
    """Fraction (0..1) of each grid cell covered by the union of geoms. Processed in row bands."""
    from rasterio.features import rasterize
    from rasterio.transform import from_origin

    fine = grid.res / supersample
    out = np.zeros(grid.shape, dtype=np.float32)
    band_rows = max(1, int(round(10.0 / grid.res)))  # 10° bands
    shapes = [g for g, _ in geoms]
    for r0 in range(0, grid.n_lat, band_rows):
        r1 = min(grid.n_lat, r0 + band_rows)
        top = 90.0 - r0 * grid.res
        h = (r1 - r0) * supersample
        w = grid.n_lon * supersample
        tr = from_origin(-180.0, top, fine, fine)
        burned = rasterize(((s, 1) for s in shapes), out_shape=(h, w), transform=tr, fill=0, dtype="uint8")
        out[r0:r1] = block_reduce_mean(burned.astype(np.float32), supersample)
    return out


# --------------------------------------------------------------------------- land mask / countries
def land_fraction(grid: Grid, cache_dir: Path) -> np.ndarray:
    """Land fraction per cell. Uses the committed 0.1° asset when possible (offline-safe)."""
    asset = ASSETS_DIR / "landfrac_0p1.png"
    if asset.exists() and abs((grid.res / 0.1) - round(grid.res / 0.1)) < 1e-6:
        from PIL import Image

        a = np.asarray(Image.open(asset), dtype=np.float32) / 255.0
        return block_reduce_mean(a, int(round(grid.res / 0.1))).astype(np.float32)
    fetch(cache_dir, grid, keys=("land",))
    return rasterize_fraction(_geoms(_path(cache_dir, "land")), grid)


def country_index(grid: Grid, cache_dir: Path) -> tuple[np.ndarray, list[dict]]:
    """uint8 country index per cell (0 = none) plus the country table."""
    asset = ASSETS_DIR / "countries_0p1.png"
    table_path = ASSETS_DIR / "countries.json"
    if asset.exists() and table_path.exists():
        from PIL import Image

        a = np.asarray(Image.open(asset), dtype=np.uint8)
        k = int(round(grid.res / 0.1))
        if abs(grid.res / 0.1 - k) < 1e-6:
            a = a[k // 2 :: k, k // 2 :: k][: grid.n_lat, : grid.n_lon]
            return a, json.loads(table_path.read_text(encoding="utf-8"))
    return build_country_index(grid, cache_dir)


def build_country_index(grid: Grid, cache_dir: Path) -> tuple[np.ndarray, list[dict]]:
    from rasterio.features import rasterize
    from scipy import ndimage

    fetch(cache_dir, grid, keys=("countries",))
    geoms = _geoms(_path(cache_dir, "countries"))
    table = [{"name": "", "iso": ""}]
    shapes = []
    for g, p in geoms:
        if len(table) >= 255:
            break
        table.append({"name": p.get("NAME") or p.get("ADMIN") or "?",
                      "iso": p.get("ISO_A2_EH") or p.get("ISO_A2") or ""})
        shapes.append((g, len(table) - 1))
    idx = rasterize(shapes, out_shape=grid.shape, transform=grid.transform, fill=0, dtype="uint8")
    # Coastal cells whose centre is in the sea: take nearest country (within ~2 cells is typical).
    missing = idx == 0
    if missing.any():
        _, (ri, ci) = ndimage.distance_transform_edt(missing, return_indices=True)
        idx = idx[ri, ci]
    return idx.astype(np.uint8), table


def build_assets(cache_dir: Path) -> None:
    """Regenerate the committed 0.1° assets (developer tool: `python -m pipeline assets`)."""
    from PIL import Image

    grid = Grid(0.1)
    fetch(cache_dir, grid, keys=("land", "countries"))
    lf = rasterize_fraction(_geoms(_path(cache_dir, "land")), grid)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.round(lf * 255).astype(np.uint8)).save(ASSETS_DIR / "landfrac_0p1.png", optimize=True)
    idx, table = build_country_index(grid, cache_dir)
    Image.fromarray(idx).save(ASSETS_DIR / "countries_0p1.png", optimize=True)
    (ASSETS_DIR / "countries.json").write_text(json.dumps(table, ensure_ascii=False), encoding="utf-8")
    log.info("wrote assets: land cells(>=0.5)=%d, countries=%d", int((lf >= 0.5).sum()), len(table) - 1)


# --------------------------------------------------------------------------- ice fallback
def to_grid(grid: Grid, cache_dir: Path, feature: str = "ice") -> np.ndarray:
    assert feature == "ice"
    fetch(cache_dir, grid, keys=("glaciers", "iceshelves"))
    geoms = _geoms(_path(cache_dir, "glaciers")) + _geoms(_path(cache_dir, "iceshelves"))
    frac = rasterize_fraction(geoms, grid)
    # Natural Earth "glaciated areas" omits the Antarctic ice sheet itself (it's the land polygon):
    # all land south of 60°S is treated as ice-covered apart from the known ice-free oases, which
    # are too small to resolve at 0.1° (~0.2 % of the continent) — the Dry Valleys are kept ice-free.
    lat, lon = grid.lat_lon_mesh()
    antarctica = lat < -60.0
    dry_valleys = (lat < -77.0) & (lat > -78.0) & (lon > 160.5) & (lon < 163.0)
    frac = np.where(antarctica & ~dry_valleys, 1.0, frac)
    frac = np.where(dry_valleys, np.minimum(frac, 0.2), frac)
    return frac.astype(np.float32)
