import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const out = 'output/playwright/water-lab'; await mkdir(out, { recursive: true });
const queue = () => execFileSync('cmd.exe', ['/d', '/s', '/c', 'agent-tools status'], { encoding: 'utf8' });
const requested = process.argv[2], report = { variants: {}, errors: [] };
for (const id of requested ? [requested] : ['F', 'P', 'S']) {
  const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }); page.on('pageerror', error => report.errors.push(String(error)));
  try {
    await page.goto(`http://localhost:4103/lab.html?variant=${id}`, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__lab?.ready, { timeout: 240000, polling: 250 });
    if (!await page.evaluate(id => !!window.__lab.variants[id], id)) { report.variants[id] = { unavailable: await page.evaluate(id => window.__lab.failures[id], id) }; continue; }
    const preset = JSON.parse(await readFile(`${out}/best-${id}.json`, 'utf8')).variants[id];
    await page.evaluate(async ({ id, preset }) => { await window.__lab.setPreset(id, preset); window.__lab.focus(id); window.__lab.play(); }, { id, preset }); await page.bringToFront(); await page.waitForTimeout(2500);
    const before = queue(); const measured = await page.evaluate(id => new Promise(resolve => {
      const v = window.__lab.variants[id], begin = performance.now(), frames = v.frames;
      const tick = now => { if (now - begin < 12000) requestAnimationFrame(tick); else resolve({ frames: v.frames - frames, elapsedMs: now - begin, fps: (v.frames - frames) * 1000 / (now - begin), width: v.canvas.width, height: v.canvas.height }); }; requestAnimationFrame(tick);
    }), id); const after = queue();
    const evidence = await page.evaluate(id => window.__lab.variants[id].evidence(), id); const intervals = evidence.frameIntervals.slice(-Math.min(measured.frames - 1, evidence.frameIntervals.length)).sort((a, b) => a - b);
    const valid = [before, after].every(text => text.split(/\r?\n/).filter(line => line.startsWith('job "')).length === 1) && measured.width === 1920 && measured.height === 1080 && !/swiftshader|llvmpipe|software|basic render/i.test(evidence.renderer);
    report.variants[id] = { ...measured, p95Ms: intervals[Math.floor(intervals.length * .95)], renderer: evidence.renderer, queueIdle: valid, valid, queueBefore: before, queueAfter: after, evidence };
    await page.screenshot({ path: `${out}/performance-${id}.png` });
  } catch (error) { report.variants[id] = { failure: String(error) }; } finally { await browser.close(); }
}
await writeFile(`${out}/performance${requested ? `-${requested}` : ''}.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ errors: report.errors, variants: Object.fromEntries(Object.entries(report.variants).map(([id, data]) => [id, { fps: data.fps, p95Ms: data.p95Ms, valid: data.valid, unavailable: data.unavailable, failure: data.failure, renderer: data.renderer }])) }, null, 2));
