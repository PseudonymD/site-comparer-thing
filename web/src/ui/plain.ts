// Plain-language layer for Simple Mode. DOM-free so it can be tested.
//
// Nothing here scores anything. The numbers come from the same engine as Normal Mode (scoring.ts: the lookup
// table scorer in the worker, and contributions() for the per-layer breakdown). This file only decides how to
// word them: which layers are the best matches and the biggest differences, and what to call them.
import type { FeatureMeta, Target } from '../types';
import { fmtValue } from '../format';
import { contributions, valueFromQ } from '../scoring';
import { APPLICABILITY, type Body } from '../presets';

export const PLAIN_FEATURES: Record<string, { label: string; what: string; group: 'Landscape' | 'Climate' | 'Ground' | 'Surroundings' }> = {
  elevation: { label: 'Height above sea level', what: 'How high the land is. High ground has thinner air, a little like Mars.', group: 'Landscape' },
  slope_mean: { label: 'Ground steepness', what: 'How steep the ground is on average.', group: 'Landscape' },
  slope_p90: { label: 'Steepest slopes', what: 'How steep the steepest tenth of the ground is.', group: 'Landscape' },
  tri: { label: 'Ground roughness', what: 'How bumpy the surface is from one spot to the next.', group: 'Landscape' },
  relief: { label: 'Hills and valleys', what: 'The height difference between the highest and lowest ground nearby.', group: 'Landscape' },
  temp_mean: { label: 'Average temperature', what: 'The yearly average temperature.', group: 'Climate' },
  temp_range: { label: 'Day and night swing', what: 'How much the temperature changes between day and night.', group: 'Climate' },
  temp_min: { label: 'Coldest temperatures', what: 'How cold the coldest month gets.', group: 'Climate' },
  precip: { label: 'Rainfall', what: 'How much rain and snow falls in a year.', group: 'Climate' },
  humidity: { label: 'Air humidity', what: 'How much moisture is in the air.', group: 'Climate' },
  solar: { label: 'Sunshine', what: 'How much sunlight reaches the ground.', group: 'Climate' },
  ndvi: { label: 'Plant cover', what: 'How green and vegetated the land is.', group: 'Ground' },
  soc: { label: 'Organic matter in the soil', what: 'Carbon from dead plants and animals in the topsoil.', group: 'Ground' },
  sand: { label: 'Sandy, loose ground', what: 'How much of the topsoil is sand.', group: 'Ground' },
  basalt: { label: 'Volcanic rock', what: 'How much of the ground is dark volcanic (basalt) rock.', group: 'Ground' },
  ice: { label: 'Ice and snow', what: 'How much of the ground is permanently covered by ice or snow.', group: 'Ground' },
  lights: { label: 'Artificial light at night', what: 'How lit up the area is at night by towns and roads (an estimate).', group: 'Surroundings' },
  aod: { label: 'Dust in the air', what: 'How hazy the sky is with dust and other tiny particles.', group: 'Surroundings' },
};

export const TARGET_PLAIN: Record<string, { name: string; tag: string; about: string }> = {
  moon_south_pole: {
    name: 'Lunar south pole',
    tag: 'Where Artemis astronauts plan to land',
    about: 'The Moon’s south pole. The Sun hangs low on the horizon, some craters never see sunlight and are extremely cold, and there is water ice in the dark. The terrain is rugged highland.',
  },
  moon_mare_lava_tube: {
    name: 'Lunar lava-tube plains',
    tag: 'Flat volcanic plains with tunnels',
    about: 'A flat, dark plain of volcanic rock on the Moon (Marius Hills). Natural openings lead into underground lava tunnels that could shelter a base from radiation and temperature swings.',
  },
  mars_jezero: {
    name: 'Jezero crater',
    tag: 'Ancient lake, explored by Perseverance',
    about: 'A crater on Mars that once held a lake, with the remains of a river delta. The floor is volcanic rock. The Perseverance rover is exploring it for signs of ancient life.',
  },
  mars_gale: {
    name: 'Gale crater',
    tag: 'Lake-bed layers, explored by Curiosity',
    about: 'A crater on Mars with a tall mound of layered rock at its centre, laid down in old lake beds. The Curiosity rover is climbing it. The sky is dusty and there are sand dunes.',
  },
  mars_arcadia: {
    name: 'Arcadia plains',
    tag: 'Smooth plains with shallow ice',
    about: 'Smooth volcanic plains in the northern Mars mid-latitudes with water ice only metres below the surface. It is a leading candidate for a first crewed landing.',
  },
  mars_north_polar: {
    name: 'North polar ice cap',
    tag: 'Ice layers and dark dunes',
    about: 'The ice cap at the top of Mars, built of water-ice layers and cut by spiral valleys, surrounded by dark volcanic sand dunes.',
  },
};

/** How a value ranks among all land on Earth, in words. z is an Earth percentile (0..1). */
export function levelWord(z: number, value?: number): string {
  if (value === 0) return 'none'; // a true zero reads as "none", not as a position on Earth's scale
  if (z < 0.1) return 'very low';
  if (z < 0.3) return 'low';
  if (z < 0.7) return 'medium';
  if (z < 0.9) return 'high';
  return 'very high';
}

export type Closeness = 'very close' | 'close' | 'different' | 'very different';
/** gap = |z - t|, the distance between the place and the target on Earth's percentile scale. */
export function closeness(gap: number): Closeness {
  if (gap < 0.1) return 'very close';
  if (gap < 0.25) return 'close';
  if (gap < 0.5) return 'different';
  return 'very different';
}

/** Overall wording from the place's rank among Earth's land (0..1, as shown in Normal Mode's "top x%"). */
export function matchLabel(pctl: number): { label: string; tone: 'top' | 'good' | 'some' | 'weak' | 'none' } {
  if (!Number.isFinite(pctl)) return { label: 'Left out', tone: 'none' };
  if (pctl >= 0.99) return { label: 'Excellent match', tone: 'top' };
  if (pctl >= 0.95) return { label: 'Strong match', tone: 'top' };
  if (pctl >= 0.85) return { label: 'Good match', tone: 'good' };
  if (pctl >= 0.6) return { label: 'Partial match', tone: 'some' };
  return { label: 'Weak match', tone: 'weak' };
}

export interface PlainRow {
  index: number; // position in the feature list
  id: string;
  label: string;
  what: string;
  group: string;
  here: string; // the Earth place, in words and numbers
  there: string; // the target, in words and numbers
  gap: number; // |z - t|
  closeness: Closeness;
  weight: number; // points actually used for this cell (0 = not used)
  share: number; // % of the total weight in use
  gapShare: number; // % of the overall difference this layer causes
  used: boolean;
  skipped: boolean; // does not apply to this cell (no soil under ice)
}

function targetText(f: FeatureMeta, j: number, t: Target, body: Body): string {
  const raw = t.raw[f.id];
  const info = APPLICABILITY[body][f.id];
  if (info?.kind === 'inapplicable') return 'none (no air or weather)';
  if (info?.kind === 'absent') return 'none';
  if (info?.kind === 'trace') return 'almost none';
  const z = t.vector[j];
  if (raw.value === null) return 'more extreme than anywhere on Earth';
  if (f.id === 'lights') return levelWord(z, raw.value); // the unit is a brightness index: the word says it better
  if (raw.beyond_earth) return `${levelWord(z, raw.value)} (${fmtValue(raw.value, f)}, beyond anything on Earth)`;
  return `${levelWord(z, raw.value)} (${fmtValue(raw.value, f)})`;
}

function hereText(f: FeatureMeta, z: number, v: number): string {
  if (f.id === 'lights') return levelWord(z);
  // Values that print as zero count as "none" (an ice-free place has no ice).
  const shown = Math.abs(v) < (f.unit === 'fraction' ? 0.0005 : 0.005) && f.id !== 'temp_mean' && f.id !== 'temp_min' ? 0 : v;
  return `${levelWord(z, shown)} (${fmtValue(v, f)})`;
}

export interface CompareArgs {
  features: FeatureMeta[];
  q: number[]; // the cell's 18 quantised percentiles
  target: Target;
  weights: number[]; // engine weights (feature order); 0 = switched off
  skip: number[]; // layers that do not apply to this cell
}
export interface Comparison {
  rows: PlainRow[];
  matches: PlainRow[]; // closest matches, most important first
  differences: PlainRow[]; // biggest differences, largest first
  layersUsed: number;
}

/**
 * Per-layer comparison. Uses the same quantities as the Normal Mode location panel:
 *   gap = |z - t|; gapShare = contributions() / total; matches ranked by weight * (1 - gap) (dossier.ts).
 */
export function compare(a: CompareArgs): Comparison {
  const body = a.target.body as Body;
  const w = a.weights.map((x, j) => (a.skip.includes(j) ? 0 : x));
  const total = w.reduce((s, x) => s + x, 0);
  const c = contributions(a.q, a.target.vector, w);
  const cTotal = c.reduce((s, x) => s + x, 0);
  const rows: PlainRow[] = a.features.map((f, j) => {
    const z = a.q[j] / 255;
    const t = a.target.vector[j];
    const gap = Math.abs(z - t);
    const p = PLAIN_FEATURES[f.id] ?? { label: f.name, what: f.description, group: 'Ground' as const };
    const skipped = a.skip.includes(j);
    return {
      index: j, id: f.id, label: p.label, what: p.what, group: p.group,
      here: skipped ? 'not applicable (no soil under ice)' : hereText(f, z, valueFromQ(f.breakpoints, a.q[j])),
      there: targetText(f, j, a.target, body),
      gap, closeness: closeness(gap), weight: w[j], share: total > 0 ? (w[j] / total) * 100 : 0,
      gapShare: cTotal > 0 ? (c[j] / cTotal) * 100 : 0, used: w[j] > 0, skipped,
    };
  });
  const used = rows.filter((r) => r.used);
  const matches = used
    .filter((r) => r.gap < 0.25)
    .sort((x, y) => y.weight * (1 - y.gap) - x.weight * (1 - x.gap))
    .slice(0, 3);
  const differences = [...used]
    .sort((x, y) => y.gapShare - x.gapShare)
    .filter((r) => r.gap >= 0.25)
    .slice(0, 3);
  return { rows, matches, differences, layersUsed: used.length };
}

export const list = (xs: string[]) =>
  xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
/** "top 0.01%": the same rank figure Normal Mode shows. */
export const topPercent = (pctl: number) => `top ${Math.max(0.01, (1 - pctl) * 100).toFixed(pctl > 0.99 ? 2 : 1)}%`;
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export interface ExplainArgs {
  place: string; // e.g. "Tajikistan"
  targetName: string; // e.g. "Jezero crater"
  body: Body;
  score: number; // 0..100
  pctl: number; // 0..1 rank among Earth's land; NaN when filtered out
  cmp: Comparison;
  filtered: boolean;
}
/** A short, honest paragraph: why this place could be an analog, and what the claim does not cover. */
export function explain(a: ExplainArgs): string {
  const target = a.body === 'Mars' ? `${a.targetName} on Mars` : a.targetName;
  if (a.filtered) {
    return `${a.place} is left out of the ranking because of a built-in limit (it is mostly covered by permanent ice, which does not suit this target). Its raw similarity would be ${a.score.toFixed(0)} out of 100.`;
  }
  const m = a.cmp.matches.map((r) => lc(r.label));
  const d = a.cmp.differences.map((r) => lc(r.label));
  const rank = Number.isFinite(a.pctl) ? ` Overall it ranks in the ${topPercent(a.pctl)} of land on Earth for ${target}.` : '';
  const lead = m.length
    ? `${a.place} could act as a stand-in for ${target} mainly because its ${list(m)} ${m.length > 1 ? 'are' : 'is'} close to what has been measured there.`
    : `${a.place} is not a close match to ${target} on any single measurement, so its overall score comes from many small similarities.`;
  const diff = d.length ? ` It differs most in ${list(d)}.` : ' It has no large differences.';
  return `${lead}${diff}${rank} The comparison covers ${a.cmp.layersUsed} measurable properties, so it cannot see everything. Real field-site choices need expert checks.`;
}
