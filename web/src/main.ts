import './style.css';
import { inject } from '@vercel/analytics';
import { loadDataset, type Dataset } from './data';
import { createMap, type MapApi } from './map';
import { cssGradient, infernoRgb } from './colormap';
import { zThresholdFromValue } from './scoring';
import { esc, flag, fmtKm, fmtLatLon, fmtValue, GROUP_COLORS } from './format';
import { renderDossier, hideDossier, planetOpen, setPlanetOpen } from './ui/dossier';
import { fingerprint } from './ui/fingerprint';
import { renderAbout } from './about';
import { buildHash, copyText, parseHash, type LinkState } from './links';
import { renderDiscoveries } from './ui/discoveries';
import { createTour } from './ui/tour';
import { groupTargets, type LeftTab, type RightTab, type TourSnapshot } from './ui/tourState';
import { REGIONS as GEO_REGIONS, matchesGeography, validRegion, type RegionId } from './geography';
import { validWeightVector } from './population';
import { applyPrefs, initSettings, toggleTheme } from './settings';
import {
  APPLICABILITY, BODIES, PRESETS, STORAGE_KEY, WEIGHT_MAX, WEIGHT_MIN, WEIGHT_STEP, applyVector, cloneConfig, defaultConfig,
  effectiveWeights, isEarthFactor, isPresetId, keyOf, parseStore, presetInfo, resolveConfig, sameConfig, serializeStore,
  targetUsable, weightShares, DEFAULT_ACTIVE,
  type Body, type PresetConfig, type PresetId,
} from './presets';
import { initStart, rememberMode, type UiMode } from './start';
import { createSimple } from './ui/simple';
import { parseCoords } from './coords';
import type { CellInfo, Discovery, KnownAnalog, ScoreRequest, ScoreResult, Site, Target } from './types';

export const REGIONS: Record<string, { name: string; bbox: [number, number, number, number] }> = {
  safrica: { name: 'southern Africa', bbox: [11.0, -35.5, 33.0, -16.5] },
};

interface FilterState {
  id: string; // feature id
  label: string;
  on: boolean;
  tau: number;
  step: number;
}

interface GeographyState {
  countries: string[];
  regions: RegionId[];
}

export interface AppState {
  t: number;
  weights: number[];
  filters: FilterState[];
  alpha: number;
  stretchLow: number;
  hideBelow: boolean;
  opacity: number;
  basemap: 'satellite' | 'dark';
  projection: 'globe' | 'mercator';
  region: string; // 'world' or a key of REGIONS
  geography: GeographyState;
}

export interface App {
  ds: Dataset;
  state: AppState;
  map: MapApi;
  target(): Target;
  lastResult: ScoreResult | null;
  percentileOf(score: number): number;
  requestCell(lat: number, lon: number): Promise<CellInfo | null>;
  countryName(i: number): { name: string; iso: string };
  nearestAnalog(lat: number, lon: number): { name: string; km: number };
  /** URL of the current view (optionally pointing at a site). */
  linkFor(site?: { lat: number; lon: number }): string;
  copyLink(site?: { lat: number; lon: number }): void;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function setProgress(loaded: number, total: number, label: string) {
  const p = total > 0 ? (loaded / total) * 100 : 0;
  $('#progress-bar').style.width = `${p.toFixed(1)}%`;
  $('#progress-label').textContent = `${label} · ${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`;
}

function toast(msg: string, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  window.clearTimeout((toast as unknown as { h: number }).h);
  (toast as unknown as { h: number }).h = window.setTimeout(() => t.classList.add('hidden'), ms);
}

async function main() {
  // Initialize Vercel Analytics
  inject();
  
  // Appearance and the start screen come first so they work while the data streams in.
  applyPrefs();
  const settings = initSettings();
  // Simple Mode is a presentation layer over this same app. A link with ui=simple opens it directly.
  let uiReady = false;
  let wantedMode: UiMode = parseHash(location.hash).ui === 'simple' ? 'simple' : 'normal';
  document.body.classList.toggle('simple', wantedMode === 'simple');
  const start = initStart((from) => settings.open(from), (mode) => {
    wantedMode = mode;
    if (uiReady) setUiMode(mode);
    else document.body.classList.toggle('simple', mode === 'simple');
  });
  document.getElementById('btn-start')!.onclick = () => start.show();
  // The map (and the known analog sites) appear while the 30 MB grid streams in.
  const mapApi = createMap($('#map'));
  let ds: Dataset;
  try {
    ds = await loadDataset(setProgress, (m) => {
      $('#ls-meta').classList.add('done');
      void mapApi.ready.then(() => mapApi.setAnalogs(m.analogs));
    });
    $('#ls-grid').classList.add('done');
  } catch (e) {
    $('#progress-label').textContent = `Failed to load data: ${(e as Error).message}`;
    throw e;
  }
  const { meta, targets } = ds;
  const F = meta.n_features;
  const featIndex = (id: string) => meta.features.findIndex((f) => f.id === id);

  // ---------------------------------------------------------------- worker
  $('#progress-label').textContent = 'Preparing the scoring engine';
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const workerReady = new Promise<void>((resolve) => {
    const h = (ev: MessageEvent) => {
      if (ev.data.type === 'ready') {
        worker.removeEventListener('message', h);
        resolve();
      }
    };
    worker.addEventListener('message', h);
  });
  worker.postMessage(
    {
      type: 'init', features: ds.features, cells: ds.cells, countries: ds.countries, nFeatures: F,
      nLon: meta.grid.n_lon, nLat: meta.grid.n_lat, res: meta.grid.res,
      analogs: ds.analogs.map((a) => ({ lat: a.lat, lon: a.lon })), noveltySaturationKm: meta.novelty_saturation_km,
      noSoil: { features: ['sand', 'soc'].map(featIndex).filter((j) => j >= 0), breakpoints: ['sand', 'soc'].filter((id) => featIndex(id) >= 0).map((id) => meta.features[featIndex(id)].breakpoints) },
    },
    [ds.features, ds.cells, ds.countries],
  );

  // ---------------------------------------------------------------- state
  const bp = (id: string, p: number) => meta.features[featIndex(id)].breakpoints[p];
  const link: LinkState = parseHash(location.hash);
  // Simple Mode on/off. While on, the scoring weights are the shipped default mode and the advanced settings
  // are at their defaults; the user's saved modes, weights and filters are kept untouched and come back on exit.
  const ui = { simple: link.ui === 'simple' };
  const t0 = Math.max(0, targets.targets.findIndex((t) => t.id === link.t));
  // ---- scoring presets: one saved/working configuration per body and mode (src/presets.ts)
  const featureIds = meta.features.map((f) => f.id);
  const defaultOf = (body: Body, id: PresetId) => defaultConfig(body, id, featureIds);
  const readStore = () => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  };
  const store = parseStore(readStore(), featureIds);
  /** Edits not yet saved. Switching presets keeps them, so nothing is lost by looking at another mode. */
  const working = new Map<string, PresetConfig>();
  const savedOf = (body: Body, id: PresetId) => resolveConfig(store.saved[keyOf(body, id)], defaultOf(body, id), featureIds);
  const workingOf = (body: Body, id: PresetId) => {
    const k = keyOf(body, id);
    if (!working.has(k)) working.set(k, savedOf(body, id));
    return working.get(k)!;
  };
  const isDirty = (body: Body, id: PresetId) => !sameConfig(workingOf(body, id), savedOf(body, id), featureIds);
  const bodyOf = (t: Target) => t.body as Body;
  const engineWeights = (body: Body) =>
    ui.simple ? effectiveWeights(defaultOf(body, DEFAULT_ACTIVE), featureIds) : effectiveWeights(workingOf(body, store.active[body]), featureIds);
  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeStore(store));
      return true;
    } catch {
      return false;
    }
  };
  const state: AppState = {
    t: t0,
    weights: engineWeights(bodyOf(targets.targets[t0])),
    filters: [
      { id: 'ndvi', label: 'Exclude vegetation: NDVI >', on: false, tau: 0.35, step: 0.05 },
      { id: 'ice', label: 'Exclude ice cover: fraction >', on: false, tau: 0.5, step: 0.05 },
      { id: 'lights', label: 'Exclude lit areas: lights >', on: false, tau: +bp('lights', 90).toPrecision(2), step: 0.1 },
      { id: 'slope_p90', label: 'Exclude steep: slope p90 >', on: false, tau: 25, step: 1 },
    ],
    alpha: 0,
    stretchLow: 0.5,
    hideBelow: false,
    opacity: 0.85,
    basemap: link.b ?? 'satellite',
    projection: link.p ?? 'mercator',
    region: link.r && REGIONS[link.r] ? link.r : 'world',
    geography: {
      countries: ui.simple ? [] : [...new Set((link.c ?? []).filter((iso) => meta.countries.some((c) => c.iso === iso)))],
      regions: [...new Set((link.g ?? []).filter(validRegion))],
    },
  };

  let lastResult: ScoreResult | null = null;
  const pendingCells = new Map<number, (c: CellInfo | null) => void>();
  let cellReqId = 0;

  const app: App = {
    ds, state, map: mapApi,
    target: () => targets.targets[state.t],
    get lastResult() {
      return lastResult;
    },
    percentileOf(score: number) {
      if (!lastResult) return NaN;
      const h = lastResult.hist;
      const bin = Math.round(score * (h.length - 1));
      let below = 0;
      let total = 0;
      for (let i = 0; i < h.length; i++) {
        total += h[i];
        if (i < bin) below += h[i];
        else if (i === bin) below += h[i] / 2;
      }
      return total ? below / total : NaN;
    },
    requestCell(lat: number, lon: number) {
      if (!(lat >= -90 && lat <= 90) || !Number.isFinite(lon)) return Promise.resolve(null);
      const r = Math.min(meta.grid.n_lat - 1, Math.floor((90 - lat) / meta.grid.res)); // lat -90 is the last row
      const c = Math.floor((((lon + 180) % 360) + 360) % 360 / meta.grid.res) % meta.grid.n_lon; // lon 180 = -180
      const id = ++cellReqId;
      return new Promise((resolve) => {
        pendingCells.set(id, resolve);
        worker.postMessage({ type: 'cell', id, gridIndex: r * meta.grid.n_lon + c });
      });
    },
    countryName: (i: number) => meta.countries[i] || { name: '', iso: '' },
    nearestAnalog(lat: number, lon: number) {
      let best = { name: '', km: Infinity };
      for (const a of ds.analogs) {
        const R = Math.PI / 180;
        const h = Math.sin(((a.lat - lat) * R) / 2) ** 2 + Math.cos(lat * R) * Math.cos(a.lat * R) * Math.sin(((a.lon - lon) * R) / 2) ** 2;
        const km = 2 * 6371.0088 * Math.asin(Math.sqrt(h));
        if (km < best.km) best = { name: a.name, km };
      }
      return best;
    },
    linkFor(site) {
      const url = new URL(location.href);
      url.hash = buildHash(linkState(site ?? (current ? { lat: current.lat, lon: current.lon } : undefined)));
      return url.toString();
    },
    copyLink(site) {
      void copyText(app.linkFor(site)).then((ok) => toast(ok ? 'Link copied: it opens exactly this view.' : 'Could not copy; the link is in the address bar.'));
    },
  };

  // ---------------------------------------------------------------- deep links
  function linkState(site?: { lat: number; lon: number }): LinkState {
    const t = app.target();
    if (ui.simple) {
      // Simple Mode shares only what the user chose: target, region, place and map view.
      const c = mapApi.map.getCenter();
      return {
        t: t.id, ui: 'simple', g: state.geography.regions.length ? state.geography.regions : undefined,
        r: state.region, v: { lat: c.lat, lon: c.lng, zoom: mapApi.map.getZoom() }, s: site, p: state.projection, b: state.basemap,
      };
    }
    const mode = store.active[bodyOf(t)];
    const on = state.filters.filter((f) => f.on).map((f) => ({ id: f.id, tau: f.tau }));
    const def = (t.default_filters || []).map((f) => ({ id: f.feature, tau: f.max }));
    const fChanged = JSON.stringify(on) !== JSON.stringify(def);
    const c = mapApi.map.getCenter();
    return {
      // Weights always travel with the link: the recipient may have saved their own weights for this mode.
      t: t.id, m: mode, w: state.weights, f: fChanged ? on : undefined, a: state.alpha || undefined,
      c: state.geography.countries.length ? state.geography.countries : undefined,
      g: state.geography.regions.length ? state.geography.regions : undefined,
      r: state.region, v: { lat: c.lat, lon: c.lng, zoom: mapApi.map.getZoom() }, s: site,
      p: state.projection, b: state.basemap,
    };
  }
  let hashTimer = 0;
  function updateHash() {
    window.clearTimeout(hashTimer);
    hashTimer = window.setTimeout(() => {
      history.replaceState(null, '', buildHash(linkState(current ? { lat: current.lat, lon: current.lon } : undefined)));
    }, 150);
  }

  // ---------------------------------------------------------------- scoring loop
  /** Grid indices of the target's known analogs, so the worker can report how well the current weights rank them. */
  function validationCells(t: Target): number[] {
    const out: number[] = [];
    for (const id of t.validation ?? []) {
      const a = ds.analogs.find((x) => x.id === id);
      if (!a) continue;
      const r = Math.floor((90 - a.lat) / meta.grid.res);
      const c = Math.floor((a.lon + 180) / meta.grid.res);
      if (r >= 0 && r < meta.grid.n_lat && c >= 0 && c < meta.grid.n_lon) out.push(r * meta.grid.n_lon + c);
    }
    return out;
  }
  let reqId = 0;
  let inFlight = false;
  let dirty = false;
  function buildRequest(): ScoreRequest {
    const t = app.target();
    // A target value that is not a number is missing, not zero: that layer is left out of the score.
    const use = targetUsable(t.vector, state.weights);
    return {
      type: 'score', id: ++reqId, target: use.target, weights: use.weights, check: validationCells(t),
      checkFilters: (t.default_filters || []).map((f) => ({ feature: featIndex(f.feature), zThreshold: zThresholdFromValue(meta.features[featIndex(f.feature)].breakpoints, f.max) })),
      filters: state.filters.filter((f) => f.on).map((f) => {
        const fm = meta.features[featIndex(f.id)];
        return { feature: featIndex(f.id), zThreshold: zThresholdFromValue(fm.breakpoints, f.tau) };
      }),
      alpha: state.alpha, stretchLow: state.stretchLow, hideBelow: state.hideBelow, topN: 50,
      bbox: state.region !== 'world' ? REGIONS[state.region].bbox : null,
      countryIds: selectedCountryIds(),
    };
  }
  function requestScore() {
    updateHash();
    dirty = true;
    if (!inFlight) pump();
  }
  function pump() {
    if (!dirty) return;
    dirty = false;
    inFlight = true;
    worker.postMessage(buildRequest());
  }
  worker.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data;
    if (msg.type === 'scored') {
      inFlight = false;
      lastResult = msg as ScoreResult;
      syncBadge();
      onScored(lastResult);
      pump();
    } else if (msg.type === 'score-error') {
      inFlight = false;
      toast(`Could not score with these settings: ${msg.message}`);
      pump();
    } else if (msg.type === 'cell') {
      const cb = pendingCells.get(msg.id);
      pendingCells.delete(msg.id);
      cb?.(msg.info);
    }
  });

  // ---------------------------------------------------------------- UI: target switcher
  const root = document.documentElement;
  const body = document.body;
  const siteName = (t: Target) => t.name.replace(/^(Moon|Mars) – /, '');
  const shortName = (t: Target) => siteName(t).replace(/\s*\(.*\)$/, '');
  const targetBtns: HTMLButtonElement[] = [];
  const nav = $('#targets');
  const select = $<HTMLSelectElement>('#target-select');
  for (const bodyName of ['Moon', 'Mars'] as const) {
    const grp = document.createElement('div');
    grp.className = 'tgroup';
    grp.innerHTML = `<span class="eyebrow">${bodyName}</span>`;
    const og = document.createElement('optgroup');
    og.label = bodyName;
    targets.targets.forEach((t, i) => {
      if (t.body !== bodyName) return;
      const b = document.createElement('button');
      b.className = 'target';
      b.textContent = shortName(t);
      b.title = t.name;
      b.onclick = () => selectTarget(i);
      targetBtns[i] = b;
      grp.appendChild(b);
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = siteName(t);
      og.appendChild(o);
    });
    nav.appendChild(grp);
    select.appendChild(og);
  }
  select.onchange = () => selectTarget(+select.value);

  // ---------------------------------------------------------------- UI: left panel
  const left = $('#left');
  const sliders: HTMLInputElement[] = [];
  const sliderVals: HTMLElement[] = [];
  const sliderChecks: HTMLInputElement[] = [];
  const sliderPcts: HTMLElement[] = [];
  const targetLines: HTMLElement[] = [];
  const filterInputs: { flt: FilterState; cb: HTMLInputElement; num: HTMLInputElement }[] = [];
  const groups = ['Terrain', 'Climate', 'Surface', 'Remoteness'] as const;
  const fmtW = (w: number) => w.toFixed(2).replace(/\.?0+$/, '');
  /** Paint the filled part of a range input (CSS reads --v). */
  const fill = (el: HTMLInputElement) => el.style.setProperty('--v', `${((+el.value - +el.min) / (+el.max - +el.min)) * 100}%`);

  function applyDefaultFilters(t: Target) {
    // Each target may switch on default hard filters (non-ice targets exclude ice sheets).
    const ice = state.filters.find((f) => f.id === 'ice')!;
    const d = (t.default_filters || []).find((f) => f.feature === 'ice');
    ice.on = !!d;
    if (d) ice.tau = d.max;
    for (const fi of filterInputs) {
      fi.cb.checked = fi.flt.on;
      fi.num.value = String(fi.flt.tau);
    }
    syncFilterCount();
  }
  function syncFilterCount() {
    const n = state.filters.filter((f) => f.on).length + (state.alpha > 0 ? 1 : 0) +
      state.geography.countries.length + state.geography.regions.length;
    $('#tab-filters-n').textContent = n ? String(n) : '';
    $('#mnav-ctrl-n').textContent = n ? String(n) : ''; // the same count, on the mobile Controls button
  }
  /** Left/Right arrow keys move between the tabs of a tab bar (the click handler does the switching). */
  function tabArrowKeys(btns: NodeListOf<HTMLButtonElement>) {
    btns.forEach((b, i) => {
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        e.stopPropagation(); // keep the guided tour's arrow-key stepping from also firing
        const next = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
        next.focus();
        next.click();
      });
    });
  }
  const countryOptions = [...new Map(
    meta.countries
      .map((country, id) => ({ ...country, id }))
      .filter((country) => country.id > 0 && /^[A-Z]{2}$/.test(country.iso) && country.name)
      .map((country) => [country.iso, country]),
  ).values()].sort((a, b) => a.name.localeCompare(b.name));

  function selectedCountryIds(): number[] | null {
    if (!state.geography.countries.length && !state.geography.regions.length) return null;
    return meta.countries.reduce<number[]>((ids, country, id) => {
      if (matchesGeography(country.iso, state.geography.countries, state.geography.regions)) ids.push(id);
      return ids;
    }, []);
  }

  let setAlphaUI: (a: number) => void = () => {};
  // Repaint hooks used when the tour puts a snapshot back (set inside buildLeft).
  let syncGeoUI: () => void = () => {};
  let syncViewUI: () => void = () => {};
  function buildLeft() {
    const synth = meta.synthetic_features;
    left.innerHTML = `
      <div class="brief">
        <div class="brief-top">
          <div><div class="eyebrow" id="t-eyebrow"></div><h1 id="t-name"></h1></div>
          <div id="t-glyph"></div>
        </div>
        <button class="mode-chip" id="mode-chip" type="button" title="Change the scoring mode and weights in Settings"></button>
        <p id="t-blurb" class="clamp"></p>
        <button class="text-btn" id="t-more" aria-expanded="false" hidden>More</button>
        <div class="evidence" id="evidence-row">
          <button class="vbadge" id="t-valid" title="How well do known analogs score? Click for the method."></button>
          <div class="ev-links">
            <button class="text-btn" id="t-limits">Limitations</button>
            <button class="text-btn" id="best-site">Fly to the best match</button>
          </div>
        </div>
      </div>
      ${synth.length ? `<div class="warn-box"><b>${synth.length} of ${F} layers ${synth.length > 1 ? 'are placeholders' : 'is a placeholder'}</b> in this build (${synth.map((s) => esc(meta.features[featIndex(s)].name)).join(', ')}). Treat rankings as illustrative.</div>` : ''}
      ${meta.bbox ? `<div class="warn-box">Regional build: only ${meta.bbox.join(', ')} is included.</div>` : ''}
      <div class="tabs" role="tablist" aria-label="Controls">
        <button role="tab" id="tab-filters" aria-controls="pane-filters" data-tab="filters" aria-selected="true">Filters<span class="count" id="tab-filters-n"></span></button>
        <button role="tab" id="tab-view" aria-controls="pane-view" data-tab="view" aria-selected="false">View</button>
      </div>
      <div class="tab-body">
        <div class="pane" id="pane-filters" role="tabpanel" aria-labelledby="tab-filters">
          <h4>Leave out</h4>
          <p class="note">Cells past these limits score zero.</p>
          <div id="filters"></div>
          <div class="geo-filter">
            <div class="geo-head"><h4>Geography</h4><button class="text-btn" id="reset-geo">Reset</button></div>
            <p class="note">Only cells matching every selected geography remain.</p>
            <div id="geo-active" class="geo-active" aria-live="polite"></div>
            <div class="geo-section"><b>Regions</b><div id="geo-regions" class="geo-regions"></div></div>
            <div class="geo-section"><label for="geo-search"><b>Countries</b></label><input id="geo-search" class="geo-search" type="search" placeholder="Search countries" autocomplete="off"></div>
            <details class="geo-list" id="geo-list"><summary>Country list</summary><div id="geo-countries" class="geo-countries"></div></details>
          </div>
          <h4>Favour new places <span class="mono" id="alpha-val"></span></h4>
          <input type="range" id="alpha" min="0" max="0.6" step="0.02" value="${state.alpha}">
          <p class="note">Mixes in distance from the ${ds.analogs.length} known analog sites (levels off at ${meta.novelty_saturation_km.toLocaleString()} km), so candidates nobody has used yet rise.</p>
        </div>
        <div class="pane hidden" id="pane-view" role="tabpanel" aria-labelledby="tab-view">
          <div class="eyebrow pane-sec">Map</div>
          <div class="field"><span>Map shape</span><div class="seg" id="seg-proj"><button data-v="mercator">Flat</button><button data-v="globe">Globe</button></div></div>
          <div class="field"><span>Background</span><div class="seg" id="seg-base"><button data-v="satellite">Satellite</button><button data-v="dark">Plain dark</button></div></div>
          <div class="eyebrow pane-sec">Score layer</div>
          <h4>Start colour at Earth percentile <span class="mono" id="stretch-val"></span></h4>
          <input type="range" id="stretch" min="0" max="0.99" step="0.01" value="${state.stretchLow}">
          <label class="check"><input type="checkbox" id="hide-below"> Hide cells below that percentile</label>
          <h4>Score layer opacity <span class="mono" id="opacity-val"></span></h4>
          <input type="range" id="opacity" min="0.1" max="1" step="0.05" value="${state.opacity}">
        </div>
        <p class="note foot">Data built ${esc(meta.generated.slice(0, 10))} · ${meta.n_cells.toLocaleString()} land cells at ${meta.grid.res}°</p>
      </div>`;

    // tabs
    const tabBtns = left.querySelectorAll<HTMLButtonElement>('.tabs button');
    tabBtns.forEach((b) => {
      b.onclick = () => {
        tabBtns.forEach((o) => o.setAttribute('aria-selected', String(o === b)));
        for (const id of ['filters', 'view']) $(`#pane-${id}`).classList.toggle('hidden', id !== b.dataset.tab);
      };
    });
    tabArrowKeys(tabBtns);

    // brief: long blurbs are clamped to three lines; the full text stays in the DOM
    const more = $('#t-more');
    more.onclick = () => {
      const open = $('#t-blurb').classList.toggle('clamp') === false;
      more.textContent = open ? 'Less' : 'More';
      more.setAttribute('aria-expanded', String(open));
    };
    $('#t-limits').onclick = openLimits;

    $('#best-site').onclick = () => {
      const s = lastResult?.sites[0];
      if (s) selectSite(s, 0);
    };

    // filters
    const fDiv = $('#filters');
    state.filters.forEach((flt, k) => {
      const fm = meta.features[featIndex(flt.id)];
      const row = document.createElement('div');
      row.className = 'filter-row';
      const unit = fm.unit === 'fraction' ? '' : fm.unit ? ` ${fm.unit}` : '';
      const label = flt.label.replace(/^Exclude /, '').replace(/^./, (c) => c.toUpperCase());
      row.innerHTML = `<input type="checkbox" id="flt-${k}" ${flt.on ? 'checked' : ''}><label for="flt-${k}">${esc(label)}<span class="unit">${esc(unit)}</span></label><input type="number" step="${flt.step}" value="${flt.tau}" aria-label="${esc(label)} limit">`;
      const [cb, num] = row.querySelectorAll('input');
      cb.addEventListener('change', () => {
        flt.on = (cb as HTMLInputElement).checked;
        syncFilterCount();
        requestScore();
      });
      num.addEventListener('change', () => {
        flt.tau = +(num as HTMLInputElement).value;
        if (flt.on) requestScore();
      });
      filterInputs.push({ flt, cb: cb as HTMLInputElement, num: num as HTMLInputElement });
      fDiv.appendChild(row);
    });

    const geoRegions = $('#geo-regions');
    geoRegions.innerHTML = Object.entries(GEO_REGIONS)
      .map(([id, name]) => `<label class="geo-check"><input type="checkbox" data-region="${id}"><span>${name}</span></label>`)
      .join('');
    const geoCountries = $('#geo-countries');
    geoCountries.innerHTML = countryOptions
      .map((country) => `<label class="geo-option" data-name="${esc(country.name.toLocaleLowerCase())}"><input type="checkbox" class="geo-country" data-iso="${country.iso}"><span>${esc(country.name)}</span></label>`)
      .join('');
    const renderGeo = () => {
      geoRegions.querySelectorAll<HTMLInputElement>('[data-region]').forEach((input) => {
        input.checked = state.geography.regions.includes(input.dataset.region as RegionId);
      });
      geoCountries.querySelectorAll<HTMLInputElement>('.geo-country').forEach((input) => {
        input.checked = state.geography.countries.includes(input.dataset.iso!);
      });
      const chips = [
        ...state.geography.regions.map((id) => `<span class="geo-chip">${GEO_REGIONS[id]}<button type="button" data-remove-region="${id}" aria-label="Remove ${GEO_REGIONS[id]}">×</button></span>`),
        ...state.geography.countries.map((iso) => `<span class="geo-chip">${esc(meta.countries.find((c) => c.iso === iso)?.name ?? iso)}<button type="button" data-remove-country="${iso}" aria-label="Remove country">×</button></span>`),
      ];
      if (state.geography.countries.length) ($('#geo-list') as HTMLDetailsElement).open = true;
      $('#geo-active').innerHTML = chips.length ? chips.join('') : '<span class="note">No geographic restrictions</span>';
      $('#geo-active').querySelectorAll<HTMLButtonElement>('[data-remove-region]').forEach((button) => {
        button.onclick = () => {
          state.geography.regions = state.geography.regions.filter((id) => id !== button.dataset.removeRegion);
          renderGeo(); syncFilterCount(); requestScore();
        };
      });
      $('#geo-active').querySelectorAll<HTMLButtonElement>('[data-remove-country]').forEach((button) => {
        button.onclick = () => {
          state.geography.countries = state.geography.countries.filter((iso) => iso !== button.dataset.removeCountry);
          renderGeo(); syncFilterCount(); requestScore();
        };
      });
      syncFilterCount();
    };
    geoRegions.querySelectorAll<HTMLInputElement>('[data-region]').forEach((input) => {
      input.onchange = () => {
        const id = input.dataset.region as RegionId;
        state.geography.regions = input.checked
          ? [...state.geography.regions, id]
          : state.geography.regions.filter((selected) => selected !== id);
        renderGeo(); requestScore();
      };
    });
    geoCountries.querySelectorAll<HTMLInputElement>('.geo-country').forEach((input) => {
      input.onchange = () => {
        const iso = input.dataset.iso!;
        state.geography.countries = input.checked
          ? [...state.geography.countries, iso]
          : state.geography.countries.filter((selected) => selected !== iso);
        renderGeo(); requestScore();
      };
    });
    $('#geo-search').addEventListener('input', (event) => {
      const query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase();
      geoCountries.querySelectorAll<HTMLElement>('.geo-option').forEach((option) => {
        option.hidden = !!query && !option.dataset.name!.includes(query);
      });
      if (query) ($('#geo-list') as HTMLDetailsElement).open = true;
    });
    $('#geo-search').addEventListener('focus', () => (($('#geo-list') as HTMLDetailsElement).open = true));
    $('#reset-geo').onclick = () => {
      state.geography = { countries: [], regions: [] };
      renderGeo(); requestScore();
    };
    renderGeo();
    syncGeoUI = renderGeo;

    const alpha = $<HTMLInputElement>('#alpha');
    const updAlpha = () => {
      $('#alpha-val').textContent = state.alpha > 0 ? `${Math.round(state.alpha * 100)}%` : 'off';
      fill(alpha);
      syncFilterCount();
    };
    alpha.addEventListener('input', () => {
      state.alpha = +alpha.value;
      updAlpha();
      requestScore();
    });
    updAlpha();
    setAlphaUI = (a: number) => {
      state.alpha = a;
      alpha.value = String(a);
      updAlpha();
    };

    // view
    const seg = (id: string, current: () => string, set: (v: string) => void) => {
      const btns = $(`#${id}`).querySelectorAll<HTMLButtonElement>('button');
      const sync = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === current())));
      btns.forEach((b) => (b.onclick = () => {
        set(b.dataset.v!);
        sync();
      }));
      sync();
    };
    seg('seg-proj', () => state.projection, (v) => {
      state.projection = v as AppState['projection'];
      mapApi.setProjection(state.projection);
      updateHash();
    });
    seg('seg-base', () => state.basemap, (v) => {
      state.basemap = v as AppState['basemap'];
      mapApi.setBasemap(state.basemap);
      updateHash();
    });
    const stretch = $<HTMLInputElement>('#stretch');
    const updStretch = () => {
      $('#stretch-val').textContent = `p${Math.round(state.stretchLow * 100)}`;
      fill(stretch);
    };
    stretch.addEventListener('input', () => {
      state.stretchLow = +stretch.value;
      updStretch();
      requestScore();
    });
    updStretch();
    $<HTMLInputElement>('#hide-below').addEventListener('change', (e) => {
      state.hideBelow = (e.target as HTMLInputElement).checked;
      requestScore();
    });
    const op = $<HTMLInputElement>('#opacity');
    const updOp = () => {
      $('#opacity-val').textContent = `${Math.round(state.opacity * 100)}%`;
      fill(op);
    };
    op.addEventListener('input', () => {
      state.opacity = +op.value;
      updOp();
      mapApi.setOpacity(state.opacity);
    });
    updOp();
    syncViewUI = () => {
      stretch.value = String(state.stretchLow);
      updStretch();
      $<HTMLInputElement>('#hide-below').checked = state.hideBelow;
      op.value = String(state.opacity);
      updOp();
      mapApi.setOpacity(state.opacity);
      for (const id of ['seg-proj', 'seg-base']) {
        const cur = id === 'seg-proj' ? state.projection : state.basemap;
        $(`#${id}`).querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === cur)));
      }
      mapApi.setProjection(state.projection);
      mapApi.setBasemap(state.basemap);
    };
  }

  function syncTargetUI() {
    const t = app.target();
    root.dataset.body = t.body.toLowerCase();
    targetBtns.forEach((el, i) => el.setAttribute('aria-pressed', String(i === state.t)));
    select.value = String(state.t);
    $('#t-eyebrow').textContent = `${t.body} · matching against`;
    $('#t-name').textContent = siteName(t);
    $('#t-blurb').textContent = t.blurb;
    // Clamp long blurbs; short ones need no toggle. The full text is always in the DOM.
    const long = t.blurb.length > 150;
    $('#t-blurb').classList.toggle('clamp', long);
    const moreBtn = $('#t-more');
    moreBtn.hidden = !long;
    moreBtn.textContent = 'More';
    moreBtn.setAttribute('aria-expanded', 'false');
    $('#t-glyph').innerHTML = fingerprint(meta.features, t.vector, null, 64, `Fingerprint of ${t.name}: each spoke is one layer, longer means higher among Earth's land`);
    meta.features.forEach((f, j) => {
      const raw = t.raw[f.id];
      const pct = Math.round(t.vector[j] * 100);
      targetLines[j].innerHTML = raw.value === null
        ? `<span class="beyond">beyond Earth</span>`
        : raw.beyond_earth ? `${fmtValue(raw.value, f)} · <span class="beyond">beyond Earth</span>` : `${fmtValue(raw.value, f)} · p${pct}`;
      const tv = raw.value === null ? `beyond Earth's max (clamped to ${fmtValue(raw.clamped, f)})` : fmtValue(raw.value, f) + (raw.beyond_earth ? ` → clamped ${fmtValue(raw.clamped, f)}` : '');
      const lbl = document.querySelector(`#set-weights label[for="w-${f.id}"]`) as HTMLElement;
      const tip = `${f.description}\nSource: ${f.source_name}${f.synthetic ? ' (placeholder data)' : ''}\nTarget value: ${tv} (higher than ${pct}% of Earth's land)`;
      lbl.title = tip;
      targetLines[j].title = tip;
    });
    mapApi.setTargetBody(t.body);
    simple.onTarget();
    renderWeights();
    syncMode();
    syncBadge();
    updateHash();
  }

  function syncBadge() {
    const t = app.target();
    // Live: how the known analogs of this target rank under the weights in use right now. (The pipeline's
    // static table in the About page used the original per-target literature weights.)
    const v = lastResult?.check && Number.isFinite(lastResult.check.auc) ? { auc: lastResult.check.auc, median_analog_percentile: lastResult.check.medianPercentile } : undefined;
    // The same badge appears in the left brief and, compactly, above the candidate list.
    for (const b of [$('#t-valid'), $('#sites-valid')]) {
      if (!v) {
        b.classList.add('hidden');
        continue;
      }
      const cls = v.auc >= 0.85 ? 'good' : v.auc >= 0.65 ? 'fair' : 'weak';
      const word = cls === 'good' ? 'works well' : cls === 'fair' ? 'works moderately' : 'weak';
      b.className = `vbadge ${cls}`;
      b.title = 'Recomputed for the scoring mode and weights in use. Click for the method and the original validation table.';
      b.innerHTML = `<i></i><span>How well does this work? <b>AUC ${v.auc.toFixed(2)}</b> · known analogs median p${v.median_analog_percentile.toFixed(0)} · ${word}</span>`;
      b.onclick = () => {
        renderAbout(app, showPlace);
        document.getElementById(`val-${t.id}`)?.scrollIntoView({ block: 'center' });
      };
    }
  }
  /** Open the About page at "Data, references and credits" (limitations, sources, validation). */
  function openLimits() {
    renderAbout(app, showPlace);
    document.getElementById('about-ref')?.scrollIntoView({ block: 'start' });
  }

  // ---------------------------------------------------------------- weightings (Settings page)
  // The one weighting system: each (body, mode) has a working configuration; the engine's state.weights is
  // always the effective vector of the active mode for the current target's body.
  let wView: Body = bodyOf(targets.targets[t0]); // the body whose presets the Settings page is showing
  const viewId = () => store.active[wView];
  const viewCfg = () => workingOf(wView, viewId());
  const viewVec = () => effectiveWeights(viewCfg(), featureIds);
  function modeLabel(body: Body) {
    return `${presetInfo(store.active[body]).name}${isDirty(body, store.active[body]) ? ' (unsaved)' : ''}`;
  }
  function syncMode() {
    const body = bodyOf(app.target());
    const label = modeLabel(body);
    $('#mode-chip').innerHTML = `<span class="eyebrow">Scoring mode</span><b>${esc(label)}</b><span class="mode-edit">Change</span>`;
    $('#mode-chip').title = `${body} targets are scored with “${label}”. Click to change the mode or weights.`;
    $('#mode-line').textContent = `Mode: ${label}`;
  }
  function afterWeightChange(body: Body) {
    if (body === bodyOf(app.target())) {
      state.weights = engineWeights(body);
      requestScore();
    }
    renderWeights();
    syncMode();
  }
  /** Apply an edit to the configuration on show. Refuses an edit that would leave no layer scoring. */
  function editConfig(mut: (c: PresetConfig) => void) {
    const body = wView;
    const id = viewId();
    const before = cloneConfig(workingOf(body, id));
    mut(workingOf(body, id));
    if (!validWeightVector(effectiveWeights(workingOf(body, id), featureIds), F)) {
      working.set(keyOf(body, id), before);
      toast('At least one layer must stay on with a weight above zero.');
      renderWeights();
      return;
    }
    afterWeightChange(body);
  }
  /** Put a plain weight vector (shared link, tour restore) into the active mode as an unsaved edit. */
  function applyWeightVector(body: Body, vec: number[]) {
    working.set(keyOf(body, store.active[body]), applyVector(workingOf(body, store.active[body]), vec, featureIds));
    if (body === bodyOf(app.target())) state.weights = engineWeights(body);
    renderWeights();
    syncMode();
  }
  function renderWeights() {
    const body = wView;
    const id = viewId();
    const cfg = viewCfg();
    const vec = viewVec();
    const shares = weightShares(vec);
    const dirty = isDirty(body, id);
    const total = vec.reduce((a, b) => a + b, 0);
    const nOn = vec.filter((w) => w > 0).length;
    $('#wb-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === body)));
    $('#wp-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.v === id));
      b.classList.toggle('dirty', isDirty(body, b.dataset.v as PresetId));
    });
    $('#wp-blurb').textContent = presetInfo(id).blurb;
    const cur = bodyOf(app.target());
    const same = body === cur;
    $('#wp-scope').textContent = same
      ? `Scoring ${app.target().name} and every other ${body} target right now. Values under each layer name are that target's value and its Earth percentile (p0 lowest, p100 highest).`
      : `Not in use right now: you are viewing a ${cur} target. These ${body} settings apply as soon as you pick a ${body} target.`;
    $('#set-weights').classList.toggle('other-body', !same);
    $('#w-summary').innerHTML = `<b>Active weighting: ${nOn ? '100%' : '0%'}</b> across ${nOn} of ${F} layers · weights add up to ${fmtW(total)}${total === 100 ? '' : ' (shares below are out of that total)'}`;
    meta.features.forEach((f, j) => {
      const on = cfg.enabled[f.id];
      sliders[j].value = String(cfg.weights[f.id]);
      sliders[j].disabled = !on;
      sliderChecks[j].checked = on;
      sliderVals[j].textContent = fmtW(cfg.weights[f.id]);
      sliderPcts[j].textContent = vec[j] > 0 ? `${shares[j] >= 10 ? shares[j].toFixed(0) : shares[j].toFixed(1)}%` : '–';
      sliders[j].closest('.wrow')!.classList.toggle('off', vec[j] === 0);
      // What this layer means for the body being edited (see APPLICABILITY in presets.ts).
      const info = APPLICABILITY[body][f.id];
      const earth = isEarthFactor(body, f.id);
      const tag = sliders[j].closest('.wrow')!.querySelector<HTMLElement>('.ekind')!;
      tag.textContent = earth ? 'Earth-only' : '';
      tag.hidden = !earth;
      sliders[j].closest('.wrow')!.setAttribute('title', info ? `${body}: ${info.kind}. ${info.note}` : '');
      fill(sliders[j]);
    });
    for (const g of groups) {
      let sum = 0;
      let n = 0;
      meta.features.forEach((f, j) => {
        if (f.ui_group !== g) return;
        sum += vec[j];
        if (vec[j] > 0) n++;
      });
      $(`#gsum-${g}`).textContent = `${n} on · ${sum ? ((sum / total) * 100).toFixed(0) : 0}%`;
    }
    const st = $('#w-state');
    st.textContent = dirty ? 'Unsaved changes' : store.saved[keyOf(body, id)] ? 'Saved' : 'Default';
    st.classList.toggle('unsaved', dirty);
    ($('#w-save') as HTMLButtonElement).disabled = !dirty;
    ($('#w-reset') as HTMLButtonElement).disabled = !store.saved[keyOf(body, id)] && sameConfig(cfg, defaultOf(body, id), featureIds);
  }
  function buildWeightsEditor() {
    const proxies = meta.features.filter((f) => f.proxy && !f.synthetic);
    const synth = meta.synthetic_features;
    $('#set-weights').innerHTML = `
      <div class="set-row set-seg"><span id="wb-l">Planetary body</span><div class="seg" id="wb-seg" role="group" aria-labelledby="wb-l">${BODIES.map((b) => `<button type="button" data-v="${b}">${b}</button>`).join('')}</div></div>
      <div class="preset-tabs" id="wp-seg" role="group" aria-label="Scoring mode">${PRESETS.map((pr) => `<button type="button" data-v="${pr.id}"><span>${esc(pr.name)}</span><i class="dirty-dot" aria-hidden="true"></i></button>`).join('')}</div>
      <p class="note" id="wp-blurb"></p>
      <p class="note" id="wp-scope"></p>
      ${proxies.length || synth.length ? `<p class="note proxy-note" id="proxy-note">${synth.length ? `${synth.length > 1 ? 'Placeholder layers' : 'Placeholder layer'}: ${synth.map((x) => esc(meta.features[featIndex(x)].name)).join(', ')}. ` : ''}${proxies.length ? `${proxies.length > 1 ? 'Proxy layers' : 'Proxy layer'}: ${proxies.map((f) => esc(f.name)).join(', ')}.` : ''}</p>` : ''}
      <div class="w-summary" id="w-summary" aria-live="polite"></div>
      <div class="w-actions">
        <button class="btn" id="w-save" type="button">Save</button>
        <button class="btn-ghost sm" id="w-reset" type="button">Reset to default</button>
        <span class="w-state" id="w-state" role="status"></span>
        <button class="text-btn" id="w-all" type="button">Expand all</button>
      </div>
      <div id="weights"></div>`;
    $('#wb-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => {
        wView = b.dataset.v as Body;
        renderWeights();
      };
    });
    $('#wp-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => {
        store.active[wView] = b.dataset.v as PresetId;
        if (!persist()) toast('Browser storage is blocked, so the chosen mode will not be remembered after you close the page.');
        afterWeightChange(wView);
      };
    });
    const wDiv = $('#weights');
    for (const g of groups) {
      const sec = document.createElement('details');
      sec.className = 'group';
      sec.open = g === groups[0]; // the others start collapsed; "Expand all" opens every group
      // Collapsed groups still show a provenance badge when any layer inside is a proxy or placeholder.
      const inGroup = meta.features.filter((f) => f.ui_group === g);
      const gBadge = inGroup.some((f) => f.synthetic) ? '<span class="badge synth">placeholder</span>' : inGroup.some((f) => f.proxy) ? '<span class="badge proxy">proxy</span>' : '';
      sec.innerHTML = `<summary><i class="swatch" style="background:${GROUP_COLORS[g]}"></i><span>${g}</span>${gBadge}<em id="gsum-${g}"></em></summary>`;
      sec.addEventListener('toggle', syncAllLabel);
      meta.features.forEach((f, j) => {
        if (f.ui_group !== g) return;
        const row = document.createElement('div');
        row.className = 'wrow';
        const badge = f.synthetic ? '<span class="badge synth">placeholder</span>' : f.proxy ? '<span class="badge proxy">proxy</span>' : '';
        row.innerHTML = `<input type="checkbox" class="w-on" id="we-${f.id}" aria-label="Use ${esc(f.name)}"><div class="wl"><label for="w-${f.id}">${esc(f.name)}${badge}<span class="ekind"></span></label><div class="tv"></div></div><input type="range" id="w-${f.id}" min="${WEIGHT_MIN}" max="${WEIGHT_MAX}" step="${WEIGHT_STEP}"><span class="val"></span><span class="pct mono" title="Share of the total active weight"></span>`;
        const input = row.querySelector<HTMLInputElement>('input[type=range]')!;
        const check = row.querySelector<HTMLInputElement>('.w-on')!;
        input.addEventListener('input', () => editConfig((c) => (c.weights[f.id] = +input.value)));
        check.addEventListener('change', () => editConfig((c) => (c.enabled[f.id] = check.checked)));
        sliders[j] = input;
        sliderChecks[j] = check;
        sliderVals[j] = row.querySelector('.val')!;
        sliderPcts[j] = row.querySelector('.pct')!;
        targetLines[j] = row.querySelector('.tv')!;
        sec.appendChild(row);
      });
      wDiv.appendChild(sec);
    }
    const groupEls = () => [...wDiv.querySelectorAll<HTMLDetailsElement>('details.group')];
    function syncAllLabel() {
      $('#w-all').textContent = groupEls().every((d) => d.open) ? 'Collapse all' : 'Expand all';
    }
    $('#w-all').onclick = () => {
      const open = !groupEls().every((d) => d.open);
      groupEls().forEach((d) => (d.open = open));
      syncAllLabel();
    };
    syncAllLabel();
    $('#w-save').onclick = () => {
      const body = wView;
      const id = viewId();
      store.saved[keyOf(body, id)] = cloneConfig(workingOf(body, id));
      const ok = persist();
      renderWeights();
      syncMode();
      toast(ok ? `Saved ${body}: ${presetInfo(id).name}.` : 'Browser storage is blocked, so this was applied but will not be remembered after you close the page.');
    };
    $('#w-reset').onclick = () => {
      const body = wView;
      const id = viewId();
      delete store.saved[keyOf(body, id)]; // only this one of the six
      working.set(keyOf(body, id), defaultOf(body, id));
      persist();
      afterWeightChange(body);
      toast(`Reset ${body}: ${presetInfo(id).name} to its default.`);
    };
    renderWeights();
  }
  function selectTarget(i: number) {
    state.t = i;
    wView = bodyOf(targets.targets[i]);
    state.weights = engineWeights(wView);
    applyDefaultFilters(targets.targets[i]);
    syncTargetUI();
    closeDossier();
    requestScore();
  }
  // ---------------------------------------------------------------- UI: panels, candidates, dossier
  const right = $('#right');
  let current: { lat: number; lon: number; cell: number } | null = null;

  /** Keep the map's visual centre in the area not covered by panels. */
  // Phones and small tablets (CSS max-width: 900px): the panels become bottom sheets, one at a time.
  const isNarrow = () => window.innerWidth <= 900;
  function panelPadding() {
    if (ui.simple) return simple.padding();
    const g = 12;
    if (isNarrow()) {
      // Keep the map's centre in the strip above the open sheet and the bottom nav.
      const navH = $('#mnav').offsetHeight;
      const open = !body.classList.contains('left-closed') ? left : !body.classList.contains('right-closed') ? right : null;
      return { top: $('#topbar').offsetHeight + g * 2, bottom: navH + g + (open ? open.offsetHeight + g : 0), left: g, right: g };
    }
    return {
      top: $('#topbar').offsetHeight + g * 2,
      bottom: g,
      left: body.classList.contains('left-closed') ? g : left.offsetWidth + g * 2,
      right: body.classList.contains('right-closed') ? g : right.offsetWidth + g * 2,
    };
  }
  function applyPadding() {
    mapApi.setPadding(panelPadding());
  }
  function setPanel(side: 'left' | 'right', open: boolean) {
    body.classList.toggle(`${side}-closed`, !open);
    if (open && isNarrow()) {
      // One sheet at a time on narrow screens.
      const other = side === 'left' ? 'right' : 'left';
      body.classList.add(`${other}-closed`);
      body.classList.remove('guide-open');
      syncSideBtn(other);
    }
    syncSideBtn(side);
    syncNav();
    applyPadding();
  }
  function syncSideBtn(side: 'left' | 'right') {
    const open = !body.classList.contains(`${side}-closed`);
    const btn = $(`#toggle-${side}`);
    const what = side === 'left' ? 'controls' : 'candidates';
    btn.textContent = (side === 'left') === open ? '‹' : '›';
    btn.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${what}`);
    btn.title = `${open ? 'Hide' : 'Show'} ${what}`;
  }
  /** Mobile bottom nav: shows which sheet is open. The buttons click the same toggles as on desktop. */
  function syncNav() {
    const l = !body.classList.contains('left-closed');
    const r = !body.classList.contains('right-closed');
    const g = body.classList.contains('guide-open');
    const set = (id: string, on: boolean) => $(`#${id}`).setAttribute('aria-pressed', String(on));
    set('mnav-ctrl', l);
    set('mnav-cand', r);
    set('mnav-guide', g);
    set('mnav-map', !l && !r && !g);
  }
  function setGuide(open: boolean) {
    if (open && isNarrow()) {
      body.classList.add('left-closed', 'right-closed');
      syncSideBtn('left');
      syncSideBtn('right');
    }
    body.classList.toggle('guide-open', open);
    $('#guide-sheet').classList.toggle('hidden', !open);
    syncNav();
    applyPadding();
  }

  function siteLabel(s: Site) {
    const c = app.countryName(s.country);
    return `${c.name || 'Unknown'} · ${fmtLatLon(s.lat, s.lon)}`;
  }

  function selectSite(s: Site, i: number) {
    void showCell(s.lat, s.lon, i + 1, true, false, !ui.simple); // Normal Mode zooms into site focus; Simple Mode keeps the heatmap
  }

  // Site focus: opening a candidate collapses the controls, hides the heatmap and zooms in close.
  const FOCUS_ZOOM = 10;
  let focus: { leftWasOpen: boolean; heat: boolean } | null = null;
  function syncFocus() {
    body.classList.toggle('site-focus', !!focus);
    body.classList.toggle('focus-heat', !!focus?.heat);
    mapApi.setFocus(!!focus, !!focus?.heat);
    const btn = $('#heat-toggle');
    btn.textContent = focus?.heat ? 'Hide heatmap' : 'Show heatmap';
    btn.setAttribute('aria-pressed', String(!!focus?.heat));
  }
  function enterFocus() {
    if (focus) return;
    focus = { leftWasOpen: !body.classList.contains('left-closed'), heat: false };
    if (focus.leftWasOpen) setPanel('left', false);
    syncFocus();
  }
  function exitFocus() {
    if (!focus) return;
    const { leftWasOpen } = focus;
    focus = null;
    syncFocus();
    if (leftWasOpen) setPanel('left', true);
  }

  const showPlace = (lat: number, lon: number) => void showCell(lat, lon, undefined, true);
  // The known analog whose summary is open (kept across re-scores, cleared by any other selection).
  let currentAnalog: KnownAnalog | null = null;
  async function showAnalog(a: KnownAnalog) {
    // Analog coordinates can sit just off the 0.1° land mask (coast, small islands): try nearby cells.
    const res = meta.grid.res;
    for (const [dy, dx] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const lat = a.lat + dy * res;
      const lon = a.lon + dx * res;
      if (await app.requestCell(lat, lon)) {
        await showCell(lat, lon, undefined, true, false, !ui.simple, a);
        return;
      }
    }
    toast(`${a.name}: no land cell in the dataset here. ${a.note}`, 6000);
  }
  let showSeq = 0; // bumped by every showCell and closeDossier; a stale showCell does nothing
  async function showCell(lat: number, lon: number, rank?: number, fly = false, keepScroll = false, zoomIn = false, analog?: KnownAnalog) {
    const seq = ++showSeq;
    const info = await app.requestCell(lat, lon);
    if (seq !== showSeq) return;
    if (!info) {
      toast('No land here. Pick a spot on land inside the data.');
      return;
    }
    const r = Math.floor(info.cell / meta.grid.n_lon);
    const c = info.cell - r * meta.grid.n_lon;
    const clat = 90 - (r + 0.5) * meta.grid.res;
    const clon = -180 + (c + 0.5) * meta.grid.res;
    current = { lat, lon, cell: info.cell };
    currentAnalog = analog ?? (keepScroll ? currentAnalog : null);
    document.querySelectorAll('.site').forEach((el, k) => el.classList.toggle('active', k + 1 === rank));
    body.classList.add('dossier-open');
    $('#list-view').classList.add('hidden');
    renderDossier(app, info, clat, clon, {
      rank,
      analog: currentAnalog ?? undefined,
      total: lastResult?.sites.length ?? 0,
      onBack: closeDossier,
      onCopy: () => app.copyLink({ lat, lon }),
      onStep: (d) => {
        const k = (rank ?? 1) - 1 + d;
        const s = lastResult?.sites[k];
        if (s) selectSite(s, k);
      },
    }, keepScroll);
    if (ui.simple) simple.showResult(info, clat, clon, currentAnalog); // same data, plain wording
    if (body.classList.contains('right-closed')) setPanel('right', true);
    else applyPadding();
    if (zoomIn) enterFocus();
    mapApi.highlight(clat, clon);
    if (fly) mapApi.flyTo(lat, lon, zoomIn ? Math.max(mapApi.map.getZoom(), FOCUS_ZOOM) : Math.max(mapApi.map.getZoom(), 5.5));
    updateHash();
  }

  function closeDossier() {
    showSeq++; // a showCell still waiting for the worker must not reopen the dossier
    if (!current) return;
    current = null;
    currentAnalog = null;
    simple.hideResult();
    hideDossier();
    $('#list-view').classList.remove('hidden');
    body.classList.remove('dossier-open');
    exitFocus();
    applyPadding();
    updateHash();
  }

  function drawLegend(res: ScoreResult) {
    const { lo, hi } = res.stats;
    const h = res.hist;
    const N = 36;
    const counts: number[] = [];
    for (let k = 0; k < N; k++) {
      const a = Math.round((lo + ((hi - lo) * k) / N) * (h.length - 1));
      const b = Math.max(a + 1, Math.round((lo + ((hi - lo) * (k + 1)) / N) * (h.length - 1)));
      let sum = 0;
      for (let i = a; i < b && i < h.length; i++) sum += h[i];
      counts.push(sum);
    }
    const max = Math.max(...counts, 1);
    $('#legend-hist').innerHTML = counts
      .map((n, k) => `<i style="height:${Math.max(n ? 4 : 0, Math.sqrt(n / max) * 100).toFixed(1)}%;background:rgb(${infernoRgb(0.08 + (0.92 * (k + 0.5)) / N).join(',')})"></i>`)
      .join('');
    $('#legend-lo').textContent = (lo * 100).toFixed(1);
    $('#legend-mid').textContent = `99th percentile ${(res.stats.p99 * 100).toFixed(1)}`;
    $('#legend-hi').textContent = (hi * 100).toFixed(1);
    $('#legend-title').textContent = state.alpha > 0 ? `Analog score + novelty · ${shortName(app.target())}` : `Analog score · ${shortName(app.target())}`;
  }

  function onScored(res: ScoreResult) {
    void mapApi.setScoreImage(res.image, res.width, res.height, res.blob);
    simple.onScored(res);
    const list = $('#sites');
    list.innerHTML = '';
    const span = Math.max(1e-6, res.stats.hi - res.stats.lo);
    let currentRank: number | undefined;
    res.sites.forEach((s, i) => {
      const c = app.countryName(s.country);
      const li = document.createElement('li');
      const isNew = s.noveltyKm > 500;
      const frac = Math.min(1, Math.max(0.04, (s.blended - res.stats.lo) / span));
      if (current && s.cell === current.cell) currentRank = i + 1;
      li.innerHTML = `<button class="site${currentRank === i + 1 ? ' active' : ''}" title="${fmtKm(s.noveltyKm)} from the nearest known analog site">
        <span class="rank">${i + 1}</span>
        <span class="where"><span class="name">${flag(c.iso)} ${esc(c.name || 'Unknown')}${isNew ? '<span class="tag" title="More than 500 km from any known analog site">new</span>' : ''}</span>
        <span class="sub">${fmtLatLon(s.lat, s.lon)} · ${s.nCells > 1 ? `${Math.round(s.areaKm2).toLocaleString()} km²` : '1 cell'}</span></span>
        <span class="score"><b>${(s.blended * 100).toFixed(1)}</b><span class="score-bar"><i style="width:${(frac * 100).toFixed(0)}%"></i></span></span></button>`;
      const btn = li.firstElementChild as HTMLButtonElement;
      btn.onclick = () => selectSite(s, i);
      btn.onmouseenter = btn.onfocus = () => mapApi.pulseSite(i);
      btn.onmouseleave = btn.onblur = () => mapApi.pulseSite(null);
      list.appendChild(li);
    });
    $('#sites-sub').textContent = res.sites.length
      ? `Best ${res.sites.length} of ${res.stats.valid.toLocaleString()} land cells${state.region !== 'world' ? ` (shown: ${REGIONS[state.region].name} only)` : ''}. Score out of 100.`
      : 'No cells pass the current filters. Loosen one in Filters.';
    syncRegionChip();
    mapApi.setSites(res.sites, siteLabel, (s, i) => selectSite(s, i));
    drawLegend(res);
    // Keep an open dossier in step with new weights.
    if (current) void showCell(current.lat, current.lon, currentRank, false, true);
  }

  // ---------------------------------------------------------------- wire up
  buildLeft();
  buildWeightsEditor();
  // ---- Simple Mode: a second presentation layer. Same worker, same data, same scoring; no second engine.
  const simple = createSimple({
    app,
    pickTarget(i) {
      const keep = current; // keep the chosen Earth location when the target changes
      selectTarget(i);
      if (keep) void showCell(keep.lat, keep.lon, undefined, false, false, false);
    },
    openCell: (lat, lon, rank) => void showCell(lat, lon, rank, true, false, false),
    closeCell: () => closeDossier(),
    setRegion(id) {
      state.geography.regions = id ? [id] : [];
      syncGeoUI();
      syncFilterCount();
      simple.onTarget();
      requestScore();
    },
    region: () => (state.geography.regions[0] ?? '') as RegionId | '',
    switchToNormal: () => setUiMode('normal'),
    openAbout: () => renderAbout(app, showPlace),
    toggleTheme: () => void toggleTheme(),
  });
  interface AdvancedSnap {
    filters: { id: string; on: boolean; tau: number }[];
    alpha: number;
    geography: { countries: string[]; regions: RegionId[] };
    stretchLow: number;
    hideBelow: boolean;
    opacity: number;
  }
  let advancedSnap: AdvancedSnap | null = null;
  /** Switch between Normal and Simple Mode without losing the selected target, location or saved settings. */
  function setUiMode(mode: UiMode) {
    const wantSimple = mode === 'simple';
    if (wantSimple === ui.simple) return;
    if (wantSimple) {
      // Remember the advanced settings, then use the defaults. Saved modes and weights are not touched.
      advancedSnap = {
        filters: state.filters.map((f) => ({ id: f.id, on: f.on, tau: f.tau })),
        alpha: state.alpha,
        geography: { countries: [...state.geography.countries], regions: [...state.geography.regions] },
        stretchLow: state.stretchLow, hideBelow: state.hideBelow, opacity: state.opacity,
      };
      ui.simple = true;
      exitFocus();
      for (const f of state.filters) f.on = false;
      applyDefaultFilters(app.target());
      setAlphaUI(0);
      state.geography = { countries: [], regions: [] };
      state.stretchLow = 0.5;
      state.hideBelow = false;
      state.opacity = 0.85;
      syncGeoUI();
      syncViewUI();
    } else {
      ui.simple = false;
      const snap = advancedSnap;
      advancedSnap = null;
      if (snap) {
        for (const f of state.filters) {
          const o = snap.filters.find((x) => x.id === f.id);
          if (o) {
            f.on = o.on;
            f.tau = o.tau;
          }
        }
        for (const fi of filterInputs) {
          fi.cb.checked = fi.flt.on;
          fi.num.value = String(fi.flt.tau);
        }
        setAlphaUI(snap.alpha);
        state.geography = { countries: [...snap.geography.countries], regions: [...snap.geography.regions] };
        state.stretchLow = snap.stretchLow;
        state.hideBelow = snap.hideBelow;
        state.opacity = snap.opacity;
        syncGeoUI();
        syncViewUI();
      }
    }
    body.classList.toggle('simple', ui.simple);
    state.weights = engineWeights(bodyOf(app.target()));
    rememberMode(mode);
    syncFilterCount();
    renderWeights();
    syncMode();
    simple.onTarget();
    applyPadding();
    requestScore(); // also redraws the open location (showCell) in the new mode
  }
  $('#mode-chip').onclick = () => settings.open($('#mode-chip'));
  $('#mode-line-btn').onclick = () => settings.open($('#mode-line-btn'));
  settings.onOpen(() => {
    wView = bodyOf(app.target());
    renderWeights();
  });
  applyDefaultFilters(app.target());
  root.style.setProperty('--inferno', cssGradient());
  $('#btn-about').onclick = () => renderAbout(app, showPlace);
  settings.attachAdvanced({ filterCount: state.filters.length });
  $('#btn-settings').onclick = () => settings.open($('#btn-settings'));
  // Mobile bottom nav and Guide sheet: thin wrappers over the existing controls.
  $('#mnav-map').onclick = () => {
    setGuide(false);
    if (!body.classList.contains('left-closed')) setPanel('left', false);
    if (!body.classList.contains('right-closed')) setPanel('right', false);
  };
  $('#mnav-cand').onclick = () => $('#toggle-right').click();
  $('#mnav-ctrl').onclick = () => $('#toggle-left').click();
  $('#mnav-guide').onclick = () => setGuide(!body.classList.contains('guide-open'));
  $('#guide-tour').onclick = () => {
    setGuide(false);
    tour.start($('#mnav-guide'));
  };
  $('#guide-about').onclick = () => {
    setGuide(false);
    $('#btn-about').click();
  };
  $('#guide-limits').onclick = () => {
    setGuide(false);
    openLimits();
  };
  $('#guide-settings').onclick = () => {
    setGuide(false);
    settings.open($('#mnav-guide'));
  };
  $('#toggle-left').onclick = () => setPanel('left', body.classList.contains('left-closed'));
  $('#heat-toggle').onclick = () => {
    if (!focus) return;
    focus.heat = !focus.heat;
    syncFocus();
  };
  $('#toggle-right').onclick = () => setPanel('right', body.classList.contains('right-closed'));
  window.addEventListener('keydown', (e) => {
    const about = $('#about');
    if (e.key === 'Escape') {
      if (!about.classList.contains('hidden')) {
        about.classList.add('hidden');
        $('#btn-about').focus();
      }
      else closeDossier();
      return;
    }
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && about.classList.contains('hidden') && !/^(INPUT|SELECT|TEXTAREA)$/.test(tag) && !(e.target as HTMLElement).isContentEditable) {
      e.preventDefault();
      coordInput.focus();
      return;
    }
    if (!current || !about.classList.contains('hidden') || /^(INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(tag)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const btn = document.getElementById(e.key === 'ArrowDown' ? 'd-next' : 'd-prev') as HTMLButtonElement | null;
      if (btn && !btn.disabled) {
        e.preventDefault();
        btn.click();
      }
    }
  });
  // ---------------------------------------------------------------- coordinate search (top bar)
  const coordForm = $('#coord-search') as HTMLFormElement;
  const coordInput = $('#coord-input') as HTMLInputElement;
  const coordHint = $('#coord-hint');
  let coordTimer = 0;
  let coordSeq = 0;
  const hideCoordHint = () => {
    coordSeq++;
    clearTimeout(coordTimer);
    coordHint.classList.add('hidden');
  };
  const updateCoordHint = () => {
    const text = coordInput.value;
    if (!text.trim()) {
      if (document.activeElement !== coordInput) return hideCoordHint();
      coordSeq++;
      coordHint.className = 'sheet';
      coordHint.innerHTML = `<b>Jump to any place on Earth</b><span class="coord-place">Type latitude, then longitude, and press Enter.</span><span class="coord-eg">e.g. 39.45, 73.55  or  39°27′N 73°33′E</span>`;
      return;
    }
    const seq = ++coordSeq;
    clearTimeout(coordTimer);
    const p = parseCoords(text);
    coordHint.classList.remove('hidden');
    if ('error' in p) {
      coordHint.className = 'sheet coord-err';
      coordHint.innerHTML = `<span>${esc(p.error)}</span><span class="coord-eg">e.g. 39.45, 73.55 · 39.45N 73.55E · 39°27′N 73°33′E</span>`;
      return;
    }
    const where = fmtLatLon(p.lat, p.lon);
    const draw = (place: string) => {
      coordHint.className = 'sheet';
      coordHint.innerHTML = `<span class="coord-go">↵ Go to</span><b>${esc(where)}</b><span class="coord-place">${place}</span>`;
    };
    draw('…');
    coordTimer = window.setTimeout(async () => {
      const info = await app.requestCell(p.lat, p.lon);
      if (seq !== coordSeq) return;
      if (!info) return draw('No land cell here');
      const c = app.countryName(info.country);
      draw(c.name ? `${flag(c.iso)} ${esc(c.name)}` : 'Land cell');
    }, 150);
  };
  coordInput.addEventListener('input', updateCoordHint);
  coordInput.addEventListener('focus', updateCoordHint);
  coordInput.addEventListener('blur', () => setTimeout(hideCoordHint, 120));
  coordInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    coordInput.value = '';
    hideCoordHint();
    coordInput.blur();
  });
  coordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = parseCoords(coordInput.value);
    if ('error' in p) {
      updateCoordHint();
      return;
    }
    hideCoordHint();
    coordInput.blur();
    void showCell(p.lat, p.lon, undefined, true, false, !ui.simple);
  });

  mapApi.onCellClick((lat, lon) => void showCell(lat, lon));
  mapApi.onAnalogClick((a) => void showAnalog(a));
  mapApi.map.on('moveend', updateHash);

  // ---------------------------------------------------------------- right-panel tabs, discoveries, region
  const rtabs = document.querySelectorAll<HTMLButtonElement>('.rtabs button');
  function showRightTab(id: 'cand' | 'disc') {
    rtabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.r === id)));
    for (const k of ['cand', 'disc']) $(`#rv-${k}`).classList.toggle('hidden', k !== id);
  }
  rtabs.forEach((b) => (b.onclick = () => showRightTab(b.dataset.r as 'cand' | 'disc')));
  tabArrowKeys(rtabs);
  function syncRegionChip() {
    const chip = $('#region-chip');
    chip.classList.toggle('hidden', state.region === 'world');
    if (state.region === 'world') return;
    chip.innerHTML = `<b>${esc(REGIONS[state.region].name)} only</b><button class="text-btn" id="region-clear">Show the whole world</button>`;
    $('#region-clear').onclick = () => setRegion('world');
  }
  function setRegion(id: string, fit = true) {
    state.region = REGIONS[id] ? id : 'world';
    if (fit && state.region !== 'world') {
      const [a, b, c, d] = REGIONS[state.region].bbox;
      mapApi.map.fitBounds([[a, b], [c, d]], { padding: 40, duration: 900 });
    }
    requestScore();
  }
  function flyToTarget(targetId: string) {
    const i = targets.targets.findIndex((t) => t.id === targetId);
    if (i >= 0 && i !== state.t) selectTarget(i);
  }
  const hooks = {
    flyToDiscovery(d: Discovery) {
      flyToTarget(d.target);
      setAlphaUI(ds.discoveries?.alpha ?? 0.3);
      state.region = 'world';
      requestScore();
      void showCell(d.lat, d.lon, undefined, true, false, true);
    },
    copyDiscovery(d: Discovery) {
      const url = new URL(location.href);
      url.hash = buildHash({ t: d.target, a: ds.discoveries?.alpha ?? 0.3, s: { lat: d.lat, lon: d.lon }, v: { lat: d.lat, lon: d.lon, zoom: 10 } });
      void copyText(url.toString()).then((ok) => toast(ok ? `Link to ${d.name} copied.` : 'Could not copy the link.'));
    },
  };
  renderDiscoveries($('#rv-disc'), ds, hooks);

  // ---------------------------------------------------------------- guided tour
  const clickWhenReady = (sel: string, tries = 20) => {
    if (tour.mode() !== 'demo') return; // the demo was exited before this (retried) click fired
    const el = document.querySelector<HTMLButtonElement>(sel);
    if (el && !el.disabled) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.click();
    } else if (tries > 0) window.setTimeout(() => clickWhenReady(sel, tries - 1), 250);
  };
  const leftTab = (): LeftTab => (left.querySelector<HTMLButtonElement>('.tabs button[aria-selected="true"]')?.dataset.tab as LeftTab) ?? 'filters';
  const showLeftTab = (id: LeftTab) => left.querySelector<HTMLButtonElement>(`.tabs button[data-tab="${id}"]`)?.click();
  const rightTab = (): RightTab => (document.querySelector<HTMLButtonElement>('.rtabs button[aria-selected="true"]')?.dataset.r as RightTab) ?? 'cand';
  /** Put back the view captured by the tour (and, after the demo, the settings too). */
  function restoreNow(s: TourSnapshot, full: boolean) {
    if (full) {
      // The demo changed settings: put every one of them back.
      if (state.t !== s.t) {
        state.t = s.t;
        syncTargetUI();
      }
      applyWeightVector(bodyOf(app.target()), s.weights);
      for (const f of state.filters) {
        const o = s.filters.find((x) => x.id === f.id);
        if (o) {
          f.on = o.on;
          f.tau = o.tau;
        }
      }
      for (const fi of filterInputs) {
        fi.cb.checked = fi.flt.on;
        fi.num.value = String(fi.flt.tau);
      }
      setAlphaUI(s.alpha);
      state.geography = { countries: [...s.geography.countries], regions: [...s.geography.regions] as RegionId[] };
      syncGeoUI();
      state.region = s.region;
      state.projection = s.projection as AppState['projection'];
      state.basemap = s.basemap as AppState['basemap'];
      state.stretchLow = s.stretchLow;
      state.hideBelow = s.hideBelow;
      state.opacity = s.opacity;
      syncViewUI();
      syncFilterCount();
      requestScore();
    }
    setPlanetOpen(s.planetOpen);
    const finish = () => {
      if (!s.focus) exitFocus();
      setPanel('left', s.leftOpen);
      setPanel('right', s.rightOpen);
      showLeftTab(s.leftTab);
      showRightTab(s.rightTab);
      const cm = s.camera;
      mapApi.map.jumpTo({ center: [cm.lng, cm.lat], zoom: cm.zoom, bearing: cm.bearing, pitch: cm.pitch, padding: panelPadding() });
      updateHash();
    };
    const same = current && s.site && current.lat === s.site.lat && current.lon === s.site.lon;
    if (s.site && !same) {
      const rank = lastResult?.sites.findIndex((x) => x.lat === s.site!.lat && x.lon === s.site!.lon) ?? -1;
      void showCell(s.site.lat, s.site.lon, rank >= 0 ? rank + 1 : undefined, false, false, s.focus).then(finish);
    } else {
      if (!s.site) closeDossier();
      finish();
    }
  }
  const tour = createTour({
    // ---- what the guided tour needs: snapshot and restore the view, reveal controls (main.ts owns the state)
    snapshot: (): TourSnapshot => {
      const c = mapApi.map.getCenter();
      return {
        t: state.t,
        weights: [...state.weights],
        filters: state.filters.map((f) => ({ id: f.id, on: f.on, tau: f.tau })),
        alpha: state.alpha,
        geography: { countries: [...state.geography.countries], regions: [...state.geography.regions] },
        region: state.region,
        projection: state.projection,
        basemap: state.basemap,
        stretchLow: state.stretchLow,
        hideBelow: state.hideBelow,
        opacity: state.opacity,
        leftTab: leftTab(),
        rightTab: rightTab(),
        leftOpen: !body.classList.contains('left-closed'),
        rightOpen: !body.classList.contains('right-closed'),
        site: current ? { lat: current.lat, lon: current.lon } : null,
        focus: !!focus,
        planetOpen: planetOpen(),
        camera: { lng: c.lng, lat: c.lat, zoom: mapApi.map.getZoom(), bearing: mapApi.map.getBearing(), pitch: mapApi.map.getPitch() },
        hash: location.hash,
      };
    },
    restore: (s, full) => {
      setGuide(false);
      // A location the demo or the example button was still opening (showCell awaits the worker) must land
      // first. The worker answers cell requests in order, so one more request works as a barrier.
      void app.requestCell(0, 0).then(() => restoreNow(s, full));
    },
    context: () => ({
      nCells: meta.n_cells,
      nFeatures: F,
      nTargets: targets.targets.length,
      nAnalogs: ds.analogs.length,
      nDiscoveries: ds.discoveries?.discoveries.length ?? 0,
      noveltyKm: meta.novelty_saturation_km,
      ...groupTargets(targets.targets.map((t) => ({ body: t.body, short: shortName(t) }))),
      proxies: meta.features.filter((f) => f.proxy && !f.synthetic).map((f) => f.name),
      regionName: state.region !== 'world' ? REGIONS[state.region].name : null,
    }),
    prep: (p) => {
      if (!p) return;
      if (p.clear && isNarrow()) {
        setGuide(false);
        if (!body.classList.contains('left-closed')) setPanel('left', false);
        if (!body.classList.contains('right-closed')) setPanel('right', false);
      }
      if (p.guide && isNarrow()) setGuide(true);
      if (p.left) {
        setGuide(false);
        if (body.classList.contains('left-closed')) setPanel('left', true);
        if (p.left !== 'current') showLeftTab(p.left);
      }
      if (p.right) {
        setGuide(false);
        if (body.classList.contains('right-closed')) setPanel('right', true);
        showRightTab(p.right);
      }
    },
    dossierOpen: () => !!current,
    openExample: () => {
      const s = lastResult?.sites[0];
      if (s) selectSite(s, 0);
    },
    openAbout: (section) => (section === 'limits' ? openLimits() : renderAbout(app, showPlace)),
    narrow: isNarrow,
    // ---- the original 30-second demo
    selectTarget: (id) => flyToTarget(id),
    setAlpha: (a) => {
      setAlphaUI(a);
      requestScore();
    },
    worldView: () => {
      exitFocus();
      mapApi.map.flyTo({ center: [10, 20], zoom: 1.6, duration: 1200 });
    },
    closeSite: () => closeDossier(),
    showTab: (id) => showRightTab(id),
    openFirstDiscovery: () => {
      const list = ds.discoveries?.discoveries ?? [];
      const d = list.find((x) => x.target === app.target().id) ?? list[0];
      if (d) hooks.flyToDiscovery(d);
    },
    runDrill: () => window.setTimeout(() => clickWhenReady('#drill-btn'), 300),
    openPlanet: () => {
      const b = document.querySelector<HTMLButtonElement>('#pm-btn');
      if (b && /^Show/.test(b.textContent || '')) clickWhenReady('#pm-btn');
      else b?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
  });
  $('#btn-tour').onclick = () => tour.start($('#btn-tour'));

  await Promise.all([workerReady, mapApi.ready]);
  mapApi.setAnalogs(ds.analogs);
  // Apply a shared link (weights, filters, novelty, view) on top of the target defaults.
  if (!ui.simple && link.m && isPresetId(link.m)) {
    store.active[bodyOf(app.target())] = link.m; // the sender's mode, for this visit only
    state.weights = engineWeights(bodyOf(app.target()));
  }
  if (!ui.simple && link.w) {
    // Weights from a link are an unsaved edit of the active mode: the recipient can Save or Reset them.
    if (validWeightVector(link.w, F)) applyWeightVector(bodyOf(app.target()), link.w);
    else toast('The shared link contained invalid weights; the mode defaults were used.');
  }
  if (!ui.simple && link.f) {
    for (const flt of state.filters) {
      const on = link.f.find((x) => x.id === flt.id);
      flt.on = !!on;
      if (on) flt.tau = on.tau;
    }
    for (const fi of filterInputs) {
      fi.cb.checked = fi.flt.on;
      fi.num.value = String(fi.flt.tau);
    }
    syncFilterCount();
  }
  if (!ui.simple && link.a) setAlphaUI(link.a);
  if (state.projection !== 'mercator') mapApi.setProjection(state.projection);
  if (state.basemap !== 'satellite') mapApi.setBasemap(state.basemap);
  syncTargetUI();
  if (link.v) mapApi.map.jumpTo({ center: [link.v.lon, link.v.lat], zoom: link.v.zoom });
  else if (state.region !== 'world') setRegion(state.region);
  const narrow = isNarrow();
  setPanel('left', !narrow);
  setPanel('right', !narrow);
  if (!link.v && state.region === 'world') {
    // Frame the whole inhabited world inside the gap between the panels, so the top candidates
    // (often in Central Asia) are not hidden under the right panel on first load.
    mapApi.map.stop();
    mapApi.map.setPadding(panelPadding());
    mapApi.map.fitBounds([[-165, -56], [178, 74]], { animate: false });
  }
  // Expose the legend's on-screen height so narrow layouts can lift the scale bar above it.
  const legendEl = $('#legend');
  const syncLegendH = () => {
    const h = legendEl.getClientRects().length ? legendEl.offsetHeight + 12 : 0;
    document.documentElement.style.setProperty('--legend-h', `${h}px`);
  };
  new ResizeObserver(syncLegendH).observe(legendEl);
  new MutationObserver(syncLegendH).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncLegendH();
  window.addEventListener('resize', applyPadding);
  requestScore();
  if (link.s) void showCell(link.s.lat, link.s.lon, undefined, !link.v, false, !ui.simple);
  // #tour keeps its original meaning: play the 30-second captioned demo.
  if (link.tour) window.setTimeout(() => tour.start(null, true), 800);
  uiReady = true;
  if (wantedMode !== (ui.simple ? 'simple' : 'normal')) setUiMode(wantedMode); // the start screen was used while loading
  simple.onTarget();
  $('#loader').classList.add('hidden');
  (window as unknown as { app: App }).app = app;
}

void main();
