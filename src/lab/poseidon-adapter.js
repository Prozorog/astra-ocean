// Lab-only adapter. Ocean/FFT/foam/material below are the MIT Poseidon modules,
// not the F implementation. See THIRD_PARTY_NOTICES.md and water-notes.md.
import { WebGPURenderer, Color, Group, Scene, PerspectiveCamera, PlaneGeometry, SphereGeometry, Mesh, MeshBasicNodeMaterial, QuadMesh, RenderTarget, StorageTexture, HalfFloatType, FloatType, LinearFilter, LinearSRGBColorSpace, NoToneMapping, Vector2, Vector3 } from 'three/webgpu';
import { Fn, uniform, vec2, vec3, vec4, float, uint, uvec2, instanceIndex, texture, textureStore, uv, cameraPosition, positionWorld, normalWorld, dot, cross, normalize, min, max, mix, pow, exp, length, smoothstep, floor, fract, step, sin, cos } from 'three/tsl';
import { Ocean } from './vendor/poseidon/Ocean.js';
import { validateFFT } from './vendor/poseidon/fft.js';
import { setLabLoopPeriod } from './vendor/poseidon/spectrum.js';
import { params as originalParams } from './vendor/poseidon/params.js';
import { createOceanSurfaceMaterial } from './vendor/poseidon/oceanSurfaceMaterial.js';
import { makeDetailTexture } from './vendor/poseidon/detailTexture.js';
import { HERO_DISTANCE, rigidTumble } from './presentation';
import { lipGeometry } from '../water/geometry';
import { LOOP, wrapTime } from '../water/time';

const METRES = 16, RADIUS = 20;
function copyTextureNode(source, target, N) {
  return Fn(() => { const x = instanceIndex.mod(uint(N)), y = instanceIndex.div(uint(N)); const p = uvec2(x, y); const coord = vec2(float(x).add(.5), float(y).add(.5)).div(N); textureStore(target, p, texture(source, coord).level(0)).toWriteOnly(); })().compute(N * N);
}
function outputMaterial(target, clock, resolution, diagnostic) {
  const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, toneMapped: false });
  material.colorNode = Fn(() => {
    const p = uv(), raw = texture(target.texture, p).rgb.toVar(); const q = p.sub(.5).mul(2);
    const vig = smoothstep(float(.35), float(1.6), length(q)).mul(.85);
    const warm = smoothstep(float(1.6), float(2.7), raw.r.div(max(raw.g, float(.0001))))
      .mul(smoothstep(float(.14), float(.21), raw.b.div(max(raw.r, float(.0001)))));
    const c = mix(raw, mix(raw.mul(.72), vec3(.48, .14, .13), warm), vig).toVar();
    const luminance = dot(c, vec3(.2126, .7152, .0722)).toVar();
    const low = min(c.r, min(c.g, c.b)); const offset = mix(float(.04), low.sub(low.mul(low).mul(6.25)), step(low, float(.08)));
    c.assign(max(c.sub(offset), vec3(0))); const peak = max(c.r, max(c.g, c.b));
    const mapped = mix(float(1).sub(float(.0576).div(max(peak.sub(.52), float(.00001)))), peak, step(peak, float(.76)));
    c.mulAssign(mapped.div(max(peak, float(1e-8))));
    const encoded = mix(c.mul(12.92), pow(max(c, vec3(0)), vec3(1 / 2.4)).mul(1.055).sub(.055), step(vec3(.0031308), c)).toVar();
    const seed = floor(clock.div(LOOP).mul(4096)); const pixel = floor(p.mul(resolution).div(1.5)).add(vec2(seed.mul(19), seed.mul(37)));
    const h = fract(vec3(pixel.x, pixel.y, pixel.x).mul(.1031)).toVar(); h.addAssign(dot(h, h.yzx.add(33.33))); const n = fract(h.x.add(h.y).mul(h.z)).sub(.5);
    encoded.mulAssign(float(1).add(n.mul(.09).mul(float(1).sub(smoothstep(float(.6), float(1), luminance)))));
    return mix(encoded, raw, diagnostic);
  })(); return material;
}
function emberMaterial(diagnostic) {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  material.colorNode = Fn(() => { const V = normalize(cameraPosition.sub(positionWorld)), right = normalize(cross(vec3(0, 1, 0), V)), up = cross(V, right);
    const p = vec2(dot(normalWorld, right), dot(normalWorld, up)); const hotP = p.sub(vec2(-.12, .12)); const hot = exp(dot(hotP, hotP).div(-.03));
    const body = mix(vec3(6.95, 1.8, .045), vec3(8, 4.8, .7), hot); const color = mix(body, vec3(.85, .112, .041), smoothstep(float(.91), float(1), length(p))); return mix(color, vec3(0), diagnostic);
  })(); return material;
}
class PoseidonVariant {
  id = 'P'; backend = 'WebGPU · Poseidon'; parameters = { wind: 18, chop: 2.7, foam: .5, foamDecay: 3.9 }; ready = false; frames = 0;
  renderer = new WebGPURenderer({ antialias: false, powerPreference: 'high-performance' }); scene = new Scene(); root = new Group();
  camera = new PerspectiveCamera(30, 16 / 9, .1 * METRES, 160 * METRES);
  time = 0; previousPhase = 0; width = 960; height = 540; intervals = new Float32Array(900); intervalCount = 0; intervalCursor = 0; previousDraw = 0;
  pending = false; sample = new Float32Array(4); diagnostic = uniform(0); clock = uniform(0); resolution = uniform(new Vector2(960, 540)); ballWorld = new Vector3();
  snapshotTextures = []; saveGroups = [[], []]; restoreGroup = []; clearGroup = [];
  frozenSeek = false; frozenStep = 0; frozenTime = 0;
  constructor() {
    this.renderer.setPixelRatio(1); this.renderer.outputColorSpace = LinearSRGBColorSpace; this.renderer.toneMapping = NoToneMapping; this.renderer.autoClear = false;
    this.canvas = this.renderer.domElement; this.canvas.tabIndex = 0; this.canvas.setAttribute('aria-label', 'Poseidon WebGPU water comparison');
    // Preserve the mature optical model's sea-level origin. Translating floor
    // and camera together is image-identical to the other tiles' y=4 sheet.
    this.root.position.y = 0; this.scene.add(this.root);
    const target = new Vector3(.35, -.7, -.15).multiplyScalar(METRES); this.camera.position.copy(new Vector3(10.9, 9.03, 11.2).normalize()).multiplyScalar(HERO_DISTANCE * METRES).add(target); this.camera.lookAt(target);
    this.target = new RenderTarget(960, 540, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter });
    this.probeTarget = new RenderTarget(3, 3, { type: FloatType, minFilter: LinearFilter, magFilter: LinearFilter });
    this.captureTarget = new RenderTarget(960, 540, { depthBuffer: false });
    this.floorColor = new Color('#ce7363').addScalar(.04);
    this.blackColor = new Color(0, 0, 0);
    this.floorMaterial = new MeshBasicNodeMaterial({ toneMapped: false }); this.floorMaterial.colorNode = vec3(this.floorColor.r, this.floorColor.g, this.floorColor.b).mul(float(1).sub(this.diagnostic));
    this.floor = new Mesh(new PlaneGeometry(32000, 32000), this.floorMaterial); this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -4 * METRES; this.scene.add(this.floor);
    this.ball = new Mesh(new SphereGeometry(RADIUS, 48, 32), emberMaterial(this.diagnostic)); this.root.add(this.ball);
    this.post = new QuadMesh(outputMaterial(this.target, this.clock, this.resolution, this.diagnostic));
  }
  configure() {
    this.params.local.windSpeed = this.parameters.wind; this.params.local.fetch = 30000; this.params.local.windDirection = 45; this.params.local.peakEnhancement = 3.3;
    this.params.swell.windDirection = 65; this.params.swell.windCoupling = 0; this.params.swell.peakEnhancement = 3.3;
    const peak = (u, f) => 22 * Math.pow(u * f / (9.81 * 9.81), -.33), alpha = (u, f) => .076 * Math.pow(9.81 * f / (u * u), -.22);
    // Convert the upstream eight-times-energy coefficient convention to the
    // same one-sided physical PSD as F; retain its spectrum shape and shader.
    this.params.local.scale = .6 * 2.5 * 2.5 / 8;
    this.params.swell.scale = .4 * 2.5 * 2.5 / 8 * alpha(this.parameters.wind, 30000) / alpha(14, 380000) * (peak(14, 380000) / peak(this.parameters.wind, 30000)) ** 4;
    this.params.lambda = this.parameters.chop; this.params.foamDecay = this.parameters.foamDecay;
  }
  async initialize(progress) {
    await this.renderer.init(); if (!this.renderer.backend.isWebGPUBackend) throw new Error('Poseidon requires a native WebGPU backend');
    this.renderer.backend.device.addEventListener('uncapturederror', event => console.error('P WebGPU:', event.error.message));
    this.adapter = { vendor: 'WebGPU', architecture: 'native' };
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }); if (adapter) this.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
    this.fftResult = await validateFFT(this.renderer, 256); if (!this.fftResult.pass) throw new Error(`Poseidon IFFT failed: ${JSON.stringify(this.fftResult)}`); progress(.08, 'Poseidon GPU FFT verified');
    this.params = structuredClone(originalParams); this.params.N = 256; this.params.lengthScales = [160, 37, 9]; this.params.boundaryFactor = 6; this.configure(); setLabLoopPeriod(LOOP * 2.8);
    this.ocean = new Ocean(this.renderer, this.params); await this.ocean.updateInitialSpectrum(); this.detail = makeDetailTexture();
    this.shading = { sunDir: uniform(new Vector3(-.75, 1.25, .6).normalize()), sunColor: uniform(new Color(.79, .90, 1)), horizon: uniform(new Color('#5d7c86')), zenith: uniform(new Color('#9fc6d8')), ambient: uniform(new Color('#8fa5ae')),
      deepColor: uniform(new Color(.008, .03, .032)), scatterColor: uniform(new Color(.04, .2, .2)), palette: uniform(.55), sssStrength: uniform(1), foamColor: uniform(new Color('#d6ecef')), foamThreshold: uniform(this.parameters.foam), foamScale: uniform(this.params.foamScale), foamBright: uniform(this.params.foamBright), foamRelief: uniform(this.params.foamRelief), foamMilk: uniform(this.params.foamMilk), detail: uniform(this.params.detailStrength), time: uniform(0), originXZ: uniform(new Vector2(0, 0)), hazeWater: uniform(0), hazeAir: uniform(0), specBoost: uniform(0), labBall: uniform(new Vector3(0, 0, 0)), labRadius: uniform(RADIUS), labDiagnostic: this.diagnostic };
    this.material = createOceanSurfaceMaterial(this.ocean.cascades, { lengthScales: this.params.lengthScales, shading: this.shading, detailTex: this.detail });
    this.water = new Mesh(new PlaneGeometry(160, 160, 256, 256), this.material); this.water.frustumCulled = false; this.root.add(this.water);
    const edge = lipGeometry(), position = edge.getAttribute('position'); for (let i = 0; i < position.count; i++) { const x = position.getX(i), y = position.getY(i), z = position.getZ(i); position.setXYZ(i, x * METRES, z * METRES, y * METRES); }
    const lip = new MeshBasicNodeMaterial({ toneMapped: false }); lip.positionNode = this.material.positionNode; lip.colorNode = vec3(.005, .014, .015).mul(float(1).sub(this.diagnostic)); this.lip = new Mesh(edge, lip); this.lip.frustumCulled = false; this.root.add(this.lip);
    // fragmentNode is essential: colorNode clamps signed data as if radiance.
    const probe = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, toneMapped: false }); probe.fragmentNode = vec4(this.material.positionNode, 1); this.probe = new QuadMesh(probe);
    for (const cascade of this.ocean.cascades) {
      const snapshot = new StorageTexture(256, 256); snapshot.type = HalfFloatType; snapshot.generateMipmaps = false; this.snapshotTextures.push(snapshot);
      this.saveGroups[0].push(copyTextureNode(cascade.history[0], snapshot, 256)); this.saveGroups[1].push(copyTextureNode(cascade.history[1], snapshot, 256));
      this.restoreGroup.push(copyTextureNode(snapshot, cascade.history[0], 256), copyTextureNode(snapshot, cascade.history[1], 256));
      this.clearGroup.push(Fn(() => { const index = uint(instanceIndex), point = uvec2(index.mod(256), index.div(256)); textureStore(cascade.history[0], point, vec4(0)); textureStore(cascade.history[1], point, vec4(0)); })().compute(256 * 256));
    }
    await this.warm(progress); this.ready = true; await this.seek(0); progress(1, 'Poseidon sheet ready');
  }
  async warm(progress = () => {}) {
    this.ocean.lambda.value = this.parameters.chop; this.ocean.foamDecay.value = this.parameters.foamDecay; this.shading.foamThreshold.value = this.parameters.foam;
    this.renderer.compute(this.clearGroup); this.ocean.frame = 0;
    for (let i = 1; i <= 242; i++) { this.ocean.evolve(wrapTime(i * LOOP / 121) * 2.8, LOOP * 2.8 / 121); if (i % 8 === 0) { progress(.1 + .85 * i / 242, 'Prewarming Poseidon whitecaps'); await new Promise(resolve => requestAnimationFrame(resolve)); } }
    this.renderer.compute(this.saveGroups[this.ocean.frame & 1]); await this.renderer.backend.device.queue.onSubmittedWorkDone();
    this.frozenSeek = false;
  }
  restore() { this.renderer.compute(this.restoreGroup); this.ocean.frame = 0; }
  async readSample() {
    if (this.pending) return; this.pending = true; const sampleTime = this.time; this.renderer.setRenderTarget(this.probeTarget); this.probe.render(this.renderer);
    try { const data = await this.renderer.readRenderTargetPixelsAsync(this.probeTarget, 0, 0, 3, 3); this.sample[0] = data[16]; this.sample[1] = data[17]; this.sample[2] = data[18]; this.sample[3] = sampleTime; } finally { this.pending = false; }
  }
  present(destination = null) {
    rigidTumble(this.root, this.time); this.ball.position.set(this.sample[0], this.sample[1] + RADIUS * .72, this.sample[2]); this.root.updateMatrixWorld(true); this.ball.getWorldPosition(this.ballWorld); this.shading.labBall.value.copy(this.ballWorld);
    this.shading.time.value = Math.sin(this.time / LOOP * Math.PI * 2) * (LOOP * 2.8 / (Math.PI * 2)); this.clock.value = this.time;
    this.scene.background = this.diagnostic.value ? this.blackColor : this.floorColor;
    this.renderer.setRenderTarget(this.target); this.renderer.setClearColor(this.scene.background, 1); this.renderer.clear(); this.renderer.render(this.scene, this.camera); this.renderer.setRenderTarget(destination); this.post.render(this.renderer);
    if (!this.diagnostic.value) { const now = performance.now(); if (this.previousDraw) { this.intervals[this.intervalCursor] = now - this.previousDraw; this.intervalCursor = (this.intervalCursor + 1) % this.intervals.length; this.intervalCount = Math.min(this.intervals.length, this.intervalCount + 1); } this.previousDraw = now; this.frames++; }
  }
  async seek(time) {
    this.time = wrapTime(time); const step = LOOP / 121, steps = Math.floor(this.time / step + 1e-7);
    const incremental = this.frozenSeek && this.time >= this.frozenTime && Math.abs(this.frozenTime - this.frozenStep * step) < 1e-8;
    if (!incremental) this.restore();
    for (let i = incremental ? this.frozenStep + 1 : 1; i <= steps; i++) this.ocean.evolve(i * step * 2.8, step * 2.8);
    const remainder = this.time - steps * step; this.ocean.evolve(this.time * 2.8, Math.max(0, remainder) * 2.8);
    while (this.pending) await new Promise(resolve => setTimeout(resolve, 0)); await this.readSample(); this.present(); this.previousPhase = this.time;
    this.frozenSeek = true; this.frozenStep = steps; this.frozenTime = this.time;
  }
  frame(time, dt) { if (!this.ready) return; this.frozenSeek = false; this.time = wrapTime(time); if (this.time < this.previousPhase) this.restore(); this.ocean.evolve(this.time * 2.8, Math.min(dt, .1) * 2.8); void this.readSample(); this.present(); this.previousPhase = this.time; }
  resize(width, height) { this.width = Math.max(1, Math.round(width)); this.height = Math.max(1, Math.round(height)); this.renderer.setSize(this.width, this.height, false); this.target.setSize(this.width, this.height); this.captureTarget.setSize(this.width, this.height); this.camera.aspect = this.width / this.height; this.camera.updateProjectionMatrix(); this.resolution.value.set(this.width, this.height); if (this.ready) this.present(); }
  controls(gui, changed) { gui.add(this.parameters, 'wind', 6, 25, .5).name('Wind · m/s').onFinishChange(changed); gui.add(this.parameters, 'chop', 0, 3, .05).name('Poseidon chop').onFinishChange(changed); gui.add(this.parameters, 'foam', .05, .8, .01).name('Foam threshold').onFinishChange(changed); gui.add(this.parameters, 'foamDecay', .5, 6, .1).name('Foam decay · s').onFinishChange(changed); }
  async apply(values) { for (const key of Object.keys(this.parameters)) if (typeof values[key] === 'number' && Number.isFinite(values[key])) this.parameters[key] = values[key]; this.ready = false; this.configure(); await this.ocean.updateInitialSpectrum(); await this.warm(); this.ready = true; await this.seek(this.time); }
  async pixels(diagnostic) {
    this.diagnostic.value = diagnostic ? 1 : 0; this.present(this.captureTarget);
    const pixels = await this.renderer.readRenderTargetPixelsAsync(this.captureTarget, 0, 0, this.width, this.height);
    this.diagnostic.value = 0; this.present(); return pixels;
  }
  async encode(pixels, type) {
    const canvas = new OffscreenCanvas(this.width, this.height), context = canvas.getContext('2d');
    const clamped = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    context.putImageData(new ImageData(clamped, this.width, this.height), 0, 0);
    const blob = await canvas.convertToBlob({ type, quality: .94 });
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('PNG encoding failed')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  }
  async mask() { return this.encode(await this.pixels(true), 'image/png'); }
  async capture(type = 'image/png') { return this.encode(await this.pixels(false), type); }
  async evidence() {
    let energy = 0;
    for (let cascade = 0; cascade < this.ocean.cascades.length; cascade++) { const packed = await this.ocean.readbackH0(cascade); for (let i = 0; i < packed.length; i += 4) energy += 2 * (packed[i] ** 2 + packed[i + 1] ** 2); }
    const fieldTarget = new RenderTarget(128, 128, { type: FloatType });
    const material = new MeshBasicNodeMaterial({ toneMapped: false }); material.fragmentNode = vec4(this.material.positionNode, 1);
    const mesh = new Mesh(new PlaneGeometry(160, 160), material), scene = new Scene(), camera = new PerspectiveCamera(90, 1, .1, 200); camera.position.z = 80; scene.add(mesh);
    this.renderer.setRenderTarget(fieldTarget); this.renderer.render(scene, camera);
    const field = await this.renderer.readRenderTargetPixelsAsync(fieldTarget, 0, 0, 128, 128); let low = Infinity, high = -Infinity; for (let i = 0; i < field.length; i += 4) { low = Math.min(low, field[i + 1]); high = Math.max(high, field[i + 1]); }
    fieldTarget.dispose(); mesh.geometry.dispose(); material.dispose();
    const pixels = await this.pixels(true); let water = 0, foam = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 240) { water++; if (pixels[i + 1] >= 128) foam++; }
    const center = this.ballWorld.clone().project(this.camera), right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0), edge = this.ballWorld.clone().addScaledVector(right, RADIUS).project(this.camera); const frameIntervals = []; for (let i = 0; i < this.intervalCount; i++) frameIntervals.push(this.intervals[(this.intervalCursor - this.intervalCount + i + this.intervals.length) % this.intervals.length]);
    return { id: this.id, backend: this.backend, parameters: { ...this.parameters }, ballScreen: [(center.x + 1) / 2, (1 - center.y) / 2], ballRadiusPixels: Math.abs(edge.x - center.x) * this.width / 2, ballWorld: this.ballWorld.toArray().map((v, i) => v / METRES + (i === 1 ? 4 : 0)), reliefPercent: (high - low) / 160 * 100, foamCoverage: water ? foam / water : 0,
      spectrum: { model: 'actual Poseidon WebGPU/TSL modules', N: 256, lengths: this.params.lengthScales, significantWaveHeightBeforeHero: 4 * Math.sqrt(energy) / 2.5, heightMeasurement: '128² full original vertex function, all cascades and amplitude envelope; signed float fragment output', loop: 'quantized spectrum; canonical foam reset; periodic shading drift', local: this.params.local, swell: this.params.swell }, buoyancy: { method: 'async GPU 3x3 evaluation of original vertex positionNode', samplePhase: this.sample[3] }, fft: this.fftResult, renderer: `${this.adapter.vendor} ${this.adapter.architecture} / native WebGPU`, frames: this.frames, frameIntervals };
  }
  dispose() { this.renderer.dispose(); this.target.dispose(); this.probeTarget.dispose(); this.captureTarget.dispose(); this.detail?.dispose(); this.snapshotTextures.forEach(texture => texture.dispose()); }
}
export function createPoseidonVariant() { return new PoseidonVariant(); }
