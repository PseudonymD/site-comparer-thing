import './style.css';
import { loadDataset, type Dataset } from './data';
import { createMap, type MapApi } from './map';
import { cssGradient, infernoRgb } from './colormap';
import { zThresholdFromValue } from './scoring';
import { esc, flag, fmtKm, fmtLatLon, fmtValue, GROUP_COLORS } from './format';
import { renderDossier, hideDossier } from './ui/dossier';
import { fingerprint } from './ui/fingerprint';
import { renderAbout } from './about';
import type { CellInfo, ScoreRequest, ScoreResult, Site, Target } from './types';

interface FilterState {
  id: string; // feature id
  label: string;
  on: boolean;
  tau: number;
  step: number;
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
  let ds: Dataset;
  try {
    ds = await loadDataset(setProgress);
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
  const params = new URLSearchParams(location.hash.slice(1));
  const t0 = Math.max(0, targets.targets.findIndex((t) => t.id === params.get('t')));
  const state: AppState = {
    t: t0,
    weights: [...targets.targets[t0].weights],
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
    basemap: 'satellite',
    projection: 'mercator',
  };

  const mapApi = createMap($('#map'));
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
  };

  // ---------------------------------------------------------------- scoring loop
  let reqId = 0;
  let inFlight = false;
  let dirty = false;
  function buildRequest(): ScoreRequest {
    const t = app.target();
    return {
      type: 'score', id: ++reqId, target: t.vector, weights: state.weights,
      filters: state.filters.filter((f) => f.on).map((f) => {
        const fm = meta.features[featIndex(f.id)];
        return { feature: featIndex(f.id), zThreshold: zThresholdFromValue(fm.breakpoints, f.tau) };
      }),
      alpha: state.alpha, stretchLow: state.stretchLow, hideBelow: state.hideBelow, topN: 50,
    };
  }
  function requestScore() {
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

  // ---------------------------------------------------------------- UI: left panel
  const left = $('#left');
  const sliders: HTMLInputElement[] = [];
  const sliderVals: HTMLElement[] = [];
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
    const n = state.filters.filter((f) => f.on).length + (state.alpha > 0 ? 1 : 0);
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
      $(`#gsum-${g}`).textContent = `${n} layers · weight ${fmtW(sum)}`;
    }
  }

  function buildLeft() {
    const synth = meta.synthetic_features;
    left.innerHTML = `
      <div class="brief">
        <div class="brief-top">
          <div><div class="eyebrow" id="t-eyebrow"></div><h1 id="t-name"></h1></div>
          <div id="t-glyph"></div>
        </div>
        <p id="t-blurb"></p>
        <button class="text-btn" id="best-site">Fly to the best match</button>
      </div>
      ${synth.length ? `<div class="warn-box"><b>${synth.length} of ${F} layers ${synth.length > 1 ? 'are placeholders' : 'is a placeholder'}</b> in this build (${synth.map((s) => esc(meta.features[featIndex(s)].name)).join(', ')}). Treat rankings as illustrative.</div>` : ''}
      ${meta.bbox ? `<div class="warn-box">Regional build: only ${meta.bbox.join(', ')} is included.</div>` : ''}
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="weights" aria-selected="true">Weights</button>
        <button role="tab" data-tab="filters" aria-selected="false">Filters<span class="count" id="tab-filters-n"></span></button>
        <button role="tab" data-tab="view" aria-selected="false">View</button>
      </div>
      <div class="tab-body">
        <div class="pane" id="pane-weights">
          <div class="pane-intro"><p class="note">How much each layer counts, from 0 to 3. Under each name: the target's value and its Earth percentile (p0 lowest, p100 highest).</p><button class="text-btn" id="reset-w">Reset</button></div>
          <div id="weights"></div>
        </div>
        <div class="pane hidden" id="pane-filters">
          <h4>Leave out</h4>
          <p class="note">Cells past these limits score zero.</p>
          <div id="filters"></div>
          <h4>Favour new places <span class="mono" id="alpha-val"></span></h4>
          <input type="range" id="alpha" min="0" max="0.6" step="0.02" value="${state.alpha}">
          <p class="note">Mixes in distance from the ${ds.analogs.length} known analog sites (levels off at ${meta.novelty_saturation_km.toLocaleString()} km), so candidates nobody has used yet rise.</p>
        </div>
        <div class="pane hidden" id="pane-view">
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
        for (const id of ['weights', 'filters', 'view']) $(`#pane-${id}`).classList.toggle('hidden', id !== b.dataset.tab);
      };
    });

    // weights
    const wDiv = $('#weights');
    for (const g of groups) {
      const sec = document.createElement('details');
      sec.className = 'group';
      sec.open = true;
      sec.innerHTML = `<summary><i class="swatch" style="background:${GROUP_COLORS[g]}"></i><span>${g}</span><em id="gsum-${g}"></em></summary>`;
      meta.features.forEach((f, j) => {
        if (f.ui_group !== g) return;
        const row = document.createElement('div');
        row.className = 'wrow';
        const badge = f.synthetic ? '<span class="badge synth">placeholder</span>' : f.proxy ? '<span class="badge proxy">proxy</span>' : '';
        row.innerHTML = `<div class="wl"><label for="w-${f.id}">${esc(f.name)}${badge}</label><div class="tv"></div></div><input type="range" id="w-${f.id}" min="0" max="3" step="0.25"><span class="val"></span>`;
        const input = row.querySelector('input')!;
        input.addEventListener('input', () => {
          state.weights[j] = +input.value;
          sliderVals[j].textContent = fmtW(state.weights[j]);
          row.classList.toggle('off', state.weights[j] === 0);
          fill(input);
          syncGroupSums();
          requestScore();
        });
        sliders[j] = input;
        sliderVals[j] = row.querySelector('.val')!;
        targetLines[j] = row.querySelector('.tv')!;
        sec.appendChild(row);
      });
      wDiv.appendChild(sec);
    }
    $('#reset-w').onclick = () => {
      state.weights = [...app.target().weights];
      syncSliders();
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
    });
    seg('seg-base', () => state.basemap, (v) => {
      state.basemap = v as AppState['basemap'];
      mapApi.setBasemap(state.basemap);
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
    $('#t-eyebrow').textContent = `${t.body} · matching against`;
    $('#t-name').textContent = siteName(t);
    $('#t-blurb').textContent = t.blurb;
    $('#t-glyph').innerHTML = fingerprint(meta.features, t.vector, null, 84, `Fingerprint of ${t.name}: each spoke is one layer, longer means higher among Earth's land`);
    meta.features.forEach((f, j) => {
      const raw = t.raw[f.id];
      const pct = Math.round(t.vector[j] * 100);
      targetLines[j].innerHTML = raw.value === null
        ? `<span class="beyond">beyond Earth</span>`
        : raw.beyond_earth ? `${fmtValue(raw.value, f)} · <span class="beyond">beyond Earth</span>` : `${fmtValue(raw.value, f)} · p${pct}`;
      const tv = raw.value === null ? `beyond Earth's max (clamped to ${fmtValue(raw.clamped, f)})` : fmtValue(raw.value, f) + (raw.beyond_earth ? ` → clamped ${fmtValue(raw.clamped, f)}` : '');
      const lbl = left.querySelector(`label[for="w-${f.id}"]`) as HTMLElement;
      const tip = `${f.description}\nSource: ${f.source_name}${f.synthetic ? ' (placeholder data)' : ''}\nTarget value: ${tv} (higher than ${pct}% of Earth's land)`;
      lbl.title = tip;
      targetLines[j].title = tip;
    });
    mapApi.setTargetBody(t.body);
    syncSliders();
    history.replaceState(null, '', `#t=${t.id}`);
  }

  function syncSliders() {
    meta.features.forEach((_, j) => {
      sliders[j].value = String(state.weights[j]);
      sliderVals[j].textContent = fmtW(state.weights[j]);
      sliders[j].closest('.wrow')!.classList.toggle('off', state.weights[j] === 0);
      fill(sliders[j]);
    });
    syncGroupSums();
  }

  function selectTarget(i: number) {
    state.t = i;
    state.weights = [...targets.targets[i].weights];
    applyDefaultFilters(targets.targets[i]);
    syncTargetUI();
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
  }

  function closeDossier() {
    if (!current) return;
    current = null;
    hideDossier();
    $('#list-view').classList.remove('hidden');
    body.classList.remove('dossier-open');
    exitFocus();
    applyPadding();
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
    $('#legend-foot').textContent = `${res.stats.valid.toLocaleString()} cells re-scored in ${Math.round(res.timings.total)} ms`;
  }

  function onScored(res: ScoreResult) {
    void mapApi.setScoreImage(res.image, res.width, res.height, res.blob);
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
      ? `Best ${res.sites.length} of ${res.stats.valid.toLocaleString()} land cells. Score out of 100.`
      : 'No cells pass the current filters. Loosen one in Filters.';
    mapApi.setSites(res.sites, siteLabel, (s, i) => selectSite(s, i));
    drawLegend(res);
    // Keep an open dossier in step with new weights.
    if (current) void showCell(current.lat, current.lon, currentRank, false, true);
  }

  // ---------------------------------------------------------------- wire up
  buildLeft();
  applyDefaultFilters(app.target());
  root.style.setProperty('--inferno', cssGradient());
  $('#btn-about').onclick = () => renderAbout(app);
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
      if (!about.classList.contains('hidden')) about.classList.add('hidden');
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

  await Promise.all([workerReady, mapApi.ready]);
  mapApi.setAnalogs(ds.analogs);
  syncTargetUI();
  const narrow = window.innerWidth < 900;
  setPanel('left', !narrow);
  setPanel('right', !narrow);
  window.addEventListener('resize', applyPadding);
  requestScore();
  $('#loader').classList.add('hidden');
  (window as unknown as { app: App }).app = app;
}

void main();
