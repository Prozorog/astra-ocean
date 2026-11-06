import { LOOK_TILES, DEFAULT_CHOICES, readLookChoices, saveLookChoices } from './choices.js';

const root = '/output/playwright/pass8-round1-reflections/';
const main = document.querySelector('#main-player'), storm = document.querySelector('#storm-player');
const dialog = document.querySelector('#preview-dialog'), preview = document.querySelector('#preview-player');
const status = document.querySelector('#status'), playButton = document.querySelector('#play'), scrub = document.querySelector('#scrub');
const players = { main, storm }, tokens = { main: 0, storm: 0, preview: 0 }, records = [], visible = new Set(), flashes = new Map();
let choice = readLookChoices(), selected = choice.main, playing = true, hiddenPlaying = true, raf = 0;
let phase = 0, stamp = performance.now(), parked = false, loading = 0, returnFocus = null;
const wrap = t => ((t % 3.63) + 3.63) % 3.63;
const title = tile => `${tile.number} · ${tile.peakWaves} big wave${tile.peakWaves === 1 ? '' : 's'} · height ${tile.heightGain.toFixed(2)}×`;
const all = () => [main, storm, preview, ...records.map(r => r.video)];
const ready = video => video.readyState >= 2 ? Promise.resolve() : new Promise((resolve, reject) => {
  const done = event => { video.removeEventListener('loadeddata', done); video.removeEventListener('error', done); event.type === 'error' ? reject(new Error('A wave preview could not load.')) : resolve(); };
  video.addEventListener('loadeddata', done); video.addEventListener('error', done);
});
const safePlay = video => video.play().catch(error => { if (error.name !== 'AbortError') status.textContent = 'Press Play to start the previews.'; });
// Hold the Main clock during a source swap, then resume at the same phase.
// Off-screen behind a dialog, carry its phase until Main can rejoin playback.
function time() { return !playing || loading ? phase : parked ? wrap(phase + (performance.now() - stamp) / 1000) : wrap(main.currentTime); }
function remember(t = time()) { phase = wrap(t); stamp = performance.now(); return phase; }
function active() {
  const pair = [main, storm].filter(video => !dialog.open || visible.has(video));
  return [...pair, ...(dialog.open ? [preview] : records.filter(r => visible.has(r.video)).map(r => r.video))];
}
function playback(t = time()) {
  const shouldPark = dialog.open && !visible.has(main);
  if (parked !== shouldPark) { remember(t); parked = shouldPark; if (!parked && main.readyState >= 1) main.currentTime = t; }
  const allowed = new Set(active()), jobs = [];
  for (const video of all()) {
    if (!playing || loading || document.hidden || !allowed.has(video)) video.pause();
    else if (video.paused && video.getAttribute('src')) { if (video.readyState >= 1 && Math.abs(video.currentTime - t) > .01) video.currentTime = t; jobs.push(safePlay(video)); }
  }
  return Promise.all(jobs);
}
function badges() {
  for (const record of records) {
    record.badges.replaceChildren();
    for (const role of ['main', 'storm']) {
      const on = choice[role] === record.number; record[role].setAttribute('aria-pressed', String(on));
      if (on) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = role.toUpperCase(); record.badges.append(badge); }
    }
  }
}
function flash(role) {
  const figure = document.querySelector(`#${role}-choice`);
  clearTimeout(flashes.get(role)); figure.classList.remove('assigned'); void figure.offsetWidth; figure.classList.add('assigned');
  flashes.set(role, setTimeout(() => figure.classList.remove('assigned'), 600));
}
async function setPlayer(role, number) {
  const video = players[role], tile = LOOK_TILES[number - 1];
  document.querySelector(`#${role}-label`).textContent = title(tile);
  if (video.dataset.tile === String(number)) return;
  const ticket = ++tokens[role], t = remember(); ++loading;
  all().forEach(clip => clip.pause());
  video.dataset.tile = String(number); video.poster = `${root}tile-${number}/still.png`; video.src = `${root}tile-${number}/loop.webm`;
  try {
    await ready(video); if (ticket !== tokens[role]) return;
    if (Math.abs(video.currentTime - phase) > .001) {
      video.currentTime = phase;
    }
  } finally { --loading; if (!loading) { remember(phase); await playback(phase); } }
}
async function renderAssignments(roles = []) { badges(); roles.forEach(flash); await Promise.all(['main', 'storm'].map(role => setPlayer(role, choice[role]))); }
async function assign(role, number) {
  if (!players[role] || !LOOK_TILES[number - 1]) return;
  const next = { ...choice, [role]: number };
  if (saveLookChoices(next)) { choice = next; status.textContent = `${role === 'main' ? 'Main' : 'Storm'} look saved as tile ${number}.`; }
  else { choice = { ...DEFAULT_CHOICES }; status.textContent = 'Settings cannot be saved in this browser. The ocean will use the defaults.'; }
  await renderAssignments([role]);
}
const showError = error => { status.textContent = String(error.message ?? error); };
for (const tile of LOOK_TILES) {
  const article = document.createElement('article'); article.className = 'tile'; article.dataset.tile = String(tile.number);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'preview'; button.setAttribute('aria-label', `Preview tile ${tile.number}`);
  const video = document.createElement('video'); video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'metadata'; video.poster = `${root}tile-${tile.number}/still.png`; video.src = `${root}tile-${tile.number}/loop.webm`;
  const head = document.createElement('div'); head.className = 'tile-head';
  const number = document.createElement('span'); number.className = 'number'; number.textContent = String(tile.number);
  const heading = document.createElement('strong'); heading.textContent = `${tile.peakWaves} big wave${tile.peakWaves === 1 ? '' : 's'}`;
  const tags = document.createElement('div'); tags.className = 'badges'; head.append(number, heading, tags);
  const detail = document.createElement('span'); detail.className = 'detail'; detail.textContent = `height ${tile.heightGain.toFixed(2)}× · preview ↗`;
  button.append(video, head, detail); article.append(button);
  const assignments = document.createElement('div'); assignments.className = 'assignments'; const record = { number: tile.number, video, article, button, badges: tags };
  for (const role of ['main', 'storm']) {
    const control = document.createElement('button'); control.type = 'button'; control.textContent = role === 'main' ? 'Main look' : 'Storm look'; control.dataset.role = role;
    control.addEventListener('click', () => { void assign(role, tile.number).catch(showError); }); record[role] = control; assignments.append(control);
  }
  article.append(assignments); document.querySelector('#tiles').append(article); records.push(record);
  button.addEventListener('click', () => { void openPreview(tile.number).catch(showError); });
}
async function openPreview(number) {
  const tile = LOOK_TILES[number - 1]; if (!tile) return;
  const t = remember(), ticket = ++tokens.preview; selected = number; returnFocus = records[number - 1].button;
  document.querySelector('#preview-title').textContent = title(tile);
  records.forEach(r => r.article.classList.toggle('selected', r.number === number));
  if (preview.dataset.tile !== String(number)) { preview.dataset.tile = String(number); preview.poster = `${root}tile-${number}/still.png`; preview.src = `${root}tile-${number}/loop.webm`; }
  if (!dialog.open) dialog.showModal();
  void playback(t); await ready(preview); if (ticket !== tokens.preview || !dialog.open) return;
  preview.currentTime = time(); await playback();
}
function closePreview() {
  if (!dialog.open) return;
  const t = remember(); ++tokens.preview; dialog.close(); preview.pause(); void playback(t);
  returnFocus?.focus({ preventScroll: true });
}
dialog.addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
dialog.querySelector('.close-preview').addEventListener('click', closePreview);
dialog.querySelectorAll('[data-use]').forEach(button => button.addEventListener('click', () => { const update = assign(button.dataset.use, selected); closePreview(); void update.catch(showError); }));
function pause() { remember(); playing = false; all().forEach(video => video.pause()); playButton.textContent = 'Play all'; }
async function play() { const t = time(); remember(t); playing = true; await playback(t); playButton.textContent = playing ? 'Pause all' : 'Play all'; schedule(); }
function seek(seconds) { const t = remember(seconds); for (const video of all()) if (video.readyState >= 1) video.currentTime = t; updateClock(t); }
const observer = new IntersectionObserver(entries => {
  const t = time(); for (const entry of entries) { if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target); }
  void playback(t);
}, { threshold: .01 });
[main, storm, ...records.map(r => r.video)].forEach(video => {
  observer.observe(video);
});
records.forEach(({ video }) => video.addEventListener('loadeddata', () => {
  if (active().includes(video)) { video.currentTime = time(); void playback(); }
}, { once: true }));
function updateClock(t = time()) { if (document.activeElement !== scrub) scrub.value = String(t); document.querySelector('#clock').value = `${t.toFixed(2)} / 3.63 s`; }
function tick() {
  raf = 0; if (document.hidden) return;
  const t = time();
  if (playing && !loading) for (const video of active()) {
    if (video === main && !parked) continue;
    const d = Math.abs(video.currentTime - t);
    if (video.readyState >= 2 && !video.seeking && Math.min(d, Math.abs(3.63 - d)) > .03) video.currentTime = t;
  }
  updateClock(t); schedule();
}
function schedule() { if (!raf && !document.hidden) raf = requestAnimationFrame(tick); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenPlaying = playing; pause(); if (raf) cancelAnimationFrame(raf); raf = 0; }
  else { if (hiddenPlaying) void play(); schedule(); }
});
playButton.addEventListener('click', () => { if (playing) pause(); else void play(); });
document.querySelector('#restart').addEventListener('click', () => seek(0));
let resume = false;
scrub.addEventListener('pointerdown', () => { resume = playing; pause(); });
scrub.addEventListener('input', () => seek(Number(scrub.value)));
scrub.addEventListener('change', () => { if (resume) { resume = false; void play(); } });
document.querySelector('#reset-looks').addEventListener('click', () => {
  status.textContent = saveLookChoices(DEFAULT_CHOICES) ? 'Defaults restored: Main 5 · Storm 3.' : 'The ocean will use the defaults.';
  choice = { ...DEFAULT_CHOICES }; void renderAssignments(['main', 'storm']).catch(showError);
});
window.__settings = { ready: false, assign, select: openPreview, openPreview, closePreview, seek, play, pause,
  get choice() { return { ...choice }; }, get selected() { return selected; },
  clips: () => records.map(r => ({ number: r.number, paused: r.video.paused, visible: visible.has(r.video), time: r.video.currentTime })) };
await renderAssignments(); await play(); window.__settings.ready = true; status.textContent = `Main ${choice.main} · Storm ${choice.storm}`;
