// "How it works" on the About page: the five-step method as a timeline, followed by a worked example that
// takes one real land cell through the same steps, using the grid already loaded in the browser.
import type { App } from '../main';
import type { CellInfo, FeatureMeta, Target } from '../types';
import { GROUP_COLORS, esc, fmtValue } from '../format';
import { contributions, valueFromQ, valueFromZ, zThresholdFromValue } from '../scoring';

const GROUPS = ['Terrain', 'Climate', 'Surface', 'Remoteness'] as const;

/** Small Earth-CDF chart for one feature: real value on x, Earth percentile on y. */
function cdfSketch(f: FeatureMeta): string {
  const W = 220;
  const H = 120;
  const L = 30;
  const B = 22;
  const bp = f.breakpoints;
  const lo = bp[0];
  // Cut the long tail at the 99th percentile so the curve stays readable.
  const hi = bp[99];
  const x = (v: number) => L + ((Math.min(v, hi) - lo) / (hi - lo || 1)) * (W - L - 6);
  const y = (z: number) => 6 + (1 - z) * (H - B - 6);
  const pts = bp.slice(0, 100).map((v, i) => `${x(v).toFixed(1)},${y(i / 100).toFixed(1)}`).join(' ');
  const zMark = 0.9;
  const vMark = valueFromZ(bp, zMark);
  return `<svg class="hiw-cdf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Earth percentile curve for ${esc(f.name)}">
    <line x1="${L}" y1="${y(0)}" x2="${W - 6}" y2="${y(0)}" class="ax"/><line x1="${L}" y1="${y(0)}" x2="${L}" y2="${y(1)}" class="ax"/>
    <text x="${L - 4}" y="${y(1) + 3}" text-anchor="end">100</text><text x="${L - 4}" y="${y(0) + 3}" text-anchor="end">0</text>
    <polyline points="${pts}" class="curve"/>
    <line x1="${x(vMark)}" y1="${y(0)}" x2="${x(vMark)}" y2="${y(zMark)}" class="guide"/>
    <line x1="${L}" y1="${y(zMark)}" x2="${x(vMark)}" y2="${y(zMark)}" class="guide"/>
    <circle cx="${x(vMark)}" cy="${y(zMark)}" r="3.5" class="pt"/>
    <text x="${L - 4}" y="${y(zMark) + 3}" text-anchor="end" class="hl">90</text>
    <text x="${x(vMark)}" y="${H - 6}" text-anchor="middle" class="hl">${esc(fmtValue(vMark, f))}</text>
  </svg>`;
}

export function howItWorksHTML(app: App): string {
  const { meta } = app.ds;
  const t = app.target();
  const counts = GROUPS.map((g) => `<span class="hiw-chip" style="--g:${GROUP_COLORS[g]}">${g} ×${meta.features.filter((f) => f.ui_group === g).length}</span>`).join('');
  const slope = meta.features.find((f) => f.id === 'slope_mean') ?? meta.features[0];
  const beyond = meta.features.filter((f) => t.raw[f.id]?.beyond_earth);
  const beyondText = beyond.length
    ? `For <b>${esc(t.name)}</b>, ${beyond.length} of ${meta.n_features} values are beyond anything on Earth (${beyond.map((f) => esc(f.name.toLowerCase())).join(', ')}), so each is set to Earth's extreme.`
    : `For <b>${esc(t.name)}</b>, every value falls inside Earth's range, so nothing needs clamping.`;
  const ms = app.lastResult?.timings.score;
  const timing = ms != null ? `On this device the last re-score took <b>${Math.round(ms)} ms</b>.` : 'It takes a few hundred milliseconds.';
  const nCells = meta.n_cells.toLocaleString('en-US');

  return `
      <h2 id="how">How it works</h2>
      <p>Five steps take raw satellite and climate data to a ranked map. Steps 1–3 run once, offline, in a Python pipeline. Steps 4–5 run in your browser
      every time you change a control. Below the steps, a worked example puts one real place through all of them, using the data loaded on this page.</p>

      <ol class="hiw-flow">
        <li class="hiw-phase">Offline · Python pipeline</li>
        <li class="hiw-step">
          <span class="hiw-n">1</span>
          <div class="hiw-body">
            <h3>Describe Earth</h3>
            <p>The pipeline splits Earth's land into <b>${nCells} cells</b> of 0.1° (about 11 km) and gives each one ${meta.n_features} numbers from open data.
            Terrain comes from ~1 km elevation pixels (mean and 90th-percentile slope, roughness, local relief). Climate covers temperature, day–night range,
            coldest month, precipitation, humidity and sunlight. Surface covers vegetation, soil carbon, sand, basaltic rock and permanent ice.
            Remoteness covers night lights and dust.</p>
            <div class="hiw-chips">${counts}</div>
          </div>
        </li>
        <li class="hiw-step">
          <span class="hiw-n">2</span>
          <div class="hiw-body hiw-split">
            <div>
              <h3>Put every feature on one scale</h3>
              <p>Millimetres of rain and degrees of slope can't be compared directly. So each value becomes its <b>Earth percentile</b>: the share of
              Earth's land with a lower value. A slope at the 90th percentile is steeper than 90% of all land. The app keeps the 101 breakpoints of each
              curve, so it can turn any percentile back into real units.</p>
            </div>
            <figure class="hiw-fig">${cdfSketch(slope)}<figcaption>Earth's curve for ${esc(slope.name.toLowerCase())}: the 90th percentile is ${esc(fmtValue(valueFromZ(slope.breakpoints, 0.9), slope))}.</figcaption></figure>
          </div>
        </li>
        <li class="hiw-step">
          <span class="hiw-n">3</span>
          <div class="hiw-body">
            <h3>Describe the target the same way</h3>
            <p>Each Moon or Mars site gets the same ${meta.n_features} values, taken from published mission science (LOLA, Diviner, MOLA, REMS/MEDA,
            CRISM and others). Many are more extreme than anywhere on Earth: colder, drier, airless, with no plants. We <b>clamp those values to Earth's
            own range</b> before converting them to percentiles, so the question becomes <i>how close can Earth get?</i></p>
            <p class="hiw-aside">${beyondText}</p>
          </div>
        </li>
        <li class="hiw-phase">Live · in your browser</li>
        <li class="hiw-step">
          <span class="hiw-n">4</span>
          <div class="hiw-body">
            <h3>Score every cell, live</h3>
            <p>A Web Worker measures how far each cell is from the target in percentile space: the gap on each feature, squared, multiplied by
            that feature's weight, then added up. A score of 1 is a perfect match. Hard filters set a cell's score to 0. All ${nCells} cells are
            re-scored whenever you move a slider. ${timing} Neighbouring high-scoring cells are then merged into candidate sites.</p>
          </div>
        </li>
        <li class="hiw-step">
          <span class="hiw-n">5</span>
          <div class="hiw-body">
            <h3>Explain and zoom in</h3>
            <p>Each site lists the features that match the target and the ones that don't. A drill-down then fetches 30 m elevation tiles and compares
            the site's slope distribution with the target's, at a scale the 11 km grid can't show.</p>
          </div>
        </li>
      </ol>

      <section class="hiw-demo" id="hiw-demo" aria-labelledby="hiw-demo-title">
        <div class="hiw-demo-head">
          <div>
            <div class="eyebrow">Worked example · live data</div>
            <h3 id="hiw-demo-title">One place, scored against ${esc(t.name)}</h3>
          </div>
          <div class="hiw-pick">
            <label for="hiw-place" class="note">Place</label>
            <select id="hiw-place"></select>
            <button class="text-btn" id="hiw-random" type="button">Random place</button>
          </div>
        </div>
        <div id="hiw-out" class="hiw-out" aria-live="polite"><p class="note">Loading…</p></div>
      </section>`;
}

interface Place {
  key: string;
  label: string;
  group: string;
  lat: number;
  lon: number;
}

function placesFor(app: App, t: Target): Place[] {
  const out: Place[] = [];
  for (const id of t.validation) {
    const a = app.ds.analogs.find((x) => x.id === id);
    if (a) out.push({ key: `a:${a.id}`, label: `${a.name}, ${a.country}`, group: 'Known analogs for this target', lat: a.lat, lon: a.lon });
  }
  const top = app.lastResult?.sites[0];
  if (top) {
    const c = app.countryName(top.country);
    out.push({ key: 'top', label: `#1 candidate on the map${c.name ? `, ${c.name}` : ''}`, group: 'From the map', lat: top.lat, lon: top.lon });
  }
  return out;
}

function renderExample(app: App, t: Target, place: Place, info: CellInfo): string {
  const { meta } = app.ds;
  const weights = app.state.weights;
  const contrib = contributions(info.q, t.vector, weights);
  const total = contrib.reduce((a, b) => a + b, 0);
  const score = 1 - Math.sqrt(total);
  const maxC = Math.max(...contrib, 1e-9);
  const wsum = weights.reduce((a, w) => a + Math.max(0, w), 0);

  const rowsByGroup = GROUPS.map((g) => {
    const rows = meta.features
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.ui_group === g)
      .map(({ f, i }) => {
        const z = info.q[i] / 255;
        const tz = t.vector[i];
        const raw = t.raw[f.id];
        const w = Math.max(0, weights[i]);
        const off = w === 0;
        const share = total > 0 ? contrib[i] / total : 0;
        const tRaw = raw?.value != null ? fmtValue(raw.value, f) : fmtValue(valueFromZ(f.breakpoints, tz), f);
        const lo = Math.min(z, tz) * 100;
        const hi = Math.max(z, tz) * 100;
        return `<div class="hiw-row${off ? ' off' : ''}" style="--g:${GROUP_COLORS[g]}">
          <div class="hiw-name">${esc(f.name)}${f.synthetic ? ' <span class="badge synth">placeholder</span>' : ''}</div>
          <div class="hiw-vals mono"><span>${esc(fmtValue(valueFromQ(f.breakpoints, info.q[i]), f))}</span><span class="vs">target ${esc(tRaw)}${raw?.beyond_earth ? ' <span class="beyond" title="Beyond Earth\'s range, clamped to Earth\'s extreme">▲</span>' : ''}</span></div>
          <div class="hiw-track" role="img" aria-label="This place at percentile ${(z * 100).toFixed(0)}, target at ${(tz * 100).toFixed(0)}">
            <i class="gap" style="left:${lo.toFixed(1)}%;width:${(hi - lo).toFixed(1)}%"></i>
            <i class="tgt${raw?.beyond_earth ? ' clamped' : ''}" style="left:${(tz * 100).toFixed(1)}%"></i>
            <i class="me" style="left:${(z * 100).toFixed(1)}%"></i>
          </div>
          <div class="hiw-c">${off ? '<span class="note">weight 0</span>' : `<i style="width:${((contrib[i] / maxC) * 100).toFixed(1)}%"></i><em>${(share * 100).toFixed(share >= 0.095 ? 0 : 1)}%</em>`}</div>
        </div>`;
      })
      .join('');
    return `<div class="hiw-group" style="--g:${GROUP_COLORS[g]}">${g}</div>${rows}`;
  }).join('');

  // Hard filters the user has switched on that exclude this cell.
  const blocked = app.state.filters
    .filter((fl) => fl.on)
    .filter((fl) => {
      const i = meta.features.findIndex((f) => f.id === fl.id);
      return i >= 0 && info.q[i] / 255 > zThresholdFromValue(meta.features[i].breakpoints, fl.tau);
    })
    .map((fl) => esc(fl.label));
  const pctile = app.percentileOf(score);
  const regionNote = app.state.region !== 'world' || app.state.alpha > 0 ? ' on the current map' : '';
  const rank = Number.isFinite(pctile)
    ? pctile >= 0.5
      ? `That beats <b>${(pctile * 100).toFixed(pctile > 0.99 ? 1 : 0)}%</b> of land cells${regionNote}.`
      : `That is below the median land cell${regionNote}.`
    : '';
  const top3 = contrib
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 3)
    .filter((x) => x.c > 0)
    .map((x) => esc(meta.features[x.i].name.toLowerCase()));
  const weightNote = weights.every((w, i) => w === t.weights[i]) ? 'default weights for this target' : 'your current slider weights';

  return `
    <div class="hiw-key note">
      <span><i class="k-me"></i>this place</span><span><i class="k-tgt"></i>target</span><span><i class="k-gap"></i>gap</span>
      <span><span class="beyond">▲</span> target beyond Earth's range, clamped</span>
    </div>
    <div class="hiw-table">
      <div class="hiw-row hiw-th note"><div>Feature</div><div>Real value <span class="step">step 1</span></div><div>Earth percentile, 0–100 <span class="step">steps 2–3</span></div><div>Share of the gap <span class="step">step 4</span></div></div>
      ${rowsByGroup}
    </div>
    <div class="hiw-result">
      <div class="hiw-eq mono">
        <span>weighted gap² = ${total.toFixed(4)}</span>
        <span>S = 1 − √${total.toFixed(4)} = <b>${score.toFixed(3)}</b></span>
      </div>
      <p>${esc(place.label)} scores <b>${score.toFixed(2)}</b> against ${esc(t.name)} with ${weightNote}. ${rank}
      ${top3.length ? `Most of the remaining gap comes from ${top3.join(', ')}.` : ''}
      ${blocked.length ? `<br><span class="beyond">A hard filter you have switched on (${blocked.join(', ')}) excludes this cell, so the map shows it as 0.</span>` : ''}
      ${wsum <= 0 ? '<br><span class="beyond">All weights are 0, so every cell scores 1.</span>' : ''}</p>
      <button class="text-btn" id="hiw-show" type="button">Show this place on the map</button>
    </div>`;
}

export function mountHowItWorks(app: App, onShow: (lat: number, lon: number) => void) {
  const t = app.target();
  const sel = document.getElementById('hiw-place') as HTMLSelectElement | null;
  const out = document.getElementById('hiw-out');
  const rnd = document.getElementById('hiw-random');
  if (!sel || !out || !rnd) return;
  const places = placesFor(app, t);
  const groups = [...new Set(places.map((p) => p.group))];
  sel.innerHTML = groups
    .map((g) => `<optgroup label="${esc(g)}">${places.filter((p) => p.group === g).map((p) => `<option value="${p.key}">${esc(p.label)}</option>`).join('')}</optgroup>`)
    .join('');
  let seq = 0;

  const show = async (place: Place) => {
    const my = ++seq;
    out.classList.add('busy');
    const info = await app.requestCell(place.lat, place.lon);
    if (my !== seq) return;
    out.classList.remove('busy');
    if (!info) {
      out.innerHTML = `<p class="note">${esc(place.label)} falls outside the land grid (ocean or ice shelf), so it has no score.</p>`;
      return;
    }
    out.innerHTML = renderExample(app, t, place, info);
    document.getElementById('hiw-show')!.onclick = () => onShow(place.lat, place.lon);
  };

  sel.onchange = () => {
    const p = places.find((x) => x.key === sel.value);
    if (p) void show(p);
  };
  rnd.onclick = async () => {
    // Rejection-sample a land cell, weighting by area (uniform on the sphere).
    for (let k = 0; k < 60; k++) {
      const lat = (Math.asin(2 * Math.random() - 1) * 180) / Math.PI;
      const lon = Math.random() * 360 - 180;
      const info = await app.requestCell(lat, lon);
      if (!info) continue;
      const c = app.countryName(info.country);
      const ns = lat >= 0 ? 'N' : 'S';
      const ew = lon >= 0 ? 'E' : 'W';
      const label = `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}${c.name ? `, ${c.name}` : ''}`;
      let opt = sel.querySelector<HTMLOptionElement>('option[value="rand"]');
      if (!opt) {
        opt = document.createElement('option');
        opt.value = 'rand';
        sel.append(opt);
      }
      opt.textContent = `${label} (random)`;
      sel.value = 'rand';
      const p = { key: 'rand', label, group: 'Random', lat, lon };
      const at = places.findIndex((x) => x.key === 'rand');
      if (at >= 0) places[at] = p;
      else places.push(p);
      void show(p);
      return;
    }
  };
  if (places.length) void show(places[0]);
  else rnd.click();
}
