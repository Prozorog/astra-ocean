import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { launch,isolateHMR,stats } from './pass9-harness.mjs';
const browser=await launch(),page=await browser.newPage({viewport:{width:1280,height:720}}),out='output/playwright/pass9/ball-trace';await mkdir(out,{recursive:true});const report={errors:[],anchors:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
try{
 await isolateHMR(page);await page.goto('http://localhost:4103/?freeze=1');await page.waitForFunction(()=>window.__ready,null,{timeout:240000});await page.evaluate(()=>window.__chunk.view.simulation.buildStorm());
 for(const [name,level]of [['Main',1],['Storm',1.375]]){
  const data=await page.evaluate(async level=>{
   const a=window.__chunk,v=a.view,r=v.renderer;a.setStorm(level,true);await a.setTime(0);
   const read=v.access.read,metadata={...v.access.samples[0]},rows=[],pixel=new Float32Array(4);v.access.read=async()=>{};
   try{for(let i=0;i<=480;i++){
    const phase=i/120;v.frame(phase,1/120);v.draw();await r.readRenderTargetPixelsAsync(v.access.target,0,0,1,1,pixel);
    rows.push({frame:i,phase:((phase%3.63)+3.63)%3.63,anchor:[...pixel.slice(0,3)],displayedCenter:[pixel[0],pixel[1]+.23,pixel[2]],cpuMetadataY:v.access.samples[0].y});
   }}finally{v.access.read=read;}
   return{rows,metadataHeld:v.access.samples[0].y===metadata.y,gpuSampler:v.ball.material.uniforms.uBallState.value===v.access.target.textures[0]};
  },level);
  const deltas=data.rows.slice(1).map((r,i)=>Math.hypot(...r.anchor.map((n,j)=>n-data.rows[i].anchor[j]))),accels=deltas.slice(1).map((n,i)=>Math.abs(n-deltas[i]));
  assert(data.gpuSampler&&data.metadataHeld);assert(data.rows.every(r=>r.anchor.every(Number.isFinite)));assert(deltas.filter(d=>d<1e-8).length<3,'GPU carrier must keep moving even with CPU metadata frozen');
  await writeFile(`${out}/${name.toLowerCase()}.json`,JSON.stringify(data,null,2));report.anchors.push({name,level,frames:data.rows.length,seconds:4,cpuMetadataHeld:data.metadataHeld,gpuSampler:data.gpuSampler,zeroSteps:deltas.filter(d=>d<1e-8).length,stepDistance:stats(deltas),changeInStepDistance:stats(accels)});console.log(name,report.anchors.at(-1));
 }
 assert.deepEqual(report.errors,[]);report.pass=true;
}catch(e){report.failure=String(e);report.pass=false;process.exitCode=1;}finally{await browser.close();await writeFile(`${out}/trace.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,failure:report.failure}));}
