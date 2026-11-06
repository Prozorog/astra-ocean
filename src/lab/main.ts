import './style.css';
import GUI from 'lil-gui';
import { wrapTime } from '../water/time';
import type { LabApi, LabSettings, LabVariant, VariantId } from './contracts';
import { VariantF } from './variant-f';
import { parseLabPreset } from './presets';

declare global { interface Window { __lab: LabApi } }
const parameters = new URLSearchParams(location.search), frozen = parameters.get('freeze') === '1', selected = parameters.get('variant');
const pairF = selected === 'F';
const activeVariantIds: readonly VariantId[] = pairF ? (['F'] as const) : (['F', 'P', 'S'] as const);
let initial = Number(parameters.get('t') ?? 0); if (!Number.isFinite(initial)) initial = 0;
const host = document.querySelector<HTMLElement>('#lab')!;
host.innerHTML = `<header class="lab-bar"><a href="/" class="wordmark">Floating Ocean</a><span class="lab-title">Water Lab</span><p>${pairF ? 'Reference & Physical FFT · side by side' : 'One reference. Three ways to make water.'}</p><button id="load-preset">Load JSON</button><button id="save-preset">Save preset</button><input id="preset-file" type="file" accept="application/json,.json" hidden></header>
<main class="lab-grid">
  <article class="tile reference" data-tile="reference"><div class="canvas-slot"><canvas aria-label="Original reference, synchronized by frame index"></canvas></div><header class="tile-head"><span><b>Reference</b><small>Original · 121 frames</small></span><button class="expand" aria-label="Enlarge reference">↗</button></header><div class="tile-loading"><span>Decoding the reference…</span><progress max="1" value="0"></progress></div><footer class="tile-caption"><span>READ ONLY</span><span class="frame-index">000 / 120</span></footer></article>
  ${activeVariantIds.map(id => `<article class="tile" data-tile="${id}"><div class="canvas-slot"></div><header class="tile-head"><span><b>${id} <i>·</i> ${id === 'F' ? 'Physical FFT' : id === 'P' ? 'Poseidon' : 'Choppy octaves'}</b><small>${id === 'F' ? 'Metres · WebGL2 GPU FFT' : id === 'P' ? 'Published ocean · WebGPU' : 'Independent stylized sea · WebGL2'}</small></span><button class="tune" aria-label="Tune variant ${id}">Tune</button><button class="expand" aria-label="Enlarge variant ${id}">↗</button></header><div class="gui-host" hidden></div><div class="tile-loading"><span>Preparing ${id}…</span><progress max="1" value="0"></progress></div><footer class="tile-caption"><span class="backend-status">INITIALIZING</span><span>RIGID TUMBLE · NO BEND</span></footer></article>`).join('')}
</main><footer class="lab-controls"><button id="play" aria-label="Play all variants">Ⅱ</button><output id="clock">0.00</output><input id="scrub" aria-label="Synchronized lab time" type="range" min="0" max="3.63" step="0.001" value="0"><span class="loop-duration">3.63 s</span><button id="slow" aria-label="Quarter speed" aria-pressed="false">¼×</button><button id="normal" aria-label="Normal speed" aria-pressed="true">1×</button><button id="drop" title="B: drop the F ember from 2 metres">B <span>Drop ember</span></button><button id="grid" aria-label="Return to comparison grid">Grid <kbd>Esc</kbd></button><output id="status" role="status">Preparing the seas</output></footer>`;
if (frozen) document.body.classList.add('capture');
if (pairF) document.body.classList.add('pair-f');
const tiles = new Map<string, HTMLElement>(); host.querySelectorAll<HTMLElement>('.tile').forEach(tile => tiles.set(tile.dataset.tile!, tile));
const referenceTile = tiles.get('reference')!, referenceCanvas = referenceTile.querySelector('canvas')!, referenceContext = referenceCanvas.getContext('2d')!;
const referenceLabel = referenceTile.querySelector('.frame-index')!, referenceLabels = Array.from({ length: 121 }, (_, i) => `${String(i).padStart(3, '0')} / 120`);
let lastReferenceFrame = -1;
const playButton = document.querySelector<HTMLButtonElement>('#play')!, scrub = document.querySelector<HTMLInputElement>('#scrub')!, clock = document.querySelector<HTMLOutputElement>('#clock')!, status = document.querySelector<HTMLOutputElement>('#status')!;
const variants: Partial<Record<VariantId, LabVariant>> = {}, failures: Partial<Record<VariantId, string>> = {}, guis = new Map<VariantId, GUI>();
const liveVariants: LabVariant[] = [];
let focused: string | null = null, seeking = false, previous = performance.now(), queuedTime: number | undefined, seekChain = Promise.resolve();
const referenceFrames: HTMLImageElement[] = [];
const api: LabApi = {
  ready: false, time: initial, playing: !frozen, speed: 1, variants, failures,
  setTime(time) { if (!Number.isFinite(time)) return Promise.reject(new TypeError('Lab time must be finite')); api.playing = false; return enqueueSeek(time); },
  play() { if (frozen) return; api.playing = true; previous = performance.now(); updateControls(); },
  pause() { api.playing = false; updateControls(); },
  focus(id) { focusTile(id); },
  async setPreset(id, values) { const variant = variants[id]; if (!variant) throw new Error(`${id} unavailable`); const validated = parseLabPreset({ version: 1, variants: { [id]: values } }).variants[id]!; api.pause(); loading(id, 0, 'Applying sea state'); await variant.apply(validated); guis.get(id)?.controllersRecursive().forEach(controller => controller.updateDisplay()); finishLoading(id); await enqueueSeek(api.time); },
  preset() { const values: Partial<Record<VariantId, LabSettings>> = {}; for (const id of ['F', 'P', 'S'] as const) if (variants[id]) values[id] = { ...variants[id]!.parameters }; return { version: 1, variants: values }; },
};
window.__lab = api;
function loading(id: string, value: number, text: string): void { const tile = tiles.get(id)!, panel = tile.querySelector<HTMLElement>('.tile-loading')!; panel.hidden = false; panel.querySelector('span')!.textContent = text; panel.querySelector('progress')!.value = value; }
function finishLoading(id: string): void { tiles.get(id)!.querySelector<HTMLElement>('.tile-loading')!.hidden = true; }
function updateControls(): void { playButton.textContent = api.playing ? 'Ⅱ' : '▶'; playButton.setAttribute('aria-label', api.playing ? 'Pause all variants' : 'Play all variants'); scrub.value = String(wrapTime(api.time)); clock.value = wrapTime(api.time).toFixed(2); document.querySelector('#slow')!.setAttribute('aria-pressed', String(api.speed === .25)); document.querySelector('#normal')!.setAttribute('aria-pressed', String(api.speed === 1)); }
function contentSize(tile: HTMLElement): [number, number] { const width = tile.clientWidth, height = tile.clientHeight; return width / height > 16 / 9 ? [height * 16 / 9, height] : [width, width * 9 / 16]; }
function resize(): void {
  lastReferenceFrame = -1;
  for (const [id, tile] of tiles) { if (focused && focused !== id) continue; const [width, height] = contentSize(tile), slot = tile.querySelector<HTMLElement>('.canvas-slot')!; slot.style.width = `${width}px`; slot.style.height = `${height}px`;
    if (id === 'reference') { referenceCanvas.width = Math.round(width); referenceCanvas.height = Math.round(height); }
    else variants[id as VariantId]?.resize(width, height);
  }
  drawReference();
}
function focusTile(id: string | null): void { focused = id; document.body.classList.toggle('focused', !!id); for (const [key, tile] of tiles) { tile.classList.toggle('is-focused', key === id); tile.classList.toggle('is-away', !!id && key !== id); } resize(); if (id && id !== 'reference') variants[id as VariantId]?.canvas.focus(); status.value = id ? `${id === 'reference' ? 'Reference' : `Variant ${id}`} · Esc returns to grid` : 'Tap a tile to compare at full size'; }
function drawReference(): void { if (!referenceFrames.length || (focused && focused !== 'reference')) return; const index = Math.min(120, Math.floor(wrapTime(api.time) / .03 + 1e-7)); if (index === lastReferenceFrame) return; lastReferenceFrame = index; referenceContext.drawImage(referenceFrames[index], 0, 0, referenceCanvas.width, referenceCanvas.height); referenceLabel.textContent = referenceLabels[index]; }
async function enqueueSeek(time: number): Promise<void> {
  seekChain = seekChain.then(async () => { seeking = true; api.time = time; await Promise.all(Object.values(variants).map(variant => variant.seek(time))); drawReference(); updateControls(); seeking = false; });
  return seekChain;
}
async function initializeReference(): Promise<void> {
  const files = import.meta.glob<string>('../../output/reference/reference-*.png', { eager: true, query: '?url', import: 'default' });
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)); if (entries.length !== 121) throw new Error(`Expected existing 121 reference frames, found ${entries.length}`);
  let decoded = 0; await Promise.all(entries.map(async ([, url], i) => { const image = new Image(); image.src = url; await image.decode(); referenceFrames[i] = image; loading('reference', ++decoded / 121, 'Decoding the reference'); })); finishLoading('reference'); drawReference();
}
async function initializeVariant(id: VariantId, factory: () => LabVariant | Promise<LabVariant>): Promise<void> {
  try {
    const variant = await factory(); variants[id] = variant; const tile = tiles.get(id)!; tile.querySelector('.canvas-slot')!.appendChild(variant.canvas); resize();
    let expired = false, timer: number | undefined;
    const initialization = variant.initialize((fraction, text) => { if (!expired) loading(id, fraction, text); });
    try {
      await Promise.race([initialization, new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => { expired = true; reject(new Error(`${id} initialization exceeded 45 seconds; the GPU backend did not finish`)); }, 45_000);
      })]);
    } finally {
      window.clearTimeout(timer);
      if (expired) void initialization.then(() => variant.dispose(), () => {}).catch(() => {});
    }
    const gui = new GUI({ container: tile.querySelector<HTMLElement>('.gui-host')!, title: `${id} / ${variant.backend}`, width: 282 }); guis.set(id, gui);
    variant.controls(gui, () => { void api.setPreset(id, variant.parameters).catch(error => { status.value = String(error); }); });
    tile.querySelector('.backend-status')!.textContent = variant.backend; finishLoading(id);
    liveVariants.push(variant);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failures[id] = reason; delete variants[id];
    const tile = tiles.get(id);
    if (tile) {
      loading(id, 0, `${id} unavailable: ${reason}`);
      const prog = tile.querySelector<HTMLElement>('.tile-loading progress');
      if (prog) prog.hidden = true;
      tile.classList.add('failed');
      tile.querySelector('.backend-status')!.textContent = `UNAVAILABLE · ${reason.slice(0, 48)}`;
      if (id === 'P') { const image = new Image(); image.src = new URL('../../output/playwright/water-lab/poseidon-original/swell.png', import.meta.url).href; image.alt = 'Unmodified Poseidon demo at 18 m/s — capture, not a live port'; image.className = 'fallback-image'; tile.querySelector('.canvas-slot')!.appendChild(image); tile.querySelector('.backend-status')!.textContent = `UPSTREAM CAPTURE · ${reason.slice(0, 36)}`; }
    }
    console.error(`Water Lab ${id}:`, error);
  }
}
for (const [id, tile] of tiles) {
  tile.querySelector('.expand')!.addEventListener('click', () => focusTile(focused === id ? null : id));
  tile.querySelector('.tune')?.addEventListener('click', event => { event.stopPropagation(); const panel = tile.querySelector<HTMLElement>('.gui-host')!; panel.hidden = !panel.hidden; });
  tile.querySelector('.canvas-slot')!.addEventListener('click', event => {
    if (frozen) return;
    if (pairF && id === 'F') { const e = event as MouseEvent; variants.F?.tap?.(e.clientX, e.clientY); if (!api.playing) status.value = 'Press play to evolve the ripple'; return; }
    if (focused !== id) { focusTile(id); return; }
    if (id === 'F') { const e = event as MouseEvent; variants.F?.tap?.(e.clientX, e.clientY); if (!api.playing) status.value = 'Press play to evolve the ripple'; }
  });
}
playButton.addEventListener('click', () => api.playing ? api.pause() : api.play());
scrub.addEventListener('input', () => { const time = Number(scrub.value); api.pause(); queuedTime = time; });
document.querySelector('#slow')!.addEventListener('click', () => { api.speed = .25; updateControls(); }); document.querySelector('#normal')!.addEventListener('click', () => { api.speed = 1; updateControls(); });
document.querySelector('#grid')!.addEventListener('click', () => focusTile(null));
function dropEmber(): void { if (frozen || !variants.F?.ready) return; if (!pairF) focusTile('F'); variants.F.dropBall?.(); api.play(); status.value = 'F · 2 m drop into a GPU wave-equation surface'; }
document.querySelector('#drop')!.addEventListener('click', dropEmber);
window.addEventListener('keydown', event => { if (event.key === 'Escape') { focusTile(null); return; } if (frozen || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return; if (event.code === 'Space') { event.preventDefault(); api.playing ? api.pause() : api.play(); } if (event.key.toLowerCase() === 'b') dropEmber(); });
function download(content: string, filename: string): void { const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
document.querySelector('#save-preset')!.addEventListener('click', () => download(JSON.stringify(api.preset(), null, 2), 'floating-ocean-water-lab.json'));
const presetInput = document.querySelector<HTMLInputElement>('#preset-file')!;
document.querySelector('#load-preset')!.addEventListener('click', () => presetInput.click());
presetInput.addEventListener('change', async () => {
  const file = presetInput.files?.[0]; if (!file) return;
  try {
    const preset = parseLabPreset(JSON.parse(await file.text()));
    for (const id of ['F', 'P', 'S'] as const) { const settings = preset.variants[id]; if (settings && variants[id]) await api.setPreset(id, settings); }
    status.value = 'Preset loaded';
  } catch (error) { status.value = `Preset not loaded: ${String(error)}`; }
  finally { presetInput.value = ''; }
});
window.addEventListener('resize', resize);
resize();
await initializeReference();
// A focused URL initializes only that engine; P and S load only in the full grid.
if (!selected || selected === 'S') await initializeVariant('S', async () => { const { VariantS } = await import('./variant-s'); return new VariantS(); });
if (!selected || selected === 'F') await initializeVariant('F', () => new VariantF());
if (!selected || selected === 'P') await initializeVariant('P', async () => { const { createPoseidonVariant } = await import('./poseidon-adapter'); return createPoseidonVariant(); });
await enqueueSeek(initial); api.ready = true; updateControls();
if (selected && selected !== 'F' && ['P', 'S', 'reference'].includes(selected)) focusTile(selected);
status.value = Object.keys(failures).length ? 'Some backends unavailable; working variants remain live' : pairF ? 'Reference & Variant F · side by side' : 'Choose the water, not the implementation';
previous = performance.now(); let labelAt = previous;
function tick(now: number): void {
  const dt = Math.max(0, Math.min(.1, (now - previous) / 1000)); previous = now;
  if (queuedTime !== undefined && !seeking) { const target = queuedTime; queuedTime = undefined; void enqueueSeek(target); }
  if (api.playing && !seeking) { api.time += dt * api.speed; for (const variant of liveVariants) if (!focused || focused === variant.id) variant.frame(api.time, dt * api.speed); drawReference(); }
  if (now - labelAt > 100) { updateControls(); labelAt = now; }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
