import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const args = process.argv.slice(2), value = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const url = value('url', 'http://localhost:4100'), stage = value('stage', 'before'), out = path.resolve(`output/playwright/float-water/${stage}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [], report = { url, stage, errors, seekDuringMotion: false, videoRecording: !args.includes('--trace-only'), segments: [] };
page.on('pageerror', error => errors.push(error.stack ?? String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
function summarise(rows) {
  const steps = rows.slice(1).map((r, i) => {
    const p = rows[i], dt = (r.wall - p.wall) / 1000, distance = Math.hypot(...r.ball.map((v, j) => v - p.ball[j]));
    return { frame: r.frame, phase: r.phase, dt, distance, speed: distance / Math.max(dt, .001), probeChanged: r.probe.receivedAt !== p.probe.receivedAt, mode: `${p.mode}->${r.mode}`, supportError: r.ball[1] - r.carrierY - .23, foamRelief: r.decorativeY };
  });
  const ordered = steps.map(s => s.dt * 1000).sort((a,b) => a-b), worst = steps.toSorted((a,b) => b.distance-a.distance).slice(0, 12);
  return { frames: rows.length, elapsedMs: rows.at(-1).wall - rows[0].wall, p95FrameMs: ordered[Math.floor(ordered.length*.95)], probeUpdates: steps.filter(s => s.probeChanged).length,
    maxFrameDistance: Math.max(...steps.map(s => s.distance)), worst, modeTransitions: steps.filter(s => s.mode.split('->')[0] !== s.mode.split('->')[1]),
    maxProbeAgeMs: Math.max(...rows.map(r => r.probeAgeMs)), cycleCrossings: rows.slice(1).filter((r,i) => r.phase < rows[i].phase).length,
    rmsSupportError: Math.sqrt(steps.reduce((sum,s) => sum+s.supportError*s.supportError,0)/steps.length) };
}
async function startSegment(name) {
  await page.evaluate(({ name, record }) => {
    const api = window.__ocean, water = api.water, canvas = api.renderer.domElement;
    window.__floatTrace = []; window.__floatSegment = name; window.__floatTracing = true;
    let recorder;
    if (record) {
    const stream = canvas.captureStream(30), mime = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(s => MediaRecorder.isTypeSupported(s));
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6500000 }); const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data.arrayBuffer()); };
    window.__floatStop = () => new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(new Error('Canvas recorder did not finalize within 15s')),15000); recorder.onerror=e=>{clearTimeout(timer);reject(new Error(String(e.error)));}; recorder.onstop = async () => { try { const buffers=await Promise.all(chunks); stream.getTracks().forEach(t => t.stop()); let binary=''; for(const buffer of buffers){const data=new Uint8Array(buffer);for(let i=0;i<data.length;i+=32768)binary += String.fromCharCode(...data.subarray(i,i+32768));} clearTimeout(timer); resolve({ video: btoa(binary), mime }); } catch(e) { clearTimeout(timer); reject(e); } }; recorder.stop(); });
    }
    let lastFrame = -1;
    function sample() {
      if (!window.__floatTracing) return;
      if (api.renderedFrames !== lastFrame) {
        lastFrame = api.renderedFrames; const s = water.sample, d = water.probeData, stride = water.probeCount*4, at = 5*stride, now = performance.now();
        const integration=window.__floatDrainIntegration();
        window.__floatTrace.push({ wall: now, frame: lastFrame, phase: water.time, speed: api.settings.timeScale, ball: api.ball.position.toArray(), velocity: api.effects.velocity.toArray(), mode: api.effects.mode, integration,
          probe: { ...s }, contact: { ...water.samples[1] }, probeAgeMs: now-s.receivedAt, fullProbeAgeMs: now-(s.sampledAt ?? s.receivedAt-water.readbackLatencyMs), phaseAge: ((water.time-s.time)%3.63+3.63)%3.63, readbackMs: water.readbackLatencyMs,
          pending: !!water.pending, requestedAt: water.requestedAt, carrierY: d[at], decorativeY: d[at+1], quadraticY: d[at+2], foam: d[at+3], localCarrierY: d[at+4],
          target: api.track.equilibrium?.toArray() ?? null, localTarget: api.effects.floatTarget?.toArray() ?? null, localWaterVelocity: api.effects.floatVelocity?.toArray() ?? null, floatDiagnostics: api.track.diagnostics?.() ?? null,
          support: api.effects.support && { y: api.effects.support.position.y, normal: api.effects.support.normal.toArray(), valid: api.effects.support.valid, ageMs: api.effects.support.ageMs }, heightfieldAtAnchor: d[6*stride], heightfieldAtContact: d[6*stride+4], heightfieldAtTap: d[6*stride+12],
          lastImpactAt: api.effects.lastImpactAt, bounceCount: api.effects.bounceCount });
      }
      requestAnimationFrame(sample);
    }
    if (recorder) recorder.start(1000); requestAnimationFrame(sample);
  }, { name, record: !args.includes('--trace-only') });
}
async function endSegment(name) {
  const data = await page.evaluate(async record => { window.__floatTracing = false; const recording = record ? await window.__floatStop() : {}; return { ...recording, rows: window.__floatTrace }; }, !args.includes('--trace-only'));
  if (data.video) await writeFile(path.join(out, `${name}.webm`), Buffer.from(data.video, 'base64'));
  await writeFile(path.join(out, `${name}-trace.json`), JSON.stringify(data.rows));
  const result = { name, ...summarise(data.rows) }; report.segments.push(result); console.log(JSON.stringify(result, null, 2));
}
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__ready, null, { timeout: 180000 }); await page.bringToFront();
  await page.waitForTimeout(4400); assert.equal(await page.evaluate(() => window.__ocean.effects.mode), 'track');
  report.evidence = await page.evaluate(() => window.__evidence());
  // Read unused rows in the existing tiny probe packet, not a full GPU map.
  await page.evaluate(async () => {
    const w = window.__ocean.water, m = w.probeMaterial;
    m.fragmentShader = m.fragmentShader.replace('uniform sampler2D uGeometry,uDz;', 'uniform sampler2D uGeometry,uDz,uTraceBase,uTraceHF,uTraceFoam,uTraceC0,uTraceC1,uTraceVisual;uniform vec2 uTraceLengths;');
    m.fragmentShader = m.fragmentShader.replace('else outColor=vec4(0.);', 'else if(row==5){float carrier=(texture(uTraceBase,uv).y+texture(uTraceHF,uv).r)*(10./uSize);float linear=texture(uTraceC0,q*(uSize/10.)/uTraceLengths.x+.5).y+texture(uTraceC1,q*(uSize/10.)/uTraceLengths.y+.5).y;outColor=vec4(carrier,texture(uTraceVisual,uv).y*(10./uSize)-carrier,(texture(uTraceBase,uv).y-linear)*(10./uSize),texture(uTraceFoam,uv).r);}else if(row==6)outColor=texture(uTraceHF,uv);else outColor=vec4(0.);');
    m.uniforms.uTraceBase = { value: w.baseGeometry.texture }; m.uniforms.uTraceHF = { value: w.interaction.texture }; m.uniforms.uTraceFoam = { value: w.history }; m.uniforms.uTraceVisual = { value: w.geometry.texture };
    m.uniforms.uTraceC0 = { value: w.cascades[0].maps.textures[0] }; m.uniforms.uTraceC1 = { value: w.cascades[1].maps.textures[0] };
    m.uniforms.uTraceLengths = { value: { x: w.parameters.cascadeLengths[0], y: w.parameters.cascadeLengths[1] } }; m.needsUpdate = true;
    const original = w.readSample.bind(w); w.readSample = function(time, wait) { m.uniforms.uTraceHF.value = w.interaction.texture; m.uniforms.uTraceFoam.value = w.history; return original(time,wait); };
    await w.readSample(w.time,true);
    // Observe, never modify, the body's own velocity at actual solver substeps.
    // Endpoint-only trapezoids are not a teleport test on a 90ms forced frame.
    const e=window.__ocean.effects,update=e.updateBall.bind(e),set=e.velocity.setComponent.bind(e.velocity);
    let samples=[],axes=0,integrated=[0,0,0],seconds=0,substeps=0;
    e.velocity.setComponent=function(axis,value){const result=set(axis,value);axes|=1<<axis;if(axes===7){samples.push(e.velocity.toArray());axes=0;}return result;};
    e.updateBall=function(...args){
      const before=e.velocity.toArray();samples=[];axes=0;update(...args);
      if(samples.length){const h=args[0]/samples.length;let prior=before;
        for(const next of samples){for(let i=0;i<3;i++)integrated[i]+=(prior[i]+next[i])*.5*h;prior=next;}
        seconds+=args[0];substeps+=samples.length;
      }
    };
    window.__floatDrainIntegration=()=>{const result={velocityIntegral:integrated,seconds,substeps};integrated=[0,0,0];seconds=0;substeps=0;return result;};
  });
  await page.waitForTimeout(350);
  await startSegment('idle'); await page.waitForTimeout(4*3630); await endSegment('idle');
  await startSegment('throw');
  const ball = await page.evaluate(() => window.__evidence().ballScreen);
  await page.mouse.move(ball[0]*1280,ball[1]*720); await page.mouse.down(); await page.waitForTimeout(140);
  assert.equal(await page.evaluate(() => window.__ocean.effects.mode), 'held');
  for(let i=1;i<=12;i++){await page.mouse.move(ball[0]*1280+95*i/12,ball[1]*720-75*i/12);await page.waitForTimeout(18);}
  await page.mouse.up(); await page.mouse.move(20,700); await page.waitForTimeout(8500); await endSegment('throw');
  if (args.includes('--seam')) {
    await page.evaluate(() => { const h=window.__ocean.water.interaction, original=h.reset.bind(h); window.__floatResets=0; h.reset=()=>{window.__floatResets++;original();}; });
    await startSegment('tap-seam');
    await page.waitForFunction(() => window.__ocean.water.time>3.18 && window.__ocean.water.time<3.35);
    const target=await page.evaluate(async()=>{const a=window.__ocean,s=await a.surface.samplePoint(-1.7,1.4),p=s.position.applyMatrix4(a.sheetRoot.matrixWorld).project(a.camera);return{x:(p.x+1)*640,y:(1-p.y)*360,before:a.water.interaction.impulses};});
    await page.mouse.click(target.x,target.y);
    await page.waitForFunction(n=>window.__ocean.water.interaction.impulses>n,target.before);
    await page.evaluate(()=>{const a=window.__ocean,p=a.impacts.reduce((best,p)=>p.z>best.z?p:best);a.water.setProbe(3,p.x,p.y);});
    await page.waitForTimeout(1350);await endSegment('tap-seam');
    report.seam=await page.evaluate(()=>({resets:window.__floatResets,impulses:window.__ocean.water.interaction.impulses,phase:window.__ocean.water.time}));
    assert.equal(report.seam.resets,0,'No heightfield reset across the live loop boundary');
  }
  await page.screenshot({ path: path.join(out,'live.png') });
  assert.equal(await page.evaluate(() => window.__ocean.effects.mode),'track'); assert.deepEqual(errors,[]);
} catch(error) { report.failure = String(error); process.exitCode=1; await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{}); }
finally { await browser.close(); await writeFile(path.join(out,'checks.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify({out,failure:report.failure,errors},null,2)); }
