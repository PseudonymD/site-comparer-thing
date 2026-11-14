import type { App } from '../main';
import type { CellInfo } from '../types';
import { complicationEvidence } from '../complications';
import { activityById } from '../activities';
import { contributions, scoreCell, valueFromQ, valueFromZ } from '../scoring';
import { esc, fmtLatLon, fmtValue } from '../format';
import { validationSummary } from './validation';

const modes = {
  direct: 'Direct comparison',
  exploration: 'Exploration',
  'earth-complications': 'Comparison + Earth complications',
} as const;

const reportEl = () => document.getElementById('report')!;
const close = () => reportEl().classList.add('hidden');

export function openResearchReport(app: App, info: CellInfo, lat: number, lon: number) {
  const { meta } = app.ds;
  const target = app.target();
  const activity = activityById(app.state.activity);
  const z = info.q.map((q) => q / 255);
  const contrib = contributions(info.q, target.vector, app.state.weights, app.state.ranges);
  const total = contrib.reduce((sum, value) => sum + value, 0);
  const score = scoreCell(info.q, target.vector, app.state.weights, [], app.state.ranges);
  const pointScore = scoreCell(info.q, target.vector, app.state.weights);
  const validation = validationSummary(app.ds.validation, app.ds.analogs, target.id);
  const rows = meta.features.map((feature, j) => {
    const raw = target.raw[feature.id];
    const range = app.state.ranges[j];
    const gap = Math.max(range.min - z[j], 0, z[j] - range.max);
    const targetInterval = Math.abs(range.min - range.max) < 1e-9
      ? fmtValue(valueFromZ(feature.breakpoints, range.min), feature)
      : `${fmtValue(valueFromZ(feature.breakpoints, range.min), feature)} – ${fmtValue(valueFromZ(feature.breakpoints, range.max), feature)}`;
    return {
      feature, j, raw, z: z[j], here: valueFromQ(feature.breakpoints, info.q[j]), targetInterval,
      gap, weight: app.state.weights[j], share: total ? (contrib[j] / total) * 100 : 0,
    };
  });
  const mismatch = rows.filter((row) => row.gap > 0 && row.weight > 0).sort((a, b) => b.gap - a.gap).slice(0, 5);
  const complications = app.state.mode === 'earth-complications'
    ? complicationEvidence(target, rows.map((row) => ({ feature: row.feature, measurement: row.here, percentile: row.z })))
    : [];
  const validationText = validation
    ? `${validation.result.analogs.length} documented registry sites evaluated; ${validation.counts.top10} in the top 10, ${validation.counts.top25} in the top 25, and ${validation.counts.top50} in the top 50.`
    : 'No validation result is available for this target.';
  const url = app.linkFor({ lat, lon });
  const date = new Date().toISOString().slice(0, 10);
  const table = rows.map((row) => `<tr>
    <td>${esc(row.feature.name)}</td><td>${fmtValue(row.here, row.feature)}</td><td>${Math.round(row.z * 100)}%</td>
    <td>${row.raw.value === null ? 'beyond Earth' : fmtValue(row.raw.value, row.feature)}</td><td>${row.targetInterval}</td>
    <td>${(row.gap * 100).toFixed(1)}%</td><td>${row.weight.toFixed(0)}%</td><td>${row.feature.source_name}</td>
  </tr>`).join('');
  reportEl().innerHTML = `<article class="report-preview" role="dialog" aria-modal="true" aria-label="Research report preview">
    <header class="report-actions no-print"><button class="btn" id="report-print">Print / Save PDF</button><button class="text-btn" id="report-close">Close</button></header>
    <header class="report-header"><div class="eyebrow">Terrestrial Analog Finder</div><h1>Research report</h1><p>${esc(target.name)} · ${esc(fmtLatLon(lat, lon))} · ${date}</p></header>
    <section class="report-section report-overview"><h2>Study context</h2><dl>
      <dt>Planetary target</dt><dd>${esc(target.name)}</dd><dt>Research activity</dt><dd>${esc(activity.name)} — ${esc(activity.availability)}</dd>
      <dt>Map mode</dt><dd>${modes[app.state.mode]}</dd><dt>Earth location</dt><dd>${esc(fmtLatLon(lat, lon))}</dd>
      <dt>Similarity</dt><dd>${(score * 100).toFixed(1)} / 100${score !== pointScore ? `; point baseline ${(pointScore * 100).toFixed(1)} / 100` : ''}</dd>
    </dl></section>
    <section class="report-section"><h2>Feature comparison</h2><p class="report-note">Earth physical values are reconstructed from the selected grid cell. Percentiles rank the value among Earth's land and are not physical units. Gap is distance from the user-selected interval in percentile space.</p>
      <table class="report-table"><thead><tr><th>Feature</th><th>Earth</th><th>Earth %ile</th><th>Literature target</th><th>Selected range</th><th>Gap</th><th>Weight</th><th>Source</th></tr></thead><tbody>${table}</tbody></table>
    </section>
    <section class="report-section"><h2>Evidence and limitations</h2>
      <p><b>Activity guidance:</b> ${esc(activity.recommendation)}</p>
      <p><b>Activity limitations:</b> ${esc(activity.limitations.join(' '))}</p>
      ${mismatch.length ? `<h3>Largest interval mismatches</h3><ul>${mismatch.map((row) => `<li>${esc(row.feature.name)}: ${fmtValue(row.here, row.feature)} at Earth percentile ${Math.round(row.z * 100)}%; gap ${(row.gap * 100).toFixed(1)}%.</li>`).join('')}</ul>` : '<p>No weighted feature is outside the selected interval.</p>'}
      <p><b>Validation context:</b> ${esc(validationText)} This is not an independent predictive-accuracy claim.</p>
    </section>
    ${complications.length ? `<section class="report-section"><h2>Earth complications</h2><p>These contextual assessments are separate from similarity and are not penalty terms.</p><ul>${complications.map((item) => `<li><b>${esc(item.title)} — ${esc(item.status)}:</b> ${esc(item.summary)} ${esc(item.limitation)}</li>`).join('')}</ul></section>` : ''}
    <section class="report-section"><h2>Data provenance</h2><ul>${meta.features.map((feature) => `<li><b>${esc(feature.name)}:</b> ${esc(feature.source_name)}; ${esc(feature.resolution || 'resolution not provided')}; ${esc(feature.temporal_coverage || 'temporal coverage not provided')}; ${esc(feature.uncertainty || 'uncertainty not provided')}.</li>`).join('')}</ul></section>
    <section class="report-section"><h2>Shareable application state</h2><p class="report-url">${esc(url)}</p></section>
    <footer class="report-footer">Generated deterministically from the current application state. No AI-generated scientific conclusions.</footer>
  </article>`;
  reportEl().classList.remove('hidden');
  reportEl().querySelector('#report-close')!.addEventListener('click', close);
  reportEl().querySelector('#report-print')!.addEventListener('click', () => window.print());
}
