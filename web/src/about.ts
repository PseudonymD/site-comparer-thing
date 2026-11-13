import type { App } from './main';
import { esc } from './format';

export function renderAbout(app: App) {
  const { meta, targets, validation, analogs } = app.ds;
  const el = document.getElementById('about')!;
  const synth = meta.synthetic_features;
  const srcRows = meta.features
    .map((f) => {
      const status = f.synthetic ? '<span class="badge synth">placeholder</span>' : f.proxy ? '<span class="badge proxy">proxy</span>' : '';
      const src = f.source_url ? `<a href="${f.source_url}" target="_blank" rel="noopener">${esc(f.source_name)}</a>` : esc(f.source_name);
      return `<tr><td>${esc(f.name)}</td><td>${esc(f.unit || '–')}</td><td>${esc(f.ui_group)}</td><td>${src} ${status}</td></tr>`;
    })
    .join('');
  const valRows = validation
    ? validation.results
        .map((r) => `<tr><td>${esc(r.name)}</td><td><b>${r.auc.toFixed(2)}</b></td><td>${r.median_analog_percentile.toFixed(0)}</td><td>${r.analogs.map((a) => `${esc(a.name)} (p${a.percentile.toFixed(0)})`).join(', ')}</td></tr>`)
        .join('')
    : '';
  const refs = Object.entries(targets.references)
    .map(([k, v]) => `<li id="ref-${k}"><span class="ref-key">[${k}]</span> ${esc(v)}</li>`)
    .join('');
  el.innerHTML = `
    <button class="btn about-close" id="about-close">← Back to map</button>
    <div class="about-inner">
      <div class="eyebrow">NASA Space Apps Challenge 2026 · Identify Earth locations that analog the permanent Moon base locations and Mars</div>
      <h1>Terrestrial Analog Finder</h1>
      <p class="lead">Astronauts train, and rovers get tested, in places on Earth that look and behave like the Moon or Mars. Today those places
      are picked mostly by expert intuition. We score <b>every one of ${meta.n_cells.toLocaleString()} land cells on Earth</b> (0.1°, ~11 km) against six
      planetary target sites using 18 open data layers, in real time in your browser. The result ranks the known analogs and also turns up <i>new</i> ones.</p>

      ${synth.length ? `<div class="warn-box">This build contains ${synth.length} synthetic placeholder layer(s): ${synth.map((s) => esc(s)).join(', ')}. They exist so the app works end to end while the full data pipeline runs. The validation numbers below refer to this build.</div>` : ''}

      <h2>How it works</h2>
      <ol class="steps">
        <li><b>Describe Earth.</b> For each land cell an offline Python pipeline computes 18 features: terrain (elevation, mean and 90th-percentile slope, roughness, local relief, from ~1 km DEM pixels), climate (temperature, day–night range, coldest month, precipitation, humidity, sunlight), surface (vegetation, soil carbon, sand, basaltic rock, permanent ice) and remoteness (night lights, dust/aerosol).</li>
        <li><b>Put everything on one scale.</b> Each feature becomes its <i>Earth percentile</i>: z = CDF(x) over all land cells. A cell's z of 0.97 for slope means it is steeper than 97% of Earth's land. The 101 percentile breakpoints are kept, so the app can still show real units.</li>
        <li><b>Describe the target in the same terms.</b> Moon and Mars sites are characterised from the literature (LOLA, Diviner, MOLA, REMS/MEDA, CRISM…). The Moon is often beyond anything on Earth: it is colder, drier, airless, with no vegetation. So we <b>clamp each target value to Earth's own range</b> before mapping it through the same CDF. The question becomes: <i>how close can Earth get?</i></li>
        <li><b>Score every cell, live.</b> A Web Worker computes a weighted distance in percentile space for all cells whenever you move a slider. This takes a few hundred milliseconds for ~2 million cells. Adjacent high-scoring cells are merged into candidate sites.</li>
        <li><b>Explain and zoom in.</b> Each site gets a breakdown of which features match and which don't. A live drill-down fetches 30 m elevation tiles and compares the site's slope distribution with the target's.</li>
      </ol>

      <h2>The score</h2>
      <span class="formula">S_i = 1 − √( Σ_f w_f (z_if − t_f)² / Σ_f w_f )        contribution c_if = w_f (z_if − t_f)² / Σ_f w_f
novelty N_i = min(d_i / ${meta.novelty_saturation_km} km, 1)   (d_i = great-circle distance to the nearest of ${analogs.length} known analogs)
blended B_i = (1 − α) S_i + α N_i              hard filters set S_i = 0</span>
      <p>Weights default to a preset per target. For example, vegetation and precipitation weigh heavily for every target, and ice matters only for polar and ice targets. The Python validation and the TypeScript worker share one spec, and a shared test fixture checks they give the same scores.</p>

      <h2>Validation</h2>
      <p>Do known analog sites actually score high? For each target we compare the sites used for that body with 1000 random land cells.
      ROC-AUC is the probability that a known analog outranks a random cell (0.5 = chance, 1 = perfect).</p>
      ${validation ? `<table><thead><tr><th>Target</th><th>ROC-AUC</th><th>Median analog percentile</th><th>Known analogs (Earth percentile)</th></tr></thead><tbody>${valRows}</tbody></table>` : '<p class="note">No validation file in this build.</p>'}

      <h2>Data sources (this build)</h2>
      <table><thead><tr><th>Feature</th><th>Unit</th><th>Group</th><th>Source used</th></tr></thead><tbody>${srcRows}</tbody></table>
      <p class="note">Preferred sources need a NASA Earthdata token. The pipeline falls back automatically to no-auth NASA services (POWER, GIBS) and records what was used. Basemaps and place labels: Esri (World Imagery, Dark Gray Canvas, Boundaries and Places). Country lookup: Natural Earth (public domain). Elevation tiles: Mapzen/Nextzen Terrain Tiles on AWS Open Data (SRTM, GMTED, ETOPO1, NED, and others).</p>

      <h2>Limitations</h2>
      <ul>
        <li><b>Scale.</b> 0.1° cells (~11 km) blur features such as individual craters, lava tubes or dune fields. The 30 m drill-down helps, but some analog qualities (mineralogy, microbiology, regolith mechanics) are not in any global layer.</li>
        <li><b>Target values</b> come from the published literature, not from automated DEM extraction. Terrain statistics depend on scale, so the target slopes are chosen for ~1 km baselines.</li>
        <li><b>Clamping</b> means several targets sit at Earth's extremes on temperature, humidity or vegetation. This is deliberate, but it compresses the difference between "very" and "extremely" analogous.</li>
        <li><b>Percentiles</b> treat all features as equally spread. A 10-percentile gap in precipitation is not physically the same as one in slope. That is why the weights are exposed.</li>
        <li><b>Proxies.</b> Elevation stands in for atmospheric thinness. The GIBS night-lights fallback is a brightness proxy, not radiance.</li>
      </ul>

      <h2>Target references</h2>
      <ul class="refs">${refs}</ul>

      <h2>Team</h2>
      <p>Built for NASA Space Apps 2026. Code and pipeline are open source; see the repository README.</p>
    </div>`;
  el.classList.remove('hidden');
  el.scrollTop = 0;
  document.getElementById('about-close')!.onclick = () => el.classList.add('hidden');
}
