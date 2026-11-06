import { chromium } from 'playwright';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const launch = () => chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
export async function otherHeavyJobs() {
  const dir = 'C:/Users/Serik/AppData/Local/agent-tools/entries';
  const entries = await Promise.all((await readdir(dir)).filter(f => f.endsWith('.json')).map(async f => { try { return JSON.parse(await readFile(path.join(dir, f), 'utf8')); } catch { return null; } }));
  return entries.filter(e => e?.kind === 'job' && !e.cmd.includes('pass9-perf.mjs') && !e.cmd.includes('pass9-micro.mjs'));
}
export function stats(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return { samples: 0 };
  return { samples: a.length, mean: a.reduce((x, y) => x + y, 0) / a.length, p50: a[Math.floor(a.length * .5)], p95: a[Math.floor(a.length * .95)], max: a.at(-1) };
}
export async function isolateHMR(page) {
  await page.routeWebSocket('**/*', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      let payload; try { payload = JSON.parse(String(message)); } catch { /* binary */ }
      if (!['full-reload', 'update'].includes(payload?.type)) socket.send(message);
    });
  });
}
export async function attachOpening(page) {
  await isolateHMR(page);
  await page.addInitScript(() => {
    const p = window.__p9 = { revealedAt: null, longTasks: [], firstFrames: [], firstCpu: [], frames: [], cpu: [], active: false, focusLost: 0 };
    new PerformanceObserver(list => { for (const e of list.getEntries()) p.longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
    const raf = window.requestAnimationFrame.bind(window); let last = null;
    window.requestAnimationFrame = callback => raf(t => {
      const before = window.__chunk?.view.frames, begin = performance.now(); callback(t); const cpu = performance.now() - begin;
      if (window.__ready && p.revealedAt === null) p.revealedAt = performance.now();
      if (window.__chunk?.view.frames === before || !window.__ready) return;
      if (last !== null) {
        const delta = t - last;
        if (t - p.revealedAt <= 10000) { p.firstFrames.push(delta); p.firstCpu.push(cpu); }
        if (p.active) { p.frames.push(delta); p.cpu.push(cpu); if (document.hidden || !document.hasFocus()) p.focusLost++; }
      }
      last = t;
    });
  });
}
export async function installProfiling(page) {
  return page.evaluate(() => {
    const v = window.__chunk.view, r = v.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const perf = window.__p9, pending = [], pool = [], samples = {}, latency = [], cpuPasses = {}, sampledFrames = new Set();
    let active = false, frame = 0;
    if (ext) for (let i = 0; i < 128; i++) pool.push(gl.createQuery());
    function timed(name, fn) {
      const start = performance.now();
      if (!perf.active || active || !ext || frame % 3 || !pool.length) { const value = fn(); if (perf.active) (cpuPasses[name] ??= []).push(performance.now() - start); return value; }
      const q = pool.pop(); active = true; gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      try { return fn(); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ q, name, frame }); active = false; (cpuPasses[name] ??= []).push(performance.now() - start); }
    }
    function poll() {
      if (!ext) return;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      for (let i = pending.length - 1; i >= 0; i--) {
        const item = pending[i]; if (!gl.getQueryParameter(item.q, gl.QUERY_RESULT_AVAILABLE)) continue;
        if (!disjoint) { const s = samples[item.name] ??= {}; s[item.frame] = (s[item.frame] ?? 0) + gl.getQueryParameter(item.q, gl.QUERY_RESULT) / 1e6; }
        pool.push(item.q); pending.splice(i, 1);
      }
    }
    function wrap(object, key, name) { const old = object[key]; object[key] = function (...args) { return timed(name, () => old.apply(this, args)); }; }
    wrap(v.simulation, 'evolve', 'simulation'); wrap(v.simulation, 'savePrevious', 'history copies');
    if (v.simulation.saveRipple) wrap(v.simulation, 'saveRipple', 'history copies');
    wrap(v.simulation.interaction, 'step', 'ripples');
    wrap(v.access, 'update', 'access'); wrap(v.access, 'savePrevious', 'access');
    wrap(v.cinematic, 'render', 'cinematic'); wrap(v.postFX, 'render', 'PostFX');
    const render = r.render;
    r.render = function (...args) {
      const target = r.getRenderTarget();
      const name = target === v.opaque ? 'opaque' : target === v.hdr ? (args[0] === v.quad?.mesh ? 'restore' : v.top.visible ? 'water' : 'opaque') : target === v.velocity ? 'velocity' : null;
      return name ? timed(name, () => render.apply(r, args)) : render.apply(r, args);
    };
    if (v.resolveRefraction) wrap(v, 'resolveRefraction', 'restore');
    if (v.depthPrepass) wrap(v, 'depthPrepass', 'depth prepass');
    const accessRead = v.access.read;
    v.access.read = function (...args) {
      const start = performance.now(), promise = timed('readbacks', () => accessRead.apply(this, args));
      if (perf.active && promise?.then) promise.then(() => latency.push(performance.now() - start)); return promise;
    };
    const frameFn = v.frame;
    v.frame = function (...args) { frame++; poll(); if (perf.active && !(frame % 3)) sampledFrames.add(frame); return frameFn.apply(this, args); };
    perf.collect = () => { poll(); const completed=[...sampledFrames].filter(id=>!pending.some(p=>p.frame===id)); return { gpuAvailable: !!ext, gpu: Object.fromEntries(Object.entries(samples).map(([k, values]) => [k, completed.map(id=>values[id]??0)])), cpuPasses, readbackLatency: latency, frames: perf.frames, cpu: perf.cpu, focusLost: perf.focusLost }; };
    perf.reset = () => { for (const k of Object.keys(samples)) delete samples[k]; for (const k of Object.keys(cpuPasses)) delete cpuPasses[k]; sampledFrames.clear(); latency.length = 0; perf.frames.length = perf.cpu.length = 0; perf.focusLost = 0; };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), gpuTimer: !!ext, visible: !document.hidden, focused: document.hasFocus(), canvas: [r.domElement.width, r.domElement.height], dpr: r.getPixelRatio() };
  });
}
export async function goldenSet(label) {
  const out = path.resolve('output/perf', label); await mkdir(path.join(out, 'frames'), { recursive: true });
  const browser = await launch(), page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await isolateHMR(page);
    await page.goto('http://localhost:4103/?freeze=1', { waitUntil: 'domcontentloaded' }); await page.bringToFront();
    await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
    const evidence = await page.evaluate(() => window.__chunk.evidence());
    console.log(`${label}: ready, exact cache ${!!evidence.brewing?.loadedExactCache}`);
    for (const t of [0, .9, 1.8, 2.7]) {
      const data = await page.evaluate(async t => { await window.__setTime(t); return window.__chunk.view.capture(); }, t);
      await writeFile(path.join(out, `hd-${t.toFixed(1)}.png`), Buffer.from(data.split(',')[1], 'base64'));
    }
    await page.setViewportSize({ width: 1280, height: 720 }); await page.evaluate(() => window.__chunk.resize(1280, 720));
    for (let i = 0; i < 121; i++) {
      const data = await page.evaluate(async i => { await window.__setTime(i * .03); return window.__chunk.view.capture(); }, i);
      await writeFile(path.join(out, 'frames', `${String(i).padStart(3, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
      if (i % 30 === 0) console.log(`${label}: golden ${i}/121`);
    }
    const paused = await page.evaluate(async () => { await window.__setTime(1.35); window.__chunk.pause(); return window.__chunk.view.capture(); });
    await writeFile(path.join(out, 'paused.png'), Buffer.from(paused.split(',')[1], 'base64'));
    if (errors.length) throw new Error(errors.join('\n'));
    await writeFile(path.join(out, 'golden.json'), JSON.stringify({ label, complete: true, hdTimes: [0, .9, 1.8, 2.7], loopFrames: 121, loopSize: [1280, 720], pausedTime: 1.35, evidence, errors }, null, 2));
  } finally { await browser.close(); }
}
