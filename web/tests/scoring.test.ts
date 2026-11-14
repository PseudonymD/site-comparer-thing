import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blend, buildLut, contributions, scoreAll, scoreCell, valueFromZ, zThresholdFromValue } from '../src/scoring';

// Shared fixture produced by the Python reference implementation (python -m pipeline.tests.make_fixture).
const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../../docs/fixtures/scoring_fixture.json', import.meta.url)), 'utf8'));
const F: number = fx.n_features;
const q = Uint8Array.from((fx.q as number[][]).flat());
const n = (fx.q as number[][]).length;
const filters = (fx.filters as [number, number][]).map(([feature, zThreshold]) => ({ feature, zThreshold }));

describe('scoring parity with Python (docs/scoring.md)', () => {
  it('scoreAll matches Python scores', () => {
    const out = new Float32Array(n);
    scoreAll(q, F, buildLut(fx.target, fx.weights), out);
    out.forEach((v, i) => expect(v).toBeCloseTo(fx.expected_score[i], 5));
  });

  it('hard filters match', () => {
    const out = new Float32Array(n);
    scoreAll(q, F, buildLut(fx.target, fx.weights, filters), out);
    out.forEach((v, i) => expect(v).toBeCloseTo(fx.expected_score_filtered[i], 5));
  });

  it('scoreCell (float64 path) matches exactly', () => {
    for (let i = 0; i < n; i++) {
      const row = Array.from(q.subarray(i * F, (i + 1) * F));
      expect(scoreCell(row, fx.target, fx.weights)).toBeCloseTo(fx.expected_score[i], 12);
    }
  });

  it('contributions match', () => {
    for (let i = 0; i < 5; i++) {
      const row = Array.from(q.subarray(i * F, (i + 1) * F));
      contributions(row, fx.target, fx.weights).forEach((c, f) => expect(c).toBeCloseTo(fx.expected_contrib_first5[i][f], 12));
    }
  });

  it('novelty blend matches', () => {
    for (let i = 0; i < n; i++) {
      expect(blend(fx.expected_score_filtered[i], fx.dist_km[i], fx.alpha, fx.saturation_km)).toBeCloseTo(fx.expected_blend[i], 12);
    }
  });
});

describe('breakpoint helpers', () => {
  const bp = Array.from({ length: 101 }, (_, k) => k * 2); // value = 200 * z
  it('round-trips value <-> z', () => {
    expect(valueFromZ(bp, 0.25)).toBeCloseTo(50, 9);
    expect(zThresholdFromValue(bp, 50)).toBeCloseTo(0.25, 9);
    expect(zThresholdFromValue(bp, 1e9)).toBe(1);
    expect(zThresholdFromValue(bp, -1)).toBe(0);
  });
  it('handles ties (e.g. ice = 0 for most of Earth)', () => {
    const ties = Array.from({ length: 101 }, (_, k) => (k < 90 ? 0 : (k - 89) / 11));
    expect(zThresholdFromValue(ties, 0)).toBeCloseTo(0.89, 9); // exclude everything above the zero block
  });
});

describe('real-unit filter thresholds match Python', () => {
  it('zThresholdFromValue', () => {
    for (const [tau, z] of fx.zthr_cases as [number, number][]) expect(zThresholdFromValue(fx.zthr_breakpoints, tau)).toBeCloseTo(z, 12);
  });
});

describe('weight validation', () => {
  it('rejects zero, negative, and non-finite vectors', () => {
    expect(() => buildLut([0, 1], [0, 0])).toThrow();
    expect(() => buildLut([0, 1], [-1, 1])).toThrow();
    expect(() => buildLut([0, 1], [Number.NaN, 1])).toThrow();
  });

  describe('target ranges', () => {
    it('give zero distance inside the interval and retain point parity for equal bounds', () => {
      const target = [0.5];
      const weights = [1];
      expect(scoreCell([128], target, weights, [], [{ low: 0.4, high: 0.6 }])).toBe(1);
      expect(scoreCell([0], target, weights, [], [{ low: 0.5, high: 0.5 }])).toBeCloseTo(scoreCell([0], target, weights), 12);
    });
    it('rejects invalid intervals', () => {
      expect(() => buildLut([0.5], [1], [], [{ low: 0.8, high: 0.2 }])).toThrow();
      expect(() => buildLut([0.5], [1], [], [{ low: -0.1, high: 0.2 }])).toThrow();
    });
  });
});
