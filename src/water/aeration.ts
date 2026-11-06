import { InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import type { PerspectiveCamera } from 'three';
import { STUDIO_GLSL } from './lighting';

/** Soft aerated puffs attached to the live material-coordinate foam history. */
export function aeratedFoam(surface: ShaderMaterial, camera: PerspectiveCamera): Mesh<InstancedBufferGeometry, ShaderMaterial> {
  const plane = new PlaneGeometry(2, 2), geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute('position', plane.attributes.position);
  geometry.setAttribute('uv', plane.attributes.uv);
  const count = 56, sites = new Float32Array(count * count * 3);
  const hash = (i: number): number => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  for (let z = 0; z < count; z++) for (let x = 0; x < count; x++) {
    const i = z * count + x;
    sites[i * 3] = ((x + .2 + .6 * hash(i)) / count - .5) * 10;
    sites[i * 3 + 1] = ((z + .2 + .6 * hash(i + 701)) / count - .5) * 10;
    sites[i * 3 + 2] = hash(i + 9137);
  }
  geometry.setAttribute('aSite', new InstancedBufferAttribute(sites, 3)); geometry.instanceCount = count * count;
  const u = surface.uniforms;
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: {
      uGeometry: u.uGeometry, uFoam: u.uFoam, uFrozenFoam: u.uFrozenFoam, uFrozen: u.uFrozen,
      uFoamPatches: u.uFoamPatches,
      uFrame: u.uFrame, uSize: u.uSize, uStorm: u.uStorm, uDiagnostic: u.uDiagnostic, uDebug: u.uDebug,
      uMoundShadow: u.uMoundShadow, uMoundMid: u.uMoundMid, uMoundTop: u.uMoundTop,
      uProjection: { value: camera.projectionMatrix },
    },
    vertexShader: `precision highp sampler2DArray;
      attribute vec3 aSite;
      uniform sampler2D uGeometry,uFoam;uniform sampler2DArray uFrozenFoam,uFoamPatches;
      uniform float uFrame,uSize,uStorm,uDebug;uniform bool uFrozen;
      varying vec2 vQuad;varying vec3 vRight,vUp,vToward,vLocal;varying float vRadius,vBirth,vViewZ;
      void main(){
        vQuad=position.xy;vec2 sampleUv=aSite.xy/10.+.5;
        float density=texture2D(uFoam,sampleUv).r;
        if(uFrozen){float a=mod(floor(uFrame),121.),b=mod(a+1.,121.);density=mix(texture(uFrozenFoam,vec3(sampleUv,a)).r,texture(uFrozenFoam,vec3(sampleUv,b)).r,fract(uFrame));}
        density*=uStorm*uStorm;
        float layer=mod(floor(uFrame),121.),next=mod(layer+1.,121.);
        float connectedMask=min(texture(uFoamPatches,vec3(sampleUv,layer)).r,texture(uFoamPatches,vec3(sampleUv,next)).r);
        vBirth=smoothstep(.3,.72,density)*step(.5,connectedMask);
        if(vBirth<.005||uDebug>0.){gl_Position=vec4(2.,2.,2.,1.);return;}
        vRadius=(.14+.11*aSite.z)*(.65+.35*vBirth);
        vec3 displacement=texture2D(uGeometry,sampleUv).xyz*(10./uSize);
        vec3 local=vec3(aSite.x,0.,aSite.y)+displacement;
        local.y-=vRadius*.35;vLocal=local;
        vec3 centre=(modelMatrix*vec4(local,1.)).xyz;
        vRight=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
        vUp=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
        vToward=vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]);
        vec3 world=centre+vRight*position.x*vRadius+vUp*position.y*vRadius*.85;
        vec4 view=viewMatrix*vec4(world,1.);vViewZ=view.z;
        gl_Position=projectionMatrix*view;
      }`,
    fragmentShader: `precision highp float;
      uniform bool uDiagnostic;uniform mat4 uProjection;uniform vec3 uMoundShadow,uMoundMid,uMoundTop;
      varying vec2 vQuad;varying vec3 vRight,vUp,vToward,vLocal;varying float vRadius,vBirth,vViewZ;
      ${STUDIO_GLSL}
      void main(){
        float noise=.65*cloud(vLocal.xz*29.+vQuad*2.4)+.35*cloud(vLocal.xz*51.+vQuad*4.1);
        float r2=dot(vQuad,vQuad)+.45*(noise-.5);
        if(r2>=1.)discard;
        float front=sqrt(max(0.,1.-r2));
        float density=(.7+.3*noise)*front;
        float alpha=.62*(1.-exp(-1.8*density))*smoothstep(0.,.32,1.-r2)*vBirth*vBirth;
        if(alpha<.025)discard;
        float viewZ=vViewZ+front*vRadius*.8;
        float clipZ=uProjection[2][2]*viewZ+uProjection[3][2];
        gl_FragDepth=clamp((clipZ/(-viewZ))*.5+.5,0.,1.);
        if(uDiagnostic){if(alpha<.16)discard;gl_FragColor=vec4(1.,1.,0.,1.);return;}
        vec3 N=normalize(vec3(0.,.8,0.)+vRight*vQuad.x*.2+vUp*vQuad.y*.2+vToward*front*.4);
        vec3 L=normalize(vec3(-.7,1.2,-.7));
        float wrap=clamp((dot(N,L)+.55)/1.55,0.,1.);
        float lighting=clamp(.38+.18*wrap+.22*front,0.,1.);
        vec3 col=mix(mix(uMoundShadow,uMoundMid,smoothstep(.15,.55,lighting)),uMoundTop,smoothstep(.55,.95,lighting));
        float crevices=smoothstep(.25,.75,.6*cloud(vLocal.xz*44.+vQuad*3.1)+.4*cloud(vLocal.xz*79.+vQuad*5.7));
        col*=vec3(.6,1.1,1.28)*(.45+1.15*crevices);
        gl_FragColor=vec4(col,alpha);
      }`,
  });
  const mesh = new Mesh(geometry, material); mesh.name = 'Aerated breaking-water volume'; mesh.frustumCulled = false; mesh.renderOrder = 2;
  return mesh;
}
