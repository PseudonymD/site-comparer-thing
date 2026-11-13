"""Factory for the thin GIBS-backed source modules (gibs_ndvi, gibs_lights, gibs_aod)."""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from ..grid import Grid, grid_tag
from ..util import grid_cache_path, is_done, mark_done, save_grid
from . import _gibs

log = logging.getLogger("pipeline.gibs")


def make(name: str, feature: str, candidates: list[tuple[str, list, str]], post=None):
    """candidates: [(layer, times, mode)] tried in order; mode in {"colormap", "luminance"}."""

    def fetch(cache_dir: Path, grid: Grid):
        return None  # downloads happen lazily inside to_grid (tile cache)

    def to_grid(grid: Grid, cache_dir: Path, feature_: str = feature, **_) -> np.ndarray:
        gkey = grid_tag(grid)
        path = grid_cache_path(name, feature, gkey)
        marker = f"grid_{gkey}_{name}"
        if is_done(marker) and path.exists():
            return np.load(path)
        errors = []
        for layer, times, mode in candidates:
            try:
                arr = _gibs.layer_mean(cache_dir, grid, layer, times, mode)
                if post is not None:
                    arr = post(arr)
                save_grid(path, arr)
                mark_done(marker, {"layer": layer, "times": times, "mode": mode})
                return np.load(path)
            except Exception as e:
                log.warning("GIBS layer %s failed: %s", layer, e)
                errors.append(f"{layer}: {e}")
        raise RuntimeError("; ".join(errors))

    return fetch, to_grid
