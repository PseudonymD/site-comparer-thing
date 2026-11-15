import { describe, expect, it } from 'vitest';
import { matchesGeography, regionForIso } from '../src/geography';

describe('geography filters', () => {
  it('classifies countries using their ISO codes', () => {
    expect(regionForIso('ZA')).toBe('africa');
    expect(regionForIso('JP')).toBe('asia');
    expect(regionForIso('NZ')).toBe('oceania');
  });

  it('combines country and region selections with AND semantics', () => {
    expect(matchesGeography('ZA', ['ZA', 'NA'], ['africa'])).toBe(true);
    expect(matchesGeography('NA', ['ZA', 'NA'], ['africa'])).toBe(true);
    expect(matchesGeography('CL', ['CL'], ['africa'])).toBe(false);
    expect(matchesGeography('ZA', [], [])).toBe(true);
  });
});
