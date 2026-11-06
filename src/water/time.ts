export const LOOP = 3.63;
export const DISPLAY_SIZE = 10;
export const wrapTime = (time: number): number => ((time % LOOP) + LOOP) % LOOP;
