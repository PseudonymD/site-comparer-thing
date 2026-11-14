"""Reference implementation of the analog score (spec: docs/scoring.md). Mirrored in web/src/scoring.ts.

    S_i  = 1 - sqrt( sum_f w_f d_if^2 / sum_f w_f )
    c_if = w_f d_if^2 / sum_f w_f
    d_if = max(L_f - z_if, 0, z_if - U_f), with L_f = U_f = t_f by default
    z_if = q_if / 255   (q = stored uint8)

Hard filters set S_i = 0. Novelty N_i = min(d_i / D0, 1); blended B_i = (1 - a) S_i + a N_i (0 if filtered).
"""
from __future__ import annotations

import numpy as np

from .config import NOVELTY_SATURATION_KM
from .grid import haversine_km


def _validated_weights(weights: np.ndarray, expected: int | None = None) -> tuple[np.ndarray, float]:
    w = np.asarray(weights, dtype=np.float64)
    if expected is not None and w.shape != (expected,):
        raise ValueError(f"weights must have shape ({expected},)")
    if not np.all(np.isfinite(w)) or np.any(w < 0):
        raise ValueError("weights must be finite and non-negative")
    wsum = float(w.sum())
    if wsum <= 0:
        raise ValueError("at least one weight must be greater than zero")
    return w, wsum


def _validated_ranges(target: np.ndarray, target_ranges: np.ndarray | None) -> np.ndarray:
    t = np.asarray(target, dtype=np.float64)
    if t.ndim != 1:
        raise ValueError("target must be one-dimensional")
    if target_ranges is None:
        ranges = np.column_stack((t, t))
    else:
        ranges = np.asarray(target_ranges, dtype=np.float64)
        if ranges.shape != (t.size, 2):
            raise ValueError(f"target_ranges must have shape ({t.size}, 2)")
    if not np.all(np.isfinite(ranges)) or np.any(ranges < 0) or np.any(ranges > 1) or np.any(ranges[:, 0] > ranges[:, 1]):
        raise ValueError("target ranges must be finite, ordered, and within [0, 1]")
    return ranges


def _interval_distance(z: np.ndarray, ranges: np.ndarray) -> np.ndarray:
    return np.maximum(ranges[:, 0][None, :] - z, 0) + np.maximum(z - ranges[:, 1][None, :], 0)


def score(q: np.ndarray, target: np.ndarray, weights: np.ndarray,
          filters: list[tuple[int, float]] | None = None,
          target_ranges: np.ndarray | None = None) -> np.ndarray:
    """q: uint8 (n, F); target: (F,) in [0,1]; weights: (F,) >= 0;
    filters: [(feature_index, z_threshold)] -> exclude cells with z > z_threshold. Returns float64 (n,)."""
    w, wsum = _validated_weights(weights, q.shape[1])
    ranges = _validated_ranges(target, target_ranges)
    z = q.astype(np.float64) / 255.0
    valid = np.isfinite(z).all(axis=1)
    d2 = _interval_distance(z, ranges) ** 2
    s = 1.0 - np.sqrt((d2 * w[None, :]).sum(axis=1) / wsum)
    s = np.clip(s, 0.0, 1.0)
    s[~valid] = 0.0
    for j, thr in filters or []:
        s[z[:, j] > thr] = 0.0
    return s


def contributions(qrow: np.ndarray, target: np.ndarray, weights: np.ndarray,
                  target_ranges: np.ndarray | None = None) -> np.ndarray:
    w, wsum = _validated_weights(weights, qrow.shape[-1])
    z = qrow.astype(np.float64) / 255.0
    ranges = _validated_ranges(target, target_ranges)
    if not np.isfinite(z).all():
        return np.full(qrow.shape[-1], np.nan)
    d = _interval_distance(z[None, :], ranges)[0]
    return w * d ** 2 / wsum


def novelty(lat: np.ndarray, lon: np.ndarray, analogs: list[dict]) -> np.ndarray:
    """Great-circle km to the nearest known analog, and the saturated novelty in [0,1]."""
    d = np.full(np.shape(lat), np.inf)
    for a in analogs:
        d = np.minimum(d, haversine_km(lat, lon, a["lat"], a["lon"]))
    return d


def novelty_unit(d_km: np.ndarray) -> np.ndarray:
    return np.minimum(np.asarray(d_km) / NOVELTY_SATURATION_KM, 1.0)


def blend(s: np.ndarray, d_km: np.ndarray, alpha: float) -> np.ndarray:
    b = (1.0 - alpha) * s + alpha * novelty_unit(d_km)
    return np.where(s > 0, b, 0.0)


def z_threshold_from_value(breakpoints, tau: float) -> float:
    """Real-unit threshold -> percentile threshold for "exclude value > tau" (docs/scoring.md)."""
    n = len(breakpoints) - 1
    k = -1
    for i, b in enumerate(breakpoints):
        if b <= tau:
            k = i
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    a, b = breakpoints[k], breakpoints[k + 1]
    frac = (tau - a) / (b - a) if b > a else 0.0
    return (k + frac) / n
