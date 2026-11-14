export interface FeatureMeta {
  id: string;
  name: string;
  unit: string;
  group: string;
  ui_group: 'Terrain' | 'Climate' | 'Surface' | 'Remoteness';
  description: string;
  log_display: boolean;
  source: string;
  source_name: string;
  source_url: string;
  synthetic: boolean;
  proxy: boolean;
  coverage: number | null;
  notes?: string | null;
  min: number;
  max: number;
  breakpoints: number[];
}

export interface Meta {
  schema_version: number;
  generated: string;
  grid: { res: number; n_lon: number; n_lat: number; origin: [number, number] };
  bbox: [number, number, number, number] | null;
  normalisation_domain: string;
  n_cells: number;
  n_features: number;
  terrain_zoom: number;
  novelty_saturation_km: number;
  files: { features: string; cells: string; countries: string };
  synthetic_features: string[];
  patched?: string[];
  features: FeatureMeta[];
  countries: { name: string; iso: string }[];
}

export interface TargetRaw {
  value: number | null;
  clamped: number;
  beyond_earth: boolean;
  refs: string[];
}

export interface Target {
  id: string;
  body: 'Moon' | 'Mars';
  name: string;
  lat: number;
  lon: number;
  blurb: string;
  vector: number[];
  weights: number[];
  raw: Record<string, TargetRaw>;
  slope_hist: { edges: number[]; probs: number[]; median: number; p90: number; baseline_m: number; refs: string[]; method: string };
  validation: string[];
  default_filters: { feature: string; max: number }[];
}

export interface TargetsFile {
  features: string[];
  targets: Target[];
  references: Record<string, string>;
}

export interface KnownAnalog {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  bodies: string[];
  note: string;
}

export interface ValidationFile {
  generated: string;
  n_random: number;
  synthetic_features: string[];
  results: {
    target: string;
    name: string;
    auc: number;
    auc_v1_list?: number;
    validation_v1?: string[];
    median_analog_percentile: number;
    random_median_score: number;
    analogs: { id: string; name: string; score: number; percentile: number; rank: number | null }[];
  }[];
}

export interface WorkerInit {
  type: 'init';
  features: ArrayBuffer;
  cells: ArrayBuffer;
  countries: ArrayBuffer;
  nFeatures: number;
  nLon: number;
  nLat: number;
  res: number;
  analogs: { lat: number; lon: number }[];
  noveltySaturationKm: number;
}

export interface ScoreRequest {
  type: 'score';
  id: number;
  target: number[];
  weights: number[];
  filters: { feature: number; zThreshold: number }[];
  alpha: number;
  stretchLow: number;
  hideBelow: boolean;
  topN: number;
  /** Limit the heatmap and candidates to [minlon, minlat, maxlon, maxlat]; percentiles stay global. */
  bbox?: [number, number, number, number] | null;
}

export interface Site {
  pos: number;
  cell: number;
  lat: number;
  lon: number;
  score: number;
  blended: number;
  noveltyKm: number;
  nCells: number;
  areaKm2: number;
  country: number;
}

export interface ScoreResult {
  type: 'scored';
  id: number;
  image: Uint8ClampedArray;
  width: number;
  height: number;
  sites: Site[];
  stats: { lo: number; hi: number; valid: number; p50: number; p99: number };
  hist: Uint32Array; // 2048-bin histogram of (blended) scores over unfiltered land cells
  blob: Blob | null; // PNG of the image, encoded in the worker when OffscreenCanvas is available
  timings: { score: number; image: number; sites: number; encode: number; total: number };
}

export interface CellInfo {
  pos: number;
  cell: number;
  q: number[];
  noveltyKm: number;
  country: number;
  score: number;
  blended: number;
}

export interface FactorRow {
  feature: string;
  name: string;
  unit: string;
  site: number;
  target: number;
  target_raw: number | null;
  beyond_earth: boolean;
  share_of_gap: number;
  synthetic: boolean;
  proxy: boolean;
}

export interface Discovery {
  id: string;
  target: string;
  target_name: string;
  name: string;
  country: string;
  literature: string | null;
  lat: number;
  lon: number;
  cell: number;
  score: number;
  percentile: number;
  novelty_km: number;
  nearest_known_analog: string;
  best: FactorRow[];
  worst: FactorRow[];
  uses: string;
  caveats: string[];
}

export interface DiscoveriesFile {
  generated: string;
  data_generated: string;
  rule: string;
  alpha: number;
  synthetic_features: string[];
  discoveries: Discovery[];
}

export interface SpotlightResult {
  target: string;
  target_name: string;
  score: number;
  percentile: number;
  lat: number;
  lon: number;
  best: FactorRow[];
  worst: FactorRow[];
}

export interface SpotlightFile {
  generated: string;
  data_generated: string;
  bbox: [number, number, number, number];
  method: string;
  synthetic_features: string[];
  places: { id: string; name: string; lat: number; lon: number; why: string; results: SpotlightResult[]; best_target: string; best_percentile: number }[];
  region_best: (SpotlightResult & { country: string })[];
}
