import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const url = process.argv.find(value => /^http/.test(value)) ?? 'http://localhost:4103', out = path.resolve('output/playwright/preview');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: path.join(out, 'demo-raw'), size: { width: 1440, height: 900 } } });
const report = { events: [], errors: [] };
async function ready(page) { await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__ready, null, { timeout: 180000 }); }
async function waterPoint(page, x, z) {
  return page.evaluate(async ({ x, z }) => {
    const api = window.__ocean, sample = await api.surface.samplePoint(x, z);
    const p = sample.position.applyMatrix4(api.sheetRoot.matrixWorld).project(api.camera);
    return { x: (p.x + 1) * 720, y: (1 - p.y) * 450 };
  }, { x, z });
}
try {
  const page = await context.newPage(), video = page.video(), started = performance.now();
  page.on('pageerror', error => report.errors.push(error.stack || String(error))); page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  const event = label => report.events.push({ label, seconds: (performance.now() - started) / 1000 });
  await ready(page); report.load = await page.evaluate(() => window.__evidence().load); event('GPU FFT loader and arrival intro'); await page.waitForTimeout(1050);
  const ball = await page.evaluate(() => window.__evidence().ballScreen); await page.mouse.move(ball[0] * 1440, ball[1] * 900); await page.mouse.down();
  assert.equal(await page.evaluate(() => window.__ocean.effects.mode), 'held'); event('Grab ember'); await page.waitForTimeout(180);
  for (let i = 1; i <= 12; i++) { await page.mouse.move(ball[0] * 1440 + i * 7, ball[1] * 900 - i * 3.5); await page.waitForTimeout(18); }
  await page.waitForTimeout(70); await page.mouse.up(); event('Throw');
  await page.waitForFunction(() => { const state = window.__evidence().interaction; return state.lastImpactAt > state.releaseAt && state.droplets > 0; }, null, { timeout: 3000 });
  event('Impact, displaced water and droplets'); await page.waitForTimeout(120);
  for (const [x, z] of [[-2, 1.8], [1.6, 2.1], [-1.5, -.7]]) { const p = await waterPoint(page, x, z); await page.mouse.click(p.x, p.y); await page.waitForTimeout(160); }
  event('Three water taps'); await page.mouse.move(1070, 550);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); } await page.waitForTimeout(600); event('Calmer water');
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); } await page.waitForTimeout(650); event('Storm restored');
  for (const mood of ['Midnight', 'Mint', 'Sand', 'Coral']) {
    await page.mouse.move(720, 860); await page.getByRole('button', { name: `${mood} mood`, exact: true }).click(); await page.waitForTimeout(850); event(`${mood} mood`);
  }
  const remaining = 15000 - (performance.now() - started); if (remaining > 0) await page.waitForTimeout(remaining);
  report.wallSeconds = (performance.now() - started) / 1000; await page.close(); const raw = await video.path();
  const ffmpeg = execFileSync('python', ['-c', 'from imageio_ffmpeg import get_ffmpeg_exe; print(get_ffmpeg_exe())'], { encoding: 'utf8' }).trim(), destination = path.join(out, 'demo.mp4');
  const encoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '4', '-i', raw, '-t', '15', '-vf', 'fps=30', '-c:v', 'libx264', '-threads', '4', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-progress', 'pipe:1', destination], { encoding: 'utf8' });
  if (encoded.status) throw new Error(encoded.stderr);
  const durations = [...encoded.stdout.matchAll(/out_time_us=(\d+)/g)]; report.encodedSeconds = Number(durations.at(-1)?.[1] ?? 0) / 1e6;
  report.file = destination; report.size = { width: 1440, height: 900 }; await video.delete(); assert.equal(report.errors.length, 0);
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally { await context.close(); await browser.close(); await writeFile(path.join(out, 'demo.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
