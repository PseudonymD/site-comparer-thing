import { describe, expect, it } from 'vitest';
import { ACTIVITIES, activityFor } from '../src/activities';

describe('research activity capabilities', () => {
  it('defines exactly the nine requested activities', () => {
    expect(ACTIVITIES).toHaveLength(9);
    expect(new Set(ACTIVITIES.map((activity) => activity.id)).size).toBe(9);
  });

  it('keeps unsupported cave exploration disabled and explanatory', () => {
    const cave = activityFor('cave-exploration');
    expect(cave.enabled).toBe(false);
    expect(cave.limitations.join(' ')).toMatch(/dataset|karst|cave/i);
  });
});
