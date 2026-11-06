import * as THREE from 'three';
import { OceanSim, CASCADE_LENGTHS, defaultOceanParams } from '../vendor/ultra-water/water/OceanSim.js';
import { FullscreenQuad, rawPass } from '../vendor/ultra-water/engine/fullscreen.js';
import { Heightfield } from '../water/heightfield';
import { ComputePass } from '../water/gpu-fft';
import { PERIOD, FRAME_COUNT, wrap } from './settings.js';
import { yieldFrame } from './scheduling.js';
import { loadPeriodicCache } from './cache.js';

export class ChunkSimulation {
  constructor(renderer, settings) {
    this.renderer = renderer; this.settings = settings;
    const largest = settings.sheetSize * 1.2;
    this.lengths = CASCADE_LENGTHS.map(length => length / CASCADE_LENGTHS[0] * largest);
    this.sim = new OceanSim(renderer, defaultOceanParams(), this.lengths);
    this.pass = new ComputePass(renderer);
    this.interaction = new Heightfield(this.pass, settings.sheetSize, .575 * settings.sheetSize / 10);
    this.history = new THREE.WebGLArrayRenderTarget(256, 256, FRAME_COUNT, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    });
    this.sprayHistory = new THREE.WebGLArrayRenderTarget(32, 32, FRAME_COUNT, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.copy = rawPass(`precision highp float;uniform sampler2D d0,d1,d2,d3;in vec2 vUv;out vec4 c;
      void main(){c=vec4(texture(d0,vUv).w,texture(d1,vUv).w,texture(d2,vUv).w,texture(d3,vUv).w);}`,
      Object.fromEntries([0, 1, 2, 3].map(i => ['d' + i, { value: null }])));
    this.sprayCopy = rawPass(`precision highp float;uniform sampler2D d0,d1,d2;uniform vec4 lengths;uniform float size;in vec2 vUv;out vec4 c;
      void main(){vec2 q=(vUv-.5)*size;vec4 a=texture(d0,q/lengths.x),b=texture(d1,q/lengths.y),d=texture(d2,q/lengths.z);
      c=vec4(a.xyz+b.xyz+d.xyz,a.w+b.w+d.w-2.);}`,
      { d0: { value: null }, d1: { value: null }, d2: { value: null }, lengths: { value: new THREE.Vector4(...this.lengths) }, size: { value: settings.sheetSize } });
    this.quad = new FullscreenQuad(this.copy);
    this.previous = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(256, 256, {
      type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
    }));
    this.previousRipple = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.copyDisplacement = rawPass('precision highp float;uniform sampler2D source;in vec2 vUv;out vec4 c;void main(){c=texture(source,vUv);}', { source: { value: null } });
    this.ready = false; this.time = 0;
    this.morph = 0; this.lowScale = 1; this.anchor = 'main'; this.anchorWeight = 1;
    this.stormSettings = { ...settings, peakWaves: 1, heightGain: 1.35 };
  }
  configure(storm = 1, look = this.settings) {
    const p = this.sim.params, s = look;
    Object.assign(p, { windSpeed: 25, sheetSize: s.sheetSize, peakWaves: s.peakWaves,
      spreadBlend: .2 + .8 * s.alignment, windSwell: .1 + .9 * s.alignment,
      swellSwell: .1 + .9 * s.alignment, opposingDamping: s.opposingDamping * (1.2 - .8 * s.alignment),
      timeScale: s.tau, choppiness: s.choppiness, heightGain: s.heightGain * storm,
      foamRecovery: s.foamRecovery });
    p.waveScale = 1; // The selected upstream sea state's spectrum density is retained.
    this.sim.initMat.uniforms.uSeed.value = s.seed;
    this.sim.dirty = true;
  }
  evolve(time, dt = 0, replay = this.ready) {
    const t = wrap(time), a = this.sim.assembleMat.uniforms;
    a.uReplayFoam.value = replay; a.uFoamHistory.value = (this.replayCache?.history ?? this.history).texture;
    a.uFoamReplayWeight.value = this.replayWeight ?? 1;
    a.uFoamFrame.value = t / .03;
    this.sim.time = t - dt; this.sim.update(dt); this.time = t;
  }
  async initialize(progress = () => {}, background = false, useCache = true) {
    this.ready = false; this.configure();
    this.replayCache = null; this.replayWeight = 1;
    if (useCache && await loadPeriodicCache(this, progress, background)) {
      this.ready = true; this.evolve(0); progress(1); return;
    }
    let budget = performance.now(), previous = null, frameZeroReady = false;
    this.brewing = { warmCycles: 0, frameZeroMaxDiff: [], steps: 0 };
    const yieldBudget = async fraction => {
      this.brewing.steps++; progress(fraction);
      if (background || performance.now() - budget >= 8) { await yieldFrame(); budget = performance.now(); }
    };
    const diagnostic = new THREE.WebGLRenderTarget(256, 256, { type: THREE.FloatType, depthBuffer: false });
    // Reuse the upstream min(J, previous + recovery*dt/max(J,.5)) recurrence.
    // Repeated full periods remove initial-state dependence; no new foam model.
    warmup: for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < FRAME_COUNT; i++) {
        this.evolve(i * .03, .03, false);
        if (i === 0) {
          for (let c = 0; c < 4; c++) this.copy.uniforms['d' + c].value = this.sim.displacement[c];
          this.quad.material = this.copy; this.quad.render(this.renderer, diagnostic);
          const pixels = new Float32Array(256 * 256 * 4);
          await this.renderer.readRenderTargetPixelsAsync(diagnostic, 0, 0, 256, 256, pixels);
          let max = Infinity;
          if (previous) { max = 0; for (let j = 0; j < pixels.length; j++) max = Math.max(max, Math.abs(pixels[j] - previous[j])); }
          this.brewing.frameZeroMaxDiff.push(Number.isFinite(max) ? max : null); previous = pixels;
          if (cycle > 0 && max <= 1e-3) { frameZeroReady = true; break warmup; }
        }
        await yieldBudget((cycle * FRAME_COUNT + i) / (4 * FRAME_COUNT));
      }
      this.brewing.warmCycles++;
    }
    diagnostic.dispose();
    for (let i = 0; i < FRAME_COUNT; i++) {
      if (i !== 0 || !frameZeroReady) this.evolve(i * .03, .03, false);
      for (let c = 0; c < 4; c++) this.copy.uniforms['d' + c].value = this.sim.displacement[c];
      this.quad.material = this.copy; this.renderer.setRenderTarget(this.history, i); this.renderer.render(this.quad.mesh, this.pass.camera);
      for (let c = 0; c < 3; c++) this.sprayCopy.uniforms['d' + c].value = this.sim.displacement[c];
      this.quad.material = this.sprayCopy; this.renderer.setRenderTarget(this.sprayHistory, i); this.renderer.render(this.quad.mesh, this.pass.camera);
      await yieldBudget((3 * FRAME_COUNT + i) / (4 * FRAME_COUNT));
    }
    this.renderer.setRenderTarget(null); this.ready = true; this.evolve(0); progress(1);
  }
  prepareStormSpectrum() {
    const sim = this.sim, main = sim.h0RT, parameters = { ...sim.params };
    const h0 = main.clone(); sim.h0RT = h0;
    this.configure(1, this.stormSettings); sim.updateSpectrum();
    const peakOmega = sim.initMat.uniforms.uSpecB.value[0].y;
    sim.h0RT = main; Object.assign(sim.params, parameters); sim.updateSpectrum();
    sim.evolveMat.uniforms.uH0Storm.value = h0.texture;
    this.mainPeakOmega = sim.initMat.uniforms.uSpecB.value[0].y;
    this.storm = { h0, peakOmega, settings: { ...this.stormSettings }, ready: false };
  }
  buildStorm() {
    if (this.stormPromise) return this.stormPromise;
    this.stormPromise = (async () => {
      await yieldFrame();
      const builder = new ChunkSimulation(this.renderer, { ...this.stormSettings });
      builder.sim.h0RT.dispose(); builder.sim.h0RT = this.storm.h0;
      builder.sim.evolveMat.uniforms.uH0.value = this.storm.h0.texture;
      await builder.initialize(() => {}, true);
      Object.assign(this.storm, { history: builder.history, sprayHistory: builder.sprayHistory, brewing: builder.brewing, ready: true });
      builder.dispose(new Set([this.storm.h0, builder.history, builder.sprayHistory]));
      return this.storm;
    })();
    return this.stormPromise;
  }
  setStorm(value) {
    this.lowScale = Math.min(1, value);
    this.morph = THREE.MathUtils.clamp((value - 1) / .375, 0, 1);
    const s = this.morph, gain = THREE.MathUtils.lerp(this.settings.heightGain, this.stormSettings.heightGain, s);
    this.sim.params.heightGain = value < 1 ? this.settings.heightGain * value : gain;
    this.sim.evolveMat.uniforms.uSpectrumBlend.value = s;
    this.sim.displayPeakOmega = THREE.MathUtils.lerp(this.mainPeakOmega ?? 1, this.storm?.peakOmega ?? 1, s);
  }
  prepareReplay(canonical, dt) {
    let key = '', cache = null;
    if (this.morph === 0 && this.lowScale === 1) { key = 'main'; cache = { history: this.history, sprayHistory: this.sprayHistory }; }
    else if (this.morph === 1 && this.storm?.ready) { key = 'storm'; cache = this.storm; }
    else if (canonical && this.canonicalCache?.key === `${this.morph}/${this.sim.params.heightGain}`) { key = 'capture'; cache = this.canonicalCache; }
    if (key !== this.anchor) { this.anchor = key; this.anchorWeight = 0; }
    if (cache) this.anchorWeight = canonical ? 1 : Math.min(1, this.anchorWeight + dt / .5);
    this.replayCache = cache; this.replayWeight = this.anchorWeight;
    return !!cache;
  }
  async ensureCanonicalCache() {
    if (this.morph === 0 && this.lowScale === 1) return;
    if (this.morph === 1 && this.lowScale === 1) { await this.buildStorm(); return; }
    const key = `${this.morph}/${this.sim.params.heightGain}`;
    if (this.canonicalCache?.key === key) return;
    if (this.canonicalCache) { this.canonicalCache.history.dispose(); this.canonicalCache.sprayHistory.dispose(); }
    // Frozen captures alone need a periodic state at an arbitrary intermediate
    // value. Live slider motion always uses the existing recurrence, without baking.
    const builder = new ChunkSimulation(this.renderer, { ...this.settings, heightGain: this.sim.params.heightGain });
    builder.sim.evolveMat.uniforms.uH0Storm.value = this.storm.h0.texture;
    builder.sim.evolveMat.uniforms.uSpectrumBlend.value = this.morph;
    await builder.initialize();
    this.canonicalCache = { key, history: builder.history, sprayHistory: builder.sprayHistory };
    builder.dispose(new Set([builder.history, builder.sprayHistory]));
  }
  bindSpray(spray, canonical) {
    const u = spray.uniforms, cache = canonical && this.replayCache;
    u.uSprayHistory.value = (cache?.sprayHistory ?? this.sprayHistory).texture;
    u.uStormSprayHistory.value = (this.storm?.sprayHistory ?? this.sprayHistory).texture;
    u.uHistoryBlend.value = cache ? 0 : this.morph;
    u.uStormHistoryReady.value = !!this.storm?.ready;
    const gain = this.sim.params.heightGain;
    u.uHistoryGains.value.set(gain / this.settings.heightGain, gain / this.stormSettings.heightGain);
  }
  savePrevious() {
    this.quad.material = this.copyDisplacement;
    for (let i = 0; i < 3; i++) {
      this.copyDisplacement.uniforms.source.value = this.sim.displacement[i];
      this.quad.render(this.renderer, this.previous[i]);
    }
    this.copyDisplacement.uniforms.source.value = this.interaction.texture;
    this.quad.render(this.renderer, this.previousRipple);
  }
  saveRipple() {
    this.quad.material = this.copyDisplacement;
    this.copyDisplacement.uniforms.source.value = this.interaction.texture;
    this.quad.render(this.renderer, this.previousRipple);
  }
  dispose(keep = new Set()) {
    for (const rt of [this.history, this.sprayHistory, this.previousRipple, ...this.previous]) if (!keep.has(rt)) rt.dispose();
    this.copy.dispose(); this.sprayCopy.dispose(); this.copyDisplacement.dispose(); this.interaction.dispose(); this.pass.dispose();
    for (const rt of [this.sim.h0RT, this.sim.ping, this.sim.pong, ...this.sim.out.flat()]) if (!keep.has(rt)) rt.dispose();
    for (const rt of [this.storm?.h0, this.storm?.history, this.storm?.sprayHistory, this.canonicalCache?.history, this.canonicalCache?.sprayHistory]) if (rt && !keep.has(rt)) rt.dispose();
    for (const m of [this.sim.initMat, this.sim.evolveMat, this.sim.morphMat, this.sim.fftMat, this.sim.assembleMat]) m.dispose();
  }
}
