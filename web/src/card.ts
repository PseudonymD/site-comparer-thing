import type { App } from './main';
import type { CellInfo } from './types';
import { contributions, scoreCell, valueFromQ } from './scoring';
import { esc, flag, fmtKm, fmtLatLon, fmtValue, GROUP_HEX } from './format';
import { runDrill } from './drill';

const card = () => document.getElementById('card')!;

export function closeCard() {
  card().classList.add('hidden');
}

export function openCard(app: App, info: CellInfo, lat: number, lon: number, rank?: number) {
  const { meta } = app.ds;
  const t = app.target();
  const w = app.state.weights;
  const contrib = contributions(info.q, t.vector, w);
  const total = contrib.reduce((a, b) => a + b, 0);
  const s = scoreCell(info.q, t.vector, w);
  const filtered = info.score === 0 && s > 0;
  const pctl = app.percentileOf(info.blended || s);
  const country = app.countryName(info.country);
  const near = app.nearestAnalog(lat, lon);

  // Match per feature: 1 - |z - t|; "why" lines = top weighted matches & mismatches.
  const rows = meta.features.map((f, j) => ({
    f, j, z: info.q[j] / 255, t: t.vector[j], c: contrib[j], w: w[j],
    here: valueFromQ(f.breakpoints, info.q[j]), raw: t.raw[f.id],
  }));
  const weighted = rows.filter((r) => r.w > 0);
  const good = [...weighted].sort((a, b) => b.w * (1 - Math.abs(b.z - b.t)) - a.w * (1 - Math.abs(a.z - a.t))).slice(0, 3);
  const bad = [...weighted].sort((a, b) => b.c - a.c).slice(0, 3).filter((r) => r.c > 0.0005);

  const maxC = Math.max(...contrib, 1e-9);
  const barH = 15;
  const chartW = 520;
  const labelW = 150;
  const sorted = [...rows].sort((a, b) => b.c - a.c);
  const bars = sorted
    .map((r, k) => {
      const len = r.w > 0 ? ((chartW - labelW - 60) * r.c) / maxC : 0;
      const share = total > 0 ? (r.c / total) * 100 : 0;
      const y = k * (barH + 4);
      return `<g transform="translate(0,${y})">
        <text x="${labelW - 8}" y="${barH - 4}" text-anchor="end" fill="${r.w > 0 ? '#e8ecf6' : '#5b6480'}" font-size="11.5">${esc(r.f.name)}</text>
        <rect x="${labelW}" y="1" width="${chartW - labelW - 60}" height="${barH - 2}" rx="3" fill="rgba(255,255,255,0.03)"/>
        <rect x="${labelW}" y="1" width="${Math.max(r.w > 0 ? 1.5 : 0, len)}" height="${barH - 2}" rx="3" fill="${GROUP_HEX[r.f.ui_group]}" opacity="0.9"/>
        <text x="${chartW - 52}" y="${barH - 4}" fill="#8d97b3" font-size="11" font-family="JetBrains Mono, monospace">${r.w > 0 ? share.toFixed(0) + '%' : 'off'}</text>
      </g>`;
    })
    .join('');
  const chartH = sorted.length * (barH + 4);

  const tableRows = rows
    .map((r) => {
      const tv = r.raw.value === null ? `<span class="beyond" title="Beyond Earth's range; clamped to Earth max">> ${fmtValue(r.raw.clamped, r.f)}</span>` :
        r.raw.beyond_earth ? `<span class="beyond" title="Beyond Earth's range (clamped to ${fmtValue(r.raw.clamped, r.f)})">${fmtValue(r.raw.value, r.f)}</span>` : fmtValue(r.raw.value, r.f);
      const flagTxt = r.f.synthetic ? ' <span class="badge synth">SYNTH</span>' : r.f.proxy ? ' <span class="badge proxy">PROXY</span>' : '';
      return `<tr><td>${esc(r.f.name)}${flagTxt}</td><td>${fmtValue(r.here, r.f)}</td><td>${tv}</td><td>${Math.round(r.z * 100)}</td><td>${Math.round(r.t * 100)}</td></tr>`;
    })
    .join('');

  card().innerHTML = `
    <div class="card-head">
      <button class="card-close" id="card-close" aria-label="Close">✕</button>
      <div class="muted small">${rank ? `Candidate #${rank} · ` : ''}${esc(t.name)}</div>
      <h2>${flag(country.iso)} ${esc(country.name || 'Unknown location')}</h2>
      <div class="muted small mono">${fmtLatLon(lat, lon)} · cell ${info.cell}</div>
      <div class="kpis">
        <div class="kpi"><div class="k">Analog score</div><div class="v">${filtered ? '<span class="beyond">filtered</span>' : (s * 100).toFixed(1)}</div></div>
        <div class="kpi"><div class="k">Earth rank</div><div class="v">${Number.isFinite(pctl) ? `top ${Math.max(0.01, (1 - pctl) * 100).toFixed(pctl > 0.99 ? 2 : 1)}%` : '–'}</div></div>
        <div class="kpi"><div class="k">Novelty</div><div class="v" title="Distance to nearest known analog: ${esc(near.name)}">${fmtKm(info.noveltyKm)}</div></div>
      </div>
    </div>
    <div class="card-body">
      <div class="why">
        ${good.length ? `<div>✔ Matches ${t.body} on <b class="good">${good.map((r) => esc(r.f.name.toLowerCase())).join(', ')}</b>.</div>` : ''}
        ${bad.length ? `<div>✘ Biggest gaps: <b class="bad">${bad.map((r) => `${esc(r.f.name.toLowerCase())} (${fmtValue(r.here, r.f)} vs ${r.raw.value === null ? 'beyond Earth' : fmtValue(r.raw.value, r.f)})`).join(', ')}</b>.</div>` : ''}
        <div class="muted small" style="margin-top:4px">Nearest known analog: ${esc(near.name)} (${fmtKm(near.km)}).</div>
      </div>
      <h3>What drives the distance (share of weighted mismatch)</h3>
      <svg viewBox="0 0 ${chartW} ${chartH}" width="100%" style="max-width:${chartW}px">${bars}</svg>
      <h3>Values here vs target</h3>
      <table class="vals"><thead><tr><th>Feature</th><th>Here</th><th>${esc(t.body)} target</th><th>Here pctl</th><th>Target pctl</th></tr></thead><tbody>${tableRows}</tbody></table>
      <div class="muted small" style="margin-top:6px">Percentiles are Earth-land percentiles (0–100). Amber values lie beyond anything on Earth and were clamped before comparison.</div>
      <h3>Live 30 m terrain drill-down</h3>
      <div class="drill" id="drill">
        <div class="muted small" style="margin-bottom:8px">Fetches ~30 m elevation tiles for a 20 km box around this cell and compares its slope distribution with the target's high-resolution slope statistics.</div>
        <button class="btn small" id="drill-btn">Run drill-down</button>
        <div id="drill-out"></div>
      </div>
    </div>`;
  card().classList.remove('hidden');
  card().scrollTop = 0;
  document.getElementById('card-close')!.onclick = closeCard;
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
