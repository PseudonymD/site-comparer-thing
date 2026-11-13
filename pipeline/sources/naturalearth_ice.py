"""Permanent ice fraction from Natural Earth glaciated areas + Antarctic ice (see naturalearth.py)."""
from . import naturalearth
from .naturalearth import HOST, PROBE  # noqa: F401

NAME = "naturalearth_ice"
FEATURES = ["ice"]
REQUIRES_TOKEN = False


def fetch(cache_dir, grid=None):
    return naturalearth.fetch(cache_dir, grid, keys=("glaciers", "iceshelves"))


def is_cached(grid):
    from ..config import CACHE_DIR

    return all(naturalearth._path(CACHE_DIR, k).exists() for k in ("glaciers", "iceshelves"))


def to_grid(grid, cache_dir, feature="ice", **_):
    return naturalearth.to_grid(grid, cache_dir, "ice")
