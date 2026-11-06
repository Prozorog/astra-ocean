import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';

const out = path.resolve('output/playwright/pass8-base');
const report = { clips: [], errors: [], requests: [] };
const capture = JSON.parse(await readFile(path.join(out, 'capture.json'), 'utf8'));
assert.equal(capture.complete, true);
assert.deepEqual(capture.errors, []);
execFileSync('git', ['-C', '.references/ultra-water', 'diff', '--exit-code', '--', 'src'], { windowsHide: true });
report.upstreamRendererUnmodified = true;
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(String(error)));
page.on('response', response => { if (response.status() >= 400) report.requests.push(`${response.status()} ${response.url()}`); });
try {
  await page.goto('http://localhost:4103/pick.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pick?.shots.length === 7);
  assert.equal(await page.locator('.tile').count(), 7);
  assert.equal(await page.locator('#reference').evaluate(img => img.complete && img.naturalWidth > 0), true);
  for (const id of await page.evaluate(() => window.__pick.shots.map(shot => shot.id))) {
    await page.locator(`[data-shot="${id}"]`).click();
    await page.waitForFunction(() => {
      const video = document.querySelector('#selected-video');
      return video.readyState >= 2 && !video.paused && video.currentTime > .05;
    });
    const video = await page.locator('#selected-video').evaluate(v => ({
      width: v.videoWidth, height: v.videoHeight, duration: v.duration,
      paused: v.paused, source: v.currentSrc, error: v.error?.message,
    }));
    assert.equal(video.error, undefined);
    assert.ok(video.width > 0 && video.height > 0 && video.duration > 3);
    if (!['current-f', 'poseidon-p'].includes(id)) {
      assert.equal(video.width, 1280); assert.equal(video.height, 720);
      assert.ok(Math.abs(video.duration - 6) < .04);
    }
    await page.locator('#still').click();
    assert.equal(await page.locator('#selected-still').isVisible(), true);
    assert.equal(await page.locator('#selected-video').isVisible(), false);
    await page.locator('#selected-still').evaluate(img => img.decode());
    await page.locator('#still').click();
    assert.equal(await page.locator('#selected-video').isVisible(), true);
    report.clips.push({ id, ...video });
  }
  await page.locator('[data-shot="open-ocean"]').click();
  await page.waitForFunction(() => document.querySelector('#selected-video').readyState >= 2);
  await page.screenshot({ path: path.join(out, 'pick-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  report.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(report.mobileOverflow, false);
  await page.screenshot({ path: path.join(out, 'pick-mobile.png'), fullPage: true });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.requests, []);
  report.pass = true;
} catch (error) {
  report.failure = String(error); process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(path.join(out, 'pick-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
