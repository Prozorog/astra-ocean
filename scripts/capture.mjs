import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { verifyBackfaces, verifyMath } from './verify-math.mjs';
import { measureFrame, measureVariance } from './measure-frame.mjs';

const args = process.argv.slice(2), url = args.find(value => /^http/.test(value)) ?? 'http://localhost:4103';
const headed = args.includes('--headed'), probe = args.includes('--probe'), performanceOnly = args.includes('--performance-only');
const out = path.resolve('output/playwright'), motion = path.join(out, 'motion-render');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: !headed, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.stack || String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const report = { url, headed, errors, frames: [], motion: [], math: null, backfaces: null, interaction: {}, performance: null };
async function saveMasks(evidence, stem) {
  for (const field of ['waterMask', 'shadowMask', 'ballMask', 'distanceMask', 'positionMask']) {
    if (evidence[field]) await writeFile(path.join(out, `${stem}-${field}.png`), Buffer.from(evidence[field].split(',')[1], 'base64'));
    delete evidence[field];
  }
}
try {
  await page.goto(`${url}/?t=0&freeze=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  if (!performanceOnly) {
    for (const time of probe ? [0] : [0, .6, 1.2, 1.8, 2.4, 3, 3.63]) {
      await page.evaluate(async t => { document.querySelector('canvas').blur(); await window.__setTime(t); }, time);
      const filename = `ocean-${time.toFixed(2).replace('.', '-')}.png`;
      await page.screenshot({ path: path.join(out, filename), animations: 'disabled' });
      const evidence = await measureFrame(page, true); await saveMasks(evidence, filename.slice(0, -4));
      report.frames.push({ requestedTime: time, filename, ...evidence, variance: await measureVariance(page) });
    }
    if (!probe) {
      await page.evaluate(() => {
        const api = window.__ocean, parts = [api.top, api.lip, api.ball];
        const visible = parts.map(part => part.visible), strength = api.settings.shadow, bloom = api.post.bloom.enabled, gain = api.post.output.uniforms.uBloom.value;
        parts.forEach(part => { part.visible = false; }); api.floor.material.uniforms.uShadowStrength.value = 0; api.post.bloom.enabled = false;
        api.post.output.uniforms.uBloom.value = 0;
        api.post.render();
        window.__floorCalibrationRestore = () => {
          parts.forEach((part, i) => { part.visible = visible[i]; }); api.floor.material.uniforms.uShadowStrength.value = strength;
          api.post.bloom.enabled = bloom; api.post.output.uniforms.uBloom.value = gain; return window.__setTime(0);
        };
      });
      await page.screenshot({ path: path.join(out, 'floor-centre.png') });
      await page.evaluate(async () => { await window.__floorCalibrationRestore(); delete window.__floorCalibrationRestore; });
      report.math = await verifyMath(page); report.backfaces = await verifyBackfaces(page);
      if (!report.backfaces.passed) throw new Error(`Back-face hard check failed: ${JSON.stringify(report.backfaces)}`);
      report.interaction.captureModeLocksUI = await page.evaluate(() => document.querySelector('#preview-ui').hidden && !window.__ocean.controls.enabled);
      report.interaction.liveChecks = 'scripts/preview-checks.mjs';
      const modes = ['Beauty', 'Normals', 'Height', 'Jacobian / foam', 'Aeration mask', 'Back-face (red)', 'Shadow mask', 'Ball-light only',
        'C0 only', 'C1 only', 'C2 only', 'Reflection only', 'Scatter only', 'Sun spec only'];
      report.interaction.debugViews = [];
      for (let i = 0; i < modes.length; i++) {
        await page.evaluate(async mode => { window.__ocean.settings.debug = mode; await window.__setTime(0); }, modes[i]);
        report.interaction.debugViews.push({ mode: modes[i], selected: await page.evaluate(() => window.__ocean.settings.debug) });
        await page.screenshot({ path: path.join(out, `debug-${i}.png`) });
      }
      await page.evaluate(async () => { window.__ocean.settings.debug = 'Beauty'; await window.__setTime(0); });
      await mkdir(motion, { recursive: true });
      for (let i = 0; i < 121; i++) {
        const time = i * .03; await page.evaluate(t => window.__setTime(t), time);
        await page.screenshot({ path: path.join(motion, `frame-${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 94 });
        const evidence = await measureFrame(page, false); report.motion.push({ frame: i, ...evidence });
      }
      report.minimumBallVisibleFraction = Math.min(...report.motion.map(frame => frame.ballVisibleFraction));
      report.minimumBallVisibleFrame = report.motion.reduce((a, b) => a.ballVisibleFraction < b.ballVisibleFraction ? a : b).frame;
    }
  }
  if (headed && !probe) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => { window.__ocean.settings.debug = 'Beauty'; window.__ocean.setScale(1); window.__play(); });
    await page.waitForTimeout(2500);
    const device = await page.evaluate(() => window.__evidence());
    if (!/swiftshader|llvmpipe|software|basic render/i.test(device.renderer)) {
      const queueBefore = execFileSync('cmd.exe', ['/d', '/s', '/c', 'agent-tools status'], { encoding: 'utf8' });
      await page.evaluate(() => window.__ocean.timings.reset());
      const performance = await page.evaluate(() => new Promise(resolve => {
        const start = performance.now(), firstFrame = window.__ocean.renderedFrames;
        const tick = () => {
          const now = performance.now();
          if (now - start < 12000) requestAnimationFrame(tick);
          else {
            const evidence = window.__evidence(), frames = window.__ocean.renderedFrames - firstFrame, durations = evidence.frameTimes.slice(-frames);
            resolve({ frames, elapsed: now - start, fps: frames * 1000 / (now - start),
              meanMs: durations.reduce((a, b) => a + b, 0) / durations.length, p95Ms: durations.toSorted((a, b) => a - b)[Math.floor(durations.length * .95)],
              dpr: evidence.dpr, renderScale: evidence.renderScale, gpu: evidence.gpu, measurement: 'Actual rendered frames; empty RAF callbacks excluded.' });
          }
        }; requestAnimationFrame(tick);
      }));
      const queueAfter = execFileSync('cmd.exe', ['/d', '/s', '/c', 'agent-tools status'], { encoding: 'utf8' });
      const queueIdle = [queueBefore, queueAfter].every(snapshot => snapshot.split(/\r?\n/).filter(line => line.startsWith('job "')).length === 1);
      report.performance = { valid: queueIdle, queueIdle,
        reason: queueIdle ? undefined : 'Other heavy work overlapped the timing window; not idle-queue FPS evidence.',
        renderer: device.renderer, width: 1920, height: 1080, queueBefore, queueAfter, ...performance };
      await page.evaluate(async () => { document.querySelector('canvas').blur(); await window.__setTime(0); });
      await page.screenshot({ path: path.join(out, 'headed-1080p.png') });
    } else report.performance = { valid: false, reason: 'Software renderer: not a hardware FPS measurement.', renderer: device.renderer };
  } else report.performance = { valid: false, reason: 'Headless frozen captures only; no FPS claim.' };
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally {
  const filename = performanceOnly ? 'performance.json' : probe ? 'probe.json' : 'evidence.json';
  await writeFile(path.join(out, filename), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ file: path.join(out, filename), errors, failure: report.failure, math: report.math, backfaces: report.backfaces,
    frames: report.frames.map(frame => ({ time: frame.requestedTime, width: frame.bounds.width, aeration: frame.aerationCoverage, glints: frame.glintPixels, ballVisible: frame.ballVisibleFraction, orangeRadius: frame.orangeRadiusDiameters })),
    minimumBallVisibleFraction: report.minimumBallVisibleFraction, minimumBallVisibleFrame: report.minimumBallVisibleFrame,
    interaction: report.interaction, performance: report.performance }, null, 2));
  if (errors.length) process.exitCode = 1;
  await browser.close();
}
