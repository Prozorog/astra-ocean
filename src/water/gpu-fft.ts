// Fragment Stockham indexing adapted from David Li / waves (MIT).
// Fields/centering follow gasgiant and Garrett Gunnell; see notices.
import { Camera, DataTexture, FloatType, GLSL3, HalfFloatType, Mesh, NearestFilter, PlaneGeometry, RawShaderMaterial, RGBAFormat, Scene, WebGLRenderTarget } from 'three';
import type { Texture, WebGLRenderer, TextureDataType } from 'three';
export const COMPUTE_VERTEX = `precision highp float; in vec3 position; out vec2 vUv; void main(){vUv=position.xy*.5+.5; gl_Position=vec4(position.xy,0.,1.);}`;
export function computeMaterial(fragmentShader: string, uniforms: Record<string, { value: unknown }> = {}): RawShaderMaterial {
  return new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: COMPUTE_VERTEX, fragmentShader: `precision highp float; precision highp int; precision highp sampler2D;\n${fragmentShader}`, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
}
export function floatTarget(N: number, count = 1, type: TextureDataType = FloatType): WebGLRenderTarget {
  return new WebGLRenderTarget(N, N, { count, type, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false, stencilBuffer: false });
}
export class ComputePass {
  readonly scene = new Scene(); readonly camera = new Camera(); readonly quad = new Mesh(new PlaneGeometry(2, 2));
  constructor(readonly renderer: WebGLRenderer) { this.quad.frustumCulled = false; this.scene.add(this.quad); }
  draw(material: RawShaderMaterial, target: WebGLRenderTarget, layer = 0): void { this.quad.material = material; this.renderer.setRenderTarget(target, layer); this.renderer.render(this.scene, this.camera); }
  dispose(): void { this.quad.geometry.dispose(); }
}
export class FragmentFFT {
  readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  readonly butterfly: RawShaderMaterial;
  readonly copy: RawShaderMaterial;
  readonly stages: number;
  constructor(readonly pass: ComputePass, readonly N: number, readonly type: TextureDataType = FloatType) {
    if (N < 2 || (N & (N - 1))) throw new Error('FFT size must be a power of two');
    this.stages = Math.log2(N); this.targets = [floatTarget(N, 2, type), floatTarget(N, 2, type)];
    this.butterfly = computeMaterial(`uniform sampler2D uA,uB; uniform int uN,uSize; uniform bool uVertical,uFinal; layout(location=0) out vec4 outA; layout(location=1) out vec4 outB;
      vec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);} vec4 pair(vec4 a,vec4 b,vec2 w){return vec4(a.xy+cmul(w,b.xy),a.zw+cmul(w,b.zw));}
      void main(){ ivec2 p=ivec2(gl_FragCoord.xy); int index=uVertical?p.y:p.x; int halfSize=uSize/2; int even=(index/uSize)*halfSize+index%halfSize;
        ivec2 a=uVertical?ivec2(p.x,even):ivec2(even,p.y); ivec2 b=a+(uVertical?ivec2(0,uN/2):ivec2(uN/2,0));
        float angle=6.283185307179586*float(index)/float(uSize); vec2 w=vec2(cos(angle),sin(angle)); float sign=uFinal&&((p.x+p.y)%2==1)?-1.:1.;
        outA=pair(texelFetch(uA,a,0),texelFetch(uA,b,0),w)*sign; outB=pair(texelFetch(uB,a,0),texelFetch(uB,b,0),w)*sign; }`,
      { uA: { value: null }, uB: { value: null }, uN: { value: N }, uSize: { value: 2 }, uVertical: { value: false }, uFinal: { value: false } });
    this.copy = computeMaterial('uniform sampler2D uInput; layout(location=0) out vec4 outA; layout(location=1) out vec4 outB; void main(){outA=texelFetch(uInput,ivec2(gl_FragCoord.xy),0);outB=vec4(0.);}', { uInput: { value: null } });
  }
  get output(): WebGLRenderTarget { return this.targets[0]; }
  run(): void {
    let read = 0;
    const u = this.butterfly.uniforms;
    for (let axis = 0; axis < 2; axis++) for (let stage = 0; stage < this.stages; stage++) {
      const source = this.targets[read]; u.uA.value = source.textures[0]; u.uB.value = source.textures[1]; u.uSize.value = 2 ** (stage + 1); u.uVertical.value = axis === 1; u.uFinal.value = axis === 1 && stage === this.stages - 1;
      this.pass.draw(this.butterfly, this.targets[1 - read]); read = 1 - read;
    }
  }
  fromTexture(texture: Texture): void { this.copy.uniforms.uInput.value = texture; this.pass.draw(this.copy, this.targets[0]); this.run(); }
  async validate(): Promise<{ passed: boolean; constantError: number; frequencyError: number }> {
    const data = new Float32Array(this.N * this.N * 4), result = new Float32Array(data.length), texture = new DataTexture(data, this.N, this.N, RGBAFormat, FloatType);
    let constantError = 0, frequencyError = 0;
    for (let test = 0; test < 2; test++) {
      data.fill(0); data[((this.N / 2) * this.N + this.N / 2 + test) * 4] = 1; texture.needsUpdate = true; this.fromTexture(texture);
      if (this.type !== FloatType) throw new Error('Isolation readback must use a float32 validation target');
      await this.pass.renderer.readRenderTargetPixelsAsync(this.output, 0, 0, this.N, this.N, result);
      for (let y = 0; y < this.N; y++) for (let x = 0; x < this.N; x++) { const i = (y * this.N + x) * 4, a = test ? 2 * Math.PI * x / this.N : 0;
        const error = Math.max(Math.abs(result[i] - Math.cos(a)), Math.abs(result[i + 1] - Math.sin(a))); if (test) frequencyError = Math.max(frequencyError, error); else constantError = Math.max(constantError, error); }
    }
    texture.dispose(); return { passed: constantError < .001 && frequencyError < .001, constantError, frequencyError };
  }
  dispose(): void { this.targets.forEach(target => target.dispose()); this.butterfly.dispose(); this.copy.dispose(); }
}
// Actual MRT FFT work for both formats, timed with a completed async readback.
// The caller can retain float32 if half precision is not a demonstrated win.
export async function compareFFTStorage(pass: ComputePass): Promise<object> {
  const N = 128, source = new DataTexture(new Float32Array(N * N * 4).fill(.0001), N, N, RGBAFormat, FloatType); source.needsUpdate = true;
  const times: Record<string, number> = {};
  for (const [label, type] of [['rgba32f', FloatType], ['rgba16f', HalfFloatType]] as const) {
    const fft = new FragmentFFT(pass, N, type); fft.fromTexture(source);
    const sink = floatTarget(N), copy = computeMaterial('uniform sampler2D uInput; out vec4 outColor;void main(){outColor=texelFetch(uInput,ivec2(gl_FragCoord.xy),0);}', { uInput: { value: fft.output.texture } });
    pass.draw(copy, sink); await pass.renderer.readRenderTargetPixelsAsync(sink, 0, 0, 1, 1, new Float32Array(4));
    const start = performance.now(); for (let i = 0; i < 8; i++) fft.fromTexture(source); pass.draw(copy, sink); await pass.renderer.readRenderTargetPixelsAsync(sink, 0, 0, 1, 1, new Float32Array(4)); times[label] = (performance.now() - start) / 8;
    fft.dispose(); sink.dispose(); copy.dispose();
  }
  source.dispose(); return { millisecondsPer128TransformIncludingDispatch: times, selected: 'rgba32f', reason: '32-bit FFT and C0/C1 carrier maps keep GPU attachments smooth; C2 detail and the visual surface use RGBA16F.', sampleCount: 8 };
}
