import './style.css';
import { loadDataset, type Dataset } from './data';
import { createMap, type MapApi } from './map';
import { cssGradient, infernoRgb } from './colormap';
import { valueFromZ, zThresholdFromValue, type TargetRange } from './scoring';
import { esc, flag, fmtKm, fmtLatLon, fmtValue, GROUP_COLORS } from './format';
import { renderDossier, hideDossier } from './ui/dossier';
import { fingerprint } from './ui/fingerprint';
import { renderAbout } from './about';
import { buildHash, copyText, parseHash, type LinkState, type MapMode } from './links';
import { renderDiscoveries } from './ui/discoveries';
import { renderValidation } from './ui/validation';
import { createTour } from './ui/tour';
import { REGIONS as GEO_REGIONS, matchesGeography, validRegion, type RegionId } from './geography';
import { hasPositiveWeight, normalizeWeights, redistributeWeight, totalWeight } from './weights';
import { ACTIVITIES, activityById, type ActivityId } from './activities';
import type { CellInfo, Discovery, ScoreRequest, ScoreResult, Site, Target } from './types';

export const REGIONS: Record<string, { name: string; bbox: [number, number, number, number] }> = {
  safrica: { name: 'southern Africa', bbox: [11.0, -35.5, 33.0, -16.5] },
};

const MODES: { id: MapMode; name: string; description: string }[] = [
  { id: 'direct', name: 'Direct comparison', description: 'Compare Earth conditions with the selected planetary target.' },
  { id: 'exploration', name: 'Exploration', description: 'Find promising and novel Earth locations for research.' },
  { id: 'earth-complications', name: 'Comparison + Earth complications', description: 'Keep physical similarity visible while checking practical Earth constraints.' },
];

const modeInfo = (id: MapMode) => MODES.find((mode) => mode.id === id)!;

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
  mode: MapMode;
  activity: ActivityId;
  weights: number[];
  ranges: TargetRange[];
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
    },
    [ds.features, ds.cells, ds.countries],
  );

  // ---------------------------------------------------------------- state
  const bp = (id: string, p: number) => meta.features[featIndex(id)].breakpoints[p];
  const link: LinkState = parseHash(location.hash);
  const t0 = Math.max(0, targets.targets.findIndex((t) => t.id === link.t));
  const state: AppState = {
    t: t0,
    mode: link.m ?? 'direct',
    activity: link.activity ?? 'rover-mobility',
    weights: normalizeWeights(targets.targets[t0].weights)!,
    ranges: targets.targets[t0].vector.map((value) => ({ min: value, max: value })),
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
      countries: [...new Set((link.c ?? []).filter((iso) => meta.countries.some((c) => c.iso === iso)))],
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
      const r = Math.floor((90 - lat) / meta.grid.res);
      const c = Math.floor((lon + 180) / meta.grid.res);
      if (r < 0 || r >= meta.grid.n_lat || c < 0 || c >= meta.grid.n_lon) return Promise.resolve(null);
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
  function defaultWeights(target: Target = app.target()): number[] {
    return normalizeWeights(target.weights) ?? [];
  }
  function rangesChanged(): boolean {
    return state.ranges.some((range, j) => range.min !== app.target().vector[j] || range.max !== app.target().vector[j]);
  }
  function linkState(site?: { lat: number; lon: number }): LinkState {
    const t = app.target();
    const defaults = defaultWeights(t);
    const wChanged = state.weights.some((w, j) => Math.abs(w - defaults[j]) > 0.005);
    const on = state.filters.filter((f) => f.on).map((f) => ({ id: f.id, tau: f.tau }));
    const def = (t.default_filters || []).map((f) => ({ id: f.feature, tau: f.max }));
    const fChanged = JSON.stringify(on) !== JSON.stringify(def);
    const c = mapApi.map.getCenter();
    return {
      t: t.id, m: state.mode, activity: state.activity, w: wChanged ? state.weights : undefined, x: rangesChanged() ? state.ranges : undefined, f: fChanged ? on : undefined, a: state.alpha || undefined,
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
  let reqId = 0;
  let inFlight = false;
  let dirty = false;
  function buildRequest(): ScoreRequest {
    const t = app.target();
    return {
      type: 'score', id: ++reqId, target: t.vector, targetRanges: state.ranges, weights: state.weights,
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
    if (!hasPositiveWeight(state.weights)) {
      dirty = false;
      mapApi.setScoreVisible(false);
      mapApi.setSites([], siteLabel, () => {});
      $('#sites').innerHTML = '<li class="empty-state"><b>Scoring paused.</b><span>Choose at least one feature with a positive percentage weight.</span></li>';
      $('#sites-sub').textContent = 'Invalid weight configuration.';
      closeDossier();
      showWeightValidity();
      return;
    }
    mapApi.setScoreVisible(true);
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
      onScored(lastResult);
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

  const modeNav = $('#mode-selector');
  const modeSelect = $<HTMLSelectElement>('#mode-select');
  MODES.forEach((mode) => {
    const button = document.createElement('button');
    button.className = 'mode-option';
    button.type = 'button';
    button.role = 'tab';
    button.textContent = mode.name;
    button.title = mode.description;
    button.dataset.mode = mode.id;
    button.onclick = () => selectMode(mode.id);
    modeNav.appendChild(button);
    const option = document.createElement('option');
    option.value = mode.id;
    option.textContent = mode.name;
    modeSelect.appendChild(option);
  });
  modeSelect.onchange = () => selectMode(modeSelect.value as MapMode);

  // ---------------------------------------------------------------- UI: left panel
  const left = $('#left');
  const sliders: HTMLInputElement[] = [];
  const sliderVals: HTMLElement[] = [];
  const targetLines: HTMLElement[] = [];
  const rangeMins: HTMLInputElement[] = [];
  const rangeMaxs: HTMLInputElement[] = [];
  const rangeLabels: HTMLElement[] = [];
  const filterInputs: { flt: FilterState; cb: HTMLInputElement; num: HTMLInputElement }[] = [];
  const groups = ['Terrain', 'Climate', 'Surface', 'Remoteness'] as const;
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
  }
  function syncGroupSums() {
    for (const g of groups) {
      let sum = 0;
      let n = 0;
      meta.features.forEach((f, j) => {
        if (f.ui_group !== g) return;
        sum += state.weights[j];
        n++;
      });
      $(`#gsum-${g}`).textContent = `${n} layers · ${sum.toFixed(0)}%`;
    }
    showWeightValidity();
  }
  function showWeightValidity() {
    const total = totalWeight(state.weights);
    const valid = hasPositiveWeight(state.weights);
    const el = $('#weights-total');
    el.textContent = valid ? `${total.toFixed(0)}% total` : 'Invalid: choose at least one feature';
    el.classList.toggle('invalid', !valid);
    $('#weights').classList.toggle('invalid-config', !valid);
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
  function buildLeft() {
    const synth = meta.synthetic_features;
    left.innerHTML = `
      <div class="brief">
        <div class="brief-top">
          <div><div class="eyebrow" id="t-eyebrow"></div><h1 id="t-name"></h1></div>
          <div id="t-glyph"></div>
        </div>
        <p id="t-blurb"></p>
        <p class="task-hint"><b>Explore:</b> adjust the model only when you want to test a different scientific emphasis.</p>
        <div id="mode-summary" class="mode-summary"></div>
        <div id="mode-tools"></div>
        <button class="vbadge" id="t-valid" title="How well do known analogs score? Click for the method."></button>
        <button class="text-btn" id="best-site">Fly to the best match</button>
      </div>
      ${synth.length ? `<div class="warn-box"><b>${synth.length} of ${F} layers ${synth.length > 1 ? 'are placeholders' : 'is a placeholder'}</b> in this build (${synth.map((s) => esc(meta.features[featIndex(s)].name)).join(', ')}). Treat rankings as illustrative.</div>` : ''}
      ${meta.bbox ? `<div class="warn-box">Regional build: only ${meta.bbox.join(', ')} is included.</div>` : ''}
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="weights" aria-selected="true" aria-controls="pane-weights">Adjust model</button>
        <button role="tab" data-tab="filters" aria-selected="false" aria-controls="pane-filters">Limit results<span class="count" id="tab-filters-n"></span></button>
        <button role="tab" data-tab="view" aria-selected="false" aria-controls="pane-view">Map</button>
      </div>
      <div class="tab-body">
        <div class="pane" id="pane-weights" role="tabpanel">
          <div class="pane-intro"><p class="note">Set percentage importance and expand acceptable target ranges when scientifically justified. The default model is the recommended starting point.</p><span id="weights-total" class="weights-total" aria-live="polite"></span><button class="text-btn" id="reset-w">Reset model</button></div>
          <div id="weights"></div>
        </div>
        <div class="pane hidden" id="pane-filters" role="tabpanel">
          <h4>Leave out</h4>
          <p class="note">Exclude places that do not meet a practical condition. Excluded cells score zero.</p>
          <div id="filters"></div>
          <div class="geo-filter">
            <div class="geo-head"><h4>Geography</h4><button class="text-btn" id="reset-geo">Reset</button></div>
            <p class="note">Only cells matching every selected geography remain.</p>
            <div id="geo-active" class="geo-active" aria-live="polite"></div>
            <div class="geo-section"><b>Regions</b><div id="geo-regions" class="geo-regions"></div></div>
            <div class="geo-section"><label for="geo-search"><b>Countries</b></label><input id="geo-search" class="geo-search" type="search" placeholder="Search countries" autocomplete="off"></div>
            <div id="geo-countries" class="geo-countries"></div>
          </div>
          <h4>Favour new places <span class="mono" id="alpha-val"></span></h4>
          <input type="range" id="alpha" min="0" max="0.6" step="0.02" value="${state.alpha}">
          <p class="note">Mixes in distance from the ${ds.analogs.length} known analog sites (levels off at ${meta.novelty_saturation_km.toLocaleString()} km), so candidates nobody has used yet rise.</p>
        </div>
        <div class="pane hidden" id="pane-view" role="tabpanel">
          <div class="field"><span>Map shape</span><div class="seg" id="seg-proj"><button data-v="mercator">Flat</button><button data-v="globe">Globe</button></div></div>
          <div class="field"><span>Background</span><div class="seg" id="seg-base"><button data-v="satellite">Satellite</button><button data-v="dark">Plain dark</button></div></div>
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
        for (const id of ['weights', 'filters', 'view']) {
          const pane = $(`#pane-${id}`);
          pane.classList.toggle('hidden', id !== b.dataset.tab);
          pane.setAttribute('aria-hidden', String(id !== b.dataset.tab));
        }
      };
    });

    // weights
    const wDiv = $('#weights');
    for (const g of groups) {
      const sec = document.createElement('details');
      sec.className = 'group';
      sec.open = false;
      sec.innerHTML = `<summary><i class="swatch" style="background:${GROUP_COLORS[g]}"></i><span>${g}</span><em id="gsum-${g}"></em></summary>`;
      meta.features.forEach((f, j) => {
        if (f.ui_group !== g) return;
        const row = document.createElement('div');
        row.className = 'wrow';
        row.dataset.feature = f.id;
        const badge = f.synthetic ? '<span class="badge synth">placeholder</span>' : f.proxy ? '<span class="badge proxy">proxy</span>' : '';
        row.innerHTML = `<div class="wl"><label for="w-${f.id}">${esc(f.name)}${badge}</label><div class="tv"></div><details class="range-detail"><summary>Acceptable range <span class="range-label"></span></summary><div class="range-pair"><label>min <input class="range-min" type="range" min="0" max="1" step="0.01" aria-label="${esc(f.name)} minimum percentile"></label><label>max <input class="range-max" type="range" min="0" max="1" step="0.01" aria-label="${esc(f.name)} maximum percentile"></label></div><p class="range-note">Percentile boundaries use valid observed Earth data.</p></details></div><input type="range" id="w-${f.id}" min="0" max="100" step="1" aria-label="${esc(f.name)} percentage weight"><span class="val"></span>`;
        const input = row.querySelector<HTMLInputElement>(`#w-${f.id}`)!;
        input.addEventListener('input', () => {
          state.weights = redistributeWeight(state.weights, j, +input.value);
          syncSliders();
          fill(input);
          requestScore();
        });
        const minInput = row.querySelector<HTMLInputElement>('.range-min')!;
        const maxInput = row.querySelector<HTMLInputElement>('.range-max')!;
        const rangeLabel = row.querySelector<HTMLElement>('.range-label')!;
        const updateRange = () => {
          const min = +minInput.value;
          const max = +maxInput.value;
          if (min > max) {
            if (document.activeElement === minInput) maxInput.value = String(min);
            else minInput.value = String(max);
          }
          state.ranges[j] = { min: +minInput.value, max: +maxInput.value };
          syncRangeUI(j);
          requestScore();
        };
        minInput.addEventListener('input', updateRange);
        maxInput.addEventListener('input', updateRange);
        sliders[j] = input;
        sliderVals[j] = row.querySelector('.val')!;
        targetLines[j] = row.querySelector('.tv')!;
        rangeMins[j] = minInput;
        rangeMaxs[j] = maxInput;
        rangeLabels[j] = rangeLabel;
        sec.appendChild(row);
      });
      wDiv.appendChild(sec);
    }
    $('#reset-w').onclick = () => {
      state.weights = defaultWeights();
      state.ranges = app.target().vector.map((value) => ({ min: value, max: value }));
      syncSliders();
      syncTargetUI();
      requestScore();
    };
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
    });
    $('#reset-geo').onclick = () => {
      state.geography = { countries: [], regions: [] };
      renderGeo(); requestScore();
    };
    renderGeo();

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
  }

  function syncTargetUI() {
    const t = app.target();
    root.dataset.body = t.body.toLowerCase();
    targetBtns.forEach((el, i) => el.setAttribute('aria-pressed', String(i === state.t)));
    select.value = String(state.t);
    $('#t-eyebrow').textContent = `${t.body} target`;
    $('#t-name').textContent = siteName(t);
    $('#t-blurb').textContent = t.blurb;
    $('#t-glyph').innerHTML = fingerprint(meta.features, t.vector, null, 84, `Fingerprint of ${t.name}: each spoke is one layer, longer means higher among Earth's land`);
    meta.features.forEach((f, j) => {
      const raw = t.raw[f.id];
      const pct = Math.round(t.vector[j] * 100);
      const range = state.ranges[j];
      const interval = `acceptable p${Math.round(range.min * 100)}–p${Math.round(range.max * 100)}`;
      targetLines[j].innerHTML = raw.value === null
        ? `<span class="beyond">beyond Earth</span>`
        : raw.beyond_earth ? `${fmtValue(raw.value, f)} · <span class="beyond">beyond Earth</span> · ${interval}` : `${fmtValue(raw.value, f)} · p${pct} · ${interval}`;
      const tv = raw.value === null ? `beyond Earth's max (clamped to ${fmtValue(raw.clamped, f)})` : fmtValue(raw.value, f) + (raw.beyond_earth ? ` → clamped ${fmtValue(raw.clamped, f)}` : '');
      const lbl = left.querySelector(`label[for="w-${f.id}"]`) as HTMLElement;
      const tip = `${f.description}\nSource: ${f.source_name}${f.synthetic ? ' (placeholder data)' : ''}\nTarget value: ${tv} (higher than ${pct}% of Earth's land)`;
      lbl.title = tip;
      targetLines[j].title = tip;
    });
    mapApi.setTargetBody(t.body);
    syncSliders();
    syncBadge();
    syncModeUI();
    updateHash();
  }

  function syncModeUI() {
    const info = modeInfo(state.mode);
    modeNav.querySelectorAll<HTMLButtonElement>('.mode-option').forEach((button) => {
      const selected = button.dataset.mode === state.mode;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    modeSelect.value = state.mode;
    $('#mode-summary').innerHTML = `<div class="mode-label"><span class="mode-dot mode-${state.mode}"></span><b>${esc(info.name)}</b></div><p>${esc(info.description)}</p>`;
    const tools = $('#mode-tools');
    if (state.mode === 'direct') {
      tools.innerHTML = '<div class="mode-note"><b>Similarity baseline</b><span>Higher scores mean the Earth location is closer to the target across the selected measurements.</span></div>';
      syncActivityHighlights([]);
    } else if (state.mode === 'exploration') {
      const activity = activityById(state.activity);
      tools.innerHTML = `<div class="mode-note activity-panel"><b>Research activity</b><label class="activity-select-label" for="activity-select">Evidence context<select id="activity-select" class="mode-activity">${ACTIVITIES.map((candidate) => `<option value="${candidate.id}" ${candidate.id === activity.id ? 'selected' : ''} ${candidate.availability === 'disabled' ? 'disabled' : ''}>${esc(candidate.name)}${candidate.availability === 'disabled' ? ' — unavailable' : ''}</option>`).join('')}</select></label><div class="activity-evidence"><span class="activity-status ${activity.availability}">${activity.availability}</span><span>${esc(activity.description)}</span><b>Relevant measurements</b><span>${activity.measurements.length ? activity.measurements.map((measurement) => esc(measurement)).join(' · ') : 'None available'}</span><b>Recommendation</b><span>${esc(activity.recommendation)}</span><details><summary>Limitations and data sources</summary><ul>${activity.datasets.map((dataset) => `<li>${esc(dataset)}</li>`).join('')}${activity.limitations.map((limitation) => `<li>${esc(limitation)}</li>`).join('')}</ul></details></div><span id="activity-note">Activity context changes the evidence shown here and does not change feature weights or the similarity score.</span></div>`;
      const activitySelect = $<HTMLSelectElement>('#activity-select');
      activitySelect.onchange = () => {
        state.activity = activitySelect.value as ActivityId;
        syncModeUI();
        if (lastResult) onScored(lastResult);
        updateHash();
      };
      syncActivityHighlights(activity.featureIds);
    } else if (state.mode === 'earth-complications') {
      tools.innerHTML = '<div class="mode-note mode-unavailable"><b>Earth complications</b><span>Complication measurements are not included in this dataset yet.</span><span>The map below remains the physical-similarity baseline; no complication values are being inferred.</span></div>';
      syncActivityHighlights([]);
    }
    const legendDirection = $('#legend-direction');
    legendDirection.textContent = 'higher is more similar';
  }

  function syncActivityHighlights(featureIds: string[]) {
    const active = new Set(featureIds);
    left.querySelectorAll<HTMLElement>('.wrow').forEach((row) => {
      row.classList.toggle('activity-relevant', active.has(row.dataset.feature ?? ''));
    });
  }

  function selectMode(mode: MapMode) {
    if (!MODES.some((candidate) => candidate.id === mode)) return;
    state.mode = mode;
    syncModeUI();
    if (lastResult) onScored(lastResult);
    drawLegend(lastResult);
    updateHash();
  }

  function syncBadge() {
    const t = app.target();
    const v = ds.validation?.results.find((r) => r.target === t.id);
    const b = $('#t-valid');
    if (!v) {
      b.classList.add('hidden');
      return;
    }
    const cls = v.auc >= 0.85 ? 'good' : v.auc >= 0.65 ? 'fair' : 'weak';
    const word = cls === 'good' ? 'works well' : cls === 'fair' ? 'works moderately' : 'weak';
    b.className = `vbadge ${cls}`;
    b.innerHTML = `<i></i><span>How well does this work? <b>AUC ${v.auc.toFixed(2)}</b> · known analogs median p${v.median_analog_percentile.toFixed(0)} · ${word}</span>`;
    b.onclick = () => {
      renderAbout(app, showPlace);
      document.getElementById(`val-${t.id}`)?.scrollIntoView({ block: 'center' });
    };
  }

  function syncSliders() {
    meta.features.forEach((_, j) => {
      sliders[j].value = String(state.weights[j]);
      sliderVals[j].textContent = `${state.weights[j].toFixed(0)}%`;
      sliders[j].closest('.wrow')!.classList.toggle('off', state.weights[j] === 0);
      fill(sliders[j]);
      syncRangeUI(j);
    });
    syncGroupSums();
  }

  function syncRangeUI(j: number) {
    const f = meta.features[j];
    const range = state.ranges[j];
    if (!rangeMins[j] || !rangeMaxs[j]) return;
    rangeMins[j].value = String(range.min);
    rangeMaxs[j].value = String(range.max);
    rangeLabels[j].textContent = `p${Math.round(range.min * 100)}–p${Math.round(range.max * 100)}`;
    const minValue = valueFromZ(f.breakpoints, range.min);
    const maxValue = valueFromZ(f.breakpoints, range.max);
    rangeLabels[j].title = `${fmtValue(minValue, f)} to ${fmtValue(maxValue, f)}`;
  }

  function selectTarget(i: number) {
    state.t = i;
    state.weights = normalizeWeights(targets.targets[i].weights)!;
    state.ranges = targets.targets[i].vector.map((value) => ({ min: value, max: value }));
    applyDefaultFilters(targets.targets[i]);
    syncTargetUI();
    if (!$('#rv-validation').classList.contains('hidden')) renderValidation($('#rv-validation'), ds, app.target().id, activityById(state.activity));
    closeDossier();
    requestScore();
  }

  // ---------------------------------------------------------------- UI: panels, candidates, dossier
  const right = $('#right');
  let current: { lat: number; lon: number; cell: number } | null = null;

  /** Keep the map's visual centre in the area not covered by panels. */
  function applyPadding() {
    const g = 12;
    mapApi.setPadding({
      top: $('#topbar').offsetHeight + g * 2,
      bottom: g,
      left: body.classList.contains('left-closed') ? g : left.offsetWidth + g * 2,
      right: body.classList.contains('right-closed') ? g : right.offsetWidth + g * 2,
    });
  }
  function setPanel(side: 'left' | 'right', open: boolean) {
    const narrow = window.innerWidth < 900;
    if (narrow && open) {
      const other = side === 'left' ? 'right' : 'left';
      body.classList.add(`${other}-closed`);
      const otherBtn = $(`#toggle-${other}`);
      const otherWhat = other === 'left' ? 'controls' : 'candidates';
      otherBtn.textContent = '›';
      otherBtn.setAttribute('aria-label', `Show ${otherWhat}`);
      otherBtn.title = `Show ${otherWhat}`;
    }
    body.classList.toggle(`${side}-closed`, !open);
    const btn = $(`#toggle-${side}`);
    const what = side === 'left' ? 'controls' : 'candidates';
    btn.textContent = (side === 'left') === open ? '‹' : '›';
    btn.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${what}`);
    btn.title = `${open ? 'Hide' : 'Show'} ${what}`;
    applyPadding();
  }

  function siteLabel(s: Site) {
    const c = app.countryName(s.country);
    return `${c.name || 'Unknown'} · ${fmtLatLon(s.lat, s.lon)}`;
  }

  function selectSite(s: Site, i: number) {
    void showCell(s.lat, s.lon, i + 1, true, false, true);
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
  async function showCell(lat: number, lon: number, rank?: number, fly = false, keepScroll = false, zoomIn = false) {
    const info = await app.requestCell(lat, lon);
    if (!info) {
      toast('No land here. Pick a spot on land inside the data.');
      return;
    }
    const r = Math.floor(info.cell / meta.grid.n_lon);
    const c = info.cell - r * meta.grid.n_lon;
    const clat = 90 - (r + 0.5) * meta.grid.res;
    const clon = -180 + (c + 0.5) * meta.grid.res;
    current = { lat, lon, cell: info.cell };
    document.querySelectorAll('.site').forEach((el, k) => el.classList.toggle('active', k + 1 === rank));
    body.classList.add('dossier-open');
    $('#list-view').classList.add('hidden');
    renderDossier(app, info, clat, clon, {
      rank,
      total: lastResult?.sites.length ?? 0,
      onBack: closeDossier,
      onCopy: () => app.copyLink({ lat, lon }),
      onStep: (d) => {
        const k = (rank ?? 1) - 1 + d;
        const s = lastResult?.sites[k];
        if (s) selectSite(s, k);
      },
    }, keepScroll);
    if (body.classList.contains('right-closed')) setPanel('right', true);
    else applyPadding();
    if (zoomIn) enterFocus();
    mapApi.highlight(clat, clon);
    if (fly) mapApi.flyTo(lat, lon, zoomIn ? Math.max(mapApi.map.getZoom(), FOCUS_ZOOM) : Math.max(mapApi.map.getZoom(), 5.5));
    updateHash();
  }

  function closeDossier() {
    if (!current) return;
    current = null;
    hideDossier();
    $('#list-view').classList.remove('hidden');
    body.classList.remove('dossier-open');
    exitFocus();
    applyPadding();
    updateHash();
  }

  function drawLegend(res: ScoreResult | null) {
    if (!res) {
      $('#legend-title').textContent = state.mode === 'direct' ? 'Analog score' : `Similarity baseline · ${modeInfo(state.mode).name}`;
      $('#legend-foot').textContent = 'Waiting for the scoring engine';
      return;
    }
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
    const title = state.mode === 'direct' ? 'Analog score' : 'Similarity baseline';
    $('#legend-title').textContent = `${title}${state.alpha > 0 ? ' + novelty' : ''} · ${shortName(app.target())}`;
    $('#legend-foot').textContent = `${res.stats.valid.toLocaleString()} cells re-scored in ${Math.round(res.timings.total)} ms`;
  }

  function onScored(res: ScoreResult) {
    if (!hasPositiveWeight(state.weights)) return;
    void mapApi.setScoreImage(res.image, res.width, res.height, res.blob);
    const list = $('#sites');
    list.innerHTML = res.sites.length ? '' : '<li class="empty-state"><b>No locations match these limits.</b><span>Remove a filter or reset the model to see candidates again.</span><button class="text-btn" id="empty-reset">Reset limits</button></li>';
    $('#empty-reset')?.addEventListener('click', () => {
      state.filters.forEach((f) => (f.on = false));
      state.geography = { countries: [], regions: [] };
      applyDefaultFilters(app.target());
      requestScore();
    });
    const span = Math.max(1e-6, res.stats.hi - res.stats.lo);
    const activityNote = state.mode === 'exploration' ? activityById(state.activity).candidateNote : '';
    let currentRank: number | undefined;
    res.sites.forEach((s, i) => {
      const c = app.countryName(s.country);
      const li = document.createElement('li');
      const isNew = s.noveltyKm > 500;
      const frac = Math.min(1, Math.max(0.04, (s.blended - res.stats.lo) / span));
      if (current && s.cell === current.cell) currentRank = i + 1;
      li.innerHTML = `<button class="site${currentRank === i + 1 ? ' active' : ''}" aria-label="${i + 1}. ${esc(c.name || 'Unknown')}, similarity ${(s.blended * 100).toFixed(1)} out of 100, ${fmtLatLon(s.lat, s.lon)}" title="${fmtKm(s.noveltyKm)} from the nearest known analog site">
        <span class="rank">${i + 1}</span>
        <span class="where"><span class="name">${flag(c.iso)} ${esc(c.name || 'Unknown')}${isNew ? '<span class="tag" title="More than 500 km from any known analog site">new</span>' : ''}</span>
        <span class="sub">${fmtLatLon(s.lat, s.lon)} · ${s.nCells > 1 ? `${Math.round(s.areaKm2).toLocaleString()} km²` : '1 cell'}${activityNote ? `<span class="activity-context">${esc(activityNote)}</span>` : ''}</span></span>
        <span class="score"><b>${(s.blended * 100).toFixed(1)}<small>/100</small></b><span class="score-bar"><i style="width:${(frac * 100).toFixed(0)}%"></i></span></span></button>`;
      const btn = li.firstElementChild as HTMLButtonElement;
      btn.onclick = () => selectSite(s, i);
      btn.onmouseenter = btn.onfocus = () => mapApi.pulseSite(i);
      btn.onmouseleave = btn.onblur = () => mapApi.pulseSite(null);
      list.appendChild(li);
    });
    $('#sites-sub').textContent = res.sites.length
      ? `Best ${res.sites.length} of ${res.stats.valid.toLocaleString()} land cells${state.region !== 'world' ? ` · ${REGIONS[state.region].name} only` : ''}. Similarity is scored from 0 to 100.`
      : 'No cells pass the current limits.';
    syncRegionChip();
    mapApi.setSites(res.sites, siteLabel, (s, i) => selectSite(s, i));
    drawLegend(res);
    // Keep an open dossier in step with new weights.
    if (current) void showCell(current.lat, current.lon, currentRank, false, true);
  }

  // ---------------------------------------------------------------- wire up
  buildLeft();
  applyDefaultFilters(app.target());
  root.style.setProperty('--inferno', cssGradient());
  $('#btn-about').onclick = () => renderAbout(app, showPlace);
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
    if (!current || !about.classList.contains('hidden') || /^(INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(tag)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const btn = document.getElementById(e.key === 'ArrowDown' ? 'd-next' : 'd-prev') as HTMLButtonElement | null;
      if (btn && !btn.disabled) {
        e.preventDefault();
        btn.click();
      }
    }
  });
  mapApi.onCellClick((lat, lon) => void showCell(lat, lon));
  mapApi.map.on('moveend', updateHash);

  // ---------------------------------------------------------------- right-panel tabs, discoveries, region
  const rtabs = document.querySelectorAll<HTMLButtonElement>('.rtabs button');
  function showRightTab(id: 'cand' | 'disc' | 'validation') {
    rtabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.r === id)));
    for (const k of ['cand', 'disc', 'validation']) $(`#rv-${k}`).classList.toggle('hidden', k !== id);
    if (id === 'validation') renderValidation($('#rv-validation'), ds, app.target().id, activityById(state.activity));
  }
  rtabs.forEach((b) => (b.onclick = () => showRightTab(b.dataset.r as 'cand' | 'disc' | 'validation')));
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
    const el = document.querySelector<HTMLButtonElement>(sel);
    if (el && !el.disabled) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.click();
    } else if (tries > 0) window.setTimeout(() => clickWhenReady(sel, tries - 1), 250);
  };
  const tour = createTour({
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
  $('#btn-tour').onclick = () => tour.start();

  await Promise.all([workerReady, mapApi.ready]);
  mapApi.setAnalogs(ds.analogs);
  // Apply a shared link (weights, filters, novelty, view) on top of the target defaults.
  if (link.w) {
    const weights = normalizeWeights(link.w);
    if (weights) state.weights = weights;
    else toast('The shared link contained invalid weights; target defaults were restored.');
  }
  if (link.x?.length === F && link.x.every((range) => range.min <= range.max)) {
    state.ranges = link.x.map((range) => ({ min: range.min, max: range.max }));
  } else if (link.x) {
    toast('The shared link contained invalid target ranges; target points were restored.');
  }
  if (link.f) {
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
  if (link.a) setAlphaUI(link.a);
  if (state.projection !== 'mercator') mapApi.setProjection(state.projection);
  if (state.basemap !== 'satellite') mapApi.setBasemap(state.basemap);
  syncTargetUI();
  if (link.v) mapApi.map.jumpTo({ center: [link.v.lon, link.v.lat], zoom: link.v.zoom });
  else if (state.region !== 'world') setRegion(state.region);
  const narrow = window.innerWidth < 900;
  setPanel('left', !narrow);
  setPanel('right', !narrow);
  window.addEventListener('resize', applyPadding);
  requestScore();
  if (link.s) void showCell(link.s.lat, link.s.lon, undefined, !link.v, false, true);
  if (link.tour) window.setTimeout(() => tour.start(), 800);
  $('#loader').classList.add('hidden');
  (window as unknown as { app: App }).app = app;
}

void main();
