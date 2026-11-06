export const PERIOD = 3.63;
export const FRAME_COUNT = 121;
export function wrap(time) { const t = ((time % PERIOD) + PERIOD) % PERIOD; return t < 1e-9 || PERIOD - t < 1e-9 ? 0 : t; }
export const CHUNK_DEFAULTS = {
  sheetSize: 80, peakWaves: 2, heightGain: 1, alignment: .25,
  tau: 1.15, choppiness: 1, opposingDamping: .5, seed: 1337,
  foamBias: .05, foamScale: 1.3, foamRecovery: .7, billow: 1, spray: .65,
  motionBlur: true, shutter: .5, depthOfField: true, aperture: .22,
  grain: true, grainStrength: .018,
  scatter: [.004, .018, .017], absorption: [.40, .12, .10],
  emberWaterGain: .18, glintStrength: .2, studioHighlightStrength: .45,
};
export function roundOneVariants(current = CHUNK_DEFAULTS) {
  return [1, 2, 3].flatMap((peakWaves, row) => [.72, 1, 1.35].map((heightGain, column) => ({
    number: row * 3 + column + 1, ...current, peakWaves, heightGain,
  })));
}
