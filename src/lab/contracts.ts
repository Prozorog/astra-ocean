import type GUI from 'lil-gui';

export type VariantId = 'F' | 'P' | 'S';
export interface LabSettings { [name: string]: number | boolean | string | number[] }
export interface LabEvidence {
  id: VariantId; backend: string; parameters: LabSettings; ballScreen: [number, number]; ballRadiusPixels: number;
  ballWorld: number[]; reliefPercent: number; foamCoverage: number; spectrum?: unknown;
  buoyancy?: unknown; fft?: unknown; renderer: string; frames: number; frameIntervals: number[];
}
export interface LabVariant {
  readonly id: VariantId;
  readonly canvas: HTMLCanvasElement;
  readonly parameters: LabSettings;
  readonly backend: string;
  readonly ready: boolean;
  readonly frames: number;
  initialize(progress: (fraction: number, stage: string) => void): Promise<void>;
  seek(time: number): Promise<void>;
  frame(time: number, dt: number): void;
  resize(width: number, height: number): void;
  controls(gui: GUI, changed: () => void): void;
  apply(parameters: LabSettings): Promise<void>;
  evidence(): Promise<LabEvidence>;
  mask(): Promise<string>;
  capture?(type?: string): Promise<string>;
  tap?(clientX: number, clientY: number): void;
  dropBall?(): void;
  dispose(): void;
}
export interface LabApi {
  ready: boolean;
  time: number;
  playing: boolean;
  speed: number;
  variants: Partial<Record<VariantId, LabVariant>>;
  failures: Partial<Record<VariantId, string>>;
  setTime(time: number): Promise<void>;
  play(): void;
  pause(): void;
  focus(id: VariantId | null): void;
  setPreset(id: VariantId, values: LabSettings): Promise<void>;
  preset(): { version: 1; variants: Partial<Record<VariantId, LabSettings>> };
}
