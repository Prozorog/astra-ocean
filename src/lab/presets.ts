import type { LabSettings, VariantId } from './contracts';
export interface LabPreset { version: 1; variants: Partial<Record<VariantId, LabSettings>> }
const LIMITS: Record<VariantId, Record<string, readonly [number, number]>> = {
  F: { phillipsAmplitude: [.0001, .2], wind: [6, 100], fetch: [5, 200], gamma: [1, 7], swell: [0, 1], windSpread: [.5, 2.5], sheetSizeMetres: [40, 300], tau: [1, 5], heroHeight: [1, 8], mesoGain: [1, 5], chop: [0, 1.8], crestSharpening: [0, 1], seed: [0, 4294967295], phaseOffset: [0, 3.63], Jthr: [-.4, .8], foamDecay: [.08, 5], foamSlip: [0, 5], foamDiffusion: [0, .5], foamRelief: [0, 3.1] },
  P: { wind: [6, 25], chop: [0, 3], foam: [.05, .8], foamDecay: [.5, 6] },
  S: { height: [.15, 2], choppy: [1, 7], frequency: [.8, 2.1], speed: [1, 4] },
};
export function parseLabPreset(input: unknown): LabPreset {
  if (!input || typeof input !== 'object' || !('version' in input) || input.version !== 1 || !('variants' in input)) throw new TypeError('Expected a Water Lab version-1 preset');
  const raw = input.variants;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Preset variants must be an object');
  const result: LabPreset = { version: 1, variants: {} };
  for (const [name, payload] of Object.entries(raw)) {
    if (name !== 'F' && name !== 'P' && name !== 'S') throw new TypeError(`Unknown variant ${name}`);
    const fields: unknown = payload;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new TypeError(`${name} parameters must be an object`);
    const settings: LabSettings = {};
    for (const [key, value] of Object.entries(fields)) {
      if (name === 'F' && key === 'model') { if (value !== 'phillips' && value !== 'jonswap') throw new TypeError('F.model must be phillips or jonswap'); settings[key] = value; continue; }
      if (name === 'F' && (key === 'loop' || key === 'peakOnly')) { if (typeof value !== 'boolean') throw new TypeError(`F.${key} must be boolean`); settings[key] = value; continue; }
      if (name === 'F' && key === 'cascadeLengths') {
        if (!Array.isArray(value) || value.length !== 3 || !value.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 2 && v <= 375) || value[1] >= value[0] / 2 || value[2] >= value[1] / 2) throw new TypeError('F.cascadeLengths need three positive metre periods with L1 < L0/2 and L2 < L1/2 for nonempty disjoint bands');
        settings[key] = [...value]; continue;
      }
      const range = LIMITS[name][key];
      if (!range || typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]) throw new TypeError(`Invalid ${name}.${key}`);
      if (name === 'S' && key === 'speed' && !Number.isInteger(value)) throw new TypeError('S.speed must be integer cycles per loop');
      if (name === 'F' && key === 'seed' && !Number.isInteger(value)) throw new TypeError('F.seed must be an integer');
      settings[key] = value;
    }
    result.variants[name] = settings;
  }
  return result;
}
