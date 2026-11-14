import { describe, expect, it } from 'vitest';
import { cameraMoved, changedSettings, groupTargets, SETTING_KEYS, type TourSnapshot } from '../src/ui/tourState';
import { GUIDE_STEPS, type GuideContext } from '../src/ui/tourSteps';

const snap = (): TourSnapshot => ({
  t: 2, weights: [1, 0.5, 3], filters: [{ id: 'ice', on: true, tau: 0.5 }], alpha: 0.2,
  geography: { countries: ['ZA'], regions: ['africa'] }, region: 'world', projection: 'globe', basemap: 'dark',
  stretchLow: 0.5, hideBelow: false, opacity: 0.85, leftTab: 'filters', rightTab: 'disc', leftOpen: true, rightOpen: false,
  site: { lat: 1, lon: 2 }, focus: true, planetOpen: false, camera: { lng: 10, lat: 20, zoom: 1.6, bearing: 0, pitch: 0 }, hash: '#t=x',
});

const ctx: GuideContext = {
  nCells: 2143220, nFeatures: 18, nTargets: 6, nAnalogs: 30, nDiscoveries: 10, noveltyKm: 2000,
  moon: ['South Pole', 'Mare / lava tube'], mars: ['Jezero', 'Gale'], proxies: ['Light pollution'], regionName: null,
};

describe('tour snapshot', () => {
  it('reports no changed settings for an identical copy', () => {
    expect(changedSettings(structuredClone(snap()), snap())).toEqual([]);
  });
  it('names every setting that differs and ignores view-only fields', () => {
    const cur = { ...snap(), alpha: 0.4, weights: [1, 0.5, 2], filters: [{ id: 'ice', on: false, tau: 0.5 }], leftTab: 'view' as const, rightOpen: true, hash: '#t=y' };
    expect(changedSettings(cur, snap())).toEqual(['weights', 'filters', 'alpha']);
  });
  it('covers every user setting', () => {
    expect(SETTING_KEYS).toEqual(['t', 'weights', 'filters', 'alpha', 'geography', 'region', 'projection', 'basemap', 'stretchLow', 'hideBelow', 'opacity']);
  });
  it('treats rounding noise as an unmoved camera', () => {
    const c = snap().camera;
    expect(cameraMoved({ ...c, lng: c.lng + 1e-6, zoom: c.zoom + 1e-4 }, c)).toBe(false);
    expect(cameraMoved({ ...c, zoom: c.zoom + 0.5 }, c)).toBe(true);
  });
  it('groups targets by body', () => {
    expect(groupTargets([{ body: 'Moon', short: 'A' }, { body: 'Mars', short: 'B' }, { body: 'Moon', short: 'C' }])).toEqual({ moon: ['A', 'C'], mars: ['B'] });
  });
});

describe('guided tour steps', () => {
  const live = { dossierOpen: false, found: true, narrow: false };
  it('has unique ids and non-empty text for every step', () => {
    expect(new Set(GUIDE_STEPS.map((s) => s.id)).size).toBe(GUIDE_STEPS.length);
    for (const s of GUIDE_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.paras(ctx, live).every((p) => p.length > 0)).toBe(true);
    }
  });
  it('takes counts from the loaded data, not constants', () => {
    const intro = GUIDE_STEPS[0].paras({ ...ctx, nCells: 1234 }, live).join(' ');
    expect(intro).toContain('1,234 land cells');
    expect(intro).toContain('6 Moon and Mars target sites');
  });
  it('mentions the region limit only when one is active', () => {
    const geo = GUIDE_STEPS.find((s) => s.id === 'geography')!;
    expect(geo.paras(ctx, live).join(' ')).not.toContain('region limit');
    expect(geo.paras({ ...ctx, regionName: 'southern Africa' }, live).join(' ')).toContain('southern Africa only');
  });
  it('offers the example only on steps that need an open location, and explains a closed one', () => {
    const loc = GUIDE_STEPS.find((s) => s.id === 'location')!;
    expect(loc.actions).toContain('example');
    expect(loc.paras(ctx, live)[0]).toContain('No location is open');
    expect(loc.paras(ctx, { ...live, dossierOpen: true })[0]).not.toContain('No location is open');
  });
  it('never asks the tour to change settings', () => {
    // Prep may only open panels or switch tabs; nothing names a target, weight, filter or camera.
    for (const s of GUIDE_STEPS) {
      for (const k of Object.keys(s.prep ?? {})) expect(['left', 'right', 'clear', 'guide']).toContain(k);
    }
  });
});
