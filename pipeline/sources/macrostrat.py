"""Basaltic / mafic fraction from the Macrostrat geologic map API (no login, CC-BY 4.0): https://macrostrat.org

No-login fallback for GLiM (see glim.py). Macrostrat harmonises many geological maps into one database and
serves map polygons with lithology attributes. We request the small-scale global compilation one lithology
at a time (basalt, gabbro, diabase/dolerite, "mafic volcanic") in 30°x30° tiles, keep polygons whose
*major* lithology is one of those, and rasterise their union to a per-cell fraction - the same definition as
GLiM vb + pb ("basic volcanic + basic plutonic").

Caveats (also shown in the UI via meta.json): Macrostrat's small-scale coverage is uneven between
continents, and its polygons are generalised. Treat it as a fallback, not a replacement for GLiM.
Responses are cached under pipeline/cache/macrostrat/, so reruns are offline.

Not testable from the cloud session that wrote it (macrostrat.org is blocked there); the parser is unit
tested with a recorded-shape fixture. The teammate smoke test is in pipeline/README.md ("Basalt hot-fix").
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import get_json, grid_cache_path, is_done, mark_done, save_grid

log = logging.getLogger("pipeline.macrostrat")

NAME = "macrostrat"
FEATURES = ["basalt"]
REQUIRES_TOKEN = False
HOST = "https://macrostrat.org"
PROBE = "https://macrostrat.org/api/v2/"
API = "https://macrostrat.org/api/v2/geologic_units/map"
SCALE = __import__("os").environ.get("MACROSTRAT_SCALE", "small")  # tiny | small | medium
LITHS = ["basalt", "gabbro", "diabase", "dolerite", "mafic volcanic"]
MAFIC = re.compile(r"basalt|gabbro|diabase|dolerite|mafic|picrite|komatiite|tholeiite|basanite|norite|troctolite",
                   re.I)
TILE_DEG = 30


def _tiles(grid: Grid):
    minlon, minlat, maxlon, maxlat = grid.bbox or (-180.0, -90.0, 180.0, 90.0)
    for lat0 in range(-90, 90, TILE_DEG):
        for lon0 in range(-180, 180, TILE_DEG):
            lat1, lon1 = lat0 + TILE_DEG, lon0 + TILE_DEG
            if lon1 <= minlon or lon0 >= maxlon or lat1 <= minlat or lat0 >= maxlat:
                continue
            yield lon0, lat0, lon1, lat1


def _wkt(lon0, lat0, lon1, lat1) -> str:
    return f"POLYGON(({lon0} {lat0},{lon1} {lat0},{lon1} {lat1},{lon0} {lat1},{lon0} {lat0}))"


def is_major_mafic(props: dict) -> bool:
    """True if a polygon's *major* lithology is mafic. Macrostrat writes e.g. 'Major:{basalt}, Minor:{tuff}'
    in `lith`, or gives a `liths` list of {lith, ...}; plain names are treated as major."""
    lith = props.get("lith") or ""
    if isinstance(lith, str) and lith:
        m = re.search(r"Major:\s*\{([^}]*)\}", lith)
        return bool(MAFIC.search(m.group(1) if m else lith))
    liths = props.get("liths") or []
    names = " ".join(str(x.get("lith", x) if isinstance(x, dict) else x) for x in liths)
    return bool(MAFIC.search(names))


def parse_features(payload) -> list[dict]:
    """GeoJSON FeatureCollection, bare feature list, or {'success': {'data': ...}} -> list of features."""
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


def _fetch_tile(cache_dir: Path, lith: str, tile) -> list[dict]:
    p = Path(cache_dir) / "macrostrat" / f"{SCALE}_{lith.replace(' ', '_')}_{tile[0]}_{tile[1]}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    payload = get_json(API, params={"lith": lith, "scale": SCALE, "shape": _wkt(*tile), "format": "geojson_bare"},
                       timeout=180)
    feats = [f for f in parse_features(payload) if f.get("geometry")]
    keep = [{"type": "Feature", "geometry": f["geometry"],
             "properties": {"lith": (f.get("properties") or {}).get("lith", ""),
                            "liths": (f.get("properties") or {}).get("liths", [])}} for f in feats]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(keep), encoding="utf-8")
    return keep


def fetch(cache_dir: Path, grid: Grid | None = None) -> list[dict]:
    grid = grid or Grid(0.1)
    out = []
    for tile in _tiles(grid):
        for lith in LITHS:
            out.extend(_fetch_tile(cache_dir, lith, tile))
    return out


def to_grid(grid: Grid, cache_dir: Path, feature: str = "basalt", **_) -> np.ndarray:
    from shapely.geometry import shape

    from .naturalearth import rasterize_fraction

    gkey = grid_tag(grid)
    path = grid_cache_path(NAME, feature, gkey)
    marker = f"grid_{gkey}_{NAME}"
    if is_done(marker) and path.exists():
        return np.load(path)
    feats = fetch(cache_dir, grid)
    geoms = []
    for f in feats:
        if not is_major_mafic(f.get("properties") or {}):
            continue
        try:
            g = shape(f["geometry"])
        except Exception:  # noqa: BLE001 - malformed polygon
            continue
        if not g.is_empty:
            geoms.append((g, None))
    if not geoms:
        raise RuntimeError("Macrostrat returned no mafic polygons (API change?)")
    log.info("Macrostrat: rasterising %d mafic polygons", len(geoms))
    arr = rasterize_fraction(geoms, grid)  # overlapping duplicates (one per lith query) are unioned by burning
    save_grid(path, arr)
    mark_done(marker, {"polygons": len(geoms)})
    return arr
