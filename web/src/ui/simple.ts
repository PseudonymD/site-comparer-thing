// Simple Mode: a plain-language presentation layer over the same app, data and scoring engine.
//
// This file draws one panel (#simple-panel) with two views: "pick a place on the Moon or Mars, see the best
// matches on Earth" and "result for one Earth location". It owns no scoring and no data. Everything it shows
// comes from the objects main.ts already has: the scored sites from the worker, the cell values from the worker,
// and app.state.weights (which main.ts sets to the shipped default mode while Simple Mode is on).
import type { App } from '../main';
import type { CellInfo, KnownAnalog, ScoreResult, Target } from '../types';
import { REGIONS as GEO_REGIONS, type RegionId } from '../geography';
import { esc, flag, fmtLatLon } from '../format';
import { scoreCell } from '../scoring';
import { planetPanel, watchPlanetTiles } from './planet';
import { compare, explain, matchLabel, topPercent, TARGET_PLAIN, type PlainRow } from './plain';

export interface SimpleHost {
  app: App;
  pickTarget(i: number): void;
  openCell(lat: number, lon: number, rank: number): void;
  closeCell(): void;
  setRegion(id: RegionId | ''): void;
  region(): RegionId | '';
  switchToNormal(): void;
  openAbout(): void;
  toggleTheme(): void;
}

const TOP_N = 6;
const KEY_ROWS = 6;
const $ = <T extends HTMLElement = HTMLElement>(sel: string, scope: ParentNode = document) => scope.querySelector(sel) as T;

export function createSimple(host: SimpleHost) {
  const { app } = host;
  const panel = $('#simple-panel');
  let lastSites: ScoreResult['sites'] = [];
  let resultOpen = false;

  const targets = app.ds.targets.targets;
  const plain = (t: Target) => TARGET_PLAIN[t.id] ?? { name: t.name, tag: '', about: t.blurb };
  const group = (body: string) =>
    targets
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t.body === body)
      .map(({ t, i }) => `<button type="button" class="sm-target" data-i="${i}" aria-pressed="false"><b>${esc(plain(t).name)}</b><span>${esc(plain(t).tag)}</span></button>`)
      .join('');

  panel.innerHTML = `
    <div class="sm-scroll">
      <section id="sm-pick" aria-labelledby="sm-pick-title">
        <div class="eyebrow">Step 1 · Choose a place to compare with</div>
        <h2 id="sm-pick-title" tabindex="-1">Where on Earth looks like the Moon or Mars?</h2>
        <p class="note">Pick a place on the Moon or Mars. We find the places on Earth that look and behave most like it, using 18 measurements from NASA and other open data.</p>
        <div class="sm-group"><div class="eyebrow">The Moon</div><div class="sm-targets">${group('Moon')}</div></div>
        <div class="sm-group"><div class="eyebrow">Mars</div><div class="sm-targets">${group('Mars')}</div></div>
        <p class="sm-about" id="sm-about"></p>
        <div class="eyebrow sm-step">Step 2 · See the best matches on Earth</div>
        <label class="sm-region">Look in
          <select id="sm-region"><option value="">The whole world</option>${(Object.keys(GEO_REGIONS) as RegionId[]).map((id) => `<option value="${id}">${esc(GEO_REGIONS[id])}</option>`).join('')}</select>
        </label>
        <ol id="sm-matches" class="sm-matches" aria-live="polite"></ol>
        <p class="note">Or click anywhere on the map to check how well that spot matches.</p>
      </section>
      <section id="sm-result" aria-live="polite" hidden></section>
    </div>`;

  const pick = $('#sm-pick');
  const result = $('#sm-result');
  const scroll = $('.sm-scroll');
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.sm-target')];
  buttons.forEach((b) => (b.onclick = () => host.pickTarget(+b.dataset.i!)));
  const regionSel = $<HTMLSelectElement>('#sm-region');
  regionSel.onchange = () => host.setRegion(regionSel.value as RegionId | '');

  // ---- top bar and legend (static markup lives in index.html)
  $('#sm-normal').onclick = () => host.switchToNormal();
  $('#sm-how').onclick = () => host.openAbout();
  $('#sm-theme').onclick = () => host.toggleTheme();

  function onTarget() {
    const t = app.target();
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i! === app.state.t)));
    $('#sm-about').textContent = plain(t).about;
    regionSel.value = host.region();
  }

  function onScored(res: ScoreResult) {
    lastSites = res.sites;
    const list = $('#sm-matches');
    list.innerHTML = '';
    if (!res.sites.length) {
      list.innerHTML = '<li class="note">No matches found here. Try "The whole world".</li>';
      return;
    }
    res.sites.slice(0, TOP_N).forEach((s, i) => {
      const c = app.countryName(s.country);
      const m = matchLabel(app.percentileOf(s.blended));
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" class="sm-match"><span class="rank">${i + 1}</span>
        <span class="where"><b>${flag(c.iso)} ${esc(c.name || 'Unknown place')}</b><span class="note">${fmtLatLon(s.lat, s.lon)}</span></span>
        <span class="sm-sc"><b>${(s.blended * 100).toFixed(1)}</b><span class="sm-chip tone-${m.tone}">${esc(m.label)}</span></span></button>`;
      const btn = li.firstElementChild as HTMLButtonElement;
      btn.onclick = () => host.openCell(s.lat, s.lon, i + 1);
      btn.onmouseenter = btn.onfocus = () => app.map.pulseSite(i);
      btn.onmouseleave = btn.onblur = () => app.map.pulseSite(null);
      list.appendChild(li);
    });
  }

  const rowHTML = (r: PlainRow) => `
    <div class="sm-row${r.used ? '' : ' off'}" title="${esc(r.what)}">
      <div class="sm-row-head"><b>${esc(r.label)}</b><span class="sm-chip c-${r.closeness.replace(' ', '-')}">${r.skipped ? 'not applicable' : esc(r.closeness)}</span></div>
      <div class="sm-row-body"><span><i>This place</i>${esc(r.here)}</span><span><i>Target</i>${esc(r.there)}</span></div>
    </div>`;
  const pointHTML = (r: PlainRow) => `<li><b>${esc(r.label)}</b><span>This place: ${esc(r.here)}<br>Target: ${esc(r.there)}</span></li>`;

  function showResult(info: CellInfo, clat: number, clon: number, analog: KnownAnalog | null) {
    const t = app.target();
    const body = t.body as 'Moon' | 'Mars';
    const skip = info.excluded ?? [];
    const w = app.state.weights.map((x, j) => (skip.includes(j) ? 0 : x));
    const cmp = compare({ features: app.ds.meta.features, q: info.q, target: t, weights: app.state.weights, skip });
    const s = scoreCell(info.q, t.vector, w);
    const filtered = info.score === 0 && s > 0;
    const pctl = filtered ? NaN : app.percentileOf(info.blended);
    const m = matchLabel(pctl);
    const c = app.countryName(info.country);
    const country = c.name || 'This location';
    const place = analog ? analog.name : country; // a known test site is shown by its own name
    const tp = plain(t);
    const byWeight = [...cmp.rows].sort((a, b) => b.weight - a.weight || a.index - b.index);
    const key = byWeight.slice(0, KEY_ROWS);
    const rest = byWeight.slice(KEY_ROWS);
    const rankLine = filtered
      ? 'This spot is left out of the ranking because it is mostly permanent ice, which does not suit this target.'
      : `Ranks in the <b>${topPercent(pctl)}</b> of land on Earth for ${esc(tp.name)}${body === 'Mars' ? ' on Mars' : ''}.`;
    const prevScroll = resultOpen ? scroll.scrollTop : 0;
    result.innerHTML = `
      <button type="button" class="text-btn sm-back" id="sm-back">← Back to the best matches</button>
      <div class="eyebrow">Step 3 · How well does this place match?</div>
      <h2 id="sm-result-title" tabindex="-1">${flag(c.iso)} ${esc(place)}</h2>
      <div class="sm-pair">
        <div class="sm-end"><span class="eyebrow">Earth location</span><b>${esc(place)}</b><span class="note">${analog ? `${esc(country)} · ` : ''}${fmtLatLon(clat, clon)}</span></div>
        <div class="sm-vs" aria-hidden="true">vs</div>
        <div class="sm-end"><span class="eyebrow">Compared with</span><b>${esc(tp.name)}</b><span class="note">${esc(body)}</span></div>
      </div>
      <div class="sm-score">
        <div class="sm-big" aria-label="Similarity ${(s * 100).toFixed(1)} out of 100">${(s * 100).toFixed(1)}<span>/100</span></div>
        <div><span class="sm-chip tone-${m.tone}">${esc(m.label)}</span><p>${rankLine}</p></div>
      </div>
      <p class="note">100 would be a perfect twin. No place on Earth gets there, because Earth does not have Moon or Mars conditions. What matters is how close it gets compared with everywhere else.</p>
      ${analog ? `<div class="sm-known"><b>Known test site: ${esc(analog.name)}.</b> ${esc(analog.note)}</div>` : ''}
      <h3>Why it could be an analog</h3>
      <p>${esc(explain({ place, targetName: tp.name, body, score: s * 100, pctl, cmp, filtered }))}</p>
      <div class="sm-cols">
        <div><h3>Closest matches</h3><ul class="sm-points good">${cmp.matches.length ? cmp.matches.map(pointHTML).join('') : '<li class="note">No single measurement is a close match.</li>'}</ul></div>
        <div><h3>Biggest differences</h3><ul class="sm-points bad">${cmp.differences.length ? cmp.differences.map(pointHTML).join('') : '<li class="note">No large differences.</li>'}</ul></div>
      </div>
      <h3>Compare the measurements</h3>
      <p class="note">Low and high are compared with all land on Earth. The most important measurements come first.</p>
      <div class="sm-rows">${key.map(rowHTML).join('')}</div>
      ${rest.length ? `<details class="sm-more"><summary>Show all ${cmp.rows.length} measurements</summary><div class="sm-rows">${rest.map(rowHTML).join('')}</div></details>` : ''}
      <details class="sm-more" id="sm-land"><summary>Compare the landscapes (photos)</summary><div id="sm-planet"></div></details>
      <div class="sm-actions">
        <button type="button" class="btn" id="sm-details">See the full technical details</button>
        <button type="button" class="text-btn" id="sm-copy">Copy link</button>
      </div>`;
    const land = $<HTMLDetailsElement>('#sm-land', result);
    const fill = () => {
      const box = $('#sm-planet', result);
      if (!land.open || box.dataset.done === '1') return;
      box.dataset.done = '1';
      box.innerHTML = planetPanel(t, clat, clon);
      watchPlanetTiles(box);
    };
    land.addEventListener('toggle', fill);
    $('#sm-back', result).onclick = () => host.closeCell();
    $('#sm-details', result).onclick = () => host.switchToNormal();
    $('#sm-copy', result).onclick = () => app.copyLink({ lat: clat, lon: clon });
    const wasOpen = resultOpen;
    resultOpen = true;
    pick.hidden = true;
    result.hidden = false;
    scroll.scrollTop = prevScroll;
    if (!wasOpen) $('#sm-result-title', result).focus({ preventScroll: true });
  }

  function hideResult() {
    if (!resultOpen) return;
    resultOpen = false;
    result.hidden = true;
    pick.hidden = false;
    scroll.scrollTop = 0;
  }

  /** Space the map should leave around the panel so the chosen place is not hidden behind it. */
  function padding() {
    const g = 12;
    const top = $('#topbar').offsetHeight + g * 2;
    if (window.innerWidth <= 900) return { top, bottom: panel.offsetHeight + g * 2, left: g, right: g };
    return { top, bottom: g, left: panel.offsetWidth + g * 2, right: g };
  }

  return { onTarget, onScored, showResult, hideResult, padding, sites: () => lastSites };
}
export type SimpleUI = ReturnType<typeof createSimple>;
