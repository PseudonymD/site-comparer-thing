"""The global regular lat/lon grid (EPSG:4326) that every feature is resampled onto.

Row 0 is the northernmost row. Cell index = row * n_lon + col.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Grid:
    res: float = 0.1
    bbox: tuple[float, float, float, float] | None = None  # optional processing window

    def __post_init__(self):
        n = 360.0 / self.res
        if abs(n - round(n)) > 1e-6 or abs(180.0 / self.res - round(180.0 / self.res)) > 1e-6:
            raise ValueError(f"resolution {self.res} must divide 180 evenly")

    @property
    def n_lon(self) -> int:
        return int(round(360.0 / self.res))

    @property
    def n_lat(self) -> int:
        return int(round(180.0 / self.res))

    @property
    def shape(self) -> tuple[int, int]:
        return (self.n_lat, self.n_lon)

    @property
    def size(self) -> int:
        return self.n_lat * self.n_lon

    @property
    def key(self) -> str:
        """Short string used in cache filenames (bbox does not change the grid geometry)."""
        return f"r{self.res:g}".replace(".", "p")

    @property
    def transform(self):
        from rasterio.transform import from_origin

        return from_origin(-180.0, 90.0, self.res, self.res)

    def lats(self) -> np.ndarray:
        return (90.0 - self.res * (np.arange(self.n_lat) + 0.5)).astype(np.float64)

    def lons(self) -> np.ndarray:
        return (-180.0 + self.res * (np.arange(self.n_lon) + 0.5)).astype(np.float64)

    def lat_lon_mesh(self) -> tuple[np.ndarray, np.ndarray]:
        lon, lat = np.meshgrid(self.lons(), self.lats())
        return lat, lon

    def row_of_lat(self, lat: float) -> int:
        return int(min(self.n_lat - 1, max(0, math.floor((90.0 - lat) / self.res))))

    def col_of_lon(self, lon: float) -> int:
        lon = ((lon + 180.0) % 360.0) - 180.0
        return int(min(self.n_lon - 1, max(0, math.floor((lon + 180.0) / self.res))))

    def index_of(self, lat: float, lon: float) -> int:
        return self.row_of_lat(lat) * self.n_lon + self.col_of_lon(lon)

    def bbox_mask(self) -> np.ndarray:
        """Boolean (n_lat, n_lon) mask of cells inside the processing bbox (all True if none)."""
        if self.bbox is None:
            return np.ones(self.shape, dtype=bool)
        minlon, minlat, maxlon, maxlat = self.bbox
        lat, lon = self.lat_lon_mesh()
        return (lon >= minlon) & (lon <= maxlon) & (lat >= minlat) & (lat <= maxlat)

    def bbox_slices(self) -> tuple[slice, slice]:
        """Row/col slices covering the bbox (whole grid if none)."""
        if self.bbox is None:
            return slice(0, self.n_lat), slice(0, self.n_lon)
        minlon, minlat, maxlon, maxlat = self.bbox
        eps = 1e-9
        r0 = max(0, math.floor((90.0 - maxlat) / self.res + eps))
        r1 = min(self.n_lat, math.ceil((90.0 - minlat) / self.res - eps))
        c0 = max(0, math.floor((minlon + 180.0) / self.res + eps))
        c1 = min(self.n_lon, math.ceil((maxlon + 180.0) / self.res - eps))
        return slice(r0, max(r0 + 1, r1)), slice(c0, max(c0 + 1, c1))

    def cell_area_km2(self) -> np.ndarray:
        """Per-row cell area (km²), shape (n_lat,)."""
        r = 6371.0088
        lat = np.radians(self.lats())
        dlat = math.radians(self.res)
        return (r * r * dlat * dlat * np.cos(lat)).astype(np.float64)


def block_reduce_mean(a: np.ndarray, factor: int) -> np.ndarray:
    """Mean-pool a 2-D array by an integer factor (NaNs ignored)."""
    if factor == 1:
        return a
    h, w = a.shape
    a = a[: h - h % factor, : w - w % factor]
    v = a.reshape(h // factor, factor, w // factor, factor)
    with np.errstate(invalid="ignore"):
        return np.nanmean(v, axis=(1, 3))


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def grid_tag(grid: Grid) -> str:
    """Cache key that includes the processing bbox (so --bbox runs never collide with global runs)."""
    if grid.bbox is None:
        return grid.key
    b = "_".join(f"{v:g}" for v in grid.bbox).replace("-", "m").replace(".", "p")
    return f"{grid.key}_bbox_{b}"
