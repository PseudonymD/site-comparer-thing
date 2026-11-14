import { describe, expect, it } from 'vitest';
import { buildHash, parseHash } from '../src/links';

describe('deep links', () => {
  it('round-trips the full view state', () => {
    const s = {
      t: 'mars_jezero', w: Array.from({ length: 18 }, (_, i) => (i % 4) * 0.75), f: [{ id: 'ice', tau: 0.5 }, { id: 'ndvi', tau: 0.35 }],
      c: ['NA', 'ZA'], g: ['africa' as const], a: 0.3, r: 'safrica', v: { lat: -24.08, lon: -69.93, zoom: 9.5 }, s: { lat: -24.1, lon: -69.9 }, p: 'globe' as const, b: 'dark' as const,
      m: 'earth-complications' as const, h: 'solar-power', x: Array.from({ length: 18 }, (_, i) => ({ low: i, high: i + 1 })),
    };
    expect(parseHash(buildHash(s))).toEqual(s);
  });
  it('keeps defaults out of the URL and treats an empty filter list as explicit', () => {
    const h = buildHash({ t: 'moon_south_pole', f: [], r: 'world', p: 'mercator', b: 'satellite' });
    expect(h).toBe('#t=moon_south_pole&f=');
    expect(parseHash(h)).toEqual({ t: 'moon_south_pole', f: [] });
  });
  it('ignores malformed values', () => {
    expect(parseHash('#w=1_2_x&a=9&v=1,2&s=a,b')).toEqual({ a: 0.6 });
  });
});
