"""Shared reader for MODIS 0.05° Climate Modelling Grid (CMG) HDF4-EOS products.

HDF4 is read with `pyhdf` (wheels for Windows, Linux and Apple-silicon macOS). If pyhdf is not
installed (e.g. Intel Mac), these sources raise and the pipeline falls back to the no-auth source.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from . import earthdata

log = logging.getLogger("pipeline.modis")

YEAR = 2023


def require_pyhdf():
    try:
        from pyhdf.SD import SD, SDC  # noqa: F401
    except Exception as e:  # pragma: no cover - platform dependent
        raise RuntimeError("pyhdf not available (pip install pyhdf) - cannot read MODIS HDF4") from e


def read_sds(path: Path, name: str) -> tuple[np.ndarray, dict]:
    from pyhdf.SD import SD, SDC

    f = SD(str(path), SDC.READ)
    try:
        sds = f.select(name)
        data = sds.get()
        attrs = sds.attributes()
    finally:
        f.end()
    return data, attrs


def scaled(data: np.ndarray, attrs: dict) -> np.ndarray:
    a = data.astype(np.float64)
    fill = attrs.get("_FillValue")
    vr = attrs.get("valid_range")
    bad = np.zeros(a.shape, dtype=bool)
    if fill is not None:
        bad |= data == fill
    if vr is not None and len(vr) == 2:
        bad |= (data < vr[0]) | (data > vr[1])
    scale = float(attrs.get("scale_factor", 1.0))
    offset = float(attrs.get("add_offset", 0.0))
    # MODIS land products use value * scale_factor (+ offset) despite the HDF4 convention name.
    a = a * scale + offset
    a[bad] = np.nan
    return a


def granules(short_name: str, version: str, months: list[int] | None, cache_dir: Path) -> list[Path]:
    """Download (cached) the CMG granules for YEAR (all, or only the listed months)."""
    earthdata.require_token()
    entries = earthdata.search(short_name, f"{YEAR}-01-01T00:00:00Z,{YEAR}-12-31T23:59:59Z", version=version)
    paths = []
    for e in entries:
        url = earthdata.data_url(e, (".hdf",))
        if not url:
            continue
        if months:
            start = e.get("time_start", "")
            try:
                m = int(start[5:7])
            except ValueError:
                m = None
            if m not in months:
                continue
        paths.append(earthdata.fetch_file(url, Path(cache_dir) / short_name.lower()))
    if not paths:
        raise RuntimeError(f"no {short_name} granules found for {YEAR}")
    log.info("%s: %d granules", short_name, len(paths))
    return paths
