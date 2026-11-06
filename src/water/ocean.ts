import { DataArrayTexture, FloatType, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, NearestFilter, RedFormat, RepeatWrapping, UnsignedByteType, Vector2, Vector3, Vector4, WebGLArrayRenderTarget } from 'three';
import type { RawShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';
import { LOOP, wrapTime } from './time';
import { ComputePass, FragmentFFT, computeMaterial, compareFFTStorage, floatTarget } from './gpu-fft';
import { bands, makeSpectrum, MESO_LOG_BAND, PHILLIPS_WIND_ANGLE, PHYSICAL_DEFAULTS, physicalReport, spectralGain, spectrumClock, windSpectrum } from './spectrum';
import type { PhysicalSettings, SpectrumSeed } from './spectrum';
import { Heightfield } from './heightfield';
import { STORM_VIEW } from './view';
import { FOAM_BILLOW_GLSL } from './lighting';

function nextFrame(): Promise<void> { const { promise, resolve } = Promise.withResolvers<void>(); requestAnimationFrame(() => resolve()); return promise; }
interface AnchorFrequencyGroup {
  omega: number;
  // For each of the 4 center baseGeometry texels (00, 10, 01, 11):
  // cos and sin coefficients for [dx, dy, dz, xz, xx, zz, longY] (7 channels * 4 texels = 28 values)
  cos: Float64Array;
  sin: Float64Array;
}
class Cascade {
  readonly fft: FragmentFFT; readonly maps: WebGLRenderTarget; readonly evolve: RawShaderMaterial; readonly assemble: RawShaderMaterial;
  constructor(readonly pass: ComputePass, public seed: SpectrumSeed, peakK: number) {
    const N = seed.band.N; this.fft = new FragmentFFT(pass, N);
    for (const target of this.fft.targets) for (const texture of target.textures) { texture.minFilter = texture.magFilter = LinearFilter; texture.wrapS = texture.wrapT = RepeatWrapping; }
    this.maps = floatTarget(N, 2, seed.band.name === 'C2' ? HalfFloatType : FloatType);
    for (const texture of this.maps.textures) { texture.wrapS = texture.wrapT = RepeatWrapping; texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter; texture.generateMipmaps = true; }
    const detail = seed.band.name === 'C2';
    this.evolve = computeMaterial(`uniform sampler2D uH0;uniform float uTime,uLength,uPeriod,uHero,uMesoGain,uChop,uPeakK,uHighK,uStorm;uniform vec4 uMesoBand;uniform bool uLoop,uPeakOnly,uDetail,uPhillips;uniform int uN;layout(location=0)out vec4 outA;layout(location=1)out vec4 outB;
      vec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}vec2 packReal(vec2 a,vec2 b){return vec2(a.x-b.y,a.y+b.x);}
      void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec2 k=(vec2(p)-float(uN)*.5)*(6.283185307179586/uLength);float m=length(k);if(m<1e-6){outA=vec4(0.);outB=vec4(0.);return;}
        float omega=sqrt(9.81*m);if(uLoop){float q=6.283185307179586/uPeriod;omega=max(1.,floor(omega/q+.5))*q;}
        float gain=uPhillips?1.:uHero;if(!uPhillips&&(uPeakOnly||uMesoGain>1.)){float lk=log(m/uPeakK);if(uPeakOnly)gain=1.+(uHero-1.)*(1.-smoothstep(log(2.),log(8.),lk));
          if(uMesoGain>1.)gain*=1.+(uMesoGain-1.)*smoothstep(uMesoBand.x,uMesoBand.y,lk)*(1.-smoothstep(uMesoBand.z,uMesoBand.w,lk));}
        if(!uPhillips&&uDetail&&uPeakOnly)gain*=1.5;
        float phase=omega*uTime;vec2 e=vec2(cos(phase),sin(phase));vec4 initial=texelFetch(uH0,p,0);vec2 h=(cmul(initial.xy,e)+cmul(initial.zw,vec2(e.x,-e.y)))*gain*uStorm;vec2 ih=vec2(-h.y,h.x);
        float weight=(uPhillips?1.:mix(1.,uPeakOnly?.24:.35,smoothstep((uPeakOnly?2.5:3.)*uPeakK,uHighK,m)))*uChop;vec2 dx=ih*(k.x/m)*weight,dz=ih*(k.y/m)*weight;
        vec2 crossD=-h*(k.x*k.y/m)*weight,sx=ih*k.x,sz=ih*k.y,xx=-h*(k.x*k.x/m)*weight,zz=-h*(k.y*k.y/m)*weight;
        outA=vec4(packReal(dx,dz),packReal(h,crossD));outB=vec4(packReal(sx,sz),packReal(xx,zz));}`, {
      uH0: { value: seed.texture }, uTime: { value: 0 }, uLength: { value: seed.band.L }, uPeriod: { value: LOOP * 2.8 }, uHero: { value: 2.5 }, uMesoGain: { value: 1 }, uMesoBand: { value: new Vector4().fromArray(MESO_LOG_BAND) }, uChop: { value: 1 }, uPeakK: { value: peakK }, uHighK: { value: 8 }, uLoop: { value: true }, uPeakOnly: { value: false }, uPhillips: { value: false }, uDetail: { value: detail }, uStorm: { value: 1 }, uN: { value: N },
    });
    // Resolved C0/C1 keep strain in zw; C2 retains the slope-square moment
    // needed to filter its unresolved normal detail.
    this.assemble = computeMaterial(`uniform sampler2D uA,uB;layout(location=0)out vec4 displacement;layout(location=1)out vec4 gradients;void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 a=texelFetch(uA,p,0),b=texelFetch(uB,p,0);displacement=vec4(a.x,a.z,a.y,a.w);gradients=vec4(b.xy,${detail ? 'dot(b.xy,b.xy),0.' : 'b.zw'});}`, { uA: { value: this.fft.output.textures[0] }, uB: { value: this.fft.output.textures[1] } });
  }
  step(time: number, p: PhysicalSettings, highK: number, storm: number): void {
    const u = this.evolve.uniforms;
    const clock = spectrumClock(p);
    u.uTime.value = (p.loop ? wrapTime(time + p.phaseOffset) : time + p.phaseOffset) * clock; u.uPeriod.value = LOOP * clock; u.uHero.value = p.heroHeight; u.uMesoGain.value = p.mesoGain; u.uPeakOnly.value = p.peakOnly; u.uPhillips.value = p.model === 'phillips'; u.uStorm.value = storm; u.uChop.value = p.chop; u.uLoop.value = p.loop; u.uHighK.value = p.mesoGain > 1 ? Math.min(highK, 12 * u.uPeakK.value) : highK;
    this.pass.draw(this.evolve, this.fft.targets[0]); this.fft.run(); this.pass.draw(this.assemble, this.maps);
  }
  dispose(): void { this.seed.texture.dispose(); this.fft.dispose(); this.maps.dispose(); this.evolve.dispose(); this.assemble.dispose(); }
}
export interface GpuSurfaceSample {
  x: number; y: number; z: number; nx: number; ny: number; nz: number; px: number; pz: number; jacobian: number;
  time: number; valid: boolean; residual: number; requestedX: number; requestedZ: number;
  sampledAt: number; receivedAt: number; sequence: number; velocityX: number; velocityY: number; velocityZ: number;
}
const sample = (): GpuSurfaceSample => ({ x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, px: 0, pz: 0, jacobian: 1, time: 0, valid: false, residual: 0, requestedX: 0, requestedZ: 0, sampledAt: -Infinity, receivedAt: -Infinity, sequence: 0, velocityX: 0, velocityY: 0, velocityZ: 0 });
const boundedVelocity = (v: number): number => Math.max(-6, Math.min(6, v));
const NOISE = `float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}float cloud(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}`;

export class PhysicalOcean {
  readonly parameters: PhysicalSettings;
  readonly pass: ComputePass; readonly interaction: Heightfield;
  cascades: Cascade[] = [];
  readonly resolution = 512;
  readonly baseGeometry = floatTarget(256, 1, FloatType);
  // Visual displacement/tangents; tangentZ.w retains the load-bearing height
  // BEFORE decorative foam. Probes/contact reuse it, without another GPU map.
  readonly geometry = floatTarget(512, 3, HalfFloatType);
  readonly ballState = floatTarget(1, 2, FloatType);
  readonly foam: [WebGLRenderTarget, WebGLRenderTarget] = [floatTarget(256, 1, HalfFloatType), floatTarget(256, 1, HalfFloatType)];
  readonly frozenFoam = new WebGLArrayRenderTarget(256, 256, 121, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  readonly patchData = new Uint8Array(256 * 256 * 121);
  readonly foamPatches = new DataArrayTexture(this.patchData, 256, 256, 121);
  patchAreas: number[][] = [];
  readonly probeCount = 12; // 0 anchor, 1 contact, 2 hold, 4–6 lip, 7 exact, 8–11 buoyant footprint.
  readonly samples = Array.from({ length: this.probeCount }, sample); readonly sample = this.samples[0];
  readonly anchor = sample();
  readonly points = Array.from({ length: this.probeCount }, () => new Vector4(0, 0, 0, 0));
  readonly probeSeeds = Array.from({ length: this.probeCount }, () => new Vector4(0, 0, 1, 0));
  readonly probe = floatTarget(8); readonly probeData = new Float32Array(this.probeCount * 8 * 4);
  readonly heights = new Float32Array(256 * 256 * 4); readonly diagnosticTarget = floatTarget(256);
  readonly geometryMaterial: RawShaderMaterial; readonly surfaceMaterial: RawShaderMaterial; readonly ballStateMaterial: RawShaderMaterial; readonly foamMaterial: RawShaderMaterial; readonly copyFoam: RawShaderMaterial; readonly resumeFoamMaterial: RawShaderMaterial; readonly probeMaterial: RawShaderMaterial;
  fftResult = { passed: false, constantError: Infinity, frequencyError: Infinity }; storageComparison: object = {};
  foamConvergence: number[] = []; ready = false; frozen = true; time = 0; heroHs = 0; storm = 1; readbackLatencyMs = 0; maxReadbackLatencyMs = 0;
  private anchorGroups: AnchorFrequencyGroup[] = [];
  private anchorInteractionY = 0;
  private foamIndex = 0; private pending?: Promise<void>; private requestedAt = 0;
  private readonly pendingPoints = Array.from({ length: this.probeCount }, () => new Vector2());
  private readonly pendingEulerian = new Array<boolean>(this.probeCount).fill(false);
  constructor(readonly renderer: WebGLRenderer, parameters: PhysicalSettings = PHYSICAL_DEFAULTS, readonly ballRadius: number = STORM_VIEW.ballRadius) {
    this.parameters = { ...parameters, cascadeLengths: [...parameters.cascadeLengths] };
    this.foamPatches.format = RedFormat; this.foamPatches.type = UnsignedByteType; this.foamPatches.minFilter = this.foamPatches.magFilter = NearestFilter; this.foamPatches.needsUpdate = true;
    this.pass = new ComputePass(renderer); this.interaction = new Heightfield(this.pass, this.parameters.sheetSizeMetres, ballRadius * this.parameters.sheetSizeMetres / 10);
    this.probe.setSize(this.probeCount, 8);
    for (const texture of this.geometry.textures) texture.minFilter = texture.magFilter = LinearFilter;
    this.baseGeometry.texture.minFilter = this.baseGeometry.texture.minFilter = this.baseGeometry.texture.magFilter = LinearFilter;
    for (const target of this.foam) target.texture.minFilter = target.texture.magFilter = LinearFilter;
    this.geometryMaterial = computeMaterial(`uniform sampler2D uD0,uD1,uR0,uR1;uniform float uSize,uCrest,uPeakK,uVariance;uniform bool uPhillips;uniform vec3 uLengths;out vec4 outColor;in vec2 vUv;
      void main(){vec2 p=(vUv-.5)*uSize;vec4 d0=texture(uD0,p/uLengths.x+.5),d1=texture(uD1,p/uLengths.y+.5),r0=texture(uR0,p/uLengths.x+.5),r1=texture(uR1,p/uLengths.y+.5);
        float xx=1.+r0.z+r1.z,zz=1.+r0.w+r1.w,xz=d0.w+d1.w,J=xx*zz-xz*xz;vec3 d=d0.xyz+d1.xyz;
        if(uPhillips&&J<-.3){float a=xx+zz-2.,b=(xx-1.)*(zz-1.)-xz*xz;d.xz*=2.6/(sqrt(max(0.,a*a-5.2*b))-a);}
        if(uCrest>0.){float longHeight=textureLod(uD0,p/uLengths.x+.5,3.).y,rms=max(sqrt(uVariance),.1),pinch=clamp(1.-J,0.,.92);
          d.y+=uCrest*uPeakK*(longHeight*longHeight-uVariance)+uCrest*.65*rms*pinch*pinch*smoothstep(-.2,.35,d.y/rms);}
        outColor=vec4(d,J);}`, {
      uD0: { value: null }, uD1: { value: null }, uR0: { value: null }, uR1: { value: null }, uSize: { value: this.parameters.sheetSizeMetres }, uLengths: { value: new Vector3() }, uCrest: { value: 0 }, uPeakK: { value: 0 }, uVariance: { value: 0 }, uPhillips: { value: false },
    });
    this.foamMaterial = computeMaterial(`uniform sampler2D uMacroD0,uMacroD1,uMacroG0,uMacroG1,uPrevious,uD2,uR2;uniform vec2 uMacroLengths,uMacroGrids,uWindDirection;uniform float uMacroFootprint,uMacroHs,uSize,uLength2,uDt,uDecay,uThreshold,uSlip,uDiffusion,uBulkBirthTime;in vec2 vUv;out vec4 outColor;
      ${NOISE}
      vec2 macroCompression(vec2 uv){vec2 p=(uv-.5)*uSize,lod=log2(max(vec2(1.),uMacroFootprint*uMacroGrids/uMacroLengths));
        vec4 g0=textureLod(uMacroG0,p/uMacroLengths.x+.5,lod.x),g1=textureLod(uMacroG1,p/uMacroLengths.y+.5,lod.y);
        vec4 d0=textureLod(uMacroD0,p/uMacroLengths.x+.5,lod.x),d1=textureLod(uMacroD1,p/uMacroLengths.y+.5,lod.y);
        float xz=d0.w+d1.w;return vec2((1.+g0.z+g1.z)*(1.+g0.w+g1.w)-xz*xz,d0.y+d1.y);}
      void main(){vec2 cell=vec2(1./256.,0.),back=vUv-uWindDirection*uSlip*uDt/uSize;vec3 h=texture(uPrevious,back).rgb;
        vec3 lap=texture(uPrevious,back+cell).rgb+texture(uPrevious,back-cell).rgb+texture(uPrevious,back+cell.yx).rgb+texture(uPrevious,back-cell.yx).rgb-4.*h;
        float dx=uSize/256.;h=max(vec3(0.),h+lap*min(.24,uDiffusion*uDt/(dx*dx)));h*=exp(-uDt/vec3(uDecay,.12,uDecay));
        vec2 strain=macroCompression(vUv);float J=strain.x;
        float compressed=1.-smoothstep(uThreshold-.1,uThreshold+.3,J),crest=smoothstep(.27,.45,strain.y/max(uMacroHs,.1));
        float source=compressed*crest*crest;
        vec2 p=(vUv-.5)*uSize/uLength2+.5;vec4 r=texture(uR2,p),d=texture(uD2,p);float J2=(1.+r.z)*(1.+r.w)-d.w*d.w;
        float cap=1.-smoothstep(.82,.94,J2);vec2 injection=vec2(source,cap)*(1.-exp(-uDt/vec2(uBulkBirthTime,.025)));
        vec2 born=injection*(1.-clamp(h.rg,0.,1.));h.rg+=born;
        vec2 metres=(vUv-.5)*uSize,flow=vec2(dot(metres,uWindDirection),dot(metres,vec2(uWindDirection.y,-uWindDirection.x)));
        vec2 warp=(vec2(cloud(flow*.14),cloud(flow*.14+13.))-.5)*3.2,q=flow+warp;
        float lobes=.65*cloud(q*.38)+.35*cloud(q*vec2(.8,.7)+vec2(7.1,23.7));
        lobes=smoothstep(.25,.75,lobes);
        float waterHeight=texture(uMacroD0,metres/uMacroLengths.x+.5).y+texture(uMacroD1,metres/uMacroLengths.y+.5).y;
        float detail=(waterHeight-strain.y)/max(.012*uMacroHs,.08);
        float waveFold=.5+.5*detail*inversesqrt(1.+detail*detail);
        float folds=smoothstep(.3,.65,.65*lobes+.35*waveFold);
        h.b=min(h.r,h.b+born.r*folds);outColor=vec4(h,J);}`, { uMacroD0: { value: null }, uMacroD1: { value: null }, uMacroG0: { value: null }, uMacroG1: { value: null }, uBulkBirthTime: { value: .045 }, uWindDirection: { value: new Vector2(.70710678,.70710678) }, uMacroLengths: { value: new Vector2() }, uMacroGrids: { value: new Vector2() }, uMacroFootprint: { value: 1 }, uMacroHs: { value: 1 }, uPrevious: { value: null }, uD2: { value: null }, uR2: { value: null }, uSize: { value: this.parameters.sheetSizeMetres }, uLength2: { value: 1 }, uDt: { value: 0 }, uDecay: { value: .28 }, uThreshold: { value: .15 }, uSlip: { value: 1.1 }, uDiffusion: { value: .16 } });
    this.copyFoam = computeMaterial('uniform sampler2D uHistory;in vec2 vUv;out vec4 outColor;void main(){outColor=texture(uHistory,vUv);}', { uHistory: { value: null } });
    this.resumeFoamMaterial = computeMaterial('precision highp sampler2DArray;uniform sampler2DArray uCache;uniform float uFrame;in vec2 vUv;out vec4 outColor;void main(){float a=mod(floor(uFrame),121.),b=mod(a+1.,121.);outColor=mix(texture(uCache,vec3(vUv,a)),texture(uCache,vec3(vUv,b)),fract(uFrame));}', { uCache: { value: this.frozenFoam.texture }, uFrame: { value: 0 } });
    this.surfaceMaterial = computeMaterial(`precision highp sampler2DArray;uniform sampler2D uBase,uInteraction,uFoam;uniform sampler2DArray uCache;uniform bool uFrozen;uniform float uFrame,uSize,uRelief;in vec2 vUv;layout(location=0)out vec4 displacement;layout(location=1)out vec4 tangentX;layout(location=2)out vec4 tangentZ;
      ${NOISE}
      ${FOAM_BILLOW_GLSL}
      float layer(vec2 uv){vec2 film;if(uFrozen){float a=mod(floor(uFrame),121.),b=mod(a+1.,121.);film=mix(texture(uCache,vec3(uv,a)).rb,texture(uCache,vec3(uv,b)).rb,fract(uFrame));}else{film=texture(uFoam,uv).rb;}
        if(film.x<=.5)return 0.;
        vec2 q=(uv-.5)*10.;
        float erode=(cloud(q*4.4+vec2(5.2,7.8))-.5)*.16+(cloud(q*6.5+vec2(11.3,2.1))-.5)*.08;
        float gate=smoothstep(.5,.76,film.x)*smoothstep(.48,.78,film.x+erode);
        float foldWeight=.55+.45*clamp(film.y/max(film.x,.01),0.,1.);
        return min(1.,gate*foldWeight*(.38+.82*foamBillow(q)));}
      float carrierHeight(vec2 uv){return texture(uBase,uv).y+texture(uInteraction,uv).r;}
      vec3 finalD(vec2 uv){vec3 d=texture(uBase,uv).xyz;
        d.y+=texture(uInteraction,uv).r+.45*uRelief*layer(uv);return d;}
      void main(){vec2 e=vec2(1./512.,0.);float dx=uSize/512.;vec3 d=finalD(vUv),tx=vec3(1.,0.,0.)+(finalD(vUv+e)-finalD(vUv-e))/(2.*dx),tz=vec3(0.,0.,1.)+(finalD(vUv+e.yx)-finalD(vUv-e.yx))/(2.*dx);float J=tx.x*tz.z-tx.z*tz.x;displacement=vec4(d,texture(uBase,vUv).a);tangentX=vec4(tx,J);tangentZ=vec4(tz,carrierHeight(vUv));}`, { uBase: { value: this.baseGeometry.texture }, uInteraction: { value: this.interaction.texture }, uFoam: { value: null }, uCache: { value: this.frozenFoam.texture }, uFrozen: { value: true }, uFrame: { value: 0 }, uSize: { value: this.parameters.sheetSizeMetres }, uRelief: { value: 0 } });
    this.ballStateMaterial = computeMaterial(`uniform sampler2D uGeometry,uInteraction;uniform vec2 uAnchor;uniform float uSize,uRimRadius;layout(location=0)out vec4 outPosition;layout(location=1)out vec4 outNormal;
      float freeHeight(vec2 uv){
        vec2 r=vec2(uRimRadius/10.,0.);
        float hf=.25*(texture(uInteraction,uv+r).r+texture(uInteraction,uv-r).r+texture(uInteraction,uv+r.yx).r+texture(uInteraction,uv-r.yx).r);
        return texture(uGeometry,uv).y+hf;
      }
      vec3 surfaceAt(vec2 q){vec2 uv=q/10.+.5;vec3 d=texture(uGeometry,uv).xyz;d.y=freeHeight(uv);return vec3(q.x,0.,q.y)+d*(10./uSize);}
      void main(){vec2 q=uAnchor,uv=q/10.+.5,e=vec2(1./512.,0.);float dx=uSize/512.;
        vec3 tx=vec3(1.,0.,0.)+(texture(uGeometry,uv+e).xyz-texture(uGeometry,uv-e).xyz)/(2.*dx);
        vec3 tz=vec3(0.,0.,1.)+(texture(uGeometry,uv+e.yx).xyz-texture(uGeometry,uv-e.yx).xyz)/(2.*dx);
        tx.y=(freeHeight(uv+e)-freeHeight(uv-e))/(2.*dx);
        tz.y=(freeHeight(uv+e.yx)-freeHeight(uv-e.yx))/(2.*dx);
        float J=tx.x*tz.z-tx.z*tz.x;vec3 n=normalize(cross(tz,tx)),p=surfaceAt(q);
        outPosition=vec4(p,J);outNormal=vec4(n,p.y);}`, {
      uGeometry: { value: this.baseGeometry.texture }, uInteraction: { value: this.interaction.texture }, uAnchor: { value: new Vector2(0, 0) }, uSize: { value: this.parameters.sheetSizeMetres }, uRimRadius: { value: this.ballRadius + 1.5 * 10 / 256 },
    });
    this.probeMaterial = computeMaterial(`uniform sampler2D uGeometry,uDz;uniform vec4 uPoints[${this.probeCount}],uSeeds[${this.probeCount}];uniform float uSize;out vec4 outColor;
      vec3 surface(vec2 q){vec2 uv=q/10.+.5;vec3 d=texture(uGeometry,uv).xyz;d.y=texture(uDz,uv).w;return vec3(q.x,0.,q.y)+d*(10./uSize);}
      vec3 tangent(vec2 uv,vec2 e,vec3 axis){float dx=uSize/512.;vec3 t=axis+(texture(uGeometry,uv+e).xyz-texture(uGeometry,uv-e).xyz)/(2.*dx);t.y=(texture(uDz,uv+e).w-texture(uDz,uv-e).w)/(2.*dx);return t;}
      void main(){int slot=int(gl_FragCoord.x),row=int(gl_FragCoord.y);vec4 request=uPoints[slot],seed=uSeeds[slot];vec2 goal=request.xy,q=request.z>.5&&seed.w>.5?seed.xy:goal;float initialSign=seed.z;
        // Bounded Newton continuation, not a claim of a globally unique inverse.
        if(request.z>.5){for(int i=0;i<12;i++){vec2 uv=q/10.+.5;vec3 tx=tangent(uv,vec2(1./512.,0.),vec3(1.,0.,0.)),tz=tangent(uv,vec2(0.,1./512.),vec3(0.,0.,1.));float J=tx.x*tz.z-tx.z*tz.x;vec2 error=surface(q).xz-goal;if(length(error)<.002||J*initialSign<.12)break;vec2 delta=vec2(tz.z*error.x-tz.x*error.y,-tx.z*error.x+tx.x*error.y)/J;delta*=min(1.,.16/max(length(delta),1e-6));vec2 next=q-delta;if(length(next-(seed.w>.5?seed.xy:goal))>(seed.w>.5?.65:1.5))break;q=clamp(next,vec2(-4.99),vec2(4.99));}}
        vec2 uv=q/10.+.5;vec3 p=surface(q),tx=tangent(uv,vec2(1./512.,0.),vec3(1.,0.,0.)),tz=tangent(uv,vec2(0.,1./512.),vec3(0.,0.,1.));
        float J=tx.x*tz.z-tx.z*tz.x;vec3 n=normalize(cross(tz,tx));float residual=request.z>.5?length(p.xz-goal):0.;float valid=request.w*step(residual,.045)*(request.z>.5?step(.05,J*initialSign):1.);
        if(row==0)outColor=vec4(p,J);else if(row==1)outColor=vec4(n,valid);else if(row==2)outColor=vec4(q,residual,1.);else if(row==3)outColor=vec4(tx,1.);else if(row==4)outColor=vec4(tz,1.);else outColor=vec4(0.);}`, { uGeometry: { value: this.baseGeometry.texture }, uDz: { value: this.geometry.textures[2] }, uPoints: { value: this.points }, uSeeds: { value: this.probeSeeds }, uSize: { value: this.parameters.sheetSizeMetres } });
    this.setProbe(0, 0, 0);
  }
  get history() { return this.foam[this.foamIndex].texture; }
  setProbe(slot: number, x: number, z: number, eulerian = false): GpuSurfaceSample {
    const s = this.samples[slot], near = Math.hypot(x - s.x, z - s.z) < .5, seeded = Number.isFinite(s.receivedAt) && near;
    this.points[slot].set(x, z, eulerian ? 1 : 0, 1); this.probeSeeds[slot].set(s.px, s.pz, seeded && s.jacobian < 0 ? -1 : 1, seeded ? 1 : 0); return s;
  }
  async initialize(progress: (fraction: number, stage: string) => void): Promise<void> {
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) throw new Error('WebGL2 EXT_color_buffer_float unavailable');
    const test = new FragmentFFT(this.pass, 256); this.fftResult = await test.validate(); test.dispose();
    if (!this.fftResult.passed) throw new Error(`GPU IFFT isolation failure: ${JSON.stringify(this.fftResult)}`);
    progress(.04, 'GPU FFT verified'); this.storageComparison = await compareFFTStorage(this.pass); progress(.07, 'Float targets measured');
    await this.rebuild(progress); this.ready = true;
  }
  private buildAnchorGroups(): void {
    const p = this.parameters, peak = windSpectrum(p.wind, p.fetch).peak, peakK = peak * peak / 9.81;
    const highK = p.mesoGain > 1 ? Math.min(this.cascades[2].seed.band.high, 12 * peakK) : this.cascades[2].seed.band.high;
    const period = LOOP * spectrumClock(p), qOmega = 2 * Math.PI / period;
    const map = new Map<number, AnchorFrequencyGroup>();
    const texels = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const;
    const w1d = (idx: number, u: number, N: number): [number, number] => {
      const coord = u * N - 0.5, i0 = Math.floor(coord), f = coord - i0;
      const a0 = ((i0 % N) + N) % N, a1 = (a0 + 1) % N;
      const s0 = (a0 & 1) ? -1 : 1, s1 = (a1 & 1) ? -1 : 1;
      const ang0 = 2 * Math.PI * idx * a0 / N, ang1 = 2 * Math.PI * idx * a1 / N;
      return [(1 - f) * s0 * Math.cos(ang0) + f * s1 * Math.cos(ang1), (1 - f) * s0 * Math.sin(ang0) + f * s1 * Math.sin(ang1)];
    };
    const w1dMip3 = (idx: number, u: number, N: number): [number, number] => {
      const M = N >> 3, coord = u * M - 0.5, m0 = Math.floor(coord), f = coord - m0;
      const b0 = ((m0 % M) + M) % M, b1 = (b0 + 1) % M;
      let r0 = 0, i0 = 0, r1 = 0, i1 = 0;
      for (let sub = 0; sub < 8; sub++) {
        const a0 = b0 * 8 + sub, a1 = b1 * 8 + sub;
        const s0 = (a0 & 1) ? -1 : 1, s1 = (a1 & 1) ? -1 : 1;
        const ang0 = 2 * Math.PI * idx * a0 / N, ang1 = 2 * Math.PI * idx * a1 / N;
        r0 += s0 * Math.cos(ang0) * 0.125; i0 += s0 * Math.sin(ang0) * 0.125;
        r1 += s1 * Math.cos(ang1) * 0.125; i1 += s1 * Math.sin(ang1) * 0.125;
      }
      return [(1 - f) * r0 + f * r1, (1 - f) * i0 + f * i1];
    };
    for (let c = 0; c < 2; c++) {
      const seed = this.cascades[c].seed, N = seed.band.N, L = seed.band.L, coeff = seed.coefficients, dk = 2 * Math.PI / L;
      const wxTable = texels.map(([tx]) => { const u = (tx * p.sheetSizeMetres / 256) / L + 0.5; return Array.from({ length: N }, (_, ix) => w1d(ix, u, N)); });
      const wzTable = texels.map(([, tz]) => { const u = (tz * p.sheetSizeMetres / 256) / L + 0.5; return Array.from({ length: N }, (_, iz) => w1d(iz, u, N)); });
      const wxMip3 = c === 0 ? texels.map(([tx]) => { const u = (tx * p.sheetSizeMetres / 256) / L + 0.5; return Array.from({ length: N }, (_, ix) => w1dMip3(ix, u, N)); }) : null;
      const wzMip3 = c === 0 ? texels.map(([, tz]) => { const u = (tz * p.sheetSizeMetres / 256) / L + 0.5; return Array.from({ length: N }, (_, iz) => w1dMip3(iz, u, N)); }) : null;
      for (let pz = 0; pz < N; pz++) for (let px = 0; px < N; px++) {
        const idx = (pz * N + px) * 4;
        const r0 = coeff[idx], i0 = coeff[idx + 1], rc = coeff[idx + 2], ic = coeff[idx + 3];
        if (r0 === 0 && i0 === 0 && rc === 0 && ic === 0) continue;
        const kx = (px - N * 0.5) * dk, kz = (pz - N * 0.5) * dk, m = Math.hypot(kx, kz);
        if (m < 1e-6) continue;
        let omega = Math.sqrt(9.81 * m);
        if (p.loop) omega = Math.max(1, Math.floor(omega / qOmega + 0.5)) * qOmega;
        const gain = spectralGain(m, peakK, p);
        const s0 = (p.peakOnly ? 2.5 : 3) * peakK, tChop = Math.max(0, Math.min(1, (m - s0) / Math.max(highK - s0, 1e-6)));
        const chopFactor = p.model === 'phillips' ? 1 : 1 + ((p.peakOnly ? 0.24 : 0.35) - 1) * (tChop * tChop * (3 - 2 * tChop));
        const key = Math.round(omega * 1e6);
        let group = map.get(key);
        if (!group) { group = { omega, cos: new Float64Array(28), sin: new Float64Array(28) }; map.set(key, group); }
        const hCosR = (r0 + rc) * gain, hSinR = -(i0 - ic) * gain;
        const hCosI = (i0 + ic) * gain, hSinI = (r0 - rc) * gain;
        const kxNorm = (kx / m) * chopFactor, kzNorm = (kz / m) * chopFactor;
        const kxzNorm = (kx * kz / m) * chopFactor, kxxNorm = (kx * kx / m) * chopFactor, kzzNorm = (kz * kz / m) * chopFactor;
        for (let t = 0; t < 4; t++) {
          const [wxr, wxi] = wxTable[t][px], [wzr, wzi] = wzTable[t][pz];
          const wr = wxr * wzr - wxi * wzi, wi = wxr * wzi + wxi * wzr;
          const reCos = hCosR * wr - hCosI * wi, reSin = hSinR * wr - hSinI * wi;
          const ihCos = -hCosI * wr - hCosR * wi, ihSin = -hSinI * wr - hSinR * wi;
          const base = t * 7;
          group.cos[base + 0] += ihCos * kxNorm; group.sin[base + 0] += ihSin * kxNorm;
          group.cos[base + 1] += reCos;          group.sin[base + 1] += reSin;
          group.cos[base + 2] += ihCos * kzNorm; group.sin[base + 2] += ihSin * kzNorm;
          group.cos[base + 3] += -reCos * kxzNorm; group.sin[base + 3] += -reSin * kxzNorm;
          group.cos[base + 4] += -reCos * kxxNorm; group.sin[base + 4] += -reSin * kxxNorm;
          group.cos[base + 5] += -reCos * kzzNorm; group.sin[base + 5] += -reSin * kzzNorm;
          if (wxMip3 && wzMip3) {
            const [mxr, mxi] = wxMip3[t][px], [mzr, mzi] = wzMip3[t][pz];
            const mwr = mxr * mzr - mxi * mzi, mwi = mxr * mzi + mxi * mzr;
            group.cos[base + 6] += hCosR * mwr - hCosI * mwi;
            group.sin[base + 6] += hSinR * mwr - hSinI * mwi;
          }
        }
      }
    }
    this.anchorGroups = Array.from(map.values());
  }
  updateAnchor(time: number, syncSlot0 = true): void {
    if (!this.anchorGroups.length) return;
    const p = this.parameters, clock = spectrumClock(p), T = (p.loop ? wrapTime(time + p.phaseOffset) : time + p.phaseOffset) * clock;
    const storm = this.storm, chop = p.chop, crest = p.model === 'phillips' ? 0 : p.crestSharpening;
    const peak = windSpectrum(p.wind, p.fetch).peak, peakK = peak * peak / 9.81;
    const uVariance = this.cascades[0].seed.heroVariance * storm * storm, rms = Math.max(Math.sqrt(uVariance), 0.1);
    const val = new Float64Array(28), der = new Float64Array(28);
    for (let i = 0; i < this.anchorGroups.length; i++) {
      const g = this.anchorGroups[i], phase = g.omega * T, c = Math.cos(phase), s = Math.sin(phase), w = g.omega * clock;
      const gc = g.cos, gs = g.sin;
      for (let j = 0; j < 28; j++) {
        val[j] += gc[j] * c + gs[j] * s;
        der[j] += w * (-gc[j] * s + gs[j] * c);
      }
    }
    const txPos = new Float64Array(12), txVel = new Float64Array(12), txJ = new Float64Array(4);
    for (let t = 0; t < 4; t++) {
      const b = t * 7;
      const dx = val[b + 0] * storm * chop, vdx = der[b + 0] * storm * chop;
      let dy = val[b + 1] * storm, vdy = der[b + 1] * storm;
      const dz = val[b + 2] * storm * chop, vdz = der[b + 2] * storm * chop;
      const xz = val[b + 3] * storm * chop, vxz = der[b + 3] * storm * chop;
      const xx = 1 + val[b + 4] * storm * chop, vxx = der[b + 4] * storm * chop;
      const zz = 1 + val[b + 5] * storm * chop, vzz = der[b + 5] * storm * chop;
      const J = xx * zz - xz * xz, vJ = vxx * zz + xx * vzz - 2 * xz * vxz;
      if (crest > 0) {
        const longY = val[b + 6] * storm, vLongY = der[b + 6] * storm;
        const pinch = Math.max(0, Math.min(0.92, 1 - J)), vPinch = (1 - J > 0 && 1 - J < 0.92) ? -vJ : 0;
        const u = Math.max(0, Math.min(1, (dy / rms + 0.2) / 0.55)), sm = u * u * (3 - 2 * u), dsm = (u > 0 && u < 1) ? 6 * u * (1 - u) * (vdy / (0.55 * rms)) : 0;
        dy += crest * peakK * (longY * longY - uVariance) + crest * 0.65 * rms * pinch * pinch * sm;
        vdy += crest * peakK * 2 * longY * vLongY + crest * 0.65 * rms * (2 * pinch * vPinch * sm + pinch * pinch * dsm);
      }
      let limiter = 1, limiterVelocity = 0;
      if (p.model === 'phillips' && J < -.3) {
        const a = xx + zz - 2, b = (xx - 1) * (zz - 1) - xz * xz;
        limiter = 2.6 / (Math.sqrt(Math.max(0, a * a - 5.2 * b)) - a);
        const da = vxx + vzz, db = vxx * (zz - 1) + (xx - 1) * vzz - 2 * xz * vxz;
        limiterVelocity = -(limiter * da + limiter * limiter * db) / (a + 2 * limiter * b);
      }
      txPos[t * 3 + 0] = dx * limiter; txPos[t * 3 + 1] = dy; txPos[t * 3 + 2] = dz * limiter;
      txVel[t * 3 + 0] = vdx * limiter + dx * limiterVelocity; txVel[t * 3 + 1] = vdy; txVel[t * 3 + 2] = vdz * limiter + dz * limiterVelocity;
      txJ[t] = J;
    }
    const scale = 10 / p.sheetSizeMetres, stepM = p.sheetSizeMetres / 512;
    const d0x = 0.25 * (txPos[0] + txPos[3] + txPos[6] + txPos[9]);
    const d0y = 0.25 * (txPos[1] + txPos[4] + txPos[7] + txPos[10]);
    const d0z = 0.25 * (txPos[2] + txPos[5] + txPos[8] + txPos[11]);
    const v0x = 0.25 * (txVel[0] + txVel[3] + txVel[6] + txVel[9]) * scale;
    const v0y = 0.25 * (txVel[1] + txVel[4] + txVel[7] + txVel[10]) * scale;
    const v0z = 0.25 * (txVel[2] + txVel[5] + txVel[8] + txVel[11]) * scale;
    const dXpX = 0.5 * (txPos[3] + txPos[9]), dXmX = 0.5 * (txPos[0] + txPos[6]);
    const dXpY = 0.5 * (txPos[4] + txPos[10]), dXmY = 0.5 * (txPos[1] + txPos[7]);
    const dXpZ = 0.5 * (txPos[5] + txPos[11]), dXmZ = 0.5 * (txPos[2] + txPos[8]);
    const dZpX = 0.5 * (txPos[6] + txPos[9]), dZmX = 0.5 * (txPos[0] + txPos[3]);
    const dZpY = 0.5 * (txPos[7] + txPos[10]), dZmY = 0.5 * (txPos[1] + txPos[4]);
    const dZpZ = 0.5 * (txPos[8] + txPos[11]), dZmZ = 0.5 * (txPos[2] + txPos[5]);
    const txx = 1 + (dXpX - dXmX) / (2 * stepM), txy = (dXpY - dXmY) / (2 * stepM), txz = (dXpZ - dXmZ) / (2 * stepM);
    const tzx = (dZpX - dZmX) / (2 * stepM), tzy = (dZpY - dZmY) / (2 * stepM), tzz = 1 + (dZpZ - dZmZ) / (2 * stepM);
    const J = txx * tzz - txz * tzx;
    let nx = tzy * txz - tzz * txy, ny = tzz * txx - tzx * txz, nz = tzx * txy - tzy * txx;
    const nLen = Math.hypot(nx, ny, nz) || 1; nx /= nLen; ny /= nLen; nz /= nLen;
    const now = performance.now();
    const a = this.anchor;
    a.x = d0x * scale; a.y = d0y * scale + this.anchorInteractionY; a.z = d0z * scale;
    a.nx = nx; a.ny = ny; a.nz = nz; a.px = 0; a.pz = 0; a.jacobian = J;
    a.velocityX = boundedVelocity(v0x); a.velocityY = boundedVelocity(v0y); a.velocityZ = boundedVelocity(v0z);
    a.time = time; a.valid = true; a.residual = 0; a.requestedX = 0; a.requestedZ = 0;
    a.sampledAt = now; a.receivedAt = now; a.sequence++;
    if (syncSlot0 && Math.hypot(this.points[0].x, this.points[0].y) < 1e-4 && this.points[0].z < 0.5) {
      Object.assign(this.sample, a);
    }
  }
  private rebuildCascades(): void {
    const p = this.parameters, peak = windSpectrum(p.wind, p.fetch).peak;
    this.cascades.forEach(cascade => cascade.dispose()); this.cascades = bands(p.cascadeLengths).map((band, i) => new Cascade(this.pass, makeSpectrum(band, p, p.seed + i * 9173), peak * peak / 9.81));
    this.heroHs = 4 * Math.sqrt(this.cascades.reduce((sum, cascade) => sum + cascade.seed.heroVariance, 0));
    const u = this.geometryMaterial.uniforms; u.uD0.value = this.cascades[0].maps.textures[0]; u.uD1.value = this.cascades[1].maps.textures[0]; u.uR0.value = this.cascades[0].fft.output.textures[1]; u.uR1.value = this.cascades[1].fft.output.textures[1]; u.uSize.value = p.sheetSizeMetres; u.uLengths.value.fromArray(p.cascadeLengths);
    u.uPeakK.value = peak * peak / 9.81;
    this.foamMaterial.uniforms.uD2.value = this.cascades[2].maps.textures[0]; this.foamMaterial.uniforms.uR2.value = this.cascades[2].fft.output.textures[1]; this.foamMaterial.uniforms.uLength2.value = p.cascadeLengths[2];
    const foam = this.foamMaterial.uniforms, c0 = this.cascades[0], c1 = this.cascades[1];
    foam.uMacroD0.value = c0.maps.textures[0]; foam.uMacroD1.value = c1.maps.textures[0]; foam.uMacroG0.value = c0.maps.textures[1]; foam.uMacroG1.value = c1.maps.textures[1];
    foam.uMacroLengths.value.set(c0.seed.band.L, c1.seed.band.L); foam.uMacroGrids.value.set(c0.seed.band.N, c1.seed.band.N); foam.uMacroFootprint.value = p.model === 'phillips' ? .06 * p.sheetSizeMetres : .1 * 2 * Math.PI * 9.81 / (peak * peak);
    u.uPhillips.value = p.model === 'phillips';
    this.interaction.size = p.sheetSizeMetres; this.interaction.radius = this.ballRadius * p.sheetSizeMetres / 10; this.interaction.reset(); this.probeMaterial.uniforms.uSize.value = p.sheetSizeMetres;
    this.ballStateMaterial.uniforms.uSize.value = p.sheetSizeMetres; this.ballStateMaterial.uniforms.uRimRadius.value = this.ballRadius + 1.5 * 10 / this.interaction.N;
    this.anchorInteractionY = 0;
    this.buildAnchorGroups();
    for (const s of this.samples) s.valid = false;
  }
  evolve(time: number): void { this.time = time; const high = this.cascades[2].seed.band.high; for (const cascade of this.cascades) cascade.step(time, this.parameters, high, this.storm); this.geometryMaterial.uniforms.uCrest.value = this.parameters.model === 'phillips' ? 0 : this.parameters.crestSharpening; this.geometryMaterial.uniforms.uVariance.value = this.cascades[0].seed.heroVariance * this.storm * this.storm; this.pass.draw(this.geometryMaterial, this.baseGeometry); }
  compose(): void {
    const u = this.surfaceMaterial.uniforms; u.uFrozen.value = this.frozen; u.uFrame.value = wrapTime(this.time) / LOOP * 121; u.uSize.value = this.parameters.sheetSizeMetres; u.uRelief.value = this.parameters.foamRelief * this.storm * this.storm; u.uInteraction.value = this.interaction.texture; u.uFoam.value = this.history;
    this.pass.draw(this.surfaceMaterial, this.geometry);
    this.ballStateMaterial.uniforms.uInteraction.value = this.interaction.texture;
    this.ballStateMaterial.uniforms.uSize.value = this.parameters.sheetSizeMetres;
    this.pass.draw(this.ballStateMaterial, this.ballState);
    this.updateAnchor(this.time, !this.frozen);
  }
  updateFoam(dt: number): void {
    if (dt <= 0) return;
    const u = this.foamMaterial.uniforms, p = this.parameters; u.uPrevious.value = this.history; u.uDt.value = dt; u.uDecay.value = p.foamDecay; u.uThreshold.value = p.Jthr; u.uSize.value = p.sheetSizeMetres; u.uSlip.value = p.foamSlip; u.uDiffusion.value = p.foamDiffusion;
    u.uBulkBirthTime.value = p.model === 'phillips' ? .02 : .045; u.uMacroHs.value = this.heroHs * this.storm; const windAngle = p.model === 'phillips' ? PHILLIPS_WIND_ANGLE : Math.PI / 4; u.uWindDirection.value.set(Math.cos(windAngle), Math.sin(windAngle));
    this.pass.draw(this.foamMaterial, this.foam[1 - this.foamIndex]); this.foamIndex = 1 - this.foamIndex;
  }
  private async foamValues(): Promise<Float32Array> { const data = new Float32Array(this.heights.length); this.copyFoam.uniforms.uHistory.value = this.history; this.pass.draw(this.copyFoam, this.diagnosticTarget); await this.renderer.readRenderTargetPixelsAsync(this.diagnosticTarget, 0, 0, 256, 256, data); return data; }
  private labelFoamPatches(data: Float32Array, frame: number): void {
    const N = 256, count = N * N, seen = new Uint8Array(count), queue = new Uint32Array(count), start = frame * count;
    this.patchData.fill(0, start, start + count); const areas: number[] = [];
    for (let seed = 0; seed < count; seed++) {
      if (seen[seed] || data[seed * 4] < .3) continue;
      let head = 0, tail = 1; queue[0] = seed; seen[seed] = 1;
      while (head < tail) {
        const i = queue[head++], x = i % N, z = Math.floor(i / N);
        for (const next of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, z > 0 ? i - N : -1, z < N - 1 ? i + N : -1]) {
          if (next < 0 || seen[next] || data[next * 4] < .3) continue;
          seen[next] = 1; queue[tail++] = next;
        }
      }
      if (tail < Math.ceil(count * .015)) continue;
      areas.push(tail / count); for (let i = 0; i < tail; i++) this.patchData[start + queue[i]] = 255;
    }
    this.patchAreas[frame] = areas;
  }
  async rebuild(progress: (fraction: number, stage: string) => void = () => {}): Promise<void> {
    this.ready = false; if (this.pending) await this.pending; this.rebuildCascades();
    const clear = computeMaterial('out vec4 outColor;void main(){outColor=vec4(0.);}'); this.pass.draw(clear, this.foam[0]); this.pass.draw(clear, this.foam[1]); clear.dispose(); this.foamIndex = 0; this.foamConvergence = [];
    if (!this.parameters.loop) { this.frozen = false; this.evolve(this.time); this.compose(); await this.readSample(this.time, true); this.ready = true; progress(1, 'True-dispersion FFT ready'); return; }
    let previous: Float32Array = new Float32Array(this.heights.length);
    for (let cycle = 0; cycle < 8; cycle++) {
      for (let step = 0; step < 121; step++) {
        this.evolve(step * LOOP / 121); this.updateFoam(LOOP / 121);
        if (step % 16 === 0) { progress(.07 + .75 * (cycle + step / 121) / 8, `Converging foam · cycle ${cycle + 1}`); await nextFrame(); }
      }
      const current = await this.foamValues(); let delta = 0;
      for (let i = 0; i < current.length; i += 4) delta = Math.max(delta, Math.abs(current[i] - previous[i]), Math.abs(current[i + 1] - previous[i + 1]), Math.abs(current[i + 2] - previous[i + 2]));
      this.foamConvergence.push(delta); previous = current;
      if (cycle >= 2 && delta < .001) break;
    }
    if (this.foamConvergence.at(-1)! >= .001) throw new Error(`Foam did not converge: ${this.foamConvergence.join(', ')}`);
    // Only the converged material-coordinate history is cached, never geometry.
    for (let step = 0; step < 121; step++) {
      this.evolve(step * LOOP / 121); this.updateFoam(LOOP / 121); this.copyFoam.uniforms.uHistory.value = this.history; this.pass.draw(this.copyFoam, this.frozenFoam, step);
      this.labelFoamPatches(await this.foamValues(), step);
      if (step % 16 === 0) { progress(.82 + .17 * step / 121, 'Retaining converged foam cycle'); await nextFrame(); }
    }
    this.foamPatches.needsUpdate = true;
    this.frozen = true; this.evolve(0); this.compose(); await this.readSample(0, true); this.ready = true; progress(1, 'GPU ocean ready');
  }
  async seek(time: number): Promise<void> {
    this.ready = false; if (this.pending) await this.pending; this.interaction.reset(); this.anchorInteractionY = 0; this.frozen = this.parameters.loop;
    if (this.frozen) this.evolve(time);
    else {
      const clear = computeMaterial('out vec4 outColor;void main(){outColor=vec4(0.);}'); this.pass.draw(clear, this.foam[0]); this.pass.draw(clear, this.foam[1]); clear.dispose(); this.foamIndex = 0;
      const steps = Math.ceil(Math.max(3 * LOOP, 7 * this.parameters.foamDecay) / .03);
      for (let step = -steps; step <= 0; step++) { this.evolve(time + step * .03); this.updateFoam(.03); if (step % 24 === 0) await nextFrame(); }
    }
    this.compose(); await this.readSample(time, true); this.ready = true;
  }
  frame(time: number, dt: number, interactionDt = dt): void {
    if (this.frozen) { this.resumeFoamMaterial.uniforms.uFrame.value = wrapTime(this.time) / LOOP * 121; this.pass.draw(this.resumeFoamMaterial, this.foam[0]); this.foamIndex = 0; }
    this.frozen = false; this.interaction.step(interactionDt); this.evolve(time);
    const steps = Math.max(1, Math.ceil(dt / .03)); for (let i = 0; i < steps; i++) this.updateFoam(dt / steps);
    this.compose(); void this.readSample(time, false);
  }
  async readSample(time: number, wait: boolean): Promise<void> {
    if (this.pending) { if (!wait) return; await this.pending; return this.readSample(this.time, true); }
    for (let i = 0; i < this.probeCount; i++) {
      this.pendingPoints[i].set(this.points[i].x, this.points[i].y);
      this.pendingEulerian[i] = this.points[i].z > .5;
    }
    const sampledAt = performance.now(); this.requestedAt = sampledAt;
    this.pass.draw(this.probeMaterial, this.probe);
    this.pending = this.renderer.readRenderTargetPixelsAsync(this.probe, 0, 0, this.probeCount, 8, this.probeData).then(() => {
      const receivedAt = performance.now();
      for (let slot = 0; slot < this.probeCount; slot++) {
        if (!wait && slot === 0 && !this.frozen && Math.hypot(this.pendingPoints[0].x, this.pendingPoints[0].y) < 1e-4 && !this.pendingEulerian[0]) continue;
        const i = slot * 4, n = i + this.probeCount * 4, q = i + this.probeCount * 8, d = this.probeData, s = this.samples[slot];
        s.sequence++; s.valid = d[n + 3] > .5 && Number.isFinite(d[i] + d[i + 1] + d[i + 2]); s.residual = d[q + 2];
        if (!s.valid) continue;
        const delta = wrapTime(time - s.time), eulerian = this.pendingEulerian[slot];
        if (!this.frozen && Number.isFinite(s.receivedAt) && delta > .0001 && delta < .16) {
          const dx = d[i] - s.x, dz = d[i + 2] - s.z;
          const spatial = eulerian && Math.abs(d[n + 1]) > .25 ? -(d[n] * dx + d[n + 2] * dz) / d[n + 1] : 0;
          const blend = 1 - Math.exp(-delta / .035);
          s.velocityX += ((eulerian ? 0 : boundedVelocity(dx / delta)) - s.velocityX) * blend;
          s.velocityY += (boundedVelocity((d[i + 1] - s.y - spatial) / delta) - s.velocityY) * blend;
          s.velocityZ += ((eulerian ? 0 : boundedVelocity(dz / delta)) - s.velocityZ) * blend;
        } else if (this.frozen || delta >= .16 || delta <= .0001) s.velocityX = s.velocityY = s.velocityZ = 0;
        s.x = d[i]; s.y = d[i + 1]; s.z = d[i + 2]; s.jacobian = d[i + 3];
        s.nx = d[n]; s.ny = d[n + 1]; s.nz = d[n + 2]; s.px = d[q]; s.pz = d[q + 1];
        s.time = time; s.sampledAt = sampledAt; s.receivedAt = receivedAt;
        s.requestedX = this.pendingPoints[slot].x; s.requestedZ = this.pendingPoints[slot].y;
      }
      this.readbackLatencyMs = receivedAt - sampledAt; this.maxReadbackLatencyMs = Math.max(this.maxReadbackLatencyMs, this.readbackLatencyMs); this.pending = undefined;
    }, error => { this.pending = undefined; console.error('GPU surface probe failed', error); });
    if (wait) await this.pending;
  }
  diagnostics() {
    const previous = this.renderer.getRenderTarget(); this.copyFoam.uniforms.uHistory.value = this.geometry.texture; this.pass.draw(this.copyFoam, this.diagnosticTarget); this.renderer.readRenderTargetPixels(this.diagnosticTarget, 0, 0, 256, 256, this.heights);
    let minimum = Infinity, maximum = -Infinity, minJ = Infinity, nonfinite = 0, sumH = 0;
    for (let i = 0; i < this.heights.length; i += 4) { const h = this.heights[i + 1]; if (!Number.isFinite(h)) nonfinite++; else sumH += h; minimum = Math.min(minimum, h); maximum = Math.max(maximum, h); minJ = Math.min(minJ, this.heights[i + 3]); }
    const meanH = sumH / 65536; let aboveMean = 0;
    for (let i = 0; i < this.heights.length; i += 4) if (this.heights[i + 1] > meanH) aboveMean++;
    this.copyFoam.uniforms.uHistory.value = this.geometry.textures[1]; this.pass.draw(this.copyFoam, this.diagnosticTarget); this.renderer.readRenderTargetPixels(this.diagnosticTarget, 0, 0, 256, 256, this.heights);
    let minFinalJ = Infinity, folded = 0;
    for (let i = 0; i < this.heights.length; i += 4) { const J = this.heights[i + 3]; minFinalJ = Math.min(minFinalJ, J); if (J < 0) folded++; }
    this.renderer.setRenderTarget(previous);
    return { ...physicalReport(this.parameters, this.cascades.map(cascade => cascade.seed)), crestToTroughMetres: maximum - minimum, reliefPercent: (maximum - minimum) / this.parameters.sheetSizeMetres * 100,
      areaAboveMeanFraction: aboveMean / 65536,
      minUnlimitedJacobian: minJ, minFinalJacobian: minFinalJ, foldedParameterFraction: folded / 65536, geometryResolution: this.resolution, finalJacobian: 'Finite-difference tangents of final choppy + quadratic crest + foam relief + heightfield geometry; folds are allowed, no no-fold guarantee', nonfinite,
      foam: { coordinates: 'undeformed sheet material metres; orbital displacement is applied once by the surface', historyChannels: 'R bulk density; G short whitecaps; B transported R-weighted fold moment; A coarse source Jacobian, NOT the final surface Jacobian',
        source: 'Art-directed compression of the C0+C1 strain tensor filtered at 0.1 input peak wavelength, selected on large crests; separate C2 whitecaps. Not a breaking-fluid solver.',
        layer: 'Vertical-only billowy fBm relief applied where density > 0.5, feathered with noise erosion; complete finite-difference visual normals; excluded from carrier probes',
        residualSlipMetresPerDisplaySecond: this.parameters.foamSlip, diffusionMetresSquaredPerDisplaySecond: this.parameters.foamDiffusion, decayDisplaySeconds: this.parameters.foamDecay, decayTimebase: 'animation timeline seconds: wall seconds at 1x; no additional physical tau factor', cycleEndMaxDeltas: this.foamConvergence, simulationMaskDenominator: 256 * 256 },
      fft: this.fftResult, floatStorage: this.storageComparison, interactive: { equation: 'h_tt + damping h_t = c² laplacian(h)', size: 256, stepSeconds: this.interaction.stepSeconds, cfl: this.interaction.cfl, steps: this.interaction.steps, impulses: this.interaction.impulses, spherePushes: this.interaction.spherePushes },
      buoyancy: { method: '1x1 GPU float render target + synchronous carrier evaluation for zero-latency anchor; asynchronous batched GPU probes for off-anchor contacts/physics', lastReadbackMs: this.readbackLatencyMs, maxReadbackMs: this.maxReadbackLatencyMs, sampledPhase: this.sample.time, residual: this.sample.residual, valid: this.sample.valid } };
  }
  dispose(): void { this.cascades.forEach(cascade => cascade.dispose()); this.interaction.dispose(); this.baseGeometry.dispose(); this.geometry.dispose(); this.ballState.dispose(); this.foam.forEach(target => target.dispose()); this.frozenFoam.dispose(); this.foamPatches.dispose(); this.probe.dispose(); this.diagnosticTarget.dispose(); this.geometryMaterial.dispose(); this.surfaceMaterial.dispose(); this.ballStateMaterial.dispose(); this.foamMaterial.dispose(); this.copyFoam.dispose(); this.resumeFoamMaterial.dispose(); this.probeMaterial.dispose(); this.pass.dispose(); }
}
