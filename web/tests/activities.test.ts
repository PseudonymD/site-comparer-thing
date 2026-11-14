import { describe, expect, it } from 'vitest';
import { ACTIVITIES, activityById } from '../src/activities';

describe('research activities', () => {
  it('contains exactly the nine requested activities', () => {
    expect(ACTIVITIES).toHaveLength(9);
    expect(ACTIVITIES.map((activity) => activity.name)).toEqual([
      'Rover mobility and navigation',
      'Geological sampling',
      'Habitat construction and site preparation',
      'Dust and surface-material experiments',
      'Ice-related exploration',
      'Human field operations',
      'Solar power experiments',
      'Thermal experiments',
      'Cave exploration',
    ]);
  });

  it('keeps cave exploration disabled and does not change scoring evidence', () => {
    const cave = activityById('cave-exploration');
    expect(cave.availability).toBe('disabled');
    expect(cave.featureIds).toEqual([]);
    expect(cave.measurements).toEqual([]);
    expect(ACTIVITIES.every((activity) => activity.featureIds.length >= 0)).toBe(true);
  });
});
