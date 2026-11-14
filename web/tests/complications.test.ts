import { describe, expect, it } from 'vitest';
import { complicationEvidence } from '../src/complications';
import type { FeatureMeta, Target } from '../src/types';

const feature = (id: string, name: string, unit = ''): FeatureMeta => ({
  id, name, unit, group: 'test', ui_group: 'Climate', description: '', log_display: false,
  source: 'power', source_name: 'Test source', source_url: '', synthetic: false, proxy: false,
  coverage: 1, min: 0, max: 1, breakpoints: [0, 1],
});

const target = (body: 'Moon' | 'Mars'): Target => ({
  id: body.toLowerCase(), body, name: body, lat: 0, lon: 0, blurb: '',
  vector: [], weights: [], raw: {}, slope_hist: { edges: [], probs: [], median: 0, p90: 0, baseline_m: 0, refs: [], method: '' },
  validation: [], default_filters: [],
});

describe('Earth complication evidence', () => {
  it('keeps contextual differences separate from similarity scoring', () => {
    const evidence = complicationEvidence(target('Mars'), [
      { feature: feature('temp_mean', 'Mean temperature', '°C'), measurement: 12, percentile: 0.6 },
      { feature: feature('precip', 'Precipitation', 'mm/yr'), measurement: 300, percentile: 0.4 },
      { feature: feature('ndvi', 'Vegetation (NDVI)'), measurement: 0.2, percentile: 0.5 },
      { feature: feature('slope_mean', 'Mean slope', '°'), measurement: 4, percentile: 0.3 },
    ]);
    expect(evidence.find((item) => item.id === 'gravity')?.summary).toContain('3.71 m/s²');
    expect(evidence.find((item) => item.id === 'weather')?.status).toBe('partial');
    expect(evidence.find((item) => item.id === 'accessibility')?.limitation).toContain('route-connectivity');
    expect(evidence.some((item) => item.summary.includes('penalty'))).toBe(false);
  });

  it('reports unavailable evidence without inventing measurements', () => {
    const evidence = complicationEvidence(target('Moon'), []);
    expect(evidence.find((item) => item.id === 'weather')?.status).toBe('unavailable');
    expect(evidence.find((item) => item.id === 'dust')?.summary).toContain('not available');
  });
});
