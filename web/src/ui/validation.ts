import type { Dataset } from '../data';
import type { Activity } from '../activities';
import { esc } from '../format';

function classLabel(site: Dataset['analogs'][number] | undefined): string {
  if (!site) return 'unclassified';
  if (site.validation_class === 'parameter-tuning') return 'parameter-tuning';
  if (site.validation_class === 'held-out') return 'independent hold-out';
  return 'development';
}

function rankBand(rank: number | null): 'top10' | 'top25' | 'top50' | 'other' {
  if (rank !== null && rank <= 10) return 'top10';
  if (rank !== null && rank <= 25) return 'top25';
  if (rank !== null && rank <= 50) return 'top50';
  return 'other';
}

export function validationSummary(file: Dataset['validation'], analogs: Dataset['analogs'], targetId: string) {
  const result = file?.results.find((item) => item.target === targetId);
  if (!result) return null;
  const byId = new Map(analogs.map((site) => [site.id, site]));
  const counts = { top10: 0, top25: 0, top50: 0 };
  result.analogs.forEach((site) => {
    const band = rankBand(site.rank);
    if (band === 'top10') counts.top10++;
    if (band === 'top25' || band === 'top10') counts.top25++;
    if (band === 'top50' || band === 'top25' || band === 'top10') counts.top50++;
  });
  return { result, counts, byId };
}

export function renderValidation(el: HTMLElement, ds: Dataset, targetId: string, activity: Activity) {
  const summary = validationSummary(ds.validation, ds.analogs, targetId);
  if (!summary) {
    el.innerHTML = '<div class="panel-head"><h2>Known-analog validation</h2></div><p class="empty-state">Validation results are not available for this target in this data build.</p>';
    return;
  }
  const { result, counts, byId } = summary;
  const rows = result.analogs.map((site) => {
    const registry = byId.get(site.id);
    const status = registry?.documentation_status === 'incomplete' ? ' · incomplete documentation' : '';
    return `<tr><td>${esc(site.name)}</td><td>${site.rank === null ? '–' : site.rank.toLocaleString()}</td><td>${site.percentile.toFixed(1)}%</td><td><span class="validation-class">${esc(classLabel(registry))}</span>${status ? `<span class="note">${esc(status)}</span>` : ''}</td></tr>`;
  }).join('');
  const bars = [
    ['Top 10', counts.top10, 'top10'],
    ['Top 25', counts.top25, 'top25'],
    ['Top 50', counts.top50, 'top50'],
    ['Outside top 50', result.analogs.length - counts.top50, 'other'],
  ].map(([label, count, cls]) => `<div class="validation-bar"><span>${label}</span><i class="${cls as string}" style="width:${((Number(count) / Math.max(result.analogs.length, 1)) * 100).toFixed(1)}%"></i><b>${count}</b></div>`).join('');
  el.innerHTML = `
    <div class="panel-head"><h2>Known-analog validation</h2><div class="note">${esc(result.name)}</div></div>
    <div class="validation-summary">
      <div><b>${result.analogs.length}</b><span>sites evaluated</span></div>
      <div><b>${counts.top10}</b><span>in top 10</span></div>
      <div><b>${counts.top25}</b><span>in top 25</span></div>
      <div><b>${counts.top50}</b><span>in top 50</span></div>
    </div>
    <p class="note">Current activity: <b>${esc(activity.name)}</b>. Activity selection is shown for context and does not change this target-level validation.</p>
    <div class="validation-bars">${bars}</div>
    <table class="validation-table"><thead><tr><th>Registry site</th><th>Rank</th><th>Earth percentile</th><th>Classification</th></tr></thead><tbody>${rows}</tbody></table>
    <details class="validation-method"><summary>Method and limitations</summary>
      <p>Every land cell was scored with the selected target's default weights and filters. Each site uses the best cell within approximately ±2 grid cells (~20 km) of its published coordinate and is compared with ${ds.validation?.n_random ?? 0} random land cells.</p>
      <p>ROC-AUC: <b>${result.auc.toFixed(3)}</b>. Median analog percentile: <b>${result.median_analog_percentile.toFixed(1)}</b>. This is a method sanity check, not predictive accuracy.</p>
      <p>No registry site is an independent held-out validation site: the registry was known before evaluation. The University Valley entry is marked parameter-tuning because it was added during the Arcadia analog-list revision. Most registry notes lack complete validation provenance.</p>
    </details>`;
}
