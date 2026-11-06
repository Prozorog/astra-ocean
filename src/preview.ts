import { MOOD_NAMES } from './moods';
import type { MoodName } from './moods';

export interface PreviewActions {
  play(): void; speed(value: number): void; storm(value: number): void; mood(value: MoodName): void;
  sound(): Promise<boolean>; snapshot(): Promise<void>; record(): Promise<void>; reset(): void;
  settings?(): void;
}
const ICONS = {
  play: '<path d="m9 5 10 7-10 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  speed: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  sound: '<path d="M4 10h4l5-4v12l-5-4H4zM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14"/>',
  silent: '<path d="M4 10h4l5-4v12l-5-4H4zM17 9l5 6m0-6-5 6"/>',
  snapshot: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="m8 6 2-3h4l2 3"/><circle cx="12" cy="13" r="4"/>',
  record: '<circle cx="12" cy="12" r="7"/>', reset: '<path d="M5 8a8 8 0 1 1-1 8M5 3v5h5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3M12 17h.01"/>',
  settings: '<path d="m9 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L2.5 15l2 3 2-.5 2 1L9 21h4l.5-2.5 2-1 2 .5 2-3-1.5-2v-3L19.5 8l-2-3-2 .5-2-1L13 3z"/><circle cx="11" cy="12" r="3"/>',
};
function icon(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export class PreviewShell {
  readonly root = document.createElement('div');
  readonly loader: HTMLDivElement;
  readonly progress: HTMLProgressElement;
  readonly dock: HTMLDivElement;
  readonly hint: HTMLElement;
  private actions: PreviewActions | undefined;
  private playButton: HTMLButtonElement;
  private speedButton: HTMLButtonElement;
  private soundButton: HTMLButtonElement;
  private snapshotButton: HTMLButtonElement;
  private recordButton: HTMLButtonElement;
  private stormInput: HTMLInputElement;
  private stormReadout: HTMLElement;
  private help: HTMLDialogElement;
  private toast: HTMLElement;
  private moodButtons: HTMLButtonElement[] = [];
  private lastPointer = 0;
  private idle = false;
  private ready = false;
  private speeds = [.25, .5, 1];
  private speedValue = 1;
  private toastUntil = 0;
  private recordLabel = -1;
  constructor(private hidden: boolean) {
    this.root.id = 'preview-ui'; this.root.hidden = hidden;
    this.root.innerHTML = `<header class="wordmark"><h1>Floating Ocean</h1><p class="interaction-hint">drag the ember · tap the water · scroll for storm</p></header>
      <div class="sea-loader" role="status"><span class="loader-ember" aria-hidden="true"></span><p>Brewing the sea…</p><progress max="1" value="0" aria-label="Ocean loading progress"></progress><span class="loader-value">0%</span></div>
      <nav class="preview-dock" aria-label="Ocean preview controls"></nav>
      <div class="preview-toast" role="status" aria-live="polite"></div>
      <dialog class="shortcut-dialog" aria-labelledby="shortcut-title"><button class="dialog-close" aria-label="Close shortcuts">×</button><p class="eyebrow">A small sea. Yours to move.</p><h2 id="shortcut-title">Stay a little. Make waves.</h2><p>Grab and flick the ember. Tap for ripples. Drag empty space to orbit. Scroll to change the weather.</p><dl><div><dt>Space</dt><dd>Play / pause</dd></div><div><dt>1 · 2 · 3</dt><dd>¼× · ½× · 1×</dd></div><div><dt>[ · ]</dt><dd>Calmer / stormier</dd></div><div><dt>M</dt><dd>Change mood</dd></div><div><dt>S</dt><dd>Sound on / off</dd></div><div><dt>P · L</dt><dd>Snapshot / record</dd></div><div><dt>R</dt><dd>Reset view</dd></div><div><dt>H · D</dt><dd>Dev controls / specks</dd></div></dl><p class="dialog-note">Sound starts only when you ask. Everything settles back into the sea.</p></dialog>`;
    document.body.appendChild(this.root);
    this.loader = this.root.querySelector('.sea-loader')!; this.progress = this.loader.querySelector('progress')!;
    this.dock = this.root.querySelector('.preview-dock')!; this.hint = this.root.querySelector('.interaction-hint')!;
    this.help = this.root.querySelector('dialog')!; this.toast = this.root.querySelector('.preview-toast')!;
    this.playButton = this.button('Pause', 'pause', () => this.actions?.play(), 'Space');
    this.speedButton = this.button('Playback speed', 'speed', () => { const next = this.speeds[(this.speeds.indexOf(this.speedValue) + 1) % 3]; this.actions?.speed(next); }, '1 / 2 / 3');
    this.speedButton.classList.add('speed-button'); this.speedButton.insertAdjacentHTML('beforeend', '<span>1×</span>');
    const divider = document.createElement('span'); divider.className = 'dock-divider'; divider.setAttribute('aria-hidden', 'true'); this.dock.appendChild(divider);
    const storm = document.createElement('label'); storm.className = 'storm-control';
    storm.innerHTML = '<span class="storm-caption"><span>Calm</span><span class="storm-readout">Rough</span></span><span class="main-tick" title="Main look" aria-hidden="true"></span><input type="range" min="0.25" max="1.375" step="0.005" value="1" aria-label="Storm level" />';
    this.dock.appendChild(storm); this.stormInput = storm.querySelector('input')!; this.stormReadout = storm.querySelector('.storm-readout')!;
    this.stormInput.addEventListener('input', () => { this.interacted(); this.actions?.storm(Number(this.stormInput.value)); });
    const moods = document.createElement('div'); moods.className = 'mood-swatches'; moods.setAttribute('role', 'group'); moods.setAttribute('aria-label', 'Colour mood');
    for (const name of MOOD_NAMES) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `mood-swatch mood-${name.toLowerCase()}`;
      button.setAttribute('aria-label', `${name} mood`); button.setAttribute('aria-pressed', String(name === 'Coral')); button.title = `${name} mood · M`;
      button.innerHTML = '<span aria-hidden="true"></span>'; button.addEventListener('click', () => { this.interacted(); this.actions?.mood(name); });
      moods.appendChild(button); this.moodButtons.push(button);
    }
    this.dock.appendChild(moods);
    this.soundButton = this.button('Turn sound on', 'silent', () => { void this.actions?.sound().then(value => this.setSound(value)).catch(error => this.message(String(error))); }, 'S');
    this.soundButton.setAttribute('aria-pressed', 'false');
    this.snapshotButton = this.button('Save snapshot', 'snapshot', () => { void this.actions?.snapshot().catch(error => this.message(String(error))); }, 'P');
    this.recordButton = this.button('Record loop', 'record', () => { void this.actions?.record().catch(error => this.message(String(error))); }, 'L');
    this.recordButton.classList.add('record-button');
    this.button('Reset view', 'reset', () => this.actions?.reset(), 'R');
    this.button('Settings', 'settings', () => this.actions?.settings?.(), 'G');
    this.button('Show shortcuts', 'help', () => { this.help.showModal(); }, '?');
    this.help.querySelector('dl')!.insertAdjacentHTML('beforeend', '<div><dt>G</dt><dd>Wave look settings</dd></div>');
    this.root.querySelector('.dialog-close')!.addEventListener('click', () => this.help.close());
    this.help.addEventListener('click', event => { if (event.target === this.help) { const box = this.help.getBoundingClientRect(); const mouse = event as MouseEvent; if (mouse.clientX < box.left || mouse.clientX > box.right || mouse.clientY < box.top || mouse.clientY > box.bottom) this.help.close(); } });
    window.addEventListener('pointermove', () => { this.lastPointer = performance.now() / 1000; if (this.idle) { this.idle = false; this.dock.classList.remove('is-idle'); } }, { passive: true });
    this.dock.addEventListener('focusin', () => { this.lastPointer = performance.now() / 1000; this.dock.classList.remove('is-idle'); this.idle = false; });
  }
  private button(label: string, image: keyof typeof ICONS, action: () => void, shortcut: string): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'dock-button';
    button.setAttribute('aria-label', label); button.title = `${label} · ${shortcut}`; button.innerHTML = icon(image);
    button.addEventListener('click', () => { this.interacted(); action(); }); this.dock.appendChild(button); return button;
  }
  bind(actions: PreviewActions): void { this.actions = actions; }
  brewing(fraction: number): void { this.progress.value = fraction; this.loader.querySelector('.loader-value')!.textContent = `${Math.round(fraction * 100)}%`; }
  reveal(): void {
    this.ready = true; this.brewing(1); this.root.classList.add('is-ready'); this.lastPointer = performance.now() / 1000;
  }
  setHidden(value: boolean): void { this.hidden = value; this.root.hidden = value; if (value) this.help.close(); }
  interacted(): void { this.hint.classList.add('is-used'); this.lastPointer = performance.now() / 1000; }
  setPlaying(playing: boolean): void {
    this.playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play'); this.playButton.title = `${playing ? 'Pause' : 'Play'} · Space`;
    this.playButton.innerHTML = icon(playing ? 'pause' : 'play');
  }
  setSpeed(value: number): void { this.speedValue = value; this.speedButton.querySelector('span')!.textContent = `${value}×`; this.speedButton.setAttribute('aria-label', `Playback speed ${value}×`); }
  setStorm(value: number): void {
    this.stormInput.value = String(value); this.stormInput.style.setProperty('--storm', `${(value - .25) / 1.125 * 100}%`);
    this.stormReadout.textContent = value < .4 ? 'Calm' : value < .65 ? 'Breeze' : value < 1.374 ? 'Rough' : 'Storm';
    this.stormInput.setAttribute('aria-valuetext', `${this.stormReadout.textContent}, ${Math.round(value * 100)} percent`);
  }
  setMood(name: MoodName): void { this.moodButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(MOOD_NAMES[i] === name))); }
  setSound(value: boolean): void {
    this.soundButton.setAttribute('aria-label', value ? 'Turn sound off' : 'Turn sound on'); this.soundButton.setAttribute('aria-pressed', String(value));
    this.soundButton.innerHTML = icon(value ? 'sound' : 'silent');
  }
  setSnapshotBusy(value: boolean): void { this.snapshotButton.disabled = value; }
  message(value: string): void { this.toast.textContent = value; this.toast.classList.add('is-visible'); this.toastUntil = performance.now() / 1000 + 3; }
  tick(wall: number, recording: boolean, progress: number): void {
    if (this.hidden || !this.ready) return;
    const idle = !recording && wall - this.lastPointer > 3 && !this.help.open && !this.dock.querySelector(':focus-visible');
    if (idle !== this.idle) { this.idle = idle; this.dock.classList.toggle('is-idle', idle); }
    this.recordButton.classList.toggle('is-recording', recording);
    if (recording || this.recordLabel !== -1) this.recordButton.style.setProperty('--record-progress', String(progress));
    const label = Math.round(progress * 100);
    if (recording && label !== this.recordLabel) { this.recordLabel = label; this.recordButton.setAttribute('aria-label', `Recording loop ${label}%`); }
    if (!recording && this.recordLabel !== -1) { this.recordLabel = -1; this.recordButton.setAttribute('aria-label', 'Record loop'); }
    if (this.toastUntil > 0 && wall > this.toastUntil) { this.toastUntil = 0; this.toast.classList.remove('is-visible'); }
  }
}
