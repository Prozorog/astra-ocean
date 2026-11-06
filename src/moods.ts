import { Color, Vector3 } from 'three';
import type { ShaderMaterial } from 'three';
import { updateAeratedMidColor } from './water/material';

export const MOOD_NAMES = ['Coral', 'Midnight', 'Mint', 'Sand'] as const;
export type MoodName = typeof MOOD_NAMES[number];
const CHANNELS = ['floor', 'vignette', 'environment', 'deep', 'scatter', 'moundShadow', 'moundTop', 'body', 'hot', 'rim', 'fringe', 'reflection'] as const;
type Channel = typeof CHANNELS[number];
type Palette = Record<Channel, Vector3> & { glow: number };

// Inverse of the chroma-preserving Neutral output. Below compression this also
// reverses its black offset, so all four floor tokens match screenshot RGB.
export function displayRadiance(hex: string): Vector3 {
  const color = new Color(hex), targetPeak = Math.min(.995, Math.max(color.r, color.g, color.b));
  const peak = targetPeak <= .76 ? targetPeak : .52 + .0576 / (1 - targetPeak), scale = targetPeak / peak;
  const minimum = Math.min(color.r, color.g, color.b) / scale;
  const offset = minimum < .04 ? Math.sqrt(minimum / 6.25) - minimum : .04;
  return new Vector3(color.r / scale + offset, color.g / scale + offset, color.b / scale + offset);
}
const coral: Palette = {
  floor: new Vector3(.6572, .2114, .1648), vignette: new Vector3(.74, .215, .162), environment: new Vector3(1, 1, 1),
  deep: new Vector3(.0385, .06, .0605), scatter: new Vector3(.032, .125, .119),
  moundShadow: displayRadiance('#355f69'), moundTop: displayRadiance('#a9c9d0'),
  body: displayRadiance('#ff9909'), hot: displayRadiance('#ffb347'), rim: displayRadiance('#e8501a'),
  fringe: displayRadiance('#ff6818'), reflection: new Vector3(18, 5.6, .55), glow: 1,
};
const midnight: Palette = {
  floor: displayRadiance('#1b2433'), vignette: displayRadiance('#121924'), environment: new Vector3(.16, .24, .48),
  deep: new Vector3(.022, .043, .074), scatter: new Vector3(.025, .10, .22),
  moundShadow: new Vector3(.05, .13, .23), moundTop: new Vector3(.20, .37, .58),
  body: displayRadiance('#ffe2a0'), hot: displayRadiance('#fff1ca'), rim: displayRadiance('#dfad53'),
  fringe: displayRadiance('#ffd27e'), reflection: displayRadiance('#ffe2a0').multiplyScalar(1.8), glow: .45,
};
const mint: Palette = {
  ...coral, floor: displayRadiance('#9fd3c1'), vignette: displayRadiance('#71a99c'),
  body: displayRadiance('#ff3d7f'), hot: displayRadiance('#ffb5d4'), rim: displayRadiance('#c41d62'),
  fringe: displayRadiance('#ff227a'), reflection: displayRadiance('#ff3d7f').multiplyScalar(1.8), glow: .7,
};
const sand: Palette = {
  ...coral, floor: displayRadiance('#e3c9a0'), vignette: displayRadiance('#b69d7c'), environment: new Vector3(.78, .94, 1.12),
  body: displayRadiance('#3d7bff'), hot: displayRadiance('#a4d6ff'), rim: displayRadiance('#244dcc'),
  fringe: displayRadiance('#2073ff'), reflection: displayRadiance('#3d7bff').multiplyScalar(2), glow: .8,
};
export const MOODS: Record<MoodName, Palette> = { Coral: coral, Midnight: midnight, Mint: mint, Sand: sand };

export class MoodController {
  name: MoodName = 'Coral';
  readonly current: Palette;
  private from: Palette;
  private started = -Infinity;
  transitioning = false;
  constructor(private water: ShaderMaterial[], private ball: ShaderMaterial, private floor: ShaderMaterial, private output: ShaderMaterial) {
    this.current = { ...coral }; this.from = { ...coral };
    for (const key of CHANNELS) { this.current[key] = coral[key].clone(); this.from[key] = coral[key].clone(); }
    this.apply();
  }
  set(name: MoodName, wall: number): void {
    if (name === this.name) return;
    for (const key of CHANNELS) this.from[key].copy(this.current[key]);
    this.from.glow = this.current.glow; this.name = name; this.started = wall; this.transitioning = true;
    document.documentElement.dataset.mood = name.toLowerCase();
  }
  update(wall: number): boolean {
    if (!this.transitioning) return false;
    const t = Math.min(1, (wall - this.started) / .8), smooth = t * t * (3 - 2 * t), target = MOODS[this.name];
    for (const key of CHANNELS) this.current[key].lerpVectors(this.from[key], target[key], smooth);
    this.current.glow = this.from.glow + (target.glow - this.from.glow) * smooth;
    this.apply(); this.transitioning = t < 1; return true;
  }
  private apply(): void {
    const p = this.current;
    this.floor.uniforms.uCoral.value.setRGB(p.floor.x, p.floor.y, p.floor.z);
    this.output.uniforms.uVignette.value.setRGB(p.vignette.x, p.vignette.y, p.vignette.z);
    for (const material of this.water) {
      material.uniforms.uDeep.value.copy(p.deep); material.uniforms.uScatter.value.copy(p.scatter);
      material.uniforms.uMoundShadow.value.copy(p.moundShadow); material.uniforms.uMoundTop.value.copy(p.moundTop);
      material.uniforms.uEnvironmentTint.value.copy(p.environment); material.uniforms.uReflectionRadiance.value.copy(p.reflection);
      updateAeratedMidColor(material);
    }
    this.ball.uniforms.uBody.value.copy(p.body); this.ball.uniforms.uHot.value.copy(p.hot); this.ball.uniforms.uRim.value.copy(p.rim); this.ball.uniforms.uFringe.value.copy(p.fringe);
  }
}
