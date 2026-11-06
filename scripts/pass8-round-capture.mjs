import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { roundOneVariants } from '../src/ultra/settings.js';
const out = path.resolve('output/playwright/pass8-round1-reflections'); await mkdir(out, { recursive: true });
const report = { round: 1, seed: 1337, frameSeconds: .03, expectedFrames: 121, seconds: 3.63, size: [640, 360], variants: [], errors: [] };
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
page.on('pageerror', e => report.errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
try {
  await page.goto('http://localhost:4103/?renderer=ultra&freeze=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chunk?.ready, null, { timeout: 180000 });
  for (const variant of roundOneVariants()) {
    const tile = path.join(out, `tile-${variant.number}`), frames = path.join(tile, 'frames'); await mkdir(frames, { recursive: true });
    await page.evaluate(async settings => { await window.__chunk.apply(settings); window.__chunk.resize(640, 360); }, variant);
    const evidence = await page.evaluate(() => window.__chunk.evidence());
    for (let frame = 0; frame < 121; frame++) {
      const data = await page.evaluate(async frame => { const v = window.__chunk.view; await v.seek(frame * .03); return v.capture(); }, frame);
      await writeFile(path.join(frames, `${String(frame).padStart(3, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
    }
    const first = await readFile(path.join(frames, '000.png'));
    const end = await page.evaluate(async () => { const v = window.__chunk.view; await v.seek(3.63); return v.capture(); });
    const seam = first.equals(Buffer.from(end.split(',')[1], 'base64'));
    if (!seam) throw new Error(`Tile ${variant.number} is not pixel-identical at the seam`);
    await copyFile(path.join(frames, '000.png'), path.join(tile, 'still.png'));
    const encoded = execFileSync('python', ['scripts/pass8-round-encode.py', tile], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    report.variants.push({ ...variant, evidence, seamPixelIdentical: seam, media: JSON.parse(encoded.trim()) });
    await writeFile(path.join(out, 'round.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Tile ${variant.number}/9: ${variant.peakWaves} big waves, gain ${variant.heightGain}; 121 frames, 3.63 s; seam identical`);
  }
  await mkdir(path.join(out, 'reference'), { recursive: true });
  for (const name of ['loop.webm', 'media.json']) await copyFile(path.resolve('output/playwright/pass8-round1/reference', name), path.join(out, 'reference', name));
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  report.complete = true;
} catch (e) { report.failure = String(e); process.exitCode = 1; console.log(report.failure); }
finally { await writeFile(path.join(out, 'round.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
