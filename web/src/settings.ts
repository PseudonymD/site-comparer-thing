/* Settings page and the persisted appearance preferences (light/dark, Moon/Mars colour switch).
   The weightings and presets are built by main.ts into #set-weights (they own the scoring state). The
   filters and map view sections here do not own any state. Each control mirrors an
   existing control in the left panel: changing it writes the value into that control and fires its
   event, so validation, scoring and the URL hash keep a single code path. */

export type Theme = 'light' | 'dark';
export interface Prefs {
  theme: Theme;
  /** Tint the interface blue for the Moon and red for Mars. */
  bodyColors: boolean;
}

const KEY = 'analog-finder-settings';
const root = document.documentElement;

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function load(): Prefs {
  const prefs: Prefs = { theme: systemTheme(), bodyColors: true };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    if (raw.theme === 'light' || raw.theme === 'dark') prefs.theme = raw.theme;
    if (typeof raw.bodyColors === 'boolean') prefs.bodyColors = raw.bodyColors;
  } catch {
    /* storage blocked or corrupt: fall back to defaults */
  }
  return prefs;
}

export const prefs: Prefs = load();

export function applyPrefs() {
  root.dataset.theme = prefs.theme;
  if (prefs.bodyColors) root.removeAttribute('data-tint');
  else root.dataset.tint = 'off';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', prefs.theme === 'dark' ? '#05070b' : '#e8eaed');
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* the setting still applies for this visit */
  }
}

export interface SettingsConfig {
  filterCount: number;
}

export interface SettingsApi {
  open(returnFocus?: HTMLElement | null): void;
  close(): void;
  attachAdvanced(cfg: SettingsConfig): void;
  /** Called each time the page opens, before it is shown (used to sync the weightings editor). */
  onOpen(cb: () => void): void;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, scope: ParentNode = document) => scope.querySelector(sel) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function initSettings(): SettingsApi {
  const page = $('#settings');
  let returnTo: HTMLElement | null = null;
  const refreshers: (() => void)[] = [];
  const openHooks: (() => void)[] = [];

  // ---- appearance (works before the data has loaded)
  const themeBtns = page.querySelectorAll<HTMLButtonElement>('#set-theme button');
  const tint = $<HTMLInputElement>('#set-tint');
  const syncAppearance = () => {
    themeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === prefs.theme)));
    tint.checked = prefs.bodyColors;
  };
  themeBtns.forEach((b) => {
    b.onclick = () => {
      prefs.theme = b.dataset.v as Theme;
      applyPrefs();
      save();
      syncAppearance();
    };
  });
  tint.onchange = () => {
    prefs.bodyColors = tint.checked;
    applyPrefs();
    save();
  };
  syncAppearance();

  // ---- open / close
  const close = () => {
    page.classList.add('hidden');
    returnTo?.focus();
    returnTo = null;
  };
  const open = (from?: HTMLElement | null) => {
    returnTo = from ?? (document.activeElement as HTMLElement | null);
    syncAppearance();
    openHooks.forEach((h) => h());
    refreshers.forEach((r) => r());
    page.classList.remove('hidden');
    page.scrollTop = 0;
    $('#settings-close').focus();
  };
  $('#settings-close').onclick = close;
  // Capture phase: the app's own Escape handler must not also close the dossier behind the page.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && !page.classList.contains('hidden')) {
        e.stopPropagation();
        close();
      }
    },
    true,
  );

  // ---- mirrored controls
  const setFill = (el: HTMLInputElement) => el.style.setProperty('--v', `${((+el.value - +el.min) / (+el.max - +el.min)) * 100}%`);

  function mirrorRange(srcSel: string, label: string, outSel: string, id: string): HTMLElement | null {
    const src = document.querySelector<HTMLInputElement>(srcSel);
    if (!src) return null;
    const row = el('div', 'set-row');
    const lab = el('label', undefined, label);
    lab.htmlFor = id;
    const input = el('input');
    input.type = 'range';
    input.id = id;
    input.min = src.min;
    input.max = src.max;
    input.step = src.step;
    const out = el('span', 'val mono');
    const pull = () => {
      input.value = src.value;
      setFill(input);
      out.textContent = document.querySelector(outSel)?.textContent ?? src.value;
      row.classList.toggle('off', +src.value === 0 && src.min === '0' && srcSel.startsWith('#w-'));
    };
    input.addEventListener('input', () => {
      src.value = input.value;
      src.dispatchEvent(new Event('input', { bubbles: true }));
      pull(); // the app may have corrected the value (e.g. refusing an all-zero weight vector)
    });
    refreshers.push(pull);
    row.append(lab, input, out);
    pull();
    return row;
  }

  function mirrorCheck(srcSel: string, label: string, id: string, numSel?: string): HTMLElement | null {
    const src = document.querySelector<HTMLInputElement>(srcSel);
    if (!src) return null;
    const num = numSel ? document.querySelector<HTMLInputElement>(numSel) : null;
    const row = el('div', 'set-check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.id = id;
    const lab = el('label', undefined, label);
    lab.htmlFor = id;
    row.append(cb, lab);
    let n: HTMLInputElement | null = null;
    if (num) {
      n = el('input');
      n.type = 'number';
      n.step = num.step;
      n.setAttribute('aria-label', `${label} limit`);
      n.addEventListener('change', () => {
        num.value = n!.value;
        num.dispatchEvent(new Event('change', { bubbles: true }));
      });
      row.append(n);
    }
    cb.addEventListener('change', () => {
      src.checked = cb.checked;
      src.dispatchEvent(new Event('change', { bubbles: true }));
    });
    refreshers.push(() => {
      cb.checked = src.checked;
      if (n && num) n.value = num.value;
    });
    cb.checked = src.checked;
    if (n && num) n.value = num.value;
    return row;
  }

  function mirrorSeg(srcSel: string, label: string): HTMLElement | null {
    const src = document.querySelector<HTMLElement>(srcSel);
    if (!src) return null;
    const row = el('div', 'set-row set-seg');
    row.append(el('span', undefined, label));
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', label);
    const srcBtns = [...src.querySelectorAll<HTMLButtonElement>('button')];
    const mine = srcBtns.map((sb) => {
      const b = el('button', undefined, sb.textContent ?? '');
      b.type = 'button';
      b.onclick = () => {
        sb.click();
        pull();
      };
      seg.append(b);
      return b;
    });
    const pull = () => mine.forEach((b, i) => b.setAttribute('aria-pressed', srcBtns[i].getAttribute('aria-pressed') ?? 'false'));
    refreshers.push(pull);
    pull();
    row.append(seg);
    return row;
  }

  function section(title: string, note?: string): HTMLElement {
    const s = el('section', 'set-section');
    s.append(el('h2', undefined, title));
    if (note) s.append(el('p', 'note', note));
    return s;
  }

  function attachAdvanced(cfg: SettingsConfig) {
    const host = $('#set-advanced');
    host.replaceChildren();

    // Filters
    const f = section('Filters', 'Cells past an enabled limit score zero.');
    for (let k = 0; k < cfg.filterCount; k++) {
      const label = document.querySelector(`label[for="flt-${k}"]`)?.textContent ?? `Filter ${k + 1}`;
      const row = mirrorCheck(`#flt-${k}`, label, `set-flt-${k}`, `#flt-${k} ~ input[type="number"]`);
      if (row) f.append(row);
    }
    const nov = mirrorRange('#alpha', 'Favour new places', '#alpha-val', 'set-alpha');
    if (nov) f.append(nov);
    f.append(el('p', 'note', 'Country and region filters are in the Filters tab of the main controls.'));
    host.append(f);

    // Map view
    const v = section('Map view');
    for (const r of [
      mirrorSeg('#seg-proj', 'Map shape'),
      mirrorSeg('#seg-base', 'Background'),
      mirrorRange('#stretch', 'Start colour at Earth percentile', '#stretch-val', 'set-stretch'),
      mirrorCheck('#hide-below', 'Hide cells below that percentile', 'set-hide'),
      mirrorRange('#opacity', 'Score layer opacity', '#opacity-val', 'set-opacity'),
    ]) if (r) v.append(r);
    host.append(v);
  }

  return { open, close, attachAdvanced, onOpen: (cb) => void openHooks.push(cb) };
}
