// A percentile rail: a 0–100 Earth-percentile track with a tick for the target and a dot for the site.
// The connector's thickness shows how much this feature costs the score (0..1 relative to the worst).
export function rail(target: number, site: number, cost: number, color: string, off = false): string {
  const pc = (v: number) => (Math.min(1, Math.max(0, v)) * 100).toFixed(1);
  const lo = Math.min(target, site);
  const hi = Math.max(target, site);
  const th = (2 + 5 * Math.min(1, Math.max(0, cost))).toFixed(1);
  const link = off ? '' : `<i class="rail-link" style="left:${pc(lo)}%;width:${pc(hi - lo)}%;height:${th}px;background:${color}"></i>`;
  return `<div class="rail-track${off ? ' off' : ''}" aria-hidden="true">${link}<i class="rail-t" style="left:${pc(target)}%"></i><i class="rail-s" style="left:${pc(site)}%"></i></div>`;
}
