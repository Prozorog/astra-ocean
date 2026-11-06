import type { Euler } from 'three';
import { LOOP, wrapTime } from './time';
export const STORM_VIEW = { ballRadius: .575, immersion: .3, distance: 20.35, elevation: 38, targetHeight: 2.37, segments: 320, tumbleScale: 1.5 / 9 } as const;
export function stormTumble(time: number, out: Euler, amount = 1): Euler {
  const p = wrapTime(time) / LOOP * Math.PI * 2, d = Math.PI / 180 * amount;
  const tilt = 9 * STORM_VIEW.tumbleScale * d;
  return out.set(tilt * Math.sin(p + .35), 15 * d * Math.sin(p), tilt * Math.sin(p + 1.8), 'XYZ');
}
