import type { App } from './main';
import type { CellInfo } from './types';
import { activityFor } from './activities';
import { capability } from './capabilities';
import { esc, fmtLatLon, fmtValue } from './format';

export function openResearchReport(app: App, info: CellInfo, lat: number, lon: number): void {
  const target = app.target();
  const activity = activityFor(app.state.activity);
  const rows = app.ds.meta.features.map((feature, i) => {
    const here = fmtValue(feature.breakpoints[Math.min(feature.breakpoints.length - 1, Math.round((info.q[i] / 255) * (feature.breakpoints.length - 1)))], feature);
    const range = app.state.ranges[i];
    return `<tr><td>${esc(feature.name)}</td><td>${esc(here)}</td><td>${esc(String(range.low))} – ${esc(String(range.high))}</td></tr>`;
  }).join('');
  const report = `<!doctype html><html><head><meta charset="utf-8"><title>Analog Finder research report</title>
    <style>body{font:14px system-ui,sans-serif;max-width:900px;margin:40px auto;color:#15171c}h1{font-size:28px}h2{margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:5px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:7px;text-align:left}small{color:#59616d}.actions{position:fixed;top:15px;right:15px}@media print{.actions{display:none}body{margin:0}}</style></head>
    <body><div class="actions"><button onclick="print()">Print / save PDF</button></div>
    <small>Terrestrial Analog Finder · generated from the current view</small>
    <h1>${esc(target.name)} research report</h1>
    <p><b>Candidate:</b> ${esc(fmtLatLon(lat, lon))} · ${esc(app.countryName(info.country).name || 'Unknown location')}</p>
    <p><b>Mode:</b> ${esc(app.state.mode)} · <b>Activity:</b> ${esc(activity.name)}</p>
    <p><b>Similarity score:</b> ${(info.blended * 100).toFixed(1)} / 100 · <b>Novelty distance:</b> ${Math.round(info.noveltyKm).toLocaleString()} km</p>
    <h2>Interpretation</h2><p>${esc(activity.description)}</p><p><b>Capability:</b> ${activity.enabled ? 'supported as a contextual research view' : 'unavailable in this build'}.</p>
    ${activity.limitations.map((limitation) => `<p><b>Limitation:</b> ${esc(limitation)}</p>`).join('')}
    ${app.state.mode === 'radiation' ? `<p><b>${esc(capability('radiation').name)}:</b> ${esc(capability('radiation').explanation)}</p>` : ''}
    <h2>Physical values and target ranges</h2><table><thead><tr><th>Feature</th><th>Candidate</th><th>Active target range</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>Data integrity</h2><p>Scores are based on the published Earth percentile-normalized feature layers and active weights. They are analog indicators, not proof of operational suitability. Verify local terrain, access, safety, legal status, and mission-specific conditions independently.</p>
    </body></html>`;
  const popup = window.open('', '_blank');
  if (!popup) return;
  popup.document.write(report);
  popup.document.close();
  popup.focus();
}
