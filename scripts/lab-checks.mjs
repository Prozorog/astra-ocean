import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const args = process.argv.slice(2), base = args.find(v => /^http/.test(v)) ?? 'http://localhost:4100';
const focused = args.includes('--variant=F'), out = 'output/playwright/storm-box'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, acceptDownloads: true });
const report = { url: base, focused, checks: {}, errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
async function check(name, run) { try { report.checks[name] = { passed: true, ...(await run()) }; } catch (error) { report.checks[name] = { passed: false, error: String(error) }; await page.screenshot({ path: `${out}/check-${name}-failed.png` }); } }
async function point(x, z) { return page.evaluate(({ x, z }) => { const f = window.__lab.variants.F, p = f.view.root.position.clone().set(x, 0, z); f.view.root.localToWorld(p); p.project(f.view.camera); const r = f.canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }, { x, z }); }
async function field() { return page.evaluate(() => { const o = window.__lab.variants.F.ocean, previous = o.renderer.getRenderTarget(); o.copyFoam.uniforms.uHistory.value = o.interaction.texture; o.pass.draw(o.copyFoam, o.diagnosticTarget); o.renderer.readRenderTargetPixels(o.diagnosticTarget, 0, 0, 256, 256, o.heights); o.renderer.setRenderTarget(previous); let maximum = 0, sum = 0, nonfinite = 0; for (let i = 0; i < o.heights.length; i += 4) { const h = o.heights[i]; if (!Number.isFinite(h)) nonfinite++; maximum = Math.max(maximum, Math.abs(h)); sum += h * h; } return { maximum, rms: Math.sqrt(sum / (256 * 256)), nonfinite, steps: o.interaction.steps, impulses: o.interaction.impulses, spherePushes: o.interaction.spherePushes }; }); }
try {
  await page.goto(`${base}/lab.html${focused ? '?variant=F' : ''}`, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__lab?.ready, { timeout: 240000, polling: 250 });
  await check('backends', async () => { const state = await page.evaluate(() => ({ failures: window.__lab.failures, available: Object.keys(window.__lab.variants) })); assert.deepEqual(state.failures, {}); assert.deepEqual(state.available.sort(), focused ? ['F'] : ['F', 'P', 'S']); return state; });
  await check('paused-focus', async () => {
    await page.evaluate(async () => { await window.__lab.setTime(0); window.__lab.focus('F'); });
    const pixels = await page.evaluate(async () => { const f = window.__lab.variants.F, image = await createImageBitmap(await (await fetch(await f.capture())).blob()), canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 45; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 80, 45); const data = context.getImageData(0, 0, 80, 45).data; let teal = 0; for (let i = 0; i < data.length; i += 4) if (data[i+1] > data[i]+8 && data[i+2] > data[i]+8) teal++; image.close(); return { tealFraction: teal / 3600 }; });
    assert(pixels.tealFraction > .05, 'Paused enlargement must retain the rendered water, not a cleared coral canvas'); await page.screenshot({ path: `${out}/paused-focus.png` }); return pixels;
  });
  await check('play-slow-scrub', async () => { await page.evaluate(async () => { await window.__lab.setTime(1.2); }); await page.click('#slow'); await page.click('#play'); const start = await page.evaluate(() => window.__lab.time); await page.waitForTimeout(500); await page.click('#play'); const end = await page.evaluate(() => window.__lab.time); assert(end - start > .06 && end - start < .3); await page.locator('#scrub').evaluate(input => { input.value = '1.8'; input.dispatchEvent(new Event('input', { bubbles: true })); }); await page.waitForFunction(() => Math.abs(window.__lab.time - 1.8) < 1e-6 && !window.__lab.playing); await page.click('#normal'); return { quarterSpeedElapsed: end - start }; });
  await check('panels-presets', async () => {
    await page.evaluate(() => window.__lab.focus(null));
    for (const id of focused ? ['F'] : ['F', 'P', 'S']) { await page.locator(`[data-tile=${id}] .tune`).click(); assert(await page.locator(`[data-tile=${id}] .gui-host`).isVisible()); await page.locator(`[data-tile=${id}] .tune`).click(); }
    const original = await page.evaluate(() => window.__lab.preset());
    const download = page.waitForEvent('download'); await page.click('#save-preset'); const file = await download; await file.saveAs(`${out}/downloaded-preset.json`);
    const changed = structuredClone(original); changed.variants.F.seed += 1; changed.variants.F.phaseOffset = .3;
    await page.setInputFiles('#preset-file', { name: 'lab.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) });
    await page.waitForFunction(seed => window.__lab.variants.F.parameters.seed === seed && document.querySelector('#status').value === 'Preset loaded', changed.variants.F.seed, { timeout: 120000 });
    const roundTrip = await page.evaluate(() => window.__lab.preset()); assert.deepEqual(roundTrip, changed);
    for (const invalid of [{ sheetSizeMetres: 0 }, { cascadeLengths: [85, 85, 5] }, { seed: 3.4 }, { windSpread: 0 }, { mesoGain: .5 }]) {
      await page.setInputFiles('#preset-file', { name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, variants: { F: invalid } })) });
      await page.waitForFunction(() => document.querySelector('#status').value.startsWith('Preset not loaded'));
    }
    await page.evaluate(async value => window.__lab.setPreset('F', value), original.variants.F);
    return { roundTrip, rejected: ['zero window', 'overlapping periods', 'fractional seed', 'zero directional width', 'sub-unit meso gain'], download: file.suggestedFilename() };
  });
  await check('foam-convergence-resume', async () => {
    const result = await page.evaluate(async () => {
      window.__lab.focus('F'); await window.__lab.setTime(1.8); const f = window.__lab.variants.F;
      const beauty = async () => {
        const image = await createImageBitmap(await (await fetch(await f.capture())).blob()), canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); const pixels = new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data); image.close(); return pixels;
      };
      const beautyBefore = await beauty();
      f.view.mask(1.8, false); const before = new Uint8Array(f.view.maskPixels), oldCoverage = f.view.foamCoverage;
      f.frame(1.8, 0); f.view.mask(1.8, false); let maximum = 0, changed = 0, water = 0;
      for (let i = 0; i < before.length; i += 4) if (before[i] > 240 && f.view.maskPixels[i] > 240) { water++; const delta = Math.abs(before[i + 1] - f.view.maskPixels[i + 1]); maximum = Math.max(maximum, delta); if (delta > 1) changed++; }
      const beautyAfter = await beauty(); let maximumBeautyChannelDelta = 0, changedBeautyPixels = 0;
      for (let i = 0; i < beautyBefore.length; i += 4) { const delta = Math.max(Math.abs(beautyBefore[i] - beautyAfter[i]), Math.abs(beautyBefore[i + 1] - beautyAfter[i + 1]), Math.abs(beautyBefore[i + 2] - beautyAfter[i + 2])); maximumBeautyChannelDelta = Math.max(maximumBeautyChannelDelta, delta); if (delta > 2) changedBeautyPixels++; }
      return { maximumFoamChannelDelta: maximum, changedWaterPixels: changed, waterPixels: water, oldCoverage, newCoverage: f.view.foamCoverage, maximumBeautyChannelDelta, changedBeautyPixels, convergence: f.ocean.foamConvergence };
    });
    assert(result.maximumFoamChannelDelta <= 1, 'Scrubbed whitecaps must not jump at zero elapsed time'); assert(result.maximumBeautyChannelDelta <= 2, 'Aerated relief and shading must not flash when resuming the displayed phase'); assert(result.convergence.length >= 3 && result.convergence.at(-1) < .001); return result;
  });
  await check('arbitrary-final-surface-probe', async () => {
    const result = await page.evaluate(async () => { const o = window.__lab.variants.F.ocean; o.setProbe(6, 1.2, -1.1); await o.readSample(o.time, true); const a = { ...o.samples[6] }; o.setProbe(6, a.x, a.z, true); await o.readSample(o.time, true); return { lagrangian: a, inverse: { ...o.samples[6] } }; });
    assert(result.lagrangian.valid && result.inverse.valid, JSON.stringify(result)); assert(Math.abs(result.lagrangian.y - result.inverse.y) < .03); assert(result.inverse.residual < .045);
    assert(Math.abs(Math.hypot(result.inverse.nx, result.inverse.ny, result.inverse.nz) - 1) < .01); return result;
  });
  await check('continuous-loop', async () => {
    const result = await page.evaluate(async () => { const f = window.__lab.variants.F, o = f.ocean; await window.__lab.setTime(0); const loops = [];
      for (let frame = 1; frame <= 363; frame++) { f.frame(frame * .03, .03); if (frame % 121 === 0) { o.copyFoam.uniforms.uHistory.value = o.history; o.pass.draw(o.copyFoam, o.diagnosticTarget); const data = new Float32Array(o.heights.length); await o.renderer.readRenderTargetPixelsAsync(o.diagnosticTarget, 0, 0, 256, 256, data); loops.push(data); } }
      const deltas = []; for (let k = 1; k < loops.length; k++) { let max = 0, sum = 0; for (let i = 0; i < loops[k].length; i += 4) for (let c = 0; c < 3; c++) { const delta = Math.abs(loops[k][i + c] - loops[k-1][i + c]); max = Math.max(max, delta); sum += delta; } deltas.push({ maximum: max, mean: sum / (65536 * 3) }); } return { deltas, noSeekAtBoundary: true, channels: 'RGB bulk density, short whitecaps, transported fold moment', channelSamples: 65536 * 3 }; });
    assert(result.deltas.every(d => d.maximum < .01), JSON.stringify(result)); return result;
  });
  await check('tap-propagation-decay', async () => { await page.click('#normal'); await page.evaluate(async () => { window.__lab.focus('F'); await window.__lab.setTime(0); window.__lab.play(); }); await page.waitForTimeout(100); const zero = await field(); assert.equal(zero.maximum, 0); const tap = await point(2, 1.5); await page.mouse.click(tap.x, tap.y); await page.waitForTimeout(120); const early = await field(); assert(early.maximum > .01 && early.impulses > zero.impulses && early.nonfinite === 0); await page.waitForTimeout(350); const propagated = await field(); assert(propagated.steps > early.steps && propagated.rms > 0); await page.waitForTimeout(3300); const expired = await field(); assert(expired.rms < early.rms * .15); return { zero, early, propagated, expired }; });
  await check('ball-volume-drop', async () => { await page.keyboard.press('b'); const initial = await page.evaluate(() => { const f = window.__lab.variants.F; return { offset: f.dropOffset, velocity: f.dropVelocity }; }); assert(initial.offset > 2); const old = await field(); await page.waitForTimeout(700); const impact = await field(); const offset = await page.evaluate(() => window.__lab.variants.F.dropOffset); const evidence = { initial, laterOffset: offset, before: old, impact }; assert(offset < initial.offset); assert(impact.spherePushes > old.spherePushes && impact.maximum > .01 && impact.nonfinite === 0 && impact.maximum <= 8.01, JSON.stringify(evidence)); return evidence; });
  await page.evaluate(() => window.__lab.pause());
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally { report.allPassed = !report.failure && report.errors.length === 0 && Object.values(report.checks).every(value => value.passed); if (!report.allPassed) process.exitCode = 1; await writeFile(`${out}/lab-checks.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser.close(); }
