import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Step 1 evidence only: the upstream checkout and renderer stay unmodified.
const out = path.resolve('output/playwright/pass8-base');
await mkdir(out, { recursive: true });
const shots = [
  ['open-ocean', 'Open ocean'],
  ['breakers', 'Breakers'],
  ['flotsam', 'Flotsam'],
  ['golden-hour', 'Golden hour'],
  ['storm-close', 'Open ocean'],
];
const report = {
  stage: 'pass8-step1',
  upstream: 'https://github.com/Humpalumps/Ultra-Water',
  commit: '30ea65ecb0a66b137aa200d099965634bdd84d51',
  expected: shots.map(([id]) => ({ id, viewport: [1280, 720], seconds: 6 })),
  shots: [], errors: [], warnings: [],
};
const browser = await chromium.launch({ headless: false, args: [
  '--ignore-gpu-blocklist', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) report.errors.push(message.text());
});
page.on('response', response => {
  if (response.status() < 400) return;
  const message = `${response.status()} ${response.url()}`;
  if (new URL(response.url()).pathname === '/favicon.ico') report.warnings.push(message);
  else report.errors.push(message);
});

try {
  await page.goto('http://localhost:4100/?desktop', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.app?.ocean?.time > 0, null, { timeout: 180000 });
  await page.bringToFront();
  // Presentation overlays are hidden only in this capture browser.
  await page.addStyleTag({ content: '#perf,.lil-gui{display:none!important}' });
  report.initial = await page.evaluate(() => {
    const a = window.app, gl = a.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { ocean: { ...a.ocean.params }, quality: { ...a.quality },
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      webgl: gl.getParameter(gl.VERSION), views: Object.keys(a.views) };
  });
  for (const [id, preset] of shots) {
    await page.evaluate(({ id, preset }) => {
      const a = window.app;
      a.views[preset]();
      a.controls.update();
      if (id === 'storm-close') {
        a.ocean.params.windSpeed = 25;
        a.ocean.dirty = true;
        const direction = a.controls.target.clone().sub(a.camera.position);
        direction.y = 0; direction.normalize();
        const centre = a.camera.position.clone(); centre.y = 0;
        a.controls.target.copy(centre);
        a.camera.position.copy(centre).addScaledVector(direction, -50 * Math.cos(Math.PI / 6));
        a.camera.position.y = 25;
        a.controls.update();
      }
    }, { id, preset });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, `${id}.png`) });
    const recording = await page.evaluate(async () => {
      const a = window.app, canvas = a.renderer.domElement;
      const stream = canvas.captureStream(30);
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(MediaRecorder.isTypeSupported);
      if (!mimeType) throw new Error('Browser cannot record WebM');
      const chunks = [], recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10000000 });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve; recorder.onerror = event => reject(new Error(String(event.error)));
      });
      const started = performance.now(), startTime = a.ocean.time;
      recorder.start();
      // Record headroom for encoder startup; the media script trims to six seconds.
      await new Promise(resolve => setTimeout(resolve, 7000));
      recorder.stop(); await stopped;
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: mimeType });
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result);
        reader.onerror = reject; reader.readAsDataURL(blob);
      });
      return { data, mimeType, seconds: (performance.now() - started) / 1000,
        simulationStart: startTime, simulationEnd: a.ocean.time,
        viewport: [canvas.width, canvas.height], ocean: { ...a.ocean.params },
        camera: a.camera.position.toArray(), target: a.controls.target.toArray(), fov: a.camera.fov };
    });
    const { data, ...evidence } = recording;
    await writeFile(path.join(out, `${id}.source.webm`), Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
    report.shots.push({ id, preset, ...evidence, still: `${id}.png`, rawVideo: `${id}.source.webm`, preview: `${id}.webm` });
    await writeFile(path.join(out, 'capture.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Captured ${id}: ${evidence.viewport.join('x')}, ${evidence.seconds.toFixed(2)} s`);
  }
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  report.complete = true;
} catch (error) {
  report.failure = String(error); process.exitCode = 1;
  await page.screenshot({ path: path.join(out, 'capture-failure.png') }).catch(() => {});
} finally {
  await writeFile(path.join(out, 'capture.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  console.log(JSON.stringify({ complete: report.complete, shots: report.shots.length, errors: report.errors, failure: report.failure }));
}
