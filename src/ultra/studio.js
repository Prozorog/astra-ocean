import * as THREE from 'three';
import { STUDIO_GLSL } from '../water/lighting';

// The existing pass-5 studio, baked into the cubemap expected by Ultra-Water.
// Water shading remains the vendored shader; this changes the reflected scene only.
export function makeStudio(renderer, highlightStrength = .45) {
  // Reduce the existing studio emitters while retaining its sky/base colours.
  const studioGLSL = STUDIO_GLSL.slice(0, STUDIO_GLSL.indexOf('float dielectric'))
    .replace('strip*2.6+second*.7', `strip*${(2.6 * highlightStrength).toFixed(4)}+second*${(.7 * highlightStrength).toFixed(4)}`)
    .replace('disk*18.', `disk*${(18 * highlightStrength).toFixed(4)}`);
  const scene = new THREE.Scene();
  const target = new THREE.WebGLCubeRenderTarget(128, {
    type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
  });
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vRay;void main(){vRay=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vRay;${studioGLSL}
      void main(){vec3 ray=normalize(vRay);vec3 c=studioSky(ray,.0);if(ray.y<0.)c=vec3(.6572,.2114,.1648);gl_FragColor=vec4(c,1.);}`,
  });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), material); scene.add(cube);
  const camera = new THREE.CubeCamera(.1, 50, target);
  async function initialize() {
    await renderer.compileAsync(scene, camera.children[0]);
    const old = renderer.getRenderTarget(); camera.update(renderer, scene); renderer.setRenderTarget(old);
    cube.geometry.dispose(); material.dispose();
  }
  return { cube: target.texture, cubeSize: 128, target, initialize,
    sunDir: new THREE.Vector3(-.75, 1.25, .60).normalize(),
    sunColor: new THREE.Vector3(.79, .90, 1).multiplyScalar(2.6) };
}
