import { describe, expect, it } from 'vitest';
import { parseCoords } from '../src/coords';

const near = (text: string, lat: number, lon: number) => {
  const r = parseCoords(text);
  expect('error' in r ? r.error : null).toBeNull();
  if (!('error' in r)) {
    expect(r.lat).toBeCloseTo(lat, 4);
    expect(r.lon).toBeCloseTo(lon, 4);
  }
};
const bad = (text: string) => expect('error' in parseCoords(text)).toBe(true);

describe('coordinate parsing', () => {
  it('reads decimal pairs', () => {
    near('39.45, 73.55', 39.45, 73.55);
    near('39.45 73.55', 39.45, 73.55);
    near('-24.1;-69.9', -24.1, -69.9);
    near('-24.1 -69.9', -24.1, -69.9);
    near('24.1 -69.9', 24.1, -69.9);
    near(' −24.1, 69.9 ', -24.1, 69.9);
  });
  it('reads hemisphere letters, before or after', () => {
    near('39.45N 73.55E', 39.45, 73.55);
    near('39.45 S, 70.1 W', -39.45, -70.1);
    near('N39.45 E73.55', 39.45, 73.55);
    near('s 24.1 w 69.9', -24.1, -69.9);
  });
  it('reads degrees, minutes and seconds', () => {
    near('39°27′N 73°33′E', 39.45, 73.55);
    near(`39°27'00"N 73°33'00"E`, 39.45, 73.55);
    near('39 27 0 N 73 33 0 E', 39.45, 73.55);
    near('39 27 73 33', 39.45, 73.55);
  });
  it('swaps a longitude-first pair when letters say so', () => {
    near('73.55E 39.45N', 39.45, 73.55);
  });
  it('wraps 0–360 longitudes', () => {
    near('10, 350', 10, -10);
  });
  it('rejects invalid input', () => {
    bad('');
    bad('   ');
    bad('abc');
    bad('95, 10');
    bad('10, 400');
    bad('10');
    bad('10N 20N');
    bad('10 61 20 0');
    bad('1, 2, 3');
  });
});
