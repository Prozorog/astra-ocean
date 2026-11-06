import type { WebGLRenderer } from 'three';
interface TimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
export interface GpuTimingReport {
  available: boolean;
  passes: Record<string, { meanMs: number; p95Ms: number; samples: number }>;
}
interface QuerySlot { name: string; query: WebGLQuery }
interface Samples { values: Float64Array; count: number; cursor: number }
export class GpuTimings {
  private gl: WebGL2RenderingContext;
  private extension: TimerExtension | null;
  private pending: QuerySlot[] = [];
  private free: QuerySlot[] = [];
  private active: QuerySlot | undefined;
  private samples = new Map<string, Samples>();
  private frame = 0;
  constructor(renderer: WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.extension = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
    if (this.extension) for (let i = 0; i < 32; i++) {
      const query = this.gl.createQuery();
      if (query) this.free.push({ name: '', query });
    }
  }
  begin(name: string): void {
    if (!this.extension || this.active || this.frame % 8 !== 0) return;
    const slot = this.free.pop(); if (!slot) return;
    slot.name = name; this.active = slot; this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, slot.query);
  }
  end(): void {
    if (!this.active || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT); this.pending.push(this.active); this.active = undefined;
  }
  poll(): void {
    this.frame++;
    if (!this.extension || this.frame % 4 !== 0 || this.pending.length === 0) return;
    const disjoint = this.gl.getParameter(this.extension.GPU_DISJOINT_EXT);
    for (let i = 0; i < this.pending.length;) {
      const entry = this.pending[i];
      if (!disjoint && !this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT_AVAILABLE)) { i++; continue; }
      if (!disjoint) {
        let sample = this.samples.get(entry.name);
        if (!sample) { sample = { values: new Float64Array(180), count: 0, cursor: 0 }; this.samples.set(entry.name, sample); }
        sample.values[sample.cursor] = this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT) / 1e6;
        sample.cursor = (sample.cursor + 1) % 180; sample.count = Math.min(180, sample.count + 1);
      }
      this.pending[i] = this.pending[this.pending.length - 1]; this.pending.pop(); this.free.push(entry);
    }
  }
  reset(): void { for (const sample of this.samples.values()) { sample.count = 0; sample.cursor = 0; } }
  result(): GpuTimingReport {
    const passes: GpuTimingReport['passes'] = {};
    for (const [name, sample] of this.samples) {
      if (sample.count === 0) continue;
      const sorted = Array.from(sample.values.subarray(0, sample.count)).sort((a, b) => a - b);
      passes[name] = { meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
        p95Ms: sorted[Math.floor(sorted.length * .95)], samples: sorted.length };
    }
    return { available: !!this.extension, passes };
  }
}
