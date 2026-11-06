// Horvath/gasgiant/Acerola spectrum convention; see THIRD_PARTY_NOTICES.md.
import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { LOOP } from './time';
export const G = 9.81, TAU = Math.PI * 2;
export const PHILLIPS_WIND_ANGLE = 5 * Math.PI / 12;
// Bounded resolved-detail shoulder; shared logarithmic limits with GPU evolution.
const MESO_BAND = [5, 9, 15, 24] as const;
export const MESO_LOG_BAND = MESO_BAND.map(Math.log);
export type PhysicalSettings = {
  model: 'jonswap' | 'phillips'; phillipsAmplitude: number;
  wind: number; fetch: number; gamma: number; swell: number; windSpread: number; sheetSizeMetres: number; cascadeLengths: number[];
  tau: number; heroHeight: number; mesoGain: number; peakOnly: boolean; chop: number; crestSharpening: number; seed: number; phaseOffset: number;
  Jthr: number; foamDecay: number; foamSlip: number; foamDiffusion: number; foamRelief: number; loop: boolean;
}
// Reproducible pre-Storm sea-state, not silently replaced by the artistic preset.
export const PHYSICAL_DEFAULTS: PhysicalSettings = { model: 'jonswap', phillipsAmplitude: .008, wind: 18, fetch: 30, gamma: 3.3, swell: .4, windSpread: 1, sheetSizeMetres: 160, cascadeLengths: [160, 37, 9], tau: 2.8, heroHeight: 2.5, mesoGain: 1, peakOnly: false, chop: 1, crestSharpening: 0, seed: 0x5eed0cea, phaseOffset: 0, Jthr: .35, foamDecay: 2.5, foamSlip: 0, foamDiffusion: 0, foamRelief: 0, loop: true };
const sheet = 1.8 * TAU * G / windSpectrum(18, 30).peak ** 2, L0 = 160;
export const STORM_BOX: PhysicalSettings = { ...PHYSICAL_DEFAULTS, swell: .75, windSpread: .95, sheetSizeMetres: sheet, cascadeLengths: [L0, 37 * L0 / 160, 9 * L0 / 160], tau: 3.04, heroHeight: 4.6, mesoGain: 1.5, peakOnly: true, chop: .81, crestSharpening: .34, seed: 20417044, Jthr: .55, foamDecay: .18, foamSlip: 1.1, foamDiffusion: .16, foamRelief: 2.8, phaseOffset: .3 };
export const TURBULENT_BOX: PhysicalSettings = { ...STORM_BOX, model: 'phillips', wind: 55, cascadeLengths: [sheet * 1.2, sheet * .28, sheet * .07], phillipsAmplitude: .0138, heroHeight: 1, mesoGain: 1, peakOnly: false, crestSharpening: 0, chop: .95, seed: 20839002, phaseOffset: 3, Jthr: .5, foamDecay: .14, foamSlip: 4.5 };
/** The fundamental C0 wave completes exactly two display cycles. */
export function spectrumClock(p: PhysicalSettings): number {
  return p.model === 'phillips' ? 2 * TAU / (LOOP * Math.sqrt(G * TAU / p.cascadeLengths[0])) : p.tau;
}
export const SEA_STATES = { Calm: 10, Rough: 15, Storm: 18, Gale: 24 } as const;
export interface Band { name: string; L: number; N: number; low: number; high: number; minWavelength: number; maxWavelength: number }
export interface SpectrumSeed { texture: DataTexture; coefficients: Float32Array; band: Band; variance: number; heroVariance: number; swellVariance: number; dominantWavelength: number; dominantCycles: number }
export function bands(lengths: readonly number[]): Band[] {
  const sizes = [256, 128, 64];
  return lengths.map((L, i) => ({ name: `C${i}`, L, N: sizes[i], low: i ? TAU / (6 * lengths[i - 1] / sizes[i - 1]) : TAU / L,
    high: TAU / (6 * L / sizes[i]), minWavelength: 6 * L / sizes[i], maxWavelength: i ? 6 * lengths[i - 1] / sizes[i - 1] : L }));
}
export function windSpectrum(wind: number, fetchKm: number): { alpha: number; peak: number } {
  const fetch = fetchKm * 1000;
  return { alpha: .076 * Math.pow(G * fetch / (wind * wind), -.22), peak: 22 * Math.pow(wind * fetch / (G * G), -.33) };
}
function jonswap(omega: number, alpha: number, peak: number, gamma: number): number {
  const sigma = omega <= peak ? .07 : .09;
  const enhancement = Math.exp(-.5 * ((omega - peak) / (sigma * peak)) ** 2);
  return alpha * G * G * Math.pow(omega, -5) * Math.exp(-1.25 * (peak / omega) ** 4) * Math.pow(gamma, enhancement);
}
// Normalized Donelan-Banner (1985), beta parameterization used in gasgiant.
// Width is explicit angular art direction; the discrete energy is not renormalized.
function spreading(theta: number, ratio: number, width = 1): number {
  const beta = (ratio < .95 ? 2.61 * ratio ** 1.3 : ratio < 1.6 ? 2.28 * ratio ** -1.3 : 10 ** (-.4 + .8393 * Math.exp(-.567 * Math.log(ratio * ratio)))) / width;
  const angle = Math.atan2(Math.sin(theta), Math.cos(theta));
  return beta / (2 * Math.tanh(beta * Math.PI)) / Math.cosh(beta * angle) ** 2;
}
function random(seed: number): () => number {
  let state = seed | 0;
  return () => { state = (state + 0x6d2b79f5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function spectralGain(k: number, peakK: number, p: PhysicalSettings): number {
  if (k === 0) return 0;
  if (p.model === 'phillips') return 1;
  if (!p.peakOnly && p.mesoGain === 1) return p.heroHeight;
  const logK = Math.log(k / peakK), t = Math.max(0, Math.min(1, (logK - Math.log(2)) / Math.log(4)));
  let gain = p.peakOnly ? 1 + (p.heroHeight - 1) * (1 - t * t * (3 - 2 * t)) : p.heroHeight;
  if (p.mesoGain > 1) {
    const a = Math.max(0, Math.min(1, (logK - MESO_LOG_BAND[0]) / (MESO_LOG_BAND[1] - MESO_LOG_BAND[0])));
    const b = Math.max(0, Math.min(1, (logK - MESO_LOG_BAND[2]) / (MESO_LOG_BAND[3] - MESO_LOG_BAND[2])));
    gain *= 1 + (p.mesoGain - 1) * a * a * (3 - 2 * a) * (1 - b * b * (3 - 2 * b));
  }
  return gain;
}
export function makeSpectrum(band: Band, p: PhysicalSettings, seed: number): SpectrumSeed {
  const { N, L, low, high } = band, dk = TAU / L, data = new Float32Array(N * N * 4), raw = new Float32Array(N * N * 2);
  const crossing = p.model === 'jonswap';
  const localShortWaves = crossing && band.name === 'C2';
  const wind = windSpectrum(p.wind, p.fetch), swell = crossing ? windSpectrum(p.wind * .955, p.fetch * .9) : windSpectrum(14, 380), peakK = wind.peak ** 2 / G;
  const primaryWeight = crossing ? 1 / (1 + p.swell) : 1 - p.swell;
  const swellWeight = crossing ? p.swell / (1 + p.swell) : p.swell;
  const swellScale = swellWeight * (wind.alpha / swell.alpha) * (swell.peak / wind.peak) ** 4;
  const crossDegrees = 70;
  const rand = random(seed), windAngle = p.model === 'phillips' ? PHILLIPS_WIND_ANGLE : Math.PI / 4, swellAngle = windAngle + crossDegrees * Math.PI / 180;
  const swellSpread = crossing ? p.windSpread : 1;
  let variance = 0, heroVariance = 0, swellVariance = 0, maxEnergy = 0, dominantWavelength = 0, dominantCycles = 0;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const index = z * N + x, kx = (x - N / 2) * dk, kz = (z - N / 2) * dk, k = Math.hypot(kx, kz);
    // Consume every Gaussian before masking, preserving the deterministic lattice.
    const radius = Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))), angle = TAU * rand();
    if (k < low || k >= high || k === 0) continue;
    const omega = Math.sqrt(G * k), direction = Math.atan2(kz, kx);
    const localDensity = p.model === 'phillips' ? 0 : (localShortWaves ? 1 : primaryWeight) * jonswap(omega, wind.alpha, wind.peak, p.gamma) * spreading(direction - windAngle, omega / wind.peak, p.windSpread * (localShortWaves ? .3 : 1));
    const swellDensity = p.model === 'phillips' || localShortWaves ? 0 : swellScale * jonswap(omega, swell.alpha, swell.peak, p.gamma) * spreading(direction - swellAngle, omega / swell.peak, swellSpread);
    const alongWind = Math.cos(direction - windAngle), Lw = p.wind * p.wind / G, cutoff = 6 * p.cascadeLengths[2] / 64;
    const phillips = p.phillipsAmplitude * Math.exp(-1 / (k * Lw) ** 2) / k ** 4 * alongWind ** 2 * Math.exp(-k * k * cutoff * cutoff) * (alongWind < 0 ? .4 : 1);
    const density = p.model === 'phillips' ? phillips : localDensity + swellDensity;
    // Unit-variance Gaussian re/im and Hermitian time pair give E|h|²=4*a².
    // One-sided PSD, unnormalised IFFT. No measured/target RMS renormalisation.
    const derivative = p.model === 'phillips' ? 1 : G / (2 * omega) / k, amplitude = .5 * Math.sqrt(density * derivative * dk * dk);
    raw[index * 2] = radius * Math.cos(angle) * amplitude; raw[index * 2 + 1] = radius * Math.sin(angle) * amplitude;
    const energy = 2 * radius * radius * amplitude * amplitude;
    variance += energy; heroVariance += energy * spectralGain(k, peakK, p) ** 2;
    swellVariance += p.model === 'phillips' ? 0 : energy * swellDensity / Math.max(density, 1e-30);
    if (energy > maxEnergy) { maxEnergy = energy; dominantWavelength = TAU / k; dominantCycles = Math.max(1, Math.round(omega * LOOP * spectrumClock(p) / TAU)); }
  }
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = (z * N + x) * 4, a = (z * N + x) * 2, b = (((N - z) % N) * N + (N - x) % N) * 2;
    data[i] = raw[a]; data[i + 1] = raw[a + 1]; data[i + 2] = raw[b]; data[i + 3] = -raw[b + 1];
  }
  const texture = new DataTexture(data, N, N, RGBAFormat, FloatType); texture.minFilter = texture.magFilter = NearestFilter; texture.needsUpdate = true;
  return { texture, coefficients: data, band, variance, heroVariance, swellVariance, dominantWavelength, dominantCycles };
}
export function physicalReport(p: PhysicalSettings, seeds: SpectrumSeed[]) {
  const { alpha, peak } = windSpectrum(p.wind, p.fetch), variance = seeds.reduce((sum, seed) => sum + seed.variance, 0);
  const heroVariance = seeds.reduce((sum, seed) => sum + seed.heroVariance, 0), swellVariance = seeds.reduce((sum, seed) => sum + seed.swellVariance, 0);
  const crossing = p.model === 'jonswap', second = windSpectrum(p.wind * .955, p.fetch * .9), crossDegrees = 70;
  return { model: p.model, phillips: p.model === 'phillips' ? { amplitude: p.phillipsAmplitude, windLength: p.wind * p.wind / G, cutoff: 6 * p.cascadeLengths[2] / 64, counterWindEnergy: .4, windDegrees: PHILLIPS_WIND_ANGLE * 180 / Math.PI, fundamentalCycles: 2, gainShelves: false } : null, gravity: G, units: 'metres', sheetSizeMetres: p.sheetSizeMetres, sceneUnitsPerMetre: 10 / p.sheetSizeMetres, alpha, peakOmega: peak, inputPeakWavelength: p.model === 'phillips' ? TAU * Math.SQRT2 * p.wind * p.wind / G : TAU * G / (peak * peak), unquantizedPhysicalPeakPeriod: TAU / peak,
    significantWaveHeight: 4 * Math.sqrt(variance), heroSignificantWaveHeight: 4 * Math.sqrt(heroVariance), gain: { mode: p.model === 'phillips' ? 'none: one Phillips A, no gain shelves or crest sharpening' : p.mesoGain > 1 ? 'resolved meso shoulder over carrier gain; no RMS normalization' : p.peakOnly ? 'log-k peak-only; tail gain 1 beyond 8kp' : 'baseline uniform', peak: p.model === 'phillips' ? 1 : p.heroHeight, meso: p.model === 'phillips' ? 1 : p.mesoGain, mesoRelativeWavenumbers: MESO_BAND, normalization: 'none' },
    HsMethod: '4 sqrt(2 sum |h0(k)|²), discrete seeded coefficients; before artistic gain; one-sided PSD, unnormalised IFFT',
    swell: { wind: crossing ? p.wind * .955 : 0, fetchKm: crossing ? p.fetch * .9 : 0, secondaryPeakWavelength: TAU * G / (second.peak * second.peak), secondaryToPrimaryEnergyRatio: crossing ? p.swell : 0, requestedEnergyFraction: crossing ? p.swell / (1 + p.swell) : 0, representedVariance: swellVariance, representedFraction: swellVariance / variance, relativeAngle: crossing ? crossDegrees : 0, truncation: 'JONSWAP crossing lobe only; Phillips has a single wind direction.' }, physicalLoop: LOOP * spectrumClock(p),
    bands: seeds.map(seed => ({ ...seed.band, rmsMetres: Math.sqrt(seed.variance), dominantDiscreteModeWavelength: seed.dominantWavelength, dominantModeCyclesPerDisplayLoop: seed.dominantCycles, dominantModeDisplayPeriod: p.loop ? LOOP / seed.dominantCycles : null })), shortestWaveDecision: 'Disjoint half-open bands; minimum six FFT texels per wavelength for each real cascade period.' };
}
