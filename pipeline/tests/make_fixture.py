"""Generate docs/fixtures/scoring_fixture.json: inputs + expected outputs of the reference scorer.

Run: python -m pipeline.tests.make_fixture   (the web test suite checks scoring.ts against this file)
"""
import json

import numpy as np

from pipeline.config import NOVELTY_SATURATION_KM, REPO_DIR
from pipeline.scoring import blend, contributions, score, z_threshold_from_value

PATH = REPO_DIR / "docs" / "fixtures" / "scoring_fixture.json"


ZBP = [0.0] * 60 + [round((k - 59) / 41, 4) for k in range(60, 101)]


def build() -> dict:
    rng = np.random.default_rng(2026)
    n, F = 200, 18
    q = rng.integers(0, 256, size=(n, F), dtype=np.uint8)
    q[0] = 0
    q[1] = 255
    target = np.round(rng.random(F), 4)
    weights = np.round(rng.choice([0, 0.25, 0.5, 1, 1.5, 2, 3], size=F), 2)
    filters = [[11, 0.6], [15, 0.8]]
    s = score(q, target, weights)
    sf = score(q, target, weights, [(f, t) for f, t in filters])
    d = np.round(rng.random(n) * 4000, 2)
    b = blend(sf, d, 0.3)
    return {
        "n_features": F, "q": q.tolist(), "target": target.tolist(), "weights": weights.tolist(),
        "filters": filters, "dist_km": d.tolist(), "alpha": 0.3, "saturation_km": NOVELTY_SATURATION_KM,
        "expected_score": s.tolist(), "expected_score_filtered": sf.tolist(), "expected_blend": b.tolist(),
        "zthr_breakpoints": ZBP, "zthr_cases": [[tau, z_threshold_from_value(ZBP, tau)] for tau in (-1, 0, 0.05, 0.3, 0.95, 2)],
        "expected_contrib_first5": [contributions(q[i], target, weights).tolist() for i in range(5)],
    }


if __name__ == "__main__":
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(build()), encoding="utf-8")
    print(f"wrote {PATH}")
