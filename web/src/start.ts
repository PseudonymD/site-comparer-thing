/* Start screen: title, logo, and the way into the map or the settings page.
   Shared links (anything in the URL hash) skip it so a recipient lands on what was shared. */

export interface StartApi {
  show(): void;
  hide(): void;
}

export function initStart(onSettings: (from: HTMLElement) => void): StartApi {
  const screen = document.querySelector<HTMLElement>('#start')!;
  const go = document.querySelector<HTMLButtonElement>('#start-go')!;
  const settings = document.querySelector<HTMLButtonElement>('#start-settings')!;

  const hide = () => {
    screen.classList.add('hidden');
    document.body.classList.remove('start-open');
  };
  const show = () => {
    screen.classList.remove('hidden');
    document.body.classList.add('start-open');
    go.focus();
  };
  go.onclick = hide;
  settings.onclick = () => onSettings(settings);

  if (location.hash.length > 1) hide();
  else show();
  return { show, hide };
}
