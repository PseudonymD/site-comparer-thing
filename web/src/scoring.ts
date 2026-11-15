// Analog score - TypeScript mirror of pipeline/scoring.py. Spec: docs/scoring.md
//
//   S_i  = 1 - sqrt( sum_f w_f (z_if - t_f)^2 / sum_f w_f ),   z_if = q_if / 255
//   c_if = w_f (z_if - t_f)^2 / sum_f w_f
//   hard filter (f, zthr): S_i = 0 when z_if > zthr
//   not applicable (cell i, feature f): f is left out of both sums for that cell, so the others renormalise
//   (never read as z = 0). Used for the soil layers on ice sheets, where the data has no soil.
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

/** Per-feature lookup table: lut[f*256 + q] = w_f (q/255 - t_f)^2 / W  (Infinity = filtered). */
export function buildLut(target: ArrayLike<number>, weights: ArrayLike<number>, filters: Filter[] = []): Float64Array {
  const F = target.length;
  const lut = new Float64Array(F * 256);
  const wsum = validateWeights(weights, F);
  for (let f = 0; f < F; f++) {
    const w = weights[f];
    const t = target[f];
    for (let q = 0; q < 256; q++) {
      const d = q / 255 - t;
      lut[f * 256 + q] = (w * d * d) / wsum;
    }
  }
  for (const flt of filters) {
    for (let q = 0; q < 256; q++) if (q / 255 > flt.zThreshold) lut[flt.feature * 256 + q] = Infinity;
  }
  return lut;
}

/** Cells for which some layers do not apply. mask[i] = 1 marks such a cell; those layers are skipped there. */
export interface Exclusion {
  mask: Uint8Array;
  features: number[];
  /** W / (W - sum of the skipped weights): puts the remaining sum back on a 0..1 scale. 0 = nothing left to score. */
  scale: number;
}
export function exclusionScale(weights: ArrayLike<number>, features: number[]): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  let skipped = 0;
  for (const f of features) skipped += weights[f];
  const rest = total - skipped;
  return rest > 1e-12 ? total / rest : 0;
}
/**
 * The pipeline sets the SoilGrids layers to 0 where there is no soil (ice sheets, about 30% of land cells;
 * see the notes in meta.json). Every such cell sits on the lowest percentile level of both layers, and that
 * level corresponds to a real value of 0. Those cells are marked so the soil layers are skipped there
 * instead of being scored as "zero sand, zero carbon". Returns null when the data has no such plateau.
 */
export function noSoilMask(q: Uint8Array, F: number, n: number, features: number[], breakpoints: number[][]): Uint8Array | null {
  const minQ = features.map((f) => {
    let m = 255;
    for (let i = 0; i < n; i++) {
      const v = q[i * F + f];
      if (v < m) m = v;
    }
    return m;
  });
  // Only when the lowest level really is a value of 0 for every soil layer.
  if (!features.every((_, k) => breakpoints[k][0] === 0 && valueFromQ(breakpoints[k], minQ[k]) === 0)) return null;
  const mask = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    let all = true;
    for (let k = 0; k < features.length; k++) if (q[i * F + features[k]] !== minQ[k]) all = false;
    if (all) {
      mask[i] = 1;
      count++;
    }
  }
  return count ? mask : null;
}
/** Score all cells. q is cell-major [cell][F] uint8. Writes into out (length n). */
export function scoreAll(q: Uint8Array, F: number, lut: Float64Array, out: Float32Array, excl?: Exclusion): void {
  const n = out.length;
  const skip = new Uint8Array(F);
  if (excl) for (const f of excl.features) skip[f] = 1;
  for (let i = 0, base = 0; i < n; i++, base += F) {
    let s = 0;
    if (excl && excl.mask[i]) {
      for (let f = 0; f < F; f++) if (!skip[f]) s += lut[(f << 8) + q[base + f]];
      s = excl.scale > 0 && s !== Infinity ? s * excl.scale : Infinity;
    } else {
      for (let f = 0; f < F; f++) s += lut[(f << 8) + q[base + f]];
    }
    out[i] = s === Infinity ? 0 : 1 - Math.sqrt(s);
  }
}

export function scoreCell(qrow: ArrayLike<number>, target: ArrayLike<number>, weights: ArrayLike<number>, filters: Filter[] = [], skip: number[] = []): number {
  const c = contributions(qrow, target, weights, skip);
  if (!c.some((_, f) => weights[f] > 0 && !skip.includes(f))) return 0; // no layer left to score here (as in scoreAll)
  for (const f of filters) if (qrow[f.feature] / 255 > f.zThreshold) return 0;
  let s = 0;
  for (const v of c) s += v;
  return 1 - Math.sqrt(s);
}

/**
 * Per-feature share of the squared gap. Features in skip are left out entirely (contribution 0, others renormalised).
 * When skip removes every weighted feature, all contributions are 0 (nothing left to score, as in scoreAll).
 */
export function contributions(qrow: ArrayLike<number>, target: ArrayLike<number>, weights: ArrayLike<number>, skip: number[] = []): number[] {
  validateWeights(weights, target.length);
  const w = skip.length ? Array.from(weights, (x, f) => (skip.includes(f) ? 0 : x)) : weights;
  let wsum = 0;
  for (let f = 0; f < target.length; f++) wsum += w[f];
  if (wsum <= 0) return Array.from({ length: target.length }, () => 0);
  const out: number[] = [];
  for (let f = 0; f < target.length; f++) {
    const d = qrow[f] / 255 - target[f];
    out.push((w[f] * d * d) / wsum);
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
