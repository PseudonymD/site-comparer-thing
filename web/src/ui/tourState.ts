// DOM-free helpers for the guided tour: what a snapshot holds and how it is compared.
// The tour snapshots the view when it starts and puts it back when it ends (see main.ts).

export type LeftTab = 'weights' | 'filters' | 'view';
export type RightTab = 'cand' | 'disc';

export interface TourSnapshot {
  // Settings that the 30-second demo changes and that restore() puts back.
  t: number;
  weights: number[];
  filters: { id: string; on: boolean; tau: number }[];
  alpha: number;
  geography: { countries: string[]; regions: string[] };
  region: string;
  projection: string;
  basemap: string;
  stretchLow: number;
  hideBelow: boolean;
  opacity: number;
  // View-only state that the guided tour may change to reveal a control.
  leftTab: LeftTab;
  rightTab: RightTab;
  leftOpen: boolean;
  rightOpen: boolean;
  site: { lat: number; lon: number } | null;
  focus: boolean;
  planetOpen: boolean;
  camera: { lng: number; lat: number; zoom: number; bearing: number; pitch: number };
  hash: string;
}

export type SettingKey = 't' | 'weights' | 'filters' | 'alpha' | 'geography' | 'region' | 'projection' | 'basemap' | 'stretchLow' | 'hideBelow' | 'opacity';

export const SETTING_KEYS: SettingKey[] = ['t', 'weights', 'filters', 'alpha', 'geography', 'region', 'projection', 'basemap', 'stretchLow', 'hideBelow', 'opacity'];

/** Which user settings differ between the current state and a snapshot. */
export function changedSettings(cur: TourSnapshot, snap: TourSnapshot): SettingKey[] {
  return SETTING_KEYS.filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(snap[k]));
}

/** True when the camera is further than a rounding error from the snapshot. */
export function cameraMoved(a: TourSnapshot['camera'], b: TourSnapshot['camera']): boolean {
  return (
    Math.abs(a.lng - b.lng) > 1e-4 || Math.abs(a.lat - b.lat) > 1e-4 || Math.abs(a.zoom - b.zoom) > 1e-2 ||
    Math.abs(a.bearing - b.bearing) > 1e-2 || Math.abs(a.pitch - b.pitch) > 1e-2
  );
}

/** Names of the Moon and Mars targets, used in the intro copy. */
export function groupTargets(targets: { body: string; short: string }[]): { moon: string[]; mars: string[] } {
  return {
    moon: targets.filter((t) => t.body === 'Moon').map((t) => t.short),
    mars: targets.filter((t) => t.body === 'Mars').map((t) => t.short),
  };
}
