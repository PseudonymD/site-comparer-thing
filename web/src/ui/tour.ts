// "Take the tour": a user-paced guided walk through the real interface, plus the original
// 30-second auto-playing demo (docs/demo-script.md) which the guide offers on its first step.
//
// Guided mode only highlights and describes controls. The only UI changes it makes are to reveal a
// control (open a panel or switch a tab); an optional button the user presses may open an example
// location. The view is snapshotted on start and restored on exit (see TourHost.restore in main.ts).
import { GUIDE_STEPS, type GuideContext, type GuideStep, type StepAction, type StepPrep } from './tourSteps';
import type { TourSnapshot } from './tourState';

export interface TourApi {
  selectTarget(id: string): void;
  setAlpha(a: number): void;
  worldView(): void;
  closeSite(): void;
  showTab(id: 'cand' | 'disc'): void;
  openFirstDiscovery(): void;
  runDrill(): void;
  openPlanet(): void;
}

export interface TourHost extends TourApi {
  snapshot(): TourSnapshot;
  /** full = also put back target, weights, filters, novelty, geography, region and view settings (demo). */
  restore(s: TourSnapshot, full: boolean): void;
  context(): GuideContext;
  prep(p: StepPrep | undefined): void;
  dossierOpen(): boolean;
  openExample(): void;
  openAbout(section: 'how' | 'limits'): void;
  narrow(): boolean;
}

interface DemoStep {
  caption: string;
  ms: number;
  run(api: TourApi): void;
}

// The six demo steps and their captions are unchanged from the original tour.
const DEMO: DemoStep[] = [
  {
    caption: 'Where on Earth is most like the Moon? 2.1 million land cells, scored live on 18 open data layers.',
    ms: 5000,
    run: (a) => {
      a.closeSite();
      a.setAlpha(0);
      a.selectTarget('moon_south_pole');
      a.showTab('cand');
      a.worldView();
    },
  },
  {
    caption: 'Switch to Mars, Jezero crater: the known analogs light up.',
    ms: 4500,
    run: (a) => {
      a.selectTarget('mars_jezero');
      a.worldView();
    },
  },
  {
    caption: 'Favour new places: good matches far from any known site rise.',
    ms: 4000,
    run: (a) => a.setAlpha(0.4),
  },
  {
    caption: 'A discovery, explained in real units: what matches, what doesn’t, what it’s for.',
    ms: 5500,
    run: (a) => {
      a.showTab('disc');
      a.openFirstDiscovery();
    },
  },
  {
    caption: 'Zoom in: a live 30 m terrain close-up against the real Mars slopes.',
    ms: 5000,
    run: (a) => a.runDrill(),
  },
  {
    caption: 'Mars side by side with its Earth stand-in. Terrestrial Analog Finder: open data, open source.',
    ms: 5500,
    run: (a) => a.openPlanet(),
  },
];

const ACTION_LABEL: Record<StepAction, string> = {
  demo: 'Watch the 30-second demo',
  example: 'Open the top candidate as an example',
  about: 'Open How it works',
  limits: 'Open data and limitations',
};

/** On screen: laid out and not visibility:hidden (a closed panel is visibility:hidden). */
function shown(el: Element): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** The part of an element that is actually visible (clipped by scrolling ancestors and the viewport). */
function visibleRect(el: Element): { l: number; t: number; r: number; b: number } | null {
  const r0 = el.getBoundingClientRect();
  let l = r0.left, t = r0.top, r = r0.right, b = r0.bottom;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(cs.overflowY + cs.overflowX)) {
      const pr = p.getBoundingClientRect();
      l = Math.max(l, pr.left); t = Math.max(t, pr.top); r = Math.min(r, pr.right); b = Math.min(b, pr.bottom);
    }
  }
  l = Math.max(l, 0); t = Math.max(t, 0); r = Math.min(r, window.innerWidth); b = Math.min(b, window.innerHeight);
  return r - l >= 4 && b - t >= 4 ? { l, t, r, b } : null;
}

/** Scroll the panel that contains el so that el is in view. Instant: no animation to wait for. */
function reveal(el: Element, narrow: boolean) {
  const pad = 8;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (!(p instanceof HTMLElement)) continue;
    const cs = getComputedStyle(p);
    if (!/(auto|scroll)/.test(cs.overflowY) || p.scrollHeight <= p.clientHeight + 1) continue;
    const pr = p.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    let delta = 0;
    if (narrow || er.top < pr.top + pad || er.bottom > pr.bottom - pad) delta = er.top - (pr.top + pad);
    if (delta) p.scrollTo({ top: p.scrollTop + delta, behavior: 'auto' });
  }
}

export function createTour(host: TourHost) {
  const box = document.createElement('div');
  box.id = 'tour';
  box.className = 'sheet hidden';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'false');
  box.setAttribute('aria-labelledby', 'tour-title');
  box.setAttribute('aria-describedby', 'tour-cap');
  box.innerHTML = `<div class="tour-head"><span class="tour-tag mono" id="tour-tag">Guide · help text</span><span class="tour-step mono" id="tour-n"></span></div>
    <h2 id="tour-title" tabindex="-1"></h2>
    <div id="tour-cap"></div>
    <div class="tour-actions" id="tour-actions"></div>
    <ol class="tour-dots" id="tour-dots" aria-hidden="true"></ol>
    <div class="tour-ctl"><button class="text-btn" id="tour-prev">Back</button><button class="text-btn" id="tour-pause">Pause</button><button class="text-btn" id="tour-restart">Restart</button><button class="text-btn" id="tour-exit">Skip tour</button><button class="btn" id="tour-next">Next</button></div>
    <div class="tour-bar"><i id="tour-prog"></i></div>`;
  document.body.appendChild(box);
  const spot = document.createElement('div');
  spot.id = 'tour-spot';
  spot.className = 'hidden';
  spot.setAttribute('aria-hidden', 'true');
  document.body.appendChild(spot);
  const live = document.createElement('div');
  live.id = 'tour-live';
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  document.body.appendChild(live);

  const q = <T extends HTMLElement>(id: string) => box.querySelector(`#${id}`) as T;
  const N = GUIDE_STEPS.length;
  let mode: 'off' | 'guide' | 'demo' = 'off';
  let k = -1;
  let timer = 0;
  let raf = 0;
  let paused = false;
  let snap: TourSnapshot | null = null;
  let usedDemo = false;
  let opener: HTMLElement | null = null;
  let targetEl: Element | null = null;
  let revealed = false;
  let lastDossier = false;
  let lastFound = false;
  let lastKey = '';

  const dots = q('tour-dots');
  dots.innerHTML = GUIDE_STEPS.map(() => '<li></li>').join('');

  const announce = (text: string) => {
    live.textContent = '';
    window.setTimeout(() => (live.textContent = text), 30);
  };

  // ------------------------------------------------------------------ guided mode
  function renderBody(s: GuideStep) {
    const dossierOpen = host.dossierOpen();
    const found = !!targetEl;
    lastDossier = dossierOpen;
    lastFound = found;
    const cap = q('tour-cap');
    cap.replaceChildren(
      ...s.paras(host.context(), { dossierOpen, found, narrow: host.narrow() }).map((t) => {
        const p = document.createElement('p');
        p.textContent = t;
        return p;
      }),
    );
    const act = q('tour-actions');
    act.replaceChildren();
    for (const a of s.actions ?? []) {
      if (a === 'example' && dossierOpen) continue;
      const b = document.createElement('button');
      b.className = 'btn tour-act';
      b.type = 'button';
      b.dataset.act = a;
      b.textContent = ACTION_LABEL[a];
      b.onclick = () => onAction(a);
      act.appendChild(b);
      if (a === 'demo' || a === 'example') {
        const note = document.createElement('p');
        note.className = 'note';
        note.textContent =
          a === 'demo'
            ? 'The demo moves the map and changes settings by itself. Your view is restored when it ends.'
            : 'Opens a real location for your current settings. It is closed again when the tour ends.';
        act.appendChild(note);
      }
    }
    if (document.activeElement === document.body || (document.activeElement && !document.activeElement.isConnected)) q('tour-next').focus({ preventScroll: true });
  }

  function onAction(a: StepAction) {
    if (a === 'demo') startDemo();
    else if (a === 'example') host.openExample();
    else {
      const section = a === 'limits' ? 'limits' : 'how';
      stop(false);
      host.openAbout(section);
    }
  }

  function showStep(i: number) {
    window.clearTimeout(timer);
    mode = 'guide';
    k = Math.min(Math.max(0, i), N - 1);
    const s = GUIDE_STEPS[k];
    box.classList.remove('demo');
    box.classList.add('guide');
    q('tour-tag').textContent = 'Guide · help text';
    q('tour-n').textContent = `Step ${k + 1} of ${N}`;
    q('tour-title').textContent = s.title;
    q('tour-next').textContent = k === N - 1 ? 'Finish' : 'Next';
    q<HTMLButtonElement>('tour-prev').disabled = k === 0;
    q('tour-restart').classList.toggle('hidden', k === 0);
    q('tour-pause').classList.add('hidden');
    q('tour-exit').textContent = 'Skip tour';
    box.querySelector('.tour-bar')!.classList.add('hidden');
    dots.querySelectorAll('li').forEach((li, j) => {
      li.className = j < k ? 'done' : j === k ? 'now' : '';
      if (j === k) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    try {
      host.prep(s.prep);
    } catch (e) {
      console.warn('tour prep failed', e);
    }
    targetEl = null;
    revealed = false;
    lastKey = '';
    renderBody(s);
    if (document.activeElement && document.activeElement.hasAttribute('disabled')) q('tour-next').focus({ preventScroll: true });
    announce(`Step ${k + 1} of ${N}. ${s.title}. ${s.paras(host.context(), { dossierOpen: host.dossierOpen(), found: false, narrow: host.narrow() }).join(' ')}`);
    startLoop();
  }

  function resolve(s: GuideStep): Element | null {
    for (const sel of s.targets) {
      const el = document.querySelector(sel);
      if (el && shown(el)) return el;
    }
    return null;
  }

  function place(rect: { l: number; t: number; r: number; b: number } | null, s: GuideStep) {
    const narrow = host.narrow();
    box.classList.toggle('narrow', narrow);
    if (narrow) {
      box.style.left = box.style.top = '';
      // Bottom sheet by default; move it to the top when that covers less of the highlighted control.
      // The offsets mirror the #tour.guide.narrow rules in style.css.
      let top = !!s.cardTop;
      if (rect) {
        const css = getComputedStyle(document.body);
        const px = (v: string, d: number) => parseFloat(css.getPropertyValue(v)) || d;
        const gut = px('--gut', 12), navH = px('--nav-h', 56);
        const h = box.offsetHeight, vh = window.innerHeight;
        const topY = px('--bar-h', 48) + gut * 2 + 4;
        const botY = vh - (navH + gut * 2) - h;
        const cover = (y: number) => Math.max(0, Math.min(rect.b, y + h) - Math.max(rect.t, y));
        const ct = cover(topY), cb = cover(botY);
        if (ct !== cb) top = ct < cb;
      }
      box.classList.toggle('card-top', top);
      return;
    }
    const vw = window.innerWidth, vh = window.innerHeight, g = 12;
    const w = box.offsetWidth, h = box.offsetHeight;
    const clampX = (x: number) => Math.min(Math.max(g, x), vw - w - g);
    const clampY = (y: number) => Math.min(Math.max(g, y), vh - h - g);
    let x = (vw - w) / 2, y = vh - h - 22;
    if (rect && !((rect.r - rect.l) > vw * 0.6 && (rect.b - rect.t) > vh * 0.6)) {
      const cx = (rect.l + rect.r) / 2;
      const opts: [number, number, boolean][] = [];
      const right: [number, number, boolean] = [rect.r + g + 4, clampY(rect.t), rect.r + g + 4 + w <= vw - g];
      const left: [number, number, boolean] = [rect.l - g - 4 - w, clampY(rect.t), rect.l - g - 4 - w >= g];
      const below: [number, number, boolean] = [clampX(rect.l), rect.b + g + 4, rect.b + g + 4 + h <= vh - g];
      const above: [number, number, boolean] = [clampX(rect.l), rect.t - g - 4 - h, rect.t - g - 4 - h >= g];
      opts.push(...(cx < vw / 2 ? [right, below, above, left] : [left, below, above, right]));
      const pick = opts.find((o) => o[2]);
      if (pick) [x, y] = [pick[0], pick[1]];
    }
    box.style.left = `${Math.round(clampX(x))}px`;
    box.style.top = `${Math.round(clampY(y))}px`;
  }

  function tick() {
    raf = 0;
    if (mode !== 'guide') return;
    const s = GUIDE_STEPS[k];
    if (!targetEl || !targetEl.isConnected || !shown(targetEl)) {
      targetEl = resolve(s);
      revealed = false;
    }
    if (targetEl && !revealed) {
      reveal(targetEl, host.narrow());
      revealed = true;
    }
    if (host.dossierOpen() !== lastDossier || !!targetEl !== lastFound) renderBody(s);
    const rect = targetEl ? visibleRect(targetEl) : null;
    if (rect) {
      const pad = 4;
      spot.classList.remove('hidden');
      spot.style.left = `${rect.l - pad}px`;
      spot.style.top = `${rect.t - pad}px`;
      spot.style.width = `${rect.r - rect.l + pad * 2}px`;
      spot.style.height = `${rect.b - rect.t + pad * 2}px`;
    } else spot.classList.add('hidden');
    const key = [rect ? `${rect.l | 0},${rect.t | 0},${rect.r | 0},${rect.b | 0}` : 'none', box.offsetHeight, box.offsetWidth, window.innerWidth, window.innerHeight].join('|');
    if (key !== lastKey) {
      lastKey = key;
      place(rect, s);
    }
    raf = window.requestAnimationFrame(tick);
  }
  function startLoop() {
    if (!raf) raf = window.requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------------ demo mode (original behaviour)
  function demoGo(i: number) {
    window.clearTimeout(timer);
    if (i >= DEMO.length) return stop();
    mode = 'demo';
    k = Math.max(0, i);
    const s = DEMO[k];
    q('tour-n').textContent = `Demo step ${k + 1} of ${DEMO.length}`;
    q('tour-cap').replaceChildren(Object.assign(document.createElement('p'), { textContent: s.caption }));
    q('tour-next').textContent = k === DEMO.length - 1 ? 'Finish' : 'Next';
    q<HTMLButtonElement>('tour-prev').disabled = false;
    const bar = q<HTMLElement>('tour-prog');
    bar.style.transition = 'none';
    bar.style.width = '0';
    void bar.offsetWidth;
    try {
      s.run(host);
    } catch (e) {
      console.warn('tour step failed', e);
    }
    if (!paused) {
      bar.style.transition = `width ${s.ms}ms linear`;
      bar.style.width = '100%';
      timer = window.setTimeout(() => demoGo(k + 1), s.ms);
    }
    announce(`Demo step ${k + 1} of ${DEMO.length}. ${s.caption}`);
  }
  function startDemo() {
    usedDemo = true;
    paused = false;
    window.cancelAnimationFrame(raf);
    raf = 0;
    spot.classList.add('hidden');
    box.classList.remove('guide', 'narrow', 'card-top');
    box.classList.add('demo');
    box.style.left = box.style.top = '';
    q('tour-tag').textContent = 'Demo · captions';
    q('tour-title').textContent = '30-second demo';
    q('tour-actions').replaceChildren();
    q('tour-pause').textContent = 'Pause';
    q('tour-pause').classList.remove('hidden');
    q('tour-restart').classList.add('hidden');
    q('tour-exit').textContent = 'Exit';
    box.querySelector('.tour-bar')!.classList.remove('hidden');
    dots.querySelectorAll('li').forEach((li) => (li.className = ''));
    document.body.classList.add('touring');
    demoGo(0);
  }

  // ------------------------------------------------------------------ lifecycle
  function start(from?: HTMLElement | null, demo = false) {
    if (mode !== 'off') return;
    snap = host.snapshot();
    usedDemo = false;
    const a = from ?? (document.activeElement as HTMLElement | null);
    opener = a && a !== document.body ? a : null;
    box.classList.remove('hidden');
    document.body.classList.add('guiding');
    if (demo) {
      document.body.classList.remove('guiding');
      startDemo();
    } else showStep(0);
    q('tour-title').focus({ preventScroll: true });
  }
  function stop(returnFocus = true) {
    if (mode === 'off') return;
    window.clearTimeout(timer);
    window.cancelAnimationFrame(raf);
    raf = 0;
    mode = 'off';
    k = -1;
    box.classList.add('hidden');
    spot.classList.add('hidden');
    document.body.classList.remove('touring', 'guiding');
    const s = snap;
    const full = usedDemo;
    snap = null;
    usedDemo = false;
    try {
      if (s) host.restore(s, full);
    } catch (e) {
      console.warn('tour restore failed', e);
    } finally {
      if (returnFocus) {
        const ok = (el: HTMLElement | null) => !!el && el.isConnected && shown(el);
        const fallback = document.getElementById(host.narrow() ? 'mnav-guide' : 'btn-tour');
        const target = ok(opener) ? opener : fallback;
        target?.focus({ preventScroll: true });
      }
      opener = null;
    }
  }

  q('tour-next').onclick = () => (mode === 'demo' ? demoGo(k + 1) : k >= N - 1 ? stop() : showStep(k + 1));
  q('tour-prev').onclick = () => (mode === 'demo' ? demoGo(k - 1) : showStep(k - 1));
  q('tour-exit').onclick = () => stop();
  q('tour-restart').onclick = () => {
    showStep(0);
    q('tour-next').focus({ preventScroll: true });
  };
  q('tour-pause').onclick = () => {
    paused = !paused;
    q('tour-pause').textContent = paused ? 'Play' : 'Pause';
    if (paused) {
      window.clearTimeout(timer);
      q<HTMLElement>('tour-prog').style.transition = 'none';
    } else demoGo(k);
  };
  // Capture phase: Esc ends the tour only, instead of also closing the open location (the app's own Esc handler).
  window.addEventListener(
    'keydown',
    (e) => {
      if (mode === 'off') return;
      if (e.key === 'Escape') {
        if (!document.getElementById('about')?.classList.contains('hidden')) return; // let the app close How it works
        e.preventDefault();
        e.stopImmediatePropagation();
        stop();
        return;
      }
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const t = e.target as HTMLElement | null;
      const inCard = !!t && box.contains(t);
      const onBody = !t || t === document.body;
      if (!inCard && !onBody) return;
      if (t && /^(INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(t.tagName)) return;
      e.preventDefault();
      if (mode === 'demo') demoGo(k + (e.key === 'ArrowRight' ? 1 : -1));
      else if (e.key === 'ArrowRight') k >= N - 1 ? stop() : showStep(k + 1);
      else showStep(k - 1);
    },
    true,
  );
  return { start, stop, active: () => mode !== 'off', mode: () => mode };
}
