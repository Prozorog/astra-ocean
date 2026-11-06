import { Color, HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderTarget } from 'three';
import type { BufferGeometry, PerspectiveCamera, WebGLRenderer } from 'three';
import type { GpuTimings } from './gpu-timing';

export interface PostPipeline {
  render(destination?: WebGLRenderTarget | null): void;
  resize(width: number, height: number): void;
  bloom: { enabled: boolean };
  output: ShaderMaterial;
  target: WebGLRenderTarget;
  setScale(value: number): void;
  readonly scale: number;
  dispose(): void;
}

export function makePost(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, timings: GpuTimings, top: Mesh<BufferGeometry, ShaderMaterial>): PostPipeline {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, samples: 4 });
  const light = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter });
  const horizontal = light.clone(), blurred = light.clone();
  const quadScene = new Scene(), quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const depthScene = new Scene(), depthMaterial = new ShaderMaterial({
    colorWrite: false, side: top.material.side, uniforms: { ...top.material.uniforms }, vertexShader: top.material.vertexShader,
    fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
  });
  const depthMesh = new Mesh(top.geometry, depthMaterial);
  depthMesh.matrixAutoUpdate = false; depthMesh.frustumCulled = false; depthScene.add(depthMesh);
  const vertexShader = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const blur = new ShaderMaterial({
    depthTest: false, depthWrite: false, vertexShader,
    uniforms: { tInput: { value: light.texture }, uStep: { value: new Vector2() } },
    fragmentShader: /* glsl */`
      precision highp float; uniform sampler2D tInput; uniform vec2 uStep; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tInput, vUv).rgb * 0.227027;
        c += (texture2D(tInput, vUv + uStep * 1.384615).rgb + texture2D(tInput, vUv - uStep * 1.384615).rgb) * 0.316216;
        c += (texture2D(tInput, vUv + uStep * 3.230769).rgb + texture2D(tInput, vUv - uStep * 3.230769).rgb) * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const output = new ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false, vertexShader,
    uniforms: { tDiffuse: { value: target.texture }, tBloom: { value: blurred.texture }, toneMappingExposure: { value: 1 },
      uPhase: { value: 0 }, uGrain: { value: 0.045 }, uFilm: { value: true }, uDiagnostic: { value: false }, uBloom: { value: 0.0035 },
      uVignette: { value: new Color(0.74, 0.215, 0.162) }, uResolution: { value: new Vector2() },
      uSourceResolution: { value: new Vector2() }, uSharpen: { value: 0 } },
    fragmentShader: /* glsl */`
      precision highp float;
      #include <tonemapping_pars_fragment>
      uniform sampler2D tDiffuse, tBloom;
      uniform float uPhase, uGrain, uBloom, uSharpen;
      uniform bool uFilm, uDiagnostic;
      uniform vec3 uVignette;
      uniform vec2 uResolution, uSourceResolution;
      varying vec2 vUv;
      float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      void main() {
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        if (uDiagnostic) { gl_FragColor = vec4(col, 1.0); return; }
        if (uSharpen > 0.0) {
          vec2 px = 1.0 / uSourceResolution;
          vec3 neighbours = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb
            + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
          col = max(vec3(0.0), col + uSharpen * (4.0 * col - neighbours));
        }
        if (uFilm) {
          col += texture2D(tBloom, vUv).rgb * (uBloom * 5.2);
          vec2 centered = (vUv - 0.5) * 2.0;
          float vignette = smoothstep(0.28, 1.15, length(centered)) * 0.88;
          float warmFloor = smoothstep(1.6, 2.7, col.r / max(col.g, 0.0001)) * smoothstep(0.14, 0.21, col.b / max(col.r, 0.0001));
          col = mix(col, mix(col * 0.92, uVignette, warmFloor), vignette);
        }
        float filmLuminance = dot(col, vec3(0.2126, 0.7152, 0.0722));
        vec3 neutral = NeutralToneMapping(col);
        float minimum = min(col.r, min(col.g, col.b));
        float offset = minimum < 0.08 ? minimum - 6.25 * minimum * minimum : 0.04;
        vec3 chroma = max(col - offset, vec3(0.0));
        col = chroma * (max(neutral.r, max(neutral.g, neutral.b)) / max(max(chroma.r, max(chroma.g, chroma.b)), 0.000001));
        col = sRGBTransferOETF(vec4(col, 1.0)).rgb;
        if (uFilm) {
          float seed = floor(uPhase / 6.2831853 * 4096.0);
          float n1 = hash(floor(vUv * uResolution) + vec2(seed * 19.0, seed * 37.0)) - 0.5;
          float n2 = hash(floor(vUv * uResolution / 1.5) + vec2(seed * 29.0, seed * 53.0)) - 0.5;
          float noise = 0.65 * n1 + 0.35 * n2;
          col *= 1.0 + noise * uGrain * 2.35 * (1.0 - smoothstep(0.65, 1.0, filmLuminance));
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), output); quadScene.add(quad);
  const clear = new Color(), bloom = { enabled: true };
  let width = 1, height = 1, scale = 1;
  function resize(w: number, h: number) {
    width = w; height = h;
    const sw = Math.round(w * scale), sh = Math.round(h * scale), bw = Math.max(1, Math.round(sw / 4)), bh = Math.max(1, Math.round(sh / 4));
    target.setSize(sw, sh); light.setSize(bw, bh); horizontal.setSize(bw, bh); blurred.setSize(bw, bh);
    output.uniforms.uResolution.value.set(w, h); output.uniforms.uSourceResolution.value.set(sw, sh);
    output.uniforms.uSharpen.value = scale < 1 ? 0.14 : 0;
  }
  function render(destination: WebGLRenderTarget | null = null) {
    renderer.getClearColor(clear); const alpha = renderer.getClearAlpha(), autoClear = renderer.autoClear, layer = camera.layers.mask;
    renderer.autoClear = false;
    renderer.setRenderTarget(target); renderer.setClearColor(clear, alpha); renderer.clear();
    camera.layers.set(2); timings.begin('floor'); renderer.render(scene, camera); timings.end();
    camera.layers.set(0); timings.begin('water'); renderer.render(scene, camera); timings.end();
    if (bloom.enabled) {
      timings.begin('bloom');
      renderer.setClearColor(0, 0); renderer.setRenderTarget(light); renderer.clear();
      depthMesh.matrix.copy(top.matrixWorld); camera.layers.set(0);
      renderer.render(depthScene, camera);
      camera.layers.set(1); renderer.render(scene, camera);
      camera.layers.mask = layer;
      quad.material = blur;
      const haloScale = height / 360;
      blur.uniforms.tInput.value = light.texture; blur.uniforms.uStep.value.set(.55 * haloScale / light.width, 0);
      renderer.setRenderTarget(horizontal); renderer.clear(); renderer.render(quadScene, quadCamera);
      blur.uniforms.tInput.value = horizontal.texture; blur.uniforms.uStep.value.set(0, .55 * haloScale / light.height);
      renderer.setRenderTarget(blurred); renderer.clear(); renderer.render(quadScene, quadCamera);
      blur.uniforms.tInput.value = blurred.texture; blur.uniforms.uStep.value.set(.8 * haloScale / light.width, 0);
      renderer.setRenderTarget(horizontal); renderer.clear(); renderer.render(quadScene, quadCamera);
      blur.uniforms.tInput.value = horizontal.texture; blur.uniforms.uStep.value.set(0, .8 * haloScale / light.height);
      renderer.setRenderTarget(blurred); renderer.clear(); renderer.render(quadScene, quadCamera);
      timings.end();
    }
    camera.layers.mask = layer; renderer.setClearColor(clear, alpha);
    quad.material = output; renderer.setRenderTarget(destination);
    timings.begin('output'); renderer.render(quadScene, quadCamera); timings.end();
    renderer.autoClear = autoClear;
  }
  function dispose() {
    target.dispose(); light.dispose(); horizontal.dispose(); blurred.dispose();
    depthMaterial.dispose(); blur.dispose(); output.dispose(); quad.geometry.dispose();
  }
  return { render, resize, bloom, output, target, setScale(value: number) { scale = Math.max(0.8, Math.min(1, value)); resize(width, height); }, get scale() { return scale; }, dispose };
}
