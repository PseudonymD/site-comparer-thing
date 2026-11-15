"""Discoveries and the southern Africa spotlight, generated from the published data (reproducible).

    python -m pipeline discoveries          # writes web/public/data/discoveries.json and spotlight.json

Selection rule for discoveries (also written into the JSON):
  * every target is scored with its DEFAULT weights and DEFAULT filters (docs/scoring.md);
  * novelty is on: blended B = (1 - ALPHA) S + ALPHA N with ALPHA = 0.3;
  * cells are merged into sites like the web worker (best ~6000 cells by B, 8-neighbour union-find);
  * a site qualifies if its analog score S is in Earth's top 1% (percentile >= 99) for that target and it lies
    >= MIN_NOVELTY_KM from every known analog;
  * sites are taken in order of B, at most PER_TARGET per target, skipping any within MIN_SEPARATION_KM of a
    discovery already chosen (for any target), until MAX_TOTAL are chosen (round-robin over targets).
Names come from a small hand-made gazetteer (pipeline/assets/places.json: region name + bbox). A site that no
entry contains is named after its country. The characterisation (best/worst factors in real units, uses,
caveats) is generated from the data by rules in this file.
"""
from __future__ import annotations

import gzip
import json
import logging
from datetime import datetime
from pathlib import Path

import numpy as np

from .config import ASSETS_DIR, FEATURE_IDS, WEB_DATA_DIR
from .grid import haversine_km
from .scoring import blend, score, z_threshold_from_value

log = logging.getLogger("pipeline.discoveries")

ALPHA = 0.3
MIN_PERCENTILE = 99.0
MIN_NOVELTY_KM = 500.0
MIN_SEPARATION_KM = 300.0
PER_TARGET = 2
MAX_TOTAL = 10
N_CANDIDATE_CELLS = 6000

SOUTHERN_AFRICA_BBOX = (11.0, -35.5, 33.0, -16.5)  # minlon, minlat, maxlon, maxlat
SPOTLIGHT_RADIUS_CELLS = 5  # local places: best cell within ±5 cells (~±50 km); regions are big and coords approximate
LOCAL_PLACES = [
    {"id": "tankwa", "name": "Tankwa Karoo", "lat": -32.25, "lon": 20.0,
     "why": "Hyper-arid succulent Karoo basin; often called South Africa's most Mars-like landscape."},
    {"id": "richtersveld", "name": "Richtersveld", "lat": -28.15, "lon": 17.05,
     "why": "Rugged, mountainous desert on the Orange River with sparse rainfall and fog."},
    {"id": "namib", "name": "Central Namib (Gobabeb)", "lat": -23.56, "lon": 15.04,
     "why": "One of the oldest deserts, with gravel plains and dune seas; a studied Mars dune and microbial analog."},
    {"id": "kalahari", "name": "Central Kalahari", "lat": -22.0, "lon": 23.5,
     "why": "Semi-arid sand basin; large, flat and remote."},
    {"id": "vredefort", "name": "Vredefort impact structure", "lat": -27.0, "lon": 27.5,
     "why": "The largest verified impact structure on Earth (~2 Ga); an impact-geology analog, now deeply eroded."},
    {"id": "karoo_dolerite", "name": "Karoo dolerites (Valley of Desolation)", "lat": -32.27, "lon": 24.5,
     "why": "Jurassic dolerite sills and columns, mafic igneous rock like lunar and Martian basalt."},
]

USES = {
    "moon_south_pole": "Rugged, cold, dark terrain for rover traversal, navigation in low light, and thermal and cold-trap studies.",
    "moon_mare_lava_tube": "Flat volcanic plains for landing and rover tests; look for lava tubes and caves for habitat and shielding studies.",
    "mars_jezero": "Dry, barren ground for rover and drill testing, sampling operations and life-detection instrument trials.",
    "mars_gale": "Dry, layered terrain for rover driving, drilling and remote-science operations.",
    "mars_arcadia": "Cold, dry, flat ground for testing ground-ice prospecting, drilling and landing-site operations.",
    "mars_north_polar": "Cold, icy terrain for ice drilling, thermal studies and crew operations in extreme cold.",
}


def _load(d: Path):
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    targets = json.loads((d / "targets.json").read_text(encoding="utf-8"))
    analogs = json.loads((d / "known_analogs.json").read_text(encoding="utf-8"))["analogs"]
    n, nf = meta["n_cells"], meta["n_features"]
    q = np.frombuffer(gzip.decompress((d / "features.bin.gz").read_bytes()), np.uint8).reshape(n, nf)
    cells = np.frombuffer(gzip.decompress((d / "cells.bin.gz").read_bytes()), "<u4").astype(np.int64)
    ctry = np.frombuffer(gzip.decompress((d / "countries.bin.gz").read_bytes()), np.uint8)
    return meta, targets, analogs, q, cells, ctry


def _filters(t, bps):
    return [(FEATURE_IDS.index(f["feature"]), z_threshold_from_value(bps[f["feature"]], f["max"]))
            for f in t.get("default_filters", [])]


def _value(bp, z):
    return float(np.interp(z * 100.0, np.arange(len(bp)), bp))


def _sites(b: np.ndarray, cells: np.ndarray, n_lon: int, n_lat: int) -> list[int]:
    """Best ~6000 cells by b merged into 8-neighbour sites; returns each site's best cell (land index), by b."""
    k = min(N_CANDIDATE_CELLS, int((b > 0).sum()))
    top = np.argpartition(-b, k - 1)[:k]
    top = top[np.argsort(-b[top])]
    pos = {int(cells[i]): j for j, i in enumerate(top)}
    parent = list(range(len(top)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for j, i in enumerate(top):
        r, c = divmod(int(cells[i]), n_lon)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                rr = r + dr
                if (dr or dc) and 0 <= rr < n_lat:
                    o = pos.get(rr * n_lon + (c + dc) % n_lon)
                    if o is not None:
                        a, bb = find(j), find(o)
                        if a != bb:
                            parent[max(a, bb)] = min(a, bb)  # root = best-ranked member
    seen, reps = set(), []
    for j in range(len(top)):
        root = find(j)
        if root not in seen:
            seen.add(root)
            reps.append(int(top[root]))
    return reps


def _latlon(cell: int, meta) -> tuple[float, float]:
    res, n_lon = meta["grid"]["res"], meta["grid"]["n_lon"]
    r, c = divmod(int(cell), n_lon)
    return round(90 - (r + 0.5) * res, 3), round(-180 + (c + 0.5) * res, 3)


def _place(lat, lon, places, country) -> tuple[str, str | None]:
    for p in places:
        minlon, minlat, maxlon, maxlat = p["bbox"]
        if minlon <= lon <= maxlon and minlat <= lat <= maxlat:
            return p["name"], p.get("literature")
    return (f"{country} site" if country else "Unnamed site"), None


def characterise(qrow, t, meta, feats_meta) -> dict:
    tv, w = np.asarray(t["vector"]), np.asarray(t["weights"])
    z = qrow / 255.0
    c = w * (z - tv) ** 2 / w.sum()
    used = [j for j in range(len(FEATURE_IDS)) if w[j] > 0]
    order = sorted(used, key=lambda j: c[j])
    def row(j):
        fm = feats_meta[j]
        return {"feature": fm["id"], "name": fm["name"], "unit": fm["unit"],
                "site": round(_value(fm["breakpoints"], z[j]), 3), "target": round(_value(fm["breakpoints"], tv[j]), 3),
                "target_raw": t["raw"][fm["id"]]["value"], "beyond_earth": t["raw"][fm["id"]]["beyond_earth"],
                "share_of_gap": round(float(c[j] / c.sum()), 3) if c.sum() > 0 else 0.0,
                "synthetic": fm["synthetic"], "proxy": fm["proxy"]}
    return {"best": [row(j) for j in order[:3]], "worst": [row(j) for j in order[::-1][:2]]}


def caveats(lat, best, worst, feats_meta, t) -> list[str]:
    out = []
    shown = {r["feature"] for r in best + worst}
    for fm in feats_meta:
        if fm["synthetic"] and t["weights"][FEATURE_IDS.index(fm["id"])] > 0:
            out.append(f"{fm['name']} is a placeholder layer in this build, so its part of the score is not real data.")
        elif fm["proxy"] and fm["id"] in shown:
            out.append(f"{fm['name']} uses a proxy ({fm['source_name']}).")
    if lat < -60 or lat > 75:
        out.append("Polar cell: soil values follow a stated rule (no soil on ice), not measurements; access is seasonal and logistically hard.")
    if any(r["beyond_earth"] for r in worst):
        out.append("Its largest gap is a property no place on Earth reaches (the target is beyond Earth's range).")
    out.append("Scored on ~11 km cells: check the 30 m drill-down and imagery before planning anything on the ground.")
    return out


def generate(src: Path = WEB_DATA_DIR, out_dir: Path = WEB_DATA_DIR) -> tuple[dict, dict]:
    meta, targets, analogs, q, cells, ctry = _load(src)
    n_lon, n_lat = meta["grid"]["n_lon"], meta["grid"]["n_lat"]
    feats = meta["features"]
    bps = {f["id"]: f["breakpoints"] for f in feats}
    places = json.loads((ASSETS_DIR / "places.json").read_text(encoding="utf-8"))["places"]
    countries = meta["countries"]
    res = meta["grid"]["res"]
    r_all, c_all = np.divmod(cells, n_lon)
    lat_all = 90 - (r_all + 0.5) * res
    lon_all = -180 + (c_all + 0.5) * res
    dist = np.full(cells.size, np.inf)
    for a in analogs:
        dist = np.minimum(dist, haversine_km(lat_all, lon_all, a["lat"], a["lon"]))

    per_target = {}
    scored = {}
    for t in targets["targets"]:
        s = score(q, np.array(t["vector"]), np.array(t["weights"]), _filters(t, bps))
        b = blend(s, dist, ALPHA)
        sorted_s = np.sort(s)
        scored[t["id"]] = (s, sorted_s)
        cands = []
        for i in _sites(b, cells, n_lon, n_lat):
            pct = float(np.searchsorted(sorted_s, s[i], side="right") / s.size * 100)
            if pct >= MIN_PERCENTILE and dist[i] >= MIN_NOVELTY_KM:
                cands.append((i, pct))
        per_target[t["id"]] = cands

    chosen, taken = [], {t["id"]: 0 for t in targets["targets"]}
    tmap = {t["id"]: t for t in targets["targets"]}
    for _round in range(PER_TARGET):
        for t in targets["targets"]:
            if len(chosen) >= MAX_TOTAL or taken[t["id"]] > _round:
                continue
            for i, pct in per_target[t["id"]]:
                lat, lon = _latlon(cells[i], meta)
                if any(haversine_km(lat, lon, d["lat"], d["lon"]) < MIN_SEPARATION_KM for d in chosen):
                    continue
                if any(d["cell_pos"] == int(i) for d in chosen):
                    continue
                s = scored[t["id"]][0]
                country = countries[ctry[i]]["name"] if ctry[i] < len(countries) else ""
                ch = characterise(q[i].astype(np.float64), t, meta, feats)
                nearest = min(analogs, key=lambda a: haversine_km(lat, lon, a["lat"], a["lon"]))
                name, lit = _place(lat, lon, places, country)
                chosen.append({
                    "id": f"{t['id']}-{len(chosen) + 1}", "target": t["id"], "target_name": t["name"],
                    "name": name, "country": country, "literature": lit,
                    "lat": lat, "lon": lon, "cell": int(cells[i]), "cell_pos": int(i),
                    "score": round(float(s[i]), 4), "percentile": round(pct, 2),
                    "novelty_km": round(float(dist[i])), "nearest_known_analog": nearest["name"],
                    **ch, "uses": USES.get(t["id"], ""),
                    "caveats": caveats(lat, ch["best"], ch["worst"], feats, t),
                })
                taken[t["id"]] += 1
                break
    disc = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "data_generated": meta["generated"],
        "rule": (f"Default weights and filters; novelty on (alpha = {ALPHA}); sites = worker clustering of the best "
                 f"{N_CANDIDATE_CELLS} cells; qualify if analog score is in Earth's top {100 - MIN_PERCENTILE:g}% and "
                 f">= {MIN_NOVELTY_KM:g} km from every known analog; taken by blended score, at most {PER_TARGET} per "
                 f"target, >= {MIN_SEPARATION_KM:g} km apart, at most {MAX_TOTAL} in total. Generated by "
                 f"`python -m pipeline discoveries`; names from pipeline/assets/places.json."),
        "alpha": ALPHA, "synthetic_features": meta["synthetic_features"], "discoveries": chosen,
    }
    spot = spotlight(meta, targets, q, cells, ctry, scored, lat_all, lon_all, feats)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "discoveries.json").write_text(json.dumps(disc, indent=1, ensure_ascii=False), encoding="utf-8")
    (out_dir / "spotlight.json").write_text(json.dumps(spot, indent=1, ensure_ascii=False), encoding="utf-8")
    return disc, spot


def spotlight(meta, targets, q, cells, ctry, scored, lat_all, lon_all, feats) -> dict:
    n_lon, res = meta["grid"]["n_lon"], meta["grid"]["res"]
    pos = {int(c): i for i, c in enumerate(cells)}
    minlon, minlat, maxlon, maxlat = SOUTHERN_AFRICA_BBOX
    in_box = (lon_all >= minlon) & (lon_all <= maxlon) & (lat_all >= minlat) & (lat_all <= maxlat)
    box_idx = np.flatnonzero(in_box)
    places_out = []
    for p in LOCAL_PLACES:
        r0, c0 = int((90 - p["lat"]) / res), int((p["lon"] + 180) / res)
        win = [pos[(r0 + dr) * n_lon + (c0 + dc) % n_lon]
               for dr in range(-SPOTLIGHT_RADIUS_CELLS, SPOTLIGHT_RADIUS_CELLS + 1)
               for dc in range(-SPOTLIGHT_RADIUS_CELLS, SPOTLIGHT_RADIUS_CELLS + 1)
               if (r0 + dr) * n_lon + (c0 + dc) % n_lon in pos]
        if not win:
            log.warning("spotlight place %s has no land cells in the published dataset; skipping", p["name"])
            continue
        rows = []
        for t in targets["targets"]:
            s, sorted_s = scored[t["id"]]
            i = max(win, key=lambda k: s[k])
            pct = float(np.searchsorted(sorted_s, s[i], side="right") / s.size * 100)
            ch = characterise(q[i].astype(np.float64), t, meta, feats)
            lat, lon = _latlon(cells[i], meta)
            rows.append({"target": t["id"], "target_name": t["name"], "score": round(float(s[i]), 4),
                         "percentile": round(pct, 2), "lat": lat, "lon": lon, "best": ch["best"], "worst": ch["worst"]})
        best = max(rows, key=lambda r: r["percentile"])
        places_out.append({**p, "results": rows, "best_target": best["target"], "best_percentile": best["percentile"]})
    region_best = []
    if not box_idx.size:
        log.warning("Southern Africa spotlight bbox has no cells in the published dataset")
    for t in targets["targets"]:
        s, sorted_s = scored[t["id"]]
        if not box_idx.size:
            continue
        i = int(box_idx[np.argmax(s[box_idx])])
        lat, lon = _latlon(cells[i], meta)
        pct = float(np.searchsorted(sorted_s, s[i], side="right") / s.size * 100)
        region_best.append({"target": t["id"], "target_name": t["name"], "lat": lat, "lon": lon,
                            "country": meta["countries"][ctry[i]]["name"] if ctry[i] < len(meta["countries"]) else "",
                            "score": round(float(s[i]), 4), "percentile": round(pct, 2),
                            **characterise(q[i].astype(np.float64), t, meta, feats)})
    return {"generated": datetime.now().isoformat(timespec="seconds"), "data_generated": meta["generated"],
            "bbox": SOUTHERN_AFRICA_BBOX, "radius_cells": SPOTLIGHT_RADIUS_CELLS,
            "method": ("Default weights and filters, novelty off. A local place's score is its best cell within "
                       f"±{SPOTLIGHT_RADIUS_CELLS} cells (~±50 km) of the coordinates given; the percentile is among all "
                       "of Earth's land cells for that target. 'Region best' is the top cell inside the bbox."),
            "synthetic_features": meta["synthetic_features"], "places": places_out, "region_best": region_best}
