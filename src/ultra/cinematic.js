import * as THREE from 'three';
import { FullscreenQuad, rawPass } from '../vendor/ultra-water/engine/fullscreen.js';

// A photographic post stage, separate from the vendored water optics.
// Velocity is current-vs-previous displaced surface position, in screen UV.
export class Cinematic {
  constructor(renderer, settings, ballState, root, camera) {
    this.renderer = renderer; this.settings = settings;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.material = rawPass(`precision highp float;
      in vec2 vUv;out vec4 color;
      uniform sampler2D image,velocity,depth,ballState;
      uniform vec2 texel,nearFar;uniform mat4 sheet,view;
      uniform vec3 ballOffset;uniform float ballRadius,shutter,aperture;
      float zAt(vec2 p){float d=texture(depth,p).r*2.-1.;return 2.*nearFar.x*nearFar.y/(nearFar.y+nearFar.x-d*(nearFar.y-nearFar.x));}
      void main(){
        float z=zAt(vUv);vec4 motion=texture(velocity,vUv);
        vec2 v=motion.xy;
        // Neighbour max expands moving silhouettes; reject unrelated depth layers.
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
          vec4 n=texture(velocity,vUv+vec2(float(x),float(y))*texel*2.);
          if(n.w>.5&&abs(n.z-z)<max(.2,z*.025)&&dot(n.xy,n.xy)>dot(v,v))v=n.xy;
        }
        vec3 c=texture(image,clamp(vUv,texel,1.-texel)).rgb;
        // Only exact zero is lossless at sharp glints; .5 px failed the golden set.
        if(dot(v,v)*shutter>0.){
        vec3 sum=vec3(0.);float weight=0.;
        for(int i=0;i<9;i++){
          float t=float(i)/8.-.5;vec2 p=clamp(vUv+v*t*shutter,texel,1.-texel);
          float dz=abs(zAt(p)-z),w=(1.-abs(t))*(1.-smoothstep(.1,max(.5,z*.035),dz));
          sum+=texture(image,p).rgb*w;weight+=w;
        }
        c=sum/max(weight,1e-4);
        }
        vec3 anchor=texelFetch(ballState,ivec2(0),0).xyz+ballOffset+vec3(0.,ballRadius*.4,0.);
        float focus=-(view*sheet*vec4(anchor,1.)).z;
        float coc=clamp(abs(z-focus)/max(z,.1)*aperture*8.,0.,4.);
        if(coc>.05){
          vec3 dof=c;float total=1.;
          for(int i=0;i<12;i++){
            float a=float(i)*2.39996323;float r=sqrt((float(i)+.5)/12.);
            vec2 p=clamp(vUv+vec2(cos(a),sin(a))*r*coc*texel,texel,1.-texel);
            float sampleZ=zAt(p),w=1.-smoothstep(.2,max(.5,z*.06),max(z-sampleZ,0.));
            dof+=texture(image,p).rgb*w;total+=w;
          }
          c=mix(c,dof/total,smoothstep(.05,.6,coc));
        }
        color=vec4(c,1.);
      }`, { image: { value: null }, velocity: { value: null }, depth: { value: null },
      ballState: { value: ballState }, texel: { value: new THREE.Vector2() }, nearFar: { value: new THREE.Vector2(camera.near, camera.far) },
      sheet: { value: root.matrixWorld }, view: { value: camera.matrixWorldInverse }, ballOffset: { value: new THREE.Vector3() },
      ballRadius: { value: .575 }, shutter: { value: .5 }, aperture: { value: .22 } });
    this.quad = new FullscreenQuad(this.material);
  }
  resize(w, h) { this.target.setSize(w, h); this.material.uniforms.texel.value.set(1 / w, 1 / h); }
  render(color, depth, velocity, offset) {
    const u = this.material.uniforms, s = this.settings;
    u.image.value = color; u.depth.value = depth; u.velocity.value = velocity; u.ballOffset.value.copy(offset);
    u.shutter.value = s.motionBlur ? s.shutter : 0; u.aperture.value = s.depthOfField ? s.aperture : 0;
    this.quad.render(this.renderer, this.target); return this.target.texture;
  }
  dispose() { this.target.dispose(); this.material.dispose(); }
}
