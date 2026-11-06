import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Points, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { CONFIG, loopTime, settings } from './waves';
import { makeContactSample } from './water/surface';
import type { SurfaceAccess } from './water/surface';

const COUNT = 18, LIFE = 0.31;
export class LipDroplets {
  readonly positions = new Float32Array(COUNT * 3);
  readonly fades = new Float32Array(COUNT);
  readonly geometry = new BufferGeometry();
  readonly points: Points;
  private sample = makeContactSample();
  private quaternion = new Quaternion();
  private velocity = new Vector3();
  constructor(private readonly surface: SurfaceAccess) {
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aFade', new BufferAttribute(this.fades, 1));
    this.points = new Points(this.geometry, new ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float aFade; varying float vFade; void main() { vFade = aFade; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_PointSize = clamp(34.0 / -p.z, 1.0, 2.2); }`,
      fragmentShader: `precision highp float; varying float vFade; void main() { float d = length(gl_PointCoord - 0.5); if(d > 0.5 || vFade < 0.01) discard; gl_FragColor = vec4(0.44, 0.62, 0.66, vFade * (1.0 - smoothstep(0.2, 0.5, d))); }`,
    }));
    this.points.frustumCulled = false;
  }
  update(time: number): void {
    this.points.visible = settings.droplets;
    if (!settings.droplets) return;
    for (let i = 0; i < COUNT; i++) {
      const born = i / COUNT * CONFIG.period, age = loopTime(time + this.surface.ocean.parameters.phaseOffset - born);
      this.fades[i] = 0;
      if (age > LIFE) continue;
      const side = i % 4, edge = -4.3 + ((i * 2.618) % 8.6);
      const x = side === 0 ? -5 : side === 1 ? 5 : edge;
      const z = side === 2 ? -5 : side === 3 ? 5 : edge;
      this.surface.sampleCached(4 + i % 3, x, z, this.sample, false);
      if (!this.sample.valid || this.sample.position.y < .45 || this.sample.normal.y > .86) continue;
      this.quaternion.copy(this.surface.root.quaternion);
      this.velocity.set(x * .05, .65, z * .05).applyQuaternion(this.quaternion);
      this.sample.position.applyQuaternion(this.quaternion);
      this.sample.position.y += this.surface.root.position.y - 4.9 * age * age;
      this.sample.position.addScaledVector(this.velocity, age).toArray(this.positions, i * 3);
      this.fades[i] = Math.sin(Math.PI * age / LIFE) * 0.8;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aFade.needsUpdate = true;
  }
}

const BURST_CAPACITY = 768;
export class SplashBursts {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private origins = new Float32Array(BURST_CAPACITY * 3);
  private velocities = new Float32Array(BURST_CAPACITY * 3);
  private births = new Float32Array(BURST_CAPACITY).fill(-10000);
  private lifetimes = new Float32Array(BURST_CAPACITY);
  private seeds = new Float32Array(BURST_CAPACITY);
  private cursor = 0;
  private seed = 51331;
  private activeUntil = -Infinity;
  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.origins, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aVelocity', new BufferAttribute(this.velocities, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aBirth', new BufferAttribute(this.births, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aLife', new BufferAttribute(this.lifetimes, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aSeed', new BufferAttribute(this.seeds, 1).setUsage(DynamicDrawUsage));
    const material = new ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { uClock: { value: 0 }, uPixelRatio: { value: 1 }, uColor: { value: new Vector3(.50, .85, 1.05) } },
      vertexShader: /* glsl */`
        attribute vec3 aVelocity; attribute float aBirth, aLife, aSeed;
        uniform float uClock, uPixelRatio; varying float vFade;
        void main() {
          float age = uClock - aBirth;
          if (age < 0.0 || age >= aLife) { vFade = 0.0; gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec3 p = position + aVelocity * age; p.y -= 4.9 * age * age;
          vec4 view = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * view;
          gl_PointSize = uPixelRatio * (1.5 + 2.0 * aSeed) * clamp(18.0 / -view.z, 0.6, 1.6);
          vFade = smoothstep(0.0, 0.04, age) * (1.0 - smoothstep(0.65, 1.0, age / aLife));
        }`,
      fragmentShader: /* glsl */`
        precision highp float; uniform vec3 uColor; varying float vFade;
        void main() {
          float radius = length(gl_PointCoord - 0.5);
          if (radius > 0.5 || vFade < 0.01) discard;
          gl_FragColor = vec4(uColor * (1.2 - radius * 0.6), vFade * (1.0 - smoothstep(0.2, 0.5, radius)));
        }`,
    });
    this.points = new Points(geometry, material); this.points.name = 'Transient GPU splash droplets';
    this.points.frustumCulled = false; this.points.visible = false;
  }
  private random(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  emit(origin: Vector3, normal: Vector3, count: number, speed: number, wall: number): void {
    for (let particle = 0; particle < count; particle++) {
      const index = this.cursor++ % BURST_CAPACITY, offset = index * 3, angle = this.random() * Math.PI * 2;
      const spread = (.45 + this.random() * .8) * (.65 + Math.min(speed, 9) * .10), lift = .75 + this.random() * .8 + Math.min(speed, 9) * .17;
      this.origins[offset] = origin.x + normal.x * .02; this.origins[offset + 1] = origin.y + .025; this.origins[offset + 2] = origin.z + normal.z * .02;
      this.velocities[offset] = Math.cos(angle) * spread + normal.x * lift * .35;
      this.velocities[offset + 1] = Math.max(.6, normal.y * lift);
      this.velocities[offset + 2] = Math.sin(angle) * spread + normal.z * lift * .35;
      this.births[index] = wall; this.lifetimes[index] = 2 * this.velocities[offset + 1] / 9.8; this.seeds[index] = this.random();
      this.activeUntil = Math.max(this.activeUntil, wall + this.lifetimes[index]);
    }
    // Buffers change only on emission; trajectories and landing fades run on GPU.
    for (const name in this.points.geometry.attributes) this.points.geometry.attributes[name].needsUpdate = true;
    this.points.visible = true;
  }
  update(wall: number, pixelRatio: number): void {
    this.points.material.uniforms.uClock.value = wall; this.points.material.uniforms.uPixelRatio.value = pixelRatio;
    this.points.visible = wall < this.activeUntil;
  }
  countAt(wall: number): number {
    let count = 0; for (let i = 0; i < BURST_CAPACITY; i++) if (wall >= this.births[i] && wall - this.births[i] < this.lifetimes[i]) count++;
    return count;
  }
  reset(): void { this.activeUntil = -Infinity; this.births.fill(-10000); this.points.geometry.attributes.aBirth.needsUpdate = true; this.points.visible = false; }
}
