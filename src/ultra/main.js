import '../style.css';
import * as THREE from 'three';
import GUI from 'lil-gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ChunkPresentation } from './presentation.js';
import { wrap, CHUNK_DEFAULTS } from './settings.js';
import { PreviewShell } from '../preview';
import { PreviewCapture } from '../capture';
import { OceanInteractions } from '../interactions';
import { BuoyancyTrack } from '../buoyancy';
import { OceanSound } from '../sound';
import { MOODS, MOOD_NAMES } from '../moods';
import { settings as siteSettings } from '../waves';
import { readLookChoices, lookForTile } from './choices.js';

const query = new URLSearchParams(location.search), frozen = query.get('freeze') === '1', hide = frozen || query.get('ui') === '0';
const choices = readLookChoices();
const ui = new PreviewShell(hide), view = new ChunkPresentation(lookForTile(choices.main)), r = view.renderer;
view.simulation.stormSettings = lookForTile(choices.storm);
window.__ready = false; document.querySelector('#app').appendChild(r.domElement);
if (frozen) r.domElement.classList.add('is-capture');
r.domElement.tabIndex = 0; r.domElement.setAttribute('aria-label', 'Floating Ultra-Water ocean');
let time = Number(query.get('t') ?? 0), paused = frozen, seeking = false, capture, last = performance.now(), rendered = 0;
const frameTimes = [], controls = new OrbitControls(view.camera, r.domElement), audio = new OceanSound();
controls.target.copy(view.cameraTarget); controls.enableDamping = true; controls.dampingFactor = .075;
controls.enablePan = false; controls.enableZoom = false; controls.minPolarAngle = Math.PI * .16; controls.maxPolarAngle = Math.PI * .42;
const track = new BuoyancyTrack(view.access.ocean, innerWidth / innerHeight), impacts = Array.from({ length: 6 }, () => new THREE.Vector4());
const events = [], zero = new THREE.Vector3(), base = new THREE.Vector3(), normal = new THREE.Vector3(), target = new THREE.Vector3();
let nextEvent = 0, storm = 1, stormTarget = 1, mood = 'Coral';
let dirty = true, rippleUntil = 0;
controls.addEventListener('change', () => { dirty = true; });
const splashBridge = {
  emit(point, normal, count, speed, wall) {
    const local = point.clone().applyMatrix4(view.root.matrixWorld.clone().invert()), m = view.settings.sheetSize / 10, slot = nextEvent++ % 8;
    events[slot] = { wall, amplitude: Math.min(.35, Math.max(.1, speed * .04)) * m };
    view.surface.uniforms.uImpact.value[slot].set(local.x * m, local.z * m, 0, events[slot].amplitude);
    view.surface.uniforms.uImpactSize.value[slot] = .575 * m;
  },
  reset() { events.length = 0; nextEvent = 0; view.surface.uniforms.uImpact.value.forEach(e => e.set(0, 0, 0, 0)); },
  countAt(wall) { return events.filter(e => wall - e.wall < 1.6).length * 160; },
};
function setStorm(value, instant = false) {
  stormTarget = THREE.MathUtils.clamp(value, .25, 1.375);
  if (Math.abs(stormTarget - 1) < 1e-8) stormTarget = 1;
  ui.setStorm(stormTarget); dirty = true;
  if (instant) { storm = stormTarget; view.simulation.setStorm(storm); }
}
const effects = new OceanInteractions({ canvas: r.domElement, camera: view.camera, root: view.root, ball: view.ball, controls,
  impacts, surface: view.access, floating: track, radius: .575, time: () => time,
  blocked: () => !window.__ready || frozen || seeking || !!capture?.recording,
  changed() { dirty = true; rippleUntil = performance.now() / 1000 + 12; }, interacted: () => ui.interacted(), storm: delta => setStorm(stormTarget + delta), splashAudio: speed => audio.splash(speed),
}, splashBridge);
view.tilt = effects.tilt;
function resize() {
  dirty = true;
  view.resize(innerWidth, innerHeight); track.setAspect(innerWidth / innerHeight);
  const distance = 22 * Math.max(1, (16 / 9) / (innerWidth / innerHeight));
  view.camera.position.sub(controls.target).normalize().multiplyScalar(distance).add(controls.target); controls.update();
}
window.addEventListener('resize', resize); resize();
async function setTime(seconds) {
  paused = true; seeking = true; window.__ready = false;
  try { effects.reset(); time = wrap(seconds); await view.seek(time); }
  finally { seeking = false; window.__ready = true; dirty = true; }
}
async function apply(values) {
  seeking = true; window.__ready = false;
  try { effects.reset(); await view.apply(values, value => ui.brewing(value)); time = 0; storm = stormTarget = 1; ui.setStorm(1); dirty = true; }
  finally { seeking = false; window.__ready = true; last = performance.now(); }
}
const gui = new GUI({ title: 'Ultra-Water · floating chunk' }); gui.hide();
gui.onChange(() => { dirty = true; });
const waves = gui.addFolder('Waves');
waves.add(view.settings, 'peakWaves', .75, 3.5, .05).name('Big waves across sheet').onFinishChange(() => apply(view.settings));
waves.add(view.settings, 'heightGain', .4, 1.8, .02).name('Coherent height gain').onFinishChange(() => apply(view.settings));
waves.add(view.settings, 'alignment', 0, 1, .02).name('Alignment / collision').onFinishChange(() => apply(view.settings));
waves.add(view.settings, 'tau', .5, 2.5, .05).name('Pace τ').onFinishChange(() => apply(view.settings));
waves.add(view.settings, 'choppiness', .5, 1.5, .05).onFinishChange(() => apply(view.settings));
const foam = gui.addFolder('Foam');
foam.add(view.settings, 'foamBias', -.3, .5, .02); foam.add(view.settings, 'foamScale', .5, 2, .05);
foam.add(view.settings, 'billow', 0, 1, .05); foam.add(view.settings, 'spray', 0, 1, .05);
const film = gui.addFolder('Cinematic softness');
film.add(view.settings, 'motionBlur'); film.add(view.settings, 'shutter', 0, 1, .05).name('Shutter · frames at 30 fps');
film.add(view.settings, 'depthOfField'); film.add(view.settings, 'aperture', 0, .8, .02).name('Depth of field strength');
film.add(view.settings, 'grain'); film.add(view.settings, 'grainStrength', 0, .06, .002).name('Film grain strength');
film.close(); foam.close();
capture = new PreviewCapture(r, view.post, async () => {
  const before = paused; seeking = true;
  try { await view.simulation.ensureCanonicalCache(); }
  finally { seeking = false; }
  view.deterministicPlayback = true; paused = false; last = performance.now(); dirty = true;
  return async () => { view.deterministicPlayback = false; paused = before; last = performance.now(); dirty = true; };
}, () => siteSettings.timeScale, message => ui.message(message));
function setMood(name) {
  dirty = true;
  mood = name; const palette = MOODS[name];
  view.floorColor.setRGB(palette.floor.x, palette.floor.y, palette.floor.z); view.floor.material.color.copy(view.floorColor);
  for (const key of ['Body', 'Hot', 'Rim', 'Fringe']) view.ball.material.uniforms['u' + key].value.copy(palette[key.toLowerCase()]);
  ui.setMood(name);
}
function resetView() {
  dirty = true;
  controls.target.copy(view.cameraTarget); const direction = new THREE.Vector3(10.9, 0, 11.2).normalize(); direction.y = Math.tan(Math.PI / 6); direction.normalize();
  view.camera.position.copy(direction).multiplyScalar(22 * Math.max(1, (16 / 9) / view.camera.aspect)).add(controls.target); controls.update();
  effects.reset(); view.simulation.interaction.reset(); rippleUntil = 0;
}
ui.bind({ play() { paused = !paused; ui.setPlaying(!paused); last = performance.now(); },
  speed(value) { siteSettings.timeScale = value; ui.setSpeed(value); }, storm: setStorm, mood: setMood,
  sound: () => audio.toggle(), snapshot: () => capture.snapshot(), record: () => capture.record(), reset: resetView,
  settings: () => { location.href = '/settings.html'; } });
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || frozen) return;
  if (event.code === 'Space') { event.preventDefault(); paused = !paused; ui.setPlaying(!paused); }
  else if (event.key.toLowerCase() === 'h') gui.show(gui._hidden);
  else if (event.key.toLowerCase() === 'r') resetView();
  else if (event.key.toLowerCase() === 'g') location.href = '/settings.html';
  else if (event.key.toLowerCase() === 'b') { effects.intro(view.ball.position, performance.now() / 1000); }
  else if (event.key === '[' || event.key === ']') setStorm(stormTarget + (event.key === '[' ? -.075 : .075));
  else if (['1', '2', '3'].includes(event.key)) { siteSettings.timeScale = [.25, .5, 1][Number(event.key) - 1]; ui.setSpeed(siteSettings.timeScale); }
  else if (event.key.toLowerCase() === 'm') setMood(MOOD_NAMES[(MOOD_NAMES.indexOf(mood) + 1) % MOOD_NAMES.length]);
  else if (event.key.toLowerCase() === 's') void audio.toggle().then(v => ui.setSound(v));
  else if (event.key.toLowerCase() === 'p') void capture.snapshot();
  else if (event.key.toLowerCase() === 'l') void capture.record();
});
const api = {
  view, renderer: r, scene: view.scene, camera: view.camera, sheetRoot: view.root, top: view.top, ball: view.ball,
  floor: view.floor, surface: view.access, water: view.access.ocean, effects, controls, capture, ui, post: view.post,
  settings: view.settings, ready: false, setTime, setStorm, resetView, apply, audio, track, impacts, choices,
  get paused() { return paused; }, get renderedFrames() { return rendered; },
  play() { paused = false; ui.setPlaying(true); last = performance.now(); }, pause() { paused = true; ui.setPlaying(false); },
  resize: (w, h) => view.resize(w, h),
  async advance(seconds, dt) { paused = true; time = wrap(seconds); view.frame(time, dt); await view.access.read(true); view.updateBallMetadata(); view.draw(); },
  evidence() { return { ...view.evidence(), interaction: effects.inspect(performance.now() / 1000), storm, stormTarget,
    frameTimes: [...frameTimes], renderedFrames: rendered, mood, speed: siteSettings.timeScale,
    renderer: r.getContext().getParameter(r.getContext().getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? r.getContext().RENDERER) }; },
};
window.__chunk = api; window.__ocean = api; window.__setTime = setTime; window.__play = api.play; window.__evidence = api.evidence;
try {
  await view.initialize(value => ui.brewing(value), time);
  r.domElement.classList.add('is-visible'); ui.reveal(); ui.setPlaying(!paused); ui.setStorm(1);
  api.ready = window.__ready = true; last = performance.now();
  // The second periodic foam cache never delays the first revealed ocean frame.
  void view.simulation.buildStorm().then(() => { dirty = true; }).catch(error => { console.error(error); ui.message('Storm foam could not be cached. Live foam remains active.'); });
  r.setAnimationLoop(() => {
    const now = performance.now(), wall = now / 1000;
    ui.tick(wall, capture.recording, capture.progress);
    if (seeking || frozen) { last = now; return; }
    if (!view.canSubmit()) return;
    const elapsed = Math.max(0, (now - last) / 1000), dt = Math.min(.05, elapsed); last = now;
    if (!paused) time = wrap(time + elapsed * siteSettings.timeScale);
    const cameraMoved = controls.update(); effects.advance(dt, wall);
    if (effects.active) rippleUntil = wall + 12;
    const morphing = Math.abs(stormTarget - storm) > 1e-6;
    const settling = view.simulation.replayWeight < 1 || (storm === 1.375 && view.simulation.storm?.ready && view.simulation.anchor !== 'storm');
    if (paused && !dirty && !cameraMoved && !effects.active && !morphing && wall > rippleUntil && !settling && !capture.recording) return;
    view.motionDirty = !!cameraMoved || effects.active || wall < rippleUntil;
    storm += (stormTarget - storm) * (1 - Math.exp(-dt / .2));
    if (Math.abs(stormTarget - storm) < 1e-6) storm = stormTarget;
    view.simulation.setStorm(storm);
    view.frame(time, dt);
    track.sample(time, base, target, normal); effects.updateBall(paused ? 0 : dt, wall, base, normal, dt);
    view.offset.copy(effects.gpuOffset); view.updateBallMetadata();
    if (effects.mode === 'held' || effects.mode === 'flying') {
      const m = view.settings.sheetSize / 10, waterHeight = view.access.samples[1].y;
      view.simulation.interaction.sphere(effects.position.x * m, effects.position.z * m, (effects.position.y - waterHeight) * m);
    }
    for (let i = 0; i < events.length; i++) {
      const event = events[i], e = view.surface.uniforms.uImpact.value[i];
      if (!event) continue;
      e.z = wall - event.wall; e.w = e.z < 3 ? event.amplitude : 0;
    }
    view.draw(); view.didSubmit(); audio.update(time / 3.63 * Math.PI * 2, storm);
    dirty = false; rendered++; frameTimes.push(elapsed * 1000); if (frameTimes.length > 900) frameTimes.shift();
  });
} catch (error) { ui.loader.textContent = String(error); console.error(error); throw error; }
