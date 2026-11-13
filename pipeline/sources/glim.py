"""GLiM - Global Lithological Map (Hartmann & Moosdorf 2012, CC-BY 3.0), PANGAEA doi:10.1594/PANGAEA.788537.

basalt = fraction of each cell mapped as 'vb' (basic volcanic) or 'pb' (basic plutonic/pyroclastic*)
ice    = fraction mapped as 'ig' (ice and glaciers)      [exposed as source "glim_ice"]

(*) GLiM level-1 classes: su sm sc ss py mt pa pi pb va vi vb ig wb nd. We use vb + pb as the
"basaltic / volcanic" fraction, following the challenge brief.

Download: the polygon database is large (~1 GB zipped). If the automatic download fails, download it
manually from PANGAEA and put the .zip / .gdb / .shp anywhere under pipeline/cache/glim/ (or set
GLIM_PATH in .env) - it will be picked up automatically.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import download, grid_cache_path, is_done, mark_done, save_grid

log = logging.getLogger("pipeline.glim")

NAME = "glim"
FEATURES = ["basalt"]
REQUIRES_TOKEN = False
HOST = "https://download.pangaea.de"
URLS = [
    "https://download.pangaea.de/dataset/788537/files/LiMW_GIS%202015.gdb.zip",
]
CLASS_FIELDS = ("xx", "XX", "Litho", "LITHO", "litho")
BASALT = ("vb", "pb")
ICE = ("ig",)


def _find_local(cache_dir: Path) -> Path | None:
    env = os.environ.get("GLIM_PATH")
    if env and Path(env).exists():
        return Path(env)
    d = Path(cache_dir) / "glim"
    if d.exists():
        for pat in ("*.gdb", "*.shp", "*.gpkg", "*.gdb.zip", "*.zip"):
            hits = sorted(d.rglob(pat))
            if hits:
                return hits[0]
    return None


def fetch(cache_dir: Path, grid: Grid | None = None) -> Path:
    local = _find_local(cache_dir)
    if local:
        return local
    dest = Path(cache_dir) / "glim" / "LiMW_GIS_2015.gdb.zip"
    download(URLS[0], dest, min_bytes=1_000_000, timeout=1800)
    return dest


def _read(path: Path):
    import geopandas as gpd

    p = str(path)
    if p.endswith(".zip"):
        p = f"zip://{p}"
    gdf = gpd.read_file(p, engine="pyogrio")
    field = next((c for c in CLASS_FIELDS if c in gdf.columns), None)
    if field is None:
        raise RuntimeError(f"GLiM: no lithology class column in {list(gdf.columns)[:10]}")
    gdf = gdf[[field, "geometry"]].rename(columns={field: "cls"})
    gdf["cls"] = gdf["cls"].astype(str).str.lower().str[:2]
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    return gdf


def _fraction(gdf, classes, grid: Grid) -> np.ndarray:
    from .naturalearth import rasterize_fraction

    sub = gdf[gdf["cls"].isin(classes)]
    log.info("GLiM: rasterising %d polygons of %s", len(sub), "/".join(classes))
    geoms = [(g, None) for g in sub.geometry.values if g is not None and not g.is_empty]
    return rasterize_fraction(geoms, grid)


def compute(grid: Grid, cache_dir: Path) -> dict[str, np.ndarray]:
    gkey = grid_tag(grid)
    marker = f"grid_{gkey}_glim"
    paths = {k: grid_cache_path("glim", k, gkey) for k in ("basalt", "ice")}
    if is_done(marker) and all(p.exists() for p in paths.values()):
        return {k: np.load(p) for k, p in paths.items()}
    src = fetch(cache_dir, grid)
    gdf = _read(src)
    res = {"basalt": _fraction(gdf, BASALT, grid), "ice": _fraction(gdf, ICE, grid)}
    for k, v in res.items():
        save_grid(paths[k], v)
    mark_done(marker, {"source": src.name})
    return res


def to_grid(grid: Grid, cache_dir: Path, feature: str = "basalt", **_) -> np.ndarray:
    return compute(grid, cache_dir)["basalt" if feature == "basalt" else "ice"]
