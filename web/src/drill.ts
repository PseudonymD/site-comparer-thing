// Live high-resolution terrain drill-down: fetch Terrarium z12 tiles (~30 m) around a site, compute
// slope and TRI in the browser and compare the slope distribution with the target's literature-based
// high-resolution slope histogram.
import type { Target } from './types';
import { infernoRgb } from './colormap';

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const BOX_KM = 20;
const EARTH_CIRC = 2 * Math.PI * 6378137;

const lonToPx = (lon: number, z: number) => ((lon + 180) / 360) * 256 * 2 ** z;
const latToPx = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z;
};
const pxToLat = (py: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * py) / (256 * 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
};

/** Zoom whose pixels are ~30 m at this latitude (Terrarium z12 at the equator), clamped to 9..13. */
export function zoomFor30m(lat: number): number {
  const z = Math.log2((EARTH_CIRC * Math.max(0.05, Math.cos((lat * Math.PI) / 180))) / (256 * 30));
  return Math.min(13, Math.max(9, Math.round(z)));
}

let Z = 12;

async function loadTile(x: number, y: number): Promise<Float32Array> {
  const n = 2 ** Z;
  const url = TILE_URL.replace('{z}', String(Z)).replace('{x}', String(((x % n) + n) % n)).replace('{y}', String(y));
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`tile ${x},${y}: HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = new OffscreenCanvas(256, 256);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, 256, 256).data;
  const out = new Float32Array(256 * 256);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  return out;
}

export interface DrillResult {
  slopeHist: number[];
  triHist: number[];
  triEdges: number[];
  medianSlope: number;
  p90Slope: number;
  fracBelow5: number;
  fracBelow15: number;
  relief: number;
  pixelM: number;
  n: number;
}

function quantile(sorted: Float32Array, p: number) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

export async function runDrill(lat: number, lon: number, target: Target, out: HTMLElement): Promise<void> {
  out.innerHTML = '<div class="muted small" style="margin-top:8px">Fetching ~30 m elevation tiles…</div>';
  try {
    Z = zoomFor30m(lat);
    const dLat = BOX_KM / 2 / 111.2;
    const dLon = BOX_KM / 2 / (111.2 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
    const latN = Math.min(85, lat + dLat);
    const latS = Math.max(-85, lat - dLat);
    const px0 = Math.floor(lonToPx(lon - dLon, Z)) - 1;
    const px1 = Math.ceil(lonToPx(lon + dLon, Z)) + 1;
    const py0 = Math.floor(latToPx(latN, Z)) - 1;
    const py1 = Math.ceil(latToPx(latS, Z)) + 1;
    const W = px1 - px0;
    const H = py1 - py0;
    if (W * H > 1400 * 1400) throw new Error('box too large at this latitude');
    const elev = new Float32Array(W * H).fill(NaN);
    const tiles: Promise<void>[] = [];
    for (let ty = Math.floor(py0 / 256); ty <= Math.floor((py1 - 1) / 256); ty++) {
      for (let tx = Math.floor(px0 / 256); tx <= Math.floor((px1 - 1) / 256); tx++) {
        tiles.push(
          loadTile(tx, ty).then((t) => {
            for (let yy = 0; yy < 256; yy++) {
              const gy = ty * 256 + yy - py0;
              if (gy < 0 || gy >= H) continue;
              for (let xx = 0; xx < 256; xx++) {
                const gx = tx * 256 + xx - px0;
                if (gx < 0 || gx >= W) continue;
                elev[gy * W + gx] = t[yy * 256 + xx];
              }
            }
          }),
        );
      }
    }
    await Promise.all(tiles);
    out.innerHTML = '<div class="muted small" style="margin-top:8px">Computing slope and roughness…</div>';

    // Slope, TRI, hillshade for interior pixels.
    const iw = W - 2;
    const ih = H - 2;
    const slope = new Float32Array(iw * ih);
    const tri = new Float32Array(iw * ih);
    const shade = new Float32Array(iw * ih);
    let emin = Infinity;
    let emax = -Infinity;
    const az = (315 * Math.PI) / 180;
    const alt = (45 * Math.PI) / 180;
    let pixelM = 0;
    for (let y = 1; y < H - 1; y++) {
      const plat = pxToLat(py0 + y + 0.5, Z);
      const pm = (EARTH_CIRC / (256 * 2 ** Z)) * Math.cos((plat * Math.PI) / 180);
      pixelM += pm;
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const e = Math.max(0, elev[i]);
        const ex1 = Math.max(0, elev[i + 1]);
        const ex0 = Math.max(0, elev[i - 1]);
        const ey1 = Math.max(0, elev[i + W]);
        const ey0 = Math.max(0, elev[i - W]);
        const dzdx = (ex1 - ex0) / (2 * pm);
        const dzdy = (ey1 - ey0) / (2 * pm);
        const sl = Math.atan(Math.hypot(dzdx, dzdy));
        const o = (y - 1) * iw + (x - 1);
        slope[o] = (sl * 180) / Math.PI;
        let tsum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) tsum += Math.abs(Math.max(0, elev[i + dy * W + dx]) - e);
        tri[o] = tsum / 8;
        const aspect = Math.atan2(dzdy, -dzdx);
        shade[o] = Math.max(0, Math.sin(alt) * Math.cos(sl) + Math.cos(alt) * Math.sin(sl) * Math.cos(az - aspect));
        if (e < emin) emin = e;
        if (e > emax) emax = e;
      }
    }
    pixelM /= H - 2;
    const edges = target.slope_hist.edges;
    const nb = edges.length - 1;
    const sh = new Array(nb).fill(0);
    let below5 = 0;
    let below15 = 0;
    for (const s of slope) {
      let b = Math.floor(s / (edges[1] - edges[0]));
      if (b >= nb) b = nb - 1;
      sh[b]++;
      if (s < 5) below5++;
      if (s < 15) below15++;
    }
    const n = slope.length;
    const sortedS = Float32Array.from(slope).sort();
    const sortedT = Float32Array.from(tri).sort();
    const triMax = Math.max(5, quantile(sortedT, 0.99));
    const tEdges = Array.from({ length: 21 }, (_, k) => (triMax * k) / 20);
    const th = new Array(20).fill(0);
    for (const v of tri) th[Math.min(19, Math.floor((v / triMax) * 20))]++;
    const result: DrillResult = {
      slopeHist: sh.map((c) => c / n), triHist: th.map((c) => c / n), triEdges: tEdges,
      medianSlope: quantile(sortedS, 0.5), p90Slope: quantile(sortedS, 0.9),
      fracBelow5: below5 / n, fracBelow15: below15 / n, relief: emax - emin, pixelM, n,
    };
    render(out, result, target, shade, slope, iw, ih);
  } catch (e) {
    out.innerHTML = `<div class="beyond small" style="margin-top:8px">Drill-down failed: ${(e as Error).message}</div>`;
  }
}

function overlap(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

function render(out: HTMLElement, r: DrillResult, t: Target, shade: Float32Array, slope: Float32Array, w: number, h: number) {
  const th = t.slope_hist;
  const sim = overlap(r.slopeHist, th.probs);
  out.innerHTML = `
    <div class="drill-grid" style="margin-top:10px">
      <div><canvas id="drill-canvas" width="${w}" height="${h}"></canvas>
        <div class="muted small" style="margin-top:4px">Hillshade, ${Math.round(r.pixelM)} m pixels; steep (&gt;15°) tinted.</div></div>
      <div>
        <svg id="slope-chart" viewBox="0 0 300 150" width="100%"></svg>
        <div class="chart-legend"><span style="color:#f8850f">this site</span><span style="color:#c9d4ff">${t.body} target</span></div>
        <div class="stats">
          Median slope <b>${r.medianSlope.toFixed(1)}°</b> (target ${th.median}°) · p90 <b>${r.p90Slope.toFixed(1)}°</b> (target ${th.p90}°)<br>
          Flat ground &lt;5°: <b>${(r.fracBelow5 * 100).toFixed(0)}%</b> · &lt;15° (landable): <b>${(r.fracBelow15 * 100).toFixed(0)}%</b><br>
          Relief in box: <b>${Math.round(r.relief).toLocaleString()} m</b> · histogram overlap: <b>${(sim * 100).toFixed(0)}%</b>
        </div>
      </div>
    </div>
    <svg id="tri-chart" viewBox="0 0 520 90" width="100%" style="margin-top:8px"></svg>
    <div class="muted small">Terrain Ruggedness Index distribution (m). Target slope histogram: ${th.method} at ~${th.baseline_m} m baseline. Elevation source resolution varies by region (SRTM/NED where available, coarser at high latitude).</div>`;

  // Hillshade canvas
  const cv = out.querySelector('#drill-canvas') as HTMLCanvasElement;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = 40 + 200 * shade[i];
    let rr = v;
    let gg = v;
    let bb = v;
    if (slope[i] > 15) {
      const [cr, cg, cb] = infernoRgb(0.55 + Math.min(0.4, (slope[i] - 15) / 60));
      rr = v * 0.45 + cr * 0.55;
      gg = v * 0.45 + cg * 0.55;
      bb = v * 0.45 + cb * 0.55;
    }
    img.data[i * 4] = rr;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = bb;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  // Slope histogram chart
  const svg = out.querySelector('#slope-chart') as SVGSVGElement;
  const nb = r.slopeHist.length;
  const maxP = Math.max(...r.slopeHist, ...th.probs, 1e-6);
  const X = (i: number) => 28 + (i / nb) * 262;
  const Y = (p: number) => 128 - (p / maxP) * 115;
  let bars = '';
  r.slopeHist.forEach((p, i) => {
    bars += `<rect x="${X(i) + 0.5}" y="${Y(p)}" width="${262 / nb - 1}" height="${128 - Y(p)}" fill="#f8850f" opacity="0.8"/>`;
  });
  let line = '';
  th.probs.forEach((p, i) => {
    line += `${i === 0 ? 'M' : 'L'}${X(i)},${Y(p)} L${X(i + 1)},${Y(p)} `;
  });
  let ticks = '';
  for (let d = 0; d <= 60; d += 10) {
    const x = 28 + (d / th.edges[th.edges.length - 1]) * 262;
    ticks += `<text x="${x}" y="142" font-size="9" fill="#8d97b3" text-anchor="middle">${d}°</text>`;
  }
  svg.innerHTML = `<line x1="28" y1="128" x2="290" y2="128" stroke="#2a3350"/>${bars}<path d="${line}" fill="none" stroke="#c9d4ff" stroke-width="1.6"/>${ticks}<text x="2" y="12" font-size="9" fill="#8d97b3">share</text>`;

  // TRI histogram
  const tri = out.querySelector('#tri-chart') as SVGSVGElement;
  const maxT = Math.max(...r.triHist, 1e-6);
  let tb = '';
  r.triHist.forEach((p, i) => {
    const x = 30 + i * 24;
    const hh = (p / maxT) * 60;
    tb += `<rect x="${x}" y="${70 - hh}" width="22" height="${hh}" fill="#c084fc" opacity="0.8"/>`;
    if (i % 4 === 0) tb += `<text x="${x}" y="84" font-size="9" fill="#8d97b3">${r.triEdges[i].toFixed(0)}</text>`;
  });
  tri.innerHTML = `<text x="0" y="10" font-size="9" fill="#8d97b3">TRI</text>${tb}<text x="510" y="84" font-size="9" fill="#8d97b3" text-anchor="end">${r.triEdges[20].toFixed(0)} m</text>`;
}
