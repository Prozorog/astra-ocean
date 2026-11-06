import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = 'output/playwright/pass8-round1-reflections';
const manifest = JSON.parse(await readFile(`${out}/round.json`, 'utf8'));
assert.equal(manifest.complete, true); assert.equal(manifest.variants.length, 9);
assert.ok(manifest.variants.every(v => v.seamPixelIdentical && v.media.frames === 121 && v.media.duration === 3.63));
const report = { errors: [], requests: [] }, browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on('pageerror', e => report.errors.push(String(e)));
page.on('response', r => { if (r.status() >= 400) report.requests.push(`${r.status()} ${r.url()}`); });
try {
  await page.goto('http://localhost:4103/pick.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__pick?.ready, null, { timeout: 30000 });
  assert.equal(await page.locator('.tile').count(), 9);
  assert.equal(await page.locator('.tile.current').getAttribute('data-tile'), '5');
  await page.waitForFunction(() => window.__pick.wraps >= 1, null, { timeout: 12000 });
  await page.waitForFunction(() => window.__pick.phases().every(v => v.ready >= 2 && v.time > .3 && v.time < 3), null, { timeout: 10000 });
  report.sync = await page.evaluate(() => {
    const p = window.__pick.phases(), t = p[0].time;
    return { phases: p, maxCircularDrift: Math.max(...p.map(v => Math.min(Math.abs(v.time - t), Math.abs(3.63 - Math.abs(v.time - t))))) };
  });
  assert.ok(report.sync.phases.every(v => !v.paused && v.ready >= 2 && Math.abs(v.duration - 3.63) < .001));
  assert.ok(report.sync.maxCircularDrift < .07, JSON.stringify(report.sync));
  await page.locator('[data-tile="9"]').click();
  await page.waitForFunction(() => document.querySelector('#enlarged').readyState >= 2 && window.__pick.selected === 9);
  assert.ok((await page.locator('#enlarged-label').innerText()).startsWith('9 ·'));
  await page.evaluate(() => window.__pick.select(5)); await page.evaluate(() => window.__pick.pause());
  await page.evaluate(() => window.__pick.seek(.9)); await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/pick-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${out}/pick-mobile.png`, fullPage: true });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.requests, []);
  report.pass = true;
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally { await browser.close(); await writeFile(`${out}/pick-check.json`, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); }
