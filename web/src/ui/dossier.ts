// Site dossier: rendered inside the right panel in place of the candidate list, so the map stays visible.
import type { App } from '../main';
import type { CellInfo, FeatureMeta } from '../types';
import { contributions, scoreCell, valueFromQ } from '../scoring';
import { esc, flag, fmtKm, fmtLatLon, fmtValue, GROUP_COLORS } from '../format';
import { runDrill } from '../drill';
import { fingerprint } from './fingerprint';
import { rail } from './rail';
import { planetPanel, watchPlanetTiles } from './planet';

// The side-by-side stays open while stepping through candidates.
let pmOpen = false;
/** Used by the tour to put the side-by-side open state back after the demo. */
export const planetOpen = () => pmOpen;
export const setPlanetOpen = (v: boolean) => {
  pmOpen = v;
};

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
  const contrib = contributions(info.q, t.vector, w);
  const total = contrib.reduce((a, b) => a + b, 0);
  const s = scoreCell(info.q, t.vector, w);
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
      const tv = r.raw.value === null ? `<span class="beyond" title="Beyond Earth's range; clamped to Earth max">> ${fmtValue(r.raw.clamped, r.f)}</span>` :
        r.raw.beyond_earth ? `<span class="beyond" title="Beyond Earth's range (clamped to ${fmtValue(r.raw.clamped, r.f)})">${fmtValue(r.raw.value, r.f)}</span>` : fmtValue(r.raw.value, r.f);
      return `<tr class="${r.w > 0 ? '' : 'off'}"><td>${esc(r.f.name)}</td><td>${fmtValue(r.here, r.f)}</td><td>${tv}</td><td>${Math.round(r.z * 100)}</td><td>${Math.round(r.t * 100)}</td></tr>`;
    })
    .join('');

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
    <div class="d-share"><nav class="d-jump" aria-label="Jump to a section"><button class="text-btn" data-jump="d-ev">Evidence</button><button class="text-btn" data-jump="d-pm">Side by side</button><button class="text-btn" data-jump="d-dr">Terrain close-up</button></nav><button class="text-btn" id="d-copy" title="Copy a link that opens this exact view">Copy link</button></div>
    <div class="d-scroll">
      <div class="d-head">
        ${fingerprint(meta.features, t.vector, z, 104, `Fingerprint of this site against ${t.name}`)}
        <div class="d-id">
          <div class="eyebrow">${fmtLatLon(lat, lon)} · cell ${info.cell}</div>
          <h2>${flag(country.iso)} ${esc(country.name || 'Unknown location')}</h2>
          <div class="facts">
            <div class="big">${filtered ? '<span class="beyond">filtered</span>' : (s * 100).toFixed(1)}</div>
            <div><b>${rankTxt}</b>of Earth's land</div>
            <div title="Nearest known analog: ${esc(near.name)}"><b>${fmtKm(info.noveltyKm)}</b>from a known analog</div>
          </div>
        </div>
      </div>
      <div class="d-why">
        ${good.length ? `<p><b>Matches ${t.body} on</b> ${good.map((r) => esc(lower(r.f.name))).join(', ')}.</p>` : ''}
        ${bad.length ? `<p><b>Biggest gaps:</b> ${bad.map((r) => `${esc(lower(r.f.name))} (${fmtValue(r.here, r.f)} vs ${targetText(r)})`).join(', ')}.</p>` : ''}
        <p class="note">Nearest known analog: ${esc(near.name)}, ${fmtKm(near.km)} away.${filtered ? ' This cell is excluded by one of your filters.' : ''}</p>
      </div>
      <div class="d-sec" id="d-ev">
        <h3>Where it differs</h3>
        <div class="rail-key"><span><i class="k-t"></i>target</span><span><i class="k-s"></i>this site</span><span>rank among all land, low → high</span><span class="k-share">share of gap</span></div>
        ${rails}
        ${off ? `<p class="note">${off} layer${off > 1 ? 's' : ''} with weight 0 not shown.</p>` : ''}
        <details class="all-values"><summary>Show all values</summary>
          <table class="vals"><thead><tr><th>Layer</th><th>Here</th><th>${esc(t.body)} target</th><th>Here %ile</th><th>Target %ile</th></tr></thead><tbody>${tableRows}</tbody></table>
          <p class="note">Percentiles rank this value among all land on Earth (0–100). Highlighted targets lie beyond anything on Earth and were clamped before comparison.</p>
        </details>
      </div>
      <div class="d-sec" id="d-pm">
        <h3>Side by side with ${esc(t.body)}</h3>
        <p class="note">The target's real terrain next to this candidate, at a similar ground scale.</p>
        <button class="btn" id="pm-btn">Show ${esc(t.body)} beside Earth</button>
        <div id="pm-out"></div>
      </div>
      <div class="d-sec" id="d-dr">
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
  el().querySelectorAll<HTMLButtonElement>('[data-jump]').forEach((b) => {
    b.onclick = () => document.getElementById(b.dataset.jump!)?.scrollIntoView({ block: 'start' });
  });
  document.getElementById('d-back')!.onclick = nav.onBack;
  document.getElementById('d-copy')!.onclick = nav.onCopy;
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
