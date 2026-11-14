import { describe, expect, it } from 'vitest';
import { isSelected, pointInBox, validWeightVector } from '../src/population';

describe('population helpers', () => {
  it('tests geographic bounds inclusively', () => {
    expect(pointInBox(0, 0, [-1, -1, 1, 1])).toBe(true);
    expect(pointInBox(2, 0, [-1, -1, 1, 1])).toBe(false);
  });

  it('accepts only positive finite weight vectors', () => {
    expect(validWeightVector([0, 1], 2)).toBe(true);
    expect(validWeightVector([0, 0], 2)).toBe(false);
    expect(validWeightVector([-1, 1], 2)).toBe(false);
  });

  it('combines regional and country populations with AND semantics', () => {
    expect(isSelected(0, 0, 7, [-1, -1, 1, 1], new Set([7, 8]))).toBe(true);
    expect(isSelected(0, 0, 9, [-1, -1, 1, 1], new Set([7, 8]))).toBe(false);
    expect(isSelected(2, 0, 7, [-1, -1, 1, 1], new Set([7, 8]))).toBe(false);
  });
});
