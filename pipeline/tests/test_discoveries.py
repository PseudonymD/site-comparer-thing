"""Discoveries: clustering matches the worker's rule and naming uses the gazetteer."""
import numpy as np

from pipeline import discoveries as d


def test_sites_cluster_adjacent_cells_and_wrap_longitude():
    n_lon, n_lat = 10, 5
    # land cells: a 2-cell blob at row 1 (cols 0 and 9 are neighbours across the antimeridian) + an isolated cell
    cells = np.array([1 * n_lon + 0, 1 * n_lon + 9, 3 * n_lon + 5])
    b = np.array([0.9, 0.8, 0.7])
    reps = d._sites(b, cells, n_lon, n_lat)
    assert reps == [0, 2]  # blob represented by its best cell, then the isolated one


def test_place_lookup():
    places = [{"name": "Box", "bbox": [0, 0, 10, 10], "literature": "ref"}]
    assert d._place(5, 5, places, "X") == ("Box", "ref")
    assert d._place(-5, 5, places, "X") == ("X site", None)


def test_empty_spotlight_windows_are_skipped(monkeypatch):
    meta = {"generated": "test", "synthetic_features": [], "grid": {"n_lon": 4, "res": 1.0}, "countries": [{"name": "", "iso": ""}]}
    targets = {"targets": [{"id": "t", "name": "Target", "vector": [0.5], "weights": [1.0], "raw": {"f": {"value": 0, "beyond_earth": False}}}]}
    q = np.zeros((1, 1), dtype=np.uint8)
    cells = np.array([0], dtype=np.int64)
    ctry = np.array([0], dtype=np.uint8)
    scored = {"t": (np.array([0.5]), np.array([0.5]))}
    monkeypatch.setattr(d, "LOCAL_PLACES", [{"id": "outside", "name": "Outside", "lat": -30, "lon": 20, "why": ""}])
    out = d.spotlight(meta, targets, q, cells, ctry, scored, np.array([89.5]), np.array([-179.5]), [{"id": "f", "name": "F", "unit": "", "breakpoints": [0, 1], "synthetic": False, "proxy": False}])
    assert out["places"] == []
    assert out["region_best"] == []
