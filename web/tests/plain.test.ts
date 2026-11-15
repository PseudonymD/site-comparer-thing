// Simple Mode wording layer (src/ui/plain.ts). It must only re-word numbers the engine already produces.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAIN_FEATURES, TARGET_PLAIN, closeness, compare, explain, levelWord, list, matchLabel, topPercent } from '../src/ui/plain';
import { DEFAULT_ACTIVE, defaultConfig, effectiveWeights, type Body } from '../src/presets';
import { buildLut, contributions, scoreAll, scoreCell } from '../src/scoring';
import { buildHash, parseHash } from '../src/links';

const dir = new URL('../public/data/', import.meta.url);
const json = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const meta = json('meta.json');
const targets = json('targets.json').targets;
const raw = gunzipSync(readFileSync(new URL('features.bin.gz', dir)));
const q = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
const F: number = meta.n_features;
const ids: string[] = meta.features.map((f: { id: string }) => f.id);
const row = (i: number) => Array.from(q.subarray(i * F, i * F + F));
const defaults = (b: Body) => effectiveWeights(defaultConfig(b, DEFAULT_ACTIVE, ids), ids);

describe('wording helpers', () => {
  it('describes a value by its rank among Earth land, and a true zero as none', () => {
    expect([0.05, 0.2, 0.5, 0.8, 0.95].map((z) => levelWord(z))).toEqual(['very low', 'low', 'medium', 'high', 'very high']);
    expect(levelWord(0.7, 0)).toBe('none');
  });
  it('turns the percentile gap into four plain levels', () => {
    expect([0.05, 0.2, 0.4, 0.8].map(closeness)).toEqual(['very close', 'close', 'different', 'very different']);
  });
  it('labels the overall match from the rank among Earth land, and says when a spot is left out', () => {
    expect(matchLabel(0.9999).label).toBe('Excellent match');
    expect(matchLabel(0.96).label).toBe('Strong match');
    expect(matchLabel(0.9).label).toBe('Good match');
    expect(matchLabel(0.7).label).toBe('Partial match');
    expect(matchLabel(0.3).label).toBe('Weak match');
    expect(matchLabel(NaN).label).toBe('Left out');
  });
  it('uses the same "top x%" figure as Normal Mode and an Oxford-comma list', () => {
    expect(topPercent(0.9999)).toBe('top 0.01%');
    expect(topPercent(0.97)).toBe('top 3.0%');
    expect(list(['a'])).toBe('a');
    expect(list(['a', 'b'])).toBe('a and b');
    expect(list(['a', 'b', 'c'])).toBe('a, b, and c');
  });
  it('has plain names for every layer and every target', () => {
    for (const id of ids) expect(PLAIN_FEATURES[id], id).toBeDefined();
    for (const t of targets) expect(TARGET_PLAIN[t.id], t.id).toBeDefined();
  });
});

describe('comparison uses the same numbers as the engine', () => {
  const t = targets[2]; // Jezero
  const w = defaults('Mars');
  const cell = 123456;
  const qrow = row(cell);
  const cmp = compare({ features: meta.features, q: qrow, target: t, weights: w, skip: [] });
  it('gap shares are the engine contributions, as percentages of the total', () => {
    const c = contributions(qrow, t.vector, w);
    const total = c.reduce((a, b) => a + b, 0);
    cmp.rows.forEach((r, j) => expect(r.gapShare).toBeCloseTo((c[j] / total) * 100, 9));
    expect(cmp.rows.reduce((a, r) => a + r.gapShare, 0)).toBeCloseTo(100, 9);
    expect(cmp.rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(100, 9);
  });
  it('the cell score matches the worker-style table scorer for the same weights', () => {
    const out = new Float32Array(1);
    scoreAll(new Uint8Array(qrow), F, buildLut(t.vector, w), out);
    expect(out[0]).toBeCloseTo(scoreCell(qrow, t.vector, w), 6);
  });
  it('closest matches are close, biggest differences are not, and both are ordered', () => {
    expect(cmp.matches.every((r) => r.gap < 0.25)).toBe(true);
    expect(cmp.differences.every((r) => r.gap >= 0.25)).toBe(true);
    for (let i = 1; i < cmp.differences.length; i++) expect(cmp.differences[i - 1].gapShare).toBeGreaterThanOrEqual(cmp.differences[i].gapShare);
    expect(cmp.matches.length).toBeLessThanOrEqual(3);
    expect(cmp.differences.length).toBeLessThanOrEqual(3);
  });
  it('a layer that does not apply to the cell is left out, not read as zero', () => {
    const sand = ids.indexOf('sand');
    const soc = ids.indexOf('soc');
    const s = compare({ features: meta.features, q: qrow, target: t, weights: w, skip: [sand, soc] });
    expect(s.rows[sand].skipped && s.rows[soc].skipped).toBe(true);
    expect(s.rows[sand].weight).toBe(0);
    expect(s.layersUsed).toBe(cmp.layersUsed - 2);
    expect(s.rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(100, 9);
  });
  it('shows a switched-off layer as not used', () => {
    const off = [...w];
    off[ids.indexOf('ndvi')] = 0;
    const r = compare({ features: meta.features, q: qrow, target: t, weights: off, skip: [] });
    expect(r.rows[ids.indexOf('ndvi')].used).toBe(false);
    expect(r.layersUsed).toBe(17);
  });
  it('describes Moon targets that have no air as "none", not as a measurement', () => {
    const moon = targets[0];
    const r = compare({ features: meta.features, q: qrow, target: moon, weights: defaults('Moon'), skip: [] });
    expect(r.rows[ids.indexOf('precip')].there).toMatch(/none/);
    expect(r.rows[ids.indexOf('ndvi')].there).toBe('none');
  });
});

describe('explanation', () => {
  const t = targets[2];
  const w = defaults('Mars');
  const cmp = compare({ features: meta.features, q: row(5000), target: t, weights: w, skip: [] });
  it('names the place and target, gives the rank, and states what the comparison cannot see', () => {
    const text = explain({ place: 'Chile', targetName: 'Jezero crater', body: 'Mars', score: 70, pctl: 0.9999, cmp, filtered: false });
    expect(text).toContain('Chile');
    expect(text).toContain('Jezero crater on Mars');
    expect(text).toContain('top 0.01%');
    expect(text).toContain('Real field-site choices need expert checks');
  });
  it('explains a filtered-out spot instead of ranking it', () => {
    const text = explain({ place: 'Antarctica', targetName: 'Jezero crater', body: 'Mars', score: 55, pctl: NaN, cmp, filtered: true });
    expect(text).toContain('left out');
    expect(text).not.toContain('top ');
  });
  it('contains no technical jargon', () => {
    const text = explain({ place: 'X', targetName: 'Y', body: 'Moon', score: 60, pctl: 0.9, cmp, filtered: false });
    expect(text).not.toMatch(/\b(ROC|AUC)\b|percentile|breakpoint|weight|vector/);
  });
});

describe('Simple Mode link', () => {
  it('round-trips ui=simple and leaves Normal Mode links exactly as they were', () => {
    expect(parseHash(buildHash({ t: 'mars_jezero', ui: 'simple' }))).toEqual({ t: 'mars_jezero', ui: 'simple' });
    expect(buildHash({ t: 'mars_jezero' })).toBe('#t=mars_jezero');
    expect(parseHash('#t=mars_jezero&ui=other')).toEqual({ t: 'mars_jezero' });
  });
});
