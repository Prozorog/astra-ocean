import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2), value=(n,d)=>args.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3)??d;
const url=value('url','http://localhost:4100'), stage=value('stage','before'), out=path.resolve(`output/playwright/float-water/${stage}`), phases=[0,20,40,60,80,100,120];
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1}), errors=[], report={url,stage,errors,variants:[]};
page.on('pageerror',e=>errors.push(e.stack??String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
  await page.goto(`${url}/?freeze=1`,{waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>window.__ready,null,{timeout:180000});
  console.log(`${stage}: GPU ready`);
  const original=await page.evaluate(()=>({...window.__ocean.water.parameters}));
  const variants=stage==='before'?[['current',{}],['no-foam-relief',{foamRelief:0}],['no-quadratic',{crestSharpening:0}]]:[['result',{}]];
  for(const [name,change] of variants){
    const directory=path.join(out,name);await mkdir(directory,{recursive:true});
    await page.evaluate(({original,change})=>{Object.assign(window.__ocean.water.parameters,original,change);},{original,change});
    const entry={name,parameters:await page.evaluate(()=>({...window.__ocean.water.parameters})),frames:[]};
    for(const frame of phases){await page.evaluate(t=>window.__setTime(t),frame*.03);await page.screenshot({path:path.join(directory,`${String(frame).padStart(3,'0')}.png`)});entry.frames.push({frame,probe:await page.evaluate(()=>({...window.__ocean.water.sample}))});console.log(`${name}: phase ${frame}`);}
    await page.evaluate(async()=>{await window.__setTime(0);window.__play();});
    await page.evaluate(()=>{
      const stream=window.__ocean.renderer.domElement.captureStream(30),mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(s=>MediaRecorder.isTypeSupported(s)),chunks=[];
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6500000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      window.__shapeStop=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Canvas recorder did not finalize within 15s')),15000);recorder.onerror=e=>{clearTimeout(timer);reject(new Error(String(e.error)));};recorder.onstop=async()=>{try{const data=new Uint8Array(await new Blob(chunks,{type:mime}).arrayBuffer());stream.getTracks().forEach(t=>t.stop());let binary='';for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));clearTimeout(timer);resolve(btoa(binary));}catch(e){clearTimeout(timer);reject(e);}};recorder.stop();});recorder.start(1000);
    });
    console.log(`${name}: continuous recording`);
    await page.waitForTimeout(3*3630);const video=await page.evaluate(()=>window.__shapeStop());await writeFile(path.join(directory,'continuous.webm'),Buffer.from(video,'base64'));
    entry.diagnostics=await page.evaluate(()=>window.__ocean.water.diagnostics());report.variants.push(entry);
  }
  if(errors.length)throw new Error(errors.join('\n'));
}catch(e){report.failure=String(e);process.exitCode=1;await page.screenshot({path:path.join(out,'shape-failure.png')}).catch(()=>{});}
finally{await browser.close();await writeFile(path.join(out,'shape-checks.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,variants:report.variants.map(v=>v.name),errors,failure:report.failure},null,2));}
