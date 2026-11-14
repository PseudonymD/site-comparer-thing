// Site dossier: rendered inside the right panel in place of the candidate list, so the map stays visible.
import type { App } from '../main';
import type { CellInfo, FeatureMeta } from '../types';
import { contributions, scoreCell, valueFromQ, valueFromZ } from '../scoring';
import { esc, flag, fmtKm, fmtLatLon, fmtValue, GROUP_COLORS } from '../format';
import { runDrill } from '../drill';
import { fingerprint } from './fingerprint';
import { rail } from './rail';
import { planetPanel, watchPlanetTiles } from './planet';
import { complicationEvidence } from '../complications';
import { openResearchReport } from './report';

// The side-by-side stays open while stepping through candidates.
let pmOpen = false;

export interface DossierNav {
  rank?: number; // 1-based position in the candidate list, when opened from it
  total: number;
  onBack(): void;
  onStep(delta: number): void;
  onCopy(): void;
}

const el = () => document.getElementById('dossier')!;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const bare = (v: number, f: FeatureMeta) => fmtValue(v, f.unit === 'fraction' ? f : { ...f, unit: '' });

export function renderDossier(app: App, info: CellInfo, lat: number, lon: number, nav: DossierNav, keepScroll = false) {
  const { meta } = app.ds;
  const t = app.target();
  const w = app.state.weights;
  const contrib = contributions(info.q, t.vector, w, app.state.ranges);
  const total = contrib.reduce((a, b) => a + b, 0);
  const s = scoreCell(info.q, t.vector, w, [], app.state.ranges);
  const pointScore = scoreCell(info.q, t.vector, w);
  const rangeChanged = app.state.ranges.some((range, j) => range.min !== t.vector[j] || range.max !== t.vector[j]);
  const filtered = info.score === 0 && s > 0;
  const pctl = filtered ? NaN : app.percentileOf(info.blended);
  const country = app.countryName(info.country);
  const near = app.nearestAnalog(lat, lon);
  const z = info.q.map((q) => q / 255);

  const rows = meta.features.map((f, j) => ({
    f, j, z: z[j], t: t.vector[j], c: contrib[j], w: w[j],
    here: valueFromQ(f.breakpoints, info.q[j]), raw: t.raw[f.id],
  }));
  const weighted = rows.filter((r) => r.w > 0);
  const good = [...weighted].sort((a, b) => b.w * (1 - Math.abs(b.z - b.t)) - a.w * (1 - Math.abs(a.z - a.t))).slice(0, 3);
  const bad = [...weighted].sort((a, b) => b.c - a.c).slice(0, 3).filter((r) => r.c > 0.0005);
  const targetText = (r: (typeof rows)[number]) => (r.raw.value === null ? 'beyond Earth' : fmtValue(r.raw.value, r.f));
  const targetIntervalText = (r: (typeof rows)[number]) => {
    const range = app.state.ranges[r.j];
    const lo = valueFromZ(r.f.breakpoints, range.min);
    const hi = valueFromZ(r.f.breakpoints, range.max);
    return Math.abs(lo - hi) < 1e-9 ? fmtValue(lo, r.f) : `${fmtValue(lo, r.f)} – ${fmtValue(hi, r.f)}`;
  };
  const targetClass = (r: (typeof rows)[number]) => r.raw.refs.length ? (r.raw.refs.some((ref) => ref.includes('proxy')) ? 'proxy' : 'literature-derived') : 'assumed/model input';
  const sourceDetails = (r: (typeof rows)[number]) => [
    r.f.source_name,
    r.f.measurement_class,
    r.f.resolution,
    r.f.temporal_coverage,
    r.f.data_quality,
    r.f.uncertainty,
    r.f.coverage === null ? '' : `coverage ${Math.round(r.f.coverage * 100)}%`,
    r.f.notes || '',
  ].filter(Boolean).join(' · ');

  const maxC = Math.max(...contrib, 1e-9);
  const off = rows.length - weighted.length;
  const rails = [...weighted]
    .sort((a, b) => b.c - a.c)
    .map((r) => {
      const share = total > 0 ? (r.c / total) * 100 : 0;
      const flagTxt = r.f.synthetic ? ' · <span class="beyond">placeholder data</span>' : r.f.proxy ? ' · proxy' : '';
      return `<div class="rail" title="${esc(r.f.name)}: here at Earth percentile ${Math.round(r.z * 100)}, target at ${Math.round(r.t * 100)}">
        <div class="rail-name"><div class="n">${esc(r.f.name)}</div><div class="v">${bare(r.here, r.f)} → ${targetText(r)}${flagTxt}</div></div>
        ${rail(r.t, r.z, r.c / maxC, GROUP_COLORS[r.f.ui_group])}
        <div class="rail-share">${share >= 0.5 ? share.toFixed(0) + '%' : '·'}</div>
      </div>`;
    })
    .join('');
  const tableRows = rows
    .map((r) => {
      const tv = r.raw.value === null ? `<span class="beyond" title="Beyond Earth's range; clamped to Earth max">beyond Earth</span>` :
        r.raw.beyond_earth ? `<span class="beyond" title="Beyond Earth's range (clamped to ${fmtValue(r.raw.clamped, r.f)})">${fmtValue(r.raw.value, r.f)}</span>` : fmtValue(r.raw.value, r.f);
      const gap = Math.max(app.state.ranges[r.j].min - r.z, 0, r.z - app.state.ranges[r.j].max);
      const share = total > 0 ? `${((r.c / total) * 100).toFixed(1)}%` : '–';
      return `<tr class="${r.w > 0 ? '' : 'off'}"><td>${esc(r.f.name)}</td><td>${fmtValue(r.here, r.f)}</td><td>${Math.round(r.z * 100)}</td><td>${tv}</td><td>${targetIntervalText(r)}</td><td>${(gap * 100).toFixed(1)}</td><td>${r.w.toFixed(1)}%</td><td>${share}</td></tr>
        <tr class="meta-row ${r.w > 0 ? '' : 'off'}"><td colspan="8"><details><summary>${esc(sourceDetails(r))}</summary><span>Target: ${esc(targetClass(r))}; references: ${esc(r.raw.refs.join(', ') || 'none listed')}; target uncertainty: not provided.</span></details></td></tr>`;
    })
    .join('');
  const complicationRows = rows.map((r) => ({ feature: r.f, measurement: r.here, percentile: r.z }));
  const complications = app.state.mode === 'earth-complications' ? complicationEvidence(t, complicationRows) : [];

  const rankTxt = Number.isFinite(pctl) ? `top ${Math.max(0.01, (1 - pctl) * 100).toFixed(pctl > 0.99 ? 2 : 1)}%` : '–';
  const prevScroll = keepScroll ? ((el().querySelector('.d-scroll') as HTMLElement | null)?.scrollTop ?? 0) : 0;
  const oldDrill = keepScroll ? document.getElementById('drill-out') : null;
  el().innerHTML = `
    <div class="d-nav">
      <button class="text-btn" id="d-back">← All candidates</button>
      ${nav.rank ? `<div class="d-step"><span>${nav.rank} of ${nav.total}</span>
        <button class="icon-btn" id="d-prev" aria-label="Previous candidate" ${nav.rank <= 1 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" id="d-next" aria-label="Next candidate" ${nav.rank >= nav.total ? 'disabled' : ''}>↓</button></div>` : '<div class="d-step"><span>Picked on the map</span></div>'}
    </div>
    <div class="d-share"><button class="text-btn" id="d-copy" title="Copy a link that opens this exact view">Copy link</button><button class="btn" id="report-btn">Generate Research Report</button></div>
    <div class="d-scroll">
      <div class="d-head">
        ${fingerprint(meta.features, t.vector, z, 104, `Fingerprint of this site against ${t.name}`)}
        <div class="d-id">
          <div class="eyebrow">${fmtLatLon(lat, lon)} · cell ${info.cell}</div>
          <h2>${flag(country.iso)} ${esc(country.name || 'Unknown location')}</h2>
          <div class="facts">
            <div class="big">${filtered ? '<span class="beyond">filtered</span>' : (s * 100).toFixed(1)}</div>
            <div><b>${rankTxt}</b>of Earth's land<br><span class="note">similarity score / 100</span></div>
            <div title="Nearest known analog: ${esc(near.name)}"><b>${fmtKm(info.noveltyKm)}</b>from a known analog</div>
          </div>
        </div>
      </div>
      <div class="d-why">
        ${rangeChanged ? `<p class="note">Range-based score <b>${(s * 100).toFixed(1)}</b> vs point baseline <b>${(pointScore * 100).toFixed(1)}</b> (${((s - pointScore) * 100).toFixed(1)} points). Acceptable intervals describe comparison tolerance, not site suitability.</p>` : ''}
        ${good.length ? `<p><b>Matches ${t.body} on</b> ${good.map((r) => esc(lower(r.f.name))).join(', ')}.</p>` : ''}
        ${bad.length ? `<p><b>Biggest gaps:</b> ${bad.map((r) => `${esc(lower(r.f.name))} (${fmtValue(r.here, r.f)} vs ${targetText(r)})`).join(', ')}.</p>` : ''}
        <p class="note">Nearest known analog: ${esc(near.name)}, ${fmtKm(near.km)} away.${filtered ? ' This cell is excluded by one of your filters.' : ''}</p>
      </div>
      <div class="d-sec">
        <h3>Where it differs</h3>
        <div class="rail-key"><span><i class="k-t"></i>target</span><span><i class="k-s"></i>this site</span><span>rank among all land, low → high</span><span class="k-share">share of gap</span></div>
        ${rails}
        ${off ? `<p class="note">${off} layer${off > 1 ? 's' : ''} with weight 0 not shown.</p>` : ''}
        <details class="all-values"><summary>Show all values</summary>
          <table class="vals"><thead><tr><th>Feature</th><th>Earth</th><th>Earth %ile</th><th>Literature target</th><th>Selected interval</th><th>Gap %ile</th><th>Weight</th><th>Gap share</th></tr></thead><tbody>${tableRows}</tbody></table>
          <p class="note">Earth values are physical measurements or estimates from the listed source. Percentiles rank values among Earth's land; gap %ile is the distance from the selected target interval. A wider interval is not a suitability claim.</p>
        </details>
      </div>
      ${complications.length ? `<div class="d-sec complications"><h3>Earth complications</h3><p class="note">These are separate contextual assessments, not penalties or additions to the similarity score.</p>
        ${complications.map((item) => `<details class="complication ${item.status}"><summary><span>${esc(item.title)}</span><b>${item.status}</b></summary><p>${esc(item.summary)}</p>${item.evidence.length ? `<ul>${item.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}<p class="note">${esc(item.limitation)}</p></details>`).join('')}
        <p class="note">Pressure references: <a href="https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html" target="_blank" rel="noreferrer">NASA Moon fact sheet</a>; <a href="https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html" target="_blank" rel="noreferrer">NASA Mars fact sheet</a>.</p>
      </div>` : ''}
      <div class="d-sec">
        <h3>Side by side with ${esc(t.body)}</h3>
        <p class="note">The target's real terrain next to this candidate, at a similar ground scale.</p>
        <button class="btn" id="pm-btn">Show ${esc(t.body)} beside Earth</button>
        <div id="pm-out"></div>
      </div>
      <div class="d-sec">
        <h3>Terrain close-up</h3>
        <p class="note">Fetches ~30 m elevation for a 20 km box around this cell and compares its slopes with the target's.</p>
        <button class="btn" id="drill-btn">Run terrain close-up</button>
        <div id="drill-out"></div>
      </div>
    </div>`;
  el().classList.remove('hidden');
  (el().querySelector('.d-scroll') as HTMLElement).scrollTop = prevScroll;
  if (oldDrill && oldDrill.childNodes.length) {
    // Re-scoring re-renders the dossier; keep a terrain close-up that has already been run.
    document.getElementById('drill-out')!.replaceWith(oldDrill);
    document.getElementById('drill-btn')!.textContent = 'Run again';
  }
  document.getElementById('d-back')!.onclick = nav.onBack;
  document.getElementById('d-copy')!.onclick = nav.onCopy;
  document.getElementById('report-btn')!.onclick = () => openResearchReport(app, info, lat, lon);
  const pmBtn = document.getElementById('pm-btn') as HTMLButtonElement;
  const pmOut = document.getElementById('pm-out')!;
  const showPm = () => {
    pmOut.innerHTML = planetPanel(t, lat, lon);
    watchPlanetTiles(pmOut);
    pmBtn.textContent = `Hide ${t.body}`;
    pmOpen = true;
  };
  pmBtn.onclick = () => {
    if (pmOpen) {
      pmOut.innerHTML = '';
      pmBtn.textContent = `Show ${t.body} beside Earth`;
      pmOpen = false;
    } else showPm();
  };
  if (pmOpen) showPm();
  const prev = document.getElementById('d-prev');
  const next = document.getElementById('d-next');
  if (prev) prev.onclick = () => nav.onStep(-1);
  if (next) next.onclick = () => nav.onStep(1);
  document.getElementById('drill-btn')!.onclick = () => {
    (document.getElementById('drill-btn') as HTMLButtonElement).disabled = true;
    void runDrill(lat, lon, t, document.getElementById('drill-out')!).finally(() => {
      const b = document.getElementById('drill-btn') as HTMLButtonElement | null;
      if (b) {
        b.disabled = false;
        b.textContent = 'Run again';
      }
    });
  };
}

export function hideDossier() {
  el().classList.add('hidden');
}
