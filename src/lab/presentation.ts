import { BufferGeometry, Color, DataTexture, Group, LinearSRGBColorSpace, Matrix3, Mesh, NoToneMapping, PerspectiveCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, SphereGeometry, UnsignedByteType, Vector3, WebGLRenderer } from 'three';
import { LOOP, wrapTime } from '../water/time';
import { sheetGeometry, lipGeometry } from '../water/geometry';
import { ballMaterial } from '../materials';
import { floorMaterial, FoldShadow } from '../shadow';
import { makePost } from '../post';
import type { PostPipeline } from '../post';
import { GpuTimings } from '../gpu-timing';
import { MoodController } from '../moods';
import type { PhysicalOcean } from '../water/ocean';
import { aeratedFoam } from '../water/aeration';
export const HERO_DISTANCE = 20.716309, BALL_RADIUS = 1.25;
export function rigidTumble(root: Group, time: number): void { const p = wrapTime(time) / LOOP * Math.PI * 2; root.rotation.set(Math.sin(p + .35) * Math.PI / 20, Math.sin(p) * Math.PI / 12, Math.sin(p + 1.8) * Math.PI / 20, 'XYZ'); }
export class Presentation {
  readonly renderer: WebGLRenderer; readonly scene = new Scene(); readonly root = new Group(); readonly camera = new PerspectiveCamera(30, 16 / 9, .1, 160);
  readonly ball: Mesh<SphereGeometry, ShaderMaterial>; readonly floor: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly timings: GpuTimings;
  readonly emptyShadow = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  shadow?: FoldShadow; post?: PostPipeline; moods?: MoodController;
  aeration?: ReturnType<typeof aeratedFoam>;
  readonly ballWorld = new Vector3(); readonly sheetMatrix = new Matrix3(); readonly projected = new Vector3(); readonly radiusPoint = new Vector3();
  private readonly contactPoint = new Vector3(); private readonly contactNormal = new Vector3(0, 1, 0);
  readonly intervals = new Float32Array(900); frames = 0; private count = 0; private cursor = 0; private previousDraw = 0;
  top?: Mesh<PlaneGeometry, ShaderMaterial>; lip?: Mesh<BufferGeometry, ShaderMaterial>; waterUniforms?: ShaderMaterial['uniforms'];
  width = 960; height = 540; private diagnostic = false;
  foamCoverage = 0;
  maskPixels = new Uint8Array(0);
  private readonly floorColor = new Color(0.6572, 0.2114, 0.1648);
  readonly ballRadius: number;
  private readonly immersion: number;
  private readonly segments: number;
  private readonly tumbleScale: number;
  constructor(options: { ballRadius?: number; immersion?: number; distance?: number; elevation?: number; targetHeight?: number; segments?: number; tumbleScale?: number } = {}) {
    this.ballRadius = options.ballRadius ?? BALL_RADIUS; this.immersion = options.immersion ?? .14; this.segments = options.segments ?? 256; this.tumbleScale = options.tumbleScale ?? 1;
    this.renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1); this.renderer.outputColorSpace = LinearSRGBColorSpace; this.renderer.toneMapping = NoToneMapping; this.renderer.autoClear = false;
    this.renderer.setClearColor(this.floorColor, 1);
    this.renderer.domElement.tabIndex = 0; this.renderer.domElement.setAttribute('aria-label', 'Water Lab ocean preview');
    this.timings = new GpuTimings(this.renderer);
    this.emptyShadow.needsUpdate = true;
    this.root.position.y = 4; this.scene.add(this.root);
    const direction = new Vector3(10.9, 9.03, 11.2).normalize(); if (options.elevation !== undefined) { const angle = options.elevation * Math.PI / 180; direction.y = Math.tan(angle) * Math.hypot(direction.x, direction.z); direction.normalize(); } const target = new Vector3(.35, options.targetHeight ?? 3.3, -.15); this.camera.position.copy(direction).multiplyScalar(options.distance ?? HERO_DISTANCE).add(target); this.camera.lookAt(target);
    this.ball = new Mesh(new SphereGeometry(this.ballRadius, 48, 32), ballMaterial(this.ballRadius, this.immersion));
    this.ball.layers.enable(1); this.root.add(this.ball);
    this.floor = new Mesh(new PlaneGeometry(2000, 2000), floorMaterial(this.emptyShadow, this.emptyShadow));
    this.floor.rotation.x = -Math.PI / 2; this.floor.layers.set(2); this.scene.add(this.floor);
  }
  install(material: ShaderMaterial, ocean?: PhysicalOcean): void {
    this.waterUniforms = material.uniforms;
    this.top = new Mesh(sheetGeometry(this.segments), material); this.top.frustumCulled = false; this.root.add(this.top);
    const lipMaterial = new ShaderMaterial({ vertexShader: material.vertexShader, fragmentShader: material.fragmentShader, side: material.side, toneMapped: false, uniforms: { ...material.uniforms, uLip: { value: true } } });
    this.lip = new Mesh(lipGeometry(this.segments), lipMaterial); this.lip.frustumCulled = false; this.root.add(this.lip);
    if (material.uniforms.uGeometry) {
      this.shadow = new FoldShadow(sheetGeometry(96), material);
      this.floor.material.uniforms.uShadow.value = this.shadow.mask.texture;
      this.floor.material.uniforms.uBlurredShadow.value = this.shadow.blurred.texture;
    } else {
      this.floor.material.uniforms.uShadowStrength.value = 0;
    }
    this.post = makePost(this.renderer, this.scene, this.camera, this.timings, this.top);
    if (ocean) {
      this.aeration = aeratedFoam(material, this.camera); this.root.add(this.aeration);
      this.ball.material.uniforms.uBallState.value = ocean.ballState.textures[0];
      this.ball.material.uniforms.uBallNormal.value = ocean.ballState.textures[1];
      this.ball.material.uniforms.uUseGpuBall.value = true;
      this.moods = new MoodController([material, lipMaterial], this.ball.material, this.floor.material, this.post.output);
    }
    this.resize(this.width, this.height);
  }
  pose(time: number, x: number, height: number, z: number, offsetY = 0, nx = 0, ny = 1, nz = 0): void {
    rigidTumble(this.root, time); this.root.rotation.x *= this.tumbleScale; this.root.rotation.z *= this.tumbleScale;
    this.ball.position.set(x, height + this.ballRadius * (1 - 2 * this.immersion) + offsetY, z);
    this.root.updateMatrixWorld(true); this.ball.getWorldPosition(this.ballWorld); this.sheetMatrix.setFromMatrix4(this.root.matrixWorld);
    this.contactPoint.set(x, height, z).applyMatrix4(this.root.matrixWorld);
    this.contactNormal.set(nx, ny, nz).transformDirection(this.root.matrixWorld);
    const bu = this.ball.material.uniforms;
    bu.uSheetMatrix.value.copy(this.root.matrixWorld);
    bu.uBallOffset.value.set(0, offsetY, 0);
    bu.uWaterPlane.value.set(this.contactNormal.x, this.contactNormal.y, this.contactNormal.z, -this.contactNormal.dot(this.contactPoint));
    if (this.waterUniforms) {
      this.waterUniforms.uBall.value = this.ballWorld;
      this.waterUniforms.uSheet.value = this.sheetMatrix;
      if (this.waterUniforms.uSheetMatrix) this.waterUniforms.uSheetMatrix.value.copy(this.root.matrixWorld);
      if (this.waterUniforms.uBallOffset) this.waterUniforms.uBallOffset.value.set(0, offsetY, 0);
    }
    if (this.lip) {
      const lu = this.lip.material.uniforms;
      lu.uBall.value = this.ballWorld;
      lu.uSheet.value = this.sheetMatrix;
      if (lu.uSheetMatrix) lu.uSheetMatrix.value.copy(this.root.matrixWorld);
      if (lu.uBallOffset) lu.uBallOffset.value.set(0, offsetY, 0);
    }
  }
  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width)); this.height = Math.max(1, Math.round(height));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height; this.camera.updateProjectionMatrix();
    this.post?.resize(this.width, this.height);
    if (this.top) this.render(0);
  }
  render(time: number): void {
    if (!this.post) return;
    if (this.shadow && !this.diagnostic) this.shadow.render(this.renderer, this.root);
    this.post.output.uniforms.uPhase.value = wrapTime(time) * Math.PI * 2 / LOOP;
    this.post.bloom.enabled = !this.diagnostic;
    this.post.output.uniforms.uFilm.value = !this.diagnostic;
    this.post.output.uniforms.uDiagnostic.value = this.diagnostic;
    this.renderer.setClearColor(this.diagnostic ? 0x000000 : this.floor.material.uniforms.uCoral.value, 1);
    this.post.render(null);
    if (!this.diagnostic) { const now = performance.now(); if (this.previousDraw) { this.intervals[this.cursor] = now - this.previousDraw; this.cursor = (this.cursor + 1) % this.intervals.length; this.count = Math.min(this.intervals.length, this.count + 1); } this.previousDraw = now; this.frames++; }
  }
  mask(time: number, image = true): string {
    this.diagnostic = true;
    this.floor.material.uniforms.uDiagnostic.value = true;
    this.ball.material.uniforms.uDiagnostic.value = true;
    if (this.waterUniforms) this.waterUniforms.uDiagnostic.value = true;
    if (this.lip) this.lip.material.uniforms.uDiagnostic.value = true;
    this.render(time);
    if (this.maskPixels.length !== this.width * this.height * 4) this.maskPixels = new Uint8Array(this.width * this.height * 4);
    const gl = this.renderer.getContext(); gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.maskPixels);
    let water = 0, foam = 0;
    for (let i = 0; i < this.maskPixels.length; i += 4) if (this.maskPixels[i] > 240) { water++; if (this.maskPixels[i + 1] >= 128) foam++; }
    this.foamCoverage = water ? foam / water : 0;
    const result = image ? this.renderer.domElement.toDataURL('image/png') : '';
    this.diagnostic = false;
    this.floor.material.uniforms.uDiagnostic.value = false;
    this.ball.material.uniforms.uDiagnostic.value = false;
    if (this.waterUniforms) this.waterUniforms.uDiagnostic.value = false;
    if (this.lip) this.lip.material.uniforms.uDiagnostic.value = false;
    this.render(time); return result;
  }
  screenBall(): { centre: [number, number]; radius: number } {
    this.projected.copy(this.ballWorld).project(this.camera); this.radiusPoint.copy(this.ballWorld).addScaledVector(new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0), this.ballRadius).project(this.camera);
    return { centre: [(this.projected.x + 1) / 2, (1 - this.projected.y) / 2], radius: Math.abs(this.radiusPoint.x - this.projected.x) * this.width / 2 };
  }
  frameIntervals(): number[] { const result = new Array<number>(this.count); for (let i = 0; i < this.count; i++) result[i] = this.intervals[(this.cursor - this.count + i + this.intervals.length) % this.intervals.length]; return result; }
  rendererName(): string { const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }
  dispose(): void { this.aeration?.geometry.dispose(); this.aeration?.material.dispose(); this.post?.dispose(); this.emptyShadow.dispose(); this.shadow?.mask.dispose(); this.shadow?.blurred.dispose(); this.top?.geometry.dispose(); this.top?.material.dispose(); this.lip?.geometry.dispose(); this.lip?.material.dispose(); this.ball.geometry.dispose(); this.ball.material.dispose(); this.floor.geometry.dispose(); this.floor.material.dispose(); this.renderer.dispose(); }
}
