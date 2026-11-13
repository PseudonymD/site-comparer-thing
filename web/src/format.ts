import type { FeatureMeta } from './types';

export const GROUP_COLORS: Record<string, string> = {
  Terrain: 'var(--terrain)',
  Climate: 'var(--climate)',
  Surface: 'var(--surface)',
  Remoteness: 'var(--remoteness)',
};
export const GROUP_HEX: Record<string, string> = {
  Terrain: '#8f5626',
  Climate: '#2a68a8',
  Surface: '#47763a',
  Remoteness: '#74499c',
};

export function fmtValue(v: number, f: FeatureMeta): string {
  if (!Number.isFinite(v)) return '–';
  const unit = f.unit && f.unit !== 'fraction' ? ` ${f.unit}` : '';
  if (f.unit === 'fraction') return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`;
  const a = Math.abs(v);
  let s: string;
  if (a >= 1000) s = Math.round(v).toLocaleString('en-US');
  else if (a >= 100) s = v.toFixed(0);
  else if (a >= 10) s = v.toFixed(1);
  else s = v.toFixed(2);
  return s + unit;
}

export function fmtKm(km: number): string {
  if (!Number.isFinite(km)) return '–';
  return km >= 100 ? `${Math.round(km).toLocaleString('en-US')} km` : `${km.toFixed(0)} km`;
}

export function fmtLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

export function flag(iso: string): string {
  if (!iso || iso.length !== 2 || !/^[A-Z]{2}$/.test(iso)) return '🏳️';
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
