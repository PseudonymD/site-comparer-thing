"""End-to-end pipeline: fetch -> regrid -> mask -> normalise -> quantise -> targets -> analogs -> validate."""
from __future__ import annotations

import inspect
import json
import logging
import time
from datetime import datetime

import numpy as np

from . import sources
from .analogs import build_known_analogs
from .config import (CACHE_DIR, FEATURES, N_FEATURES, NOVELTY_SATURATION_KM, OUTPUT_DIR, PIPELINE_DIR,
                     SCHEMA_VERSION, RunOptions)
from .grid import Grid, grid_tag
from .normalize import normalize_all, write_binary, write_json
from .sources import naturalearth, terrain
from .sources._regrid import fill_nearest
from .targets import build_targets
from .util import (earthdata_token, grid_cache_path, is_done, mark_done, read_marker, save_grid)
from .validate import validate

log = logging.getLogger("pipeline.run")

QUICK_BBOX = (-120.0, 30.0, -100.0, 45.0)  # US South-West: Death Valley, MDRS, Meteor Crater, Black Point
MIN_COVERAGE = 0.5


# Bump a source's tag when its gap policy changes so old cached finals are recomputed.
SOURCE_TAG_VERSION = {"soilgrids": "soilgrids_v2"}


def _source_tag(name: str) -> str:
    return f"terrain_z{terrain.zoom()}" if name == "terrain" else SOURCE_TAG_VERSION.get(name, name)


def compute_order() -> list:
    """FEATURES in the order they are computed: ice before soc/sand (SoilGrids' gap policy needs it)."""
    order = [f for f in FEATURES if f.id != "ice"]
    ice = next(f for f in FEATURES if f.id == "ice")
    order.insert(next(i for i, f in enumerate(order) if f.id == "soc"), ice)
    return order


_HOST_CACHE: dict[str, bool] = {}


def _host_ok(mod) -> bool:
    """Quick reachability preflight so an unreachable host costs seconds, not retry storms."""
    from .util import reachable

    url = getattr(mod, "PROBE", None) or getattr(mod, "HOST", None)
    if not url:
        return True
    if url not in _HOST_CACHE:
        ok = False
        for _ in range(2):
            ok, _msg = reachable(url, timeout=15)
            if ok:
                break
        _HOST_CACHE[url] = ok
    return _HOST_CACHE[url]


def _call_to_grid(mod, grid: Grid, fid: str, ctx: dict) -> np.ndarray:
    fn = mod.to_grid
    params = inspect.signature(fn).parameters
    accepts_any = any(p.kind == p.VAR_KEYWORD for p in params.values())
    kwargs = {k: v for k, v in ctx.items() if accepts_any or k in params}
    return fn(grid, CACHE_DIR, fid, **kwargs)


def compute_feature(fid: str, chain: tuple[str, ...], grid: Grid, land: np.ndarray, ctx: dict,
                    opts: RunOptions, token: str | None) -> tuple[np.ndarray, dict]:
    gkey = grid_tag(grid)
    attempts = []
    for name in chain:
        tag = _source_tag(name)
        marker = f"src_{gkey}_{tag}_{fid}"
        cache = grid_cache_path(f"final_{tag}", fid, gkey)
        if is_done(marker) and cache.exists() and not opts.force:
            info = read_marker(marker) or {}
            log.info("  %-11s <- %s (cached)", fid, name)
            return np.load(cache), {**info, "source": name, "cached": True, "attempts": attempts}
        mod = sources.get(name)
        cached_ok = getattr(mod, "is_cached", lambda g: False)(grid)
        if name != "synthetic" and opts.offline and not cached_ok:
            attempts.append({"source": name, "skipped": "offline"})
            continue
        if getattr(mod, "REQUIRES_TOKEN", False) and not token:
            attempts.append({"source": name, "skipped": "no EARTHDATA_TOKEN"})
            continue
        if name != "synthetic" and not cached_ok and not _host_ok(mod):
            log.warning("  %-11s source %s skipped: host unreachable (%s)", fid, name, getattr(mod, "HOST", "?"))
            attempts.append({"source": name, "skipped": "host unreachable"})
            continue
        t0 = time.time()
        try:
            arr = _call_to_grid(mod, grid, fid, ctx).astype(np.float32)
        except Exception as e:  # any failure -> try the next source in the chain
            log.warning("  %-11s source %s failed (%s); trying fallback", fid, name, type(e).__name__)
            log.debug("traceback", exc_info=True)
            attempts.append({"source": name, "error_type": type(e).__name__})
            continue
        cov = float(np.isfinite(arr[land]).mean()) if land.any() else 0.0
        if cov < MIN_COVERAGE:
            log.warning("  %-11s source %s covers only %.0f%% of land - skipping", fid, name, cov * 100)
            attempts.append({"source": name, "error_type": "insufficient_coverage", "coverage": round(cov, 4)})
            continue
        gap_info = None
        if hasattr(mod, "fill_gaps"):
            arr, gap_info = mod.fill_gaps(arr, land, fid, grid, ctx.get("ice"))
        else:
            arr = fill_nearest(arr, land)
        info = {"coverage": round(cov, 4), "filled_pct": round((1 - cov) * 100, 2), "seconds": round(time.time() - t0, 1)}
        if gap_info:
            info["gap_fill"] = gap_info
        unit = getattr(mod, "UNIT", None)
        if unit:
            info["unit"] = unit
        save_grid(cache, arr)
        mark_done(marker, info)
        log.info("  %-11s <- %s (coverage %.1f%%)", fid, name, cov * 100)
        return arr, {**info, "source": name, "attempts": attempts}
    raise RuntimeError(f"no source produced {fid}")  # unreachable: synthetic never fails


def run(opts: RunOptions) -> dict:
    t_start = time.time()
    if opts.quick:
        opts.res = max(opts.res, 0.5)
        opts.terrain_zoom = min(opts.terrain_zoom, 4)
        opts.bbox = opts.bbox or QUICK_BBOX
    grid = Grid(opts.res, opts.bbox)
    terrain.set_zoom(opts.terrain_zoom)
    token = earthdata_token()
    log.info("=== Terrestrial Analog Finder pipeline ===")
    log.info("grid %.2f° (%d x %d)%s, terrain zoom %d, Earthdata token: %s%s",
             grid.res, grid.n_lon, grid.n_lat, f", bbox {grid.bbox}" if grid.bbox else "",
             opts.terrain_zoom, "yes" if token else "no (using no-auth fallbacks)",
             ", OFFLINE" if opts.offline else "")

    # ---- 1-3. fetch, regrid, mask -------------------------------------------------------------
    land = (naturalearth.land_fraction(grid, CACHE_DIR) >= 0.5) & grid.bbox_mask()
    land_idx = np.flatnonzero(land.ravel()).astype(np.uint32)
    log.info("land cells: %s", f"{land_idx.size:,}")
    raw: dict[str, np.ndarray] = {}
    used: dict[str, dict] = {}
    ctx: dict = {"land": land}
    for f in compute_order():
        if not opts.wants(f.id):
            prev = _previous_final(f.id, grid)
            if prev is not None:
                raw[f.id], used[f.id] = prev
                log.info("  %-11s <- %s (from earlier run; not in --only)", f.id, used[f.id]["source"])
                continue
            # Computed before by a real source whose cache tag has since changed (e.g. a new gap policy):
            # recompute from that source's raw cache instead of falling back to synthetic.
            chain = f.sources if _previous_source(f.id, grid) not in (None, "synthetic") else ("synthetic",)
        else:
            chain = f.sources
        if f.id not in ("elevation",) and "elevation" in raw:
            ctx["elevation"] = raw["elevation"]
        if f.id != "ice" and "ice" in raw:
            ctx["ice"] = raw["ice"]
        arr, info = compute_feature(f.id, chain, grid, land, ctx, opts, token)
        raw[f.id] = arr
        used[f.id] = info
    _remember_final(used, grid)

    # ---- 4-5. normalise, quantise, export ------------------------------------------------------
    log.info("normalising %d features over %s land cells", N_FEATURES, f"{land_idx.size:,}")
    q, cdfs = normalize_all(raw, land_idx)
    out = OUTPUT_DIR / "data"
    files = []
    files += write_binary(out / "features.bin", q)
    files += write_binary(out / "cells.bin", land_idx.astype("<u4"))
    country_idx, countries = naturalearth.country_index(grid, CACHE_DIR)
    files += write_binary(out / "countries.bin", country_idx.ravel()[land_idx].astype(np.uint8))
    synthetic = [fid for fid, u in used.items() if u["source"] == "synthetic"]
    proxy = [fid for fid, u in used.items() if u["source"] in ("gibs_lights",)]
    meta = {
        "schema_version": SCHEMA_VERSION,
        "generated": datetime.now().isoformat(timespec="seconds"),
        "grid": {"res": grid.res, "n_lon": grid.n_lon, "n_lat": grid.n_lat, "origin": [-180.0, 90.0],
                 "index": "row * n_lon + col, row 0 = north"},
        "bbox": list(grid.bbox) if grid.bbox else None,
        "normalisation_domain": "earth_land" if grid.bbox is None else "bbox_land",
        "n_cells": int(land_idx.size),
        "n_features": N_FEATURES,
        "terrain_zoom": opts.terrain_zoom,
        "novelty_saturation_km": NOVELTY_SATURATION_KM,
        "files": {"features": "features.bin.gz", "cells": "cells.bin.gz", "countries": "countries.bin.gz"},
        "synthetic_features": synthetic,
        "features": [],
        "countries": countries,
    }
    for f in FEATURES:
        u = used[f.id]
        cdf = cdfs[f.id]
        desc, url = sources.DESCRIPTIONS.get(u["source"], (u["source"], ""))
        source_meta = sources.SOURCE_METADATA.get(u["source"], {})
        meta["features"].append({
            "id": f.id, "name": f.name, "unit": u.get("unit", f.unit), "group": f.group, "ui_group": f.ui_group,
            "description": f.description, "log_display": f.log_display,
            "source": u["source"], "source_name": desc, "source_url": url,
            "synthetic": u["source"] == "synthetic", "proxy": f.id in proxy,
            "fallback": u["source"] != f.sources[0], "attempts": u.get("attempts", []),
            "coverage": u.get("coverage"), "notes": (u.get("gap_fill") or {                "resolution": source_meta.get("resolution"),
                "temporal_coverage": source_meta.get("temporal_coverage"),
                "data_quality": source_meta.get("data_quality"),
                "uncertainty": source_meta.get("uncertainty"),
                "measurement_class": source_meta.get("measurement_class"),
            "coverage": u.get("coverage"), "notes": (u.get("gap_fill") or {}).get("note"), "min": round(cdf.min, 4), "max": round(cdf.max, 4),
            "breakpoints": cdf.breakpoints(),
        })
    files.append(write_json(out / "meta.json", meta))

    # ---- 6-7. targets & known analogs ----------------------------------------------------------
    targets = build_targets(cdfs)
    files.append(write_json(out / "targets.json", targets))
    analogs = build_known_analogs()
    files.append(write_json(out / "known_analogs.json", analogs))

    # ---- 8. validation ------------------------------------------------------------------------
    bps = {f["id"]: f["breakpoints"] for f in meta["features"]}
    report, md = validate(q, land_idx, grid, targets, analogs["analogs"], synthetic, bps)
    files.append(write_json(out / "validation.json", report))
    (PIPELINE_DIR / "report.md").write_text(md, encoding="utf-8")

    summary = {
        "seconds": round(time.time() - t_start, 1),
        "n_cells": int(land_idx.size),
        "sources": {fid: u["source"] for fid, u in used.items()},
        "synthetic": synthetic,
        "proxy": proxy,
        "validation": [(r["name"], r["auc"]) for r in report["results"]],
        "output": str(out),
    }
    (OUTPUT_DIR / "run_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    mark_done(f"run_{grid_tag(grid)}", {"summary": summary})
    _print_summary(summary, used)
    return summary


def _remember_final(used: dict, grid: Grid) -> None:
    p = CACHE_DIR / "grids" / grid_tag(grid) / "final_sources.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "attempts"} for k, v in used.items()},
                            indent=1), encoding="utf-8")


def _previous_source(fid: str, grid: Grid) -> str | None:
    p = CACHE_DIR / "grids" / grid_tag(grid) / "final_sources.json"
    if not p.exists():
        return None
    return (json.loads(p.read_text(encoding="utf-8")).get(fid) or {}).get("source")


def _previous_final(fid: str, grid: Grid):
    p = CACHE_DIR / "grids" / grid_tag(grid) / "final_sources.json"
    if not p.exists():
        return None
    info = json.loads(p.read_text(encoding="utf-8")).get(fid)
    if not info:
        return None
    cache = grid_cache_path(f"final_{_source_tag(info['source'])}", fid, grid_tag(grid))
    if not cache.exists():
        return None
    return np.load(cache), info


def _print_summary(summary: dict, used: dict) -> None:
    log.info("")
    log.info("=== Summary (%.0f s) ===", summary["seconds"])
    real, fallback, synth = [], [], []
    for f in FEATURES:
        src = used[f.id]["source"]
        if src == "synthetic":
            synth.append(f.id)
        elif src == f.sources[0]:
            real.append(f"{f.id} ({src})")
        else:
            fallback.append(f"{f.id} ({src})")
    log.info("✅ preferred source : %s", ", ".join(real) or "–")
    log.info("↪️  fallback source  : %s", ", ".join(fallback) or "–")
    log.info("⚠️  SYNTHETIC        : %s", ", ".join(synth) or "none")
    for name, a in summary["validation"]:
        log.info("   validation AUC %-45s %.3f", name, a)
    log.info("outputs in %s  ->  next: python -m pipeline publish", summary["output"])
