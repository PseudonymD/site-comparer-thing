"""GLiM - Global Lithological Map (Hartmann & Moosdorf 2012, CC-BY 3.0), PANGAEA doi:10.1594/PANGAEA.788537.

basalt = fraction of each cell mapped as 'vb' (basic volcanic) or 'pb' (basic plutonic/pyroclastic*)
ice    = fraction mapped as 'ig' (ice and glaciers)      [exposed as source "glim_ice"]

(*) GLiM level-1 classes: su sm sc ss py mt pa pi pb va vi vb ig wb nd. We use vb + pb as the
"basaltic / volcanic" fraction, following the challenge brief.

The PANGAEA record publishes a 0.5° ESRI ASCII grid. A local polygon database is also supported for
backwards compatibility: put the .zip / .gdb / .shp anywhere under pipeline/cache/glim/ (or set
GLIM_PATH in .env).
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
HOST = "https://doi.pangaea.de"
PROBE = "https://doi.pangaea.de/10.1594/PANGAEA.788537"
URLS = ["https://hdl.handle.net/10013/epic.39939.d001"]
MANUAL = ("Download the GLiM dataset from https://doi.pangaea.de/10.1594/PANGAEA.788537 and put it under "
          "pipeline/cache/glim/ (or set GLIM_PATH in .env), then rerun.")
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
    dest = Path(cache_dir) / "glim" / "glim_wgs84_0point5deg.zip"
    status = archive_status()
    if status:
        raise RuntimeError(f"GLiM: {status}. {MANUAL}")
    errors = []
    for url in URLS:
        try:
            download(url, dest, min_bytes=10_000, timeout=1800, retries=4)
            return dest
        except Exception as e:  # noqa: BLE001
            errors.append(f"{url}: {e}")
    raise RuntimeError(f"GLiM download failed ({'; '.join(errors)[:300]}). {MANUAL}")


def archive_status(timeout: float = 30.0) -> str | None:
    """None if the PANGAEA file is downloadable, else a one-line reason."""
    from ..util import session

    try:
        with session().get(URLS[0], stream=True, timeout=timeout, headers={"Range": "bytes=0-1023"}) as r:
            if r.status_code in (200, 206):
                return None
            body = r.raw.read(20000, decode_content=True).decode("utf-8", "replace") if r.status_code >= 400 else ""
            return f"PANGAEA download answered HTTP {r.status_code}: {body[:160].strip()}"
    except Exception as e:  # noqa: BLE001
        return f"PANGAEA unreachable ({e.__class__.__name__})"


def _read_polygon(path: Path):
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


def _read_grid(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    import io
    import zipfile

    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".asc")]
        if not names:
            raise RuntimeError("GLiM: PANGAEA archive contains no ASCII grid")
        raw = io.TextIOWrapper(zf.open(names[0]), encoding="ascii")
        header = {}
        for _ in range(6):
            key, value = raw.readline().split()[:2]
            header[key.lower()] = float(value)
        values = np.loadtxt(raw, dtype=np.float32)
    nrows, ncols = int(header["nrows"]), int(header["ncols"])
    if values.shape != (nrows, ncols):
        raise RuntimeError(f"GLiM: expected {(nrows, ncols)} cells, got {values.shape}")
    values[values == header.get("nodata_value", -9999.0)] = np.nan
    lat = header["yllcorner"] + (nrows - np.arange(nrows, dtype=np.float32) - 0.5) * header["cellsize"]
    lon = header["xllcorner"] + (np.arange(ncols, dtype=np.float32) + 0.5) * header["cellsize"]
    return values, lat, lon


def _is_grid_archive(path: Path) -> bool:
    import zipfile

    try:
        with zipfile.ZipFile(path) as zf:
            return any(name.lower().endswith(".asc") for name in zf.namelist())
    except (OSError, zipfile.BadZipFile):
        return False


def _grid_fraction(values: np.ndarray, classes, lat: np.ndarray, lon: np.ndarray, grid: Grid) -> np.ndarray:
    from ._regrid import regular_to_grid

    valid = np.isfinite(values)
    fraction = np.where(valid, np.isin(values, classes).astype(np.float32), np.nan)
    return regular_to_grid(fraction, lat, lon, grid, order=1)


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
    if _is_grid_archive(src):
        values, lat, lon = _read_grid(src)
        res = {
            "basalt": _grid_fraction(values, (2, 4), lat, lon, grid),
            "ice": _grid_fraction(values, (16,), lat, lon, grid),
        }
    else:
        gdf = _read_polygon(src)
        res = {"basalt": _fraction(gdf, BASALT, grid), "ice": _fraction(gdf, ICE, grid)}
    for k, v in res.items():
        save_grid(paths[k], v)
    mark_done(marker, {"source": src.name})
    return res


def to_grid(grid: Grid, cache_dir: Path, feature: str = "basalt", **_) -> np.ndarray:
    return compute(grid, cache_dir)["basalt" if feature == "basalt" else "ice"]
