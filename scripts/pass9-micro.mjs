import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, attachOpening, installProfiling, otherHeavyJobs, stats } from './pass9-harness.mjs';
const labels = process.argv.slice(2), results = {};
const browser = await launch();
try {
  for (const label of labels) {
    let done = false;
    while (!done) {
      while ((await otherHeavyJobs()).length) { console.log(`${label}: waiting for an isolated GPU window`); await new Promise(r => setTimeout(r, 3000)); }
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }), page = await context.newPage();
      await attachOpening(page);
      try {
        await page.goto(`http://localhost:4103/output/perf/${label}/index.html?freeze=1`, { waitUntil: 'domcontentloaded' }); await page.bringToFront();
        await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
        await page.evaluate(async () => { await window.__chunk.view.simulation.stormPromise; });
        await page.bringToFront();
        const conditions = await installProfiling(page);
        if (!conditions.visible || !conditions.focused || !/Iris.*Xe/i.test(conditions.gpu)) throw new Error('Invalid visible/focused Iris Xe run');
        while ((await otherHeavyJobs()).length) await page.waitForTimeout(1000);
        let contested = false;
        const monitor = setInterval(async () => { if ((await otherHeavyJobs()).length) contested = true; }, 150);
        let sample;
        try {
          sample = await page.evaluate(async () => {
            const v = window.__chunk.view, r = v.renderer, gl = r.getContext(), cpu = [], fences = [];
            r.setAnimationLoop(null); window.__p9.reset(); window.__p9.active = true;
            const start = performance.now();
            const drain = async () => { const fence = fences.shift(); gl.flush(); while (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise(resolve => setTimeout(resolve, 1)); gl.deleteSync(fence); };
            for (let i = 0; i < 48; i++) {
              const t = performance.now(); v.frame(i / 60, 1 / 60); v.draw(); cpu.push(performance.now() - t);
              fences.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)); if (fences.length >= 3) await drain();
            }
            while (fences.length) await drain(); window.__p9.active = false;
            return { wallMs: performance.now() - start, cpu, data: window.__p9.collect(), focused: document.hasFocus(), visible: !document.hidden };
          });
        } finally { clearInterval(monitor); }
        if (contested || !sample.focused || !sample.visible) { console.log(`${label}: discarded contested microbenchmark`); continue; }
        const row = { label, conditions, frames: 48, gpuCompletedMsPerFrame: sample.wallMs / 48, cpuMs: stats(sample.cpu),
          gpuPassMs: Object.fromEntries(Object.entries(sample.data.gpu).map(([k, values]) => [k, stats(values)])) };
        await mkdir(path.resolve('output/perf', label), { recursive: true });
        await writeFile(path.resolve('output/perf', label, 'micro.json'), JSON.stringify(row, null, 2)); results[label] = row; done = true;
        console.log(JSON.stringify(row));
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
