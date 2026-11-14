// "How it works": one long page of numbered steps with a step rail. It follows one real square of land from
// raw measurements to its final score, then shows how far to trust that score. Every number comes from the
// data loaded in the browser (grid, targets, validation, last scoring run).
import type { App } from '../main';
import type { CellInfo, FeatureMeta, Target } from '../types';
import { GROUP_COLORS, esc, fmtValue } from '../format';
import { contributions, valueFromQ, zThresholdFromValue } from '../scoring';

const GROUPS = ['Terrain', 'Climate', 'Surface', 'Remoteness'] as const;
type Group = (typeof GROUPS)[number];

/** Plain-language names. The technical name stays in a tooltip. */
const PLAIN: Record<string, string> = {
  elevation: 'Height', slope_mean: 'Average steepness', slope_p90: 'Steepest slopes', tri: 'Roughness', relief: 'Local height range',
  temp_mean: 'Average temperature', temp_range: 'Day–night swing', temp_min: 'Coldest month', precip: 'Rain and snow', humidity: 'Air humidity',
  solar: 'Sunlight', ndvi: 'Plant cover', soc: 'Soil carbon', sand: 'Sandiness', basalt: 'Volcanic rock', ice: 'Permanent ice',
  lights: 'Night lights', aod: 'Dust and haze',
};
const CHIPS = ['temp_mean', 'precip', 'ndvi', 'slope_mean', 'elevation', 'lights'];

const STEPS = [
  'One square of land',
  'Measure it 18 ways',
  'Rank it against Earth',
  'Describe the target',
  'Measure the gaps',
  'Weigh and add up',
  'Score every square',
  'How sure is it?',
  'What would improve it',
];

const RAD = Math.PI / 180;
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const plain = (f: FeatureMeta) => PLAIN[f.id] ?? f.name;
const p0 = (z: number) => Math.round(z * 100);

interface Place {
  key: string;
  label: string;
  group: string;
  lat: number;
  lon: number;
}

interface St {
  app: App;
  t: Target;
  places: Place[];
  place: Place | null;
  info: CellInfo | null;
  feat: number;
  mult: Record<Group, number>;
  shownScore: number;
}

// ------------------------------------------------------------------ markup

export function railHTML(): string {
  const items = STEPS.map((s, i) => `<li><button type="button" data-step="${i + 1}"><span class="n">${i + 1}</span><span class="t">${esc(s)}</span></button></li>`).join('');
  return `<nav class="hiw-rail" aria-label="How it works: steps">
    <button class="btn hiw-back" id="about-close" type="button">← Back to map</button>
    <div class="hiw-now" aria-live="polite"><span class="eyebrow">How it works</span><span id="hiw-now-t">Step 1 of ${STEPS.length}</span></div>
    <ol class="hiw-steps">${items}</ol>
    <div class="hiw-follow note">Following: <b id="hiw-follow-name">…</b></div>
    <div class="hiw-toggles">
      <button type="button" class="hiw-tog" id="hiw-maths" aria-pressed="false"><i aria-hidden="true"></i>Show the maths</button>
      <button type="button" class="hiw-tog" id="hiw-theme" aria-label="Colour theme: auto">◐ <span>Auto</span></button>
    </div>
    <button type="button" class="text-btn hiw-ref" data-jump="about-ref">Data, references and credits</button>
  </nav>`;
}

function step(n: number, title: string, body: string, controls: string, maths: string): string {
  return `<section class="hiw-step" id="hiw-s${n}" data-n="${n}" aria-labelledby="hiw-s${n}-h">
    <div class="hiw-k">Step ${n} of ${STEPS.length}</div>
    <h2 id="hiw-s${n}-h" tabindex="-1">${title}</h2>
    <div class="hiw-text">${body}</div>
    ${controls ? `<div class="hiw-ctl">${controls}</div>` : ''}
    <figure class="hiw-g" id="hiw-g${n}"></figure>
    ${maths ? `<div class="hiw-maths mono" id="hiw-m${n}">${maths}</div>` : ''}
  </section>`;
}

export function stepsHTML(app: App): string {
  const { meta } = app.ds;
  const t = app.target();
  const n = meta.n_cells.toLocaleString('en-US');
  const chips = (id: string) =>
    `<div class="hiw-chips" role="group" aria-label="Measurement to show" data-chips="${id}">${CHIPS.map((c) => {
      const f = meta.features.find((x) => x.id === c);
      return f ? `<button type="button" class="hiw-chip" data-feat="${c}" aria-pressed="false" style="--g:${GROUP_COLORS[f.ui_group]}">${esc(plain(f))}</button>` : '';
    }).join('')}</div>`;
  const sliders = GROUPS.map(
    (g) => `<label class="hiw-sl" style="--g:${GROUP_COLORS[g]}"><span>${g}</span>
      <input type="range" min="0" max="3" step="0.25" value="1" data-group="${g}" aria-label="${g} weight multiplier"><output data-out="${g}">×1</output></label>`,
  ).join('');

  return [
    step(1, 'Start with one square of land',
      `<p>We cut all of Earth's land into <b>${n}</b> squares, each about 11 km across: roughly the size of a small town. To see how the method works, we follow just one of them.</p>`,
      `<label for="hiw-place" class="note">Square to follow</label><select id="hiw-place"></select><button class="text-btn" id="hiw-random" type="button">Pick a random square</button>`,
      ''),
    step(2, 'Measure it 18 ways',
      `<p>Satellites and weather records give every square ${meta.n_features} <dfn>measurements</dfn>: how high, steep and rough it is, how hot, cold, wet and sunny, how green, what the ground is made of, and how dark its night sky is.</p>`,
      '', ''),
    step(3, 'Rank it against the rest of Earth',
      `<p>Degrees and millimetres can't be compared directly. So for each measurement we line up every square on Earth from lowest to highest and see where ours falls. That position is its <dfn>Earth percentile</dfn>: 90 means higher than 90% of Earth's land.</p>`,
      chips('s3'),
      `Earth percentile z = (land squares with a lower value) ÷ (all ${n} land squares).<br>Each curve is stored as 101 breakpoints, so any percentile converts back to real units.`),
    step(4, `Describe ${esc(t.body === 'Moon' ? 'the Moon site' : 'the Mars site')} the same way`,
      `<p>The <dfn>target</dfn> is the place we want Earth to imitate: <b>${esc(t.name)}</b>. Its values come from published mission science. Where a value lies beyond anything on Earth, we <dfn>clamp</dfn> it: set it to Earth's most extreme value. The question becomes <i>how close can Earth get?</i></p>`,
      chips('s4'),
      'Target percentile t = Earth percentile of min(max(target value, Earth minimum), Earth maximum).'),
    step(5, 'Measure the gap on each one',
      `<p>For each measurement, the <dfn>gap</dfn> is how far our square sits from the target, in percentile points. 0 is a perfect match. 100 means opposite ends of Earth.</p>`,
      '', 'gap = z − t, for each of the 18 measurements.'),
    step(6, 'Weigh what matters, then add it all up',
      `<p>Some measurements matter more for this target, so each has a <dfn>weight</dfn>. Big gaps count extra. Adding the weighted gaps gives one <dfn>analog score</dfn> from 0 to 100, where 100 would be a perfect twin of the target. <b>Try it:</b> change how much each kind of measurement counts.</p>`,
      `<div class="hiw-sliders">${sliders}</div><button type="button" class="text-btn" id="hiw-reset">Reset</button><span class="note">This only changes the example. The map has its own sliders.</span>`,
      '<span id="hiw-m6-eq"></span>'),
    step(7, 'Do the same for every square on Earth',
      `<p>Your browser repeats that sum for all ${n} squares each time you move a slider on the map. Lining up all the scores shows how unusual our square is.</p>`,
      '',
      `Optional extras on the map: a hard filter sets a square's score to 0. Novelty N = min(distance to nearest known analog ÷ ${meta.novelty_saturation_km} km, 1), blended as (1 − α)·S + α·N.`),
    step(8, 'How sure can we be?',
      `<p>The real test uses past results. <dfn>Known analogs</dfn> are places already used to train astronauts or test rovers for each target. If the method works, they should rank near the top. Each dot is one of them, placed at its Earth percentile.</p>`,
      '', '<span id="hiw-m8"></span>'),
    step(9, 'What would make it better',
      `<p>Averaged over this target's known analogs, these measurements cause most of the remaining gap. That points to what to fix first.</p>`,
      '', ''),
  ].join('');
}

// ------------------------------------------------------------------ graphics

function merc(lat: number, lon: number, z: number) {
  const n = 256 * 2 ** z;
  const s = Math.min(0.9999, Math.max(-0.9999, Math.sin(lat * RAD)));
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

function g1(s: St): string {
  const { meta } = s.app.ds;
  const info = s.info!;
  const res = meta.grid.res;
  const r = Math.floor(info.cell / meta.grid.n_lon);
  const c = info.cell - r * meta.grid.n_lon;
  const latT = 90 - r * res;
  const latB = latT - res;
  const lonL = -180 + c * res;
  const lonR = lonL + res;
  const latC = latT - res / 2;
  const lonC = lonL + res / 2;
  const BOX = 280;
  let z = 3;
  for (let k = 3; k <= 13; k++) {
    z = k;
    if (merc(latB, lonC, k).y - merc(latT, lonC, k).y >= BOX / 3.2) break;
  }
  const ctr = merc(latC, lonC, z);
  const x0 = ctr.x - BOX / 2;
  const y0 = ctr.y - BOX / 2;
  const N = 2 ** z;
  const imgs: string[] = [];
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + BOX) / 256); ty++) {
    if (ty < 0 || ty >= N) continue;
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + BOX) / 256); tx++) {
      const wx = ((tx % N) + N) % N;
      imgs.push(`<img alt="" decoding="async" src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${wx}" style="left:${(tx * 256 - x0).toFixed(1)}px;top:${(ty * 256 - y0).toFixed(1)}px">`);
    }
  }
  const tl = merc(latT, lonL, z);
  const br = merc(latB, lonR, z);
  const rx = tl.x - x0;
  const ry = tl.y - y0;
  const rw = br.x - tl.x;
  const rh = br.y - tl.y;
  const per = 2 * (rw + rh);
  const ew = 111.32 * res * Math.cos(latC * RAD);
  const ns = 110.57 * res;
  const ctry = s.app.countryName(info.country);
  const ns_ = latC >= 0 ? 'N' : 'S';
  const ew_ = lonC >= 0 ? 'E' : 'W';
  return `<div class="hiw-sat" role="img" aria-label="Satellite image around ${esc(s.place!.label)}, with the square outlined">
      <span class="sat-off">Satellite imagery unavailable</span>${imgs.join('')}
      <svg viewBox="0 0 ${BOX} ${BOX}" aria-hidden="true"><rect class="draw" x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" style="--len:${per.toFixed(0)}"/></svg>
    </div>
    <figcaption><b>${esc(s.place!.label)}</b>
      <span>${Math.abs(latC).toFixed(2)}°${ns_} ${Math.abs(lonC).toFixed(2)}°${ew_}${ctry.name ? ` · ${esc(ctry.name)}` : ''} · this square is ${ns.toFixed(0)} km × ${ew.toFixed(0)} km${ew < 7 ? ' (squares get narrower towards the poles)' : ''}</span>
      <span>1 of <b data-count="${s.app.ds.meta.n_cells}" data-dec="0">0</b> land squares. Imagery: Esri World Imagery.</span>
      <button class="text-btn" id="hiw-show" type="button">Show this square on the map</button></figcaption>`;
}

function g2(s: St): string {
  const { meta } = s.app.ds;
  const info = s.info!;
  return GROUPS.map((g) => {
    const tiles = meta.features
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.ui_group === g)
      .map(({ f, i }, k) => {
        const v = valueFromQ(f.breakpoints, info.q[i]);
        return `<div class="hiw-tile pop" style="--d:${(k * 0.06).toFixed(2)}s" title="${esc(f.name)}"><span>${esc(plain(f))}</span><b data-val="${v}" data-fi="${i}">${esc(fmtValue(v, f))}</b></div>`;
      })
      .join('');
    return `<div class="hiw-tgroup" style="--g:${GROUP_COLORS[g]}"><div class="hiw-gl">${g}</div><div class="hiw-tiles">${tiles}</div></div>`;
  }).join('');
}

function g3(s: St): string {
  const f = s.app.ds.meta.features[s.feat];
  const bp = f.breakpoints;
  const z = s.info!.q[s.feat] / 255;
  const lo = bp[1];
  const hi = bp[99];
  const bars = Array.from({ length: 100 }, (_, k) => {
    const v = bp[k + 1];
    const h = 6 + (Math.min(Math.max((v - lo) / (hi - lo || 1), 0), 1)) * 94;
    return `<i class="vgrow${k < p0(z) ? ' on' : ''}" style="height:${h.toFixed(1)}%;--d:${(k * 0.006).toFixed(3)}s"></i>`;
  }).join('');
  const v = valueFromQ(bp, s.info!.q[s.feat]);
  return `<div class="hiw-cdf" role="img" aria-label="${esc(plain(f))}: this square is at Earth percentile ${p0(z)}">
      <div class="bars">${bars}<span class="mk slide" style="--x:${(z * 100).toFixed(1)}%"></span></div>
      <div class="ax"><span>lowest on Earth<br><b>${esc(fmtValue(bp[0], f))}</b></span><span>middle<br><b>${esc(fmtValue(bp[50], f))}</b></span><span>highest<br><b>${esc(fmtValue(bp[100], f))}</b></span></div>
    </div>
    <figcaption>Each bar is 1% of Earth's land, sorted by ${esc(plain(f).toLowerCase())}. Our square: <b>${esc(fmtValue(v, f))}</b>, Earth percentile <b class="big" data-count="${p0(z)}" data-dec="0">0</b>. It is higher than ${p0(z)}% of Earth's land.</figcaption>`;
}

function g4(s: St): string {
  const { meta } = s.app.ds;
  const f = meta.features[s.feat];
  const raw = s.t.raw[f.id];
  const z = s.info!.q[s.feat] / 255;
  const tz = s.t.vector[s.feat];
  const beyond = !!raw?.beyond_earth;
  const tVal = raw?.value != null ? fmtValue(raw.value, f) : '–';
  const side = tz < 0.5 ? 'left' : 'right';
  const clamped = meta.features.filter((x) => s.t.raw[x.id]?.beyond_earth).map((x) => esc(plain(x).toLowerCase()));
  return `<div class="hiw-clamp ${side}" role="img" aria-label="${esc(plain(f))}: target at percentile ${p0(tz)}${beyond ? ', clamped from beyond Earth' : ''}; this square at ${p0(z)}">
      <div class="track">
        ${beyond ? `<span class="ghost" style="--x:${side === 'left' ? -9 : 109}%">${esc(tVal)}</span>` : ''}
        <span class="tgt${beyond ? ' snap' : ' slide'}" style="--x:${(tz * 100).toFixed(1)}%"><em>target${beyond ? ' (clamped)' : ''}</em></span>
        <span class="me slide" style="--x:${(z * 100).toFixed(1)}%"><em>our square</em></span>
      </div>
      <div class="ax"><span>0</span><span>Earth percentile</span><span>100</span></div>
    </div>
    <figcaption>${esc(s.t.name)}, ${esc(plain(f).toLowerCase())}: <b>${esc(tVal)}</b>${beyond ? `, beyond anything on Earth, so it is clamped to Earth's ${side === 'left' ? 'lowest' : 'highest'} value` : ` = Earth percentile ${p0(tz)}`}.
    ${clamped.length ? `For this target, <b>${clamped.length} of ${meta.n_features}</b> values are clamped: ${clamped.join(', ')}.` : 'None of this target’s values needed clamping.'}</figcaption>`;
}

function g5(s: St): string {
  const { meta } = s.app.ds;
  const info = s.info!;
  const rows = GROUPS.map((g) =>
    meta.features
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.ui_group === g)
      .map(({ f, i }, k) => {
        const z = info.q[i] / 255;
        const tz = s.t.vector[i];
        const lo = Math.min(z, tz) * 100;
        const w = Math.abs(z - tz) * 100;
        return `<div class="hiw-gap" style="--g:${GROUP_COLORS[g]}" title="${esc(f.name)}">
          <span class="nm">${esc(plain(f))}</span>
          <span class="tr"><i class="bar grow" style="left:${lo.toFixed(1)}%;width:${w.toFixed(1)}%;--d:${(k * 0.05).toFixed(2)}s;transform-origin:${z < tz ? 'left' : 'right'}"></i><i class="t" style="left:${(tz * 100).toFixed(1)}%"></i><i class="m" style="left:${(z * 100).toFixed(1)}%"></i></span>
          <b class="mono">${Math.round(w)}</b>
        </div>`;
      })
      .join(''),
  ).join('');
  return `<div class="hiw-key note"><span><i class="k-me"></i>our square</span><span><i class="k-t"></i>target</span><span><i class="k-gap"></i>gap (percentile points)</span></div>
    <div class="hiw-gaps">${rows}</div>`;
}

function effWeights(s: St): number[] {
  const { meta } = s.app.ds;
  return s.app.state.weights.map((w, i) => w * s.mult[meta.features[i].ui_group as Group]);
}

function g6(): string {
  return `<div class="hiw-score">
      <div class="num"><b id="hiw-score-n">0</b><span>analog score<br>out of 100</span></div>
      <div class="split">
        <div class="note">Where the remaining gap comes from</div>
        <div class="stack" id="hiw-stack">${GROUPS.map((g) => `<i data-g="${g}" style="background:${GROUP_COLORS[g]}"></i>`).join('')}</div>
        <div class="stack-key note">${GROUPS.map((g) => `<span><i style="background:${GROUP_COLORS[g]}"></i>${g} <b data-share="${g}">0%</b></span>`).join('')}</div>
        <p class="note" id="hiw-top3"></p>
      </div>
    </div>`;
}

function update6(s: St, animate: boolean) {
  const { meta } = s.app.ds;
  const w = effWeights(s);
  const c = contributions(s.info!.q, s.t.vector, w);
  const total = c.reduce((a, b) => a + b, 0);
  const score = (1 - Math.sqrt(total)) * 100;
  const byG: Record<string, number> = {};
  for (const g of GROUPS) byG[g] = 0;
  c.forEach((v, i) => (byG[meta.features[i].ui_group] += v));
  for (const g of GROUPS) {
    const share = total > 0 ? byG[g] / total : 0;
    const seg = document.querySelector<HTMLElement>(`#hiw-stack i[data-g="${g}"]`);
    if (seg) seg.style.width = `${(share * 100).toFixed(1)}%`;
    const lab = document.querySelector(`[data-share="${g}"]`);
    if (lab) lab.textContent = `${Math.round(share * 100)}%`;
  }
  const top = c
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .filter((x) => x.v > 0)
    .map((x) => `<b>${esc(plain(meta.features[x.i]).toLowerCase())}</b>`);
  const top3 = document.getElementById('hiw-top3');
  if (top3) top3.innerHTML = top.length ? `Biggest misses: ${top.join(', ')}.` : '';
  const n = document.getElementById('hiw-score-n');
  if (n) tween(n, s.shownScore, score, (v) => v.toFixed(1), animate ? 500 : 0);
  s.shownScore = score;
  const wsum = w.reduce((a, b) => a + Math.max(0, b), 0);
  const eq = document.getElementById('hiw-m6-eq');
  if (eq) eq.textContent = `S = 1 − √( Σ w·gap² ÷ Σ w ) = 1 − √( ${total.toFixed(4)} ) = ${(score / 100).toFixed(3)}   (Σ w = ${wsum.toFixed(2)}; shown ×100)`;
  for (const g of GROUPS) {
    const o = document.querySelector(`[data-out="${g}"]`);
    if (o) o.textContent = `×${s.mult[g]}`;
  }
}

function baseScore(s: St): number {
  const c = contributions(s.info!.q, s.t.vector, s.app.state.weights);
  return 1 - Math.sqrt(c.reduce((a, b) => a + b, 0));
}

function g7(s: St): string {
  const lr = s.app.lastResult;
  if (!lr) return '<p class="note">The map has not finished scoring yet.</p>';
  const B = 60;
  const bins = new Array(B).fill(0);
  lr.hist.forEach((v, i) => (bins[Math.min(B - 1, Math.floor((i / lr.hist.length) * B))] += v));
  const max = Math.max(...bins, 1);
  const sc = baseScore(s);
  const pct = s.app.percentileOf(sc);
  const { meta } = s.app.ds;
  const blocked = s.app.state.filters.some((fl) => {
    if (!fl.on) return false;
    const i = meta.features.findIndex((f) => f.id === fl.id);
    return i >= 0 && s.info!.q[i] / 255 > zThresholdFromValue(meta.features[i].breakpoints, fl.tau);
  });
  const bars = bins.map((v, k) => `<i class="vgrow${(k + 0.5) / B <= sc ? ' on' : ''}" style="height:${Math.max(1.5, (v / max) * 100).toFixed(1)}%;--d:${(k * 0.01).toFixed(2)}s"></i>`).join('');
  const top = lr.sites[0];
  const topC = top ? s.app.countryName(top.country).name : '';
  const changed = GROUPS.some((g) => s.mult[g] !== 1);
  const scope = s.app.state.region !== 'world' || s.app.state.alpha > 0 ? ' on the current map view' : '';
  return `<div class="hiw-hist" role="img" aria-label="Distribution of analog scores across Earth's land; our square scores ${(sc * 100).toFixed(1)}">
      <div class="bars">${bars}<span class="mk slide" style="--x:${(sc * 100).toFixed(1)}%"><em>our square</em></span></div>
      <div class="ax"><span>0</span><span>analog score</span><span>100</span></div>
    </div>
    <figcaption>All ${meta.n_cells.toLocaleString('en-US')} squares, scored in <b>${Math.round(lr.timings.score)} ms</b> on this device.
    With the map's weights our square scores <b>${(sc * 100).toFixed(1)}</b>${!Number.isFinite(pct) ? '' : pct >= 0.99 ? `, which puts it in Earth's top <b>${Math.max(0.01, (1 - pct) * 100).toFixed(2)}%</b>${scope}` : `, higher than <b data-count="${(pct * 100).toFixed(0)}" data-dec="0">0</b>% of Earth's land${scope}`}.
    ${top ? `The top square right now is in ${esc(topC || 'the ocean margin')}, at ${(top.score * 100).toFixed(1)}.` : ''}
    ${changed ? ' (Step 6 changes are not used here.)' : ''}
    ${blocked ? ' <span class="beyond">A hard filter switched on in the map excludes this square, so the map shows it as 0.</span>' : ''}</figcaption>`;
}

function g8(s: St): string {
  const v = s.app.ds.validation;
  if (!v) return '<p class="note">No validation file in this build.</p>';
  const all = v.results.flatMap((r) => r.analogs.map((a) => a.percentile));
  const top10 = all.filter((p) => p >= 90).length;
  const below = all.filter((p) => p < 50).length;
  const rows = [...v.results]
    .sort((a, b) => (a.target === s.t.id ? -1 : b.target === s.t.id ? 1 : 0))
    .map((r, k) => {
      const dots = r.analogs
        .map((a, j) => `<i class="pop" style="left:${a.percentile.toFixed(1)}%;--d:${(k * 0.12 + j * 0.04).toFixed(2)}s" title="${esc(a.name)}: Earth percentile ${a.percentile.toFixed(0)}" tabindex="0" aria-label="${esc(a.name)}, percentile ${a.percentile.toFixed(0)}"></i>`)
        .join('');
      return `<div class="hiw-vrow${r.target === s.t.id ? ' cur' : ''}" id="val-${r.target}">
        <span class="nm">${esc(r.name.replace(/^(Moon|Mars) – /, '$1 · '))}</span>
        <span class="tr"><i class="half"></i>${dots}<b class="med" style="left:${r.median_analog_percentile.toFixed(1)}%" title="median"></b></span>
        <span class="mono md">p${r.median_analog_percentile.toFixed(0)}</span>
      </div>`;
    })
    .join('');
  const cur = v.results.find((r) => r.target === s.t.id);
  const m8 = document.getElementById('hiw-m8');
  if (m8) m8.innerHTML = v.results.map((r) => `${esc(r.name)}: AUC ${r.auc.toFixed(2)}`).join('<br>') + `<br>AUC = chance that a known analog outranks a random land square (0.5 = coin toss, 1 = always). ${v.n_random} random squares per target.`;
  const typical = cur
    ? `<p class="hiw-plain"><b>Typical error for ${esc(cur.name)}:</b> half of its known analogs rank below Earth percentile ${cur.median_analog_percentile.toFixed(0)}. So about <b>${Math.max(0, 100 - cur.median_analog_percentile).toFixed(cur.median_analog_percentile > 99 ? 1 : 0)}%</b> of Earth's land outscores a typical real analog site.</p>`
    : '';
  return `<div class="hiw-key note"><span><i class="k-dot"></i>one known analog</span><span><i class="k-med"></i>middle (median) analog</span><span><i class="k-half"></i>random square: 50 on average</span></div>
    <div class="hiw-val">${rows}<div class="hiw-vrow axrow" aria-hidden="true"><span></span><div class="ax"><span>0</span><span>Earth percentile</span><span>100</span></div><span></span></div></div>
    <figcaption>${typical}
    Across all six targets, <b>${top10} of ${all.length}</b> known-analog tests land in Earth's top 10%, and <b>${below}</b> rank below the middle. The Mars desert targets work well; the polar and ice targets are weak. Weights were set from the literature before testing and have not been tuned to these sites.</figcaption>`;
}

async function g9(s: St, el: HTMLElement) {
  const { meta } = s.app.ds;
  const ids = s.t.validation;
  const sums = new Array(meta.n_features).fill(0);
  let n = 0;
  for (const id of ids) {
    const a = s.app.ds.analogs.find((x) => x.id === id);
    if (!a) continue;
    const info = await s.app.requestCell(a.lat, a.lon);
    if (!info) continue;
    const c = contributions(info.q, s.t.vector, s.app.state.weights);
    const tot = c.reduce((x, y) => x + y, 0) || 1;
    c.forEach((v, i) => (sums[i] += v / tot));
    n++;
  }
  if (!n) {
    el.innerHTML = '<p class="note">No known analogs fall on the land grid for this target.</p>';
    return;
  }
  const top = sums.map((v, i) => ({ v: v / n, i })).sort((a, b) => b.v - a.v).slice(0, 6);
  const max = top[0].v || 1;
  el.innerHTML = `<div class="hiw-miss">${top
    .map(({ v, i }, k) => {
      const f = meta.features[i];
      return `<div class="row" style="--g:${GROUP_COLORS[f.ui_group]}" title="${esc(f.name)}"><span>${esc(plain(f))}</span><span class="tr"><i class="grow" style="width:${((v / max) * 100).toFixed(1)}%;--d:${(k * 0.08).toFixed(2)}s"></i></span><b class="mono">${Math.round(v * 100)}%</b></div>`;
    })
    .join('')}</div><figcaption>Share of the remaining gap, averaged over ${n} known analog${n > 1 ? 's' : ''} of ${esc(s.t.name)}, with the map's weights.</figcaption>
    <h3 class="hiw-fixh">What to fix first</h3><ul class="hiw-fix" id="hiw-fix"></ul>`;
  const fixes: string[] = [];
  const ids6 = top.map((x) => meta.features[x.i].id);
  if (ids6.includes('humidity')) fixes.push('<b>Measure water, not relative humidity.</b> Cold polar air counts as "humid" even when it holds almost no water.');
  const synth = meta.features.filter((f) => f.synthetic).map((f) => plain(f).toLowerCase());
  if (synth.length) fixes.push(`<b>Real data for ${esc(synth.join(', '))}.</b> This build uses a placeholder there.`);
  if (ids6.includes('soc') || ids6.includes('ndvi')) fixes.push('<b>Real soil data on ice.</b> The soil map has no measurements there, so a rule fills the gap.');
  fixes.push('<b>Smaller squares.</b> 11 km blurs single craters, lava tubes and dune fields.');
  fixes.push('<b>Count by area.</b> Polar squares are small, so Antarctica is about 28% of all squares.');
  fixes.push('<b>More known analogs</b>, kept aside for a blind test.');
  const ul = document.getElementById('hiw-fix');
  if (ul) ul.innerHTML = fixes.map((f) => `<li>${f}</li>`).join('');
}

// ------------------------------------------------------------------ behaviour

function tween(el: HTMLElement, from: number, to: number, fmt: (v: number) => string, ms = 700) {
  if (ms <= 0 || reduced()) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1 && el.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function runCounters(root: HTMLElement, s: St) {
  root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count);
    const dec = Number(el.dataset.dec || 0);
    tween(el, 0, to, (v) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }), 900);
  });
  root.querySelectorAll<HTMLElement>('[data-val]').forEach((el) => {
    const f = s.app.ds.meta.features[Number(el.dataset.fi)];
    tween(el, 0, Number(el.dataset.val), (v) => fmtValue(v, f), 800);
  });
}

function placesFor(app: App, t: Target): Place[] {
  const out: Place[] = [];
  const v = app.ds.validation?.results.find((r) => r.target === t.id);
  const order = [...t.validation].sort((a, b) => (v?.analogs.find((x) => x.id === b)?.percentile ?? 0) - (v?.analogs.find((x) => x.id === a)?.percentile ?? 0));
  for (const id of order) {
    const a = app.ds.analogs.find((x) => x.id === id);
    if (a) out.push({ key: `a:${a.id}`, label: `${a.name}, ${a.country}`, group: 'Known analogs for this target', lat: a.lat, lon: a.lon });
  }
  const top = app.lastResult?.sites[0];
  if (top) {
    const c = app.countryName(top.country);
    out.push({ key: 'top', label: `#1 square on the map${c.name ? `, ${c.name}` : ''}`, group: 'From the map', lat: top.lat, lon: top.lon });
  }
  return out;
}

const THEMES = ['auto', 'light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
let themeMemo: Theme | null = null;
function readTheme(): Theme {
  if (themeMemo) return themeMemo;
  try {
    const v = localStorage.getItem('hiw-theme');
    themeMemo = (THEMES as readonly string[]).includes(v ?? '') ? (v as Theme) : 'auto';
  } catch {
    themeMemo = 'auto';
  }
  return themeMemo;
}

export function mountHowItWorks(app: App, root: HTMLElement, onShow: (lat: number, lon: number) => void) {
  const t = app.target();
  const feat0 = Math.max(0, app.ds.meta.features.findIndex((f) => f.id === 'temp_mean'));
  const s: St = { app, t, places: placesFor(app, t), place: null, info: null, feat: feat0, mult: { Terrain: 1, Climate: 1, Surface: 1, Remoteness: 1 }, shownScore: 0 };
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T | null;
  const stepEl = (n: number) => $(`#hiw-s${n}`)!;
  const entered = new Set<number>();

  const replay = (n: number) => {
    const el = stepEl(n);
    if (!entered.has(n)) return;
    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');
    runCounters(el, s);
  };

  // --- theme and maths toggles
  const themeBtn = $('#hiw-theme')!;
  const applyTheme = (th: Theme) => {
    if (th === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', th);
    themeBtn.querySelector('span')!.textContent = th[0].toUpperCase() + th.slice(1);
    themeBtn.setAttribute('aria-label', `Colour theme: ${th}. Click to change.`);
  };
  applyTheme(readTheme());
  themeBtn.onclick = () => {
    const next = THEMES[(THEMES.indexOf(readTheme()) + 1) % THEMES.length];
    themeMemo = next;
    try {
      localStorage.setItem('hiw-theme', next);
    } catch {
      /* storage blocked: the theme still applies for this visit */
    }
    applyTheme(next);
  };
  const mathsBtn = $('#hiw-maths')!;
  mathsBtn.onclick = () => {
    const on = mathsBtn.getAttribute('aria-pressed') !== 'true';
    mathsBtn.setAttribute('aria-pressed', String(on));
    root.classList.toggle('maths-on', on);
  };

  // --- rail
  const railBtns = [...root.querySelectorAll<HTMLButtonElement>('.hiw-steps button')];
  const go = (n: number) => {
    const el = stepEl(n);
    el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    (el.querySelector('h2') as HTMLElement).focus({ preventScroll: true });
  };
  railBtns.forEach((b) => (b.onclick = () => go(Number(b.dataset.step))));
  root.querySelectorAll<HTMLElement>('[data-jump]').forEach((b) => (b.onclick = () => document.getElementById(b.dataset.jump!)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' })));
  const setCurrent = (n: number) => {
    railBtns.forEach((b) => (Number(b.dataset.step) === n ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    const now = $('#hiw-now-t');
    if (now) now.textContent = `Step ${n} of ${STEPS.length}: ${STEPS[n - 1]}`;
  };
  setCurrent(1);

  // --- feature chips (steps 3 and 4 share one choice)
  const syncChips = () =>
    root.querySelectorAll<HTMLButtonElement>('.hiw-chip').forEach((c) => c.setAttribute('aria-pressed', String(app.ds.meta.features[s.feat].id === c.dataset.feat)));
  root.querySelectorAll<HTMLButtonElement>('.hiw-chip').forEach(
    (c) =>
      (c.onclick = () => {
        s.feat = app.ds.meta.features.findIndex((f) => f.id === c.dataset.feat);
        syncChips();
        renderFeat();
      }),
  );
  syncChips();

  // --- weight sliders
  root.querySelectorAll<HTMLInputElement>('.hiw-sl input').forEach((inp) => {
    inp.oninput = () => {
      s.mult[inp.dataset.group as Group] = Number(inp.value);
      if (!effWeights(s).some((w) => w > 0)) {
        s.mult[inp.dataset.group as Group] = 0.25;
        inp.value = '0.25';
      }
      if (s.info) update6(s, true);
    };
  });
  $('#hiw-reset')!.onclick = () => {
    for (const g of GROUPS) s.mult[g] = 1;
    root.querySelectorAll<HTMLInputElement>('.hiw-sl input').forEach((i) => (i.value = '1'));
    if (s.info) update6(s, true);
  };

  const renderFeat = () => {
    if (!s.info) return;
    $('#hiw-g3')!.innerHTML = g3(s);
    $('#hiw-g4')!.innerHTML = g4(s);
    replay(3);
    replay(4);
  };

  const renderAll = () => {
    if (!s.info) return;
    const fn = $('#hiw-follow-name');
    if (fn) fn.textContent = s.place!.label;
    $('#hiw-g1')!.innerHTML = g1(s);
    $('#hiw-g1')!.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => img.classList.add('fail')));
    const p = s.place!;
    $('#hiw-show')!.onclick = () => onShow(p.lat, p.lon);
    $('#hiw-g2')!.innerHTML = g2(s);
    $('#hiw-g3')!.innerHTML = g3(s);
    $('#hiw-g4')!.innerHTML = g4(s);
    $('#hiw-g5')!.innerHTML = g5(s);
    if (!$('#hiw-score-n')) $('#hiw-g6')!.innerHTML = g6();
    s.shownScore = 0;
    update6(s, entered.has(6));
    $('#hiw-g7')!.innerHTML = g7(s);
    for (let n = 1; n <= 7; n++) replay(n);
  };

  // --- place picker
  const sel = $('#hiw-place') as HTMLSelectElement;
  const fillSelect = () => {
    const groups = [...new Set(s.places.map((p) => p.group))];
    sel.innerHTML = groups
      .map((g) => `<optgroup label="${esc(g)}">${s.places.filter((p) => p.group === g).map((p) => `<option value="${p.key}">${esc(p.label)}</option>`).join('')}</optgroup>`)
      .join('');
    if (s.place) sel.value = s.place.key;
  };
  let seq = 0;
  const choose = async (p: Place) => {
    const my = ++seq;
    const info = await app.requestCell(p.lat, p.lon);
    if (my !== seq) return;
    if (!info) {
      $('#hiw-g1')!.innerHTML = `<p class="note">${esc(p.label)} falls outside the land grid, so it has no score. Pick another square.</p>`;
      return;
    }
    s.place = p;
    s.info = info;
    sel.value = p.key;
    renderAll();
  };
  sel.onchange = () => {
    const p = s.places.find((x) => x.key === sel.value);
    if (p) void choose(p);
  };
  $('#hiw-random')!.onclick = async () => {
    for (let k = 0; k < 80; k++) {
      const lat = Math.asin(2 * Math.random() - 1) / RAD;
      const lon = Math.random() * 360 - 180;
      const info = await app.requestCell(lat, lon);
      if (!info) continue;
      const c = app.countryName(info.country);
      const label = `Random square: ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}${c.name ? `, ${c.name}` : ''}`;
      const p = { key: 'rand', label, group: 'Random', lat, lon };
      const at = s.places.findIndex((x) => x.key === 'rand');
      if (at >= 0) s.places[at] = p;
      else s.places.push(p);
      s.place = p;
      fillSelect();
      void choose(p);
      return;
    }
  };

  // --- steps 8 and 9 do not depend on the followed square
  $('#hiw-g8')!.innerHTML = g8(s);
  void g9(s, $('#hiw-g9')!);

  // --- scroll: animate each step once it comes into view, and track the current step for the rail
  const steps = [...root.querySelectorAll<HTMLElement>('.hiw-step')];
  if (typeof IntersectionObserver === 'undefined') {
    steps.forEach((el) => {
      el.classList.add('in');
      entered.add(Number(el.dataset.n));
    });
  } else {
    const enter = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          const n = Number((e.target as HTMLElement).dataset.n);
          if (entered.has(n)) return;
          entered.add(n);
          e.target.classList.add('in');
          runCounters(e.target as HTMLElement, s);
          if (n === 6 && s.info) {
            s.shownScore = 0;
            update6(s, true);
          }
        }),
      { root, rootMargin: '0px 0px -15% 0px', threshold: 0 },
    );
    const spy = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && setCurrent(Number((e.target as HTMLElement).dataset.n))),
      { root, rootMargin: '-35% 0px -60% 0px' },
    );
    steps.forEach((el) => {
      enter.observe(el);
      spy.observe(el);
    });
  }

  fillSelect();
  if (s.places.length) void choose(s.places[0]);
  else ($('#hiw-random') as HTMLButtonElement).click();
}
