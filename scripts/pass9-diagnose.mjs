import { launch, isolateHMR } from './pass9-harness.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await launch(), out = 'output/perf/diagnose'; await mkdir(out, { recursive: true });
try {
  for (const [name, url] of [['baseline','/output/perf/baseline/index.html'],['now','/']]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); await isolateHMR(page);
    await page.goto(`http://localhost:4103${url}?freeze=1`); await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
    console.log(name, await page.evaluate(() => {const s=window.__chunk.view.simulation;return {brewing:s.brewing,lookup:s.cacheLookup,error:s.cacheLoadError};}));
    for (const mode of ['normal','no-spray','no-blur','neither']) {
      const data = await page.evaluate(async mode => { const v=window.__chunk.view; v.settings.spray=mode==='no-spray'||mode==='neither'?0:.65;v.settings.motionBlur=mode==='no-blur'||mode==='neither'?false:true;await window.__setTime(.9); return v.capture(); },mode);
      await writeFile(`${out}/${name}-${mode}.png`,Buffer.from(data.split(',')[1],'base64'));
    }
    const maps = await page.evaluate(async () => {const v=window.__chunk.view,r=v.renderer,rt=v.simulation.sim.out[0][v.simulation.sim.parity],d=new Uint16Array(256*256*4);await r.readRenderTargetPixelsAsync(rt,0,0,256,256,d);return [...d];});
    await writeFile(`${out}/${name}-map.json`, JSON.stringify(maps)); await page.close();
  }
} finally {await browser.close();}
