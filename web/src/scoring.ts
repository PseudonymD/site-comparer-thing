// Analog score - TypeScript mirror of pipeline/scoring.py. Spec: docs/scoring.md
//
//   S_i  = 1 - sqrt( sum_f w_f (z_if - t_f)^2 / sum_f w_f ),   z_if = q_if / 255
//   c_if = w_f (z_if - t_f)^2 / sum_f w_f
//   hard filter (f, zthr): S_i = 0 when z_if > zthr
//   novelty N_i = min(d_i / D0, 1);  blended B_i = (1 - a) S_i + a N_i  (0 if S_i == 0)

export interface Filter {
  feature: number;
  zThreshold: number; // exclude cells with z > zThreshold
}

/** Per-feature lookup table: lut[f*256 + q] = w_f (q/255 - t_f)^2 / W  (Infinity = filtered). */
export function buildLut(target: ArrayLike<number>, weights: ArrayLike<number>, filters: Filter[] = []): Float64Array {
  const F = target.length;
  const lut = new Float64Array(F * 256);
  let wsum = 0;
  for (let f = 0; f < F; f++) wsum += Math.max(0, weights[f]);
  if (wsum <= 0) wsum = Infinity; // all weights zero -> every score 1 - sqrt(0)... handled below
  for (let f = 0; f < F; f++) {
    const w = Math.max(0, weights[f]);
    const t = target[f];
    for (let q = 0; q < 256; q++) {
      const d = q / 255 - t;
      lut[f * 256 + q] = wsum === Infinity ? 0 : (w * d * d) / wsum;
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

export function scoreCell(qrow: ArrayLike<number>, target: ArrayLike<number>, weights: ArrayLike<number>, filters: Filter[] = []): number {
  const c = contributions(qrow, target, weights);
  for (const f of filters) if (qrow[f.feature] / 255 > f.zThreshold) return 0;
  let s = 0;
  for (const v of c) s += v;
  return 1 - Math.sqrt(s);
}

export function contributions(qrow: ArrayLike<number>, target: ArrayLike<number>, weights: ArrayLike<number>): number[] {
  let wsum = 0;
  for (let f = 0; f < target.length; f++) wsum += Math.max(0, weights[f]);
  const out: number[] = [];
  for (let f = 0; f < target.length; f++) {
    const d = qrow[f] / 255 - target[f];
    out.push(wsum > 0 ? (Math.max(0, weights[f]) * d * d) / wsum : 0);
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
