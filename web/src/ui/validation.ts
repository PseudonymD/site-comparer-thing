import type { App } from '../main';
import { esc } from '../format';
import { capability } from '../capabilities';

export function renderValidation(app: App): void {
  const about = document.getElementById('about')!;
  const validation = app.ds.validation;
  if (!validation) {
    about.innerHTML = `<div class="about-inner"><button class="text-btn" id="close-validation">Close</button><h2>Validation dashboard</h2><p>No validation file is published in this build.</p><p class="note">${esc(capability('radiation').explanation)}</p></div>`;
  } else {
    const rows = validation.results.map((result) => `<article class="validation-card">
      <div class="eyebrow">${esc(result.name)}</div>
      <h3>AUC ${result.auc.toFixed(2)}</h3>
      <p>Known analog median: p${result.median_analog_percentile.toFixed(0)} · random median score: ${(result.random_median_score * 100).toFixed(1)}</p>
      <p class="note">This is development validation against the listed analog registry and ${validation.n_random.toLocaleString()} random Earth cells. It is not independent held-out validation.</p>
      <table><thead><tr><th>Analog</th><th>Score</th><th>Percentile</th><th>Rank</th></tr></thead><tbody>${result.analogs.map((analog) => `<tr><td>${esc(analog.name)}</td><td>${(analog.score * 100).toFixed(1)}</td><td>p${analog.percentile.toFixed(1)}</td><td>${analog.rank ?? '–'}</td></tr>`).join('')}</tbody></table>
    </article>`).join('');
    about.innerHTML = `<div class="about-inner"><button class="text-btn" id="close-validation">Close</button><h2>Validation dashboard</h2><p>Generated ${esc(validation.generated.slice(0, 10))}. Development analog performance is shown separately from any claim of independent generalization.</p>${rows}</div>`;
  }
  about.classList.remove('hidden');
  document.getElementById('close-validation')!.onclick = () => about.classList.add('hidden');
}
