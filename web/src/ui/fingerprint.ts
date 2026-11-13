// The analog fingerprint: one spoke per feature, radius = Earth percentile. The target is drawn as an
// outline and (optionally) a site as a filled shape, so the gap between the two shapes is the mismatch.
import type { FeatureMeta } from '../types';
import { GROUP_COLORS } from '../format';

export function fingerprint(features: FeatureMeta[], target: number[], site: number[] | null, size: number, label: string): string {
  const n = features.length;
  const c = size / 2;
  const R = c - 7;
  const r0 = R * 0.14;
  const ang = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (v: number, i: number) => {
    const r = r0 + Math.min(1, Math.max(0, v)) * (R - r0);
    return `${(c + r * Math.cos(ang(i))).toFixed(1)},${(c + r * Math.sin(ang(i))).toFixed(1)}`;
  };
  const poly = (arr: number[]) => arr.map(pt).join(' ');
  let spokes = '';
  let arcs = '';
  features.forEach((f, i) => {
    spokes += `<line x1="${c}" y1="${c}" x2="${pt(1, i).replace(',', '" y2="')}" stroke="var(--line)" stroke-width="1"/>`;
    const a0 = ang(i - 0.42);
    const a1 = ang(i + 0.42);
    const rr = R + 4;
    const p = (a: number) => `${(c + rr * Math.cos(a)).toFixed(1)},${(c + rr * Math.sin(a)).toFixed(1)}`;
    arcs += `<path d="M${p(a0)} A${rr},${rr} 0 0 1 ${p(a1)}" fill="none" stroke="${GROUP_COLORS[f.ui_group]}" stroke-width="2.5"><title>${f.name}</title></path>`;
  });
  const siteShape = site
    ? `<polygon points="${poly(site)}" fill="var(--accent)" fill-opacity="0.3" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>`
    : '';
  return `<svg class="fingerprint" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label}">${spokes}${arcs}${siteShape}<polygon points="${poly(target)}" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}
