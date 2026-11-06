import { WebGLRenderTarget } from 'three';
import type { WebGLRenderer } from 'three';
import type { PostPipeline } from './post';
import { CONFIG } from './waves';

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export class PreviewCapture {
  recording = false;
  snapshotBusy = false;
  started = 0;
  duration = 0;
  speed = 1;
  private recorder: MediaRecorder | undefined;
  constructor(private renderer: WebGLRenderer, private post: PostPipeline, private beginRecording: () => Promise<() => Promise<void>>,
    private getSpeed: () => number, private notify: (message: string) => void) {}
  get progress(): number { return this.recording && Number.isFinite(this.started) ? Math.min(1, Math.max(0, (performance.now() - this.started) / this.duration)) : 0; }
  async snapshot(): Promise<void> {
    if (this.snapshotBusy || this.recording) return;
    this.snapshotBusy = true;
    try {
      const canvas = this.renderer.domElement, width = canvas.width, height = canvas.height;
      const target = new WebGLRenderTarget(width * 2, height * 2), previous = this.renderer.getRenderTarget();
      const pixels = new Uint8Array(width * height * 16);
      try {
        this.post.resize(width * 2, height * 2); this.post.render(target);
        this.renderer.readRenderTargetPixels(target, 0, 0, width * 2, height * 2, pixels);
      } finally { this.renderer.setRenderTarget(previous); target.dispose(); this.post.resize(width, height); }
      const png = document.createElement('canvas'); png.width = width * 2; png.height = height * 2;
      const context = png.getContext('2d')!;
      const image = context.createImageData(png.width, png.height), stride = png.width * 4;
      for (let y = 0; y < png.height; y++) image.data.set(pixels.subarray((png.height - y - 1) * stride, (png.height - y) * stride), y * stride);
      context.putImageData(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => png.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'));
      download(blob, 'floating-ocean.png'); this.notify('A little sea, saved.');
    } finally { this.snapshotBusy = false; }
  }
  async record(): Promise<void> {
    if (this.recording || this.snapshotBusy) return;
    if (typeof MediaRecorder === 'undefined') throw new Error('Loop recording needs a browser with MediaRecorder support.');
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This browser cannot record WebM. Try Chromium.');
    const stream = this.renderer.domElement.captureStream(60); let restore: (() => Promise<void>) | undefined;
    const monitor = document.createElement('video'); monitor.muted = true; monitor.playsInline = true; monitor.srcObject = stream;
    const chunks: Blob[] = []; let timeout = 0;
    this.started = Infinity; this.recording = true;
    try {
      restore = await this.beginRecording();
      // Wait for a real captured frame before recording. MediaRecorder's onstart
      // can arrive seconds after timestamp zero; it is not a clock origin.
      await monitor.play();
      this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
      const finished = new Promise<Blob>((resolve, reject) => {
        this.recorder!.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
        this.recorder!.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        this.recorder!.onerror = () => reject(new Error('The browser could not finish this recording.'));
      });
      this.speed = this.getSpeed(); this.duration = CONFIG.period / this.speed * 1000;
      this.started = performance.now(); this.recorder.start();
      (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack).requestFrame?.();
      timeout = window.setTimeout(() => { if (this.recorder?.state === 'recording') this.recorder.stop(); }, this.duration);
      const blob = await finished;
      if (!blob.size) throw new Error('The browser returned an empty recording.');
      download(blob, 'floating-ocean-loop.webm'); this.notify('One loop, to keep.');
    } finally {
      window.clearTimeout(timeout); monitor.pause(); monitor.srcObject = null;
      if (this.recorder?.state === 'recording') this.recorder.stop();
      stream.getTracks().forEach(track => track.stop()); this.recorder = undefined; this.recording = false; await restore?.();
    }
  }
}
