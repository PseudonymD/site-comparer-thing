"""Earth-percentile normalisation (z = CDF_f(x) over land cells), quantisation and binary export."""
from __future__ import annotations

import gzip
import json
import logging
from pathlib import Path

import numpy as np

from .config import FEATURES, N_BREAKPOINTS

log = logging.getLogger("pipeline.normalize")


class EarthCDF:
    """Empirical CDF of one feature over all land cells (mid-rank for ties)."""

    def __init__(self, values: np.ndarray):
        v = np.asarray(values, dtype=np.float64)
        v = v[np.isfinite(v)]
        if v.size == 0:
            raise ValueError("no finite values")
        self.sorted = np.sort(v)
        self.n = self.sorted.size

    @property
    def min(self) -> float:
        return float(self.sorted[0])

    @property
    def max(self) -> float:
        return float(self.sorted[-1])

    def __call__(self, x) -> np.ndarray:
        x = np.asarray(x, dtype=np.float64)
        lo = np.searchsorted(self.sorted, x, side="left")
        hi = np.searchsorted(self.sorted, x, side="right")
        return ((lo + hi) / (2.0 * self.n)).clip(0.0, 1.0)

    def clamp_cdf(self, x: float) -> float:
        """Target mapping: t = CDF(clamp(T, earth_min, earth_max))."""
        return float(self(np.clip(x, self.min, self.max)))

    def breakpoints(self, n: int = N_BREAKPOINTS) -> list[float]:
        q = np.quantile(self.sorted, np.linspace(0, 1, n))
        return [float(round(v, 4)) for v in q]


def quantize(z: np.ndarray) -> np.ndarray:
    return np.clip(np.round(np.asarray(z) * 255.0), 0, 255).astype(np.uint8)


def dequantize(q: np.ndarray) -> np.ndarray:
    return np.asarray(q, dtype=np.float64) / 255.0


def normalize_all(raw: dict[str, np.ndarray], land_idx: np.ndarray) -> tuple[np.ndarray, dict[str, EarthCDF]]:
    """raw: feature -> (n_lat, n_lon) float arrays. Returns uint8 (n_land, 18) and the CDFs."""
    n = land_idx.size
    out = np.zeros((n, len(FEATURES)), dtype=np.uint8)
    cdfs = {}
    for j, f in enumerate(FEATURES):
        vals = raw[f.id].ravel()[land_idx].astype(np.float64)
        cdf = EarthCDF(vals)
        cdfs[f.id] = cdf
        out[:, j] = quantize(cdf(vals))
    return out, cdfs


def write_binary(path: Path, arr: np.ndarray, gz: bool = True) -> list[Path]:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.ascontiguousarray(arr).tobytes()
    written = []
    path.write_bytes(data)
    written.append(path)
    if gz:
        gzp = path.with_name(path.name + ".gz")
        with gzip.open(gzp, "wb", compresslevel=9) as f:
            f.write(data)
        written.append(gzp)
    return written


def write_json(path: Path, obj) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False), encoding="utf-8")
    return path
