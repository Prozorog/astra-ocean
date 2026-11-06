import { launch, isolateHMR } from './pass9-harness.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const out='output/perf/anchors';await mkdir(out,{recursive:true});
const browser=await launch(),page=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:1});const errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
  await isolateHMR(page);await page.goto('http://localhost:4103/?freeze=1');await page.waitForFunction(()=>window.__ready,null,{timeout:240000});
  console.log('Main cache',await page.evaluate(()=>window.__chunk.view.simulation.brewing));
  await page.evaluate(()=>window.__chunk.view.simulation.buildStorm());
  console.log('Storm cache ready');
  const seams={};
  for(const [name,level] of [['main',1],['storm',1.375],['middle',1.1875]]){
    await mkdir(`${out}/${name}/frames`,{recursive:true});await page.evaluate(level=>window.__chunk.setStorm(level,true),level);
    const count=name==='middle'?1:121;
    for(let i=0;i<count;i++){
      const data=await page.evaluate(async i=>{await window.__setTime(i*.03);return window.__chunk.view.capture();},i);
      await writeFile(`${out}/${name}/frames/${String(i).padStart(3,'0')}.png`,Buffer.from(data.split(',')[1],'base64'));
    }
    const seam=await page.evaluate(async()=>{await window.__setTime(0);const a=window.__chunk.view.capture();await window.__setTime(3.63);return {equal:a===window.__chunk.view.capture(),evidence:window.__chunk.evidence()};});
    seams[name]=seam;console.log(name,'seam',seam.equal);
  }
  await writeFile(`${out}/seams.json`,JSON.stringify({seams,errors,pass:Object.values(seams).every(s=>s.equal)&&!errors.length},null,2));
  if(errors.length||!Object.values(seams).every(s=>s.equal))throw Error(JSON.stringify(errors));
}finally{await browser.close();}
