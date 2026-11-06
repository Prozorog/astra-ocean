// Original implementation of the choppy-octave technique described by
// Alexander Alekseev, Seascape (Ms2SD1). No Shadertoy source is included.
import GUI from 'lil-gui';
import { DoubleSide, Matrix3, ShaderMaterial, Vector3 } from 'three';
import { LOOP, wrapTime } from '../water/time';
import type { LabEvidence, LabSettings, LabVariant } from './contracts';
import { Presentation } from './presentation';
import { STUDIO_GLSL } from '../water/lighting';
const SHAPE = /* glsl */`
uniform float uHeight,uChoppy,uFrequency,uSpeed,uTime;
float periodicHash(ivec2 p){uvec2 q=uvec2((p%4+4)%4);uint h=q.x*374761393u+q.y*668265263u;h=(h^(h>>13u))*1274126177u;h^=h>>16u;return float(h&16777215u)/16777215.;}
float periodicNoise(vec2 p){vec2 q=p*(4./6.283185307179586),f=fract(q);ivec2 i=ivec2(floor(q));f=f*f*(3.-2.*f);return mix(mix(periodicHash(i),periodicHash(i+ivec2(1,0)),f.x),mix(periodicHash(i+ivec2(0,1)),periodicHash(i+ivec2(1,1)),f.x),f.y);}
float choppyWave(vec2 p,float shape){vec2 q=p+vec2(periodicNoise(p)-.5,periodicNoise(p+vec2(1.7,2.1))-.5)*.7;vec2 ridge=1.-abs(sin(q)),rounding=abs(cos(q));vec2 w=mix(ridge,rounding,ridge);return pow(max(0.,1.-pow(w.x*w.y,.65)),shape);}
float sea(vec2 p,int octaves){float amplitude=1.,frequency=uFrequency,choppy=uChoppy,h=0.;float phase=uTime/3.63*6.283185307179586;for(int i=0;i<5;i++){if(i>=octaves)break;vec2 q=p*frequency;float motion=phase*uSpeed*float(i+1);h+=amplitude*.5*(choppyWave(q+vec2(motion),choppy)+choppyWave(q-vec2(motion),choppy));p=mat2(.6967067,.7173561,-.7173561,.6967067)*p;frequency*=1.9;amplitude*=.22;choppy=mix(choppy,1.,.2);}return uHeight*(h-.25);}
`;
function hash(x: number, z: number): number { x = ((x % 4) + 4) % 4; z = ((z % 4) + 4) % 4; let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; h ^= h >>> 16; return (h & 16777215) / 16777215; }
function noise(x: number, z: number): number { const qx = x * 4 / (2 * Math.PI), qz = z * 4 / (2 * Math.PI), ix = Math.floor(qx), iz = Math.floor(qz); let fx = qx - ix, fz = qz - iz; fx *= fx * (3 - 2 * fx); fz *= fz * (3 - 2 * fz); return (hash(ix, iz) * (1 - fx) + hash(ix + 1, iz) * fx) * (1 - fz) + (hash(ix, iz + 1) * (1 - fx) + hash(ix + 1, iz + 1) * fx) * fz; }
function wave(x: number, z: number, choppy: number): number { const qx = x + (noise(x, z) - .5) * .7, qz = z + (noise(x + 1.7, z + 2.1) - .5) * .7; let a = 1 - Math.abs(Math.sin(qx)), b = 1 - Math.abs(Math.sin(qz)); a = a * (1 - a) + Math.abs(Math.cos(qx)) * a; b = b * (1 - b) + Math.abs(Math.cos(qz)) * b; return Math.max(0, 1 - (a * b) ** .65) ** choppy; }
export class VariantS implements LabVariant {
  readonly id = 'S'; readonly backend = 'WebGL2 · choppy octaves'; readonly view = new Presentation();
  readonly parameters = { height: .35, choppy: 4, frequency: 1.45, speed: 1 }; ready = false; private time = 0;
  readonly material = new ShaderMaterial({ side: DoubleSide, toneMapped: false, uniforms: {
    uHeight: { value: .35 }, uChoppy: { value: 4 }, uFrequency: { value: 1.45 }, uSpeed: { value: 1 }, uTime: { value: 0 }, uSheet: { value: new Matrix3() }, uBall: { value: new Vector3(0, 0, 0) }, uRadius: { value: 1.25 }, uLip: { value: false }, uDiagnostic: { value: false },
    uSeaBase: { value: new Vector3(.060, .085, .082) }, uSeaWater: { value: new Vector3(.078187, .323143, .313989) },
  }, vertexShader: `${SHAPE}\nvarying vec3 vWorld;varying vec2 vBase;varying float vHeight;void main(){vBase=position.xz;vHeight=sea(vBase,3);vec3 p=position+vec3(0.,vHeight,0.);vec4 w=modelMatrix*vec4(p,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader: `precision highp float;precision highp int;${SHAPE}\n${STUDIO_GLSL}\nuniform vec3 uBall,uSeaBase,uSeaWater;uniform float uRadius;uniform mat3 uSheet;uniform bool uLip,uDiagnostic;varying vec3 vWorld;varying vec2 vBase;varying float vHeight;
    void main(){float fine=sea(vBase,5);vec3 detailed=vWorld+uSheet*vec3(0.,fine-vHeight,0.);vec3 N=normalize(cross(dFdx(detailed),dFdy(detailed)));vec3 V=normalize(cameraPosition-vWorld);if(dot(N,V)<.05)N=normalize(N+V*(.05-dot(N,V)));vec3 R=reflect(-V,N);R.y=max(R.y,0.);R=normalize(R);
      if(uDiagnostic){gl_FragColor=uLip?vec4(0.,0.,0.,1.):vec4(1.,0.,clamp(1.-abs(dot(N,uSheet*vec3(0.,1.,0.))),0.,1.),1.);return;}
      vec3 L=normalize(vec3(-.75,1.25,.6));float rough=.04+sqrt(max(0.,length(fwidth(N))*.2));vec3 sky=studioSky(R,rough);float fres=clamp(1.-dot(N,V),0.,1.);if(uLip){gl_FragColor=vec4(vec3(.005,.014,.015)+sky*dielectric(1.-fres),1.);return;}
      float diffuse=pow(max(dot(N,L)*.4+.6,0.),2.);vec3 refracted=uSeaBase+diffuse*uSeaWater*.12;float reflection=pow(fres,3.)*.5;float hit=ballReflection(vWorld,R,rough,uBall,uRadius).x;sky=mix(sky,vec3(36.,1.4,.045),hit);
      vec3 color=mix(refracted,sky,reflection)+uSeaWater*(fine-uHeight)*.18;vec3 H=normalize(V+L);float exponent=max(20.,80./(1.+rough*8.));float spec=pow(max(dot(N,H),0.),exponent)*(exponent+2.)/(2.*PI);spec=spec/(1.+spec/6.);color+=vec3(.79,.9,1.)*spec*dielectric(max(dot(N,V),0.));gl_FragColor=vec4(color,1.);}
  ` });
  get canvas(): HTMLCanvasElement { return this.view.renderer.domElement; } get frames(): number { return this.view.frames; }
  height(x: number, z: number, time: number): number {
    let amplitude = 1, frequency = this.parameters.frequency, choppy = this.parameters.choppy, h = 0; const phase = wrapTime(time) / LOOP * Math.PI * 2;
    for (let i = 0; i < 3; i++) { const qx = x * frequency, qz = z * frequency, motion = phase * this.parameters.speed * (i + 1); h += amplitude * .5 * (wave(qx + motion, qz + motion, choppy) + wave(qx - motion, qz - motion, choppy)); const nx = .6967067 * x - .7173561 * z; z = .7173561 * x + .6967067 * z; x = nx; frequency *= 1.9; amplitude *= .22; choppy += (1 - choppy) * .2; }
    return this.parameters.height * (h - .25);
  }
  async initialize(progress: (fraction: number, stage: string) => void): Promise<void> { this.view.install(this.material); this.ready = true; await this.seek(0); progress(1, 'Periodic choppy sea ready'); }
  private present(time: number): void { this.time = wrapTime(time); const u = this.material.uniforms; u.uTime.value = this.time; u.uHeight.value = this.parameters.height; u.uChoppy.value = this.parameters.choppy; u.uFrequency.value = this.parameters.frequency; u.uSpeed.value = this.parameters.speed; this.view.pose(this.time, 0, this.height(0, 0, this.time), 0); this.view.render(this.time); }
  async seek(time: number): Promise<void> { this.present(time); } frame(time: number): void { this.present(time); } resize(width: number, height: number): void { this.view.resize(width, height); }
  controls(gui: GUI, changed: () => void): void { gui.add(this.parameters, 'height', .15, 2, .05).name('Sea height').onChange(changed); gui.add(this.parameters, 'choppy', 1, 7, .1).name('Choppy').onChange(changed); gui.add(this.parameters, 'frequency', .8, 2.1, .05).name('Frequency').onChange(changed); gui.add(this.parameters, 'speed', 1, 4, 1).name('Cycles / loop').onChange(changed); }
  async apply(values: LabSettings): Promise<void> { for (const key of Object.keys(this.parameters) as (keyof typeof this.parameters)[]) { const value = values[key]; if (typeof value === 'number' && Number.isFinite(value)) this.parameters[key] = key === 'speed' ? Math.max(1, Math.round(value)) : value; } this.present(this.time); }
  async evidence(): Promise<LabEvidence> { let low = Infinity, high = -Infinity; for (let z = 0; z <= 128; z++) for (let x = 0; x <= 128; x++) { const h = this.height(x / 128 * 10 - 5, z / 128 * 10 - 5, this.time); low = Math.min(low, h); high = Math.max(high, h); } this.view.mask(this.time, false); const ball = this.view.screenBall();
    return { id: this.id, backend: this.backend, parameters: { ...this.parameters }, ballScreen: ball.centre, ballRadiusPixels: ball.radius, ballWorld: this.view.ballWorld.toArray(), reliefPercent: (high - low) / 10 * 100, foamCoverage: this.view.foamCoverage,
      spectrum: { model: 'original periodic choppy octaves', geometryOctaves: 3, normalOctaves: 5, foam: 'none; this is the classic stylized water/lift model, not a whitecap simulation', crestToTroughDisplayUnits: high - low },
      buoyancy: { method: 'CPU evaluation of the same three-octave periodic height function' }, renderer: this.view.rendererName(), frames: this.frames, frameIntervals: this.view.frameIntervals() };
  }
  async capture(type = 'image/png'): Promise<string> { this.present(this.time); return this.canvas.toDataURL(type, .94); }
  async mask(): Promise<string> { return this.view.mask(this.time); } dispose(): void { this.view.dispose(); }
}
