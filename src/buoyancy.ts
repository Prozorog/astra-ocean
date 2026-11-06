import { Vector3 } from 'three';
import type { PhysicalOcean } from './water/ocean';
import { STORM_VIEW } from './water/view';
import { wrapTime } from './water/time';

/** Damped response to GPU equilibrium and measured fluid velocity, independently.
 * Position corrections are NOT fluid currents. Short response intervals resolve
 * their forcing without a render-delay buffer or a full rigid-body solver. */
export function advanceFloat(position: Vector3, velocity: Vector3, equilibrium: Vector3, waterVelocity: Vector3, dt: number, previous?: { position: Vector3; velocity: Vector3 }, horizontal = 11, vertical = 20): void {
  if (dt <= 0) return;
  const steps = previous ? Math.max(2, Math.ceil(dt * 120)) : 1, h = dt / steps;
  const ex = Math.exp(-horizontal * h), ax = (1 + horizontal * h) * ex, bx = h * ex, cx = -horizontal * horizontal * h * ex, dx = (1 - horizontal * h) * ex;
  const damping = .9, frequency = vertical * Math.sqrt(1 - damping * damping), ey = Math.exp(-damping * vertical * h);
  const cosine = Math.cos(frequency * h), sine = Math.sin(frequency * h) / frequency;
  const ay = (cosine + damping * vertical * sine) * ey, by = sine * ey, cy = -vertical * vertical * sine * ey, dy = (cosine - damping * vertical * sine) * ey;
  for (let step = 0; step < steps; step++) {
    const a = step / steps, b = (step + 1) / steps, a2 = a * a, b2 = b * b;
    const a00 = 2 * a2 * a - 3 * a2 + 1, a10 = a2 * a - 2 * a2 + a, a01 = 1 - a00, a11 = a2 * a - a2;
    const b00 = 2 * b2 * b - 3 * b2 + 1, b10 = b2 * b - 2 * b2 + b, b01 = 1 - b00, b11 = b2 * b - b2;
    for (let axis = 0; axis < 3; axis++) {
      const target = equilibrium.getComponent(axis), targetVelocity = waterVelocity.getComponent(axis);
      let start = target - targetVelocity * h, end = target, flow = targetVelocity;
      if (previous) {
        const origin = previous.position.getComponent(axis), originVelocity = previous.velocity.getComponent(axis);
        flow = originVelocity + (targetVelocity - originVelocity) * (a + b) * .5;
        start = a00 * origin + a10 * dt * originVelocity + a01 * target + a11 * dt * targetVelocity;
        end = b00 * origin + b10 * dt * originVelocity + b01 * target + b11 * dt * targetVelocity;
      }
      const feed = (end - start) / h;
      // Solve x'' = w²(q-x) + 2*z*w*(fluidVelocity-x'), NOT damping
      // toward q': readback/prediction corrections may change q independently.
      const offset = 2 * (axis === 1 ? damping : 1) * (flow - feed) / (axis === 1 ? vertical : horizontal);
      const error = position.getComponent(axis) - start - offset, relative = velocity.getComponent(axis) - feed;
      position.setComponent(axis, end + offset + (axis === 1 ? ay : ax) * error + (axis === 1 ? by : bx) * relative);
      velocity.setComponent(axis, feed + (axis === 1 ? cy : cx) * error + (axis === 1 ? dy : dx) * relative);
    }
  }
}

/** A bounded target from the same GPU carrier as contacts. It is not the ball:
 * new readbacks may update equilibrium, never the dynamic position/velocity. */
export class BuoyancyTrack {
  readonly equilibrium = new Vector3();
  readonly velocity = new Vector3();
  quality = 0; ageMs = Infinity; phaseAge = 0;
  private readonly prediction = new Vector3();
  private readonly direction = new Vector3(10.9, 0, 11.2).normalize();
  private initialized = false;
  private aspect: number;
  constructor(private readonly ocean: PhysicalOcean, aspect = 16 / 9) {
    this.aspect = aspect;
    this.direction.y = Math.tan(STORM_VIEW.elevation * Math.PI / 180); this.direction.normalize();
  }
  setAspect(aspect: number): void { this.aspect = aspect; }
  sample(time: number, ball: Vector3, target: Vector3, normal: Vector3): void {
    const s = this.ocean.sample;
    this.ageMs = Math.max(0, performance.now() - s.sampledAt); this.phaseAge = wrapTime(time - s.time);
    const exact = this.ocean.frozen && this.phaseAge < 1e-5;
    this.quality = s.valid && s.residual <= .045 && this.phaseAge < .2 ? (exact ? 1 : Math.max(0, Math.min(1, (250 - this.ageMs) / 180))) : 0;
    if (this.quality > 0 || !this.initialized) {
      this.velocity.set(s.velocityX, s.velocityY, s.velocityZ).multiplyScalar(exact ? 0 : this.quality);
      this.prediction.copy(this.velocity).multiplyScalar(Math.min(this.phaseAge, .065)).clampLength(0, .18);
      this.equilibrium.set(s.x, s.y + STORM_VIEW.ballRadius * (1 - 2 * STORM_VIEW.immersion), s.z).add(this.prediction);
      this.initialized = true;
    } else this.velocity.set(0, 0, 0); // Hold the last trusted target, not extrapolation forever.
    ball.copy(this.equilibrium); normal.set(s.nx, s.ny, s.nz);
    target.set(.35, STORM_VIEW.targetHeight, -.15);
  }
  frameCamera(_time: number, target: Vector3, position: Vector3): void {
    const distance = STORM_VIEW.distance * Math.max(1, (16 / 9) / this.aspect);
    position.copy(this.direction).multiplyScalar(distance).add(target);
  }
  diagnostics() { return { quality: this.quality, ageMs: this.ageMs, phaseAge: this.phaseAge, equilibrium: this.equilibrium.toArray(), waterVelocity: this.velocity.toArray() }; }
}
