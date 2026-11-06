import * as THREE from 'three';
import { OceanSurface, VERT, WATER_GLSL } from '../vendor/ultra-water/water/OceanSurface.js';
import { bakeWaterTextures } from '../vendor/ultra-water/water/bakeTextures.js';
import { Spray } from '../vendor/ultra-water/water/Spray.js';
import { PostFX } from '../vendor/ultra-water/engine/PostFX.js';
import { FullscreenQuad, rawPass } from '../vendor/ultra-water/engine/fullscreen.js';
import { ballMaterial } from '../materials';
import { lipGeometry } from '../water/geometry';
import { stormTumble, STORM_VIEW } from '../water/view';
import { ChunkSimulation } from './simulation.js';
import { ChunkSurfaceAccess } from './surface.js';
import { makeStudio } from './studio.js';
import { Cinematic } from './cinematic.js';
import { CHUNK_DEFAULTS, wrap } from './settings.js';
import { compileMaterials, yieldFrame } from './scheduling.js';

export class ChunkPresentation {
  constructor(settings = {}, renderer = null) {
    this.settings = { ...CHUNK_DEFAULTS, ...settings };
    this.renderer = renderer ?? new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    const r = this.renderer, gl = r.getContext();
    r.capabilities.maxTextures = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
    r.outputColorSpace = THREE.LinearSRGBColorSpace; r.toneMapping = THREE.NoToneMapping; r.autoClear = false; r.setPixelRatio(1);
    this.scene = new THREE.Scene(); this.root = new THREE.Group(); this.root.name = 'Ultra-Water floating chunk'; this.root.position.y = 4; this.scene.add(this.root);
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, .1, 160);
    const target = new THREE.Vector3(.35, 2.7, -.15), direction = new THREE.Vector3(10.9, 0, 11.2).normalize();
    direction.y = Math.tan(Math.PI / 6); direction.normalize();
    this.camera.position.copy(direction).multiplyScalar(22).add(target); this.camera.lookAt(target); this.cameraTarget = target;
    this.previousSheet = new THREE.Matrix4(); this.previousViewProjection = new THREE.Matrix4();
    this.offset = new THREE.Vector3(); this.ballWorld = new THREE.Vector3(); this.time = 0; this.frames = 0;
    this.canonical = true; this.deterministicPlayback = false; this.holdVelocity = false;
    this.lastSheet = new THREE.Matrix4(); this.lastVP = new THREE.Matrix4();
    this.gpuFrames = [];
    this.studio = makeStudio(r, this.settings.studioHighlightStrength); this.simulation = new ChunkSimulation(r, this.settings);
    this.surface = new OceanSurface(this.simulation.sim, this.studio, this.simulation.interaction.texture, this.settings.sheetSize);
    // Reference colour: charcoal teal body; crests retain the vendored scatter/Fresnel response.
    // These are Ultra-Water's existing optical parameters, not a screen-space tint.
    this.surface.uniforms.uScatterColor.value.setRGB(...this.settings.scatter);
    this.surface.uniforms.uAbsorption.value.fromArray(this.settings.absorption);
    this.waterTextures = bakeWaterTextures(r);
    this.surface.uniforms.uFoamTex.value = this.waterTextures.foam;
    this.root.add(this.surface.mesh); this.top = this.surface.mesh;
    this.skirt = new THREE.Mesh(lipGeometry(511), new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, uniforms: this.surface.uniforms, side: THREE.DoubleSide,
      fragmentShader: 'precision highp float;out vec4 c;void main(){c=vec4(.012,.029,.031,1.);}',
    })); this.skirt.frustumCulled = false; this.root.add(this.skirt);
    this.access = new ChunkSurfaceAccess(this.simulation, this.surface, this.root, this.camera);
    const bm = ballMaterial(.575, .3);
    bm.vertexShader = bm.vertexShader.replaceAll('vec2(0.5)', 'vec2(.5/16.,.5)');
    bm.uniforms.uBallState.value = this.access.target.textures[0]; bm.uniforms.uBallNormal.value = this.access.target.textures[1]; bm.uniforms.uUseGpuBall.value = true;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(.575, 48, 32), bm); this.ball.name = 'Ember'; this.root.add(this.ball);
    this.surface.uniforms.uBallState.value = this.access.target.textures[0];
    this.surface.uniforms.uBallOffset.value = this.offset;
    this.spray = new Spray(this.surface, this.simulation.sprayHistory.texture); this.root.add(this.spray.mesh, this.spray.splash);
    this.floorColor = new THREE.Color(.6572, .2114, .1648);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ color: this.floorColor }));
    this.floor.rotation.x = -Math.PI / 2; this.scene.add(this.floor);
    // A soft contact shadow belongs to the studio, independently of water shading.
    const shadowMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec2 vUv;void main(){vec2 p=(vUv-.5)*2.;gl_FragColor=vec4(.04,.025,.025,.15*exp(-dot(p,p)*2.8));}' });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(17, 14), shadowMaterial); this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = .005; this.scene.add(this.shadow);
    this.opaque = this.target(); this.opaque.samples = 0; this.hdr = this.target();
    this.velocity = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.restore = rawPass('precision highp float;uniform sampler2D image,depth;in vec2 vUv;out vec4 c;void main(){c=texture(image,vUv);gl_FragDepth=texture(depth,vUv).r;}',
      { image: { value: this.opaque.texture }, depth: { value: this.opaque.depthTexture } }, { depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth });
    this.quad = new FullscreenQuad(this.restore);
    this.motionMaterial = this.makeWaterVelocity(); this.ballMotionMaterial = this.makeBallVelocity();
    this.depthMaterial = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, uniforms: this.surface.uniforms,
      fragmentShader: 'precision highp float;out vec4 c;void main(){c=vec4(0.);}', side: THREE.FrontSide, colorWrite: false });
    this.surface.material.depthFunc = THREE.EqualDepth; this.surface.material.depthWrite = false;
    this.top.onBeforeRender = (_r, _s, _c, _g, material) => { if (material === this.surface.material) this.depthPrepass(); };
    this.cinematic = new Cinematic(r, this.settings, this.access.target.textures[0], this.root, this.camera);
    this.postFX = new PostFX(r); Object.assign(this.postFX.params, { autoExposure: false, exposure: 1, bloomStrength: .05, bloomThreshold: 1.5 });
    this.post = { scale: 1, resize: (w, h) => this.resizeTargets(w, h), render: target => { if (target) this.prepare(this.time, 0, true); this.draw(target); }, setScale: value => { this.post.scale = value; } };
    this.width = 1280; this.height = 720; this.resize(1280, 720);
  }
  target(count = 1) { return new THREE.WebGLRenderTarget(1, 1, { count, type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType) }); }
  makeWaterVelocity() {
    const uniforms = { ...this.surface.uniforms,
      uOld0: { value: this.simulation.previous[0].texture }, uOld1: { value: this.simulation.previous[1].texture }, uOld2: { value: this.simulation.previous[2].texture },
      uPreviousRipple: { value: this.simulation.previousRipple.texture },
      uPreviousSheet: { value: this.previousSheet }, uPreviousVP: { value: this.previousViewProjection }, uVelocityScale: { value: 1 } };
    let vertex = VERT.replace('void main(){', 'uniform sampler2D uOld0,uOld1,uOld2,uPreviousRipple;uniform mat4 uPreviousSheet,uPreviousVP;out vec4 vNow,vOld;void main(){');
    vertex = vertex.replace('  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);', `
      vNow=projectionMatrix*viewMatrix*vec4(vWorld,1.);
      vec3 oldLod=max(log2(cell*N_TEX/uLength.xyz)+1.,vec3(0.));
      vec3 old=textureLod(uOld0,xz/uLength.x,oldLod.x).xyz+textureLod(uOld1,xz/uLength.y,oldLod.y).xyz+textureLod(uOld2,xz/uLength.z,oldLod.z).xyz;
      old.y+=textureLod(uPreviousRipple,xz/uSize+.5,0.).r;
      vOld=uPreviousVP*uPreviousSheet*vec4((vec3(xz.x,0.,xz.y)+old)/uMetresPerWorld+vec3(0.,position.y,0.),1.);
      gl_Position=vNow;`);
    return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader: vertex,
      fragmentShader: 'precision highp float;uniform float uVelocityScale;in vec4 vNow,vOld;in vec3 vWorld;out vec4 c;void main(){c=vec4((vNow.xy/vNow.w-vOld.xy/vOld.w)*.5*uVelocityScale,-(viewMatrix*vec4(vWorld,1.)).z,1.);}', side: THREE.DoubleSide });
  }
  makeBallVelocity() {
    const source = this.ball.material;
    let vertex = source.vertexShader;
    vertex = vertex.replace('void main() {', 'uniform sampler2D uOldBall;uniform mat4 uPreviousSheet,uPreviousVP;varying vec4 vNow,vOld;void main() {');
    vertex = vertex.replace(/}\s*$/, `
      vNow=projectionMatrix*viewMatrix*vec4(vP,1.);
      vec3 old=texture2D(uOldBall,vec2(.5/16.,.5)).xyz+vec3(0.,uImmersionOffset,0.)+uBallOffset+position;
      vOld=uPreviousVP*uPreviousSheet*vec4(old,1.);
    }`);
    return new THREE.ShaderMaterial({ uniforms: { ...source.uniforms, uOldBall: { value: this.access.previousBall.textures[0] },
      uPreviousSheet: { value: this.previousSheet }, uPreviousVP: { value: this.previousViewProjection }, uVelocityScale: { value: 1 } }, vertexShader: vertex,
      fragmentShader: 'uniform float uVelocityScale;varying vec4 vNow,vOld;varying vec3 vP;void main(){gl_FragColor=vec4((vNow.xy/vNow.w-vOld.xy/vOld.w)*.5*uVelocityScale,-(viewMatrix*vec4(vP,1.)).z,1.);}' });
  }
  async initialize(progress = () => {}, initialTime = 0) {
    await yieldFrame();
    const r = this.renderer, sim = this.simulation, q = sim.quad.mesh, camera = sim.pass.camera;
    const compiling = Promise.all([
      this.studio.initialize(), this.waterTextures.initialize(), r.compileAsync(this.scene, this.camera),
      compileMaterials(r, [this.motionMaterial, this.ballMotionMaterial, this.depthMaterial], this.top, this.camera),
      compileMaterials(r, [this.restore, this.access.material, this.access.copy, this.cinematic.material], this.quad.mesh, camera),
      compileMaterials(r, [this.postFX.matPre, this.postFX.matDown, this.postFX.matUp, this.postFX.matComp], this.postFX.mesh, this.postFX.camera),
    ]);
    // Wait for compute programs before their first draw. Surface/post programs
    // continue compiling while the already-linked FFT brews its periodic foam.
    await compileMaterials(r, [sim.sim.initMat, sim.sim.evolveMat, sim.sim.morphMat, sim.sim.fftMat, sim.sim.assembleMat, sim.copy, sim.sprayCopy, sim.copyDisplacement], q, camera);
    await this.simulation.initialize(progress); await compiling;
    this.simulation.prepareStormSpectrum(); this.simulation.setStorm(1);
    this.ready = true; await this.seek(initialTime);
  }
  async apply(values, progress = () => {}) {
    Object.assign(this.settings, values); this.ready = false;
    const sim = this.simulation;
    await sim.stormPromise;
    for (const rt of [sim.storm?.h0, sim.storm?.history, sim.storm?.sprayHistory, sim.canonicalCache?.history, sim.canonicalCache?.sprayHistory]) rt?.dispose();
    sim.storm = sim.stormPromise = sim.canonicalCache = null;
    sim.sim.evolveMat.uniforms.uSpectrumBlend.value = 0;
    sim.sim.evolveMat.uniforms.uH0.value = sim.sim.h0RT.texture;
    sim.stormSettings = { ...this.settings, peakWaves: sim.stormSettings.peakWaves, heightGain: sim.stormSettings.heightGain };
    await sim.initialize(progress); sim.prepareStormSpectrum(); sim.setStorm(1);
    this.ready = true; await this.seek(0); void sim.buildStorm();
  }
  resizeTargets(w, h) {
    this.width = Math.max(1, Math.round(w)); this.height = Math.max(1, Math.round(h));
    for (const target of [this.opaque, this.hdr, this.velocity]) target.setSize(this.width, this.height);
    this.cinematic.resize(this.width, this.height); this.postFX.setSize(this.width, this.height);
    this.surface.uniforms.uResolution.value.set(this.width, this.height);
  }
  resize(w, h) { this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.resizeTargets(w, h); }
  pose(time, tilt = null) {
    stormTumble(time, this.root.rotation, 1); if (tilt) { this.root.rotation.x += tilt.y; this.root.rotation.z -= tilt.x; }
    this.root.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
    this.ball.material.uniforms.uSheetMatrix.value.copy(this.root.matrixWorld);
    this.ball.material.uniforms.uBallOffset.value.copy(this.offset);
    this.surface.uniforms.uSheetMatrix.value.copy(this.root.matrixWorld);
  }
  bindPrevious(textures, inverseDelta = 30) {
    for (let i = 0; i < 3; i++) {
      this.motionMaterial.uniforms['uOld' + i].value = textures[i];
      this.access.uniforms['uOld' + i].value = textures[i];
    }
    this.access.uniforms.uInverseDelta.value = inverseDelta;
  }
  prepare(time, dt = 0, canonical = true) {
    const lastTime = this.time;
    this.time = wrap(time); const previous = wrap(this.time - 1 / 30), u = this.surface.uniforms;
    this.canonical = canonical; this.holdVelocity = false;
    const replay = this.simulation.prepareReplay(canonical, dt);
    if (canonical) {
    this.simulation.evolve(previous, 0, replay); this.surface.update(this.camera, previous);
    u.uRipple.value = this.simulation.interaction.texture;
    this.access.update(previous); this.access.savePrevious(); this.simulation.savePrevious();
    stormTumble(previous, this.root.rotation, 1); this.root.updateMatrixWorld(true); this.previousSheet.copy(this.root.matrixWorld);
    this.camera.updateMatrixWorld(true); this.previousViewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.simulation.interaction.step(dt);
    this.simulation.evolve(this.time, dt, replay); this.surface.update(this.camera, this.time);
    this.bindPrevious(this.simulation.previous.map(target => target.texture));
    this.motionMaterial.uniforms.uVelocityScale.value = this.ballMotionMaterial.uniforms.uVelocityScale.value = 1;
    } else {
      const phaseDelta = wrap(this.time - lastTime), gain = this.simulation.sim.params.heightGain;
      const changed = phaseDelta > 1e-8 || gain !== this.lastGain || this.simulation.morph !== this.lastMorph || this.motionDirty;
      if (changed) {
        const old = this.simulation.sim.displacement.slice();
        this.access.savePrevious(); this.simulation.saveRipple();
        this.previousSheet.copy(this.lastSheet); this.previousViewProjection.copy(this.lastVP);
        this.simulation.interaction.step(dt); this.simulation.evolve(this.time, dt, replay);
        const delta = phaseDelta > 1e-8 ? phaseDelta : Math.max(dt, 1e-6);
        this.bindPrevious(old, 1 / delta);
        this.motionMaterial.uniforms.uVelocityScale.value = this.ballMotionMaterial.uniforms.uVelocityScale.value = 1 / (30 * delta);
      } else {
        this.simulation.interaction.step(dt); this.holdVelocity = true;
      }
      this.lastGain = gain; this.lastMorph = this.simulation.morph; this.surface.update(this.camera, this.time);
    }
    u.uRipple.value = this.simulation.interaction.texture;
    this.access.update(this.time); this.pose(this.time);
    u.uFoam.value.x = this.settings.foamBias; u.uFoam.value.y = this.settings.foamScale; u.uBillow.value = this.settings.billow;
    // Existing water-light/glint controls; the ember's own emissive material stays independent.
    u.uBallGlow.value = this.settings.emberWaterGain; u.uGlint.value = this.settings.glintStrength;
    this.simulation.bindSpray(this.spray, canonical);
    this.spray.params.amount = this.settings.spray; this.spray.update();
    this.postFX.params.grain = this.settings.grain ? this.settings.grainStrength : 0;
  }
  async seek(time) {
    await this.simulation.ensureCanonicalCache();
    this.offset.set(0, 0, 0); this.simulation.interaction.reset(); this.access.ocean.frozen = true;
    this.prepare(time); await this.access.read(true); this.updateBallMetadata(); this.draw();
  }
  updateBallMetadata() {
    const s = this.access.samples[0]; this.ball.position.set(s.x + this.offset.x, s.y + .575 * .4 + this.offset.y, s.z + this.offset.z);
    this.root.updateMatrixWorld(true); this.ball.getWorldPosition(this.ballWorld);
  }
  frame(time, dt) { this.access.ocean.frozen = false; this.prepare(time, dt, this.deterministicPlayback); if (!(this.frames % 2)) void this.access.read(); this.updateBallMetadata(); }
  canSubmit() {
    const gl = this.renderer.getContext();
    while (this.gpuFrames.length) {
      if (gl.clientWaitSync(this.gpuFrames[0], 0, 0) === gl.TIMEOUT_EXPIRED) break;
      gl.deleteSync(this.gpuFrames.shift());
    }
    // Backpressure, not a rate cap: a fast GPU still renders every display tick.
    return this.gpuFrames.length < 2;
  }
  didSubmit() {
    const gl = this.renderer.getContext();
    this.gpuFrames.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)); gl.flush();
  }
  draw(output = null) {
    const r = this.renderer, water = this.top, particles = [this.spray.mesh, this.spray.splash], s = this.surface.uniforms;
    this.postFX.params.grain = this.settings.grain ? this.settings.grainStrength : 0;
    this.pose(this.time, this.tilt);
    r.setClearColor(this.floorColor, 1);
    water.visible = false; particles.forEach(mesh => mesh.visible = false);
    r.setRenderTarget(this.hdr); r.clear(true, true, true); r.render(this.scene, this.camera);
    this.resolveRefraction();
    s.uSceneColor.value = this.opaque.texture; s.uSceneDepth.value = this.opaque.depthTexture;
    r.setRenderTarget(this.hdr); r.clear(true, true, true); this.quad.render(r, this.hdr);
    water.visible = true; this.floor.visible = this.shadow.visible = this.ball.visible = this.skirt.visible = false;
    particles.forEach(mesh => mesh.visible = this.settings.spray > 0);
    r.render(this.scene, this.camera);
    // Per-pixel velocity includes water, its rigid tumble and the ember carrier.
    particles.forEach(mesh => mesh.visible = false); this.ball.visible = true;
    const waterMaterial = water.material, ball = this.ball.material;
    water.material = this.motionMaterial; this.ball.material = this.ballMotionMaterial;
    if (!this.holdVelocity) { r.setRenderTarget(this.velocity); r.setClearColor(0, 0); r.clear(true, true, false); r.render(this.scene, this.camera); }
    water.material = waterMaterial; this.ball.material = ball;
    this.floor.visible = this.shadow.visible = this.ball.visible = this.skirt.visible = true;
    particles.forEach(mesh => mesh.visible = this.settings.spray > 0);
    const hdr = this.cinematic.render(this.hdr.texture, this.hdr.depthTexture, this.velocity.texture, this.offset);
    this.postFX.render(hdr, 0, this.time, output); r.setRenderTarget(null); this.frames++;
    this.lastSheet.copy(this.root.matrixWorld); this.lastVP.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
  }
  resolveRefraction() {
    const r = this.renderer;
    r.initRenderTarget(this.opaque);
    r.copyTextureToTexture(this.hdr.texture, this.opaque.texture);
    r.copyTextureToTexture(this.hdr.depthTexture, this.opaque.depthTexture);
  }
  depthPrepass() {
    const mesh = this.top;
    mesh.modelViewMatrix.multiplyMatrices(this.camera.matrixWorldInverse, mesh.matrixWorld);
    mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
    // Draw into the current 4x scene depth without an intermediate MSAA resolve.
    this.renderer.renderBufferDirect(this.camera, this.scene, mesh.geometry, this.depthMaterial, mesh, null);
  }
  capture(type = 'image/png') { this.prepare(this.time, 0, true); this.draw(); return this.renderer.domElement.toDataURL(type, .93); }
  evidence() { return { backend: 'Ultra-Water WebGL2', time: this.time, parameters: { ...this.settings },
    geometryVertices: this.top.geometry.attributes.position.count, cascadeLengths: this.simulation.lengths,
    ball: { ...this.access.samples[0] }, ballWorld: this.ballWorld.toArray(), frames: this.frames,
    brewing: this.simulation.brewing, stormCacheReady: !!this.simulation.storm?.ready,
    cacheMemory: { foamBytesEach: 256 * 256 * 121 * 8, sprayBytesEach: 32 * 32 * 121 * 8 }, morph: this.simulation.morph }; }
  dispose() {
    const gl = this.renderer.getContext(); for (const fence of this.gpuFrames) gl.deleteSync(fence); this.gpuFrames.length = 0;
    this.access.dispose(); this.simulation.dispose(); this.spray.dispose(); this.cinematic.dispose(); this.postFX.dispose(); this.studio.target.dispose(); this.waterTextures.dispose();
    for (const rt of [this.opaque, this.hdr, this.velocity]) rt.dispose(); this.restore.dispose(); this.motionMaterial.dispose(); this.ballMotionMaterial.dispose(); this.depthMaterial.dispose();
    for (const mesh of [this.top, this.skirt, this.ball, this.floor, this.shadow]) { mesh.geometry.dispose(); mesh.material.dispose(); }
  }
}
