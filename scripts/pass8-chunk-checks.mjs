import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const out = path.resolve('output/playwright/pass8-chunk'); await mkdir(out, { recursive: true });
const report = { errors: [] };
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', e => report.errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
try {
  await page.goto('http://localhost:4103/?renderer=ultra', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chunk?.ready, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__chunk.evidence().renderedFrames > 8);
  const tap = await page.evaluate(async () => {
    const api = window.__chunk, { Vector3 } = await import('/node_modules/three/build/three.module.js');
    const sample = await api.surface.samplePoint(2.4, 1.7);
    const screen = sample.position.clone().applyMatrix4(api.sheetRoot.matrixWorld).project(api.camera);
    return { x: (screen.x + 1) * 640, y: (1 - screen.y) * 360, before: api.surface.ocean.interaction.impulses };
  });
  await page.mouse.click(tap.x, tap.y);
  await page.waitForFunction(before => window.__chunk.surface.ocean.interaction.impulses > before, tap.before, { timeout: 10000 });
  report.tapRipple = true;
  await page.mouse.move(1000, 400); await page.mouse.wheel(0, 180);
  await page.waitForFunction(() => window.__chunk.evidence().stormTarget < 1);
  report.stormWheel = await page.evaluate(() => window.__chunk.evidence().stormTarget);
  const ball = await page.evaluate(() => {
    const api = window.__chunk, p = api.ball.getWorldPosition(api.view.ballWorld.clone()).project(api.camera);
    return { x: (p.x + 1) * 640, y: (1 - p.y) * 360 };
  });
  await page.mouse.move(ball.x, ball.y); await page.mouse.down();
  await page.waitForFunction(() => window.__chunk.effects.mode === 'held', null, { timeout: 5000 }); report.grab = true;
  await page.mouse.move(ball.x + 70, ball.y - 60, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(() => ['flying', 'bobbing'].includes(window.__chunk.effects.mode)); report.throw = true;
  await page.waitForFunction(() => window.__chunk.evidence().interaction.bounceCount > 0, null, { timeout: 15000 });
  report.splash = await page.evaluate(() => window.__chunk.evidence().interaction.bounceCount);
  await page.screenshot({ path: path.join(out, 'interactive.png') });
  report.softness = await page.evaluate(async () => {
    const api = window.__chunk, view = api.view;
    view.renderer.setAnimationLoop(null); await api.setTime(.9);
    const original = { ...view.settings }, result = {};
    Object.assign(view.settings, { motionBlur: false, depthOfField: false, grain: false });
    const clean = view.capture();
    for (const key of ['motionBlur', 'depthOfField', 'grain']) {
      Object.assign(view.settings, { motionBlur: false, depthOfField: false, grain: false, [key]: true });
      result[key] = clean !== view.capture();
    }
    Object.assign(view.settings, original); return result;
  });
  assert.ok(Object.values(report.softness).every(Boolean), JSON.stringify(report.softness));
  assert.deepEqual(report.errors, []); report.pass = true;
} catch (e) { report.failure = String(e); process.exitCode = 1; await page.screenshot({ path: path.join(out, 'checks-failure.png') }); }
finally { await writeFile(path.join(out, 'interaction-checks.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close(); console.log(JSON.stringify(report, null, 2)); }
