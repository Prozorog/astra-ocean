import { Matrix4, Plane, Ray, Raycaster, Vector2, Vector3 } from 'three';
import type { Group, Mesh, PerspectiveCamera, Vector4 } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG, settings } from './waves';
import { makeContactSample } from './water/surface';
import type { ContactSample, SurfaceAccess } from './water/surface';
import type { SplashBursts } from './droplets';
import { advanceFloat } from './buoyancy';
import type { BuoyancyTrack } from './buoyancy';

interface InteractionHost {
  canvas: HTMLCanvasElement; camera: PerspectiveCamera; root: Group; ball: Mesh; controls: OrbitControls;
  impacts: Vector4[]; surface: SurfaceAccess; floating: BuoyancyTrack; radius: number; time(): number; blocked(): boolean; changed(): void; interacted(): void;
  storm(delta: number): void; splashAudio(speed: number): void;
}
export interface InteractionState {
  mode: 'track' | 'held' | 'flying' | 'bobbing'; position: number[]; velocity: number[];
  tilt: number[]; slosh: number[]; pulseWeights: number[]; droplets: number;
  bounceCount: number; lastImpactAt: number; releaseAt: number; reducedMotion: boolean;
}
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export class OceanInteractions {
  enabled = true;
  mode: InteractionState['mode'] = 'track';
  readonly tilt = new Vector2();
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly reducedMotion: MediaQueryList;
  private tiltTarget = new Vector2();
  private tiltVelocity = new Vector2();
  private sloshVelocity = new Vector2();
  private readonly slosh = new Vector2();
  private drift = new Vector2();
  private raycaster = new Raycaster();
  private localRay = new Ray();
  private inverse = new Matrix4();
  private pointer = new Vector2();
  private previousPointer = new Vector2();
  private plane = new Plane(new Vector3(0, 1, 0), 0);
  private hit = new Vector3();
  private desired = new Vector3();
  private dragOffset = new Vector2();
  private dragVelocity = new Vector3();
  private previousDesired = new Vector3();
  private worldPoint = new Vector3();
  private worldNormal = new Vector3();
  private surface = makeContactSample();
  readonly support = makeContactSample();
  private readonly supportPoints = Array.from({ length: 4 }, makeContactSample);
  private readonly supportCentroid = new Vector3();
  private readonly floatTarget = new Vector3();
  private readonly floatVelocity = new Vector3();
  private readonly floatHistory = { position: new Vector3(), velocity: new Vector3() };
  private readonly offsetPos = new Vector3();
  private readonly offsetVel = new Vector3();
  readonly gpuOffset = new Vector3();
  private floatHistoryValid = false;
  private readonly returnAnchor = new Vector3();
  private floatInitialized = false;
  private pointerId = -1;
  private downX = 0; private downY = 0;
  private heldPlane = 0;
  private lastPointerAt = -Infinity;
  private lastDragAt = -Infinity;
  private lastMotionAt = -Infinity;
  private pulseIndex = 0;
  private releaseAt = -Infinity;
  private bobElapsed = 0;
  private lastImpactAt = -Infinity;
  private bounceCount = 0;
  private skipEligible = false;
  constructor(private host: InteractionHost, private splashes: SplashBursts) {
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion.addEventListener('change', () => { if (this.reducedMotion.matches) this.resetMotion(); });
    host.canvas.addEventListener('pointerdown', this.pointerDown, { capture: true });
    host.canvas.addEventListener('pointermove', this.pointerMove, { passive: true });
    host.canvas.addEventListener('pointerup', this.pointerUp);
    host.canvas.addEventListener('pointercancel', this.pointerCancel);
    host.canvas.addEventListener('pointerleave', () => { this.tiltTarget.set(0, 0); if (this.mode !== 'held') host.canvas.style.cursor = ''; });
    host.canvas.addEventListener('wheel', event => {
      if (this.blocked()) return; event.preventDefault(); host.interacted();
      host.storm(-Math.sign(event.deltaY) * .075); host.changed();
    }, { passive: false });
  }
  private blocked(): boolean { return !this.enabled || this.host.blocked(); }
  private setRay(event: PointerEvent): void {
    const rect = this.host.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.host.camera);
    this.inverse.copy(this.host.root.matrixWorld).invert(); this.localRay.copy(this.raycaster.ray).applyMatrix4(this.inverse);
  }
  sampleWater(x: number, z: number, out: ContactSample, slot = 1): void {
    this.host.surface.sampleCached(slot, x, z, out);
  }
  private pointerDown = (event: PointerEvent): void => {
    if (this.blocked() || this.pointerId !== -1 || event.button !== 0) return;
    this.setRay(event); this.downX = event.clientX; this.downY = event.clientY; this.pointerId = event.pointerId;
    this.host.ball.updateWorldMatrix(true, false);
    if (!this.raycaster.intersectObject(this.host.ball, false).length) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.host.interacted();
    this.mode = 'held'; this.bounceCount = 0; this.position.copy(this.host.ball.position); this.velocity.set(0, 0, 0); this.dragVelocity.set(0, 0, 0);
    this.sampleWater(this.position.x, this.position.z, this.surface);
    this.heldPlane = this.surface.position.y + this.host.radius * 2.1; this.plane.constant = -this.heldPlane;
    if (this.localRay.intersectPlane(this.plane, this.hit)) this.dragOffset.set(this.position.x - this.hit.x, this.position.z - this.hit.z);
    else this.dragOffset.set(0, 0);
    this.desired.copy(this.position); this.desired.y = this.heldPlane; this.previousDesired.copy(this.desired);
    this.lastDragAt = performance.now() / 1000; this.host.controls.enabled = false;
    this.host.canvas.setPointerCapture(event.pointerId); this.host.canvas.style.cursor = 'grabbing'; this.host.changed();
  };
  private pointerMove = (event: PointerEvent): void => {
    if (this.blocked()) return;
    const wall = performance.now() / 1000; this.setRay(event);
    if (this.mode === 'held' && event.pointerId === this.pointerId) {
      this.plane.constant = -this.heldPlane;
      if (this.localRay.intersectPlane(this.plane, this.hit)) {
        this.desired.set(clamp(this.hit.x + this.dragOffset.x, -4.2, 4.2), this.heldPlane, clamp(this.hit.z + this.dragOffset.y, -4.2, 4.2));
        this.sampleWater(this.desired.x, this.desired.z, this.surface, 2); this.desired.y = this.surface.position.y + this.host.radius * 2.1;
        const dt = Math.max(.008, wall - this.lastDragAt);
        this.dragVelocity.subVectors(this.desired, this.previousDesired).divideScalar(dt).clampLength(0, 8);
        this.previousDesired.copy(this.desired); this.lastDragAt = wall;
      }
    } else {
      this.host.canvas.style.cursor = this.raycaster.intersectObject(this.host.ball, false).length ? 'grab' : '';
      if (!this.reducedMotion.matches) {
        this.plane.constant = 0;
        if (this.localRay.intersectPlane(this.plane, this.hit)) this.tiltTarget.set(clamp(this.hit.x / 5, -1, 1), clamp(this.hit.z / 5, -1, 1)).multiplyScalar(Math.PI / 30);
        const dt = wall - this.lastPointerAt;
        if (dt > .003 && dt < .2) {
          const vx = (this.pointer.x - this.previousPointer.x) / dt, vz = -(this.pointer.y - this.previousPointer.y) / dt;
          const speed = Math.hypot(vx, vz);
          if (speed > 1.2) { this.sloshVelocity.x += clamp(vx * .055, -1.2, 1.2); this.sloshVelocity.y += clamp(vz * .055, -1.2, 1.2); this.sloshVelocity.clampLength(0, 3); }
        }
        this.lastMotionAt = wall;
      }
    }
    this.previousPointer.copy(this.pointer); this.lastPointerAt = wall; this.host.changed();
  };
  private pointerUp = async (event: PointerEvent): Promise<void> => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    if (this.blocked()) return;
    if (this.mode === 'held') {
      this.mode = 'flying'; this.releaseAt = performance.now() / 1000;
      this.velocity.copy(this.dragVelocity).multiplyScalar(Math.exp(-Math.max(0, this.releaseAt - this.lastDragAt - .08) * 15)).clampLength(0, 8);
      this.skipEligible = Math.hypot(this.velocity.x, this.velocity.z) > 2.3;
      if (this.host.canvas.hasPointerCapture(event.pointerId)) this.host.canvas.releasePointerCapture(event.pointerId);
      this.host.controls.enabled = true; this.host.canvas.style.cursor = 'grab'; this.host.changed();
    } else if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) < 6) {
      const contact = await this.host.surface.pick(event.clientX, event.clientY);
      if (contact && !this.blocked()) { this.host.interacted(); this.splash(contact.position.x, contact.position.z, .12, 20, 1.5, performance.now() / 1000, false, contact); this.host.changed(); }
    }
  };
  private pointerCancel = (): void => { this.pointerId = -1; if (this.mode === 'held') { this.mode = 'bobbing'; this.bobElapsed = 0; this.returnAnchor.copy(this.position); this.host.controls.enabled = true; this.host.canvas.style.cursor = ''; } };
  splash(x: number, z: number, amplitude: number, count: number, speed: number, wall: number, volumeOnly = false, contact?: ContactSample): void {
    if (contact) { this.surface.position.copy(contact.position); this.surface.normal.copy(contact.normal); this.surface.parameter.copy(contact.parameter); }
    else this.sampleWater(x, z, this.surface);
    const parameter = this.surface.parameter;
    // Event metadata stays bounded to six slots; it is NOT an analytic ring.
    this.host.impacts[this.pulseIndex].set(parameter.x, parameter.y, wall, amplitude); this.pulseIndex = (this.pulseIndex + 1) % CONFIG.ripple.count;
    if (!volumeOnly) this.host.surface.impulse(parameter, amplitude * settings.ripples);
    this.host.root.updateWorldMatrix(true, false); this.worldPoint.copy(this.surface.position).applyMatrix4(this.host.root.matrixWorld);
    this.worldNormal.copy(this.surface.normal).transformDirection(this.host.root.matrixWorld);
    this.splashes.emit(this.worldPoint, this.worldNormal, count, speed, wall); this.host.splashAudio(speed); this.lastImpactAt = wall;
  }
  intro(base: Vector3, wall: number): void {
    this.position.copy(base); this.position.y += 2.6; this.velocity.set(0, 0, 0); this.floatInitialized = true;
    this.mode = 'flying'; this.releaseAt = wall; this.bounceCount = 0; this.skipEligible = false;
  }
  advance(dt: number, wall: number): void {
    for (const pulse of this.host.impacts) if (pulse.w > 0 && wall - pulse.z > CONFIG.ripple.lifetime) pulse.w = 0;
    if (this.reducedMotion.matches || this.blocked()) { this.resetMotion(); return; }
    if (wall - this.lastMotionAt > 2) this.tiltTarget.set(0, 0);
    if (wall - this.lastMotionAt > 8) { this.resetMotion(); return; }
    const omega = 10, decay = Math.exp(-omega * dt);
    for (let i = 0; i < 2; i++) {
      const target = this.tiltTarget.getComponent(i), error = this.tilt.getComponent(i) - target, c = this.tiltVelocity.getComponent(i) + omega * error;
      this.tilt.setComponent(i, target + (error + c * dt) * decay); this.tiltVelocity.setComponent(i, (this.tiltVelocity.getComponent(i) - omega * c * dt) * decay);
      const position = this.slosh.getComponent(i), velocity = this.sloshVelocity.getComponent(i), frequency = Math.PI * 1.8;
      const nextVelocity = velocity + (-frequency * frequency * position - 2 * .15 * frequency * velocity) * dt;
      this.sloshVelocity.setComponent(i, nextVelocity); this.slosh.setComponent(i, position + nextVelocity * dt);
    }
    this.slosh.clampLength(0, .6);
    this.host.surface.ocean.interaction.tilt.set(-this.tilt.x - this.slosh.x * .12, 0, -this.tilt.y - this.slosh.y * .12);
    this.drift.addScaledVector(this.tilt, dt * .7).multiplyScalar(Math.exp(-dt * 1.6));
  }
  private sampleSupport(): void {
    const support = this.support, ocean = this.host.surface.ocean, centre = this.surface.parameter;
    // Heightfield sphere columns describe a fictitious depression INSIDE the
    // solid. Its centre is not a free water surface. Sample just outside that
    // exact material-space mask, padded for bilinear/normal texel footprints.
    const r = this.host.radius + 1.5 * 10 / ocean.interaction.N;
    this.supportCentroid.set(0, 0, 0); support.normal.set(0, 0, 0); support.velocity.set(0, 0, 0);
    let weightSum = 0, age = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.supportPoints[i], slot = 8 + i;
      const x = centre.x + (i === 0 ? r : i === 1 ? -r : 0), z = centre.y + (i === 2 ? r : i === 3 ? -r : 0);
      if (Math.abs(x) > 4.99 || Math.abs(z) > 4.99) continue;
      this.host.surface.sampleCached(slot, x, z, c, false);
      const source = ocean.samples[slot], near = Math.hypot(x - source.px, z - source.pz) < .2;
      const confidence = c.valid ? 1 : near ? Math.max(0, (120 - c.ageMs) / 120) : 0;
      const weight = confidence * Math.max(0, c.normal.y);
      if (weight <= 0) continue;
      this.supportCentroid.addScaledVector(c.position, weight); support.normal.addScaledVector(c.normal, weight); support.velocity.addScaledVector(c.velocity, weight);
      weightSum += weight; age = Math.max(age, c.ageMs);
    }
    support.valid = weightSum > .35; support.ageMs = age;
    if (support.valid) {
      this.supportCentroid.divideScalar(weightSum); support.normal.normalize(); support.velocity.divideScalar(weightSum);
      const n = support.normal, dx = this.position.x - this.supportCentroid.x, dz = this.position.z - this.supportCentroid.z;
      const plane = n.y > .25 ? clamp(-(n.x * dx + n.z * dz) / n.y, -this.host.radius * .4, this.host.radius * .4) : 0;
      support.position.set(this.position.x, this.supportCentroid.y + plane, this.position.z);
      support.parameter.copy(centre); support.time = this.surface.time; support.jacobian = null;
    }
  }
  updateBall(dt: number, wall: number, base: Vector3, normal: Vector3, heldDt = dt): void {
    if (!this.floatInitialized) { this.position.copy(base); this.floatInitialized = true; }
    if (dt <= 0 && heldDt <= 0) { this.gpuOffset.subVectors(this.position, base); this.host.ball.position.copy(this.position); return; }
    if (this.mode === 'held') {
      this.floatHistoryValid = false;
      this.sampleWater(this.desired.x, this.desired.z, this.surface, 2);
      if (this.surface.valid) this.desired.y = this.surface.position.y + this.host.radius * 2.1;
      this.floatVelocity.set(0, 0, 0); advanceFloat(this.position, this.velocity, this.desired, this.floatVelocity, heldDt, undefined, 30, 30);
      normal.copy(this.surface.normal);
    } else if (this.mode === 'flying') {
      this.floatHistoryValid = false;
      this.position.addScaledVector(this.velocity, dt); this.position.y -= .5 * 9.8 * dt * dt; this.velocity.y -= 9.8 * dt;
      this.sampleWater(this.position.x, this.position.z, this.surface); this.sampleSupport();
      const collisionWater = this.support.valid ? this.support : this.surface;
      if (collisionWater.valid && this.velocity.y < 0 && this.position.y <= collisionWater.position.y + this.host.radius * .4) {
        const impact = Math.max(1, -this.velocity.y); this.position.y = collisionWater.position.y + this.host.radius * .4;
        this.splash(this.position.x, this.position.z, clamp(impact * .04, .1, .35), Math.round(clamp(60 + impact * 8, 60, 120)), impact, wall, true, collisionWater);
        this.bounceCount++;
        if (this.skipEligible && this.bounceCount < 2 && Math.hypot(this.velocity.x, this.velocity.z) > 2) {
          this.velocity.y = Math.min(3.1, impact * .38); this.velocity.x *= .65; this.velocity.z *= .65;
        } else {
          this.mode = 'bobbing'; this.bobElapsed = 0; this.returnAnchor.copy(this.position); this.velocity.y = Math.min(1.8, impact * .2);
        }
      }
      normal.copy(this.surface.normal);
    } else {
      // Critically damped spring offset (omega = 12 rad/s) on top of the
      // zero-latency GPU carrier point. Mode transition bobbing -> track
      // shares the exact same offset state and never causes a step.
      this.sampleWater(this.position.x, this.position.z, this.surface); this.sampleSupport();
      this.floatTarget.copy(base); this.floatTarget.x += this.drift.x; this.floatTarget.z += this.drift.y;
      this.floatVelocity.copy(this.host.floating.velocity);
      if (this.mode === 'bobbing') {
        this.bobElapsed += dt;
        if (this.bobElapsed >= 2.4) this.mode = 'track';
      }
      if (!this.floatHistoryValid) {
        this.floatHistory.position.copy(this.floatTarget);
        this.floatHistory.velocity.copy(this.floatVelocity);
        this.offsetPos.subVectors(this.position, this.floatTarget);
        this.offsetVel.subVectors(this.velocity, this.floatVelocity);
        this.floatHistoryValid = true;
      }
      const steps = Math.max(2, Math.ceil(dt * 120)), h = dt / steps, omega = 12, decay = Math.exp(-omega * h);
      for (let step = 0; step < steps; step++) {
        const a = step / steps, b = (step + 1) / steps, a2 = a * a, b2 = b * b;
        const a00 = 2 * a2 * a - 3 * a2 + 1, a10 = a2 * a - 2 * a2 + a, a01 = 1 - a00, a11 = a2 * a - a2;
        const b00 = 2 * b2 * b - 3 * b2 + 1, b10 = b2 * b - 2 * b2 + b, b01 = 1 - b00, b11 = b2 * b - b2;
        for (let axis = 0; axis < 3; axis++) {
          const origin = this.floatHistory.position.getComponent(axis), originVel = this.floatHistory.velocity.getComponent(axis);
          const target = this.floatTarget.getComponent(axis), targetVel = this.floatVelocity.getComponent(axis);
          const start = a00 * origin + a10 * dt * originVel + a01 * target + a11 * dt * targetVel;
          const end = b00 * origin + b10 * dt * originVel + b01 * target + b11 * dt * targetVel;
          const feed = (end - start) / h;
          const err = this.offsetPos.getComponent(axis), vel = this.offsetVel.getComponent(axis), c = vel + omega * err;
          const nextErr = (err + c * h) * decay, nextVel = (vel - omega * c * h) * decay;
          this.offsetPos.setComponent(axis, nextErr);
          this.offsetVel.setComponent(axis, nextVel);
          this.position.setComponent(axis, end + nextErr);
          this.velocity.setComponent(axis, feed + nextVel);
        }
      }
      this.floatHistory.position.copy(this.floatTarget); this.floatHistory.velocity.copy(this.floatVelocity);
    }
    for (let axis = 0; this.mode !== 'track' && axis < 3; axis += 2) {
      const value = this.position.getComponent(axis);
      if (Math.abs(value) > 4.2) { this.position.setComponent(axis, clamp(value, -4.2, 4.2)); if (this.velocity.getComponent(axis) * value > 0) this.velocity.setComponent(axis, 0); }
    }
    this.gpuOffset.subVectors(this.position, base);
    this.host.ball.position.copy(this.position);
  }
  private resetMotion(): void { this.tilt.set(0, 0); this.tiltTarget.set(0, 0); this.tiltVelocity.set(0, 0); this.slosh.set(0, 0); this.sloshVelocity.set(0, 0); this.drift.set(0, 0); this.host.surface.ocean.interaction.tilt.set(0, 0, 0); }
  reset(): void {
    if (this.pointerId >= 0 && this.host.canvas.hasPointerCapture(this.pointerId)) this.host.canvas.releasePointerCapture(this.pointerId);
    this.pointerId = -1; this.mode = 'track'; this.position.copy(this.host.ball.position); this.floatInitialized = true; this.velocity.set(0, 0, 0); this.dragVelocity.set(0, 0, 0);
    this.offsetPos.set(0, 0, 0); this.offsetVel.set(0, 0, 0); this.gpuOffset.set(0, 0, 0);
    this.floatHistoryValid = false; this.support.valid = false;
    this.resetMotion(); this.lastMotionAt = -Infinity; this.lastPointerAt = -Infinity;
    for (const pulse of this.host.impacts) pulse.set(0, 0, 0, 0);
    this.splashes.reset(); this.host.canvas.style.cursor = '';
  }
  get active(): boolean {
    if (this.mode !== 'track' || this.tilt.lengthSq() > 0 || this.slosh.lengthSq() > 0) return true;
    for (const pulse of this.host.impacts) if (pulse.w > 0) return true;
    return false;
  }
  inspect(wall: number): InteractionState {
    return { mode: this.mode, position: this.host.ball.position.toArray(), velocity: this.velocity.toArray(), tilt: this.tilt.toArray(), slosh: this.slosh.toArray(),
      pulseWeights: this.host.impacts.map(pulse => pulse.w), droplets: this.splashes.countAt(wall), bounceCount: this.bounceCount, lastImpactAt: this.lastImpactAt, releaseAt: this.releaseAt, reducedMotion: this.reducedMotion.matches };
  }
}
