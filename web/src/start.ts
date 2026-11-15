/* Start screen: title, logo, and the choice between Normal Mode (the full app) and Simple Mode.
   Shared links (anything in the URL hash) skip it so a recipient lands on what was shared. */

export type UiMode = 'normal' | 'simple';
export interface StartApi {
  show(): void;
  hide(): void;
}

const KEY = 'analog-finder-ui';
/** The mode used last time, so the start screen can point to it. */
export function lastMode(): UiMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'simple' || v === 'normal' ? v : null;
  } catch {
    return null;
  }
}
export function rememberMode(m: UiMode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* storage blocked: the choice still applies for this visit */
  }
}

export function initStart(onSettings: (from: HTMLElement) => void, onChoose: (mode: UiMode) => void): StartApi {
  const screen = document.querySelector<HTMLElement>('#start')!;
  const cards = [...document.querySelectorAll<HTMLButtonElement>('.mode-card')];
  const settings = document.querySelector<HTMLButtonElement>('#start-settings')!;

  const hide = () => {
    screen.classList.add('hidden');
    document.body.classList.remove('start-open');
  };
  const show = () => {
    const last = lastMode();
    cards.forEach((c) => c.classList.toggle('last', c.dataset.mode === last));
    screen.classList.remove('hidden');
    document.body.classList.add('start-open');
    (cards.find((c) => c.dataset.mode === (last ?? 'normal')) ?? cards[0]).focus();
  };
  cards.forEach((c) => {
    c.onclick = () => {
      const mode = c.dataset.mode as UiMode;
      rememberMode(mode);
      hide();
      onChoose(mode);
    };
  });
  settings.onclick = () => onSettings(settings);
  if (location.hash.length > 1) hide();
  else show();
  return { show, hide };
}
