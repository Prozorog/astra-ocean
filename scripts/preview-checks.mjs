import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2), url = args.find(value => /^http/.test(value)) ?? 'http://localhost:4103';
const smoke = args.includes('--smoke'), only = args.find(value => value.startsWith('--only='))?.slice(7);
if((await readFile('src/entry.ts','utf8')).includes('./ultra/main.js')){await (await import('./pass9-ultra-checks.mjs')).runPreview(url,args);process.exit(process.exitCode??0);}
const out = path.resolve('output/playwright/preview'); await mkdir(out, { recursive: true });
const report = { url, errors: [], variants: [] };
const launchOptions = { headless: !args.includes('--headed'), args: ['--enable-webgl', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] };
let browser = await chromium.launch(launchOptions);
async function ready(page, address = url) { await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForFunction(() => window.__ready, null, { timeout: 180000 }); }
async function state(page) { return page.evaluate(() => window.__evidence()); }
async function wake(page, viewport) { await page.mouse.move(viewport.width / 2, viewport.height - 35); }
async function shot(page, name) { const filename = `${name}.png`; await page.screenshot({ path: path.join(out, filename), animations: 'disabled' }); return filename; }
async function point(page, x, z) {
  return page.evaluate(async ({ x, z }) => {
    const api = window.__ocean, sample = await api.surface.samplePoint(x, z);
    const screen = sample.position.applyMatrix4(api.sheetRoot.matrixWorld).project(api.camera);
    return { x: (screen.x + 1) / 2 * innerWidth, y: (1 - screen.y) / 2 * innerHeight };
  }, { x, z });
}
async function touchDrag(page, start, end, steps = 10, release = true) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * i / steps, y: start.y + (end.y - start.y) * i / steps, id: 1 }] });
    await page.waitForTimeout(18);
  }
  if (release) await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return client;
}
async function floorColour(page) {
  return page.evaluate(() => {
    const api = window.__ocean, objects = [api.top, api.lip, api.ball, ...api.sheetRoot.children.filter(item => item.name === 'Aerated breaking-water volume'), ...api.scene.children.filter(item => item.isPoints)];
    const visibility = objects.map(object => object.visible), strength = api.floor.material.uniforms.uShadowStrength.value, gain = api.post.output.uniforms.uBloom.value, bloom = api.post.bloom.enabled, film = api.post.output.uniforms.uFilm.value;
    try {
      objects.forEach(object => { object.visible = false; }); api.floor.material.uniforms.uShadowStrength.value = 0; api.post.output.uniforms.uBloom.value = 0; api.post.bloom.enabled = false; api.post.render();
      const gl = api.renderer.getContext(), width = api.renderer.domElement.width, height = api.renderer.domElement.height, pixels = new Uint8Array(21 * 21 * 4);
      gl.readPixels(Math.floor(width / 2) - 10, Math.floor(height / 2) - 10, 21, 21, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const average = [0, 0, 0]; for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 3; channel++) average[channel] += pixels[i + channel] / 441;
      api.post.output.uniforms.uFilm.value = false; api.post.render();
      const flatCentre = new Uint8Array(4), flatTop = new Uint8Array(4);
      gl.readPixels(Math.floor(width / 2), Math.floor(height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, flatCentre);
      gl.readPixels(Math.floor(width / 2), height - 20, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, flatTop);
      return { average: average.map(Math.round), centre: Array.from(pixels.slice(220 * 4, 220 * 4 + 3)), flatCentre: Array.from(flatCentre.slice(0, 3)), flatTop: Array.from(flatTop.slice(0, 3)) };
    } finally {
      objects.forEach((object, i) => { object.visible = visibility[i]; }); api.floor.material.uniforms.uShadowStrength.value = strength;
      api.post.output.uniforms.uBloom.value = gain; api.post.bloom.enabled = bloom; api.post.output.uniforms.uFilm.value = film; api.post.render();
    }
  });
}
async function heightRms(page) {
  return page.evaluate(() => {
    const { water, renderer } = window.__ocean; const previous = renderer.getRenderTarget();
    water.copyFoam.uniforms.uHistory.value = water.geometry.texture; water.pass.draw(water.copyFoam, water.diagnosticTarget);
    renderer.readRenderTargetPixels(water.diagnosticTarget, 0, 0, 256, 256, water.heights); renderer.setRenderTarget(previous);
    let sum = 0, squares = 0; for (let i = 0; i < water.heights.length; i += 4) { const h = water.heights[i + 1]; sum += h; squares += h * h; }
    return Math.sqrt(squares / 65536 - (sum / 65536) ** 2) * 10 / water.parameters.sheetSizeMetres;
  });
}
async function pngDifference(page, first, second) {
  return page.evaluate(async files => {
    const images = await Promise.all(files.map(async base64 => createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())));
    const canvas = document.createElement('canvas'); canvas.width = images[0].width; canvas.height = images[0].height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(images[0], 0, 0); const a = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(images[1], 0, 0); const b = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let maximum = 0, changed = 0; for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); maximum = Math.max(maximum, delta); if (delta) changed++; }
    images.forEach(image => image.close()); return { maximum, changed };
  }, [first.toString('base64'), second.toString('base64')]);
}
function videoDuration(filename) {
  const ffmpeg = execFileSync('python', ['-c', 'from imageio_ffmpeg import get_ffmpeg_exe; print(get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
  const decoded = spawnSync(ffmpeg, ['-v', 'error', '-threads', '4', '-i', filename, '-threads', '4', '-progress', 'pipe:1', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'], { encoding: 'utf8' });
  if (decoded.status) throw new Error(decoded.stderr);
  const samples = [...decoded.stdout.matchAll(/out_time_us=(\d+)/g)]; return Number(samples.at(-1)?.[1] ?? 0) / 1e6;
}
async function variant(name, viewport, mobile) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, acceptDownloads: true });
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(`${name}: ${error.stack || error}`));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(`${name}: ${message.text()}`); });
  const result = { name, viewport, checks: {}, screenshots: {}, load: {} }; report.variants.push(result);
  async function check(key, action) {
    if (only && key !== only) return;
    if (smoke && !['shell', 'grab-throw', 'tap'].includes(key)) return;
    try { result.checks[key] = { passed: true, ...await action() }; if (!result.screenshots[key]) result.screenshots[key] = await shot(page, `${name}-${key}`); }
    catch (error) { result.checks[key] = { passed: false, error: String(error), state: await state(page).catch(() => null) }; result.screenshots[key] = await shot(page, `${name}-${key}-failure`).catch(() => null); }
  }
  try {
    await page.addInitScript(() => {
      window.__oceanProgress = [];
      const observer = new MutationObserver(() => { const bar = document.querySelector('.sea-loader progress'); if (bar && window.__oceanProgress.at(-1) !== bar.value) window.__oceanProgress.push(bar.value); });
      observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['value'] });
    });
    await ready(page); result.load.first = (await state(page)).load; result.load.progress = await page.evaluate(() => window.__oceanProgress);
    result.screenshots.intro = await shot(page, `${name}-intro`); result.load.intro = (await state(page)).interaction;
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__ready, null, { timeout: 180000 });
    result.load.reinitialized = (await state(page)).load;
    const initialized = await page.evaluate(() => ({ ready: window.__ocean.water.ready, fft: window.__ocean.water.fftResult, sample: window.__ocean.water.sample }));
    assert(initialized.ready && initialized.fft.passed && initialized.sample.valid, 'Reload must initialize live GPU FFT and a valid final-surface probe');
    assert.equal(result.load.reinitialized.progress, 1); assert(result.load.progress.some(value => value > 0 && value < 1), 'GPU initialization must expose loading progress');
    await page.waitForTimeout(3150); await wake(page, viewport); await page.evaluate(() => window.__ocean.effects.reset());
    await check('shell', async () => {
      assert.equal(await page.getByRole('heading', { name: 'Floating Ocean', exact: true }).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Coral mood', exact: true }).count(), 1);
      const sizes = await page.locator('.preview-dock button').evaluateAll(buttons => buttons.map(button => ({ label: button.getAttribute('aria-label'), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
      if (mobile) assert(sizes.every(size => size.width >= 44 && size.height >= 44), 'Mobile dock buttons need 44px targets');
      return { targets: sizes, scrollable: await page.locator('.preview-dock').evaluate(element => element.scrollWidth > element.clientWidth) };
    });
    await page.locator('canvas').focus(); await page.keyboard.press('Space');
    await check('grab-throw', async () => {
      await page.evaluate(() => window.__ocean.effects.reset()); const before = await state(page), origin = { x: before.ballScreen[0] * viewport.width, y: before.ballScreen[1] * viewport.height };
      let touch;
      if (mobile) { touch = await context.newCDPSession(page); await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...origin, id: 1 }] }); }
      else { await page.mouse.move(origin.x, origin.y); await page.mouse.down(); }
      await page.waitForFunction(() => window.__ocean.effects.mode === 'held'); await page.waitForTimeout(200); const held = await state(page);
      assert(held.interaction.position[1] - before.interaction.position[1] > .35, 'Held ember must lift clear of the water');
      for (let i = 1; i <= 9; i++) {
        const x = origin.x + (mobile ? 35 : 85) * i / 9, y = origin.y - (mobile ? 20 : 30) * i / 9;
        if (mobile) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }); else await page.mouse.move(x, y);
        await page.waitForTimeout(18);
      }
      if (mobile) { await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach(); } else await page.mouse.up();
      const released = await state(page); assert.equal(released.interaction.mode, 'flying');
      await page.waitForFunction(() => { const state = window.__evidence().interaction; return state.droplets > 0 && state.pulseWeights.some(value => value > 0); }, null, { timeout: 2800 });
      await page.waitForTimeout(60); const impact = await state(page); result.screenshots['grab-throw'] = await shot(page, `${name}-grab-throw`);
      await page.waitForFunction(() => window.__ocean.effects.mode === 'track', null, { timeout: 3100 }); const returned = await state(page);
      assert(returned.interaction.bounceCount <= 2); assert(returned.interaction.lastImpactAt > returned.interaction.releaseAt);
      return { heldLift: held.interaction.position[1] - before.interaction.position[1], released: released.interaction, impact: impact.interaction, returned: returned.interaction };
    });
    await check('tap', async () => {
      await page.evaluate(() => window.__ocean.effects.reset()); const p = await point(page, -2, 1.8);
      if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
      await page.waitForFunction(() => window.__ocean.impacts.some(pulse => pulse.w > 0) && window.__ocean.water.interaction.impulses > 0); await page.waitForTimeout(80);
      const active = await state(page); assert.equal(active.interaction.pulseWeights.length, 6); assert(active.interaction.droplets > 0);
      result.screenshots.tap = await shot(page, `${name}-tap`);
      for (let i = 1; i < 6; i++) {
        const next = await point(page, -2 + i * .12, 1.8);
        if (mobile) await page.touchscreen.tap(next.x, next.y); else await page.mouse.click(next.x, next.y);
      }
      await page.waitForFunction(() => window.__ocean.impacts.filter(pulse => pulse.w > 0).length === 6, null, { timeout: 1000 });
      const concurrent = await state(page); assert.equal(concurrent.interaction.pulseWeights.filter(value => value > 0).length, 6);
      await page.waitForTimeout(3100); const expired = await state(page); assert(expired.interaction.pulseWeights.every(value => value === 0));
      return { active: active.interaction, concurrent: concurrent.interaction, expired: expired.interaction };
    });
    await check('wheel', async () => {
      await page.evaluate(() => window.__ocean.effects.reset()); const before = await heightRms(page), distanceBefore = await page.evaluate(() => window.__ocean.camera.position.distanceTo(window.__ocean.controls.target));
      await page.mouse.move(viewport.width * .73, viewport.height * .55);
      if (mobile) {
        await wake(page, viewport); const bounds = await page.getByRole('slider', { name: 'Storm level' }).boundingBox();
        const client = await touchDrag(page, { x: bounds.x + bounds.width - 8, y: bounds.y + 28 }, { x: bounds.x + 12, y: bounds.y + 28 }); await client.detach();
      } else for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(30); }
      await page.waitForTimeout(900); const after = await heightRms(page), storm = (await state(page)).storm;
      assert(storm < .8, 'Wheel/slider must lower storm'); assert(Math.abs(after - before) > .02, 'Storm must change the visible height RMS');
      const distanceAfter = await page.evaluate(() => window.__ocean.camera.position.distanceTo(window.__ocean.controls.target)); assert(Math.abs(distanceAfter - distanceBefore) < .001, 'Storm wheel must not zoom');
      await page.locator('canvas').focus(); for (let i = 0; i < 10; i++) await page.keyboard.press(']');
      await page.waitForTimeout(800); await wake(page, viewport); return { before, after, storm, distanceBefore, distanceAfter, restoredStorm: (await state(page)).storm };
    });
    await check('tilt-slosh', async () => {
      await page.evaluate(() => window.__ocean.effects.reset()); await page.mouse.move(60, 200);
      for (let i = 1; i <= 12; i++) { await page.mouse.move(60 + (viewport.width - 120) * i / 12, 200 + 180 * Math.sin(i / 12 * Math.PI)); await page.waitForTimeout(12); }
      await page.waitForTimeout(120); const active = await state(page); assert(Math.hypot(...active.interaction.tilt) > .005); assert(Math.hypot(...active.interaction.slosh) > .01);
      result.screenshots['tilt-slosh'] = await shot(page, `${name}-tilt-slosh`); await page.waitForTimeout(4000); const decayed = await state(page);
      assert(Math.hypot(...decayed.interaction.slosh) < Math.hypot(...active.interaction.slosh));
      return { active: active.interaction, decayed: decayed.interaction };
    });
    await check('moods', async () => {
      const colours = {}, targets = { Coral: [206, 115, 99], Midnight: [27, 36, 51], Mint: [159, 211, 193], Sand: [227, 201, 160] };
      for (const mood of Object.keys(targets)) {
        await wake(page, viewport); const button = page.getByRole('button', { name: `${mood} mood`, exact: true }); await button.scrollIntoViewIfNeeded(); await button.click();
        await page.waitForTimeout(950); colours[mood] = await floorColour(page); assert(colours[mood].average.every((channel, i) => Math.abs(channel - targets[mood][i]) <= 3), `${mood} floor colour`);
        assert.deepEqual(colours[mood].flatTop, colours[mood].flatCentre, `${mood}: HDR clear must match the floor beyond the far clip`);
        result.screenshots[`mood-${mood}`] = await shot(page, `${name}-mood-${mood.toLowerCase()}`);
      }
      await page.keyboard.press('m'); await page.waitForTimeout(900); return { colours };
    });
    await check('speed', async () => {
      await page.evaluate(() => window.__ocean.effects.reset()); await page.locator('canvas').focus(); await page.keyboard.press('1'); assert.equal((await state(page)).speed, .25);
      await page.keyboard.press('Space');
      const slowFrames = await page.evaluate(() => new Promise((resolve, reject) => {
        const api = window.__ocean; api.water.setProbe(3, 1.17, -2.3); const heights = []; let last = -1;
        const deadline = setTimeout(() => reject(new Error('Quarter-speed GPU probes stopped advancing')), 5000);
        const tick = () => {
          const sample = api.water.samples[3];
          if (sample.valid && sample.time !== last) { last = sample.time; heights.push(sample.y); }
          if (heights.length < 12) requestAnimationFrame(tick); else { clearTimeout(deadline); resolve(heights); }
        }; requestAnimationFrame(tick);
      }));
      assert(new Set(slowFrames).size >= 10, `Quarter-speed final GPU heights must move between phases: ${JSON.stringify(slowFrames)}`);
      await page.keyboard.press('2'); assert.equal((await state(page)).speed, .5); await page.keyboard.press('3'); assert.equal((await state(page)).speed, 1);
      const seams = {};
      for (const speed of [.25, .5, 1]) {
        await page.evaluate(async speed => { window.__ocean.settings.timeScale = speed; await window.__setTime(0); }, speed); const first = await page.screenshot();
        await page.evaluate(() => window.__setTime(3.63)); const second = await page.screenshot(); seams[speed] = await pngDifference(page, first, second); assert.equal(seams[speed].maximum, 0);
      }
      await page.evaluate(() => window.__play()); await page.keyboard.press('Space'); await page.keyboard.press('3'); await wake(page, viewport); return { slowFrames, seams };
    });
    await check('snapshot', async () => {
      await wake(page, viewport); const size = await page.evaluate(() => ({ width: document.querySelector('canvas').width, height: document.querySelector('canvas').height }));
      await page.getByRole('button', { name: 'Save snapshot', exact: true }).scrollIntoViewIfNeeded();
      const pending = page.waitForEvent('download'); await page.locator('canvas').focus(); await page.keyboard.press('p'); const download = await pending;
      assert.equal(download.suggestedFilename(), 'floating-ocean.png'); const filename = path.join(out, `${name}-floating-ocean.png`); await download.saveAs(filename);
      const png = await readFile(filename), dimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
      assert.equal(dimensions.width, size.width * 2); assert.equal(dimensions.height, size.height * 2); return { dimensions, bytes: png.length, file: filename };
    });
    await check('record', async () => {
      await wake(page, viewport); await page.locator('.record-button').scrollIntoViewIfNeeded();
      await page.locator('canvas').focus(); await page.keyboard.press('3'); await page.evaluate(() => window.__play());
      await page.waitForFunction(() => window.__ocean.water.time > 1 && window.__ocean.water.time < 1.25);
      const p=await point(page,-2,1.8);if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);
      await page.waitForFunction(()=>window.__ocean.impacts.some(p=>p.w>0),null,{timeout:3000}); // Raster contact resolves asynchronously.
      const before=await page.evaluate(()=>({wall:performance.now(),phase:window.__ocean.water.time,frame:window.__ocean.renderedFrames,pulses:window.__ocean.impacts.map(p=>p.w)}));
      assert(before.pulses.some(p=>p>0),'Prime a real user disturbance before recording');
      await page.locator('canvas').focus(); const pending = page.waitForEvent('download', { timeout: 30000 }), started = performance.now();
      await page.keyboard.press('l'); await page.waitForFunction(frame => window.__ocean.capture.recording && window.__ocean.renderedFrames > frame,before.frame);
      const first=await page.evaluate(()=>({wall:performance.now(),phase:window.__ocean.water.time,pulses:window.__ocean.impacts.map(p=>p.w)}));
      const phaseError=((first.phase-before.phase-(first.wall-before.wall)/1000+1.815)%3.63+3.63)%3.63-1.815;
      assert(Math.abs(phaseError)<.12,'Record must continue the live phase, not seek to zero');assert(first.pulses.some(p=>p>0),'Record must not clear a live user disturbance');
      await page.waitForTimeout(700);
      result.screenshots.record = await shot(page, `${name}-record`); const download = await pending; assert.equal(download.suggestedFilename(), 'floating-ocean-loop.webm');
      const filename = path.join(out, `${name}-floating-ocean-loop.webm`); await download.saveAs(filename); const size = (await stat(filename)).size, duration = videoDuration(filename);
      assert(size > 10000); assert(Math.abs(duration - 3.63) < .5, 'Encoded recording must span one loop'); return { file: filename, bytes: size, encodedSeconds: duration, wallSeconds: (performance.now() - started) / 1000, phaseError, disturbancePreserved: true };
    });
    await check('sound', async () => {
      await wake(page, viewport); const toggle = page.getByRole('button', { name: /Turn sound/ }); await toggle.scrollIntoViewIfNeeded();
      if (mobile) await toggle.tap(); else { await page.locator('canvas').focus(); await page.keyboard.press('s'); }
      await page.waitForFunction(() => window.__ocean.audio.context?.state === 'running' && window.__ocean.audio.gain > 0, null, { timeout: 3000 });
      const on = await page.evaluate(() => ({ context: window.__ocean.audio.context?.state, gain: window.__ocean.audio.gain, clock: window.__ocean.audio.context?.currentTime }));
      if (mobile) await toggle.tap(); else await page.keyboard.press('s');
      await page.waitForFunction(() => window.__ocean.audio.context?.state === 'suspended', null, { timeout: 3000 });
      const off = await page.evaluate(() => ({ context: window.__ocean.audio.context?.state, gain: window.__ocean.audio.gain }));
      assert.equal(off.gain, 0); await wake(page, viewport); return { on, off };
    });
    await check('auto-hide', async () => {
      await page.locator('canvas').focus(); await page.mouse.move(20, 20); await page.waitForTimeout(3400); assert(await page.locator('.preview-dock').evaluate(element => element.classList.contains('is-idle')));
      await wake(page, viewport); assert(!(await page.locator('.preview-dock').evaluate(element => element.classList.contains('is-idle')))); return { hiddenAfterIdle: true, restoredOnMovement: true };
    });
    if (mobile) await check('touch-dock', async () => {
      await wake(page, viewport); const dock = page.locator('.preview-dock'); await dock.evaluate(element => { element.scrollLeft = 0; });
      const client = await touchDrag(page, { x: 330, y: viewport.height - 41 }, { x: 60, y: viewport.height - 41 }, 15); await client.detach(); await page.waitForTimeout(120);
      const scrollLeft = await dock.evaluate(element => element.scrollLeft); assert(scrollLeft > 80, 'The mobile dock must scroll with a real touch swipe');
      return { scrollLeft, touchSwipe: true };
    });
    await check('orbit-reset', async () => {
      await page.evaluate(() => window.__ocean.effects.reset()); const p = await point(page, -2, 1.8);
      if (mobile) { const client = await touchDrag(page, p, { x: p.x + 55, y: p.y + 20 }); await client.detach(); }
      else { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 100, p.y + 30, { steps: 10 }); await page.mouse.up(); }
      assert.equal((await state(page)).hero, false); result.screenshots['orbit-reset'] = await shot(page, `${name}-orbit-reset`);
      await page.locator('canvas').focus(); await page.keyboard.press('r'); await page.waitForFunction(() => window.__evidence().hero, null, { timeout: 3000 });
      if (mobile) { const client = await touchDrag(page, p, { x: p.x - 45, y: p.y }); await client.detach(); }
      else { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x - 80, p.y, { steps: 8 }); await page.mouse.up(); }
      await page.waitForFunction(() => window.__evidence().hero, null, { timeout: 8000 }); return { resetRestoresHero: true, idleRestoresHero: true };
    });
    await check('dev-controls', async () => {
      await page.locator('canvas').focus(); await page.keyboard.press('h'); assert(await page.locator('.lil-gui.lil-root').isVisible());
      await page.getByRole('button', { name: /Inspect/ }).click(); await page.locator('.lil-gui select').selectOption({ label: 'C2 only' });
      await page.waitForFunction(() => window.__ocean.settings.debug === 'C2 only'); result.screenshots['dev-controls'] = await shot(page, `${name}-dev-controls`);
      await page.locator('.lil-gui select').selectOption({ label: 'Beauty' }); await page.locator('canvas').focus(); await page.keyboard.press('d'); await page.waitForTimeout(60);
      assert(await page.evaluate(() => window.__ocean.scene.children.some(item => item.isPoints && item !== window.__ocean.splashes.points && item.visible)));
      await page.keyboard.press('d'); await page.keyboard.press('h'); assert(await page.locator('.lil-gui.lil-root').isHidden()); return { h: true, d: true, cascadeDropdown: true };
    });
    await check('help', async () => {
      await wake(page, viewport); const button = page.getByRole('button', { name: 'Show shortcuts', exact: true }); await button.scrollIntoViewIfNeeded(); await button.click();
      assert(await page.getByRole('dialog').isVisible()); result.screenshots.help = await shot(page, `${name}-help`); await page.keyboard.press('Escape'); assert(await page.getByRole('dialog').isHidden());
      return { accessibleDialog: true, escapeCloses: true };
    });
    if (!smoke && (!only || only === 'reduced-motion')) {
      try {
        // Reload the existing storage partition under the media preference.
        // A second cold incognito FFT/renderer heap is unnecessary for this check.
        await page.emulateMedia({ reducedMotion: 'reduce' }); await ready(page);
        const initial = await state(page); await page.mouse.move(30, 100); await page.mouse.move(viewport.width - 30, 500, { steps: 12 }); await page.waitForTimeout(300);
        const after = await state(page); assert(!initial.introActive); assert.equal(initial.interaction.mode, 'track'); assert.deepEqual(after.interaction.tilt, [0, 0]); assert.deepEqual(after.interaction.slosh, [0, 0]);
        result.checks['reduced-motion'] = { passed: true, initial: initial.interaction, after: after.interaction }; result.screenshots['reduced-motion'] = await shot(page, `${name}-reduced-motion`);
      } catch (error) { result.checks['reduced-motion'] = { passed: false, error: String(error) }; } finally { await page.emulateMedia({ reducedMotion: 'no-preference' }); }
    }
    if (!smoke && (!only || only === 'query-modes')) {
      await ready(page, `${url}/?t=0&freeze=1`); const first = await state(page); await page.keyboard.press('h'); await page.keyboard.press('Space'); await page.keyboard.press('d');
      await page.mouse.wheel(0, 500); await page.mouse.click(first.ballScreen[0] * viewport.width, first.ballScreen[1] * viewport.height); await page.waitForTimeout(200);
      const frozen = await state(page); assert.equal(frozen.time, 0); assert.equal(frozen.gui, false); assert(frozen.interaction.pulseWeights.every(value => value === 0)); assert(await page.locator('#preview-ui').isHidden());
      result.screenshots.freeze = await shot(page, `${name}-freeze`);
      await ready(page, `${url}/?ui=0`); await page.waitForTimeout(3150); const p = await point(page, -2, 1.8); if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(70); const ui0 = await state(page); assert(await page.locator('#preview-ui').isHidden()); assert(ui0.interaction.pulseWeights.some(value => value > 0), 'ui=0 hides UI only; it must preserve interaction');
      result.checks['query-modes'] = { passed: true, frozen: frozen.interaction, ui0: ui0.interaction }; result.screenshots.ui0 = await shot(page, `${name}-ui0`);
    }
  } finally { await context.close(); }
}
try {
  if (!args.includes('--mobile-only')) await variant('desktop', { width: 1440, height: 900 }, false);
  if (!args.includes('--desktop-only') && !smoke) {
    // Release the desktop renderer, FFT heaps and encoder before the phone run.
    if (!args.includes('--mobile-only')) { await browser.close(); browser = await chromium.launch(launchOptions); }
    await variant('mobile', { width: 390, height: 844 }, true);
  }
} catch (error) { report.failure = String(error); }
finally {
  await browser.close(); report.passed = !report.failure && report.errors.length === 0 && report.variants.every(variant => Object.values(variant.checks).every(check => check.passed));
  const subset = args.includes('--mobile-only') ? '-mobile' : args.includes('--desktop-only') ? '-desktop' : '';
  const filename = path.join(out, smoke ? 'smoke.json' : only ? `checks-${only}${subset}.json` : `checks${subset}.json`); await writeFile(filename, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ file: filename, ...report }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
