import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('output/playwright/pass8-chunk'); await mkdir(out, { recursive: true });
const report = { errors: [], requests: [] };
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) report.requests.push(`${response.status()} ${response.url()}`); });
try {
  await page.goto('http://localhost:4103/?renderer=ultra&freeze=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chunk?.ready || document.querySelector('.sea-loader')?.textContent?.includes('Error'), null, { timeout: 240000 });
  if (!await page.evaluate(() => window.__chunk?.ready)) throw new Error(await page.locator('.sea-loader').innerText());
  await page.evaluate(() => window.__chunk.setTime(0));
  await page.screenshot({ path: path.join(out, 'first.png') });
  report.evidence = await page.evaluate(() => window.__chunk.evidence());
  const seam = await page.evaluate(async () => {
    const api = window.__chunk; await api.setTime(0); const a = api.view.capture();
    await api.setTime(3.63); const b = api.view.capture();
    return a === b;
  });
  report.pixelIdenticalSeam = seam;
  console.log(JSON.stringify({ seam, evidence: report.evidence, errors: report.errors, requests: report.requests }, null, 2));
  if (!seam || report.errors.length) process.exitCode = 1;
} catch (error) {
  report.failure = String(error); process.exitCode = 1;
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(path.join(out, 'probe.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close();
}
