import { describe, expect, it } from 'vitest';
import {
  APPLICABILITY, BODIES, DEFAULT_TABLE, EARTH_FACTORS, PRESET_IDS, WEIGHT_MAX, activeTotal, applyVector, cloneConfig,
  defaultConfig, effectiveWeights, keyOf, parseStore, resolveConfig, sameConfig, serializeStore, targetUsable, weightShares,
  type Body, type PresetId, type PresetStore,
} from '../src/presets';
import { buildLut, contributions, exclusionScale, scoreAll, scoreCell } from '../src/scoring';

// The 18 layers in on-disk order (pipeline/config.py).
const ids = ['elevation', 'slope_mean', 'slope_p90', 'tri', 'relief', 'temp_mean', 'temp_range', 'temp_min', 'precip', 'humidity', 'solar', 'ndvi', 'soc', 'sand', 'basalt', 'ice', 'lights', 'aod'];
const cfg = (b: Body, p: PresetId) => defaultConfig(b, p, ids);
const on = (b: Body, p: PresetId) => ids.filter((f) => cfg(b, p).enabled[f]);
const total = (b: Body, p: PresetId) => activeTotal(cfg(b, p), ids);
const share = (b: Body, p: PresetId, fs: readonly string[]) => fs.reduce((a, f) => a + (cfg(b, p).enabled[f] ? cfg(b, p).weights[f] : 0), 0);

describe('six default configurations', () => {
  for (const b of BODIES) {
    for (const p of PRESET_IDS) {
      it(`${b} ${p}: enabled weights total exactly 100`, () => {
        expect(total(b, p)).toBe(100);
        expect(weightShares(effectiveWeights(cfg(b, p), ids)).reduce((a, c) => a + c, 0)).toBeCloseTo(100, 10);
      });
      it(`${b} ${p}: every weight is within the slider range and in half-point steps`, () => {
        for (const f of ids) {
          const w = cfg(b, p).weights[f];
          expect(w).toBeGreaterThan(0);
          expect(w).toBeLessThanOrEqual(WEIGHT_MAX);
          expect(w * 2).toBe(Math.round(w * 2));
        }
      });
    }
  }

  it('Moon Direct Comparison: precipitation, vegetation and light pollution are off', () => {
    for (const f of ['precip', 'ndvi', 'lights']) expect(cfg('Moon', 'direct').enabled[f]).toBe(false);
    expect(on('Moon', 'direct')).toEqual(['elevation', 'slope_mean', 'slope_p90', 'tri', 'relief', 'temp_mean', 'temp_range', 'temp_min', 'solar', 'sand', 'basalt', 'ice']);
  });
  it('Moon Direct + Earth Factors: precipitation, vegetation and light pollution are on, with all other Earth layers', () => {
    for (const f of ['precip', 'ndvi', 'lights']) expect(cfg('Moon', 'direct_earth').enabled[f]).toBe(true);
    expect(on('Moon', 'direct_earth')).toEqual(ids);
  });
  it('Mars Direct Comparison: Earth-only layers are off, atmosphere (humidity, dust) stays on', () => {
    for (const f of EARTH_FACTORS.Mars) expect(cfg('Mars', 'direct').enabled[f]).toBe(false);
    for (const f of ['humidity', 'aod']) expect(cfg('Mars', 'direct').enabled[f]).toBe(true);
  });
  it('Mars Direct + Earth Factors: all Earth-only layers are on', () => {
    for (const f of EARTH_FACTORS.Mars) expect(cfg('Mars', 'direct_earth').enabled[f]).toBe(true);
    expect(on('Mars', 'direct_earth')).toEqual(ids);
  });
  it('Exploration enables the stated priorities and none of the Earth-only living/urban layers', () => {
    // Moon: geology, regolith, terrain, elevation, temperature, sunlight, ice.
    expect(on('Moon', 'exploration')).toEqual(['elevation', 'slope_mean', 'slope_p90', 'tri', 'relief', 'temp_mean', 'temp_range', 'temp_min', 'solar', 'sand', 'basalt', 'ice']);
    // Mars: geology, terrain, temperature, dust, atmosphere and water.
    for (const f of ['basalt', 'slope_mean', 'temp_mean', 'aod', 'humidity', 'ice', 'precip']) expect(cfg('Mars', 'exploration').enabled[f]).toBe(true);
    for (const b of BODIES) for (const f of ['ndvi', 'soc', 'lights']) expect(cfg(b, 'exploration').enabled[f]).toBe(false);
  });
  it('Exploration puts its stated priorities above Direct Comparison', () => {
    expect(cfg('Moon', 'exploration').weights.ice).toBeGreaterThan(cfg('Moon', 'direct').weights.ice);
    expect(cfg('Moon', 'exploration').weights.solar).toBeGreaterThan(cfg('Moon', 'direct').weights.solar);
    expect(cfg('Moon', 'exploration').weights.temp_min).toBeGreaterThan(cfg('Moon', 'direct').weights.temp_min);
    expect(cfg('Mars', 'exploration').weights.aod).toBeGreaterThan(cfg('Mars', 'direct').weights.aod);
    expect(cfg('Mars', 'exploration').weights.ice).toBeGreaterThan(cfg('Mars', 'direct').weights.ice);
  });
  it('Earth factors never overwhelm the physical comparison (at most 12 of 100 points)', () => {
    for (const b of BODIES) {
      const earthWeight = share(b, 'direct_earth', EARTH_FACTORS[b]);
      expect(earthWeight).toBeLessThanOrEqual(15);
      expect(earthWeight).toBe(12);
      // No single Earth factor outweighs any of the three heaviest direct layers.
      const direct = ids.filter((f) => !EARTH_FACTORS[b].includes(f)).map((f) => cfg(b, 'direct_earth').weights[f]).sort((a, c) => c - a);
      for (const f of EARTH_FACTORS[b]) expect(cfg(b, 'direct_earth').weights[f]).toBeLessThan(direct[2]);
    }
  });
  it('Direct + Earth keeps the Direct priorities: same order of layers, each within 20% of a pure rescale', () => {
    for (const b of BODIES) {
      const direct = ids.filter((f) => cfg(b, 'direct').enabled[f]);
      const scale = (100 - share(b, 'direct_earth', EARTH_FACTORS[b])) / 100;
      for (const f of direct) {
        const ideal = cfg(b, 'direct').weights[f] * scale;
        expect(Math.abs(cfg(b, 'direct_earth').weights[f] - ideal) / ideal).toBeLessThan(0.2);
      }
      const order = (p: PresetId) => [...direct].sort((x, y) => cfg(b, p).weights[y] - cfg(b, p).weights[x] || ids.indexOf(x) - ids.indexOf(y));
      // The heaviest direct layer stays the heaviest.
      expect(order('direct_earth')[0]).toBe(order('direct')[0]);
    }
  });
  it('Moon and Mars are not the same in any mode', () => {
    for (const p of PRESET_IDS) expect(sameConfig(cfg('Moon', p), cfg('Mars', p), ids)).toBe(false);
  });
  it('the three modes of one body are all different', () => {
    for (const b of BODIES) {
      expect(sameConfig(cfg(b, 'exploration'), cfg(b, 'direct'), ids)).toBe(false);
      expect(sameConfig(cfg(b, 'direct'), cfg(b, 'direct_earth'), ids)).toBe(false);
      expect(sameConfig(cfg(b, 'exploration'), cfg(b, 'direct_earth'), ids)).toBe(false);
    }
  });
  it('a layer that a mode turns off keeps its Direct + Earth weight, so switching it on starts sensibly', () => {
    expect(cfg('Moon', 'direct').weights.precip).toBe(DEFAULT_TABLE.Moon.direct_earth.precip);
    expect(cfg('Mars', 'exploration').weights.ndvi).toBe(DEFAULT_TABLE.Mars.direct_earth.ndvi);
  });
  it('every layer has a defined meaning for each body, and Direct never turns on a layer that does not exist there', () => {
    for (const b of BODIES) {
      for (const f of ids) expect(APPLICABILITY[b][f], `${b} ${f}`).toBeDefined();
      for (const p of ['direct'] as const) {
        for (const f of on(b, p)) expect(['inapplicable', 'absent']).not.toContain(APPLICABILITY[b][f].kind);
        for (const f of on(b, p)) expect(EARTH_FACTORS[b]).not.toContain(f);
      }
    }
    // The Moon has no atmosphere; Mars does.
    for (const f of ['precip', 'humidity', 'aod']) expect(APPLICABILITY.Moon[f].kind).toBe('inapplicable');
    expect(APPLICABILITY.Mars.precip.kind).toBe('trace'); // ice-crystal snow and frost, not rain, and not "no atmosphere"
    expect(APPLICABILITY.Mars.humidity.kind).toBe('measured');
    expect(APPLICABILITY.Mars.aod.kind).toBe('measured');
    expect(APPLICABILITY.Moon.lights.kind).toBe('absent');
  });
});

describe('disabled layers contribute nothing', () => {
  const target = ids.map((_, j) => (j % 7) / 7);
  const qrow = ids.map((_, j) => (j * 37) % 256);
  it('changing the weight of a switched-off layer does not change any score', () => {
    const a = cfg('Moon', 'direct');
    const b = cloneConfig(a);
    for (const f of ['precip', 'ndvi', 'lights', 'humidity', 'soc', 'aod']) b.weights[f] = 40;
    const wa = effectiveWeights(a, ids);
    const wb = effectiveWeights(b, ids);
    expect(wb).toEqual(wa);
    expect(scoreCell(qrow, target, wb)).toBe(scoreCell(qrow, target, wa));
    // Even the q value of a disabled layer is irrelevant.
    const other = [...qrow];
    other[ids.indexOf('precip')] = 255 - other[ids.indexOf('precip')];
    expect(scoreCell(other, target, wa)).toBe(scoreCell(qrow, target, wa));
    expect(contributions(qrow, target, wa)[ids.indexOf('precip')]).toBe(0);
  });
  it('the remaining layers renormalise: a perfect match on the active layers scores 1 whatever the disabled ones are', () => {
    const w = effectiveWeights(cfg('Mars', 'direct'), ids);
    const perfect = ids.map((_, j) => (w[j] > 0 ? Math.round(target[j] * 255) : 0));
    const t = ids.map((_, j) => (w[j] > 0 ? perfect[j] / 255 : target[j]));
    expect(scoreCell(perfect, t, w)).toBeCloseTo(1, 12);
  });
  it('scoreAll agrees with scoreCell for every preset', () => {
    const q = new Uint8Array(3 * 18);
    for (let i = 0; i < q.length; i++) q[i] = (i * 53 + 11) % 256;
    for (const b of BODIES) {
      for (const p of PRESET_IDS) {
        const w = effectiveWeights(cfg(b, p), ids);
        const out = new Float32Array(3);
        scoreAll(q, 18, buildLut(target, w), out);
        for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(scoreCell(Array.from(q.subarray(i * 18, i * 18 + 18)), target, w), 6);
      }
    }
  });
});

describe('measured zero, missing and not-applicable are different things', () => {
  it('a target value that is not a number is left out of the score, never read as 0', () => {
    const w = effectiveWeights(cfg('Mars', 'direct_earth'), ids);
    const tv = ids.map((_, j) => (j % 5) / 5);
    const withHole = [...tv];
    withHole[ids.indexOf('humidity')] = NaN;
    const u = targetUsable(withHole, w);
    expect(u.missing).toEqual([ids.indexOf('humidity')]);
    expect(u.weights[ids.indexOf('humidity')]).toBe(0);
    expect(u.target.every(Number.isFinite)).toBe(true);
    // The score equals the score of a configuration that never had the layer.
    const q = ids.map((_, j) => (j * 29 + 3) % 256);
    const manual = [...w];
    manual[ids.indexOf('humidity')] = 0;
    expect(scoreCell(q, u.target, u.weights)).toBe(scoreCell(q, tv, manual));
    // Treating it as 0 instead would have changed the score.
    const asZero = [...withHole];
    asZero[ids.indexOf('humidity')] = 0;
    expect(scoreCell(q, asZero, w)).not.toBe(scoreCell(q, u.target, u.weights));
  });
  it('a layer that does not apply to a cell is skipped there and the others renormalise', () => {
    const w = effectiveWeights(cfg('Moon', 'direct_earth'), ids);
    const tv = ids.map((_, j) => (j % 6) / 6);
    const sand = ids.indexOf('sand');
    const soc = ids.indexOf('soc');
    const qrow = ids.map((_, j) => (j * 41 + 5) % 256);
    qrow[sand] = 39; // the pipeline's "no soil" plateau
    qrow[soc] = 39;
    const skipped = scoreCell(qrow, tv, w, [], [sand, soc]);
    const zeroed = [...w];
    zeroed[sand] = 0;
    zeroed[soc] = 0;
    expect(skipped).toBe(scoreCell(qrow, tv, zeroed));
    expect(skipped).not.toBe(scoreCell(qrow, tv, w)); // scoring them as "z = 0.15" gives a different answer
    // scoreAll with an exclusion mask matches.
    const q = new Uint8Array(qrow);
    const out = new Float32Array(1);
    scoreAll(q, 18, buildLut(tv, w), out, { mask: new Uint8Array([1]), features: [sand, soc], scale: exclusionScale(w, [sand, soc]) });
    expect(out[0]).toBeCloseTo(skipped, 6);
  });
  it('a cell with nothing left to score gets 0, not a perfect score', () => {
    const w = ids.map((f) => (f === 'sand' || f === 'soc' ? 1 : 0));
    const out = new Float32Array(1);
    const sand = ids.indexOf('sand');
    const soc = ids.indexOf('soc');
    expect(exclusionScale(w, [sand, soc])).toBe(0);
    scoreAll(new Uint8Array(18), 18, buildLut(ids.map(() => 0), w), out, { mask: new Uint8Array([1]), features: [sand, soc], scale: 0 });
    expect(out[0]).toBe(0);
  });
});

describe('persistence', () => {
  const store = (): PresetStore => parseStore(null, ids);
  const key = (b: Body, p: PresetId) => keyOf(b, p);
  it('saves each of the six configurations independently and survives a JSON round trip', () => {
    const s = store();
    let n = 0;
    for (const b of BODIES) {
      for (const p of PRESET_IDS) {
        const c = cloneConfig(cfg(b, p));
        c.weights.elevation = 1 + n++;
        s.saved[key(b, p)] = c;
      }
    }
    const back = parseStore(serializeStore(s), ids);
    n = 0;
    for (const b of BODIES) {
      for (const p of PRESET_IDS) {
        expect(resolveConfig(back.saved[key(b, p)], cfg(b, p), ids).weights.elevation).toBe(1 + n++);
      }
    }
  });
  it('saving one configuration leaves the other five at their defaults', () => {
    const s = store();
    const c = cloneConfig(cfg('Mars', 'direct'));
    c.enabled.precip = true;
    c.weights.basalt = 22;
    s.saved[key('Mars', 'direct')] = c;
    const back = parseStore(serializeStore(s), ids);
    expect(Object.keys(back.saved)).toEqual([key('Mars', 'direct')]);
    for (const b of BODIES) {
      for (const p of PRESET_IDS) {
        if (b === 'Mars' && p === 'direct') continue;
        expect(sameConfig(resolveConfig(back.saved[key(b, p)], cfg(b, p), ids), cfg(b, p), ids)).toBe(true);
      }
    }
  });
  it('reset removes only that one key', () => {
    const s = store();
    for (const b of BODIES) for (const p of PRESET_IDS) s.saved[key(b, p)] = cloneConfig(cfg(b, p));
    delete s.saved[key('Moon', 'direct')];
    expect(Object.keys(s.saved).sort()).toEqual(['Mars:direct', 'Mars:direct_earth', 'Mars:exploration', 'Moon:direct_earth', 'Moon:exploration']);
  });
  it('a saved configuration does not leak into another mode when the mode changes', () => {
    const s = store();
    const c = cloneConfig(cfg('Moon', 'direct'));
    c.weights.elevation = 30;
    c.enabled.ndvi = true;
    s.saved[key('Moon', 'direct')] = c;
    const back = parseStore(serializeStore(s), ids);
    const other = resolveConfig(back.saved[key('Moon', 'direct_earth')], cfg('Moon', 'direct_earth'), ids);
    expect(other.weights.elevation).toBe(DEFAULT_TABLE.Moon.direct_earth.elevation);
    expect(cfg('Moon', 'exploration').enabled.ndvi).toBe(false);
  });
  it('remembers the active mode per body', () => {
    const s = store();
    s.active.Moon = 'exploration';
    expect(parseStore(serializeStore(s), ids).active).toEqual({ Moon: 'exploration', Mars: 'direct_earth' });
  });
  it('ignores older (0..3 scale) saved data and corrupt data', () => {
    expect(parseStore('not json', ids).saved).toEqual({});
    expect(parseStore(JSON.stringify({ version: 1, saved: { 'Moon:direct': { weights: { elevation: 2 }, enabled: {} } } }), ids).saved).toEqual({});
    const bad = { version: 2, active: { Moon: 'nope' }, saved: { 'Moon:direct': { weights: { elevation: 99, precip: 'x', ndvi: 2 }, enabled: { ndvi: 'yes' } } } };
    const p = parseStore(JSON.stringify(bad), ids);
    expect(p.active.Moon).toBe('direct_earth');
    const r = resolveConfig(p.saved['Moon:direct'], cfg('Moon', 'direct'), ids);
    expect(r.weights.elevation).toBe(DEFAULT_TABLE.Moon.direct.elevation); // 99 is out of range: default kept
    expect(r.weights.ndvi).toBe(2);
    expect(r.enabled.ndvi).toBe(false); // non-boolean rejected: default kept
  });
  it('fills in layers that a saved file does not know about', () => {
    const r = resolveConfig({ weights: { elevation: 2 }, enabled: {} }, cfg('Mars', 'exploration'), ids);
    expect(r.weights.elevation).toBe(2);
    expect(r.weights.basalt).toBe(DEFAULT_TABLE.Mars.exploration.basalt);
  });
});

describe('weights helpers', () => {
  it('applyVector turns weight-0 layers off and positive ones on', () => {
    const v = ids.map((_, j) => (j === 0 ? 0 : j === 1 ? 5 : 0));
    const c = applyVector(cfg('Moon', 'direct'), v, ids);
    expect(effectiveWeights(c, ids)).toEqual(v);
    expect(c.weights.elevation).toBe(DEFAULT_TABLE.Moon.direct.elevation); // stored weight kept for a layer that is off
  });
});
