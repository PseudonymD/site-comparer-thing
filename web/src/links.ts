// Shareable deep links: the whole view (target, weights, filters, novelty, region, map view, selected site)
// lives in the URL hash, e.g.
//   #t=mars_jezero&a=0.3&f=ice:0.5&r=safrica&v=-24.1,-69.9,9&s=-24.1,-69.93
// Weights are only written when they differ from the target's defaults (w=18 values joined by "_").

export interface LinkState {
  t?: string; // target id
  w?: number[]; // weights (full vector) when changed
  f?: { id: string; tau: number }[]; // filters that are on (present = explicit, even if empty)
  a?: number; // novelty alpha
  r?: string; // region id
  v?: { lat: number; lon: number; zoom: number }; // map view
  s?: { lat: number; lon: number }; // selected site / cell
  p?: 'globe' | 'mercator';
  b?: 'satellite' | 'dark';
  tour?: boolean;
}

const num = (x: string | null) => (x === null || x === '' || !Number.isFinite(+x) ? undefined : +x);
const r4 = (x: number) => +x.toFixed(4);

export function parseHash(hash: string): LinkState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: LinkState = {};
  if (p.get('t')) out.t = p.get('t')!;
  if (p.get('w')) {
    const w = p.get('w')!.split('_').map(Number);
    if (w.every((x) => Number.isFinite(x) && x >= 0 && x <= 3)) out.w = w;
  }
  if (p.has('f')) {
    out.f = p
      .get('f')!
      .split(',')
      .filter(Boolean)
      .map((kv) => {
        const [id, tau] = kv.split(':');
        return { id, tau: +tau };
      })
      .filter((x) => x.id && Number.isFinite(x.tau));
  }
  const a = num(p.get('a'));
  if (a !== undefined) out.a = Math.min(0.6, Math.max(0, a));
  if (p.get('r')) out.r = p.get('r')!;
  const v = p.get('v')?.split(',').map(Number);
  if (v && v.length === 3 && v.every(Number.isFinite)) out.v = { lat: v[0], lon: v[1], zoom: v[2] };
  const s = p.get('s')?.split(',').map(Number);
  if (s && s.length === 2 && s.every(Number.isFinite)) out.s = { lat: s[0], lon: s[1] };
  if (p.get('p') === 'globe' || p.get('p') === 'mercator') out.p = p.get('p') as LinkState['p'];
  if (p.get('b') === 'satellite' || p.get('b') === 'dark') out.b = p.get('b') as LinkState['b'];
  if (p.has('tour')) out.tour = true;
  return out;
}

export function buildHash(s: LinkState): string {
  const parts: string[] = [];
  if (s.t) parts.push(`t=${encodeURIComponent(s.t)}`);
  if (s.w) parts.push(`w=${s.w.map((x) => +x.toFixed(2)).join('_')}`);
  if (s.f) parts.push(`f=${s.f.map((f) => `${f.id}:${+f.tau.toPrecision(4)}`).join(',')}`);
  if (s.a) parts.push(`a=${+s.a.toFixed(2)}`);
  if (s.r && s.r !== 'world') parts.push(`r=${encodeURIComponent(s.r)}`);
  if (s.v) parts.push(`v=${r4(s.v.lat)},${r4(s.v.lon)},${+s.v.zoom.toFixed(2)}`);
  if (s.s) parts.push(`s=${r4(s.s.lat)},${r4(s.s.lon)}`);
  if (s.p && s.p !== 'mercator') parts.push(`p=${s.p}`);
  if (s.b && s.b !== 'satellite') parts.push(`b=${s.b}`);
  return '#' + parts.join('&');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers without async clipboard (or without permission).
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
