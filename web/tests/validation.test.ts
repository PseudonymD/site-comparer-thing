import { describe, expect, it } from 'vitest';
import { validationSummary } from '../src/ui/validation';

const analog = (id: string, validation_class: 'development' | 'parameter-tuning' = 'development') => ({
  id, name: id, country: 'Test', lat: 0, lon: 0, bodies: ['Mars'], note: 'note', validation_class,
  documentation_status: 'incomplete' as const,
});

describe('known analog validation summaries', () => {
  it('calculates top-10, top-25, and top-50 counts from supplied ranks', () => {
    const summary = validationSummary({
      generated: 'today', n_random: 10, synthetic_features: [],
      results: [{
        target: 'mars', name: 'Mars', auc: 0.8, median_analog_percentile: 90, random_median_score: 0.4,
        analogs: [
          { id: 'a', name: 'A', score: 0.9, percentile: 99, rank: 3 },
          { id: 'b', name: 'B', score: 0.8, percentile: 95, rank: 20 },
          { id: 'c', name: 'C', score: 0.7, percentile: 90, rank: 45 },
          { id: 'd', name: 'D', score: 0.2, percentile: 20, rank: 90 },
        ],
      }],
    }, [analog('a'), analog('b', 'parameter-tuning'), analog('c'), analog('d')], 'mars');
    expect(summary?.counts).toEqual({ top10: 1, top25: 2, top50: 3 });
    expect(summary?.byId.get('b')?.validation_class).toBe('parameter-tuning');
  });

  it('returns no result instead of inventing validation values', () => {
    expect(validationSummary(null, [], 'mars')).toBeNull();
  });
});
