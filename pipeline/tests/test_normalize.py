import numpy as np

from pipeline.normalize import EarthCDF, dequantize, quantize


def test_cdf_monotonic_and_bounded():
    x = np.random.default_rng(1).normal(size=10000)
    cdf = EarthCDF(x)
    z = cdf(np.sort(x))
    assert z.min() >= 0 and z.max() <= 1 and np.all(np.diff(z) >= 0)
    assert abs(np.median(cdf(x)) - 0.5) < 0.01


def test_ties_use_midrank():
    cdf = EarthCDF(np.array([0, 0, 0, 0, 1.0]))
    assert abs(cdf(0.0) - 0.4) < 1e-12  # (0 + 4) / (2 * 5)


def test_target_clamp():
    cdf = EarthCDF(np.arange(100.0))
    assert cdf.clamp_cdf(-1e9) == cdf(0.0)
    assert cdf.clamp_cdf(np.inf) == cdf(99.0)


def test_breakpoints_and_quantize():
    cdf = EarthCDF(np.arange(101.0))
    bp = cdf.breakpoints()
    assert len(bp) == 101 and bp[0] == 0 and bp[-1] == 100
    z = np.linspace(0, 1, 11)
    assert np.allclose(dequantize(quantize(z)), z, atol=1 / 510)
