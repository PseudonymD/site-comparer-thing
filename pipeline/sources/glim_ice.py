"""Permanent ice fraction from GLiM class 'ig' (see glim.py)."""
from . import glim
from .glim import HOST  # noqa: F401

NAME = "glim_ice"
FEATURES = ["ice"]
REQUIRES_TOKEN = False


def fetch(cache_dir, grid=None):
    return glim.fetch(cache_dir, grid)


def to_grid(grid, cache_dir, feature="ice", **_):
    return glim.compute(grid, cache_dir)["ice"]
