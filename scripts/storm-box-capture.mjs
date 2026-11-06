import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2), value = (key, fallback) => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = value('url', 'http://localhost:4100'), stage = value('stage', 'A'), out = path.resolve(`output/playwright/storm-box/${stage}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [], result = { url: base, stage, errors, frames: [] };
page.on('pageerror', e => errors.push(e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const bytes = data => Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
try {
  await page.goto(`${base}/lab.html?variant=F&freeze=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__lab?.ready, { timeout: 240000, polling: 200 });
  if (!await page.evaluate(() => window.__lab.variants.F?.ready)) throw new Error(JSON.stringify(await page.evaluate(() => window.__lab.failures)));
  if (args.includes('--storm')) await page.evaluate(async () => { const m = await import('/src/water/spectrum.ts'); await window.__lab.setPreset('F', m.STORM_BOX); });
  for (const frame of [0, 20, 40, 60, 80, 100, 120]) {
    const item = await page.evaluate(async frame => { const f = window.__lab.variants.F; await window.__lab.setTime(frame * .03); return { image: await f.capture(), evidence: await f.evidence() }; }, frame);
    const filename = `F-${String(frame).padStart(3, '0')}.png`;
    await writeFile(path.join(out, filename), bytes(item.image));
    result.frames.push({ frame, filename, evidence: item.evidence });
  }
  // The same headed page plays the original 121-frame reference in real time.
  await page.evaluate(() => { window.__lab.focus('reference'); window.__lab.playing = true; });
  await page.waitForTimeout(4000);
  await page.evaluate(() => { window.__lab.pause(); window.__lab.focus('F'); });
  if (args.includes('--motion')) {
    await page.evaluate(async () => { await window.__lab.setTime(0); window.__lab.playing = false; });
    await mkdir(path.join(out, 'motion'), { recursive: true });
    for (let frame = 0; frame < 243; frame++) {
      const image = await page.evaluate(async frame => { const f = window.__lab.variants.F; if (frame) f.frame(frame * .03, .03); await f.ocean.readSample(frame * .03, true); f.frame(frame * .03, 0); return f.capture('image/jpeg'); }, frame);
      await writeFile(path.join(out, 'motion', `${String(frame).padStart(3, '0')}.jpg`), bytes(image));
    }
  }
  result.preset = await page.evaluate(() => window.__lab.preset());
  if (errors.length) throw new Error(errors.join('\n'));
} catch (e) { result.failure = String(e); process.exitCode = 1; await page.screenshot({ path: path.join(out, 'failure.png') }); }
finally { await writeFile(path.join(out, 'capture.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ stage, out, frames: result.frames.length, failure: result.failure, errors }, null, 2)); await browser.close(); }
