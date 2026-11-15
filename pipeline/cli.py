"""Command line: python -m pipeline {doctor,run,status,publish,assets}"""
from __future__ import annotations

import argparse
import gzip
import json
import platform
import shutil
import sys
from pathlib import Path

from .config import CACHE_DIR, FEATURES, OUTPUT_DIR, PIPELINE_DIR, REPO_DIR, WEB_DATA_DIR, RunOptions

OK, WARN, BAD = "✅", "⚠️ ", "❌"


def _p(s=""):
    try:
        print(s)
    except UnicodeEncodeError:  # old Windows consoles
        print(s.encode("ascii", "replace").decode())


# --------------------------------------------------------------------------- doctor
def cmd_doctor(args) -> int:
    from . import sources
    from .util import earthdata_token, free_disk_gb, reachable, total_ram_gb

    rows = []
    v = sys.version_info
    rows.append((OK if v >= (3, 10) else BAD, "Python", f"{platform.python_version()} ({sys.executable})"))
    disk = free_disk_gb(CACHE_DIR)
    rows.append((OK if disk > 30 else WARN if disk > 8 else BAD, "Free disk (cache)", f"{disk:.0f} GB (need ~10 GB no-token, ~25 GB with token)"))
    ram = total_ram_gb()
    rows.append((OK if (ram or 16) >= 8 else WARN, "RAM", f"{ram:.1f} GB" if ram else "unknown"))
    for mod, why, required in (("numpy", "core", True), ("scipy", "core", True), ("rasterio", "rasters", True),
                               ("PIL", "PNG decode", True), ("requests", "downloads", True), ("tqdm", "progress", True),
                               ("geopandas", "GLiM polygons", False), ("h5py", "Black Marble / MERRA-2", False),
                               ("pyhdf", "MODIS HDF4 (optional)", False)):
        try:
            __import__(mod)
            rows.append((OK, f"package {mod}", why))
        except Exception:
            rows.append((BAD if required else WARN, f"package {mod}", f"missing ({why})"))
    tok = earthdata_token()
    rows.append((OK if tok else WARN, "EARTHDATA_TOKEN", "set" if tok else "not set -> no-auth fallbacks (fine for a first run)"))
    hosts, probes = {}, {}
    for name in sources.SOURCE_MODULES:
        if name == "synthetic":
            continue
        try:
            m = sources.get(name)
        except Exception as e:
            rows.append((WARN, f"source {name}", f"import failed: {e}"))
            continue
        h = getattr(m, "HOST", None)
        if h:
            hosts.setdefault(h, []).append(name)
            probes.setdefault(h, getattr(m, "PROBE", h))
    hosts.setdefault("https://cmr.earthdata.nasa.gov", []).append("earthdata search")
    hosts.setdefault("https://urs.earthdata.nasa.gov", []).append("earthdata login")
    for h, names in hosts.items():
        ok, msg = reachable(probes.get(h, h))
        rows.append((OK if ok else WARN, h.replace("https://", ""), f"{msg}  [{', '.join(names)}]"))
    w = max(len(r[1]) for r in rows)
    _p("\nTerrestrial Analog Finder - environment check\n")
    for icon, k, val in rows:
        _p(f" {icon} {k.ljust(w)}  {val}")
    _p("\nEstimated full run (0.1° global, terrain zoom 7):")
    _p("  without token : ~1.5 GB download, ~1-3 h  (terrain, NASA POWER, GIBS, SoilGrids, GLiM, Natural Earth)")
    _p("  with token    : ~10-12 GB download, ~3-6 h (adds MODIS LST/NDVI/land cover, Black Marble, MERRA-2)")
    _p("  Unreachable hosts are not fatal: those features fall back automatically (worst case: flagged synthetic).")
    _p("\nNext: python -m pipeline run --quick   (a few minutes, small region)\n")
    return 0 if all(r[0] != BAD for r in rows) else 1


# --------------------------------------------------------------------------- run
def _parse_bbox(s: str | None):
    if not s:
        return None
    vals = [float(x) for x in s.split(",")]
    if len(vals) != 4 or vals[0] >= vals[2] or vals[1] >= vals[3]:
        raise SystemExit("--bbox must be minlon,minlat,maxlon,maxlat")
    return tuple(vals)


def cmd_run(args) -> int:
    from .run import run
    from .util import setup_logging

    log_path = setup_logging(args.verbose)
    opts = RunOptions(res=args.res, bbox=_parse_bbox(args.bbox),
                      only_groups=[g.strip() for g in args.only.split(",")] if args.only else None,
                      quick=args.quick, terrain_zoom=args.terrain_zoom, force=args.force, offline=args.offline)
    try:
        run(opts)
    except KeyboardInterrupt:
        _p("\nInterrupted - rerun the same command to resume (finished work is cached).")
        return 130
    _p(f"log: {log_path}")
    return 0


# --------------------------------------------------------------------------- status
def cmd_status(args) -> int:
    from .util import read_marker

    _p("\nPipeline status\n")
    gdir = CACHE_DIR / "grids"
    found = False
    if gdir.exists():
        for d in sorted(gdir.iterdir()):
            fs = d / "final_sources.json"
            if not fs.exists():
                continue
            found = True
            info = json.loads(fs.read_text(encoding="utf-8"))
            run = read_marker(f"run_{d.name}")
            _p(f"grid {d.name}: {'run complete ' + run.get('time', '') if run else 'run incomplete'}")
            for f in FEATURES:
                u = info.get(f.id)
                if not u:
                    _p(f"   ·  {f.id:<11} not done")
                    continue
                icon = WARN if u["source"] == "synthetic" else OK if u["source"] == f.sources[0] else "↪️ "
                _p(f"   {icon} {f.id:<11} {u['source']}")
    if not found:
        _p("nothing computed yet - run `python -m pipeline run --quick`")
    size = sum(p.stat().st_size for p in CACHE_DIR.rglob("*") if p.is_file()) / 1e9 if CACHE_DIR.exists() else 0
    _p(f"\ncache: {CACHE_DIR} ({size:.2f} GB)")
    out = OUTPUT_DIR / "data" / "meta.json"
    if out.exists():
        m = json.loads(out.read_text(encoding="utf-8"))
        _p(f"latest output: {m['generated']}, {m['n_cells']:,} cells, synthetic: {m['synthetic_features'] or 'none'}")
    return 0


# --------------------------------------------------------------------------- publish
PUBLISH_FILES = ["features.bin.gz", "cells.bin.gz", "countries.bin.gz", "meta.json", "targets.json",
                 "known_analogs.json", "validation.json"]
MAX_MB = 49.0


def validate_outputs(d: Path) -> list[str]:
    errs = []
    for name in PUBLISH_FILES:
        p = d / name
        if not p.exists():
            errs.append(f"missing {name}")
        elif p.stat().st_size / 1e6 > MAX_MB:
            errs.append(f"{name} is {p.stat().st_size / 1e6:.1f} MB (> {MAX_MB} MB GitHub limit) - use the release-data workflow")
    if errs:
        return errs
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    n = meta["n_cells"]
    feats = gzip.decompress((d / "features.bin.gz").read_bytes())
    cells = gzip.decompress((d / "cells.bin.gz").read_bytes())
    ctry = gzip.decompress((d / "countries.bin.gz").read_bytes())
    if len(feats) != n * meta["n_features"]:
        errs.append(f"features.bin has {len(feats)} bytes, expected {n} x {meta['n_features']}")
    if len(cells) != n * 4:
        errs.append(f"cells.bin has {len(cells)} bytes, expected {n} x 4")
    if len(ctry) != n:
        errs.append(f"countries.bin has {len(ctry)} bytes, expected {n}")
    if len(meta["features"]) != meta["n_features"]:
        errs.append("meta.features length mismatch")
    t = json.loads((d / "targets.json").read_text(encoding="utf-8"))
    for tg in t["targets"]:
        if len(tg["vector"]) != meta["n_features"] or len(tg["weights"]) != meta["n_features"]:
            errs.append(f"target {tg['id']} has wrong vector length")
    return errs


def cmd_publish(args) -> int:
    src = OUTPUT_DIR / "data"
    errs = validate_outputs(src)
    if errs:
        for e in errs:
            _p(f"{BAD} {e}")
        _p("Nothing copied. Run `python -m pipeline run` first.")
        return 1
    meta = json.loads((src / "meta.json").read_text(encoding="utf-8"))
    if meta.get("bbox") and not args.allow_bbox:
        _p(f"{WARN} this output covers only bbox {meta['bbox']} (a --quick/--bbox run). "
           "Re-run without --bbox, or pass --allow-bbox to publish it anyway.")
        return 1
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name in PUBLISH_FILES:
        shutil.copy2(src / name, WEB_DATA_DIR / name)
        _p(f"{OK} {name:<20} {(src / name).stat().st_size / 1e6:7.2f} MB")
    from .discoveries import generate

    disc, _ = generate()
    _p(f"{OK} discoveries.json ({len(disc['discoveries'])} sites) and spotlight.json regenerated from the new data")
    report = PIPELINE_DIR / "report.md"
    if meta["synthetic_features"]:
        _p(f"\n{WARN} synthetic features in this output: {', '.join(meta['synthetic_features'])}")
    _p("\nCopied to web/public/data/. Now commit and push (run from the repository root):\n")
    _p("  git add web/public/data pipeline/report.md")  # includes discoveries.json / spotlight.json
    _p(f'  git commit -m "data: pipeline run {meta["generated"][:10]} ({meta["n_cells"]:,} cells)"')
    _p("  git push\n")
    _ = report
    return 0


def cmd_patch(args) -> int:
    from .patch import patch
    from .util import setup_logging

    log_path = setup_logging(args.verbose)
    feats = [f.strip() for f in args.features.split(",") if f.strip()]
    patch(feats, Path(args.src) if args.src else WEB_DATA_DIR, force=args.force, offline=args.offline)
    _p(f"log: {log_path}")
    _p("Next: python -m pipeline publish")
    return 0


def cmd_discoveries(args) -> int:
    from .discoveries import generate

    disc, spot = generate()
    for d in disc["discoveries"]:
        _p(f"  {d['target']:<20} {d['name'][:34]:<34} {d['lat']:8.2f} {d['lon']:8.2f}  p{d['percentile']:.2f}  {d['novelty_km']:>5} km")
    _p(f"{OK} wrote web/public/data/discoveries.json ({len(disc['discoveries'])}) and spotlight.json")
    return 0


def cmd_assets(args) -> int:
    from .sources.naturalearth import build_assets
    from .util import setup_logging

    setup_logging(args.verbose)
    build_assets(CACHE_DIR)
    return 0


def main(argv=None) -> int:
    from .util import load_dotenv

    load_dotenv()
    ap = argparse.ArgumentParser(prog="python -m pipeline", description="Terrestrial Analog Finder data pipeline")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor", help="check Python, disk, RAM, network and token")
    r = sub.add_parser("run", help="run the pipeline (resumable)")
    r.add_argument("--res", type=float, default=0.1, help="grid resolution in degrees (default 0.1)")
    r.add_argument("--only", help="comma list of groups (terrain,climate,surface,remoteness) and/or feature ids (e.g. basalt) to (re)compute; everything else is reused from the cache")
    r.add_argument("--bbox", help="minlon,minlat,maxlon,maxlat (process a region only)")
    r.add_argument("--quick", action="store_true", help="tiny smoke test: 0.5°, terrain zoom 4, US South-West")
    r.add_argument("--terrain-zoom", type=int, default=7, help="Terrarium zoom for terrain (default 7)")
    r.add_argument("--force", action="store_true", help="recompute features even if cached")
    r.add_argument("--offline", action="store_true", help="no network: use cached results, else synthetic")
    r.add_argument("-v", "--verbose", action="store_true")
    sub.add_parser("status", help="show what is done")
    p = sub.add_parser("publish", help="copy outputs into web/public/data and print git commands")
    p.add_argument("--allow-bbox", action="store_true", help="publish a regional (--bbox/--quick) output")
    pa = sub.add_parser("patch", help="recompute only some features on top of the published data (e.g. --features basalt)")
    pa.add_argument("--features", required=True, help="comma list of feature ids, e.g. basalt or soc,sand")
    pa.add_argument("--src", help="directory with the data to patch (default web/public/data)")
    pa.add_argument("--force", action="store_true", help="ignore cached results for these features")
    pa.add_argument("--offline", action="store_true", help="no network: cached results only")
    pa.add_argument("-v", "--verbose", action="store_true")
    sub.add_parser("discoveries", help="pick headline discoveries + southern Africa spotlight from published data")
    a = sub.add_parser("assets", help="(developers) rebuild committed land-mask/country assets")
    a.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    return {"doctor": cmd_doctor, "run": cmd_run, "status": cmd_status, "publish": cmd_publish,
            "patch": cmd_patch, "discoveries": cmd_discoveries, "assets": cmd_assets}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
