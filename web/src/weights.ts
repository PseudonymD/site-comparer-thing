export function normalizeWeights(weights: ArrayLike<number>): number[] | null {
  const out = Array.from({ length: weights.length }, (_, i) => weights[i]);
  if (out.some((weight) => !Number.isFinite(weight) || weight < 0)) return null;
  const total = out.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return out.map((weight) => (weight / total) * 100);
}

/**
 * Change one percentage while preserving a 100% total whenever another active
 * feature can receive the redistributed share.
 */
export function redistributeWeight(weights: ArrayLike<number>, index: number, requested: number): number[] {
  if (index < 0 || index >= weights.length || !Number.isFinite(requested)) throw new RangeError('invalid weight index or value');
  const out = Array.from({ length: weights.length }, (_, i) => Math.max(0, weights[i]));
  const next = Math.min(100, Math.max(0, requested));
  const otherTotal = out.reduce((sum, weight, i) => i === index ? sum : sum + weight, 0);
  out[index] = next;
  if (otherTotal > 0) {
    const remaining = 100 - next;
    for (let i = 0; i < out.length; i++) if (i !== index) out[i] = (out[i] / otherTotal) * remaining;
  } else if (next > 0) {
    out[index] = 100;
  }
  return out;
}

export function totalWeight(weights: ArrayLike<number>): number {
  return Array.from({ length: weights.length }, (_, i) => weights[i]).reduce((sum, weight) => sum + weight, 0);
}

export function hasPositiveWeight(weights: ArrayLike<number>): boolean {
  return Array.from({ length: weights.length }, (_, i) => weights[i]).some((weight) => Number.isFinite(weight) && weight > 0);
}
