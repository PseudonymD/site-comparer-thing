export type BBox = [number, number, number, number];

export function pointInBox(lat: number, lon: number, bbox: BBox): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

export function isSelected(lat: number, lon: number, countryId: number, bbox: BBox | null, countryIds: ReadonlySet<number> | null): boolean {
  return (!bbox || pointInBox(lat, lon, bbox)) && (!countryIds || countryIds.has(countryId));
}

export function validWeightVector(weights: ArrayLike<number>, expected: number): boolean {
  if (weights.length !== expected) return false;
  let total = 0;
  for (let i = 0; i < expected; i++) {
    const weight = weights[i];
    if (!Number.isFinite(weight) || weight < 0) return false;
    total += weight;
  }
  return total > 0;
}
