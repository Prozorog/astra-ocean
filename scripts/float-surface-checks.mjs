import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyMath } from './verify-math.mjs';
const url=process.argv.find(a=>/^http/.test(a))??'http://localhost:4100',out=path.resolve('output/playwright/float-water');
if((await readFile('src/entry.ts','utf8')).includes('./ultra/main.js')){await (await import('./pass9-ultra-checks.mjs')).runSurface(url);process.exit(process.exitCode??0);}
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1}),report={url,errors:[]};
page.on('pageerror',e=>report.errors.push(e.stack??String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
try{
  await page.goto(`${url}/?freeze=1`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready,null,{timeout:180000});
  report.math=await verifyMath(page);
  report.carrier=await page.evaluate(async()=>{
    const api=window.__ocean,w=api.water,m=w.probeMaterial,original=m.fragmentShader,relief=w.parameters.foamRelief,rows=[];
    m.uniforms.uVisual={value:w.geometry.texture};m.uniforms.uVisualDx={value:w.geometry.textures[1]};m.uniforms.uVisualDz={value:w.geometry.textures[2]};
    m.fragmentShader=m.fragmentShader.replace('uniform sampler2D uGeometry,uDz;','uniform sampler2D uGeometry,uDz,uVisual,uVisualDx,uVisualDz;').replace('else outColor=vec4(0.);','else if(row==5)outColor=vec4(vec3(q.x,0.,q.y)+texture(uVisual,uv).xyz*(10./uSize),1.);else if(row==6)outColor=vec4(normalize(cross(texture(uVisualDz,uv).xyz,texture(uVisualDx,uv).xyz)),1.);else outColor=vec4(0.);');m.needsUpdate=true;
    let maxCarrierChange=0,maxNormalChange=0,maxVisualChange=0,maxPickChange=0,maxVisualNormalError=0;
    try{
      for(const phase of [0,.6,1.2,1.8,2.4,3,3.6]){
        await window.__setTime(phase);[[0,0],[-2,-1],[1,2],[3,2],[-1,3],[-3,1],[2,-2],[.4,-.8]].forEach(([x,z],i)=>w.setProbe(i,x,z));
        const results=[];
        for(const amount of [0,2.2]){
          w.parameters.foamRelief=amount;w.compose();await w.readSample(phase,true);
          const samples=w.samples.slice(0,8).map((s,i)=>({...s,visual:Array.from(w.probeData.slice(5*w.probeCount*4+i*4,5*w.probeCount*4+i*4+3))}));
          const p=api.ball.position.clone().set(samples[0].x,samples[0].y,samples[0].z).applyMatrix4(api.sheetRoot.matrixWorld).project(api.camera);
          const hit=await api.surface.pick((p.x+1)*innerWidth/2,(1-p.y)*innerHeight/2);
          results.push({samples,pick:hit?.position.toArray()});
        }
        for(let i=0;i<8;i++){
          const a=results[0].samples[i],b=results[1].samples[i];maxCarrierChange=Math.max(maxCarrierChange,Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z));
          maxNormalChange=Math.max(maxNormalChange,Math.hypot(a.nx-b.nx,a.ny-b.ny,a.nz-b.nz));maxVisualChange=Math.max(maxVisualChange,Math.hypot(...a.visual.map((v,i)=>v-b.visual[i])));
        }
        if(!results.every(r=>r.pick))throw new Error('Carrier raster pick missing');
        maxPickChange=Math.max(maxPickChange,Math.hypot(...results[0].pick.map((v,i)=>v-results[1].pick[i])));rows.push({phase,samples:results});
        const qx=(Math.floor((1.2/10+.5)*512)+.5)/512*10-5,qz=(Math.floor((-1.1/10+.5)*512)+.5)/512*10-5,e=10/512;
        [[qx,qz],[qx+e,qz],[qx-e,qz],[qx,qz+e],[qx,qz-e]].forEach(([x,z],i)=>w.setProbe(i+2,x,z));await w.readSample(phase,true);
        const points=w.samples.slice(2,7).map((s,i)=>{const at=5*w.probeCount*4+(i+2)*4;return{x:w.probeData[at],y:w.probeData[at+1],z:w.probeData[at+2]};});
        const ax=points[1].x-points[2].x,ay=points[1].y-points[2].y,az=points[1].z-points[2].z,bx=points[3].x-points[4].x,by=points[3].y-points[4].y,bz=points[3].z-points[4].z;
        const n=[by*az-bz*ay,bz*ax-bx*az,bx*ay-by*ax],length=Math.hypot(...n),offset=6*w.probeCount*4+2*4;
        maxVisualNormalError=Math.max(maxVisualNormalError,Math.hypot(...n.map((v,i)=>v/length-w.probeData[offset+i])));
      }
    }finally{w.parameters.foamRelief=relief;m.fragmentShader=original;m.needsUpdate=true;w.setProbe(0,0,0);await window.__setTime(0);}
    return {maxCarrierChange,maxNormalChange,maxVisualChange,maxPickChange,maxVisualNormalError,rows,layout:'Existing tangentZ.w: load-bearing physical height; xyz: visual tangent. Independent visual-position central differences also verify foam-relief normals.'};
  });
  assert(report.carrier.maxVisualChange>.02,'Ablation must actually change visible geometry');assert(report.carrier.maxCarrierChange<1e-6,'Decorative foam must not move support');assert(report.carrier.maxNormalChange<1e-6,'Carrier normals must exclude decorative foam');assert(report.carrier.maxPickChange<1e-5,'Tap/contact carrier must be independent of relief');
  assert(report.carrier.maxVisualNormalError<.035,'Visual normals must include the actual decorative displacement');
  report.sphereInterior=await page.evaluate(async()=>{
    const a=window.__ocean,w=a.water,e=a.effects,h=w.interaction;
    await window.__setTime(0);
    e.position.set(w.sample.x,w.sample.y+.23,w.sample.z);e.surface.parameter.set(0,0);
    const readRim=async()=>{e.sampleSupport();await w.readSample(w.time,true);e.sampleSupport();return{y:e.support.position.y,valid:e.support.valid,centreY:w.sample.y};};
    const before=await readRim(),pushes=h.spherePushes;
    h.sphere(0,0,h.radius*3);h.step(h.stepSeconds);h.sphere(0,0,h.radius*.4);h.step(h.stepSeconds);w.compose();await w.readSample(w.time,true);
    const after=await readRim(),result={before,after,centreDepression:before.centreY-after.centreY,rimChange:Math.abs(before.y-after.y),spherePushes:h.spherePushes-pushes,method:'Actual moved-sphere shader depresses its interior. Free-water support is sampled outside that material-space mask, not at the solid centre.'};
    await window.__setTime(0);return result;
  });
  assert(report.sphereInterior.before.valid&&report.sphereInterior.after.valid);
  assert(report.sphereInterior.spherePushes>0&&report.sphereInterior.centreDepression>.2,'Exercise real sphere-column forcing');
  assert(report.sphereInterior.rimChange<.002,'Own interior depression must not kick buoyancy');
  report.dynamics=await page.evaluate(async()=>{
    const {advanceFloat}=await import('/src/buoyancy.ts'),T=await import('/node_modules/three/build/three.module.js'),s=window.__ocean.water.sample;
    const origin=new T.Vector3(s.x,s.y+.23,s.z),moving=new T.Vector3(.4,-.3,.25),rows=[];
    for(const fps of [30,60,120])for(const speed of [.25,.5,1,2]){
      const position=origin.clone().add(new T.Vector3(.8,-.4,.6)),velocity=new T.Vector3(-.7,1.2,.3),target=origin.clone();
      const duration=2,wallStep=1/fps,history={position:origin.clone(),velocity:moving.clone()};let elapsed=0;
      while(elapsed<duration-1e-12){const dt=Math.min(wallStep*speed,duration-elapsed);elapsed+=dt;target.copy(origin).addScaledVector(moving,elapsed);advanceFloat(position,velocity,target,moving,dt,history);history.position.copy(target);history.velocity.copy(moving);}
      rows.push({fps,speed,position:position.toArray(),velocity:velocity.toArray()});
    }
    const reference=rows[0];let maxPositionDifference=0,maxVelocityDifference=0;
    for(const r of rows){maxPositionDifference=Math.max(maxPositionDifference,Math.hypot(...r.position.map((v,i)=>v-reference.position[i])));maxVelocityDifference=Math.max(maxVelocityDifference,Math.hypot(...r.velocity.map((v,i)=>v-reference.velocity[i])));}
    // A delayed height correction is not an extra fluid velocity. Independent
    // fine-step RK4 evaluates the prescribed pressure forcing, with zero flow.
    const duration=.1,correction=.3,corrected=new T.Vector3(),correctedVelocity=new T.Vector3(),zero=new T.Vector3();
    advanceFloat(corrected,correctedVelocity,new T.Vector3(0,correction,0),zero,duration,{position:zero,velocity:zero});
    const force=(t,p,v)=>{const u=t/duration;return 400*(correction*(3*u*u-2*u*u*u)-p)-36*v;};
    let p=0,v=0;const h=duration/4000;
    for(let i=0;i<4000;i++){
      const t=i*h,k1p=v,k1v=force(t,p,v),k2p=v+k1v*h/2,k2v=force(t+h/2,p+k1p*h/2,v+k1v*h/2);
      const k3p=v+k2v*h/2,k3v=force(t+h/2,p+k2p*h/2,v+k2v*h/2),k4p=v+k3v*h,k4v=force(t+h,p+k3p*h,v+k3v*h);
      p+=h*(k1p+2*k2p+2*k3p+k4p)/6;v+=h*(k1v+2*k2v+2*k3v+k4v)/6;
    }
    const innovation={positionError:Math.abs(corrected.y-p),velocityError:Math.abs(correctedVelocity.y-v),position:corrected.y,velocity:correctedVelocity.y};
    const track=window.__ocean.track,w=window.__ocean.water,saved={...w.sample},frozen=w.frozen,b=new T.Vector3(),c=new T.Vector3(),n=new T.Vector3();
    track.sample(w.time,b,c,n);const trusted=b.clone();
    try{w.frozen=false;w.sample.sampledAt=performance.now()-1000;w.sample.velocityX=6;w.sample.velocityY=-6;w.sample.velocityZ=6;track.sample(w.time+.12,b,c,n);}
    finally{Object.assign(w.sample,saved);w.frozen=frozen;}
    return {rows,maxPositionDifference,maxVelocityDifference,innovation,staleTargetDisplacement:b.distanceTo(trusted),staleQuality:track.quality,criterion:'Same physical-time response at 30/60/120 FPS and .25/.5/1/2 playback; stale GPU targets do not extrapolate indefinitely; a pressure correction does not invent fluid velocity.'};
  });
  assert(report.dynamics.maxPositionDifference<1e-8);assert(report.dynamics.maxVelocityDifference<1e-8);assert(report.dynamics.staleTargetDisplacement<1e-8);assert.equal(report.dynamics.staleQuality,0);
  assert(report.dynamics.innovation.positionError<.002);assert(report.dynamics.innovation.velocityError<.03);
  assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.failure=String(e);report.passed=false;process.exitCode=1;await page.screenshot({path:path.join(out,'surface-failure.png')}).catch(()=>{});}
finally{await browser.close();await writeFile(path.join(out,'surface-checks.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failure:report.failure,errors:report.errors,math:report.math&&{normalError:report.math.maximumNormalError,inverseError:report.math.maximumInverseError},carrier:report.carrier&&{maxCarrierChange:report.carrier.maxCarrierChange,maxVisualChange:report.carrier.maxVisualChange,maxPickChange:report.carrier.maxPickChange},dynamics:report.dynamics&&{positionDifference:report.dynamics.maxPositionDifference,velocityDifference:report.dynamics.maxVelocityDifference,staleDisplacement:report.dynamics.staleTargetDisplacement}},null,2));}
