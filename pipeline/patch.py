"""Patch published data: recompute only some features, keep everything else as published.

    python -m pipeline patch --features basalt          # e.g. the basalt hot-fix
    python -m pipeline publish

Reads the current published files (web/public/data/ by default), recomputes the named features from their
source chain (exactly as `run` would), re-normalises those columns, rebuilds targets.json,
known_analogs.json, validation.json and pipeline/report.md, and writes a complete output set to
pipeline/output/data/ for `publish`. Nothing else needs to be cached, so it works on a fresh machine.

Exactness: patched columns, their breakpoints and their target percentiles are exact. Untouched columns are
copied byte for byte. A target value that changed in targets.py for an UNTOUCHED feature is mapped through
an approximate CDF rebuilt from the uint8 percentiles (error <= ~1/255); `patch` prints a warning when this
happens. A full `python -m pipeline run` is always exact.
"""
from __future__ import annotations

import gzip
import json
import logging
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np

from . import sources
from .analogs import build_known_analogs
from .config import CACHE_DIR, FEATURE_IDS, FEATURES, OUTPUT_DIR, PIPELINE_DIR, WEB_DATA_DIR, RunOptions
from .grid import Grid
from .normalize import EarthCDF, quantize, write_binary, write_json
from .targets import build_targets
from .validate import validate

log = logging.getLogger("pipeline.patch")


class QuantCDF:
    """Approximate Earth CDF of an untouched feature, rebuilt from its uint8 percentiles and breakpoints."""

    def __init__(self, qcol: np.ndarray, breakpoints: list[float], vmin: float, vmax: float):
        self.q = qcol
        self.bp = np.asarray(breakpoints, dtype=np.float64)
        self.min, self.max = float(vmin), float(vmax)

    def clamp_cdf(self, x: float) -> float:
        x = float(np.clip(x, self.min, self.max))
        bp, n = self.bp, self.bp.size - 1
        if x <= self.min:
            return float((self.q == self.q.min()).mean() / 2)
        if x >= self.max:
            return float(1 - (self.q == self.q.max()).mean() / 2)
        eq = np.flatnonzero(bp == x)
        if eq.size > 1:  # plateau of tied values: mid-rank
            return float((eq[0] + eq[-1]) / 2 / n)
        k = int(np.searchsorted(bp, x, side="right") - 1)
        k = min(max(k, 0), n - 1)
        frac = (x - bp[k]) / (bp[k + 1] - bp[k]) if bp[k + 1] > bp[k] else 0.0
        return float((k + frac) / n)


def load_published(d: Path) -> dict:
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    n, nf = meta["n_cells"], meta["n_features"]
    q = np.frombuffer(gzip.decompress((d / "features.bin.gz").read_bytes()), np.uint8).reshape(n, nf).copy()
    cells = np.frombuffer(gzip.decompress((d / "cells.bin.gz").read_bytes()), "<u4").copy()
    targets = json.loads((d / "targets.json").read_text(encoding="utf-8"))
    return {"meta": meta, "q": q, "cells": cells, "targets": targets, "dir": d}


def _raw_from_q(meta_f: dict, qcol: np.ndarray) -> np.ndarray:
    return np.interp(qcol / 255.0 * 100.0, np.arange(len(meta_f["breakpoints"])), meta_f["breakpoints"])


def patch(feature_ids: list[str], src_dir: Path = WEB_DATA_DIR, force: bool = False, offline: bool = False) -> dict:
    from .run import compute_feature, compute_order
    from .sources import naturalearth, terrain
    from .util import earthdata_token

    bad = [f for f in feature_ids if f not in FEATURE_IDS]
    if bad:
        raise SystemExit(f"unknown feature(s): {', '.join(bad)}. Known: {', '.join(FEATURE_IDS)}")
    pub = load_published(src_dir)
    meta, q, cells = pub["meta"], pub["q"], pub["cells"]
    if meta.get("bbox"):
        raise SystemExit("published data is a bbox run; patch needs global data")
    grid = Grid(meta["grid"]["res"])
    terrain.set_zoom(meta.get("terrain_zoom", 7))
    land = naturalearth.land_fraction(grid, CACHE_DIR) >= 0.5
    land_idx = np.flatnonzero(land.ravel()).astype(np.uint32)
    if not np.array_equal(land_idx, cells):
        raise SystemExit("land mask differs from the published cells.bin; run the full pipeline instead")
    mf = {f["id"]: f for f in meta["features"]}

    # Context for gap policies / synthetic: elevation and ice rebuilt from the published percentiles.
    ctx: dict = {"land": land}
    for fid in ("elevation", "ice"):
        if fid not in feature_ids:
            g = np.full(grid.size, np.nan, dtype=np.float32)
            g[cells] = _raw_from_q(mf[fid], q[:, FEATURE_IDS.index(fid)])
            ctx[fid] = g.reshape(grid.shape)

    opts = RunOptions(res=grid.res, force=force, offline=offline)
    token = earthdata_token()
    cdfs: dict = {}
    for f in compute_order():
        if f.id not in feature_ids:
            continue
        arr, info = compute_feature(f.id, f.sources, grid, land, ctx, opts, token)
        if f.id in ("elevation", "ice"):
            ctx[f.id] = arr
        vals = arr.ravel()[cells].astype(np.float64)
        cdf = EarthCDF(vals)
        cdfs[f.id] = cdf
        j = FEATURE_IDS.index(f.id)
        q[:, j] = quantize(cdf(vals))
        desc, url = sources.DESCRIPTIONS.get(info["source"], (info["source"], ""))
        mf[f.id].update({
            "unit": info.get("unit", f.unit), "source": info["source"], "source_name": desc, "source_url": url,
            "synthetic": info["source"] == "synthetic", "proxy": info["source"] in ("gibs_lights",),
            "coverage": info.get("coverage"), "notes": (info.get("gap_fill") or {}).get("note"),
            "min": round(cdf.min, 4), "max": round(cdf.max, 4), "breakpoints": cdf.breakpoints(),
        })
        log.info("patched %-10s <- %s", f.id, info["source"])

    for f in FEATURES:
        if f.id not in cdfs:
            m = mf[f.id]
            cdfs[f.id] = QuantCDF(q[:, FEATURE_IDS.index(f.id)], m["breakpoints"], m["min"], m["max"])

    targets = build_targets(cdfs)
    # Untouched features whose target value did not change keep their exact published percentile.
    old = {t["id"]: t for t in pub["targets"]["targets"]}
    approx = []
    for t in targets["targets"]:
        o = old.get(t["id"])
        for j, fid in enumerate(FEATURE_IDS):
            if fid in feature_ids:
                continue
            if o and o["raw"][fid]["value"] == t["raw"][fid]["value"]:
                t["vector"][j] = o["vector"][j]
            else:
                approx.append(f"{t['id']}.{fid}")
    if approx:
        log.warning("approximate target percentile (changed target value on an untouched feature): %s",
                    ", ".join(approx))

    meta["synthetic_features"] = [f["id"] for f in meta["features"] if f["synthetic"]]
    meta["generated"] = datetime.now().isoformat(timespec="seconds")
    meta["patched"] = sorted(set(meta.get("patched", []) + feature_ids))
    if approx:
        meta["approximate_target_entries"] = approx

    out = OUTPUT_DIR / "data"
    out.mkdir(parents=True, exist_ok=True)
    write_binary(out / "features.bin", q)
    for name in ("cells.bin.gz", "countries.bin.gz"):
        if (src_dir / name).resolve() != (out / name).resolve():
            shutil.copy2(src_dir / name, out / name)
    write_json(out / "meta.json", meta)
    write_json(out / "targets.json", targets)
    analogs = build_known_analogs()
    write_json(out / "known_analogs.json", analogs)
    bps = {f["id"]: f["breakpoints"] for f in meta["features"]}
    report, md = validate(q, cells, grid, targets, analogs["analogs"], meta["synthetic_features"], bps)
    write_json(out / "validation.json", report)
    (PIPELINE_DIR / "report.md").write_text(md, encoding="utf-8")
    for r in report["results"]:
        log.info("   validation AUC %-45s %.3f", r["name"], r["auc"])
    log.info("patched output in %s  ->  next: python -m pipeline publish", out)
    return report
