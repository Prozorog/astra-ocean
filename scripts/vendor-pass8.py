"""Reproducible, commented adaptation of the selected MIT Ultra-Water checkout."""
from pathlib import Path
import re
import shutil

up = Path('.references/ultra-water/src')
dest = Path('src/vendor/ultra-water')
header = '// Ultra-Water (c) 2026 Humpalumps, MIT; see LICENSE and THIRD_PARTY_NOTICES.md.\n'
mark = '// ASTRA PASS8: '
def save(name, text):
    file = dest / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(header + text, encoding='utf-8')
def replace(text, old, new):
    assert old in text, old[:120]
    return text.replace(old, new)

for name in ['engine/fullscreen.js', 'water/bakeTextures.js']:
    save(name, (up / name).read_text(encoding='utf-8'))
for name in ['LICENSE', 'THIRD_PARTY_NOTICES.md']:
    shutil.copyfile(Path('.references/ultra-water') / name, dest / name)

s = (up / 'water/OceanSim.js').read_text(encoding='utf-8')
s = replace(s, 'const LOOP = 300;', mark + 'display-time quantisation; tau scales dispersion before rounding.\nexport const LOOP = 3.63;')
s = s.replace('LOOP.toFixed(1)', 'LOOP.toFixed(2)')
s = replace(s, 'uniform uint uSeed;', 'uniform uint uSeed;\n' + mark + 'requested opposing-wave damping, applied to the existing spreading.\nuniform float uOpposing;')
s = replace(s, 'return mix(2.0 / PI * cos(t) * cos(t), cosine2s, a.z);', mark + 'retain a configurable fraction of waves travelling against the wind.\n  return mix(2.0 / PI * cos(t) * cos(t), cosine2s, a.z) * mix(uOpposing, 1.0, smoothstep(-0.1, 0.1, cos(t)));')
s = replace(s, 'uniform float uTime;\nlayout', 'uniform float uTime;\n' + mark + 'physical pace; the display clock always wraps at 3.63 s.\nuniform float uTau;\nlayout')
s = replace(s, 'floor(omega(kl) / W0)', 'floor(omega(kl) * uTau / W0 + 0.5) /* ASTRA PASS8: quantised tau */')
s = replace(s, 'uniform float uFoamRecovery;', '''uniform float uFoamRecovery;
// ASTRA PASS8: coherent height/displacement/derivative gain and periodic foam replay.
uniform float uHeightGain;
uniform highp sampler2DArray uFoamHistory;
uniform float uFoamFrame;
uniform bool uReplayFoam;''')
s = replace(s, '  float dxx = uLambda', '  // ASTRA PASS8: scale all six FFT fields together, before slope/Jacobian assembly.\n  a *= uHeightGain; b *= uHeightGain;\n  float dxx = uLambda')
s = replace(s, '  outDisp = vec4', '''  // ASTRA PASS8: history contains the converged upstream recovery recurrence.
  if (uReplayFoam) {
    vec2 uv = (vec2(id) + 0.5) / float(N);
    float frame = floor(uFoamFrame), blend = fract(uFoamFrame);
    vec4 f0 = texture(uFoamHistory, vec3(uv, frame));
    vec4 f1 = texture(uFoamHistory, vec3(uv, mod(frame + 1.0, 121.0)));
    turb = mix(f0[uCascade], f1[uCascade], blend);
  }
  outDisp = vec4''')
s = replace(s, '  constructor(renderer, params = defaultOceanParams()) {', '''  // ASTRA PASS8: cascade ratios retained; finite sheet supplies its largest length.
  constructor(renderer, params = defaultOceanParams(), lengths = CASCADE_LENGTHS) {''')
s = s.replace('const lengths = new THREE.Vector4(...CASCADE_LENGTHS);', 'const lengthVector = new THREE.Vector4(...lengths); // ASTRA PASS8: per-chunk periods')
s = s.replace('value: lengths', 'value: lengthVector').replace('...CASCADE_LENGTHS.slice(1)', '...lengths.slice(1)')
s = replace(s, '    this.lengths = CASCADE_LENGTHS;', '    this.lengths = lengths; // ASTRA PASS8: sheet-local metres')
s = replace(s, '      uSeed: { value: 1337 },', '      uSeed: { value: 1337 },\n      uOpposing: { value: 0.5 }, // ASTRA PASS8: directional movement')
s = replace(s, 'uTime: { value: 0 },', 'uTime: { value: 0 }, uTau: { value: 1 }, // ASTRA PASS8: pace')
s = replace(s, '      uCascade: { value: 0 },', '''      // ASTRA PASS8: gain and deterministic foam cache bindings.
      uHeightGain: { value: 1 }, uFoamHistory: { value: null },
      uReplayFoam: { value: false }, uFoamFrame: { value: 0 },
      uCascade: { value: 0 },''')
s = replace(s, '    const swell = jonswapParams(p.swellWindSpeed, p.swellFetchKm);', '''    const swell = jonswapParams(p.swellWindSpeed, p.swellFetchKm);
    // ASTRA PASS8: chunk knob tunes the EXISTING JONSWAP peak frequencies.
    if (p.peakWaves) {
      wind.peakOmega = Math.sqrt(G * 2 * Math.PI * p.peakWaves / p.sheetSize);
      swell.peakOmega = wind.peakOmega * 0.9;
    }
    u.uOpposing.value = p.opposingDamping ?? 0.5;''')
s = replace(s, '    dt *= p.timeScale;', '    // ASTRA PASS8: tau is quantised in dispersion, not multiplied into display time.\n    this.evolveMat.uniforms.uTau.value = p.timeScale;')
s = replace(s, '    au.uLambda.value = p.choppiness;', '    au.uLambda.value = p.choppiness;\n    au.uHeightGain.value = p.heightGain ?? 1; // ASTRA PASS8: coherent gain')
save('water/OceanSim.js', s)

s = (up / 'water/OceanSurface.js').read_text(encoding='utf-8')
noise = s[s.index('float hash12('):s.index('// phase offset along the coast')]
impact = s[s.index('// Ripple rings from objects'):s.index('// FFT cascade weights')]
water = '''// ASTRA PASS8: no shore maps, bathymetry, Earth curvature or underwater branch.
export const WATER_GLSL = /* glsl */`
#define N_TEX ${N.toFixed(1)}
#define PI 3.14159265359
uniform sampler2D uDisp0,uDisp1,uDisp2,uSlope0,uSlope1,uSlope2,uSlope3;
uniform sampler2D uRipple;
uniform vec4 uLength;
uniform float uTime,uSize,uMetresPerWorld;
uniform vec4 uImpact[8]; uniform float uImpactSize[8];
''' + noise + impact + '''
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
'''
vert = '''// ASTRA PASS8: fixed 512²-vertex sheet, rigid object transform only.
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
'''
frag=s[s.index('const FRAG ='):s.index('export class OceanSurface')]
frag=replace(frag, "const FRAG = '#define SURF_VARYING\\n' + WATER_GLSL + FLOAT_SHADOW_GLSL +", 'export const FRAG = WATER_GLSL + /* ASTRA PASS8: no island shadow include */')
frag=re.sub(r'uniform sampler2D uReflection;.*?uniform samplerCube uSkyCube;', 'uniform samplerCube uSkyCube;', frag, flags=re.S)
frag=re.sub(r'uniform sampler2DShadow uShadowMap;.*?uniform vec3 uSunDir;', 'uniform vec3 uSunDir;', frag, flags=re.S)
frag=replace(frag, 'uniform vec4 uRock;', '// ASTRA PASS8: retained optics; no rock/bathymetry uniforms.\nuniform vec4 uUnusedRock;')
frag=replace(frag, 'in vec3 vWorld;', '''// ASTRA PASS8: same local FFT field is rotated with the finite sheet.
uniform mat4 uSheetMatrix; uniform sampler2D uBallState;
uniform vec3 uBallOffset; uniform float uBallRadius,uBallGlow,uBillow;
uniform vec2 uCrestVelocity;
in vec3 vLocal; in mat3 vSheetRotation;
in vec3 vWorld;''')
frag=re.sub(r'float sunShadow\(vec3 p\) \{.*?\n\}', '// ASTRA PASS8: island and floater shadow maps are omitted.\nfloat sunShadow(vec3 p){return 1.0;}', frag, count=1, flags=re.S)
frag=replace(frag, '  dir.y = max(dir.y, 0.0);', '  // ASTRA PASS8: sample the complete coral studio cube, including its lower hemisphere.')
start=frag.index('  vec4 sh = shoreSample(vXZ);')
end=frag.index('  // wind slicks:',start)
frag=frag[:start]+'''  // ASTRA PASS8: full cascades; a floating sheet has no shore depth damping.
  float depthBelow=60.0; vec3 damp=vec3(1.0);
  vec4 s0=texture(uSlope0,vXZ/uLength.x),s1=texture(uSlope1,vXZ/uLength.y);
  vec4 s2=texture(uSlope2,vXZ/uLength.z),s3=texture(uSlope3,vXZ/uLength.w);
''' + frag[end:]
frag=replace(frag, 'vXZ * 0.006 + uTime * 0.01', 'vXZ * 0.006 + 0.01 * vec2(cos(uTime*2.0*PI/3.63),sin(uTime*2.0*PI/3.63)) /* ASTRA PASS8: periodic drift */')
frag=replace(frag, '  Shore shore = shoreWaves(vXZ, sh, max(fwXZ.x, fwXZ.y));', '  // ASTRA PASS8: no shoreline wave train; heightfield carries interactions.')
frag=replace(frag, 'vec3 imp = impactWaves(vWorld.xz, 2.0 / max(max(fwXZ.x, fwXZ.y), 1e-3));', 'vec3 imp = rippleAt(vXZ); // ASTRA PASS8: same height and slopes as geometry')
frag=frag.replace(' + shore.slope', '')
frag=replace(frag, 'vec3 Nrm = normalize(vec3(-slope.x, 1.0, -slope.y));', 'vec3 Nrm = normalize(vSheetRotation * vec3(-slope.x,1.0,-slope.y)); // ASTRA PASS8: rigid transform')
start=frag.index('  // --- seen from below:')
end=frag.index('  // --- refraction + absorption', start)
frag=frag[:start]+'  // ASTRA PASS8: underwater and Snell window branch removed.\n'+frag[end:]
start=frag.index('  // shoreline contact foam')
end=frag.index('  // --- lighting', start)
frag=frag[:start]+'''  // ASTRA PASS8: convert the studio depth to physical metres for Beer absorption.
  T=exp(-uAbsorption*thick*uMetresPerWorld);
  float vth=thick*uMetresPerWorld;
  float shoreFoam=foam; // ASTRA PASS8: upstream whitewater flow is driven by FFT compression.
''' +frag[end:]
frag=replace(frag, 'float h = max(vWorld.y, 0.0);', 'float h = max(vLocal.y, 0.0); // ASTRA PASS8: crest height above the sheet, metres')
start=frag.index('  // thin breaking lips:')
end=frag.index('  // Fresnel with', start)
frag=frag[:start]+'  // ASTRA PASS8: no shore lip / sediment turbidity.\n  vec3 body=refracted*T+(inscatter+sss)*(1.0-T);\n\n'+frag[end:]
start=frag.index('  // --- reflection:')
end=frag.index('  // --- sun specular:',start)
frag=frag[:start]+'''  // ASTRA PASS8: studio cube and the existing ember reflection; no planar island pass.
  vec3 R=reflect(-V,Nrm);
  float lod=clamp(log2(alpha*650.0),0.0,uSkyMaxLod);
  vec3 refl=skyLod(R,lod);
  vec3 ball=(uSheetMatrix*vec4(texelFetch(uBallState,ivec2(0),0).xyz+uBallOffset+vec3(0.,uBallRadius*.4,0.),1.)).xyz;
  vec3 toBall=ball-vWorld;float along=dot(toBall,R), bd=length(toBall);
  float cone=uBallRadius+bd*alpha;
  float hit=(1.-smoothstep(cone*.75,cone,length(toBall-R*max(along,0.))))*step(0.,along);
  refl+=vec3(18.,5.6,.55)*hit*uBallGlow;
''' +frag[end:]
frag=replace(frag, 'float tt = uTime * 3.0 +', 'float tt = sin(uTime*2.0*PI/3.63) * 2.0 + /* ASTRA PASS8: periodic glint clock */')
start=frag.index('  // the thin wash is churned')
end=frag.index('  // --- foam surface:',start)
frag=frag[:start]+'''  // ASTRA PASS8: the emitter lights the water through the SAME vendored GGX BRDF.
  vec3 bL=toBall/max(bd,1e-4),bH=normalize(bL+V);
  float bNL=max(dot(Nrm,bL),0.),bNH=max(dot(Nrm,bH),0.);
  float bDen=bNH*bNH*(aS2-1.)+1.;
  float bD=aS2/(PI*bDen*bDen);
  float bVis=.5/(bNL*sqrt(NoV*NoV*(1.-aS2)+aS2)+NoV*sqrt(bNL*bNL*(1.-aS2)+aS2)+1e-5);
  float bF=F0+(1.-F0)*pow(1.-max(dot(V,bH),0.),5.);
  vec3 ballLight=vec3(18.,5.6,.55)*uBallGlow*(uBallRadius*uBallRadius/max(bd*bd,.1));
  vec3 col=mix(body,refl,F)+spec+ballLight*(PI*bD*bVis*bF*bNL);
''' +frag[end:]
frag=replace(frag, 'const float FLOW_T = 2.5;', 'const float FLOW_T = 3.63; // ASTRA PASS8: flow wraps with the display loop')
frag=replace(frag, 'vec2 vel = shore.dir * shore.wave0.z / max(shore.wave0.y, 1e-3);', 'vec2 vel=uCrestVelocity; // ASTRA PASS8: phase velocity of the existing spectrum peak')
frag=frag.replace('vWorld.xz - vel', 'vLocal.xz - vel').replace('vWorld.xz * 0.023','vLocal.xz * 0.023')
start=frag.index('  if (shore.residual >')
end=frag.index('  if (cover > 0.0)',start)
frag=frag[:start]+'  // ASTRA PASS8: beach residual and vanishing-film masks removed.\n'+frag[end:]
frag=replace(frag, 'vec3 fN = normalize(Nrm - vec3(fg.x, 0.0, fg.y) * (0.03 + 0.12 * dens));', 'vec3 fN = normalize(Nrm - vSheetRotation*vec3(fg.x,0.,fg.y)*(0.03+0.12*dens)*uBillow); // ASTRA PASS8: billow strength knob')
frag=replace(frag, 'float ao = mix(0.45, 1.0, smoothstep(0.15, 0.75, fh));', 'float ao=mix(1.,mix(.45,1.,smoothstep(.15,.75,fh)),uBillow); // ASTRA PASS8: lace-only toggle')
start=frag.index('  // --- aerial perspective')
end=frag.index('  if (uDebug ==',start)
frag=frag[:start]+'  // ASTRA PASS8: no aerial perspective in the coral studio.\n\n'+frag[end:]

klass='''// ASTRA PASS8: finite sheet construction and compact studio-only uniforms.
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
    this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:VERT,fragmentShader:FRAG,uniforms:this.uniforms,side:THREE.DoubleSide});
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,10,511,511).rotateX(-Math.PI/2),this.material);
    this.mesh.frustumCulled=false;
  }
  update(camera,time){
    const u=this.uniforms,s=this.sim;
    for(let i=0;i<3;i++)u['uDisp'+i].value=s.displacement[i];
    for(let i=0;i<4;i++)u['uSlope'+i].value=s.slope[i];
    u.uWind.value=s.params.windSpeed;u.uTime.value=time;u.uNearFar.value.set(camera.near,camera.far);
    camera.getWorldDirection(u.uCamForward.value);
    const w=s.initMat.uniforms.uSpecB.value[0].y,angle=s.params.windDirection*Math.PI/180;
    u.uCrestVelocity.value.set(Math.cos(angle),Math.sin(angle)).multiplyScalar(9.81/w);
  }
}
'''
save('water/OceanSurface.js', "import * as THREE from 'three';\nimport {N} from './OceanSim.js';\n"+water+vert+frag+klass)

s=(up/'engine/PostFX.js').read_text(encoding='utf-8')
s=replace(s,'uniform float uFrame;', 'uniform float uFrame;\n// ASTRA PASS8: user-requested film grain, separate from upstream dither.\nuniform float uGrain;')
s=replace(s, 'fragColor = vec4(o + (n - 1.0) * (1.0 / 255.0), 1.0);', '''// ASTRA PASS8: reuse the existing TPDF noise for phase-locked film grain.
  fragColor=vec4(o+(n-1.)*(1./255.+uGrain*sqrt(max(dot(o,vec3(.333)),.01))),1.);''')
s=replace(s,'    droplets: 0.0,', '    grain: 0.018, // ASTRA PASS8: independent grain strength\n    droplets: 0.0,')
s=replace(s,'uFrame: { value: 0 },', 'uFrame: { value: 0 }, uGrain: { value: 0 }, /* ASTRA PASS8: film strength */')
s=replace(s,'render(hdrTexture, dt = 1 / 60)', 'render(hdrTexture, dt = 1 / 60, displayTime = null, outputTarget = null) /* ASTRA PASS8: deterministic capture clock and snapshot target */')
s=replace(s,'    this._time = (this._time + dt) % 4096;', '''    this._time = (this._time + dt) % 4096;
    // ASTRA PASS8: dither, grain and droplet clocks return to the exact first pixel.
    if(displayTime!==null){this._time=((displayTime%3.63)+3.63)%3.63;this._frame=Math.floor(this._time/.03+1e-5)%121;}''')
s=replace(s,'    u.uFrame.value = this._frame;', '    u.uFrame.value = this._frame;\n    u.uGrain.value = p.grain; // ASTRA PASS8: independent grain toggle/strength')
s=replace(s,'    this._pass(this.matComp, null);', '    this._pass(this.matComp, outputTarget); // ASTRA PASS8: snapshot output')
save('engine/PostFX.js',s)

# ASTRA PASS8: retain upstream ballistic spray, splash crowns, lighting and fragment
# shader. Replace only the shore emitter/trigger by periodic FFT crest samples.
s=(up/'water/Spray.js').read_text(encoding='utf-8')
common=s[s.index('const VERT_COMMON ='):s.index('const VERT =')]
common=replace(common,'void billboard(vec3 p, float size) {', '''void billboard(vec3 p, float size) {
  // ASTRA PASS8: metres in the finite sheet, then rigid studio transform.
  p=(modelMatrix*vec4(p/uMetresPerWorld,1.)).xyz;size/=uMetresPerWorld;''')
splash=s[s.index('const SPLASH_PER_IMPACT'):s.index('// Rocks the waves run into:')]
splash=replace(splash,'  billboard(vec3(xz.x, y, xz.y)', '''  // ASTRA PASS8: the crown starts at the floating FFT surface rather than sea level.
  y+=waterAt(e.xy,vec3(0.)).y;
  billboard(vec3(xz.x, y, xz.y)''')
spray='''// ASTRA PASS8: deterministic finite emitters; unchanged upstream ballistic/drag law.
const VERT=VERT_COMMON+/* glsl */`
uniform highp sampler2DArray uSprayHistory; uniform vec2 uCrestVelocity;
uniform vec4 uFoam;in vec4 aEmit;
void main(){
  vAlpha=0.;gl_Position=vec4(2.,2.,2.,1.);
  vec2 e=aEmit.xy;float r1=aEmit.z,r2=aEmit.w;
  float frame=floor(r1*121.),age=mod(uTime-frame*.03+3.63,3.63);
  vec4 sample_=texture(uSprayHistory,vec3(e/uSize+.5,frame));
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
'''
frag=s[s.index('const FRAG ='):s.index('function sampleEmitters')]
quads=s[s.index('function quads('):s.index('export class Spray')]
klass='''// ASTRA PASS8: no shore map, rocks or beach swash in the finite chunk.
export class Spray{
  constructor(surface,history,count=12288){
    this.params={amount:.65,size:1,distance:350};
    this.uniforms={...surface.uniforms,uSpray:{value:new THREE.Vector3()},uSprayHistory:{value:history}};
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
'''
save('water/Spray.js',"import * as THREE from 'three';\nimport {WATER_GLSL} from './OceanSurface.js';\n"+common+spray+splash+frag+quads+klass)
print('Vendored FFT, sheet water optics, foam bake, fullscreen engine and post; every adaptation marked ASTRA PASS8.')
