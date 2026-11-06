import GUI from 'lil-gui';
import type { ShaderMaterial } from 'three';
import { wrapTime } from '../water/time';
import type { LabEvidence, LabSettings, LabVariant } from './contracts';
import { Presentation } from './presentation';
import { PhysicalOcean } from '../water/ocean';
import { bindPhysicalMaterial, physicalMaterial } from '../water/material';
import { SEA_STATES, STORM_BOX, TURBULENT_BOX } from '../water/spectrum';
import { STORM_VIEW } from '../water/view';
import { SurfaceAccess } from '../water/surface';
export class VariantF implements LabVariant {
  readonly id = 'F'; readonly backend = 'WebGL2 · real-time GPU FFT';
  readonly view = new Presentation(STORM_VIEW); readonly ocean = new PhysicalOcean(this.view.renderer, TURBULENT_BOX, this.view.ballRadius); readonly parameters = this.ocean.parameters;
  private material?: ShaderMaterial; private currentTime = 0; private dropOffset = 0; private dropVelocity = 0; private dropping = false;
  private surface?: SurfaceAccess;
  private refreshControls?: () => void;
  get canvas(): HTMLCanvasElement { return this.view.renderer.domElement; }
  get ready(): boolean { return this.ocean.ready; }
  get frames(): number { return this.view.frames; }
  async initialize(progress: (fraction: number, stage: string) => void): Promise<void> { await this.ocean.initialize(progress); this.material = physicalMaterial(this.ocean); this.view.install(this.material, this.ocean); this.surface = new SurfaceAccess(this.ocean, this.view.root, this.view.camera, this.view.top!); await this.surface.initialize(); await this.seek(0); }
  private present(): void { if (this.material) bindPhysicalMaterial(this.material, this.ocean); const s = this.ocean.anchor.valid ? this.ocean.anchor : this.ocean.sample; this.view.pose(this.currentTime + this.parameters.phaseOffset, s.x, s.y, s.z, this.dropOffset * 10 / this.parameters.sheetSizeMetres, s.nx, s.ny, s.nz); this.view.render(this.currentTime); }
  async seek(time: number): Promise<void> { this.currentTime = this.parameters.loop ? wrapTime(time) : time; this.dropOffset = this.dropVelocity = 0; this.dropping = false; await this.ocean.seek(this.currentTime); this.present(); }
  frame(time: number, dt: number): void {
    if (!this.ready) return; this.currentTime = this.parameters.loop ? wrapTime(time) : time;
    if (this.dropping) { const physicalDt = Math.min(dt, .05) * this.parameters.tau;
      this.dropVelocity += ((this.dropOffset > 0 ? -9.81 : 0) - this.dropOffset * 32 - this.dropVelocity * 11) * physicalDt; this.dropOffset += this.dropVelocity * physicalDt;
      if (Math.abs(this.dropOffset) < 1e-4 && Math.abs(this.dropVelocity) < 1e-3) { this.dropOffset = this.dropVelocity = 0; this.dropping = false; }
      if (this.dropOffset < -2) { this.dropOffset = -2; this.dropVelocity *= -.25; }
    }
    this.ocean.interaction.sphere(0, 0, this.ocean.interaction.radius * .4 + this.dropOffset);
    this.ocean.frame(this.currentTime, dt); this.present();
  }
  resize(width: number, height: number): void { this.view.resize(width, height); }
  controls(gui: GUI, changed: () => void): void {
    const state = { preset: 'Turbulent box (Phillips)', sea: 'Storm' };
    gui.add(state, 'preset', ['Turbulent box (Phillips)', 'Storm box (JONSWAP)']).name('Sea model').onChange((name: string) => { const selected = name === 'Storm box (JONSWAP)' ? STORM_BOX : TURBULENT_BOX; const lengths = this.parameters.cascadeLengths; Object.assign(this.parameters, selected); this.parameters.cascadeLengths = lengths; lengths.splice(0, 3, ...selected.cascadeLengths); this.refreshControls?.(); changed(); });
    gui.add(this.parameters, 'phillipsAmplitude', .0001, .04, .0001).name('Phillips amplitude A').onFinishChange(changed);
    gui.add(state, 'sea', Object.keys(SEA_STATES)).name('Sea state').onChange((name: keyof typeof SEA_STATES) => { this.parameters.wind = SEA_STATES[name]; changed(); gui.controllersRecursive().forEach(controller => controller.updateDisplay()); });
    gui.add(this.parameters, 'wind', 6, 100, .5).name('Wind · m/s').onFinishChange(changed); gui.add(this.parameters, 'fetch', 5, 200, 1).name('Fetch · km').onFinishChange(changed); gui.add(this.parameters, 'swell', 0, 1, .05).name('Swell energy input').onFinishChange(changed);
    gui.add(this.parameters, 'sheetSizeMetres', 40, 300, .1).name('Visible window · m').onFinishChange(changed);
    for (let i = 0; i < 3; i++) gui.add(this.parameters.cascadeLengths, i, 2, 375, .1).name(`C${i} period · m`).onFinishChange(changed);
    gui.add(this.parameters, 'tau', 1, 5, .1).name('Physical clock τ').onFinishChange(changed); gui.add(this.parameters, 'heroHeight', 1, 8, .05).name('Artistic peak gain').onFinishChange(changed); gui.add(this.parameters, 'peakOnly').name('Peak-only gain').onFinishChange(changed);
    gui.add(this.parameters, 'chop', 0, 1.8, .05).name('Choppiness').onFinishChange(changed); gui.add(this.parameters, 'Jthr', -.4, .8, .01).name('Compression source J').onFinishChange(changed);
    gui.add(this.parameters, 'crestSharpening', 0, 1, .05).name('Artistic Stokes crest').onFinishChange(changed);
    gui.add(this.parameters, 'foamDecay', .08, 5, .01).name('Foam decay · screen s').onFinishChange(changed); gui.add(this.parameters, 'foamSlip', 0, 5, .1).name('Residual foam slip m/s').onFinishChange(changed); gui.add(this.parameters, 'foamDiffusion', 0, .5, .01).name('Diffusion · m²/s').onFinishChange(changed); gui.add(this.parameters, 'foamRelief', 0, 3.1, .01).name('Breaking-layer relief · m').onFinishChange(changed);
    gui.add(this.parameters, 'seed', 0, 4294967295, 1).name('Seed').onFinishChange(changed); gui.add(this.parameters, 'phaseOffset', 0, 3.63, .01).name('Common phase · s').onFinishChange(changed); gui.add(this.parameters, 'loop').name('Quantized loop').onFinishChange(changed);
    this.refreshControls = () => {
      const phillips = this.parameters.model === 'phillips'; state.preset = phillips ? 'Turbulent box (Phillips)' : 'Storm box (JONSWAP)';
      for (const c of gui.controllersRecursive()) {
        if (['sea', 'fetch', 'swell', 'tau', 'heroHeight', 'peakOnly', 'crestSharpening'].includes(c.property)) c.show(!phillips);
        if (c.property === 'phillipsAmplitude') c.show(phillips);
        c.updateDisplay();
      }
    }; this.refreshControls();
  }
  async apply(values: LabSettings): Promise<void> {
    const lengths = this.parameters.cascadeLengths; Object.assign(this.parameters, values); this.parameters.cascadeLengths = lengths;
    if (Array.isArray(values.cascadeLengths)) lengths.splice(0, 3, ...values.cascadeLengths);
    this.refreshControls?.();
    await this.ocean.rebuild(); await this.seek(this.currentTime);
  }
  dropBall(): void { this.dropOffset = this.view.ballRadius * this.parameters.sheetSizeMetres / 10 * .6 + 2; this.dropVelocity = 0; this.dropping = true; }
  tap(clientX: number, clientY: number): void {
    void this.surface?.pick(clientX, clientY).then(contact => { if (contact) this.surface!.impulse(contact.parameter, .12); });
  }
  async evidence(): Promise<LabEvidence> {
    const spectrum = this.ocean.diagnostics(), cachedHeight = this.ocean.sample.y; await this.ocean.readSample(this.currentTime, true);
    const errorMetres = Math.abs(cachedHeight - this.ocean.sample.y) * this.parameters.sheetSizeMetres / 10; this.view.mask(this.currentTime, false); const ball = this.view.screenBall();
    return { id: this.id, backend: this.backend, parameters: { ...this.parameters }, ballScreen: ball.centre, ballRadiusPixels: ball.radius, ballWorld: this.view.ballWorld.toArray(), reliefPercent: spectrum.reliefPercent,
      foamCoverage: this.view.foamCoverage, spectrum, fft: this.ocean.fftResult, buoyancy: { ...spectrum.buoyancy, currentGpuSampleErrorMetres: errorMetres }, renderer: this.view.rendererName(), frames: this.frames, frameIntervals: this.view.frameIntervals() };
  }
  async mask(): Promise<string> { return this.view.mask(this.currentTime); }
  async capture(type = 'image/png'): Promise<string> { this.present(); return this.canvas.toDataURL(type, .94); }
  dispose(): void { this.surface?.dispose(); this.ocean.dispose(); this.view.dispose(); }
}
