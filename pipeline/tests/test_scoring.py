import json

import numpy as np

from pipeline.scoring import blend, contributions, score
from pipeline.tests.make_fixture import PATH, build


def test_fixture_is_current():
    """The committed fixture must match what the reference scorer produces now."""
    stored = json.loads(PATH.read_text(encoding="utf-8"))
    fresh = build()
    for k in ("expected_score", "expected_score_filtered", "expected_blend"):
        np.testing.assert_allclose(stored[k], fresh[k], rtol=0, atol=1e-12)


def test_score_properties():
    t = np.full(18, 0.5)
    w = np.ones(18)
    q = np.full((3, 18), 128, dtype=np.uint8)
    q[1] = 0
    q[2] = 255
    s = score(q, t, w)
    assert s[0] > 0.99 and s[1] < s[0] and abs(s[1] - s[2]) < 0.01
    # perfect match = 1, worst case = 0
    assert score(np.zeros((1, 18), np.uint8), np.zeros(18), w)[0] == 1.0
    assert abs(score(np.zeros((1, 18), np.uint8), np.ones(18), w)[0]) < 1e-12


def test_contributions_sum_to_squared_distance():
    rng = np.random.default_rng(0)
    q = rng.integers(0, 256, (1, 18), dtype=np.uint8)
    t, w = rng.random(18), rng.random(18)
    c = contributions(q[0], t, w)
    assert abs((1 - np.sqrt(c.sum())) - score(q, t, w)[0]) < 1e-12


def test_filters_and_blend():
    q = np.array([[200] * 18, [10] * 18], dtype=np.uint8)
    s = score(q, np.full(18, 0.5), np.ones(18), [(0, 0.5)])
    assert s[0] == 0 and s[1] > 0
    b = blend(s, np.array([5000.0, 5000.0]), 0.5)
    assert b[0] == 0 and abs(b[1] - (0.5 * s[1] + 0.5)) < 1e-12
