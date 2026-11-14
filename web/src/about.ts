import type { App } from './main';
import { esc } from './format';
import { mountHowItWorks, railHTML, stepsHTML } from './ui/howitworks';

/** onShow: close the page and open a place on the map (used by the worked example). */
export function renderAbout(app: App, onShow: (lat: number, lon: number) => void = () => {}) {
  const { meta, targets, validation } = app.ds;
  const el = document.getElementById('about')!;
  const synth = meta.synthetic_features;
  // The basalt clause follows this build's meta.json instead of assuming the layer is a placeholder.
  const basalt = meta.features.find((f) => f.id === 'basalt');
  const basaltNote = !basalt || basalt.synthetic
    ? 'The lava-tube target is weak while the basalt layer is a placeholder.'
    : `The lava-tube target is weak; in this build its basalt layer comes from ${esc(basalt.source_name)}, not a placeholder.`;
  const srcRows = meta.features
    .map((f) => {
      const status = f.synthetic ? '<span class="badge synth">placeholder</span>' : f.proxy ? '<span class="badge proxy">proxy</span>' : f.fallback ? '<span class="badge proxy">fallback</span>' : '';
      const src = f.source_url ? `<a href="${f.source_url}" target="_blank" rel="noopener">${esc(f.source_name)}</a>` : esc(f.source_name);
      const notes = f.notes ? `<div class="note">${esc(f.notes)}</div>` : '';
      return `<tr><td>${esc(f.name)}</td><td>${esc(f.unit || '–')}</td><td>${esc(f.ui_group)}</td><td>${src} ${status}${notes}</td></tr>`;
    })
    .join('');
  const valRows = validation
    ? validation.results
        .map((r) => `<tr><td>${esc(r.name)}</td><td><b>${r.auc.toFixed(2)}</b>${r.auc_v1_list != null ? `<div class="note">original list: ${r.auc_v1_list.toFixed(2)}</div>` : ''}</td><td>${r.median_analog_percentile.toFixed(0)}</td><td>${r.analogs.map((a) => `${esc(a.name)} (p${a.percentile.toFixed(0)})`).join(', ')}</td></tr>`)
        .join('')
    : '';
  const refs = Object.entries(targets.references)
    .map(([k, v]) => `<li id="ref-${k}"><span class="ref-key">[${k}]</span> ${esc(v)}</li>`)
    .join('');
  el.innerHTML = `
    <div class="hiw-page">
    ${railHTML()}
    <div class="about-inner">
      <div class="eyebrow">NASA Space Apps Challenge 2026 · Identify Earth locations that analog the permanent Moon base locations and Mars</div>
      <h1>Terrestrial Analog Finder</h1>
      <p class="lead">Astronauts train, and rovers get tested, in places on Earth that look and behave like the Moon or Mars. Today those places
      are picked mostly by expert intuition. We score <b>every one of ${meta.n_cells.toLocaleString()} land cells on Earth</b> (0.1°, ~11 km) against six
      planetary target sites using 18 open data layers, in real time in your browser. The result ranks the known analogs and also turns up <i>new</i> ones.</p>

      ${synth.length ? `<div class="warn-box">This build contains ${synth.length} synthetic placeholder layer(s): ${synth.map((s) => esc(s)).join(', ')}. They exist so the app works end to end while the full data pipeline runs. The validation numbers below refer to this build.</div>` : ''}

${stepsHTML(app)}

      <div id="about-ref" class="about-ref">
      <h2>Data, references and credits</h2>
      <h3>Validation details</h3>
      <p>For each target we compare the known analogs used for it with ${validation ? validation.n_random : 1000} random land cells.
      ROC-AUC is the probability that a known analog outranks a random cell (0.5 = chance, 1 = perfect). The Python validation and the TypeScript
      scorer in your browser share one spec, and a shared test fixture checks that they give the same scores.</p>
      <p><b>Read these numbers honestly.</b> Mars Jezero and Gale work well: the classic desert analogs (Atacama, Death Valley, the MDRS) sit in Earth's top 2%.
      The polar and ice targets are weaker. They recognise the Antarctic Dry Valleys but rank the wetter Arctic sites (Svalbard, Devon Island) near or below the median,
      because relative humidity, precipitation and soil carbon dominate and polar air is humid in <i>relative</i> terms. ${basaltNote} Arcadia's analog list was corrected after we saw the first results (two volcanic sites with no ground ice were removed and
      University Valley, the standard Mars ground-ice analog, was added), so its number is not a blind test. The original list's score is shown beside it.</p>
      <p class="note"><b>What was seen when.</b> Target values and default weights were written from the literature before any validation on real data, and no weight
      has been tuned since. All analogs are famous sites known to us from the start, so none is a strict hold-out, but none was used to fit weights. Changes made after
      seeing results: the default ice filter, the SoilGrids gap fix (Antarctica had been given peat-like soil carbon) and the Arcadia surface-ice value and analog list.
      Details: <code>docs/decisions.md</code> and <code>pipeline/report.md</code> in the repository.</p>
      ${validation ? `<table><thead><tr><th>Target</th><th>ROC-AUC</th><th>Median analog percentile</th><th>Known analogs (Earth percentile)</th></tr></thead><tbody>${valRows}</tbody></table>` : '<p class="note">No validation file in this build.</p>'}

      <h3>Data sources (this build)</h3>
      <table><thead><tr><th>Feature</th><th>Unit</th><th>Group</th><th>Source used</th></tr></thead><tbody>${srcRows}</tbody></table>
      <p class="note">Preferred sources need a NASA Earthdata token. The pipeline falls back automatically to no-auth NASA services (POWER, GIBS) and records what was used. Basemaps and place labels: Esri (World Imagery, Dark Gray Canvas, Boundaries and Places). Country lookup: Natural Earth (public domain). Elevation tiles: Mapzen/Nextzen Terrain Tiles on AWS Open Data (SRTM, GMTED, ETOPO1, NED, and others).</p>

      <h3>Limitations</h3>
      <ul>
        <li><b>Scale.</b> 0.1° cells (~11 km) blur features such as individual craters, lava tubes or dune fields. The 30 m drill-down helps, but some analog qualities (mineralogy, microbiology, regolith mechanics) are not in any global layer.</li>
        <li><b>Target values</b> come from the published literature, not from automated DEM extraction. Terrain statistics depend on scale, so the target slopes are chosen for ~1 km baselines.</li>
        <li><b>Clamping</b> means several targets sit at Earth's extremes on temperature, humidity or vegetation. This is deliberate, but it compresses the difference between "very" and "extremely" analogous.</li>
        <li><b>Percentiles</b> treat all features as equally spread. A 10-percentile gap in precipitation is not physically the same as one in slope. That is why the weights are exposed.</li>
        <li><b>Cells, not km².</b> Percentiles and the random baseline count 0.1° cells, and polar cells are small, so Antarctica is ~28% of all cells. Area weighting would change the baseline.</li>
        <li><b>Relative humidity</b> is high in cold polar air even when it holds almost no water, so it penalises cold deserts. Absolute humidity would be a better dryness measure (a future change).</li>
        <li><b>Soil outside SoilGrids</b> (ice sheets, Antarctica, large lakes) follows a stated rule rather than measurements: see the notes in the data table.</li>
        <li><b>Proxies.</b> Elevation stands in for atmospheric thinness. The GIBS night-lights fallback is a brightness proxy, not radiance.</li>
      </ul>

      <h3>Target references</h3>
      <ul class="refs">${refs}</ul>

      <h3>Use of AI</h3>
      <p>This project was built with Anthropic's Claude through the Claude Code coding assistant. Most of the code and much of the documentation was written by Claude under our direction, then reviewed and tested by us. We chose the challenge framing, the method, the target sites and default weights, and the validation design. Every literature value is cited above, and judgement calls are logged in <code>docs/decisions.md</code>. No AI-generated images or video are used.</p>

      <h3>Credits</h3>
      <p class="note">Data: NASA POWER, NASA GIBS (MODIS NDVI, MERRA-2 aerosols, VIIRS Black Marble), SRTM within AWS Terrain Tiles (Mapzen/Tilezen; also GMTED2010, ETOPO1, NED), NASA Moon Trek and Mars Trek imagery, ISRIC SoilGrids (CC-BY 4.0), Natural Earth (public domain), GLiM / Macrostrat when used for basalt (CC-BY), Esri basemaps. Software: MapLibre GL JS (BSD-3-Clause), Vite, TypeScript, NumPy, SciPy, rasterio, GeoPandas and other open-source libraries listed in the repository. No NASA logos or insignia are used.</p>

      <h3>Team</h3>
      <p>Built for NASA Space Apps 2026. Code and pipeline are open source: <a href="https://github.com/PseudonymD/site-comparer-thing" target="_blank" rel="noopener">github.com/PseudonymD/site-comparer-thing</a>.</p>
      </div>
    </div>
    </div>`;
  el.classList.remove('hidden');
  el.classList.remove('maths-on');
  el.scrollTop = 0;
  const close = () => {
    el.classList.add('hidden');
    document.getElementById('btn-about')?.focus();
  };
  document.getElementById('about-close')!.onclick = close;
  mountHowItWorks(app, el, (lat, lon) => {
    close();
    onShow(lat, lon);
  });
  (document.getElementById('about-close') as HTMLElement).focus({ preventScroll: true });
}
