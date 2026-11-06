// Ultra-Water (c) 2026 Humpalumps, MIT; see LICENSE and THIRD_PARTY_NOTICES.md.
import * as THREE from 'three';
import {WATER_GLSL} from './OceanSurface.js';
const VERT_COMMON = /* glsl */`
precision highp float;
${WATER_GLSL}
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform samplerCube uSkyCube;
uniform float uSkyMaxLod;
uniform vec3 uSpray;        // amount, size, max distance
uniform vec2 uResolution;
out vec2 vUv;
out float vCov;
out float vAlpha;
out vec3 vLight;
out float vSeed;
out float vViewZ;

// camera-facing quad of the given size at p; droplets: strong forward scattering of the
// sun + sky ambient
void billboard(vec3 p, float size) {
  // ASTRA PASS8: metres in the finite sheet, then rigid studio transform.
  p=(modelMatrix*vec4(p/uMetresPerWorld,1.)).xyz;size/=uMetresPerWorld;
  // at least a pixel and a half across: a smaller droplet only flickers on and off as it
  // crosses pixel centres, so it's drawn larger and fainter instead
  float px = size * projectionMatrix[1][1] * uResolution.y * 0.5 / max(-(viewMatrix * vec4(p, 1.0)).z, 1e-3);
  vCov = min(px * px / 2.25, 1.0);
  size *= max(1.5 / px, 1.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec4 view = viewMatrix * vec4(p + (right * position.x + up * position.y) * size, 1.0);
  gl_Position = projectionMatrix * view;
  vViewZ = -view.z;
  vUv = position.xy;
  float mu = dot(normalize(p - cameraPosition), uSunDir);
  const float g = 0.6;
  float phase = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 sky = textureLod(uSkyCube, vec3(0.0, 1.0, 0.0), uSkyMaxLod).rgb;
  vLight = 0.9 * (uSunColor * (0.25 + 1.6 * phase) + sky * 1.1);
}
`;

// ASTRA PASS8: deterministic finite emitters; unchanged upstream ballistic/drag law.
const VERT=VERT_COMMON+/* glsl */`
uniform highp sampler2DArray uSprayHistory; uniform vec2 uCrestVelocity;
// ASTRA PASS9: existing spawn histories follow the same two anchor spectra.
uniform highp sampler2DArray uStormSprayHistory;
uniform float uHistoryBlend;uniform vec2 uHistoryGains;uniform bool uStormHistoryReady;
uniform vec4 uFoam;in vec4 aEmit;
void main(){
  vAlpha=0.;gl_Position=vec4(2.,2.,2.,1.);
  vec2 e=aEmit.xy;float r1=aEmit.z,r2=aEmit.w;
  float frame=floor(r1*121.),age=mod(uTime-frame*.03+3.63,3.63);
  vec4 sample_=texture(uSprayHistory,vec3(e/uSize+.5,frame));
  // ASTRA PASS9: exact anchors; interpolate only the existing displacement/foam data.
  if(uHistoryBlend>0. && uStormHistoryReady){
    vec4 storm=texture(uStormSprayHistory,vec3(e/uSize+.5,frame));
    if(uHistoryBlend>=1.)sample_=storm;
    else {sample_.xyz=sample_.xyz*(1.-uHistoryBlend)*uHistoryGains.x+storm.xyz*uHistoryBlend*uHistoryGains.y;sample_.w=mix(sample_.w,storm.w,uHistoryBlend);}
  }else if(uHistoryBlend>0.){
    sample_.xyz=waterAt(e,vec3(0.));
    sample_.w=textureLod(uDisp0,e/uLength.x,0.).w+textureLod(uDisp1,e/uLength.y,0.).w+textureLod(uDisp2,e/uLength.z,0.).w-2.;
  }
  float a=max(sample_.y,0.),strength=clamp((uFoam.x-sample_.w)*uFoam.y,0.,1.)*smoothstep(.25,.55,a);
  float life=.9+1.5*r2;
  if(strength<=.01||age>life)return;
  const float KD=1.7,G=9.81;
  float ex=(1.-exp(-KD*age))/KD;
  float c=length(uCrestVelocity);vec2 dir=normalize(uCrestVelocity);
  vec2 side=vec2(-dir.y,dir.x)*(fract(r1*31.7)-.5)*1.6;
  vec2 xz=e+sample_.xz+side+dir*c*(.25+.45*fract(r2*17.3))*ex;
  float vy=(1.2+3.2*fract(r1*7.9))*sqrt(a);
  float y=sample_.y+(vy+G/KD)*ex-G*age/KD;
  if(y<sample_.y-.3)return;
  float size=(.05+.35*age)*(.6+.8*fract(r2*5.3))*uSpray.y*sqrt(a/.5);
  billboard(vec3(xz.x,y,xz.y),size);vSeed=r1;
  vAlpha=strength*uSpray.x*smoothstep(0.,.12,age)*pow(1.-age/life,1.5)*smoothstep(1.,4.,vViewZ);
}`;
const SPLASH_PER_IMPACT = 160;
const SPLASH_VERT = VERT_COMMON + /* glsl */`
void main() {
  vAlpha = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vec4 e = uImpact[gl_InstanceID % 8];
  float L = uImpactSize[gl_InstanceID % 8];
  float r1 = hash12(vec2(float(gl_InstanceID), 1.7)), r2 = hash12(vec2(float(gl_InstanceID), 8.3));
  float r3 = hash12(vec2(float(gl_InstanceID), 4.1));
  float life = 0.5 + 1.1 * r2;
  float age = e.z;
  if (e.w <= 0.0 || age > life) return;
  const float KD = 1.2, G = 9.81;
  float ex = (1.0 - exp(-KD * age)) / KD;
  float ang = r1 * 2.0 * PI;
  vec2 out_ = vec2(cos(ang), sin(ang));
  float strength = sqrt(e.w / 0.2);
  float vy = (1.5 + 4.0 * r3 * r3) * strength;
  vec2 xz = e.xy + out_ * (L * (0.6 + 0.5 * r2) + (0.5 + 2.0 * r3) * strength * ex);
  float y = (vy + G / KD) * ex - G * age / KD;
  if (y < -0.2) return;
  // ASTRA PASS8: the crown starts at the floating FFT surface rather than sea level.
  y+=waterAt(e.xy,vec3(0.)).y;
  billboard(vec3(xz.x, y, xz.y), (0.05 + 0.25 * age) * (0.5 + r2) * uSpray.y);
  vSeed = r1;
  vAlpha = uSpray.x * 0.6 * smoothstep(0.0, 0.05, age) * pow(1.0 - age / life, 1.5)
         * smoothstep(-0.2, 0.1, y) * smoothstep(1.0, 4.0, vViewZ);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uSceneDepth;
uniform sampler2D uFoamTex;
uniform vec2 uResolution;
uniform vec2 uNearFar;
in vec2 vUv;
in float vAlpha;
in vec3 vLight;
in float vSeed;
in float vViewZ;
in float vCov;
out vec4 fragColor;

void main() {
  float r = length(vUv);
  if (vAlpha <= 0.0 || r > 1.0) discard;
  // a cloud of droplets, not a smooth gaussian: whole soft puffs read as cotton balls
  float n = texture(uFoamTex, vUv * 0.08 + vSeed * 17.0).r;
  float drops = smoothstep(0.35, 0.7, texture(uFoamTex, vUv * 0.3 + vSeed * 7.0).r);
  float a = vAlpha * vCov * exp(-3.5 * r * r) * (0.5 + n) * drops * 1.6;
  // soft against the opaque scene (the water surface itself is handled by the depth test)
  float d = texelFetch(uSceneDepth, ivec2(gl_FragCoord.xy), 0).r * 2.0 - 1.0;
  float sceneZ = 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - d * (uNearFar.y - uNearFar.x));
  a *= clamp((sceneZ - vViewZ) / 0.8, 0.0, 1.0);
  fragColor = vec4(vLight * a, a);
}`;

function quads(count) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.instanceCount = count;
  return geo;
}

// ASTRA PASS8: no shore map, rocks or beach swash in the finite chunk.
export class Spray{
  constructor(surface,history,count=12288){
    this.params={amount:.65,size:1,distance:350};
    this.uniforms={...surface.uniforms,uSpray:{value:new THREE.Vector3()},uSprayHistory:{value:history}};
    // ASTRA PASS9: all anchors use the upstream emitter count and particle shader.
    Object.assign(this.uniforms,{uStormSprayHistory:{value:history},uHistoryBlend:{value:0},uHistoryGains:{value:new THREE.Vector2(1,1)},uStormHistoryReady:{value:false}});
    let seed=11;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    const data=new Float32Array(count*4),size=surface.uniforms.uSize.value;
    for(let i=0;i<count;i++)data.set([(rand()-.5)*size,(rand()-.5)*size,rand(),rand()],i*4);
    const geo=quads(count);geo.setAttribute('aEmit',new THREE.InstancedBufferAttribute(data,4));
    const material=vertexShader=>new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader:FRAG,uniforms:this.uniforms,
      transparent:true,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor});
    this.mesh=new THREE.Mesh(geo,material(VERT));this.mesh.frustumCulled=false;
    this.splash=new THREE.Mesh(quads(8*SPLASH_PER_IMPACT),material(SPLASH_VERT));this.splash.frustumCulled=false;
  }
  update(){this.uniforms.uSpray.value.set(this.params.amount,this.params.size,this.params.distance);this.mesh.visible=this.splash.visible=this.params.amount>0;}
  dispose(){for(const mesh of [this.mesh,this.splash]){mesh.geometry.dispose();mesh.material.dispose();}}
}
