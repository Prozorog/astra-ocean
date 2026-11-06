import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const url = process.argv.find(value => /^http/.test(value)) ?? 'http://localhost:4103', out = path.resolve('output/playwright/preview');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }), page = await context.newPage();
const errors = [], report = { errors };
page.on('pageerror', error => errors.push(error.stack || String(error))); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const queue = () => execFileSync('cmd.exe', ['/d', '/s', '/c', 'agent-tools status'], { encoding: 'utf8', windowsHide: true });
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  report.load = { first: await page.evaluate(() => window.__evidence().load) };
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  report.load.reinitialized = await page.evaluate(() => window.__evidence().load); await page.bringToFront();
  await page.waitForTimeout(3300); await page.evaluate(() => { window.__ocean.effects.reset(); window.__ocean.setScale(1); });
  await page.locator('canvas').focus(); await page.keyboard.press('s'); await page.keyboard.press('d'); await page.waitForTimeout(700);
  const device = await page.evaluate(() => window.__evidence()); report.device = device.renderer;
  assert(!/swiftshader|llvmpipe|software|basic render/i.test(device.renderer), 'Hardware GPU required');
  assert.equal(await page.evaluate(() => document.querySelector('canvas').width), 1920); assert.equal(await page.evaluate(() => document.querySelector('canvas').height), 1080);
  report.queueBefore = queue();
  await page.evaluate(() => {
    const gl = window.__ocean.renderer.getContext(), names = ['texImage2D', 'texImage3D', 'texSubImage3D', 'generateMipmap'], originals = new Map();
    window.__perfUploads = Object.fromEntries(names.map(name => [name, 0]));
    for (const name of names) { originals.set(name, gl[name]); gl[name] = function (...args) { window.__perfUploads[name]++; return originals.get(name).apply(gl, args); }; }
    window.__restoreUploads = () => { for (const [name, original] of originals) gl[name] = original; };
    window.__ocean.timings.reset(); window.__perfStart = { time: performance.now(), frame: window.__ocean.renderedFrames };
  });
  // Keep the actual dock visible with real pointer movement, then exercise the
  // costly branches: held light, throw, GPU droplets, six pulses and slosh.
  const ball = await page.evaluate(() => window.__evidence().ballScreen);
  await page.mouse.move(ball[0] * 1920, ball[1] * 1080); await page.mouse.down(); await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.__ocean.effects.mode), 'held');
  for (let i = 1; i <= 10; i++) { await page.mouse.move(ball[0] * 1920 + 120 * i / 10, ball[1] * 1080 - 65 * i / 10); await page.waitForTimeout(18); }
  await page.mouse.up();
  await page.waitForFunction(() => window.__ocean.splashes.countAt(performance.now() / 1000) > 0, null, { timeout: 3000 });
  report.splash = await page.evaluate(() => window.__ocean.effects.inspect(performance.now() / 1000));
  for (let i = 0; i < 6; i++) {
    const target = await page.evaluate(async index => {
      const api = window.__ocean, sample = await api.surface.samplePoint(-2 + index * .2, 1.7);
      const p = sample.position.applyMatrix4(api.sheetRoot.matrixWorld).project(api.camera);
      return { x: (p.x + 1) * 960, y: (1 - p.y) * 540 };
    }, i);
    await page.mouse.click(target.x, target.y); await page.waitForTimeout(30);
  }
  for (let i = 0; i < 12; i++) { await page.mouse.move(220 + i * 110, 450 + Math.sin(i) * 100); await page.waitForTimeout(12); }
  report.peakInteraction = await page.evaluate(() => window.__ocean.effects.inspect(performance.now() / 1000));
  while (await page.evaluate(() => performance.now() - window.__perfStart.time < 12000)) {
    await page.mouse.move(960 + Math.sin(performance.now()) * 20, 1037); await page.waitForTimeout(220);
  }
  report.measurement = await page.evaluate(() => {
    const end = performance.now(), evidence = window.__evidence(), frames = window.__ocean.renderedFrames - window.__perfStart.frame;
    const intervals = evidence.frameTimes.slice(-frames), ordered = intervals.toSorted((a, b) => a - b), elapsed = end - window.__perfStart.time;
    window.__restoreUploads();
    return { width: 1920, height: 1080, dpr: evidence.dpr, renderScale: evidence.renderScale, frames, elapsedMs: elapsed, fps: frames * 1000 / elapsed,
      meanMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length, p95Ms: ordered[Math.floor(ordered.length * .95)], gpu: evidence.gpu,
      uploadsDuringPlay: window.__perfUploads, sound: window.__ocean.audio.context?.state, lipSpecks: window.__ocean.settings.droplets,
      dockVisible: !document.querySelector('.preview-dock').classList.contains('is-idle'), actualRenderedFrames: true };
  });
  report.queueAfter = queue();
  report.queueIdle = [report.queueBefore, report.queueAfter].every(value => value.split(/\r?\n/).filter(line => line.startsWith('job "')).length === 1);
  report.valid = report.queueIdle && errors.length === 0; report.targetMet = report.valid && report.measurement.fps >= 55 && report.measurement.p95Ms <= 22;
  await page.screenshot({ path: path.join(out, 'performance-1080p.png'), animations: 'disabled' });
} catch (error) { report.failure = String(error); report.valid = false; process.exitCode = 1; }
finally {
  await browser.close(); await writeFile(path.join(out, 'performance.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
