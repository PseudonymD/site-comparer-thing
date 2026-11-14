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
