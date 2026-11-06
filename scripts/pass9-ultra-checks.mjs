import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { launch, isolateHMR } from './pass9-harness.mjs';
import { checkSettings } from './pass10-settings-checks.mjs';
const root='output/playwright/pass9';
async function ready(page,url){await page.goto(url,{waitUntil:'domcontentloaded'});await page.bringToFront();await page.waitForFunction(()=>window.__ready,null,{timeout:240000});}
function errorsOf(page){const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});return errors;}
async function save(name,report){await mkdir(root,{recursive:true});await writeFile(`${root}/${name}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({name,pass:report.pass,failure:report.failure,errors:report.errors}));if(!report.pass)process.exitCode=1;}
export async function runSurface(url){
  const browser=await launch(),page=await browser.newPage({viewport:{width:1280,height:720}}),report={errors:errorsOf(page),anchors:[]};
  try{
    await isolateHMR(page);await ready(page,`${url}/?freeze=1`);await page.evaluate(()=>window.__chunk.view.simulation.buildStorm());
    for(const level of [1,1.375]){
      const row=await page.evaluate(async level=>{
        const a=window.__chunk,v=a.view,r=v.renderer; a.setStorm(level,true);const rows=[];
        for(const t of [0,.6,1.2,1.8,2.4,3,3.6]){
          await a.setTime(t);const actual=new Float32Array(4);await r.readRenderTargetPixelsAsync(v.access.target,0,0,1,1,actual);
          const expected=[0,0,0],half=new Uint16Array(4),halfToFloat=n=>{const s=n>>15?-1:1,e=(n>>10)&31,f=n&1023;return s*(e?2**(e-15)*(1+f/1024):2**-14*f/1024);};
          // Independent bilinear reconstruction at material coordinate (0,0),
          // from the four wrapped corner texels of each current FFT output.
          for(const pair of v.simulation.sim.out.slice(0,3))for(const [x,y]of [[0,0],[255,0],[0,255],[255,255]]){
            await r.readRenderTargetPixelsAsync(pair[v.simulation.sim.parity],x,y,1,1,half);
            for(let c=0;c<3;c++)expected[c]+=halfToFloat(half[c])/32;
          }
          const n=v.access.samples[0],error=Math.hypot(...expected.map((n,i)=>n-actual[i]));
          rows.push({t,error,point:[...actual.slice(0,3)],normalLength:Math.hypot(n.nx,n.ny,n.nz)});
        }
        return {level,rows,vertices:v.top.geometry.attributes.position.count,cascades:v.simulation.sim.out.length,cascadeSize:v.simulation.sim.out[0][0].width,msaa:v.hdr.samples,gpuBall:v.ball.material.uniforms.uBallState.value===v.access.target.textures[0],gain:v.simulation.sim.params.heightGain};
      },level);
      assert.equal(row.vertices,512*512);assert.equal(row.cascades,4);assert.equal(row.cascadeSize,256);assert.equal(row.msaa,4);assert(row.gpuBall);assert(row.rows.every(r=>r.error<1e-5&&Math.abs(r.normalLength-1)<1e-5));report.anchors.push(row);
    }
    report.sphere=await page.evaluate(async()=>{
      const a=window.__chunk,v=a.view,h=v.simulation.interaction;a.setStorm(1,true);await a.setTime(0);
      const read=async()=>{v.access.probes[1].set(.9,0,0,0);v.access.update(0);await v.access.read(true);return{center:v.access.samples[0].y,rim:v.access.samples[1].y};};
      const before=await read();h.sphere(0,0,h.radius*3);h.step(h.stepSeconds);h.sphere(0,0,h.radius*.4);h.step(h.stepSeconds);v.surface.uniforms.uRipple.value=h.texture;
      const after=await read();await a.setTime(0);return {depression:before.center-after.center,rimChange:Math.abs(before.rim-after.rim),pushes:h.spherePushes};
    });
    assert(report.sphere.depression>.1&&report.sphere.rimChange<.002&&report.sphere.pushes>0);
    report.floatIntegration=await page.evaluate(async()=>{
      const {advanceFloat}=await import('/src/buoyancy.ts'),T=await import('/node_modules/three/build/three.module.js');const rows=[];
      for(const fps of [30,60,120])for(const speed of [.25,.5,1,2]){const p=new T.Vector3(.8,-.4,.6),v=new T.Vector3(-.7,1.2,.3),target=new T.Vector3(),flow=new T.Vector3(.4,-.3,.25),history={position:new T.Vector3(),velocity:flow.clone()};let elapsed=0;
        while(elapsed<2-1e-12){const dt=Math.min(speed/fps,2-elapsed);elapsed+=dt;target.copy(flow).multiplyScalar(elapsed);advanceFloat(p,v,target,flow,dt,history);history.position.copy(target);history.velocity.copy(flow);}rows.push({fps,speed,p:p.toArray(),v:v.toArray()});}
      return {rows,maxPositionDifference:Math.max(...rows.map(r=>Math.hypot(...r.p.map((n,i)=>n-rows[0].p[i])))),maxVelocityDifference:Math.max(...rows.map(r=>Math.hypot(...r.v.map((n,i)=>n-rows[0].v[i]))))};
    });assert(report.floatIntegration.maxPositionDifference<1e-8&&report.floatIntegration.maxVelocityDifference<1e-8);
    assert.deepEqual(report.errors,[]);report.pass=true;
  }catch(e){report.failure=String(e);report.pass=false;}finally{await browser.close();await save('float-surface-checks',report);}
}
async function point(page,x,z){return page.evaluate(async({x,z})=>{const a=window.__chunk,p=(await a.surface.samplePoint(x,z,false)).position.applyMatrix4(a.sheetRoot.matrixWorld).project(a.camera);return{x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};},{x,z});}
async function ballPoint(page){return page.evaluate(async()=>{const a=window.__chunk;await a.surface.read(true);a.view.updateBallMetadata();const p=a.ball.getWorldPosition(a.view.ballWorld.clone()).project(a.camera);return{x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};});}
async function drag(page,start,end,mobile){
  if(mobile){const c=await page.context().newCDPSession(page);await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});await page.waitForTimeout(80);for(let i=1;i<=8;i++){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/8,y:start.y+(end.y-start.y)*i/8,id:1}]});await page.waitForTimeout(24);}await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await c.detach();}
  else {await page.mouse.move(start.x,start.y);await page.mouse.down();await page.waitForTimeout(80);await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();}
}
export async function runPreview(url,args=[]){
  // Native tab visibility is part of this check; benchmark anti-throttling
  // switches deliberately do not apply to the Settings background-tab test.
  const browser=await chromium.launch({headless:false,ignoreDefaultArgs:['--disable-backgrounding-occluded-windows','--disable-background-timer-throttling','--disable-renderer-backgrounding'],args:['--ignore-gpu-blocklist']}),report={errors:[],variants:[]};
  const only=args.find(a=>a.startsWith('--only='))?.slice(7);
  try{
    for(const mobile of args.includes('--desktop-only')?[false]:args.includes('--mobile-only')?[true]:[false,true]){
      const name=mobile?'mobile':'desktop',viewport=mobile?{width:390,height:844}:{width:1440,height:900};
      const context=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:mobile,isMobile:mobile,acceptDownloads:true}),page=await context.newPage();await isolateHMR(page);const errors=errorsOf(page);const row={name,checks:{}};report.variants.push(row);
      const check=async(name,fn)=>{if(only&&only!==name)return;try{row.checks[name]={pass:true,...await fn()};}catch(e){row.checks[name]={pass:false,error:String(e)};await page.screenshot({path:`${root}/${mobile?'mobile':'desktop'}-${name}-failed.png`});}console.log(`${name}: ${row.checks[name].pass?'passed':row.checks[name].error}`);};
      await mkdir(root,{recursive:true});
      try{
        await ready(page,url);await page.evaluate(()=>window.__chunk.view.simulation.buildStorm());
        await check('opening-and-idle',async()=>{const data=await page.evaluate(()=>{const a=window.__chunk;a.pause();a.resetView();return{choices:a.choices,level:a.evidence().stormTarget,preserve:a.renderer.getContext().getContextAttributes().preserveDrawingBuffer};});await page.waitForTimeout(300);const first=await page.evaluate(()=>window.__chunk.view.frames);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.__chunk.view.frames),first);assert.equal(data.level,1);assert.deepEqual(data.choices,{version:1,main:5,storm:3});assert.equal(data.preserve,false);assert(await page.getByRole('button',{name:'Settings',exact:true}).count());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);return data;});
        await check('help',async()=>{await page.mouse.move(viewport.width/2,viewport.height-35);await page.waitForTimeout(100);await page.getByRole('button',{name:'Show shortcuts'}).click();assert((await page.locator('dialog').innerText()).includes('Wave look settings'));await page.getByRole('button',{name:'Close shortcuts'}).click();return{};});
        await check('storm-control',async()=>{
          await page.locator('[aria-label="Storm level"]').evaluate(e=>{e.value=e.max;e.dispatchEvent(new Event('input',{bubbles:true}));});
          await page.waitForFunction(()=>window.__chunk.view.simulation.morph===1&&window.__chunk.view.simulation.replayWeight===1,null,{timeout:10000});
          const storm=await page.evaluate(()=>({gain:window.__chunk.view.simulation.sim.params.heightGain,level:window.__chunk.evidence().stormTarget,readout:document.querySelector('.storm-readout').textContent}));assert.equal(storm.gain,1.35);assert.equal(storm.level,1.375);assert.equal(storm.readout,'Storm');
          await page.locator('[aria-label="Storm level"]').evaluate(e=>{e.value='1';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('canvas').focus();await page.keyboard.press(']');assert.equal(await page.evaluate(()=>window.__chunk.evidence().stormTarget),1.075);await page.keyboard.press('[');assert.equal(await page.evaluate(()=>window.__chunk.evidence().stormTarget),1);
          await page.mouse.move(viewport.width*.9,viewport.height*.45);await page.mouse.wheel(0,-100);assert((await page.evaluate(()=>window.__chunk.evidence().stormTarget))>1);await page.evaluate(()=>window.__chunk.setStorm(1,true));return storm;
        });
        await check('tap',async()=>{const p=await point(page,2.4,1.7),before=await page.evaluate(()=>window.__chunk.water.interaction.impulses);if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);await page.waitForFunction(n=>window.__chunk.water.interaction.impulses>n,before);return {impulses:await page.evaluate(()=>window.__chunk.water.interaction.impulses)};});
        await check('grab-throw-splash',async()=>{await page.evaluate(()=>{window.__chunk.pause();window.__chunk.effects.reset();});const p=await ballPoint(page);await drag(page,p,{x:p.x+35,y:p.y-45},mobile);await page.waitForFunction(()=>['flying','bobbing'].includes(window.__chunk.effects.mode));await page.evaluate(()=>window.__chunk.play());await page.waitForFunction(()=>window.__chunk.effects.bounceCount>0,null,{timeout:15000});const state=await page.evaluate(()=>window.__chunk.evidence().interaction);assert(state.droplets>0||state.bounceCount>0);return state;});
        await check('orbit',async()=>{await page.evaluate(()=>window.__chunk.effects.reset());const before=await page.evaluate(()=>window.__chunk.camera.position.toArray());await drag(page,{x:40,y:150},{x:mobile?90:180,y:210},mobile);const after=await page.evaluate(()=>window.__chunk.camera.position.toArray());assert(Math.hypot(...before.map((n,i)=>n-after[i]))>.01);return{before,after};});
        if(!mobile)await check('snapshot-and-record',async()=>{
          await page.evaluate(async()=>{await window.__chunk.setTime(.9);window.__chunk.play();});let download=page.waitForEvent('download',{timeout:30000});await page.evaluate(()=>window.__chunk.capture.snapshot());let file=await download;const png=`${root}/snapshot.png`;await file.saveAs(png);const bytes=await readFile(png);assert.equal(bytes.readUInt32BE(16),viewport.width*2);assert.equal(bytes.readUInt32BE(20),viewport.height*2);
          const before=await page.evaluate(()=>({time:window.__chunk.view.time,impulses:window.__chunk.water.interaction.impulses}));download=page.waitForEvent('download',{timeout:30000});await page.evaluate(()=>window.__chunk.capture.record());file=await download;await file.saveAs(`${root}/recorded-loop.webm`);const after=await page.evaluate(()=>({time:window.__chunk.view.time,impulses:window.__chunk.water.interaction.impulses}));assert.equal(before.impulses,after.impulses);return{snapshot:[viewport.width*2,viewport.height*2],before,after,bytes:(await readFile(`${root}/recorded-loop.webm`)).length};
        });
        await check('settings-round-trip',async()=>{
          return checkSettings(page,{viewport,mobile});
        });
        await check('storage-blocked',async()=>{await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('storage blocked');};Storage.prototype.setItem=()=>{throw Error('storage blocked');};});await ready(page,`${url}/?freeze=1`);assert.deepEqual(await page.evaluate(()=>window.__chunk.choices),{version:1,main:5,storm:3});return{};});
        report.errors.push(...errors);
      }finally{await context.close();}
    }
    report.pass=!report.errors.length&&report.variants.every(r=>Object.values(r.checks).every(c=>c.pass));
  }catch(e){report.failure=String(e);report.pass=false;}finally{await browser.close();await save(`preview-checks${only?'-'+only:''}${args.includes('--mobile-only')?'-mobile':args.includes('--desktop-only')?'-desktop':''}`,report);}
}
