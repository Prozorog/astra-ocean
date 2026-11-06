import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'output/playwright/water-lab'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [], messages = []; page.on('pageerror', e => errors.push(e.stack ?? String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') messages.push(m.text()); });
const report = { errors, messages };
try {
  await page.goto('http://localhost:4103/lab.html?freeze=1&t=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__lab?.ready === true, { timeout: 240000, polling: 250 });
  report.failures = await page.evaluate(() => window.__lab.failures);
  report.variants = {};
  for (const id of await page.evaluate(() => Object.keys(window.__lab.variants))) {
    try { report.variants[id] = await page.evaluate(id => window.__lab.variants[id].evidence(), id); }
    catch (error) {
      report.variants[id] = { failure: String(error) };
      if (id === 'P') report.pReadback = await page.evaluate(async () => {
        const p = window.__lab.variants.P, png = await p.mask();
        const raw = await p.renderer.readRenderTargetPixelsAsync(p.target, 2, 2, 1, 1);
        return { pngPrefix: png.slice(0, 90), pngLength: png.length, width: p.canvas.width, height: p.canvas.height, floorColor: p.floorColor.toArray(), rawHdr: Array.from(raw), rawType: raw.constructor.name };
      });
    }
  }
  await page.screenshot({ path: `${out}/probe-grid.png` });
  for (const id of Object.keys(report.variants)) { await page.evaluate(id => window.__lab.focus(id), id); await page.evaluate(t => window.__lab.setTime(t), 0); await page.screenshot({ path: `${out}/probe-${id}.png` }); }
} catch (error) { report.failure = String(error); report.body = await page.locator('body').innerText(); await page.screenshot({ path: `${out}/probe-failure.png` }); process.exitCode = 1; }
finally { await writeFile(`${out}/probe.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser.close(); }
