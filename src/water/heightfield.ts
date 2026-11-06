// Finite-difference height/velocity ping-pong and moved-sphere volume forcing.
// Technique/code lineage: Evan Wallace WebGL Water and Three.js GPGPU Water (MIT).
import { HalfFloatType, LinearFilter, Vector3, Vector4 } from 'three';
import type { RawShaderMaterial, WebGLRenderTarget } from 'three';
import { ComputePass, computeMaterial, floatTarget } from './gpu-fft';
export class Heightfield {
  readonly N = 256;
  radius: number;
  readonly tilt = new Vector3();
  get waveSpeed(): number { return this.size * .22; }
  get stepSeconds(): number { return Math.min(1 / 120, .5 * (this.size / this.N) / this.waveSpeed); }
  readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  readonly drops = Array.from({ length: 6 }, () => new Vector4(0, 0, 0, 0));
  readonly material: RawShaderMaterial;
  private read = 0; private accumulator = 0; private dropIndex = 0;
  private readonly previousSphere = new Vector3(0, 1000, 0);
  private readonly currentSphere = new Vector3(0, 1000, 0);
  steps = 0; impulses = 0; spherePushes = 0;
  constructor(readonly pass: ComputePass, public size: number, radius: number) {
    this.radius = radius;
    this.targets = [floatTarget(this.N, 1, HalfFloatType), floatTarget(this.N, 1, HalfFloatType)];
    for (const target of this.targets) target.texture.minFilter = target.texture.magFilter = LinearFilter;
    this.material = computeMaterial(`uniform sampler2D uState; uniform float uSize,uDt,uDamping,uRadius,uWaveSpeed; uniform vec3 uOldSphere,uSphere,uTilt; uniform bool uMove; uniform vec4 uDrops[6]; out vec4 outColor;
      float column(vec3 center,vec2 p){float q=uRadius*uRadius-dot(p-center.xz,p-center.xz); if(q<=0.)return 0.;float r=sqrt(q);return clamp(r-center.y,0.,2.*r);}
      void main(){ ivec2 p=ivec2(gl_FragCoord.xy), hi=ivec2(255); vec2 state=texelFetch(uState,p,0).rg;
        float north=texelFetch(uState,clamp(p+ivec2(0,1),ivec2(0),hi),0).r, south=texelFetch(uState,clamp(p-ivec2(0,1),ivec2(0),hi),0).r;
        float east=texelFetch(uState,clamp(p+ivec2(1,0),ivec2(0),hi),0).r, west=texelFetch(uState,clamp(p-ivec2(1,0),ivec2(0),hi),0).r;
        float dx=uSize/256., lap=(north+south+east+west-4.*state.r)/(dx*dx);
        vec2 xz=(gl_FragCoord.xy/256.-.5)*uSize;
        float velocity=(state.g+(uWaveSpeed*uWaveSpeed*lap-dot(uTilt.xz,xz)*3.)*uDt)*exp(-uDamping*uDt), height=state.r+velocity*uDt;
        for(int i=0;i<6;i++){vec4 d=uDrops[i];if(d.w!=0.){vec2 delta=xz-d.xy;float q=dot(delta,delta)/(d.z*d.z);height+=d.w*(1.-q)*exp(-q);}}
        if(uMove)height+=clamp(column(uOldSphere,xz)-column(uSphere,xz),-2.,2.);
        // Absorbing edge, not a sheet bend. No reflected square wave walls.
        float edge=min(min(float(p.x),float(p.y)),min(float(255-p.x),float(255-p.y)))/12.;float absorb=smoothstep(0.,1.,edge);
        height=clamp(height,-8.,8.)*absorb;velocity=clamp(velocity,-30.,30.)*absorb;
        if(abs(height)<1e-6&&abs(velocity)<1e-5){height=0.;velocity=0.;}outColor=vec4(height,velocity,0.,1.); }`,
      { uState: { value: null }, uSize: { value: size }, uDt: { value: 1 / 120 }, uDamping: { value: 4.6 }, uRadius: { value: this.radius }, uWaveSpeed: { value: this.waveSpeed }, uTilt: { value: this.tilt }, uOldSphere: { value: this.previousSphere }, uSphere: { value: this.currentSphere }, uMove: { value: false }, uDrops: { value: this.drops } });
    this.reset();
  }
  get texture() { return this.targets[this.read].texture; }
  reset(): void {
    const renderer = this.pass.renderer, previous = renderer.getRenderTarget();
    // Clear through a shader: do not inherit the coral presentation clear colour.
    const clear = computeMaterial('out vec4 outColor;void main(){outColor=vec4(0.);}');
    this.pass.draw(clear, this.targets[0]); this.pass.draw(clear, this.targets[1]); clear.dispose();
    renderer.setRenderTarget(previous); this.read = 0; this.accumulator = 0; this.drops.forEach(drop => drop.set(0, 0, 0, 0));
    this.previousSphere.set(0, this.size, 0); this.currentSphere.copy(this.previousSphere); this.material.uniforms.uMove.value = false;
  }
  drop(x: number, z: number, amplitude = 1.2): void { this.drops[this.dropIndex].set(x, z, Math.max(1.2, this.size / 80), Math.max(-2, Math.min(2, amplitude))); this.dropIndex = (this.dropIndex + 1) % this.drops.length; this.impulses++; }
  sphere(x: number, z: number, relativeHeight: number): void {
    if (this.currentSphere.y > this.size * .5) this.previousSphere.set(x, relativeHeight, z); else this.previousSphere.copy(this.currentSphere);
    this.currentSphere.set(x, relativeHeight, z); this.material.uniforms.uMove.value = this.previousSphere.distanceToSquared(this.currentSphere) > 1e-10;
    if (this.material.uniforms.uMove.value) this.spherePushes++;
  }
  step(displayDt: number): void {
    const dt = this.stepSeconds; this.accumulator += Math.min(displayDt, .1);
    this.material.uniforms.uSize.value = this.size; this.material.uniforms.uRadius.value = this.radius; this.material.uniforms.uDamping.value = 4.6;
    this.material.uniforms.uDt.value = dt; this.material.uniforms.uWaveSpeed.value = this.waveSpeed;
    while (this.accumulator >= dt) {
      this.material.uniforms.uState.value = this.texture; this.pass.draw(this.material, this.targets[1 - this.read]); this.read = 1 - this.read;
      for (const drop of this.drops) drop.w = 0; this.material.uniforms.uMove.value = false; this.accumulator -= dt; this.steps++;
    }
  }
  get cfl(): number { return this.waveSpeed * this.stepSeconds / (this.size / this.N); }
  dispose(): void { this.targets.forEach(target => target.dispose()); this.material.dispose(); }
}
