"""Basaltic / mafic fraction from Macrostrat's vector-tile service (CC-BY 4.0).

Macrostrat's query API supports point lookups, while polygon coverage is served as Mapbox vector
tiles. The adapter decodes the documented carto tiles at a moderate zoom, keeps polygons whose
major lithology is mafic, and rasterises their union to a per-cell fraction.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import download, grid_cache_path, is_done, mark_done, save_grid

NAME = "macrostrat"
FEATURES = ["basalt"]
REQUIRES_TOKEN = False
HOST = "https://tiles.macrostrat.org"
PROBE = "https://tiles.macrostrat.org/carto/0/0/0.mvt"
TILE_API = "https://tiles.macrostrat.org/carto/{z}/{x}/{y}.mvt"
TILE_ZOOM = 3
MAFIC = re.compile(
    r"basalt|gabbro|diabase|dolerite|mafic|picrite|komatiite|tholeiite|basanite|norite|troctolite",
    re.I,
)


def _tiles(grid: Grid):
    minlon, minlat, maxlon, maxlat = grid.bbox or (-180.0, -85.051129, 180.0, 85.051129)
    n = 1 << TILE_ZOOM

    def x(lon):
        return int(math.floor((lon + 180.0) / 360.0 * n)) % n

    def y(lat):
        lat = max(-85.051129, min(85.051129, lat))
        return int(math.floor((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n))

    x0, x1 = x(minlon), x(maxlon - 1e-9)
    y0, y1 = y(maxlat), y(minlat)
    xs = range(x0, x1 + 1) if x0 <= x1 else list(range(x0, n)) + list(range(0, x1 + 1))
    for ty in range(max(0, y0), min(n - 1, y1) + 1):
        for tx in xs:
            yield tx, ty, n


def is_major_mafic(props: dict) -> bool:
    """True when a feature's major lithology or descriptive field is mafic."""
    lith = props.get("lith") or props.get("lithology") or props.get("descrip") or ""
    if not lith and props.get("liths"):
        lith = " ".join(
            str(item.get("lith", item) if isinstance(item, dict) else item)
            for item in props["liths"]
        )
    text = str(lith)
    major = re.search(r"Major:\s*\{([^}]*)\}", text, re.I)
    return bool(MAFIC.search(major.group(1) if major else text))


def _tile_path(cache_dir: Path, tile) -> Path:
    return Path(cache_dir) / "macrostrat" / f"carto_z{TILE_ZOOM}_{tile[0]}_{tile[1]}.mvt"


def _fetch_tile(cache_dir: Path, tile) -> bytes:
    path = _tile_path(cache_dir, tile)
    if path.exists():
        return path.read_bytes()
    download(TILE_API.format(z=TILE_ZOOM, x=tile[0], y=tile[1]), path, min_bytes=1, timeout=180)
    return path.read_bytes()


def _decode_tile(raw: bytes, tile) -> list[dict]:
    import mapbox_vector_tile
    from shapely.affinity import affine_transform
    from shapely.geometry import mapping, shape

    decoded = mapbox_vector_tile.decode(raw, default_options={"y_coord_down": True})
    layer = decoded.get("units", {})
    extent = layer.get("extent", 4096)
    n = tile[2]
    lon0 = tile[0] / n * 360.0 - 180.0
    lon1 = (tile[0] + 1) / n * 360.0 - 180.0
    lat0 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * tile[1] / n))))
    lat1 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (tile[1] + 1) / n))))
    features = []
    for item in layer.get("features", []):
        props = item.get("properties") or {}
        if not is_major_mafic(props):
            continue
        geom = shape(item["geometry"])
        geom = affine_transform(
            geom,
            [(lon1 - lon0) / extent, 0, 0, (lat1 - lat0) / extent, lon0, lat0],
        )
        features.append(
            {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {"lith": str(props.get("lith") or props.get("lithology") or "")},
            }
        )
    return features


def parse_features(payload) -> list[dict]:
    """Retained for compatibility with cached/API fixtures."""
    if isinstance(payload, dict) and "success" in payload:
        payload = payload["success"].get("data", payload["success"])
    if isinstance(payload, dict) and payload.get("type") == "FeatureCollection":
        return payload.get("features", [])
    if isinstance(payload, dict) and "features" in payload:
        return payload["features"]
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and "error" in payload:
        raise RuntimeError(f"Macrostrat error: {str(payload['error'])[:200]}")
    return []


def fetch(cache_dir: Path, grid: Grid | None = None) -> list[dict]:
    grid = grid or Grid(0.1)
    out = []
    for tile in _tiles(grid):
        out.extend(_decode_tile(_fetch_tile(cache_dir, tile), tile))
    return out


def to_grid(grid: Grid, cache_dir: Path, feature: str = "basalt", **_) -> np.ndarray:
    from shapely.geometry import shape

    from .naturalearth import rasterize_fraction

    gkey = grid_tag(grid)
    path = grid_cache_path(NAME, feature, gkey)
    marker = f"grid_{gkey}_{NAME}"
    if is_done(marker) and path.exists():
        return np.load(path)
    geoms = []
    for item in fetch(cache_dir, grid):
        try:
            geom = shape(item["geometry"])
        except Exception:  # noqa: BLE001 - malformed polygon
            continue
        if not geom.is_empty:
            geoms.append((geom, None))
    if not geoms:
        raise RuntimeError("Macrostrat returned no mafic polygons (tile schema or coverage changed)")
    arr = rasterize_fraction(geoms, grid)
    save_grid(path, arr)
    mark_done(marker, {"polygons": len(geoms), "tile_zoom": TILE_ZOOM})
    return arr
