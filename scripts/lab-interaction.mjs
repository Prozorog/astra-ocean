import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'output/playwright/water-lab'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, acceptDownloads: true });
const report = { events: [], errors: [] }; page.on('pageerror', error => report.errors.push(String(error))); let started = 0;
async function tap(x, z) { const point = await page.evaluate(({ x, z }) => { const f = window.__lab.variants.F, p = f.view.root.position.clone().set(x, 0, z); f.view.root.localToWorld(p); p.project(f.view.camera); const r = f.canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }, { x, z }); await page.mouse.click(point.x, point.y); report.events.push({ event: 'tap', seconds: (performance.now() - started) / 1000, sheet: [x, z] }); }
try {
  await page.goto('http://localhost:4103/lab.html?variant=F', { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__lab?.ready, { timeout: 240000, polling: 250 });
  await page.evaluate(async () => { window.__lab.pause(); await window.__lab.setPreset('F', { wind: 10 }); window.__lab.focus('F'); await window.__lab.setTime(0); window.__lab.play(); }); await page.waitForTimeout(500);
  await page.evaluate(async () => { const canvas = window.__lab.variants.F.canvas, stream = canvas.captureStream(60), monitor = document.createElement('video'); monitor.muted = true; monitor.playsInline = true; monitor.srcObject = stream; await monitor.play();
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(type => MediaRecorder.isTypeSupported(type)); const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12000000 }), chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); }; recorder.onstop = () => { const blob = new Blob(chunks, { type: mimeType }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'F-interaction.webm'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); monitor.pause(); monitor.srcObject = null; stream.getTracks().forEach(track => track.stop()); };
    window.__labRecording = recorder; recorder.start(250);
  });
  started = performance.now(); await page.waitForTimeout(500); await tap(-2, 1); await page.waitForTimeout(700); await tap(2, 1.5); await page.waitForTimeout(800); await page.keyboard.press('b'); report.events.push({ event: '2m ball drop', seconds: (performance.now() - started) / 1000 });
  await page.waitForTimeout(1200); await tap(-1.8, 2.5); await page.waitForTimeout(1000); await page.keyboard.press('b'); report.events.push({ event: 'second 2m ball drop', seconds: (performance.now() - started) / 1000 }); await page.waitForTimeout(3400);
  const download = page.waitForEvent('download'); await page.evaluate(() => window.__labRecording.stop()); const file = await download; await file.saveAs(`${out}/F-interaction.webm`); report.wallSeconds = (performance.now() - started) / 1000;
  report.state = await page.evaluate(() => ({ impulses: window.__lab.variants.F.ocean.interaction.impulses, spherePushes: window.__lab.variants.F.ocean.interaction.spherePushes, steps: window.__lab.variants.F.ocean.interaction.steps, wind: window.__lab.variants.F.parameters.wind }));
  await page.screenshot({ path: `${out}/interaction-F.png` });
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally { await writeFile(`${out}/interaction.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser.close(); }
