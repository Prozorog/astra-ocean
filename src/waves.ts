import { LOOP, wrapTime } from './water/time';
import { TURBULENT_BOX } from './water/spectrum';

export const TAU = Math.PI * 2;
// UI/interaction contracts only. The surface lives exclusively in water/ocean.
export const CONFIG = { period: LOOP, altitude: 4, cameraFov: 30, ripple: { count: 6, lifetime: 3 } } as const;
export const settings = { storm: 1, chop: TURBULENT_BOX.chop, ripples: 1, tumble: 1, timeScale: 1, ballGlow: 1, grain: .045,
  shadow: .32, loop: true, droplets: false, post: true, debug: 'Beauty' };
export function loopTime(time: number): number { return wrapTime(time); }
export function phaseAt(time: number): number { return wrapTime(time) * TAU / LOOP; }
