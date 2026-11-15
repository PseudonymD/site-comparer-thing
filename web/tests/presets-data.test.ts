// Runs the six presets on the published dataset (web/public/data). This is a sanity check, not a fit:
// the weights in src/presets.ts were set from the literature before these numbers were looked at.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BODIES, PRESET_IDS, defaultConfig, effectiveWeights, type Body, type PresetId } from '../src/presets';
import { buildLut, exclusionScale, noSoilMask, scoreAll } from '../src/scoring';

const dir = new URL('../public/data/', import.meta.url);
const json = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const bin = (f: string) => gunzipSync(readFileSync(new URL(f, dir)));
const meta = json('meta.json');
const targets = json('targets.json').targets as { id: string; body: Body; vector: number[]; validation: string[] }[];
const analogs = json('known_analogs.json').analogs as { id: string; lat: number; lon: number }[];
const F: number = meta.n_features;
const ids: string[] = meta.features.map((f: { id: string }) => f.id);
const raw = bin('features.bin.gz');
const q = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
const c = bin('cells.bin.gz');
const cells = new Uint32Array(c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength));
const n = cells.length;
const soil = ['sand', 'soc'].map((id) => ids.indexOf(id));
const mask = noSoilMask(q, F, n, soil, soil.map((j) => meta.features[j].breakpoints));

function posOf(lat: number, lon: number): number {
  const r = Math.floor((90 - lat) / meta.grid.res);
  const col = Math.floor((lon + 180) / meta.grid.res);
  const g = r * meta.grid.n_lon + col;
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cells[mid] === g) return mid;
    if (cells[mid] < g) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
function aucFor(target: number[], w: number[], analogIds: string[]): number {
  const out = new Float32Array(n);
  scoreAll(q, F, buildLut(target, w), out, mask ? { mask, features: soil, scale: exclusionScale(w, soil) } : undefined);
  let sum = 0;
  let k = 0;
  for (const id of analogIds) {
    const a = analogs.find((x) => x.id === id);
    const p = a ? posOf(a.lat, a.lon) : -1;
    if (p < 0) continue;
    let below = 0;
    for (let i = 0; i < n; i++) if (out[i] < out[p]) below++;
    sum += below / n;
    k++;
  }
  return k ? sum / k : NaN;
}

describe('presets on the published data', () => {
  it('the no-soil mask finds the cells the pipeline wrote as "no soil" (meta.json note: about 30%)', () => {
    expect(mask).not.toBeNull();
    let m = 0;
    for (let i = 0; i < n; i++) m += mask![i];
    const frac = m / n;
    const note = meta.features[ids.indexOf('sand')].notes as string;
    const stated = +/([\d.]+)% set to 0/.exec(note)![1] / 100;
    expect(Math.abs(frac - stated)).toBeLessThan(0.005);
    // They are almost all permanent ice.
    const iceQ = ids.indexOf('ice');
    let iceCells = 0;
    for (let i = 0; i < n; i++) if (mask![i] && q[i * F + iceQ] > 200) iceCells++;
    expect(iceCells / m).toBeGreaterThan(0.85);
  });

  it('known analogs rank above the median of Earth under every preset (sanity check, not a fit)', () => {
    const rows: string[] = ['target'.padEnd(22) + ['Moon', 'Mars'].flatMap((b) => PRESET_IDS.map((p) => `${b}:${p}`.padStart(18))).join('')];
    for (const t of targets) {
      const cols: string[] = [];
      for (const b of BODIES) {
        for (const p of PRESET_IDS) {
          const w = effectiveWeights(defaultConfig(b, p as PresetId, ids), ids);
          const a = b === t.body ? aucFor(t.vector, w, t.validation) : NaN;
          cols.push(Number.isNaN(a) ? '-'.padStart(18) : a.toFixed(3).padStart(18));
          if (b === t.body) expect(a, `${t.id} ${b} ${p}`).toBeGreaterThan(0.5);
        }
      }
      rows.push(t.id.padEnd(22) + cols.join(''));
    }
    console.log('\nMean percentile of the known analogs (AUC), by preset of the target\'s own body:\n' + rows.join('\n'));
  });
});
