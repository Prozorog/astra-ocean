import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { measureFrame, measureVariance } from './measure-frame.mjs';
import { verifyMath, verifyBackfaces } from './verify-math.mjs';
const args=process.argv.slice(2),url=args.find(a=>/^http/.test(a))??'http://localhost:4100',framing=args.includes('--framing'),out=path.resolve('output/playwright/storm-box');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1}), errors=[],report={url,framing,errors,frames:[],sizes:[],seams:[]};
page.on('pageerror',e=>errors.push(e.stack??String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const bytes=data=>Buffer.from(data.slice(data.indexOf(',')+1),'base64');
try {
 await page.goto(`${url}/?freeze=1`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready,null,{timeout:180000});
 for(const [width,height] of framing?[[1280,720]]:[[1280,720],[1920,1080],[390,844]]){
  await page.setViewportSize({width,height});
  for(const frame of framing?Array.from({length:25},(_,i)=>i*5):[0,20,40,60,80,100,120]){
   await page.evaluate(t=>window.__setTime(t),frame*.03);
   const evidence=await measureFrame(page,false);report.sizes.push({width,height,frame,bounds:evidence.bounds,ballDiameterOverWaterWidth:evidence.ballDiameterOverWaterWidth,ballVisibleFraction:evidence.ballVisibleFraction,ballImmersionDiameterFraction:evidence.ballImmersionDiameterFraction,orangeRadiusDiameters:evidence.orangeRadiusDiameters,aerationCoverage:evidence.aerationCoverage,coverageMeaning:evidence.coverageMeaning});
   if(!framing&&width===1280){
    const image=await page.evaluate(()=>{window.__ocean.post.render();return window.__ocean.renderer.domElement.toDataURL('image/png');}),filename=`main-${String(frame).padStart(3,'0')}.png`;await writeFile(path.join(out,filename),bytes(image));
    const foamSimulation=await page.evaluate(()=>{const {water:w,renderer}=window.__ocean,previous=renderer.getRenderTarget();
     if(w.frozen){w.resumeFoamMaterial.uniforms.uFrame.value=w.time/3.63*121;w.pass.draw(w.resumeFoamMaterial,w.diagnosticTarget);}else{w.copyFoam.uniforms.uHistory.value=w.history;w.pass.draw(w.copyFoam,w.diagnosticTarget);}
     renderer.readRenderTargetPixels(w.diagnosticTarget,0,0,256,256,w.heights);renderer.setRenderTarget(previous);let covered=0,sum=0,nonfinite=0;const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
     for(let i=0;i<w.heights.length;i+=4){const mass=smooth(.12,.58,w.heights[i]*w.storm*w.storm),caps=smooth(.25,.8,w.heights[i+1]*w.storm*w.storm)*.65,coverage=1-(1-mass)*(1-caps);if(coverage>=90/255)covered++;sum+=coverage;if(!Number.isFinite(coverage))nonfinite++;}
     return {coveredCells:covered,denominator:65536,fraction:covered/65536,meanShaderCoverage:sum/65536,nonfinite,threshold:90/255,coordinates:'Uniform undeformed material-window cells, not Eulerian physical area; separate from visible screen-fragment coverage and GIF colour masks.'};});
    report.frames.push({frame,filename,foamSimulation,diagnostics:await page.evaluate(()=>window.__ocean.water.diagnostics()),variance:await measureVariance(page)});
   }
  }
  if(!framing)await page.screenshot({path:path.join(out,`main-${width}x${height}.png`)});
 }
 if(!framing){
  await page.setViewportSize({width:1280,height:720});report.math=await verifyMath(page);report.backfaces=await verifyBackfaces(page);assert(report.backfaces.passed,'Reverse sides must be shaded and finite');
  await mkdir(path.join(out,'main-motion'),{recursive:true});await page.evaluate(async()=>{await window.__setTime(0);await window.__ocean.advance(0,0);});
  for(let frame=0;frame<=242;frame++){
   const item=await page.evaluate(async frame=>{const api=window.__ocean;if(frame)await api.advance(frame*.03,.03);api.post.render();const result={image:api.renderer.domElement.toDataURL('image/jpeg',.94)};
    if(frame%121===0){const water=api.water,previous=api.renderer.getRenderTarget();water.copyFoam.uniforms.uHistory.value=water.history;water.pass.draw(water.copyFoam,water.diagnosticTarget);api.renderer.readRenderTargetPixels(water.diagnosticTarget,0,0,256,256,water.heights);api.renderer.setRenderTarget(previous);
     if(frame===0)window.__stormLoopStart=new Float32Array(water.heights);let maximum=0,mean=0;for(let i=0;i<water.heights.length;i+=4)for(let c=0;c<2;c++){const d=Math.abs(water.heights[i+c]-window.__stormLoopStart[i+c]);maximum=Math.max(maximum,d);mean+=d;}result.seam={frame,maximum,mean:mean/131072,phase:water.time,probePhase:water.sample.time,ball:api.ball.position.toArray(),root:api.sheetRoot.rotation.toArray()};}
    return result;},frame);
   await writeFile(path.join(out,'main-motion',`${String(frame).padStart(3,'0')}.jpg`),bytes(item.image));if(item.seam)report.seams.push(item.seam);
  }
  assert(report.seams.every(s=>s.maximum<.01),'Continuously advected history must remain periodic, without boundary seeks');
  report.boundaryImpulse=await page.evaluate(async()=>{const api=window.__ocean,w=api.water;await window.__setTime(3.57);w.interaction.drop(0,0,.8);const measurements=[];for(const time of [3.60,3.63,3.66]){await api.advance(time,.03);w.copyFoam.uniforms.uHistory.value=w.interaction.texture;w.pass.draw(w.copyFoam,w.diagnosticTarget);api.renderer.readRenderTargetPixels(w.diagnosticTarget,0,0,256,256,w.heights);let maximum=0,squares=0;for(let i=0;i<w.heights.length;i+=4){maximum=Math.max(maximum,Math.abs(w.heights[i]));squares+=w.heights[i]**2;}measurements.push({time,maximum,rms:Math.sqrt(squares/65536),steps:w.interaction.steps});}return measurements;});assert(report.boundaryImpulse.every(s=>s.maximum>.01),'User heightfield response must survive the loop boundary');
  report.preset=await page.evaluate(()=>{const api=window.__ocean;return {version:1,variants:{F:{...api.water.parameters}},view:{ballRadius:api.water.ballRadius,distance:api.camera.position.distanceTo(api.controls.target),target:api.controls.target.toArray(),segments:api.top.geometry.parameters.widthSegments},evidence:window.__evidence()};});
 }
 assert.equal(errors.length,0,errors.join('\n'));
} catch(error){report.failure=String(error);process.exitCode=1;await page.screenshot({path:path.join(out,'main-capture-failure.png')}).catch(()=>{});}
finally{await browser.close();const filename=framing?'framing-before.json':'main-checks.json';await writeFile(path.join(out,filename),JSON.stringify(report,null,2));console.log(JSON.stringify({file:path.join(out,filename),failure:report.failure,errors,sizes:report.sizes,seams:report.seams,math:report.math?{maximumNormalError:report.math.maximumNormalError,maximumInverseError:report.math.maximumInverseError}:undefined,backfaces:report.backfaces,boundaryImpulse:report.boundaryImpulse},null,2));}
