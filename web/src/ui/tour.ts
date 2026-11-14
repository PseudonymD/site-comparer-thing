// Guided tour / presentation mode: six scripted states with captions (docs/demo-script.md).
// The captions double as on-screen subtitles for the 30-second video. Start with the button or #tour.

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

interface Step {
  caption: string;
  ms: number;
  run(api: TourApi): void;
}

const STEPS: Step[] = [
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

export function createTour(api: TourApi) {
  const box = document.createElement('div');
  box.id = 'tour';
  box.className = 'sheet hidden';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-live', 'polite');
  box.innerHTML = `<div class="tour-step mono" id="tour-n"></div><p id="tour-cap"></p>
    <div class="tour-ctl"><button class="text-btn" id="tour-prev">Back</button><button class="text-btn" id="tour-pause">Pause</button><button class="btn" id="tour-next">Next</button><button class="text-btn" id="tour-exit">Exit</button></div>
    <div class="tour-bar"><i id="tour-prog"></i></div>`;
  document.body.appendChild(box);
  let k = -1;
  let timer = 0;
  let paused = false;
  const q = <T extends HTMLElement>(id: string) => box.querySelector(`#${id}`) as T;

  function go(i: number) {
    window.clearTimeout(timer);
    if (i >= STEPS.length) return stop();
    k = Math.max(0, i);
    const s = STEPS[k];
    q('tour-n').textContent = `${k + 1} / ${STEPS.length}`;
    q('tour-cap').textContent = s.caption;
    q('tour-next').textContent = k === STEPS.length - 1 ? 'Finish' : 'Next';
    const bar = q<HTMLElement>('tour-prog');
    bar.style.transition = 'none';
    bar.style.width = '0';
    void bar.offsetWidth;
    try {
      s.run(api);
    } catch (e) {
      console.warn('tour step failed', e);
    }
    if (!paused) {
      bar.style.transition = `width ${s.ms}ms linear`;
      bar.style.width = '100%';
      timer = window.setTimeout(() => go(k + 1), s.ms);
    }
  }
  function start() {
    paused = false;
    q('tour-pause').textContent = 'Pause';
    box.classList.remove('hidden');
    document.body.classList.add('touring');
    go(0);
  }
  function stop() {
    window.clearTimeout(timer);
    box.classList.add('hidden');
    document.body.classList.remove('touring');
    k = -1;
  }
  q('tour-next').onclick = () => go(k + 1);
  q('tour-prev').onclick = () => go(k - 1);
  q('tour-exit').onclick = stop;
  q('tour-pause').onclick = () => {
    paused = !paused;
    q('tour-pause').textContent = paused ? 'Play' : 'Pause';
    if (paused) {
      window.clearTimeout(timer);
      const bar = q<HTMLElement>('tour-prog');
      bar.style.transition = 'none';
    } else go(k);
  };
  window.addEventListener('keydown', (e) => {
    if (k < 0) return;
    if (e.key === 'ArrowRight') go(k + 1);
    else if (e.key === 'ArrowLeft') go(k - 1);
    else if (e.key === 'Escape') stop();
  });
  return { start, stop, active: () => k >= 0 };
}
