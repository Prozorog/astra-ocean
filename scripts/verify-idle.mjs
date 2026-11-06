import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const root=process.argv.find(v=>/^http/.test(v))??'http://localhost:4100',out='output/playwright/float-water/idle';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:!process.argv.includes('--headed'),args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const report={url:root,errors:[],samples:[],noSeek:true};
try{
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const field=()=>page.evaluate(()=>{
    const{water,renderer,impacts,effects}=window.__ocean,previous=renderer.getRenderTarget();water.copyFoam.uniforms.uHistory.value=water.interaction.texture;water.pass.draw(water.copyFoam,water.diagnosticTarget);renderer.readRenderTargetPixels(water.diagnosticTarget,0,0,256,256,water.heights);renderer.setRenderTarget(previous);
    let maximum=0,squares=0,nonfinite=0;for(let i=0;i<water.heights.length;i+=4){const h=water.heights[i];maximum=Math.max(maximum,Math.abs(h));squares+=h*h;if(!Number.isFinite(h))nonfinite++;}
    return{clock:performance.now()/1000,frame:window.__ocean.renderedFrames,weights:impacts.map(p=>p.w),maximumHeightMetres:maximum,rmsMetres:Math.sqrt(squares/65536),nonfinite,grid:[256,256],phase:water.time,spherePushes:water.interaction.spherePushes,physicalRadius:water.interaction.radius,mode:effects.mode,lastImpactAt:effects.inspect(performance.now()/1000).lastImpactAt};
  });
  await page.goto(root,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready,null,{timeout:180000});
  await page.waitForFunction(()=>{const a=window.__ocean;return !a.introActive&&a.effects.mode==='track'&&a.impacts.every(p=>p.w===0);});
  report.samples.push(await field());
  for(let cycle=0;cycle<3;cycle++){await page.waitForTimeout(3630);report.samples.push(await field());}
  const first=report.samples[0],last=report.samples.at(-1),radius=last.physicalRadius;
  // A freely floating, moving sphere continues displacing water. The obsolete
  // "zero new sphere pushes" assertion required the removed kinematic guard.
  // Check bounded, near-periodic wake energy instead, plus no ghost impacts.
  report.criterion='Live free-floating coupling remains active and bounded over three cycles; no spontaneous splash events or timed heightfield reset.';
  assert.deepEqual(report.errors,[]);assert(last.frame>first.frame);assert(last.spherePushes>first.spherePushes,'Do not disable displacement to hide jitter');
  assert(report.samples.every(s=>s.mode==='track'&&s.nonfinite===0&&s.weights.every(w=>w===0)&&s.lastImpactAt===first.lastImpactAt),'No idle ghost impacts or nonfinite state');
  assert(report.samples.every(s=>s.rmsMetres<radius*.2),'Background wake must remain small relative to the physical sphere');
  assert(last.rmsMetres<=Math.max(first.rmsMetres,report.samples[1].rmsMetres)*1.5+radius*.02,'No growing self-excited idle wake');
  await page.screenshot({path:`${out}/idle-live.png`});
  await page.goto(`${root}/?t=0&freeze=1`);await page.waitForFunction(()=>window.__ready,null,{timeout:180000});assert(await page.evaluate(()=>window.__ocean.impacts.every(p=>p.w===0)));
  report.passed=true;
}catch(error){report.passed=false;report.failure=String(error);process.exitCode=1;}
finally{await browser.close();await writeFile(`${out}/idle.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
