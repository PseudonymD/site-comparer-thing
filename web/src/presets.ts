// Scoring presets: three modes for each of Moon and Mars, six independent configurations.
// DOM-free so it can be tested. main.ts owns the live state; settings.ts only displays it.
//
// A configuration is a weight and an on/off switch per layer, keyed by layer id so a change to the
// on-disk feature order cannot scramble saved data. The scoring engine receives one plain weight vector:
// the weight where the layer is on, 0 where it is off. The engine divides by the sum of the active
// weights, so a switched-off layer contributes nothing and the rest are renormalised automatically.
//
// Weights are percentage points: in every shipped default the enabled weights add up to exactly 100.
// The derivation and the sources behind each choice are in docs/weights.md.

export const BODIES = ['Moon', 'Mars'] as const;
export type Body = (typeof BODIES)[number];
export const PRESET_IDS = ['exploration', 'direct', 'direct_earth'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESETS: { id: PresetId; name: string; short: string; blurb: string }[] = [
  {
    id: 'exploration',
    name: 'Exploration',
    short: 'Exploration',
    blurb: 'What matters for exploring and for choosing analog research sites: geology, terrain, temperature, and the resources and hazards of each body. Moon: sunlight and water ice. Mars: dust, atmospheric water and ice.',
  },
  {
    id: 'direct',
    name: 'Direct Comparison',
    short: 'Direct',
    blurb: 'Only properties that can be measured on both Earth and the target body: terrain, temperature, rock type, surface material, ice and, for Mars, atmosphere. Earth-only layers are off.',
  },
  {
    id: 'direct_earth',
    name: 'Direct Comparison + Earth Factors',
    short: 'Direct + Earth',
    blurb: 'Direct Comparison plus Earth-only conditions (precipitation, vegetation, light pollution and similar), kept to 12% of the total so the physical and geological comparison still decides the ranking.',
  },
];

// ---------------------------------------------------------------------------------------------------
// Default weights (percentage points). One table per body and mode; a layer that is absent from a table
// is switched off in that mode. Every enabled column sums to 100 (checked in tests/presets.test.ts).
// ---------------------------------------------------------------------------------------------------
type Table = Record<string, number>;
export const DEFAULT_TABLE: Record<Body, Record<PresetId, Table>> = {
  Moon: {
    // Geology, regolith, terrain, elevation, temperature, sunlight, ice. Cold traps and polar sunlight are
    // the drivers of lunar exploration, so temp_min, solar and ice are raised against Direct Comparison.
    exploration: {
      elevation: 3, slope_mean: 6, slope_p90: 6, tri: 5, relief: 7,
      temp_mean: 5, temp_range: 6, temp_min: 12, solar: 10, sand: 8, basalt: 18, ice: 14,
    },
    // Only quantities that exist on both bodies. No atmosphere on the Moon, so humidity, aerosols,
    // precipitation, vegetation, soil carbon and artificial light are off.
    direct: {
      elevation: 4, slope_mean: 8, slope_p90: 7, tri: 7, relief: 8,
      temp_mean: 8, temp_range: 9, temp_min: 10, solar: 6, sand: 9, basalt: 18, ice: 6,
    },
    // Direct Comparison scaled to 88%, plus 12 points of Earth-condition layers. On the Moon each of these
    // is a "nothing there" target (see APPLICABILITY), so they reward places that are dry, bare, dark and clear.
    direct_earth: {
      elevation: 3.5, slope_mean: 7, slope_p90: 6, tri: 6, relief: 7,
      temp_mean: 7, temp_range: 8, temp_min: 9, solar: 5.5, sand: 8, basalt: 16, ice: 5,
      precip: 3, ndvi: 3, lights: 2.5, humidity: 1.5, soc: 1, aod: 1,
    },
  },
  Mars: {
    // Geology, terrain, temperature, dust, atmospheric water, ice. Precipitation is on here only as the
    // hyper-aridity indicator that Mars analog research uses for "water-related environments".
    exploration: {
      elevation: 3, slope_mean: 5, slope_p90: 4, tri: 5, relief: 6,
      temp_mean: 7, temp_range: 4, temp_min: 7, humidity: 8, precip: 5, solar: 4, sand: 5, basalt: 16, ice: 11, aod: 10,
    },
    // Mars has a thin atmosphere with measured humidity and dust, so those two stay on. Rain, vegetation,
    // soil carbon and artificial light are Earth-only and are off.
    direct: {
      elevation: 4, slope_mean: 7, slope_p90: 6, tri: 6, relief: 7,
      temp_mean: 8, temp_range: 6, temp_min: 8, humidity: 8, solar: 5, sand: 7, basalt: 15, ice: 7, aod: 6,
    },
    direct_earth: {
      elevation: 3.5, slope_mean: 6, slope_p90: 5.5, tri: 5.5, relief: 6,
      temp_mean: 7, temp_range: 5.5, temp_min: 7, humidity: 7, solar: 4.5, sand: 6, basalt: 13, ice: 6, aod: 5.5,
      precip: 4.5, ndvi: 3.5, lights: 2.5, soc: 1.5,
    },
  },
};

/** Layers that describe Earth's own weather, life and people for each body. Off in Direct Comparison. */
export const EARTH_FACTORS: Record<Body, readonly string[]> = {
  Moon: ['precip', 'humidity', 'ndvi', 'soc', 'lights', 'aod'],
  Mars: ['precip', 'ndvi', 'soc', 'lights'],
};

// ---------------------------------------------------------------------------------------------------
// What each layer means for each body. This is the distinction between a measured value, a physical zero
// and a quantity that does not exist on that body. A target value of 0 in targets.json does NOT mean the
// same thing in all three cases, and none of them is "missing data" (a missing target value is excluded
// from scoring, never read as 0; see targetUsable).
//   measured      target value comes from spacecraft or literature measurements
//   proxy         the Earth layer is a stand-in for the planetary property (elevation for air pressure, ...)
//   absent        physically zero: the thing is not there (no vegetation, no artificial light)
//   trace         near zero but not zero (Mars: ice-crystal snowfall, trace organics)
//   inapplicable  the quantity is undefined on that body (the Moon has no atmosphere)
// ---------------------------------------------------------------------------------------------------
export type Kind = 'measured' | 'proxy' | 'absent' | 'trace' | 'inapplicable';
export const APPLICABILITY: Record<Body, Record<string, { kind: Kind; note: string }>> = {
  Moon: {
    elevation: { kind: 'proxy', note: 'The Moon has no sea level or air. Elevation only stands in for thin air; the target is the highest Earth value.' },
    slope_mean: { kind: 'measured', note: 'Slope statistics from LRO LOLA topography.' },
    slope_p90: { kind: 'measured', note: 'Slope statistics from LRO LOLA topography.' },
    tri: { kind: 'measured', note: 'Roughness from LRO LOLA topography.' },
    relief: { kind: 'measured', note: 'Relief from LRO LOLA topography and Kaguya imagery.' },
    temp_mean: { kind: 'measured', note: 'LRO Diviner. Beyond Earth\'s range, so the target is clamped to the coldest Earth value.' },
    temp_range: { kind: 'measured', note: 'LRO Diviner. About 300 K swing on the Moon, far beyond Earth, so the target is clamped to the largest Earth value.' },
    temp_min: { kind: 'measured', note: 'LRO Diviner. Polar cold traps are below 100 K, beyond Earth, so the target is clamped to the coldest Earth value.' },
    precip: { kind: 'inapplicable', note: 'No atmosphere, so no precipitation exists. Target is "none", not a measured zero.' },
    humidity: { kind: 'inapplicable', note: 'No atmosphere, so relative humidity is undefined. Target is "driest Earth value", not a measurement.' },
    solar: { kind: 'proxy', note: 'Earth surface sunlight is reduced by air and cloud, so it only stands in for the sunlight available to a site.' },
    ndvi: { kind: 'absent', note: 'No vegetation. A genuine zero, but not a measurement of the Moon.' },
    soc: { kind: 'absent', note: 'No organic soil carbon. A genuine zero, but not a measurement of the Moon.' },
    sand: { kind: 'proxy', note: 'Lunar regolith is mostly silt-sized fines. Earth sand fraction is only a stand-in for loose fine material.' },
    basalt: { kind: 'proxy', note: 'Mare regolith and lava tubes are basaltic. Earth basalt fraction stands in for that geology.' },
    ice: { kind: 'proxy', note: 'Lunar ice is a small fraction of polar regolith in cold traps. Earth ice and snow cover only stands in for cold, ice-bearing ground.' },
    lights: { kind: 'absent', note: 'No artificial light on the natural lunar surface. A genuine zero.' },
    aod: { kind: 'inapplicable', note: 'No atmosphere, so no aerosols. Target is "clearest Earth value", not a measurement.' },
  },
  Mars: {
    elevation: { kind: 'proxy', note: 'Elevation stands in for air pressure (about 6 mbar on Mars). Earth only reaches about half a bar at its highest land.' },
    slope_mean: { kind: 'measured', note: 'Slope statistics from MOLA topography and landing-site studies.' },
    slope_p90: { kind: 'measured', note: 'Slope statistics from MOLA topography and landing-site studies.' },
    tri: { kind: 'measured', note: 'Roughness from MOLA topography and landing-site studies.' },
    relief: { kind: 'measured', note: 'Relief from MOLA topography and rover site studies.' },
    temp_mean: { kind: 'measured', note: 'Rover (REMS) and orbital measurements. Colder than any Earth land, so the target is clamped to the coldest Earth value.' },
    temp_range: { kind: 'measured', note: 'Rover (REMS) measurements. Larger than the Earth land average, so the target is clamped to the largest Earth value.' },
    temp_min: { kind: 'measured', note: 'Rover (REMS) and orbital measurements. Colder than any Earth land, so the target is clamped.' },
    precip: { kind: 'trace', note: 'No rain. Phoenix lidar saw ice crystals fall from clouds and frost forms, but the water amount is negligible. Target is 0 mm/yr as the driest Earth value (hyper-aridity), not "no atmosphere".' },
    humidity: { kind: 'measured', note: 'Measured by the Curiosity REMS instrument. Mars air is very dry; the target is clamped to the driest Earth value.' },
    solar: { kind: 'proxy', note: 'Mars surface sunlight (dust-dimmed) compared with Earth all-sky sunlight, which is dimmed by cloud instead.' },
    ndvi: { kind: 'absent', note: 'No vegetation observed. A genuine zero.' },
    soc: { kind: 'trace', note: 'Only trace organics have been found, at parts-per-million levels, far below Earth soil carbon. Target is 0.' },
    sand: { kind: 'proxy', note: 'Martian soil fines. Earth sand fraction is only a stand-in for loose fine material.' },
    basalt: { kind: 'proxy', note: 'Mars\'s crust is largely basaltic. Earth basalt fraction stands in for that geology; there is no global Earth mineralogy layer here.' },
    ice: { kind: 'proxy', note: 'Polar and mid-latitude ground ice. Earth ice and snow cover only stands in for ice-bearing ground.' },
    lights: { kind: 'absent', note: 'No artificial light on the natural Martian surface. A genuine zero.' },
    aod: { kind: 'measured', note: 'Dust optical depth measured by rovers. Earth aerosol optical depth is a comparable dust-load measure.' },
  },
};

export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 40;
export const WEIGHT_STEP = 0.5;

export interface PresetConfig {
  weights: Record<string, number>;
  enabled: Record<string, boolean>;
}
export interface PresetStore {
  version: 2;
  active: Record<Body, PresetId>;
  /** Only configurations the user has saved. Everything else is the shipped default. */
  saved: Partial<Record<string, PresetConfig>>;
}

// v2: weights became percentage points (v1 used a 0..3 scale), so v1 data is deliberately not read.
export const STORAGE_KEY = 'analog-finder-presets-v2';
export const DEFAULT_ACTIVE: PresetId = 'direct_earth';
export const keyOf = (body: Body, id: PresetId) => `${body}:${id}`;
export const isBody = (x: unknown): x is Body => (BODIES as readonly unknown[]).includes(x);
export const isPresetId = (x: unknown): x is PresetId => (PRESET_IDS as readonly unknown[]).includes(x);
export const presetInfo = (id: PresetId) => PRESETS.find((p) => p.id === id)!;
export const isEarthFactor = (body: Body, featureId: string) => EARTH_FACTORS[body].includes(featureId);

/**
 * The shipped default for one of the six configurations. A layer that a mode switches off keeps the
 * weight it has in Direct + Earth Factors, so switching it on gives it a sensible starting value.
 */
export function defaultConfig(body: Body, id: PresetId, featureIds: string[]): PresetConfig {
  const t = DEFAULT_TABLE[body];
  const weights: Record<string, number> = {};
  const enabled: Record<string, boolean> = {};
  for (const f of featureIds) {
    const w = t[id][f];
    enabled[f] = w !== undefined;
    weights[f] = w ?? t.direct_earth[f] ?? 1;
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

/** Sum of the weights that are actually in use (enabled layers only). */
export const activeTotal = (c: PresetConfig, featureIds: string[]) => effectiveWeights(c, featureIds).reduce((a, b) => a + b, 0);

/** Percentage of the total active weight that each layer carries, in feature order. Sums to 100. */
export function weightShares(vec: number[]): number[] {
  const sum = vec.reduce((a, b) => a + b, 0);
  return vec.map((w) => (sum > 0 ? (w / sum) * 100 : 0));
}

/**
 * A target value that is not a finite number is missing, not zero. The layer is left out of the score
 * for that target (weight 0, so the rest renormalise) and a placeholder is used only to keep the vector
 * the same length.
 */
export function targetUsable(targetVector: number[], weights: number[]): { target: number[]; weights: number[]; missing: number[] } {
  const missing: number[] = [];
  const target = targetVector.map((t, j) => {
    if (Number.isFinite(t)) return t;
    missing.push(j);
    return 0;
  });
  return { target, weights: weights.map((w, j) => (missing.includes(j) ? 0 : w)), missing };
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

const fresh = (): PresetStore => ({ version: 2, active: { Moon: DEFAULT_ACTIVE, Mars: DEFAULT_ACTIVE }, saved: {} });

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
  if (d.version !== 2) return out;
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
