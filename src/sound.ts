export class OceanSound {
  context: AudioContext | undefined;
  enabled = false;
  private surfGain: GainNode | undefined;
  private master: GainNode | undefined;
  private filter: BiquadFilterNode | undefined;
  private noise: AudioBuffer | undefined;
  private switchId = 0;
  async toggle(): Promise<boolean> {
    const id = ++this.switchId;
    if (!this.context) {
      this.context = new AudioContext();
      const sampleRate = this.context.sampleRate, length = sampleRate * 3;
      this.noise = this.context.createBuffer(1, length, sampleRate);
      const data = this.noise.getChannelData(0); let brown = 0, seed = 94117;
      for (let i = 0; i < length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        brown = (brown + ((seed / 4294967296) * 2 - 1) * .025) / 1.025; data[i] = brown * 4;
      }
      // Seamless noise-buffer loop; no audible click at the 3-second boundary.
      for (let i = 0; i < 512; i++) { const blend = i / 511; data[length - 512 + i] = data[length - 512 + i] * (1 - blend) + data[i] * blend; }
      const source = this.context.createBufferSource(); source.buffer = this.noise; source.loop = true;
      this.filter = this.context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 320;
      this.surfGain = this.context.createGain(); this.surfGain.gain.value = 0;
      this.master = this.context.createGain(); this.master.gain.value = 0; this.master.connect(this.context.destination);
      source.connect(this.filter).connect(this.surfGain).connect(this.master); source.start();
    }
    this.enabled = !this.enabled;
    if (this.enabled) { await this.context.resume(); this.master!.gain.setTargetAtTime(1, this.context.currentTime, .025); }
    else {
      this.surfGain!.gain.setTargetAtTime(0, this.context.currentTime, .045);
      this.master!.gain.setTargetAtTime(0, this.context.currentTime, .015);
      setTimeout(() => { if (id === this.switchId && !this.enabled) void this.context?.suspend(); }, 250);
    }
    return this.enabled;
  }
  update(phase: number, storm: number): void {
    if (!this.enabled || !this.context || !this.filter || !this.surfGain) return;
    const envelope = .5 + .5 * Math.sin(phase * 2 + .7);
    this.filter.frequency.setTargetAtTime(180 + storm * (220 + envelope * 360), this.context.currentTime, .12);
    this.surfGain.gain.setTargetAtTime(.018 * storm * (.55 + .45 * envelope), this.context.currentTime, .12);
  }
  splash(speed: number): void {
    if (!this.enabled || !this.context || !this.noise) return;
    const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
    source.buffer = this.noise; filter.type = 'bandpass'; filter.frequency.value = 550 + Math.min(speed, 9) * 110; filter.Q.value = .5;
    const t = this.context.currentTime, strength = Math.min(.12, .025 + speed * .009);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(strength, t + .015); gain.gain.exponentialRampToValueAtTime(.0001, t + .48);
    source.connect(filter).connect(gain).connect(this.master!); source.start(t, .4, .5);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  get gain(): number { return this.enabled ? this.surfGain?.gain.value ?? 0 : 0; }
}
