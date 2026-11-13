"""Clearly-flagged *synthetic* layers, used only when no real source can be reached.

Values are physically plausible (driven by latitude, elevation and smooth noise) so the web app and
the validation code always have something to work with, but they are NOT data. Every synthetic layer
is listed in meta.json -> features[i].synthetic = true and shown with a warning badge in the UI.
"""
from __future__ import annotations

import numpy as np

from ..grid import Grid

NAME = "synthetic"
FEATURES = "*"
REQUIRES_TOKEN = False


def _noise(grid: Grid, seed: int, octaves=((36, 1.0), (90, 0.5), (360, 0.25))) -> np.ndarray:
    """Smooth fractal noise in [-1, 1] on the grid (deterministic per seed)."""
    from scipy import ndimage

    rng = np.random.default_rng(seed)
    out = np.zeros(grid.shape, dtype=np.float32)
    total = 0.0
    for n_lat, amp in octaves:
        n_lat = min(n_lat, grid.n_lat)
        n_lon = n_lat * 2
        base = rng.standard_normal((n_lat, n_lon)).astype(np.float32)
        z = ndimage.zoom(base, (grid.n_lat / n_lat, grid.n_lon / n_lon), order=3, mode="grid-wrap")
        out += amp * z[: grid.n_lat, : grid.n_lon]
        total += amp
    out /= total
    return np.clip(out / (3 * out.std() + 1e-9), -1, 1)


def synthetic_elevation(grid: Grid) -> np.ndarray:
    n = _noise(grid, 11)
    return np.maximum(0, 600 + 1800 * n + 900 * np.maximum(0, _noise(grid, 12)) ** 2 * 4).astype(np.float32)


def layers(grid: Grid, elevation: np.ndarray | None = None, ice: np.ndarray | None = None) -> dict[str, np.ndarray]:
    lat, _ = grid.lat_lon_mesh()
    alat = np.abs(lat).astype(np.float32)
    e = synthetic_elevation(grid) if elevation is None else np.nan_to_num(np.maximum(elevation, 0), nan=0.0)
    out: dict[str, np.ndarray] = {}

    # Terrain from elevation texture (only used if terrain tiles are unreachable).
    rough = (0.5 + 0.5 * _noise(grid, 21)) * (0.2 + e / 3000)
    out["elevation"] = e.astype(np.float32)
    out["slope_mean"] = np.clip(1 + 12 * rough, 0, 40)
    out["slope_p90"] = np.clip(out["slope_mean"] * 1.9, 0, 60)
    out["tri"] = np.clip(5 + 150 * rough, 0, 800)
    out["relief"] = np.clip(30 + 1500 * rough, 0, 5000)

    # Climate: zonal circulation + lapse rate + noise.
    sub = np.exp(-((alat - 25) / 9) ** 2)  # subtropical dry belt
    itcz = np.exp(-(lat / 9) ** 2)
    west = np.exp(-((alat - 50) / 12) ** 2)
    arid = np.clip(sub * (0.7 + 0.3 * _noise(grid, 31)) + 0.25 * _noise(grid, 32), 0, 1)
    out["temp_mean"] = 27 - 0.0065 * e - 0.0072 * alat ** 2 + 3 * _noise(grid, 33)
    precip = (2200 * itcz + 900 * west + 300) * (1 - 0.85 * arid) * np.exp(0.5 * _noise(grid, 34))
    precip *= np.where(alat > 65, 0.35, 1.0)
    out["precip"] = np.clip(precip, 2, 6000)
    out["temp_range"] = np.clip(7 + 12 * arid + 0.002 * e + 2 * _noise(grid, 35), 2, 25)
    out["temp_min"] = out["temp_mean"] - (8 + 0.3 * alat) - 3 * np.abs(_noise(grid, 36))
    out["humidity"] = np.clip(25 + 60 * (out["precip"] / (out["precip"] + 500)), 5, 98)
    cloud = out["precip"] / (out["precip"] + 1500)
    out["solar"] = np.clip(7.2 * np.cos(np.radians(alat)) ** 0.7 * (1 - 0.45 * cloud) + 0.4, 1.8, 7.5)

    # Surface.
    t = out["temp_mean"]
    warm = np.clip((t + 5) / 15, 0, 1)
    out["ndvi"] = np.clip(0.9 * (out["precip"] / (out["precip"] + 700)) * warm - 0.03 + 0.05 * _noise(grid, 41), -0.1, 0.9)
    out["soc"] = np.clip(3 + 70 * np.maximum(out["ndvi"], 0) + 40 * (t < 0) * (out["precip"] > 300), 0.5, 250)
    out["sand"] = np.clip(35 + 45 * arid + 12 * _noise(grid, 42), 3, 97)
    out["basalt"] = np.clip((_noise(grid, 43, ((60, 1.0), (360, 0.6))) - 0.55) * 3, 0, 1)
    if ice is None:
        ice = np.clip((-12 - t) / 6, 0, 1)
    out["ice"] = ice.astype(np.float32)
    temperate = np.exp(-((alat - 38) / 18) ** 2) * np.clip(1 - e / 3000, 0, 1) * (1 - arid * 0.7)
    out["lights"] = np.clip(np.exp(6 * (_noise(grid, 51, ((90, 1.0), (360, 1.0))) - 0.3)) * temperate - 0.3, 0, 300)
    dust = np.exp(-((lat - 20) / 10) ** 2) * arid
    out["aod"] = np.clip(0.06 + 0.5 * dust + 0.08 * _noise(grid, 52) + 0.15 * np.exp(-((lat - 25) / 8) ** 2), 0.01, 1.2)
    return {k: v.astype(np.float32) for k, v in out.items()}


_CACHE: dict = {}


def to_grid(grid: Grid, cache_dir=None, feature: str = "elevation", elevation=None, ice=None) -> np.ndarray:
    key = (grid.res, None if elevation is None else id(elevation), None if ice is None else id(ice))
    if key not in _CACHE:
        _CACHE.clear()
        _CACHE[key] = layers(grid, elevation, ice)
    return _CACHE[key][feature]


def fetch(cache_dir=None, grid=None) -> None:
    return None
