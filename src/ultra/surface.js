import * as THREE from 'three';
import { WATER_GLSL, VERT } from '../vendor/ultra-water/water/OceanSurface.js';
import { FullscreenQuad, rawPass } from '../vendor/ultra-water/engine/fullscreen.js';
import { makeContactSample } from '../water/surface';
import { wrap } from './settings.js';

// Current GPU maps drive the ember directly. Readbacks serve pointer/collision
// metadata only; their completion never sets the displayed height of the ball.
export class ChunkSurfaceAccess {
  constructor(simulation, surface, root, camera) {
    this.simulation = simulation; this.surface = surface; this.root = root; this.camera = camera;
    this.renderer = simulation.renderer;
    this.probes = Array.from({ length: 16 }, () => new THREE.Vector4());
    const uniforms = this.uniforms = { ...surface.uniforms,
      uProbes: { value: this.probes }, uOld0: { value: simulation.previous[0].texture },
      uOld1: { value: simulation.previous[1].texture }, uOld2: { value: simulation.previous[2].texture },
      uInverseDelta: { value: 30 },
    };
    this.target = new THREE.WebGLRenderTarget(16, 1, { type: THREE.FloatType, count: 3, depthBuffer: false });
    this.previousBall = this.target.clone();
    this.material = rawPass(`precision highp float;${WATER_GLSL}
      uniform vec4 uProbes[16];uniform sampler2D uOld0,uOld1,uOld2;uniform float uInverseDelta;
      layout(location=0)out vec4 point;layout(location=1)out vec4 norm;layout(location=2)out vec4 flow;
      void main(){int id=int(gl_FragCoord.x);vec4 query=uProbes[id];vec2 q=query.xy*uMetresPerWorld,p=q;
        if(query.z>.5)for(int j=0;j<4;j++)p=q-waterDisplacement(p,vec3(0.)).xz;
        vec3 d=waterDisplacement(p,vec3(0.));
        vec2 slope=textureLod(uSlope0,p/uLength.x,0.).xy+textureLod(uSlope1,p/uLength.y,0.).xy
          +textureLod(uSlope2,p/uLength.z,0.).xy+rippleAt(p).yz;
        vec3 old=texture(uOld0,p/uLength.x).xyz+texture(uOld1,p/uLength.y).xyz+texture(uOld2,p/uLength.z).xyz;
        point=vec4((vec3(p.x,0.,p.y)+d)/uMetresPerWorld,1.);
        norm=vec4(normalize(vec3(-slope.x,1.,-slope.y)),1.);
        flow=vec4((d-old)/uMetresPerWorld*uInverseDelta,uTime);
      }`, uniforms);
    this.quad = new FullscreenQuad(this.material);
    this.copy = rawPass('precision highp float;uniform sampler2D a,b,c;in vec2 vUv;layout(location=0)out vec4 p;layout(location=1)out vec4 n;layout(location=2)out vec4 f;void main(){p=texture(a,vUv);n=texture(b,vUv);f=texture(c,vUv);}',
      { a: { value: this.target.textures[0] }, b: { value: this.target.textures[1] }, c: { value: this.target.textures[2] } });
    this.pixels = [0, 1, 2].map(() => new Float32Array(64));
    this.samples = Array.from({ length: 16 }, () => ({ x: 0, y: 0, z: 0, px: 0, pz: 0, nx: 0, ny: 1, nz: 0,
      velocityX: 0, velocityY: 0, velocityZ: 0, time: 0, valid: false, residual: 0, sampledAt: 0, jacobian: null }));
    this.ocean = { interaction: simulation.interaction, parameters: { sheetSizeMetres: simulation.settings.sheetSize },
      samples: this.samples, sample: this.samples[0], time: 0, frozen: false };
    this.pickTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, count: 2 });
    this.pickCamera = new THREE.PerspectiveCamera(); this.pickScene = new THREE.Scene();
    this.pickMesh = new THREE.Mesh(surface.mesh.geometry, new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
      vertexShader: VERT, uniforms: surface.uniforms,
      fragmentShader: `precision highp float;in vec3 vWorld;in vec2 vXZ;uniform float uMetresPerWorld;layout(location=0)out vec4 hit;layout(location=1)out vec4 detail;
        void main(){hit=vec4(vWorld,1.);detail=vec4(vXZ/uMetresPerWorld,0.,1.);}` }));
    this.pickMesh.matrixAutoUpdate = false; this.pickMesh.frustumCulled = false; this.pickScene.add(this.pickMesh);
    this.pending = null;
  }
  update(time) {
    this.ocean.time = time;
    this.quad.material = this.material; this.quad.render(this.renderer, this.target);
  }
  savePrevious() { this.quad.material = this.copy; this.quad.render(this.renderer, this.previousBall); }
  async read(force = false) {
    if (this.pending) { if (!force) return; await this.pending; }
    const time = this.ocean.time;
    this.pending = (async () => {
      await Promise.all(this.pixels.map((pixels, i) => this.renderer.readRenderTargetPixelsAsync(this.target, 0, 0, 16, 1, pixels, undefined, i)));
      const now = performance.now(), [p, n, v] = this.pixels;
      for (let i = 0; i < 16; i++) {
        const at = i * 4, sample = this.samples[i], probe = this.probes[i];
        Object.assign(sample, { x: p[at], y: p[at + 1], z: p[at + 2], px: probe.x, pz: probe.y,
          nx: n[at], ny: n[at + 1], nz: n[at + 2], velocityX: v[at], velocityY: v[at + 1], velocityZ: v[at + 2],
          time, sampledAt: now, valid: p[at + 3] > .5 });
      }
    })();
    try { await this.pending; } finally { this.pending = null; }
  }
  sampleCached(slot, x, z, out, eulerian = true) {
    this.probes[slot].set(x, z, eulerian ? 1 : 0, 0);
    const sample = this.samples[slot].valid ? this.samples[slot] : this.samples[0];
    const dx = x - sample.x, dz = z - sample.z, age = performance.now() - sample.sampledAt;
    const correction = eulerian && Math.abs(sample.ny) > .25 ? THREE.MathUtils.clamp(-(sample.nx * dx + sample.nz * dz) / sample.ny, -.25, .25) : 0;
    out.position.set(eulerian ? x : sample.x, sample.y + correction, eulerian ? z : sample.z);
    out.normal.set(sample.nx, sample.ny, sample.nz); out.velocity.set(sample.velocityX, sample.velocityY, sample.velocityZ);
    out.parameter.set(x, z); out.time = sample.time; out.ageMs = age;
    out.valid = sample.valid && age < 200 && Math.hypot(dx, dz) < 1; out.jacobian = null;
    return out;
  }
  async pick(clientX, clientY) {
    const r = this.renderer, rect = r.domElement.getBoundingClientRect(), old = r.getRenderTarget();
    this.root.updateMatrixWorld(true); this.pickMesh.matrix.copy(this.root.matrixWorld);
    this.pickCamera.copy(this.camera); this.pickCamera.setViewOffset(rect.width, rect.height, clientX - rect.left, clientY - rect.top, 1, 1); this.pickCamera.updateMatrixWorld();
    r.setRenderTarget(this.pickTarget); r.setClearColor(0, 0); r.clear(); r.render(this.pickScene, this.pickCamera); r.setRenderTarget(old);
    const hit = new Float32Array(4), detail = new Float32Array(4);
    await Promise.all([r.readRenderTargetPixelsAsync(this.pickTarget, 0, 0, 1, 1, hit), r.readRenderTargetPixelsAsync(this.pickTarget, 0, 0, 1, 1, detail, undefined, 1)]);
    if (hit[3] < .5) return undefined;
    const out = makeContactSample(); out.position.set(...hit.slice(0, 3)).applyMatrix4(this.root.matrixWorld.clone().invert());
    out.parameter.set(detail[0], detail[1]); out.normal.set(0, 1, 0); out.valid = true; out.time = this.ocean.time; return out;
  }
  impulse(parameter, amplitude) { const m = this.simulation.settings.sheetSize / 10; this.simulation.interaction.drop(parameter.x * m, parameter.y * m, amplitude * m); }
  async samplePoint(x, z, eulerian = false, slot = 7) { this.probes[slot].set(x, z, +eulerian, 0); this.update(this.ocean.time); await this.read(true); return this.sampleCached(slot, x, z, makeContactSample(), eulerian); }
  dispose() { for (const target of [this.target, this.previousBall, this.pickTarget]) target.dispose(); this.material.dispose(); this.copy.dispose(); this.pickMesh.material.dispose(); }
}
