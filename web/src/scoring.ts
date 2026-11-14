// Analog score - TypeScript mirror of pipeline/scoring.py. Spec: docs/scoring.md
//
//   S_i  = 1 - sqrt( sum_f w_f d_if^2 / sum_f w_f ),   z_if = q_if / 255
//   d_if = max(L_f - z_if, 0, z_if - U_f), with L_f = U_f = t_f for point scoring
//   c_if = w_f (z_if - t_f)^2 / sum_f w_f
//   hard filter (f, zthr): S_i = 0 when z_if > zthr
//   novelty N_i = min(d_i / D0, 1);  blended B_i = (1 - a) S_i + a N_i  (0 if S_i == 0)

export interface Filter {
  feature: number;
  zThreshold: number; // exclude cells with z > zThreshold
}

function validateWeights(weights: ArrayLike<number>, expected: number): number {
  if (weights.length !== expected) throw new RangeError(`weights must have length ${expected}`);
  let sum = 0;
  for (let i = 0; i < expected; i++) {
    const w = weights[i];
    if (!Number.isFinite(w) || w < 0) throw new RangeError('weights must be finite and non-negative');
    sum += w;
  }
  if (sum <= 0) throw new RangeError('at least one weight must be greater than zero');
  return sum;
}

export interface TargetRange {
  min: number;
  max: number;
}

function validateRanges(target: ArrayLike<number>, ranges?: readonly TargetRange[]): TargetRange[] {
  const out = ranges ?? Array.from({ length: target.length }, (_, f) => ({ min: target[f], max: target[f] }));
  if (out.length !== target.length) throw new RangeError(`target ranges must have length ${target.length}`);
  for (const range of out) {
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min < 0 || range.max > 1 || range.min > range.max) {
      throw new RangeError('target ranges must be finite, ordered, and within [0, 1]');
    }
  }
  return out.map((range) => ({ min: range.min, max: range.max }));
}

/** Per-feature lookup table: lut[f*256 + q] = w_f * intervalDistance(q/255)^2 / W. */
export function buildLut(target: ArrayLike<number>, weights: ArrayLike<number>, filters: Filter[] = [], ranges?: readonly TargetRange[]): Float64Array {
  const F = target.length;
  const lut = new Float64Array(F * 256);
  const wsum = validateWeights(weights, F);
  const targetRanges = validateRanges(target, ranges);
  for (let f = 0; f < F; f++) {
    const w = weights[f];
    const range = targetRanges[f];
    for (let q = 0; q < 256; q++) {
      const z = q / 255;
      const d = Math.max(range.min - z, 0, z - range.max);
      lut[f * 256 + q] = (w * d * d) / wsum;
    }
  }
  for (const flt of filters) {
    for (let q = 0; q < 256; q++) if (q / 255 > flt.zThreshold) lut[flt.feature * 256 + q] = Infinity;
  }
  return lut;
}

/** Score all cells. q is cell-major [cell][F] uint8. Writes into out (length n). */
export function scoreAll(q: Uint8Array, F: number, lut: Float64Array, out: Float32Array): void {
  const n = out.length;
  for (let i = 0, base = 0; i < n; i++, base += F) {
    let s = 0;
    for (let f = 0; f < F; f++) s += lut[(f << 8) + q[base + f]];
    out[i] = s === Infinity ? 0 : 1 - Math.sqrt(s);
  }
}

export function scoreCell(qrow: ArrayLike<number>, target: ArrayLike<number>, weights: ArrayLike<number>, filters: Filter[] = [], ranges?: readonly TargetRange[]): number {
  if (Array.from(qrow).some((value) => !Number.isFinite(value))) return 0;
  const c = contributions(qrow, target, weights, ranges);
  for (const f of filters) if (qrow[f.feature] / 255 > f.zThreshold) return 0;
  let s = 0;
  for (const v of c) s += v;
  return Math.min(1, Math.max(0, 1 - Math.sqrt(s)));
}

export function contributions(qrow: ArrayLike<number>, target: ArrayLike<number>, weights: ArrayLike<number>, ranges?: readonly TargetRange[]): number[] {
  const wsum = validateWeights(weights, target.length);
  const targetRanges = validateRanges(target, ranges);
  const out: number[] = [];
  for (let f = 0; f < target.length; f++) {
    const z = qrow[f] / 255;
    const range = targetRanges[f];
    const d = Math.max(range.min - z, 0, z - range.max);
    out.push((weights[f] * d * d) / wsum);
  }
  return out;
}

const R_KM = 6371.0088;
const RAD = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = (lat2 - lat1) * RAD;
  const dlon = (lon2 - lon1) * RAD;
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dlon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export function noveltyUnit(dKm: number, saturationKm: number): number {
  return Math.min(dKm / saturationKm, 1);
}

export function blend(s: number, dKm: number, alpha: number, saturationKm: number): number {
  if (s <= 0) return 0;
  return (1 - alpha) * s + alpha * noveltyUnit(dKm, saturationKm);
}

/**
 * Convert a real-unit threshold tau into the z threshold for "exclude value > tau",
 * using the 101 percentile breakpoints stored in meta.json. Returns 1 when nothing is excluded.
 */
export function zThresholdFromValue(breakpoints: number[], tau: number): number {
  const n = breakpoints.length - 1;
  let k = -1;
  for (let i = 0; i <= n; i++) if (breakpoints[i] <= tau) k = i;
  if (k < 0) return 0;
  if (k >= n) return 1;
  const a = breakpoints[k];
  const b = breakpoints[k + 1];
  const frac = b > a ? (tau - a) / (b - a) : 0;
  return (k + frac) / n;
}

/** Real-unit value of a quantised percentile (inverse CDF via breakpoints). */
export function valueFromQ(breakpoints: number[], q: number): number {
  return valueFromZ(breakpoints, q / 255);
}

export function valueFromZ(breakpoints: number[], z: number): number {
  const n = breakpoints.length - 1;
  const x = Math.min(Math.max(z, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  return breakpoints[i] * (1 - f) + breakpoints[i + 1] * f;
}
