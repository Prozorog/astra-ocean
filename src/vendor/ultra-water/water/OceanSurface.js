// Ultra-Water (c) 2026 Humpalumps, MIT; see LICENSE and THIRD_PARTY_NOTICES.md.
import * as THREE from 'three';
import {N} from './OceanSim.js';
// ASTRA PASS8: no shore maps, bathymetry, Earth curvature or underwater branch.
export const WATER_GLSL = /* glsl */`
#define N_TEX ${N.toFixed(1)}
#define PI 3.14159265359
uniform sampler2D uDisp0,uDisp1,uDisp2,uSlope0,uSlope1,uSlope2,uSlope3;
uniform sampler2D uRipple;
uniform vec4 uLength;
uniform float uTime,uSize,uMetresPerWorld;
uniform vec4 uImpact[8]; uniform float uImpactSize[8];
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + 1.0), u.x), u.y);
}

// Ripple rings from objects hitting the water (Cauchy-Poisson): by stationary phase a
// point impulse gives local wavenumber k = g t^2 / (4 r^2) at radius r and phase k r, so
// long waves race ahead and short ones trail inside. A splash of radius L excites
// ~ (kL)^2 exp(-(kL)^2); kMax band-limits to what the mesh or pixel can show.
// Returns (height, dh/dx, dh/dz).
vec3 impactWaves(vec2 xz, float kMax) {
  vec3 o = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 e = uImpact[i];
    if (e.w <= 0.0) continue;
    vec2 dv = xz - e.xy;
    float r = length(dv) + 1e-3, L = uImpactSize[i];
    float k = 9.81 * e.z * e.z / (4.0 * r * r);
    float kl2 = k * k * L * L;
    float amp = e.w * 2.72 * kl2 * exp(-kl2 - k * k / (kMax * kMax) - 0.12 * e.z) * L / (L + r);
    float ph = k * r;
    o.x += amp * cos(ph);
    o.yz += dv / r * (amp * k * sin(ph));
  }
  return o;
}


// ASTRA PASS8: 256² interaction heightfield, sampled in sheet-local metres.
vec3 rippleAt(vec2 xz) {
  vec2 uv=xz/uSize+0.5, e=vec2(1.0/256.0,0.0);
  float h=textureLod(uRipple,uv,0.0).r;
  vec2 slope=vec2(textureLod(uRipple,uv+e,0.0).r-textureLod(uRipple,uv-e,0.0).r,
                  textureLod(uRipple,uv+e.yx,0.0).r-textureLod(uRipple,uv-e.yx,0.0).r)/(2.0*uSize/256.0);
  return vec3(h,slope);
}
vec3 waterDisplacement(vec2 xz,vec3 lod) {
  vec3 d=textureLod(uDisp0,xz/uLength.x,max(lod.x,0.0)).xyz
        +textureLod(uDisp1,xz/uLength.y,max(lod.y,0.0)).xyz
        +textureLod(uDisp2,xz/uLength.z,max(lod.z,0.0)).xyz;
  d.y+=rippleAt(xz).x;
  return d;
}
vec3 waterAt(vec2 q,vec3 lod) {
  vec2 p=q;
  for(int i=0;i<4;i++)p=q-waterDisplacement(p,lod).xz;
  return waterDisplacement(p,lod);
}
`;
// ASTRA PASS8: fixed 512²-vertex sheet, rigid object transform only.
export const VERT = WATER_GLSL + /* glsl */`
uniform float uWind,uBillow; uniform sampler2D uFoamTex;
out vec3 vWorld; out vec2 vXZ; out float vUnresolved;
out vec3 vLocal; out mat3 vSheetRotation;
void main(){
  vec2 xz=position.xz*uMetresPerWorld;
  float cell=uSize/511.0;
  vec3 d=waterDisplacement(xz,log2(cell*N_TEX/uLength.xyz)+1.0);
  vec4 m0=textureLod(uSlope0,vec2(.5),8.0),m1=textureLod(uSlope1,vec2(.5),8.0);
  vec4 m2=textureLod(uSlope2,vec2(.5),8.0),m3=textureLod(uSlope3,vec2(.5),8.0);
  vUnresolved=max(.003+.00512*uWind-(m0.z+m0.w+m1.z+m1.w+m2.z+m2.w+m3.z+m3.w),0.0);
  vXZ=xz;vLocal=vec3(xz.x+d.x,d.y,xz.y+d.z);
  vSheetRotation=mat3(modelMatrix);
  vWorld=(modelMatrix*vec4(vLocal/uMetresPerWorld+vec3(0.,position.y,0.),1.)).xyz;
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`;
export const FRAG = WATER_GLSL + /* ASTRA PASS8: no island shadow include */ /* glsl */`
precision highp sampler2DShadow;
uniform vec2 uResolution;
uniform vec2 uNearFar;
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform samplerCube uSkyCube;
uniform float uSkyMaxLod;
uniform sampler2D uFoamTex;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAbsorption;
uniform vec3 uScatterColor;
uniform vec3 uFoamTint;     // thin foam: the water colour showing through the bubbles
uniform vec4 uSSS;          // peak strength, view strength, shadow strength, -
uniform vec4 uFoam;         // bias, scale, shore band (m), brightness
// ASTRA PASS8: retained optics; no rock/bathymetry uniforms.
uniform vec4 uUnusedRock;         // surf rock: centre xz, waterline radius (m; 0 = none), unused
uniform vec4 uOptics;       // base roughness, refraction strength, reflection distortion, fog density
uniform vec3 uCamForward;
uniform int uDebug;
uniform float uGlint;
uniform float uCamSide;     // -1 camera above the surface, 1 below, 0 straddling it
// ASTRA PASS8: same local FFT field is rotated with the finite sheet.
uniform mat4 uSheetMatrix; uniform sampler2D uBallState;
uniform vec3 uBallOffset; uniform float uBallRadius,uBallGlow,uBillow;
uniform vec2 uCrestVelocity;
in vec3 vLocal; in mat3 vSheetRotation;
in vec3 vWorld;
in vec2 vXZ;
in float vUnresolved;
out vec4 fragColor;

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}

// ASTRA PASS8: island and floater shadow maps are omitted.
float sunShadow(vec3 p){return 1.0;}

// Poisson count with mean lam from one uniform number: inverse CDF, normal (logistic)
// approximation for large means
float poisson(float lam, float u) {
  if (lam > 6.0) return max(0.0, lam + sqrt(lam) * log(u / (1.0 - u)) / 1.702);
  float p = exp(-lam), F = p, n = 0.0;
  for (int k = 0; k < 14; k++) { if (u <= F) break; n += 1.0; p *= lam / n; F += p; }
  return n;
}

vec3 skyLod(vec3 dir, float lod) {
  // ASTRA PASS8: sample the complete coral studio cube, including its lower hemisphere.
  return textureLod(uSkyCube, dir, lod).rgb;
}

void main() {
  // folded crests flip triangles; drop faces that can't face the camera's side
  if (gl_FrontFacing ? uCamSide > 0.5 : uCamSide < -0.5) discard;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 uv = gl_FragCoord.xy / uResolution;

  // --- surface: slopes + slope variance from the three cascades -----------------
  // ASTRA PASS8: full cascades; a floating sheet has no shore depth damping.
  float depthBelow=60.0; vec3 damp=vec3(1.0);
  vec4 s0=texture(uSlope0,vXZ/uLength.x),s1=texture(uSlope1,vXZ/uLength.y);
  vec4 s2=texture(uSlope2,vXZ/uLength.z),s3=texture(uSlope3,vXZ/uLength.w);
  // wind slicks: surfactant patches damp the short waves (capillaries most), so the far
  // field breaks into calm and rough streaks instead of a uniform speckle
  float slick = smoothstep(0.3, 0.7, vnoise(vXZ * 0.006 + 0.01 * vec2(cos(uTime*2.0*PI/3.63),sin(uTime*2.0*PI/3.63)) /* ASTRA PASS8: periodic drift */));
  float sl2 = mix(0.75, 1.0, slick), sl3 = mix(0.4, 1.0, slick);
  s2.xy *= sl2; s2.zw *= sl2 * sl2; s3.xy *= sl3; s3.zw *= sl3 * sl3;
  vec2 fwXZ = fwidth(vXZ);
  // ASTRA PASS8: no shoreline wave train; heightfield carries interactions.
  vec3 imp = rippleAt(vXZ); // ASTRA PASS8: same height and slopes as geometry
  vec2 slope = s0.xy + s1.xy + s2.xy + s3.xy + imp.yz;
  vec2 variance = max(s0.zw - s0.xy * s0.xy, 0.0) + max(s1.zw - s1.xy * s1.xy, 0.0)
                + max(s2.zw - s2.xy * s2.xy, 0.0) + max(s3.zw - s3.xy * s3.xy, 0.0);
  vec3 Nrm = normalize(vSheetRotation * vec3(-slope.x,1.0,-slope.y)); // ASTRA PASS8: rigid transform
  // the normal's tilt as a screen offset: project a small world step along it
  vec3 vp = (viewMatrix * vec4(vWorld, 1.0)).xyz;
  vec3 dv = mat3(viewMatrix) * vec3(Nrm.x, 0.0, Nrm.z);
  vec2 nS = dv.xy - vp.xy / vp.z * dv.z;

  // geometric specular AA (Kaplanyan): normal change across the pixel adds variance
  vec3 dndx = dFdx(Nrm), dndy = dFdy(Nrm);
  float geoVar = min(0.25 * (dot(dndx, dndx) + dot(dndy, dndy)), 0.18);
  float alpha2 = uOptics.x * uOptics.x + vUnresolved * damp.z * damp.z * sl3 * sl3 + variance.x + variance.y + geoVar;
  float alpha = sqrt(alpha2);

  float NoV = max(dot(Nrm, V), 1e-4);
  float NoL = dot(Nrm, uSunDir);
  float shadow = sunShadow(vWorld);

  // --- foam -------------------------------------------------------------------
  float t0 = texture(uDisp0, vXZ / uLength.x).w, t1 = texture(uDisp1, vXZ / uLength.y).w, t2 = texture(uDisp2, vXZ / uLength.z).w;
  float jac = mix(1.0, t0, damp.x) + mix(1.0, t1, damp.y) + mix(1.0, t2, damp.z) - 2.0;
  float foam = clamp((uFoam.x - jac) * uFoam.y, 0.0, 1.0);

  // ASTRA PASS8: underwater and Snell window branch removed.
  // --- refraction + absorption -------------------------------------------------
  float waterDepth = linearDepth(gl_FragCoord.z);
  float sceneDepth = linearDepth(textureLod(uSceneDepth, uv, 0.0).r);
  float viewCos = max(dot(-V, uCamForward), 0.05);
  float thick = max(sceneDepth - waterDepth, 0.0) / viewCos;
  vec2 ruv = uv + nS * uOptics.y * clamp(thick * 0.25, 0.0, 1.0) / max(waterDepth * 0.02, 1.0);
  float rDepth = linearDepth(textureLod(uSceneDepth, ruv, 0.0).r);
  // the offset landed on something in front of the water: fall back towards no offset,
  // smoothly so object edges don't get a hard outline
  float keep = smoothstep(waterDepth - 0.3, waterDepth + 0.3, rDepth);
  ruv = mix(uv, ruv, keep);
  thick = mix(thick, max(rDepth - waterDepth, 0.0) / viewCos, keep);
  vec3 refracted = textureLod(uSceneColor, ruv, 0.0).rgb;
  vec3 T = exp(-uAbsorption * thick);

  // ASTRA PASS8: convert the studio depth to physical metres for Beer absorption.
  T=exp(-uAbsorption*thick*uMetresPerWorld);
  float vth=thick*uMetresPerWorld;
  float shoreFoam=foam; // ASTRA PASS8: upstream whitewater flow is driven by FFT compression.
  // --- lighting ------------------------------------------------------------------
  vec3 ambient = skyLod(vec3(0.0, 1.0, 0.0), uSkyMaxLod);
  vec3 sun = uSunColor * shadow;
  // in-scatter of the water column (sun + sky), then Atlas-style SSS on crests
  vec3 inscatter = uScatterColor * (ambient + uSunColor * (0.3 + 0.7 * shadow) * max(uSunDir.y, 0.0));
  // over shallow bright sand the light scattered back up has crossed little water: turquoise
  inscatter *= 1.0 + 1.5 * exp(-0.3 * max(depthBelow, 0.0));
  float h = max(vLocal.y, 0.0); // ASTRA PASS8: crest height above the sheet, metres
  float k1 = uSSS.x * h * pow(clamp(dot(uSunDir, -V), 0.0, 1.0), 4.0) * pow(0.5 - 0.5 * NoL, 3.0);
  float k2 = uSSS.y * pow(NoV, 2.0);
  vec3 sss = (k1 + k2) * uScatterColor * sun + uSSS.z * max(NoL, 0.0) * uScatterColor * sun;
  // ASTRA PASS8: no shore lip / sediment turbidity.
  vec3 body=refracted*T+(inscatter+sss)*(1.0-T);

  // Fresnel with roughness-aware F90 (Lagarde) so the rough far field doesn't go white
  const float F0 = 0.02;
  float F90 = max(1.0 - 0.7 * sqrt(alpha), F0);
  float F = F0 + (F90 - F0) * pow(1.0 - NoV, 5.0);

  // ASTRA PASS8: studio cube and the existing ember reflection; no planar island pass.
  vec3 R=reflect(-V,Nrm);
  float lod=clamp(log2(alpha*650.0),0.0,uSkyMaxLod);
  vec3 refl=skyLod(R,lod);
  vec3 ball=(uSheetMatrix*vec4(texelFetch(uBallState,ivec2(0),0).xyz+uBallOffset+vec3(0.,uBallRadius*.4,0.),1.)).xyz;
  vec3 toBall=ball-vWorld;float along=dot(toBall,R), bd=length(toBall);
  float cone=uBallRadius+bd*alpha;
  float hit=(1.-smoothstep(cone*.75,cone,length(toBall-R*max(along,0.))))*step(0.,along);
  refl+=vec3(18.,5.6,.55)*hit*uBallGlow;
  // --- sun specular: GGX, alpha floored so the sun acts as a small area light ---------
  float aS = max(alpha, 0.015);
  float aS2 = aS * aS;
  vec3 H = normalize(uSunDir + V);
  float NoH = max(dot(Nrm, H), 0.0);
  float nl = max(NoL, 0.0);
  float dd = NoH * NoH * (aS2 - 1.0) + 1.0;
  float D = aS2 / (PI * dd * dd);
  float vis = 0.5 / (nl * sqrt(NoV * NoV * (1.0 - aS2) + aS2) + NoV * sqrt(nl * nl * (1.0 - aS2) + aS2) + 1e-5);
  float Fs = F0 + (1.0 - F0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  vec3 spec = sun * (PI * D * vis * Fs * nl);

  // glitter: the lobe as a finite number of sub-pixel facets. Per cell of about the
  // pixel footprint the expected count mirroring the sun is lam = facet density * area *
  // D * (sun solid angle / 4 VoH); a Poisson draw / lam scales the smooth lobe (mean 1,
  // energy kept). Dense cells (close to the lobe core, far away) stay smooth, sparse
  // ones break into points; each cell crossfades between draws so they twinkle.
  if (uGlint > 0.0 && dot(spec, vec3(1.0)) > 0.02) {
    const float FACETS = 2e4;   // per m^2 (calibration knob)
    float lf = log2(max(max(fwXZ.x, fwXZ.y), 1e-3)) + 1.0;
    float l0 = floor(lf);
    float per = FACETS * D * NoH * 6.8e-5 / (4.0 * max(dot(V, H), 0.05));
    float m = 0.0;
    for (int j = 0; j < 2; j++) {
      float l = l0 + float(j), sz = exp2(l);
      vec2 cell = floor(vXZ / sz);
      float lam = per * sz * sz;
      float tt = sin(uTime*2.0*PI/3.63) * 2.0 + /* ASTRA PASS8: periodic glint clock */ hash12(cell + l * 17.17) * 64.0, it = floor(tt);
      float n0 = poisson(lam, clamp(hash12(cell * 1.31 + it * 3.7), 1e-4, 0.9999));
      float n1 = poisson(lam, clamp(hash12(cell * 1.31 + (it + 1.0) * 3.7), 1e-4, 0.9999));
      m += (j == 0 ? 1.0 - (lf - l0) : lf - l0) * min(mix(n0, n1, smoothstep(0.0, 1.0, tt - it)) / max(lam, 1e-4), 30.0);
    }
    spec *= mix(1.0, m, uGlint * smoothstep(4.0, 30.0, dist) * smoothstep(0.05, 0.3, vth));
  }

  // ASTRA PASS8: the emitter lights the water through the SAME vendored GGX BRDF.
  vec3 bL=toBall/max(bd,1e-4),bH=normalize(bL+V);
  float bNL=max(dot(Nrm,bL),0.),bNH=max(dot(Nrm,bH),0.);
  float bDen=bNH*bNH*(aS2-1.)+1.;
  float bD=aS2/(PI*bDen*bDen);
  float bVis=.5/(bNL*sqrt(NoV*NoV*(1.-aS2)+aS2)+NoV*sqrt(bNL*bNL*(1.-aS2)+aS2)+1e-5);
  float bF=F0+(1.-F0)*pow(1.-max(dot(V,bH),0.),5.);
  vec3 ballLight=vec3(18.,5.6,.55)*uBallGlow*(uBallRadius*uBallRadius/max(bd*bd,.1));
  vec3 col=mix(body,refl,F)+spec+ballLight*(PI*bD*bVis*bF*bNL);
  // --- foam surface: eroded by age via the pattern threshold, kills specular ----------
  // erosion: dense foam is nearly solid, ageing foam thins out to the lace network
  // (texture taps only where there is foam; most of the ocean has none). Each source
  // also gives a billow height + gradient (world) and a density for the shading.
  float cover = 0.0, pat = 0.0, fh = 0.5, dens = 0.0;
  vec2 fg = vec2(0.0);
  if (foam > 0.0) {
    vec4 t0 = texture(uFoamTex, vXZ * 0.11);
    pat = t0.r * 0.65 + texture(uFoamTex, vXZ * 0.031 + 0.37).r * 0.35;
    cover = smoothstep(1.05 - foam, 1.3 - foam, pat) * sqrt(foam);
    fh = t0.g; fg = (t0.ba - 0.5) * 64.0 * 0.11; dens = foam;
  }
  if (shoreFoam > 0.0) {
    // whitewater rides shoreward with the bore: a world-space flow map at the phase
    // speed, two phases crossfaded every half period (which also makes it churn). On the
    // displaced surface, so the crest pinch doesn't squash it into streaks; a coordinate
    // tied to the front direction would shear wherever the fronts curve.
    const float FLOW_T = 3.63; // ASTRA PASS8: flow wraps with the display loop   // s
    vec2 vel=uCrestVelocity; // ASTRA PASS8: phase velocity of the existing spectrum peak
    float f0 = fract(uTime / FLOW_T), f1 = fract(uTime / FLOW_T + 0.5), wb = abs(2.0 * f0 - 1.0);
    vec4 b0 = texture(uFoamTex, (vLocal.xz - vel * (f0 * FLOW_T)) * 0.15);
    vec4 b1 = texture(uFoamTex, (vLocal.xz - vel * (f1 * FLOW_T)) * 0.15 + 0.43);
    float sh_ = mix(b0.g, b1.g, wb);
    float sPattern = mix(b0.r, b1.r, wb) * 0.3 + sh_ * 0.45 + texture(uFoamTex, vLocal.xz * 0.023 + 0.5).r * 0.25;
    // lace over a thin, patchy veil on the fresh bore only (an even translucent sheet over
    // the whole inner surf zone reads as ice); in the thin wash it all breaks up into lace
    float sCover = smoothstep(1.0 - shoreFoam * 1.1, 1.45 - shoreFoam * 1.1, sPattern) * sqrt(shoreFoam);
    sCover = max(sCover, 0.3 * smoothstep(0.45, 0.9, shoreFoam) * smoothstep(0.35, 0.7, sPattern) * smoothstep(0.1, 0.5, vth));
    sCover *= mix(0.55, 1.0, smoothstep(0.05, 0.4, vth));
    if (sCover >= cover) {
      pat = sPattern; fh = sh_; dens = shoreFoam;
      fg = mix(b0.ba, b1.ba, wb) * (64.0 * 0.15) - 32.0 * 0.15;
    }
    cover = max(cover, sCover);
  }
  // ASTRA PASS8: beach residual and vanishing-film masks removed.
  if (cover > 0.0) {
    // billows bump the normal (whitewater is lumpy, thin lace lies flat) and shade
    // their creases; thin foam is a bubble film tinted by the water under it, dense foam
    // a bright diffuse white with a little sheen on the bubble tops
    vec3 fN = normalize(Nrm - vSheetRotation*vec3(fg.x,0.,fg.y)*(0.03+0.12*dens)*uBillow); // ASTRA PASS8: billow strength knob
    float fl = dot(fN, uSunDir);
    float ao=mix(1.,mix(.45,1.,smoothstep(.15,.75,fh)),uBillow); // ASTRA PASS8: lace-only toggle
    float solid = smoothstep(0.2, 0.9, dens * (0.55 + 0.7 * fh));
    vec3 foamAlbedo = mix(uFoamTint, vec3(0.93, 0.92, 0.88), max(solid, smoothstep(0.3, 0.9, pat) * 0.6));
    vec3 lit = sun * (0.15 + 0.85 * clamp(fl * 0.8 + 0.2, 0.0, 1.0)) * mix(ao, 1.0, 0.4) + ambient * 1.1 * ao;
    // sun behind the crest shines through the thin foam on top
    lit += sun * pow(clamp(dot(uSunDir, -V), 0.0, 1.0), 4.0) * 0.4 * (1.0 - solid);
    vec3 foamCol = uFoam.w * foamAlbedo * lit;
    foamCol += sun * pow(max(dot(fN, H), 0.0), 90.0) * 0.5 * smoothstep(0.55, 0.85, fh) * solid;
    col = mix(col, foamCol, cover * mix(0.8, 1.0, solid));
  }

  // ASTRA PASS8: no aerial perspective in the coral studio.

  if (uDebug == 1) col = Nrm * 0.5 + 0.5;
  else if (uDebug == 2) col = spec;
  else if (uDebug == 3) col = vec3(foam, cover, shoreFoam);
  else if (uDebug == 4) col = vec3(alpha * 5.0, sqrt(geoVar) * 5.0, sqrt(variance.x + variance.y) * 5.0);
  else if (uDebug == 5) col = vec3(F);
  else if (uDebug == 6) col = body;
  else if (uDebug == 7) col = refl;
  fragColor = vec4(col, 2.0);
}`;

// ASTRA PASS8: finite sheet construction and compact studio-only uniforms.
export class OceanSurface {
  constructor(sim,studio,ripple,size=80){
    this.sim=sim;
    this.uniforms={
      uDisp0:{value:null},uDisp1:{value:null},uDisp2:{value:null},
      uSlope0:{value:null},uSlope1:{value:null},uSlope2:{value:null},uSlope3:{value:null},
      uLength:{value:new THREE.Vector4(...sim.lengths)},uWind:{value:25},uSize:{value:size},uMetresPerWorld:{value:size/10},
      uRipple:{value:ripple},uTime:{value:0},uResolution:{value:new THREE.Vector2()},uNearFar:{value:new THREE.Vector2(.1,160)},
      uSceneColor:{value:null},uSceneDepth:{value:null},
      uImpact:{value:Array.from({length:8},()=>new THREE.Vector4())},uImpactSize:{value:Array(8).fill(1)},
      uSkyCube:{value:studio.cube},uSkyMaxLod:{value:Math.log2(studio.cubeSize)},uFoamTex:{value:null},
      uSunDir:{value:studio.sunDir},uSunColor:{value:studio.sunColor},
      uAbsorption:{value:new THREE.Vector3(.40,.062,.032)},uScatterColor:{value:new THREE.Color(0.,.05,.08)},
      uFoamTint:{value:new THREE.Color(.62,.78,.82)},uSSS:{value:new THREE.Vector4(1.6,.06,.05,0)},
      uFoam:{value:new THREE.Vector4(.05,1.3,.2,.72)},uOptics:{value:new THREE.Vector4(.02,.06,.04,0)},
      uCamForward:{value:new THREE.Vector3()},uDebug:{value:0},uGlint:{value:.6},uCamSide:{value:-1},
      uSheetMatrix:{value:new THREE.Matrix4()},uBallState:{value:null},uBallOffset:{value:new THREE.Vector3()},
      uBallRadius:{value:.575},uBallGlow:{value:1},uBillow:{value:1},uCrestVelocity:{value:new THREE.Vector2()},
    };
    // ASTRA PASS9: uCamSide is fixed at -1 for the above-water chunk. Hardware
    // culling rejects exactly the back faces previously discarded in FRAG.
    this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:VERT,fragmentShader:FRAG,uniforms:this.uniforms,side:THREE.FrontSide});
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,10,511,511).rotateX(-Math.PI/2),this.material);
    this.mesh.frustumCulled=false;
  }
  update(camera,time){
    const u=this.uniforms,s=this.sim;
    for(let i=0;i<3;i++)u['uDisp'+i].value=s.displacement[i];
    for(let i=0;i<4;i++)u['uSlope'+i].value=s.slope[i];
    u.uWind.value=s.params.windSpeed;u.uTime.value=time;u.uNearFar.value.set(camera.near,camera.far);
    camera.getWorldDirection(u.uCamForward.value);
    // ASTRA PASS9: the existing crest advection follows the blended anchor peak.
    const w=s.displayPeakOmega ?? s.initMat.uniforms.uSpecB.value[0].y,angle=s.params.windDirection*Math.PI/180;
    u.uCrestVelocity.value.set(Math.cos(angle),Math.sin(angle)).multiplyScalar(9.81/w);
  }
}
