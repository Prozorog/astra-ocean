import { Color, DoubleSide, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, UnsignedByteType, Vector2, Vector3, WebGLRenderTarget } from 'three';
import type { BufferGeometry, Group, Texture, WebGLRenderer } from 'three';
import { KEY, shadowProjection } from './materials';
import { PHYSICAL_VERTEX } from './water/material';

export class FoldShadow {
  readonly camera = new OrthographicCamera(-10, 10, 10, -10, 0.5, 45);
  readonly scene = new Scene();
  readonly mask = new WebGLRenderTarget(512, 512, { type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter });
  readonly blurred = this.mask.clone();
  private horizontal = this.mask.clone();
  readonly mesh: Mesh;
  private quadScene = new Scene();
  private quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blur: ShaderMaterial;
  private clear = new Color();
  constructor(geometry: BufferGeometry, material: ShaderMaterial) {
    const shadowDir = new Vector3(-0.34, 2.1, -0.30).normalize();
    this.camera.position.copy(shadowDir).multiplyScalar(22); this.camera.position.y += 2.6;
    this.camera.lookAt(0.25, 2.6, -0.15); this.camera.updateMatrixWorld();
    shadowProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.mesh = new Mesh(geometry, new ShaderMaterial({
      side: DoubleSide, toneMapped: false, uniforms: { ...material.uniforms, uLight: { value: KEY } }, vertexShader: PHYSICAL_VERTEX,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uGeometry, uDx, uDz; uniform float uSize;
        uniform mat3 uSheet; uniform vec3 uLight;
        varying vec3 vWorld; varying vec2 vBase;
        float heightAt(vec2 p) { return texture2D(uGeometry, p / 10.0 + 0.5).y * (10.0 / uSize); }
        void main() {
          float edgeDistance = 5.0 - max(abs(vBase.x), abs(vBase.y));
          float softFootprint = smoothstep(0.0, 1.35, edgeDistance) * smoothstep(-3.5, 3.8, vBase.x - 0.35 * vBase.y);
          vec2 light = normalize(vec2(dot(uSheet[0], uLight), dot(uSheet[2], uLight)));
          float epsilon = 0.09, height = heightAt(vBase);
          float curvature = (heightAt(vBase + light * epsilon) + heightAt(vBase - light * epsilon) - 2.0 * height) / (epsilon * epsilon);
          float crossCurv = (heightAt(vBase + vec2(-light.y, light.x) * epsilon) + heightAt(vBase - vec2(-light.y, light.x) * epsilon) - 2.0 * height) / (epsilon * epsilon);
          vec2 uv = vBase / 10.0 + 0.5;
          float slope = dot(vec2(texture2D(uDx, uv).y, texture2D(uDz, uv).y), light);
          // Thin caustic-shadow tendrils near the lower-right overhang, not blobby dunes across the floor.
          float edgeBand = smoothstep(0.02, 0.35, edgeDistance) * (1.0 - smoothstep(1.4, 3.2, edgeDistance)) * smoothstep(-0.5, 3.2, vBase.x);
          float tendril = exp(-pow((curvature - 1.05) / 0.26, 2.0)) * smoothstep(-0.2, 0.35, slope + 0.25 * crossCurv);
          float filaments = clamp(tendril * edgeBand * 1.35, 0.0, 1.0);
          gl_FragColor = vec4(filaments, clamp(vWorld.y / 8.0, 0.0, 1.0) * softFootprint, softFootprint, 1.0);
        }`,
    }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.scene.add(this.mesh);
    this.blur = new ShaderMaterial({
      depthTest: false, depthWrite: false, uniforms: { tInput: { value: this.mask.texture }, uStep: { value: new Vector2() } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        precision highp float; uniform sampler2D tInput; uniform vec2 uStep; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tInput, vUv) * 0.227027;
          c += (texture2D(tInput, vUv + uStep * 1.384615) + texture2D(tInput, vUv - uStep * 1.384615)) * 0.316216;
          c += (texture2D(tInput, vUv + uStep * 3.230769) + texture2D(tInput, vUv - uStep * 3.230769)) * 0.070270;
          gl_FragColor = c;
        }`,
    });
    this.quadScene.add(new Mesh(new PlaneGeometry(2, 2), this.blur));
  }
  render(renderer: WebGLRenderer, sheet: Group): void {
    const previous = renderer.getRenderTarget(); renderer.getClearColor(this.clear); const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0, 0); this.mesh.matrix.copy(sheet.matrixWorld);
    renderer.setRenderTarget(this.mask); renderer.clear(); renderer.render(this.scene, this.camera);
    this.blur.uniforms.tInput.value = this.mask.texture; this.blur.uniforms.uStep.value.set(1.8 / 512, 0);
    renderer.setRenderTarget(this.horizontal); renderer.clear(); renderer.render(this.quadScene, this.quadCamera);
    this.blur.uniforms.tInput.value = this.horizontal.texture; this.blur.uniforms.uStep.value.set(0, 1.8 / 512);
    renderer.setRenderTarget(this.blurred); renderer.clear(); renderer.render(this.quadScene, this.quadCamera);
    renderer.setRenderTarget(previous); renderer.setClearColor(this.clear, alpha);
  }
}
export function floorMaterial(sharp: Texture, blurred: Texture) {
  return new ShaderMaterial({
    toneMapped: false,
    uniforms: { uShadow: { value: sharp }, uBlurredShadow: { value: blurred }, uProjection: { value: shadowProjection },
      uCoral: { value: new Color(0.6572, 0.2114, 0.1648) }, uShadowStrength: { value: 0.32 }, uShadowDebug: { value: false }, uDiagnostic: { value: false } },
    vertexShader: 'varying vec4 vLight; uniform mat4 uProjection; void main() { vec4 world = modelMatrix * vec4(position, 1.0); vLight = uProjection * world; gl_Position = projectionMatrix * viewMatrix * world; }',
    fragmentShader: /* glsl */`
      precision highp float; varying vec4 vLight;
      uniform sampler2D uShadow, uBlurredShadow; uniform vec3 uCoral; uniform float uShadowStrength; uniform bool uShadowDebug, uDiagnostic;
      void main() {
        if (uDiagnostic) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec2 uv = vLight.xy / vLight.w * 0.5 + 0.5;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        vec3 sharp = texture2D(uShadow, uv).rgb * inside, soft = texture2D(uBlurredShadow, uv).rgb * inside;
        float tendril = mix(sharp.r, soft.r, 0.28);
        float darkness = (0.45 * soft.b + 0.12 * tendril) * uShadowStrength / 0.32;
        vec3 col = uCoral * (1.0 - darkness);
        if (uShadowDebug) col = vec3(darkness);
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }`,
  });
}
