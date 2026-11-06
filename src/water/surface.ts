import { Color, DoubleSide, FloatType, GLSL3, Matrix4, Mesh, PerspectiveCamera, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget } from 'three';
import type { BufferGeometry, Group } from 'three';
import { PHYSICAL_VERTEX } from './material';
import type { PhysicalOcean } from './ocean';
import { wrapTime } from './time';
export interface ContactSample { position: Vector3; normal: Vector3; velocity: Vector3; parameter: Vector2; time: number; valid: boolean; jacobian: number | null; ageMs: number }
export function makeContactSample(): ContactSample { return { position: new Vector3(), normal: new Vector3(0, 1, 0), velocity: new Vector3(), parameter: new Vector2(), time: 0, valid: false, jacobian: null, ageMs: 0 }; }
/** One GPU carrier: batched dynamics and frontmost raster contacts exclude foam relief. */
export class SurfaceAccess {
  private readonly pickScene = new Scene();
  private readonly pickCamera = new PerspectiveCamera();
  private readonly pickTarget = new WebGLRenderTarget(1, 1, { count: 2, type: FloatType, depthBuffer: true });
  private readonly pickMesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly pixel = new Float32Array(4); private readonly parameterPixel = new Float32Array(4);
  private readonly inverse = new Matrix4(); private readonly clear = new Color();
  private readonly picked = makeContactSample();
  private picking: Promise<ContactSample | undefined> = Promise.resolve(undefined);
  constructor(readonly ocean: PhysicalOcean, readonly root: Group, readonly camera: PerspectiveCamera, readonly top: Mesh<BufferGeometry, ShaderMaterial>) {
    this.pickMesh = new Mesh(top.geometry, new ShaderMaterial({ glslVersion: GLSL3, side: DoubleSide, toneMapped: false, uniforms: { ...top.material.uniforms, uCarrier: { value: true } }, vertexShader: PHYSICAL_VERTEX,
      fragmentShader: `precision highp float;uniform sampler2D uCarrierBase,uDz;uniform float uSize;varying vec3 vWorld;varying vec2 vBase;layout(location=0)out vec4 hit;layout(location=1)out vec4 detail;void main(){vec2 uv=vBase/10.+.5,e=vec2(1./512.,0.);float dx=uSize/512.;vec3 tx=vec3(1.,0.,0.)+(texture(uCarrierBase,uv+e).xyz-texture(uCarrierBase,uv-e).xyz)/(2.*dx),tz=vec3(0.,0.,1.)+(texture(uCarrierBase,uv+e.yx).xyz-texture(uCarrierBase,uv-e.yx).xyz)/(2.*dx);tx.y=(texture(uDz,uv+e).w-texture(uDz,uv-e).w)/(2.*dx);tz.y=(texture(uDz,uv+e.yx).w-texture(uDz,uv-e.yx).w)/(2.*dx);vec3 N=normalize(cross(tz,tx));N/=abs(N.x)+abs(N.y)+abs(N.z);vec2 oct=N.xz;if(N.y<0.)oct=(1.-abs(oct.yx))*vec2(oct.x<0.?-1.:1.,oct.y<0.?-1.:1.);hit=vec4(vWorld,1.);detail=vec4(vBase,oct);}` }));
    this.pickMesh.matrixAutoUpdate = false; this.pickMesh.frustumCulled = false; this.pickScene.add(this.pickMesh);
    for (let slot = 1; slot < ocean.probeCount; slot++) ocean.setProbe(slot, 0, 0);
  }
  async initialize(): Promise<void> {
    await this.ocean.renderer.compileAsync(this.pickScene, this.pickCamera);
    const rect = this.ocean.renderer.domElement.getBoundingClientRect();
    // Allocate/render/read the float MRT before readiness, not on the first tap.
    await this.pick(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  sampleCached(slot: number, x: number, z: number, out: ContactSample, eulerian = true): ContactSample {
    const s = this.ocean.setProbe(slot, x, z, eulerian), source = Number.isFinite(s.receivedAt) ? s : this.ocean.sample;
    const dx = x - (eulerian ? source.x : source.px), dz = z - (eulerian ? source.z : source.pz), distance = Math.hypot(dx, dz), age = wrapTime(this.ocean.time - source.time);
    const ageMs = performance.now() - source.sampledAt, exact = this.ocean.frozen && age < 1e-5;
    const trusted = source.valid && distance < .65 && (exact || ageMs < 180) && age < .2;
    // A bounded tangent/velocity prediction of the LAST GPU result, not a CPU
    // spectral model. Failed fold inversions keep that branch; they never snap.
    const plane = trusted && eulerian && Math.abs(source.ny) > .25 ? Math.max(-.25, Math.min(.25, -(source.nx * dx + source.nz * dz) / source.ny)) : 0;
    const prediction = trusted ? Math.min(age, .05) : 0;
    out.position.set(eulerian ? x : source.x + source.velocityX * prediction, source.y + plane + source.velocityY * prediction, eulerian ? z : source.z + source.velocityZ * prediction);
    out.normal.set(source.nx, source.ny, source.nz); out.velocity.set(source.velocityX, source.velocityY, source.velocityZ);
    out.parameter.set(source.px, source.pz); out.time = source.time; out.valid = s.valid && trusted; out.jacobian = source.jacobian; out.ageMs = ageMs;
    return out;
  }
  async samplePoint(x: number, z: number, eulerian = false, slot = 7): Promise<ContactSample> {
    this.ocean.setProbe(slot, x, z, eulerian); await this.ocean.readSample(this.ocean.time, true);
    const s = this.ocean.samples[slot], out = makeContactSample(); out.position.set(s.x, s.y, s.z); out.normal.set(s.nx, s.ny, s.nz); out.velocity.set(s.velocityX, s.velocityY, s.velocityZ); out.parameter.set(s.px, s.pz); out.time = s.time; out.valid = s.valid; out.jacobian = s.jacobian; out.ageMs = performance.now() - s.sampledAt; return out;
  }
  pick(clientX: number, clientY: number): Promise<ContactSample | undefined> {
    // Serialize tiny readbacks, not pointer input; rapid taps are not discarded.
    this.picking = this.picking.then(() => this.rasterPick(clientX, clientY)); return this.picking;
  }
  private async rasterPick(clientX: number, clientY: number): Promise<ContactSample | undefined> {
    const renderer = this.ocean.renderer, rect = renderer.domElement.getBoundingClientRect();
    this.root.updateMatrixWorld(true); this.top.updateWorldMatrix(true, false); this.pickMesh.matrix.copy(this.top.matrixWorld); this.inverse.copy(this.root.matrixWorld).invert();
    this.pickCamera.copy(this.camera); this.pickCamera.setViewOffset(rect.width, rect.height, clientX - rect.left, clientY - rect.top, 1, 1); this.pickCamera.layers.set(0); this.pickCamera.updateMatrixWorld();
    const previous = renderer.getRenderTarget(), alpha = renderer.getClearAlpha(), autoClear = renderer.autoClear, sampledTime = this.ocean.time, sampledAt = performance.now();
    renderer.getClearColor(this.clear); renderer.autoClear = false; renderer.setRenderTarget(this.pickTarget); renderer.setClearColor(0, 0); renderer.clear(); renderer.render(this.pickScene, this.pickCamera);
    renderer.setRenderTarget(previous); renderer.setClearColor(this.clear, alpha); renderer.autoClear = autoClear;
    await Promise.all([renderer.readRenderTargetPixelsAsync(this.pickTarget, 0, 0, 1, 1, this.pixel), renderer.readRenderTargetPixelsAsync(this.pickTarget, 0, 0, 1, 1, this.parameterPixel, undefined, 1)]);
    if (this.pixel[3] < .5) return undefined;
    const d = this.parameterPixel, out = this.picked; out.position.set(this.pixel[0], this.pixel[1], this.pixel[2]).applyMatrix4(this.inverse); out.parameter.set(d[0], d[1]);
    let nx = d[2], nz = d[3]; const ny = 1 - Math.abs(nx) - Math.abs(nz);
    if (ny < 0) { const oldX = nx; nx = (1 - Math.abs(nz)) * (oldX < 0 ? -1 : 1); nz = (1 - Math.abs(oldX)) * (nz < 0 ? -1 : 1); }
    // This depth packet carries position/parameter/normal, not a measured J.
    out.normal.set(nx, ny, nz).normalize(); out.velocity.set(0, 0, 0); out.time = sampledTime; out.valid = true; out.ageMs = performance.now() - sampledAt; out.jacobian = null;
    return out;
  }
  impulse(parameter: Vector2, amplitude: number): void { const metres = this.ocean.parameters.sheetSizeMetres / 10; this.ocean.interaction.drop(parameter.x * metres, parameter.y * metres, amplitude * metres); }
  dispose(): void { this.pickTarget.dispose(); this.pickMesh.material.dispose(); }
}
