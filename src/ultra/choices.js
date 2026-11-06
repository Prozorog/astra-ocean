import { CHUNK_DEFAULTS, roundOneVariants } from './settings.js';

export const LOOK_STORAGE_KEY = 'floating-ocean.look-assignments.v1';
export const DEFAULT_CHOICES = Object.freeze({ version: 1, main: 5, storm: 3 });
export const LOOK_TILES = roundOneVariants();
const valid = value => Number.isInteger(value) && value >= 1 && value <= 9;
export function readLookChoices() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOOK_STORAGE_KEY) ?? 'null');
    if (saved?.version === 1 && valid(saved.main) && valid(saved.storm)) return { version: 1, main: saved.main, storm: saved.storm };
  } catch { /* Storage denied or malformed: the accepted defaults apply. */ }
  return { ...DEFAULT_CHOICES };
}
export function saveLookChoices(choice) {
  if (!valid(choice.main) || !valid(choice.storm)) return false;
  try { localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify({ version: 1, main: choice.main, storm: choice.storm })); return true; }
  catch { return false; }
}
export function lookForTile(number) {
  const tile = LOOK_TILES.find(tile => tile.number === number) ?? LOOK_TILES[4];
  return { ...CHUNK_DEFAULTS, peakWaves: tile.peakWaves, heightGain: tile.heightGain };
}
