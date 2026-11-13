import './style.css';
import { loadDataset, type Dataset } from './data';
import { createMap, type MapApi } from './map';
import { cssGradient } from './colormap';
import { zThresholdFromValue } from './scoring';
import { esc, flag, fmtKm, fmtLatLon, fmtValue, GROUP_COLORS } from './format';
import { openCard, closeCard } from './card';
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
  $('#progress-label').textContent = 'preparing scoring worker…';
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

  // ---------------------------------------------------------------- UI: top tabs
  const tabs = $('#target-tabs');
  targets.targets.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = `target-tab ${t.body.toLowerCase()}`;
    b.innerHTML = `<span class="body">${t.body === 'Moon' ? '☾' : '♂'}</span>${esc(t.name.replace(/^(Moon|Mars) – /, ''))}`;
    b.title = t.name;
    b.onclick = () => selectTarget(i);
    tabs.appendChild(b);
  });

  // ---------------------------------------------------------------- UI: left panel
  const left = $('#left');
  const sliders: HTMLInputElement[] = [];
  const sliderVals: HTMLElement[] = [];
  function buildLeft() {
    const synth = meta.synthetic_features;
    const groups = ['Terrain', 'Climate', 'Surface', 'Remoteness'] as const;
    left.innerHTML = `
      <div class="target-card" id="target-card"></div>
      ${synth.length ? `<div class="warn-box">⚠️ <b>${synth.length} of ${F} layers are synthetic placeholders</b> in this build (${synth.map((s) => meta.features[featIndex(s)].name).join(', ')}). Rankings are illustrative until the full data pipeline output is published.</div>` : ''}
      ${meta.bbox ? `<div class="warn-box">Regional build: only ${meta.bbox.join(', ')} is included.</div>` : ''}
      <div id="weights"></div>
      <div class="section"><div class="section-head"><h4>Hard filters</h4></div><div id="filters"></div></div>
      <div class="section"><div class="section-head"><h4>Novelty</h4><span class="muted small mono" id="alpha-val"></span></div>
        <input type="range" id="alpha" min="0" max="0.6" step="0.02" value="${state.alpha}">
        <div class="muted small" style="margin-top:4px">Blend in distance from the 16 known analog sites (saturates at ${meta.novelty_saturation_km.toLocaleString()} km) to surface <i>new</i> candidates.</div>
      </div>
      <div class="section"><div class="section-head"><h4>Display</h4></div>
        <div class="toggle-row"><span>Colour from Earth percentile</span><span class="mono small" id="stretch-val"></span></div>
        <input type="range" id="stretch" min="0" max="0.99" step="0.01" value="${state.stretchLow}">
        <div class="toggle-row"><label><input type="checkbox" id="hide-below"> Hide cells below that percentile</label></div>
        <div class="toggle-row"><span>Score layer opacity</span><span class="mono small" id="opacity-val"></span></div>
        <input type="range" id="opacity" min="0.1" max="1" step="0.05" value="${state.opacity}">
      </div>
      <div class="muted small" style="margin-top:18px">Data built ${esc(meta.generated.slice(0, 10))} · ${meta.n_cells.toLocaleString()} land cells at ${meta.grid.res}°</div>`;
    const wDiv = $('#weights');
    for (const g of groups) {
      const sec = document.createElement('div');
      sec.className = 'section';
      sec.innerHTML = `<div class="section-head"><h4><span class="swatch" style="background:${GROUP_COLORS[g]}"></span>${g}</h4></div>`;
      meta.features.forEach((f, j) => {
        if (f.ui_group !== g) return;
        const row = document.createElement('div');
        row.className = 'slider-row';
        const badge = f.synthetic ? '<span class="badge synth">SYNTH</span>' : f.proxy ? '<span class="badge proxy">PROXY</span>' : '';
        row.innerHTML = `<label for="w-${f.id}">${esc(f.name)}${badge}</label><input type="range" id="w-${f.id}" min="0" max="3" step="0.25"><span class="val"></span>`;
        const input = row.querySelector('input')!;
        input.addEventListener('input', () => {
          state.weights[j] = +input.value;
          sliderVals[j].textContent = state.weights[j].toFixed(2).replace(/0$/, '');
          requestScore();
        });
        sliders[j] = input;
        sliderVals[j] = row.querySelector('.val')!;
        sec.appendChild(row);
      });
      wDiv.appendChild(sec);
    }
    const fDiv = $('#filters');
    state.filters.forEach((flt) => {
      const fm = meta.features[featIndex(flt.id)];
      const row = document.createElement('div');
      row.className = 'filter-row';
      const unit = fm.unit === 'fraction' ? '' : fm.unit ? ` ${fm.unit}` : '';
      row.innerHTML = `<input type="checkbox" ${flt.on ? 'checked' : ''}><span>${esc(flt.label)}<span class="muted">${esc(unit)}</span></span><input type="number" step="${flt.step}" value="${flt.tau}">`;
      const [cb, num] = row.querySelectorAll('input');
      cb.addEventListener('change', () => {
        flt.on = (cb as HTMLInputElement).checked;
        requestScore();
      });
      num.addEventListener('change', () => {
        flt.tau = +(num as HTMLInputElement).value;
        if (flt.on) requestScore();
      });
      fDiv.appendChild(row);
    });
    const alpha = $<HTMLInputElement>('#alpha');
    alpha.addEventListener('input', () => {
      state.alpha = +alpha.value;
      $('#alpha-val').textContent = state.alpha.toFixed(2);
      requestScore();
    });
    $('#alpha-val').textContent = state.alpha.toFixed(2);
    const stretch = $<HTMLInputElement>('#stretch');
    const updStretch = () => ($('#stretch-val').textContent = `≥ p${Math.round(state.stretchLow * 100)}`);
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
    const updOp = () => ($('#opacity-val').textContent = `${Math.round(state.opacity * 100)}%`);
    op.addEventListener('input', () => {
      state.opacity = +op.value;
      updOp();
      mapApi.setOpacity(state.opacity);
    });
    updOp();
  }

  function syncTargetUI() {
    const t = app.target();
    tabs.querySelectorAll('.target-tab').forEach((el, i) => el.classList.toggle('active', i === state.t));
    $('#target-card').innerHTML = `
      <h3>${esc(t.name)}</h3><p>${esc(t.blurb)}</p>
      <div class="row"><button class="btn small ghost" id="reset-w">Reset weights</button><button class="btn small ghost" id="best-site">Fly to best match</button></div>`;
    $('#reset-w').onclick = () => {
      state.weights = [...t.weights];
      syncSliders();
      requestScore();
    };
    $('#best-site').onclick = () => {
      const s = lastResult?.sites[0];
      if (s) selectSite(s, 0);
    };
    meta.features.forEach((f, j) => {
      const raw = t.raw[f.id];
      const tv = raw.value === null ? `beyond Earth's max (clamped to ${fmtValue(raw.clamped, f)})` : fmtValue(raw.value, f) + (raw.beyond_earth ? ` → clamped ${fmtValue(raw.clamped, f)}` : '');
      const lbl = left.querySelector(`label[for="w-${f.id}"]`) as HTMLElement;
      if (lbl) lbl.title = `${f.description}\nSource: ${f.source_name}${f.synthetic ? ' (SYNTHETIC)' : ''}\nTarget value: ${tv} (Earth percentile ${(t.vector[j] * 100).toFixed(0)})`;
    });
    mapApi.setTargetBody(t.body);
    syncSliders();
    history.replaceState(null, '', `#t=${t.id}`);
  }

  function syncSliders() {
    meta.features.forEach((_, j) => {
      sliders[j].value = String(state.weights[j]);
      sliderVals[j].textContent = state.weights[j].toFixed(2).replace(/0$/, '');
    });
  }

  function selectTarget(i: number) {
    state.t = i;
    state.weights = [...targets.targets[i].weights];
    // Ice targets should not exclude ice.
    const ice = state.filters.find((f) => f.id === 'ice')!;
    if (state.weights[featIndex('ice')] > 0 && ice.on) ice.on = false;
    syncTargetUI();
    closeCard();
    requestScore();
  }

  // ---------------------------------------------------------------- UI: right panel / legend
  function siteLabel(s: Site) {
    const c = app.countryName(s.country);
    return `${c.name || 'Unknown'} · ${fmtLatLon(s.lat, s.lon)}`;
  }

  function selectSite(s: Site, i: number) {
    document.querySelectorAll('.site').forEach((el, k) => el.classList.toggle('active', k === i));
    mapApi.flyTo(s.lat, s.lon, Math.max(mapApi.map.getZoom(), 5.5));
    void showCell(s.lat, s.lon, i + 1);
  }

  async function showCell(lat: number, lon: number, rank?: number) {
    const info = await app.requestCell(lat, lon);
    if (!info) {
      toast('No land cell here (ocean or outside the data).');
      return;
    }
    const r = Math.floor(info.cell / meta.grid.n_lon);
    const c = info.cell - r * meta.grid.n_lon;
    const clat = 90 - (r + 0.5) * meta.grid.res;
    const clon = -180 + (c + 0.5) * meta.grid.res;
    mapApi.highlight(clat, clon);
    openCard(app, info, clat, clon, rank);
  }

  function onScored(res: ScoreResult) {
    void mapApi.setScoreImage(res.image, res.width, res.height, res.blob);
    const list = $('#sites');
    list.innerHTML = '';
    res.sites.forEach((s, i) => {
      const c = app.countryName(s.country);
      const li = document.createElement('li');
      li.className = 'site';
      const isNew = s.noveltyKm > 500;
      li.innerHTML = `<span class="rank">${i + 1}</span>
        <div><div class="name">${flag(c.iso)} ${esc(c.name || 'Unknown')}</div>
        <div class="sub">${fmtLatLon(s.lat, s.lon)} · ${s.nCells > 1 ? `${Math.round(s.areaKm2).toLocaleString()} km²` : '1 cell'}</div></div>
        <div><div class="score">${(s.blended * 100).toFixed(1)}</div><div class="nov ${isNew ? 'new-tag' : ''}">${isNew ? 'new · ' : ''}${fmtKm(s.noveltyKm)}</div></div>`;
      li.onclick = () => selectSite(s, i);
      list.appendChild(li);
    });
    $('#sites-sub').textContent = `${res.sites.length} sites from ${res.stats.valid.toLocaleString()} scored cells · score ×100 · km to nearest known analog`;
    mapApi.setSites(res.sites, siteLabel, (s, i) => selectSite(s, i));
    $('#legend-lo').textContent = (res.stats.lo * 100).toFixed(1);
    $('#legend-hi').textContent = (res.stats.hi * 100).toFixed(1);
    $('#legend-title').textContent = state.alpha > 0 ? `Analog score + novelty (${app.target().body})` : `Analog score – ${app.target().name.replace(/^(Moon|Mars) – /, '')}`;
    $('#legend-foot').textContent = `median ${(res.stats.p50 * 100).toFixed(1)} · p99 ${(res.stats.p99 * 100).toFixed(1)} · re-scored ${res.stats.valid.toLocaleString()} cells in ${Math.round(res.timings.total)} ms`;
  }

  // ---------------------------------------------------------------- wire up
  buildLeft();
  $('#legend-bar').style.background = cssGradient();
  $('#btn-about').onclick = () => renderAbout(app);
  $('#btn-basemap').onclick = () => {
    state.basemap = state.basemap === 'satellite' ? 'dark' : 'satellite';
    mapApi.setBasemap(state.basemap);
    $('#btn-basemap').textContent = state.basemap === 'satellite' ? 'Dark map' : 'Satellite';
  };
  $('#btn-projection').onclick = () => {
    state.projection = state.projection === 'globe' ? 'mercator' : 'globe';
    mapApi.setProjection(state.projection);
    $('#btn-projection').textContent = state.projection === 'globe' ? 'Flat map' : 'Globe';
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCard();
      $('#about').classList.add('hidden');
    }
  });
  mapApi.onCellClick((lat, lon) => void showCell(lat, lon));

  await Promise.all([workerReady, mapApi.ready]);
  mapApi.setAnalogs(ds.analogs);
  syncTargetUI();
  requestScore();
  $('#loader').classList.add('hidden');
  (window as unknown as { app: App }).app = app;
}

void main();
