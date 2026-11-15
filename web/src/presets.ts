// Scoring presets: three modes for each of Moon and Mars, six independent configurations.
// DOM-free so it can be tested. main.ts owns the live state; settings.ts only displays it.
//
// A configuration is a weight (0..3) and an on/off switch per layer, keyed by layer id so a change to
// the on-disk feature order cannot scramble saved data. The scoring engine still receives one plain
// weight vector: the weight where the layer is on, 0 where it is off.

export const BODIES = ['Moon', 'Mars'] as const;
export type Body = (typeof BODIES)[number];
export const PRESET_IDS = ['exploration', 'direct', 'direct_earth'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESETS: { id: PresetId; name: string; short: string; blurb: string }[] = [
  {
    id: 'exploration',
    name: 'Exploration',
    short: 'Exploration',
    blurb: 'Broad search. Every layer counts equally, so no single factor decides the ranking.',
  },
  {
    id: 'direct',
    name: 'Direct Comparison',
    short: 'Direct',
    blurb: 'Only layers that can be compared with the Moon or Mars: terrain, temperature, sunlight, rock, soil texture, ice and dust. Earth-only layers are off.',
  },
  {
    id: 'direct_earth',
    name: 'Direct Comparison + Earth Factors',
    short: 'Direct + Earth',
    blurb: 'Direct Comparison plus Earth-only conditions: precipitation, humidity, vegetation, soil carbon and light pollution. Places that are wet, green or lit up score lower.',
  },
];

/** Layers that exist only because Earth has weather, life and people. Off in Direct Comparison. */
export const EARTH_FACTORS: readonly string[] = ['precip', 'humidity', 'ndvi', 'soc', 'lights'];

export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 3;
export const WEIGHT_STEP = 0.25;

export interface PresetConfig {
  weights: Record<string, number>;
  enabled: Record<string, boolean>;
}
export interface PresetStore {
  version: 1;
  active: Record<Body, PresetId>;
  /** Only configurations the user has saved. Everything else is the shipped default. */
  saved: Partial<Record<string, PresetConfig>>;
}

export const STORAGE_KEY = 'analog-finder-presets-v1';
export const DEFAULT_ACTIVE: PresetId = 'direct_earth';
export const keyOf = (body: Body, id: PresetId) => `${body}:${id}`;
export const isBody = (x: unknown): x is Body => (BODIES as readonly unknown[]).includes(x);
export const isPresetId = (x: unknown): x is PresetId => (PRESET_IDS as readonly unknown[]).includes(x);
export const presetInfo = (id: PresetId) => PRESETS.find((p) => p.id === id)!;

const roundStep = (x: number) => Math.round(x / WEIGHT_STEP) * WEIGHT_STEP;

/** Mean of the literature weights over a body's targets (targets.json), snapped to the slider step. */
export function literatureWeights(
  targets: { body: string; weights: number[] }[],
  featureIds: string[],
  body: Body,
): Record<string, number> {
  const mine = targets.filter((t) => t.body === body);
  const out: Record<string, number> = {};
  featureIds.forEach((id, j) => {
    const mean = mine.length ? mine.reduce((a, t) => a + t.weights[j], 0) / mine.length : 1;
    out[id] = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, roundStep(mean)));
  });
  return out;
}

/** The shipped default for one of the six configurations. */
export function defaultConfig(id: PresetId, featureIds: string[], literature: Record<string, number>): PresetConfig {
  const weights: Record<string, number> = {};
  const enabled: Record<string, boolean> = {};
  for (const f of featureIds) {
    weights[f] = id === 'exploration' ? 1 : literature[f] ?? 1;
    enabled[f] = id === 'direct' ? !EARTH_FACTORS.includes(f) : true;
  }
  return { weights, enabled };
}

export const cloneConfig = (c: PresetConfig): PresetConfig => ({ weights: { ...c.weights }, enabled: { ...c.enabled } });

export function sameConfig(a: PresetConfig, b: PresetConfig, featureIds: string[]): boolean {
  return featureIds.every((f) => a.weights[f] === b.weights[f] && a.enabled[f] === b.enabled[f]);
}

/** Vector for the scoring engine, in feature order. A layer that is off counts as weight 0. */
export function effectiveWeights(c: PresetConfig, featureIds: string[]): number[] {
  return featureIds.map((f) => (c.enabled[f] ? c.weights[f] : 0));
}

/** Percentage of the total active weight that each layer carries, in feature order. Sums to 100. */
export function weightShares(vec: number[]): number[] {
  const sum = vec.reduce((a, b) => a + b, 0);
  return vec.map((w) => (sum > 0 ? (w / sum) * 100 : 0));
}

/**
 * Put a plain weight vector (from a shared link or the tour restore) into a configuration:
 * a layer with weight 0 turns off and keeps its stored weight; any other layer turns on at that weight.
 */
export function applyVector(base: PresetConfig, vec: number[], featureIds: string[]): PresetConfig {
  const out = cloneConfig(base);
  featureIds.forEach((f, j) => {
    if (vec[j] > 0) {
      out.weights[f] = vec[j];
      out.enabled[f] = true;
    } else out.enabled[f] = false;
  });
  return out;
}

const fresh = (): PresetStore => ({ version: 1, active: { Moon: DEFAULT_ACTIVE, Mars: DEFAULT_ACTIVE }, saved: {} });

/** Parse stored JSON. Anything malformed or out of range is dropped, never thrown. */
export function parseStore(raw: string | null, featureIds: string[]): PresetStore {
  const out = fresh();
  if (!raw) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!data || typeof data !== 'object') return out;
  const d = data as { version?: unknown; active?: Record<string, unknown>; saved?: Record<string, unknown> };
  if (d.version !== 1) return out;
  for (const b of BODIES) if (isPresetId(d.active?.[b])) out.active[b] = d.active![b] as PresetId;
  for (const b of BODIES) {
    for (const id of PRESET_IDS) {
      const c = d.saved?.[keyOf(b, id)] as { weights?: Record<string, unknown>; enabled?: Record<string, unknown> } | undefined;
      if (!c || typeof c !== 'object') continue;
      // Only layers present in the file are kept; the rest fall back to the default at resolve time.
      const w: Record<string, number> = {};
      const on: Record<string, boolean> = {};
      for (const f of featureIds) {
        const wv = c.weights?.[f];
        const ev = c.enabled?.[f];
        if (typeof wv === 'number' && Number.isFinite(wv) && wv >= WEIGHT_MIN && wv <= WEIGHT_MAX) w[f] = wv;
        if (typeof ev === 'boolean') on[f] = ev;
      }
      out.saved[keyOf(b, id)] = { weights: w, enabled: on };
    }
  }
  return out;
}

/** The configuration to use: shipped default with the user's saved values laid over it. */
export function resolveConfig(saved: PresetConfig | undefined, def: PresetConfig, featureIds: string[]): PresetConfig {
  const out = cloneConfig(def);
  if (!saved) return out;
  for (const f of featureIds) {
    if (saved.weights[f] !== undefined) out.weights[f] = saved.weights[f];
    if (saved.enabled[f] !== undefined) out.enabled[f] = saved.enabled[f];
  }
  return out;
}

export const serializeStore = (s: PresetStore) => JSON.stringify(s);
