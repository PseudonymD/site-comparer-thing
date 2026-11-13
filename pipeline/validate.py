"""Validation: do known analog sites score higher than random land? -> pipeline/report.md"""
from __future__ import annotations

import logging
from datetime import datetime

import numpy as np

from .grid import Grid
from .scoring import score

log = logging.getLogger("pipeline.validate")

N_RANDOM = 1000
NEIGHBOURHOOD = 2  # cells: site score = best cell within ±2 cells (site coordinates are approximate)


def _site_score(score_grid: np.ndarray, grid: Grid, lat: float, lon: float) -> float:
    r, c = grid.row_of_lat(lat), grid.col_of_lon(lon)
    k = NEIGHBOURHOOD
    win = score_grid[max(0, r - k): r + k + 1, :].take(range(c - k, c + k + 1), axis=1, mode="wrap")
    v = win[np.isfinite(win)]
    return float(v.max()) if v.size else float("nan")


def auc(pos: np.ndarray, neg: np.ndarray) -> float:
    """ROC-AUC = P(score_pos > score_neg) + 0.5 P(tie) (Mann-Whitney U)."""
    pos, neg = np.asarray(pos), np.asarray(neg)
    pos, neg = pos[np.isfinite(pos)], neg[np.isfinite(neg)]
    if pos.size == 0 or neg.size == 0:
        return float("nan")
    gt = (pos[:, None] > neg[None, :]).sum()
    eq = (pos[:, None] == neg[None, :]).sum()
    return float((gt + 0.5 * eq) / (pos.size * neg.size))


def validate(q: np.ndarray, land_idx: np.ndarray, grid: Grid, targets: dict, analogs: list[dict],
             synthetic_features: list[str], seed: int = 42) -> tuple[dict, str]:
    rng = np.random.default_rng(seed)
    by_id = {a["id"]: a for a in analogs}
    rand_idx = rng.choice(land_idx.size, size=min(N_RANDOM, land_idx.size), replace=False)
    results = []
    for t in targets["targets"]:
        s = score(q, np.array(t["vector"]), np.array(t["weights"]))
        g = np.full(grid.size, np.nan, dtype=np.float32)
        g[land_idx] = s
        g = g.reshape(grid.shape)
        sorted_s = np.sort(s)
        neg = np.array([_site_score(g, grid, *divmod_latlon(grid, land_idx[i])) for i in rand_idx])
        rows = []
        for aid in t["validation"]:
            a = by_id[aid]
            v = _site_score(g, grid, a["lat"], a["lon"])
            pct = float(np.searchsorted(sorted_s, v, side="right") / sorted_s.size * 100) if np.isfinite(v) else float("nan")
            rank = int(sorted_s.size - np.searchsorted(sorted_s, v, side="left")) if np.isfinite(v) else None
            rows.append({"id": aid, "name": a["name"], "score": round(v, 4), "percentile": round(pct, 2), "rank": rank})
        pos = np.array([r["score"] for r in rows], dtype=float)
        results.append({
            "target": t["id"], "name": t["name"], "auc": round(auc(pos, neg), 3),
            "median_analog_percentile": _nanmedian([r["percentile"] for r in rows]),
            "random_median_score": round(float(np.median(neg)), 4), "analogs": rows,
        })
    md = _markdown(results, synthetic_features, land_idx.size)
    return {"generated": datetime.now().isoformat(timespec="seconds"), "n_random": int(rand_idx.size),
            "synthetic_features": synthetic_features, "results": results}, md


def divmod_latlon(grid: Grid, cell: int) -> tuple[float, float]:
    r, c = divmod(int(cell), grid.n_lon)
    return 90 - (r + 0.5) * grid.res, -180 + (c + 0.5) * grid.res


def _markdown(results, synthetic, n_land) -> str:
    lines = [
        "# Validation report", "",
        f"Generated {datetime.now():%Y-%m-%d %H:%M}. Land cells scored: {n_land:,}.", "",
        "For each planetary target we score every land cell with the target's default weights, then compare "
        "the **known analog sites** used for that body against **1000 random land cells**. A site's score is "
        "the best cell within ±2 cells (~±20 km) of its published coordinates; random cells use the same rule. "
        "ROC-AUC = probability that a known analog outranks a random land cell (0.5 = chance, 1.0 = perfect).", "",
    ]
    if synthetic:
        lines += [f"> ⚠️ **{len(synthetic)} feature(s) were SYNTHETIC in this run** ({', '.join(synthetic)}). "
                  "These numbers are only a smoke test of the method until the real pipeline run replaces them.", ""]
    lines += ["| Target | ROC-AUC | Median analog percentile | Random median score |", "|---|---|---|---|"]
    for r in results:
        lines.append(f"| {r['name']} | {r['auc']:.3f} | {r['median_analog_percentile']:.1f} | {r['random_median_score']:.3f} |")
    for r in results:
        lines += ["", f"## {r['name']}", "", "| Known analog | Score | Earth percentile | Rank |", "|---|---|---|---|"]
        for a in r["analogs"]:
            rank = f"{a['rank']:,}" if a["rank"] is not None else "–"
            lines.append(f"| {a['name']} | {a['score']:.3f} | {a['percentile']:.1f} | {rank} |")
    lines.append("")
    return "\n".join(lines)


def _nanmedian(v) -> float:
    a = np.asarray(v, dtype=float)
    a = a[np.isfinite(a)]
    return round(float(np.median(a)), 1) if a.size else float("nan")
