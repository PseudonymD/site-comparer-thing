"""Regridding helpers shared by the source modules."""
from __future__ import annotations

import numpy as np

from ..grid import Grid, block_reduce_mean


def fill_nearest(a: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray:
    """Fill NaNs with the nearest finite value (only where mask is True, if given)."""
    from scipy import ndimage

    bad = ~np.isfinite(a)
    if not bad.any() or bad.all():
        return a
    _, (ri, ci) = ndimage.distance_transform_edt(bad, return_indices=True)
    filled = a[ri, ci]
    if mask is None:
        return filled
    return np.where(bad & mask, filled, a)


def regular_to_grid(src: np.ndarray, src_lat: np.ndarray, src_lon: np.ndarray, grid: Grid,
                    order: int = 1) -> np.ndarray:
    """Bilinear (order=1) interpolation of a regular lat/lon raster (cell centres given) onto grid.

    src_lat must be monotonic (either direction); src_lon in [-180, 360). Longitudes wrap.
    NaNs are filled by nearest neighbour first so they don't spread.
    """
    from scipy import ndimage

    src = np.asarray(src, dtype=np.float64)
    src_lat = np.asarray(src_lat, dtype=np.float64)
    src_lon = ((np.asarray(src_lon, dtype=np.float64) + 180.0) % 360.0) - 180.0
    order_lon = np.argsort(src_lon)
    src_lon = src_lon[order_lon]
    src = src[:, order_lon]
    if src_lat[0] > src_lat[-1]:
        src_lat = src_lat[::-1]
        src = src[::-1]
    src = fill_nearest(src)
    # Fractional indices of the target centres.
    lat_i = np.interp(grid.lats(), src_lat, np.arange(src_lat.size))
    dlon = np.median(np.diff(src_lon))
    lon_i = (grid.lons() - src_lon[0]) / dlon
    # Pad one column on each side for wrap-around.
    padded = np.concatenate([src[:, -1:], src, src[:, :1]], axis=1)
    LI, LO = np.meshgrid(lat_i, lon_i + 1.0, indexing="ij")
    out = ndimage.map_coordinates(padded, [LI, LO], order=order, mode="nearest")
    return out.astype(np.float32)


def points_to_grid(lon: np.ndarray, lat: np.ndarray, val: np.ndarray, grid: Grid,
                   native_dlat: float, native_dlon: float) -> np.ndarray:
    """Scattered points on a (roughly) regular native lattice -> grid, via an intermediate raster."""
    nlat = int(round(180.0 / native_dlat))
    nlon = int(round(360.0 / native_dlon))
    r = np.clip(np.floor((90.0 - lat) / native_dlat + 0.5).astype(int), 0, nlat)
    c = np.floor((((lon + 180.0) % 360.0)) / native_dlon + 0.5).astype(int) % nlon
    s = np.zeros((nlat + 1, nlon))
    n = np.zeros((nlat + 1, nlon))
    ok = np.isfinite(val)
    np.add.at(s, (r[ok], c[ok]), val[ok])
    np.add.at(n, (r[ok], c[ok]), 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        raster = np.where(n > 0, s / n, np.nan)
    src_lat = 90.0 - np.arange(nlat + 1) * native_dlat
    src_lon = -180.0 + np.arange(nlon) * native_dlon
    return regular_to_grid(raster, src_lat, src_lon, grid)


def cmg_to_grid(a: np.ndarray, grid: Grid, cmg_res: float = 0.05) -> np.ndarray:
    """Global climate-modelling-grid raster (north-up, -180..180) -> grid by mean pooling."""
    factor = grid.res / cmg_res
    if abs(factor - round(factor)) < 1e-6 and factor >= 1:
        return block_reduce_mean(a.astype(np.float32), int(round(factor))).astype(np.float32)
    n_lat, n_lon = a.shape
    lat = 90.0 - (np.arange(n_lat) + 0.5) * cmg_res
    lon = -180.0 + (np.arange(n_lon) + 0.5) * cmg_res
    return regular_to_grid(a, lat, lon, grid)
