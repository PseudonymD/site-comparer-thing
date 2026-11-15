import { describe, expect, it } from 'vitest';
import {
  BODIES, PRESET_IDS, applyVector, cloneConfig, defaultConfig, effectiveWeights, keyOf, literatureWeights, parseStore,
  resolveConfig, sameConfig, serializeStore, weightShares, type PresetStore,
} from '../src/presets';

const ids = ['elevation', 'precip', 'ndvi', 'basalt', 'lights'];
const targets = [
  { body: 'Moon', weights: [0.5, 2.5, 3, 0.5, 1] },
  { body: 'Moon', weights: [1.5, 2.5, 3, 3, 1] },
  { body: 'Mars', weights: [0.5, 2.5, 3, 1, 1] },
];
const lit = (b: 'Moon' | 'Mars') => literatureWeights(targets, ids, b);
const def = (b: 'Moon' | 'Mars', p: (typeof PRESET_IDS)[number]) => defaultConfig(p, ids, lit(b));

describe('preset defaults', () => {
  it('averages literature weights per body and snaps to the slider step', () => {
    expect(lit('Moon')).toEqual({ elevation: 1, precip: 2.5, ndvi: 3, basalt: 1.75, lights: 1 });
    expect(lit('Mars').basalt).toBe(1);
  });
  it('Exploration is flat; Direct turns Earth factors off; Direct + Earth keeps all on', () => {
    expect(effectiveWeights(def('Moon', 'exploration'), ids)).toEqual([1, 1, 1, 1, 1]);
    expect(effectiveWeights(def('Moon', 'direct'), ids)).toEqual([1, 0, 0, 1.75, 0]);
    expect(effectiveWeights(def('Moon', 'direct_earth'), ids)).toEqual([1, 2.5, 3, 1.75, 1]);
  });
  it('keeps the original weight on a layer that is switched off', () => {
    expect(def('Moon', 'direct').weights.precip).toBe(2.5);
  });
});

describe('persistence', () => {
  const store = (): PresetStore => parseStore(null, ids);
  it('saves each of the six configurations independently and survives a JSON round trip', () => {
    const s = store();
    for (const b of BODIES) {
      for (const p of PRESET_IDS) {
        const c = cloneConfig(def(b, p));
        c.weights.elevation = 0.25 * (1 + BODIES.indexOf(b) * 3 + PRESET_IDS.indexOf(p));
        s.saved[keyOf(b, p)] = c;
      }
    }
    const back = parseStore(serializeStore(s), ids);
    const seen = new Set<number>();
    for (const b of BODIES) {
      for (const p of PRESET_IDS) {
        const r = resolveConfig(back.saved[keyOf(b, p)], def(b, p), ids);
        expect(r.weights.elevation).toBe(0.25 * (1 + BODIES.indexOf(b) * 3 + PRESET_IDS.indexOf(p)));
        seen.add(r.weights.elevation);
      }
    }
    expect(seen.size).toBe(6);
  });
  it('saving one configuration leaves the others at their defaults', () => {
    const s = store();
    const c = cloneConfig(def('Mars', 'direct'));
    c.enabled.precip = true;
    s.saved[keyOf('Mars', 'direct')] = c;
    const back = parseStore(serializeStore(s), ids);
    expect(Object.keys(back.saved)).toEqual([keyOf('Mars', 'direct')]);
    expect(sameConfig(resolveConfig(back.saved[keyOf('Mars', 'direct_earth')], def('Mars', 'direct_earth'), ids), def('Mars', 'direct_earth'), ids)).toBe(true);
    expect(sameConfig(resolveConfig(back.saved[keyOf('Moon', 'direct')], def('Moon', 'direct'), ids), def('Moon', 'direct'), ids)).toBe(true);
  });
  it('reset removes only that key', () => {
    const s = store();
    s.saved[keyOf('Moon', 'direct')] = cloneConfig(def('Moon', 'direct'));
    s.saved[keyOf('Mars', 'direct')] = cloneConfig(def('Mars', 'direct'));
    delete s.saved[keyOf('Moon', 'direct')];
    expect(Object.keys(s.saved)).toEqual([keyOf('Mars', 'direct')]);
  });
  it('remembers the active mode per body', () => {
    const s = store();
    s.active.Moon = 'exploration';
    const back = parseStore(serializeStore(s), ids);
    expect(back.active).toEqual({ Moon: 'exploration', Mars: 'direct_earth' });
  });
  it('ignores corrupt or out-of-range stored data', () => {
    expect(parseStore('not json', ids).saved).toEqual({});
    expect(parseStore(JSON.stringify({ version: 2 }), ids).saved).toEqual({});
    const bad = { version: 1, active: { Moon: 'nope' }, saved: { 'Moon:direct': { weights: { elevation: 99, precip: 'x', ndvi: 2 }, enabled: { ndvi: 'yes' } } } };
    const p = parseStore(JSON.stringify(bad), ids);
    expect(p.active.Moon).toBe('direct_earth');
    const r = resolveConfig(p.saved['Moon:direct'], def('Moon', 'direct'), ids);
    expect(r.weights.elevation).toBe(1); // 99 rejected, default kept
    expect(r.weights.ndvi).toBe(2);
    expect(r.enabled.ndvi).toBe(false); // non-boolean rejected, default kept
  });
  it('fills in layers that a saved file does not know about', () => {
    const r = resolveConfig({ weights: { elevation: 2 }, enabled: {} }, def('Mars', 'exploration'), ids);
    expect(r.weights).toEqual({ elevation: 2, precip: 1, ndvi: 1, basalt: 1, lights: 1 });
  });
});

describe('weights helpers', () => {
  it('shares sum to 100 and skip off layers', () => {
    const sh = weightShares(effectiveWeights(def('Moon', 'direct'), ids));
    expect(sh.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    expect(sh[1]).toBe(0);
    expect(weightShares([0, 0])).toEqual([0, 0]);
  });
  it('applyVector turns weight-0 layers off and positive ones on', () => {
    const c = applyVector(def('Moon', 'direct'), [0, 2, 0, 1, 0], ids);
    expect(effectiveWeights(c, ids)).toEqual([0, 2, 0, 1, 0]);
    expect(c.weights.elevation).toBe(1); // stored weight kept for a layer that is off
  });
});
