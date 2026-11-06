import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('output/playwright/water-lab'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, acceptDownloads: true });
const errors = [], report = { errors, grids: [], variants: {}, presets: {}, available: [], failures: {}, defaultF: [] };
page.on('pageerror', error => errors.push(error.stack ?? String(error))); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const bytes = data => Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
async function saveCanvas(id, filename, type = 'image/png') { const data = await page.evaluate(async ({ id, type }) => { const variant = window.__lab.variants[id]; return variant.capture ? await variant.capture(type) : variant.canvas.toDataURL(type, .94); }, { id, type }); await writeFile(path.join(out, filename), bytes(data)); }
async function seek(id, time) { await page.evaluate(async ({ id, time }) => { await window.__lab.variants[id].seek(time); }, { id, time }); }
try {
  await page.goto('http://localhost:4103/lab.html?freeze=1&t=0', { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__lab?.ready, { timeout: 240000, polling: 250 });
  report.available = await page.evaluate(() => ['F', 'P', 'S'].filter(id => window.__lab.variants[id])); report.failures = await page.evaluate(() => window.__lab.failures);
  report.specifiedDefaults = await page.evaluate(() => window.__lab.preset());
  if (report.available.includes('F')) {
    await page.setViewportSize({ width: 1280, height: 720 }); await page.evaluate(() => window.__lab.focus('F'));
    for (const frame of [0, 60, 100]) { await seek('F', frame * .03); const filename = `F-default-${String(frame).padStart(3, '0')}.png`; await saveCanvas('F', filename); report.defaultF.push({ frame, filename, evidence: await page.evaluate(() => window.__lab.variants.F.evidence()) }); }
    await page.evaluate(async () => { await window.__lab.setPreset('F', { loop: false }); }); await saveCanvas('F', 'F-true-dispersion-start.png'); await seek('F', 3.63); await saveCanvas('F', 'F-true-dispersion-end.png');
    // Keep the specified defaults intact; best-look comparisons are explicit.
    await page.evaluate(async () => { await window.__lab.setPreset('F', { heroHeight: 3.5, chop: 1.15, Jthr: .35, loop: true }); });
  }
  report.bestSettings = await page.evaluate(() => window.__lab.preset());
  await writeFile(path.join(out, 'best-all.json'), JSON.stringify(report.bestSettings, null, 2));
  await writeFile(path.join(out, 'specified-defaults.json'), JSON.stringify(report.specifiedDefaults, null, 2));
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const frame of [0, 20, 40, 60, 80, 100]) { await page.evaluate(async t => { window.__lab.focus(null); await window.__lab.setTime(t); }, frame * .03); const filename = `grid-${String(frame).padStart(3, '0')}.png`; await page.screenshot({ path: path.join(out, filename) }); report.grids.push({ frame, time: frame * .03, filename }); }
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const id of report.available) {
    await page.evaluate(id => window.__lab.focus(id), id); const result = { frozen: [], motion: [] }; report.variants[id] = result; await mkdir(path.join(out, `motion-${id}`), { recursive: true });
    for (const frame of [0, 60, 100]) {
      await seek(id, frame * .03); const filename = `${id}-${String(frame).padStart(3, '0')}.png`; await saveCanvas(id, filename);
      const mask = await page.evaluate(id => window.__lab.variants[id].mask(), id); await writeFile(path.join(out, `${id}-${String(frame).padStart(3, '0')}-mask.png`), bytes(mask));
      const evidence = await page.evaluate(id => window.__lab.variants[id].evidence(), id); result.frozen.push({ frame, time: frame * .03, filename, evidence });
    }
    await seek(id, 0); await saveCanvas(id, `${id}-seam-start.png`); await seek(id, 3.63); await saveCanvas(id, `${id}-seam-end.png`);
    for (let frame = 0; frame < 121; frame++) { await seek(id, frame * .03); const filename = `motion-${id}/${String(frame).padStart(3, '0')}.jpg`; await saveCanvas(id, filename, 'image/jpeg'); result.motion.push(filename); }
    const preset = await page.evaluate(id => ({ version: 1, variants: { [id]: { ...window.__lab.variants[id].parameters } } }), id); await writeFile(path.join(out, `best-${id}.json`), JSON.stringify(preset, null, 2));
  }
  if (report.available.includes('F')) {
    await page.evaluate(() => window.__lab.focus('F'));
    const original = await page.evaluate(() => ({ ...window.__lab.variants.F.parameters }));
    for (const [name, wind] of [['Calm', 10], ['Rough', 15], ['Storm', 18], ['Gale', 24]]) {
      await page.evaluate(async settings => { await window.__lab.setPreset('F', settings); }, { ...report.specifiedDefaults.variants.F, wind }); await seek('F', 0); const filename = `F-${name.toLowerCase()}.png`; await saveCanvas('F', filename); report.presets[name] = { filename, evidence: await page.evaluate(() => window.__lab.variants.F.evidence()) };
    }
    await page.evaluate(async values => window.__lab.setPreset('F', values), original);
  }
} catch (error) { report.failure = String(error); process.exitCode = 1; await page.screenshot({ path: path.join(out, 'capture-failure.png') }); }
finally { await writeFile(path.join(out, 'capture.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ grids: report.grids, available: report.available, failures: report.failures, failure: report.failure, errors, variants: Object.fromEntries(Object.entries(report.variants).map(([id, data]) => [id, { frozen: data.frozen.length, motion: data.motion.length }])) }, null, 2)); await browser.close(); }
