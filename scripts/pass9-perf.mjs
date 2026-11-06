import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launch, attachOpening, installProfiling, otherHeavyJobs, stats } from './pass9-harness.mjs';
const label = process.argv[2] ?? 'baseline', out = path.resolve('output/perf', label), url = process.argv[3] ?? 'http://localhost:4103/'; await mkdir(out, { recursive: true });
const report = { label, runConditions: 'Visible focused window, Iris Xe, other heavy slot idle', resolutions: [], errors: [] };
const browser = await launch();
async function idle() { while ((await otherHeavyJobs()).length) { console.log('Waiting for the other heavy slot to be idle'); await new Promise(r => setTimeout(r, 5000)); } }
async function gesture(page, index) {
  if ([0, 1, 2, 5, 6].includes(index)) {
    const fraction = ({ 0: .25, 1: .66, 2: 1, 5: .45, 6: .66 })[index];
    await page.evaluate(f => { const input = document.querySelector('[aria-label="Storm level"]'); input.value = String(Number(input.min) + (Number(input.max) - Number(input.min)) * f); input.dispatchEvent(new Event('input', { bubbles: true })); }, fraction);
  } else if (index === 3) {
    const p = await page.evaluate(() => { const a = window.__chunk, p = a.ball.getWorldPosition(a.view.ballWorld.clone()).project(a.camera); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; });
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 80, p.y - 60, { steps: 8 }); await page.mouse.up();
  } else if (index === 4) {
    await page.mouse.move(90, 170); await page.mouse.down(); await page.mouse.move(240, 220, { steps: 12 }); await page.mouse.up();
  }
}
try {
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    let accepted = false;
    while (!accepted) {
      await idle(); const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 }), page = await context.newPage();
      page.on('pageerror', e => report.errors.push(String(e))); await attachOpening(page);
      let contested = false; const monitor = setInterval(async () => { if ((await otherHeavyJobs()).length) contested = true; }, 700);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.bringToFront();
        await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
        await page.waitForTimeout(10000);
        const opening = await page.evaluate(() => ({ firstFrameMs: window.__p9.revealedAt, longestTaskMs: Math.max(0, ...window.__p9.longTasks.filter(e => e.start < window.__p9.revealedAt).map(e => e.duration)), first10Frames: window.__p9.firstFrames, first10Cpu: window.__p9.firstCpu, loadingTasks: window.__p9.longTasks }));
        const conditions = await installProfiling(page); assert.match(conditions.gpu, /Iris.*Xe/i); assert.ok(conditions.gpuTimer); assert.ok(conditions.visible && conditions.focused);
        await page.evaluate(() => { window.__p9.reset(); window.__p9.active = true; });
        const start = performance.now();
        for (let i = 0; i < 7; i++) { await page.waitForTimeout(Math.max(0, start + (i + 1) * 2400 - performance.now())); await gesture(page, i); }
        await page.waitForTimeout(Math.max(0, start + 20000 - performance.now()));
        const data = await page.evaluate(() => { window.__p9.active = false; return window.__p9.collect(); });
        if (contested || data.focusLost) { console.log(`Discarding contested/background run at ${width}x${height}`); continue; }
        const frame = stats(data.frames);
        const row = { width, height, conditions, opening: { ...opening, first10Frames: stats(opening.first10Frames), first10Cpu: stats(opening.first10Cpu) },
          running: { fps: 1000 / frame.mean, frameMs: frame, cpuMs: stats(data.cpu), gpuPassMs: Object.fromEntries(Object.entries(data.gpu).map(([k, v]) => [k, stats(v)])), cpuPassMs: Object.fromEntries(Object.entries(data.cpuPasses).map(([k, v]) => [k, stats(v)])), readbackLatencyMs: stats(data.readbackLatency) } };
        report.resolutions.push(row); accepted = true; console.log(JSON.stringify({ label, width, height, openingMs: opening.firstFrameMs, longestTask: opening.longestTaskMs, fps: row.running.fps, frames: frame, gpu: row.running.gpuPassMs }));
        await writeFile(path.join(out, 'performance.json'), JSON.stringify(report, null, 2));
      } finally { clearInterval(monitor); await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []); report.complete = true;
} finally { await browser.close(); await writeFile(path.join(out, 'performance.json'), JSON.stringify(report, null, 2)); }
