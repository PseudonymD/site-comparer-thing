/// <reference lib="webworker" />
// Scoring worker: holds the uint8 feature matrix, re-scores every land cell on demand, paints the
// Web-Mercator score image and extracts the top-N candidate sites.
import { blend, buildLut, exclusionScale, haversineKm, noSoilMask, scoreAll, type Exclusion, type Filter } from './scoring';
import { buildColormap } from './colormap';
import { isSelected } from './population';
import type { AnalogCheck, ScoreRequest, ScoreResult, Site, WorkerInit, CellInfo } from './types';

let F = 18;
let q: Uint8Array;
let cells: Uint32Array;
let countries: Uint8Array;
let nLon = 3600;
let nLat = 1800;
let res = 0.1;
let dist: Float32Array; // km to nearest known analog per land cell
let scores: Float32Array;
let blended: Float32Array;
let colorIdx: Uint8Array; // per full-grid cell, 0 = no data
let rowMap: Int32Array; // mercator output row -> grid row (-1 = outside)
let imgW = 0;
let imgH = 0;
let lut32: Uint32Array;
let included: Uint8Array;
let noSoil: Uint8Array | null = null; // 1 = no soil data here (pipeline wrote 0): soil layers are not applicable
let soilFeatures: number[] = [];
let satKm = 2000;
const MAX_MERC_LAT = 85.0511287798;

function init(msg: WorkerInit) {
  F = msg.nFeatures;
  q = new Uint8Array(msg.features);
  cells = new Uint32Array(msg.cells);
  countries = new Uint8Array(msg.countries);
  nLon = msg.nLon;
  nLat = msg.nLat;
  res = msg.res;
  satKm = msg.noveltySaturationKm;
  const n = cells.length;
  scores = new Float32Array(n);
  blended = new Float32Array(n);
  included = new Uint8Array(n);
  colorIdx = new Uint8Array(nLon * nLat);
  buildNoSoilMask(msg.noSoil);
  // Novelty distances (once).
  dist = new Float32Array(n);
  const an = msg.analogs;
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const r = (c / nLon) | 0;
    const col = c - r * nLon;
    const lat = 90 - (r + 0.5) * res;
    const lon = -180 + (col + 0.5) * res;
    let best = Infinity;
    for (const a of an) {
      // Cheap reject on latitude before the trig.
      if (Math.abs(a.lat - lat) * 111.2 > best) continue;
      const d = haversineKm(lat, lon, a.lat, a.lon);
      if (d < best) best = d;
    }
    dist[i] = best;
  }
  // Mercator image: square, width = nLon (one column per grid column).
  imgW = nLon;
  imgH = Math.min(nLon, 4096);
  rowMap = new Int32Array(imgH);
  for (let y = 0; y < imgH; y++) {
    const my = Math.PI * (1 - (2 * (y + 0.5)) / imgH);
    const lat = (Math.atan(Math.sinh(my)) * 180) / Math.PI;
    const r = Math.floor((90 - lat) / res);
    rowMap[y] = Math.abs(lat) <= MAX_MERC_LAT && r >= 0 && r < nLat ? r : -1;
  }
  lut32 = buildColormap();
  (self as unknown as Worker).postMessage({ type: 'ready', nCells: n });
}

function buildNoSoilMask(spec: WorkerInit['noSoil']) {
  noSoil = null;
  soilFeatures = [];
  if (!spec || !spec.features.length) return;
  const mask = noSoilMask(q, F, cells.length, spec.features, spec.breakpoints);
  if (mask) {
    noSoil = mask;
    soilFeatures = spec.features;
  }
}
function percentileFromHist(hist: Uint32Array, total: number, p: number): number {
  const target = total * p;
  let acc = 0;
  for (let b = 0; b < hist.length; b++) {
    acc += hist[b];
    if (acc >= target) return b / (hist.length - 1);
  }
  return 1;
}

async function encode(img: Uint8ClampedArray, w: number, h: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  if (!g) return null;
  g.putImageData(new ImageData(img as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return await c.convertToBlob({ type: 'image/png' });
}

function score(req: ScoreRequest): ScoreResult {
  const t0 = performance.now();
  const n = cells.length;
  const filters: Filter[] = req.filters;
  const lut = buildLut(req.target, req.weights, filters);
  const excl: Exclusion | undefined = noSoil ? { mask: noSoil, features: soilFeatures, scale: exclusionScale(req.weights, soilFeatures) } : undefined;
  scoreAll(q, F, lut, scores, excl);
  const a = req.alpha;
  const HB = 2048;
  const hist = new Uint32Array(HB);
  const bbox = req.bbox ?? null;
  const countryIds = req.countryIds === null || req.countryIds === undefined ? null : new Set(req.countryIds);
  let valid = 0;
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const r = (c / nLon) | 0;
    const lat = 90 - (r + 0.5) * res;
    const lon = -180 + (c - r * nLon + 0.5) * res;
    const selected = isSelected(lat, lon, countries[i], bbox, countryIds);
    included[i] = selected ? 1 : 0;
    if (!selected) {
      scores[i] = 0;
      blended[i] = 0;
      continue;
    }
    const s = scores[i];
    const b = a > 0 ? blend(s, dist[i], a, satKm) : s;
    blended[i] = b;
    if (s > 0) {
      const bin = Math.min(HB - 1, Math.max(0, Math.round(b * (HB - 1))));
      hist[bin]++;
      valid++;
    }
  }
  const tScore = performance.now();

  // Colour stretch: [p_lo, max] of valid cells.
  const lo = percentileFromHist(hist, valid, req.stretchLow);
  const hi = Math.max(lo + 1e-6, percentileFromHist(hist, valid, 0.9999));
  const scale = 254 / (hi - lo);
  colorIdx.fill(0);
  for (let i = 0; i < n; i++) {
    const b = blended[i];
    if (b <= 0) continue;
    if (!included[i]) continue;
    let v = Math.round((b - lo) * scale);
    if (v < 0) {
      if (req.hideBelow) continue;
      v = 0;
    }
    colorIdx[cells[i]] = 1 + (v > 254 ? 254 : v);
  }
  const img = new Uint8ClampedArray(imgW * imgH * 4);
  const px = new Uint32Array(img.buffer);
  for (let y = 0; y < imgH; y++) {
    const r = rowMap[y];
    if (r < 0) continue;
    const src = r * nLon;
    const dst = y * imgW;
    for (let x = 0; x < imgW; x++) {
      const ci = colorIdx[src + x];
      if (ci) px[dst + x] = lut32[ci];
    }
  }
  const tImg = performance.now();

  const sites = topSites(hist, valid, req.topN, included);
  const check = req.check?.length ? analogCheck(req, excl) : undefined;
  const t1 = performance.now();
  return {
    type: 'scored', id: req.id, image: img, width: imgW, height: imgH, sites,
    stats: { lo, hi, valid, p50: percentileFromHist(hist, valid, 0.5), p99: percentileFromHist(hist, valid, 0.99) },
    hist, check,
    timings: { score: tScore - t0, image: tImg - tScore, sites: t1 - tImg, encode: 0, total: t1 - t0 },
    blob: null,
  };
}

let plain: Float32Array | null = null;
/** Position of a grid index in the land-cell list, or -1. */
function posOfGrid(gridIndex: number): number {
  let lo = 0;
  let hi = cells.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = cells[mid];
    if (v === gridIndex) return mid;
    if (v < gridIndex) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
const NEIGHBOURHOOD = 2; // pipeline/validate.py: a site's score is the best land cell within ±2 cells
const N_RANDOM = 1000;
/** Best score among land cells within ±NEIGHBOURHOOD of a grid index (longitude wraps); NaN if none. */
function siteScore(s: Float32Array, gridIndex: number): number {
  const r = (gridIndex / nLon) | 0;
  const c = gridIndex - r * nLon;
  let best = NaN;
  for (let dr = -NEIGHBOURHOOD; dr <= NEIGHBOURHOOD; dr++) {
    const rr = r + dr;
    if (rr < 0 || rr >= nLat) continue;
    for (let dc = -NEIGHBOURHOOD; dc <= NEIGHBOURHOOD; dc++) {
      const p = posOfGrid(rr * nLon + ((c + dc + nLon) % nLon));
      if (p >= 0 && !(s[p] <= best)) best = s[p];
    }
  }
  return best;
}
let randomCells: number[] | null = null;
/** A fixed sample of land cells (deterministic, like the pipeline's seeded sample). */
function sampleCells(): number[] {
  if (randomCells) return randomCells;
  const n = cells.length;
  const k = Math.min(N_RANDOM, n);
  const picked = new Set<number>();
  let x = 42;
  while (picked.size < k) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    picked.add(x % n);
  }
  randomCells = [...picked].map((p) => cells[p]);
  return randomCells;
}
const sameFilters = (a: Filter[], b: Filter[]) =>
  a.length === b.length && a.every((f, i) => f.feature === b[i].feature && f.zThreshold === b[i].zThreshold);
/**
 * Where do this target's known analogs rank, under the current weights? Same definition as the pipeline's
 * validation (pipeline/validate.py): all land cells, the target's default filters, no novelty, a site's score is
 * the best cell within ±2 cells, AUC is the Mann-Whitney AUC against a fixed sample of random land cells, and
 * an analog's percentile is the share of land cells scoring at or below it.
 */
function analogCheck(req: ScoreRequest, excl: Exclusion | undefined): AnalogCheck {
  const n = cells.length;
  const checkFilters = req.checkFilters ?? [];
  let s: Float32Array;
  if (!req.bbox && !req.countryIds && sameFilters(req.filters, checkFilters)) {
    s = scores; // the main pass already scored every cell exactly this way
  } else {
    if (!plain) plain = new Float32Array(n);
    scoreAll(q, F, buildLut(req.target, req.weights, checkFilters), plain, excl);
    s = plain;
  }
  const pos = req.check!.map((g) => siteScore(s, g));
  const atOrBelow = new Array<number>(pos.length).fill(0);
  for (let i = 0; i < n; i++) {
    const v = s[i];
    for (let k = 0; k < pos.length; k++) if (v <= pos[k]) atOrBelow[k]++;
  }
  const pct = pos.map((v, k) => (Number.isNaN(v) ? NaN : (atOrBelow[k] / n) * 100));
  const neg = sampleCells().map((g) => siteScore(s, g)).filter((v) => !Number.isNaN(v));
  const okPos = pos.filter((v) => !Number.isNaN(v));
  let wins = 0;
  for (const p of okPos) for (const v of neg) wins += p > v ? 1 : p === v ? 0.5 : 0;
  const ok = pct.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  const mid = ok.length ? (ok.length % 2 ? ok[(ok.length - 1) / 2] : (ok[ok.length / 2 - 1] + ok[ok.length / 2]) / 2) : NaN;
  return { auc: okPos.length && neg.length ? wins / (okPos.length * neg.length) : NaN, medianPercentile: mid, analogs: pct };
}
function topSites(hist: Uint32Array, valid: number, topN: number, population: Uint8Array): Site[] {
  // Candidate cells: roughly the best 6000 (threshold from the histogram).
  const want = Math.min(6000, valid);
  let acc = 0;
  let thr = 0;
  for (let b = hist.length - 1; b >= 0; b--) {
    acc += hist[b];
    if (acc >= want) {
      thr = b / (hist.length - 1);
      break;
    }
  }
  const cand: number[] = [];
  for (let i = 0; i < blended.length; i++) if (population[i] && blended[i] >= thr && scores[i] > 0) cand.push(i);
  cand.sort((x, y) => blended[y] - blended[x]);
  if (cand.length > 8000) cand.length = 8000;
  // Union-find over 8-neighbour adjacency (longitude wraps).
  const pos = new Map<number, number>();
  cand.forEach((ci, k) => pos.set(cells[ci], k));
  const parent = new Int32Array(cand.length).map((_, k) => k);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let k = 0; k < cand.length; k++) {
    const g = cells[cand[k]];
    const r = (g / nLon) | 0;
    const c = g - r * nLon;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= nLat) continue;
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const cc = (c + dc + nLon) % nLon;
        const other = pos.get(rr * nLon + cc);
        if (other !== undefined) {
          const ra = find(k);
          const rb = find(other);
          if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); // root = best-scoring member
        }
      }
    }
  }
  const groups = new Map<number, { best: number; count: number; sumLat: number; sumLon: number }>();
  for (let k = 0; k < cand.length; k++) {
    const root = find(k);
    const g = cells[cand[k]];
    const r = (g / nLon) | 0;
    const lat = 90 - (r + 0.5) * res;
    const lon = -180 + (g - r * nLon + 0.5) * res;
    const e = groups.get(root);
    if (e) {
      e.count++;
      e.sumLat += lat;
      e.sumLon += lon;
    } else groups.set(root, { best: cand[k], count: 1, sumLat: lat, sumLon: lon });
  }
  const out: Site[] = [];
  const roots = [...groups.keys()].sort((x, y) => x - y); // root index = rank of best member
  for (const root of roots) {
    const e = groups.get(root)!;
    const ci = e.best;
    const g = cells[ci];
    const r = (g / nLon) | 0;
    out.push({
      pos: ci, cell: g,
      lat: 90 - (r + 0.5) * res, lon: -180 + (g - r * nLon + 0.5) * res,
      score: scores[ci], blended: blended[ci], noveltyKm: dist[ci], nCells: e.count,
      areaKm2: e.count * (111.2 * res) ** 2 * Math.cos(((90 - (r + 0.5) * res) * Math.PI) / 180),
      country: countries[ci],
    });
    if (out.length >= topN) break;
  }
  return out;
}

function cellInfo(gridIndex: number): CellInfo | null {
  // Binary search in the sorted land-cell list.
  let lo = 0;
  let hi = cells.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = cells[mid];
    if (v === gridIndex) {
      return {
        pos: mid, cell: v, q: Array.from(q.subarray(mid * F, mid * F + F)), noveltyKm: dist[mid],
        country: countries[mid], score: scores ? scores[mid] : 0, blended: blended ? blended[mid] : 0, included: !!included[mid],
        excluded: noSoil && noSoil[mid] ? soilFeatures : [],
      };
    }
    if (v < gridIndex) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'init') init(msg as WorkerInit);
  else if (msg.type === 'score') {
    let r: ScoreResult;
    try {
      r = score(msg as ScoreRequest);
    } catch (e) {
      // Always answer, so the main thread's request pump never waits forever.
      (self as unknown as Worker).postMessage({ type: 'score-error', id: msg.id, message: (e as Error).message });
      return;
    }
    const t = performance.now();
    void encode(r.image, r.width, r.height)
      .catch(() => null)
      .then((blob) => {
        r.blob = blob;
        r.timings.encode = performance.now() - t;
        r.timings.total += r.timings.encode;
        const transfer: Transferable[] = [r.hist.buffer];
        if (blob) r.image = new Uint8ClampedArray(0);
        else transfer.push(r.image.buffer);
        (self as unknown as Worker).postMessage(r, transfer);
      });
  } else if (msg.type === 'cell') {
    (self as unknown as Worker).postMessage({ type: 'cell', id: msg.id, info: cellInfo(msg.gridIndex) });
  }
};
