import {mkdir,writeFile}from'node:fs/promises';
import{launch,isolateHMR}from'./pass9-harness.mjs';
const out='output/perf/live-velocity';await mkdir(out,{recursive:true});const browser=await launch(),page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1}),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await isolateHMR(page);await page.goto('http://localhost:4103/?freeze=1');await page.waitForFunction(()=>window.__ready,null,{timeout:240000});await page.evaluate(()=>window.__chunk.view.simulation.buildStorm());
 for(const fps of [20,30,60]){
  const images=await page.evaluate(async fps=>{
   const a=window.__chunk,v=a.view,t=.9,dt=1/fps,read=()=>v.renderer.domElement.toDataURL('image/png');a.setStorm(1,true);await a.setTime(t-dt);v.deterministicPlayback=false;v.motionDirty=false;
   v.frame(t,dt);await v.access.read(true);v.updateBallMetadata();v.draw();const live=read();
   v.frame(t,dt);v.draw();const paused=read();
   v.settings.motionBlur=false;v.draw();const liveNoBlur=read();
   await a.setTime(t);const canonicalNoBlur=read();v.settings.motionBlur=true;v.draw();const canonical=read();
   return{live,paused,liveNoBlur,canonicalNoBlur,canonical};
  },fps);
  for(const [name,data]of Object.entries(images))await writeFile(`${out}/${fps}-${name}.png`,Buffer.from(data.split(',')[1],'base64'));
  console.log(`Live velocity ${fps} fps captured`);
 }
 await writeFile(`${out}/capture.json`,JSON.stringify({time:.9,size:[1920,1080],fps:[20,30,60],errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
