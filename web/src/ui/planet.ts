// Planetary side-by-side: the target's terrain (NASA Moon Trek / Mars Trek mosaics) next to the Earth candidate
// (Esri World Imagery), each as a small tile mosaic centred on its site at a roughly similar ground scale.
// Plain <img> tiles need no CORS. If a Trek tile fails to load, the panel says so and links to the Trek portal.
import type { Target } from '../types';

const TILE = 256;
const BOX = 200; // px shown per panel

interface Layer {
  url: (z: number, row: number, col: number) => string;
  zoom: number;
  credit: string;
  portal: string;
  kmPerTile: () => number;
}

// Trek WMTS "default028mm" tile matrix: geographic, level z has 2^(z+1) x 2^z tiles of 180/2^z degrees.
const TREK = {
  Moon: {
    url: (z: number, row: number, col: number) =>
      `https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/${z}/${row}/${col}.jpg`,
    zoom: 6,
    credit: 'NASA Moon Trek · LRO WAC global mosaic (NASA/GSFC/Arizona State Univ.)',
    portal: 'https://trek.nasa.gov/moon/',
    kmPerTile: () => (180 / 64) * 30.33, // north-south extent of one tile (km)
  },
  Mars: {
    url: (z: number, row: number, col: number) =>
      `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${z}/${row}/${col}.jpg`,
    zoom: 7,
    credit: 'NASA Mars Trek · Viking MDIM 2.1 colour mosaic (NASA/JPL/USGS)',
    portal: 'https://trek.nasa.gov/mars/',
    kmPerTile: () => (180 / 128) * 59.27,
  },
} satisfies Record<string, Layer>;

function trekFrac(lat: number, lon: number, z: number) {
  const deg = 180 / 2 ** z;
  const la = Math.max(-89.99, Math.min(89.99, lat));
  return { fx: (((lon + 540) % 360) - 180 + 180) / deg, fy: (90 - la) / deg, nx: 2 ** (z + 1), ny: 2 ** z };
}

function mercFrac(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const la = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return { fx: ((lon + 180) / 360) * n, fy: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n, nx: n, ny: n };
}

function mosaic(f: { fx: number; fy: number; nx: number; ny: number }, url: (row: number, col: number) => string): string {
  const cx = Math.floor(f.fx);
  const cy = Math.floor(f.fy);
  const offX = BOX / 2 - (f.fx - cx) * TILE;
  const offY = BOX / 2 - (f.fy - cy) * TILE;
  const imgs: string[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const row = cy + dy;
      if (row < 0 || row >= f.ny) continue;
      const col = (((cx + dx) % f.nx) + f.nx) % f.nx;
      imgs.push(`<img alt="" loading="lazy" decoding="async" src="${url(row, col)}" style="left:${(offX + dx * TILE).toFixed(1)}px;top:${(offY + dy * TILE).toFixed(1)}px">`);
    }
  }
  return `<div class="pm-box" style="width:${BOX}px;height:${BOX}px">${imgs.join('')}<i class="pm-cross"></i></div>`;
}

export function planetPanel(t: Target, lat: number, lon: number): string {
  const layer = TREK[t.body];
  const tf = trekFrac(t.lat, t.lon, layer.zoom);
  const ez = Math.max(3, Math.min(13, Math.round(Math.log2((40075 * Math.cos((lat * Math.PI) / 180)) / layer.kmPerTile()))));
  const ef = mercFrac(lat, lon, ez);
  const earthKm = (40075 * Math.cos((lat * Math.PI) / 180)) / 2 ** ez;
  const boxKm = (k: number) => Math.round((k * BOX) / TILE);
  const polar = Math.abs(t.lat) > 70;
  return `<div class="pm">
    <figure>
      ${mosaic(tf, (r, c) => layer.url(layer.zoom, r, c))}
      <figcaption><b>${t.body}: ${t.name.replace(/^(Moon|Mars) – /, '')}</b><span>~${boxKm(layer.kmPerTile())} km north–south${polar ? ' · equirectangular, stretched east–west this close to the pole' : ''}</span></figcaption>
    </figure>
    <figure>
      ${mosaic(ef, (r, c) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ez}/${r}/${c}`)}
      <figcaption><b>Earth: this candidate</b><span>~${boxKm(earthKm)} km north–south</span></figcaption>
    </figure>
  </div>
  <p class="note pm-credit">${layer.credit}. Earth: Esri World Imagery. <a href="${layer.portal}" target="_blank" rel="noopener">Open ${t.body} Trek</a>. <span class="pm-fail hidden">The ${t.body} Trek tiles did not load here; use the link to see the terrain.</span></p>`;
}

/** After inserting planetPanel() HTML: show the fallback note if the planetary tiles fail. */
export function watchPlanetTiles(root: HTMLElement) {
  root.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => img.classList.add('fail')));
  const fig = root.querySelector('.pm figure');
  if (!fig) return;
  const imgs = [...fig.querySelectorAll('img')];
  let failed = 0;
  for (const img of imgs) {
    img.addEventListener('error', () => {
      img.classList.add('fail');
      if (++failed === imgs.length) {
        root.querySelector('.pm-fail')?.classList.remove('hidden');
        fig.classList.add('pm-dead');
      }
    });
  }
}
