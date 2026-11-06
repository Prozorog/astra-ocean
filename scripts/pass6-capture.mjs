import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const args=process.argv.slice(2),opt=(k,d)=>args.find(a=>a.startsWith(`--${k}=`))?.slice(k.length+3)??d;
const mode=opt('mode','frames'),stage=opt('stage','pass6'),model=opt('model','phillips'),out=path.resolve('output/playwright',stage);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1}),report={mode,model,errors:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
const bytes=s=>Buffer.from(s.slice(s.indexOf(',')+1),'base64');
try{
 await page.goto('http://localhost:4103/lab.html?variant=F',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__lab?.ready,null,{timeout:180000});await page.bringToFront();
 await page.evaluate(async model=>{const s=await import('/src/water/spectrum.ts');await window.__lab.setPreset('F',model==='jonswap'?s.STORM_BOX:s.TURBULENT_BOX);},model);
 if(opt('set',''))await page.evaluate(async s=>window.__lab.setPreset('F',s),JSON.parse(await readFile(opt('set',''),'utf8')));
 if(mode==='search'){
  report.search=await page.evaluate(async()=>{
   const f=window.__lab.variants.F,w=f.ocean,r=w.renderer,T=await import('/node_modules/three/build/three.module.js'),{computeMaterial}=await import('/src/water/gpu-fft.ts');
   window.__lab.pause();const p=w.parameters,originalBuild=w.buildAnchorGroups;w.buildAnchorGroups=()=>{};
   const count=204,points=new T.WebGLRenderTarget(count,5,{type:T.FloatType,depthBuffer:false});points.scissorTest=true;
   const field=new T.WebGLRenderTarget(32*34,32,{type:T.FloatType,depthBuffer:false});field.scissorTest=true;
   const u={uMap:{value:w.baseGeometry.texture},uSize:{value:p.sheetSizeMetres},uMVP:{value:new T.Matrix4()},uColumn:{value:0}};
   const probe=computeMaterial(`uniform sampler2D uMap;uniform float uSize;uniform mat4 uMVP;out vec4 outColor;void main(){int i=int(gl_FragCoord.y);vec2 q=i==0?vec2(0.):i==1?vec2(-5.,-5.):i==2?vec2(-5.,5.):i==3?vec2(5.,-5.):vec2(5.,5.);vec4 d=texture(uMap,q/10.+.5);vec3 v=vec3(q.x,0.,q.y)+d.xyz*(10./uSize);if(i==0)v.y+=.23;vec4 clip=uMVP*vec4(v,1.);outColor=vec4(clip.xy/clip.w*.5+.5,v.y,d.w);}`,u);
   const copy=computeMaterial('uniform sampler2D uMap;uniform float uColumn;out vec4 outColor;void main(){vec2 uv=vec2((gl_FragCoord.x-uColumn*32.)/32.,gl_FragCoord.y/32.);outColor=texture(uMap,uv);}',u);
   const result=[],pp=new Float32Array(count*5*4),fp=new Float32Array(32*34*32*4),saved=r.getRenderTarget();
   const range=a=>Math.max(...a)-Math.min(...a),percent=(a,q)=>a.toSorted((a,b)=>a-b)[Math.floor(a.length*q)];
   for(let s=0;s<64;s++){
    p.seed=20261103+s*9173;w.rebuildCascades();let fieldIndex=0;
    for(let i=0;i<count;i++){
     const time=i/28;w.evolve(time);f.view.pose(time,0,0,0);f.view.root.updateMatrixWorld(true);f.view.camera.updateMatrixWorld();
     u.uMVP.value.multiplyMatrices(f.view.camera.projectionMatrix,f.view.camera.matrixWorldInverse).multiply(f.view.root.matrixWorld);
     points.viewport.set(i,0,1,5);points.scissor.set(i,0,1,5);w.pass.draw(probe,points);
     if(i%6===0){u.uColumn.value=fieldIndex;field.viewport.set(fieldIndex*32,0,32,32);field.scissor.set(fieldIndex*32,0,32,32);w.pass.draw(copy,field);fieldIndex++;}
    }
    r.readRenderTargetPixels(points,0,0,count,5,pp);r.readRenderTargetPixels(field,0,0,32*34,32,fp);
    const ball=Array.from({length:count},(_,i)=>Array.from(pp.slice(i*4,i*4+4))),speeds=ball.slice(1).map((b,i)=>Math.hypot((b[0]-ball[i][0])*500,(b[1]-ball[i][1])*281));
    const corners=Array.from({length:4},(_,j)=>Array.from({length:count},(_,i)=>[pp[((j+1)*count+i)*4],pp[((j+1)*count+i)*4+1]]));
    const top=corners.reduce((a,b)=>a[0][1]>b[0][1]?a:b),bottom=corners.reduce((a,b)=>a[0][1]<b[0][1]?a:b),left=corners.reduce((a,b)=>a[0][0]<b[0][0]?a:b),right=corners.reduce((a,b)=>a[0][0]>b[0][0]?a:b);
    let event={score:-Infinity},relief=0,minJ=Infinity;
    for(let phase=0;phase<34;phase++){
     let lo=Infinity,hi=-Infinity,sum=0;const cells=[];
     for(let z=0;z<32;z++)for(let x=0;x<32;x++){const i=(z*32*34+phase*32+x)*4,h=fp[i+1],J=fp[i+3];lo=Math.min(lo,h);hi=Math.max(hi,h);sum+=h;minJ=Math.min(minJ,J);cells.push({x,z,h,J});}
     relief=Math.max(relief,(hi-lo)/p.sheetSizeMetres);const mean=sum/1024;
     const breaking=cells.filter(c=>c.J<.6&&c.h>mean+.15*(hi-lo)),far=breaking.filter(c=>c.x+c.z<31),score=(far.length-.8*(breaking.length-far.length))/1024;
     if(score>event.score)event={score,phaseOffset:(phase*6/28)%3.63,far:far.length/1024,near:(breaking.length-far.length)/1024};
    }
    const m={ballY:range(ball.map(b=>b[1])),ballX:range(ball.map(b=>b[0])),medianSpeed:percent(speeds,.5),p95Speed:percent(speeds,.95),heave:range(ball.map(b=>b[2]))/10,topY:range(top.map(b=>b[1])),bottomY:range(bottom.map(b=>b[1])),leftX:range(left.map(b=>b[0])),rightX:range(right.map(b=>b[0])),relief,minJ};
    const targets={ballY:[.15,.21],ballX:[.05,.09],medianSpeed:[1.3,2.1],heave:[.15,.3],topY:[.11,.16],bottomY:[.16,.23],leftX:[.15,.26],rightX:[.1,.15],relief:[.12,.22]};
    let score=0;for(const[k,[lo,hi]]of Object.entries(targets))score+=m[k]<lo?((lo-m[k])/(hi-lo))**2:m[k]>hi?((m[k]-hi)/(hi-lo))**2:0;
    const c0=w.cascades[0].seed,co=c0.coefficients,N=c0.band.N,energy=(x,z)=>{const i=((N/2+z)*N+N/2+x)*4;return co[i]**2+co[i+1]**2;};
    const ex=energy(1,0)+energy(-1,0),ez=energy(0,1)+energy(0,-1),axisBalance=Math.min(ex,ez)/Math.max(ex,ez);
    score+=Math.max(0,axisBalance-.65)*.5+Math.max(0,-.3-minJ)*10-event.score*2;
    result.push({seed:p.seed,score,axisBalance,event,...m});
   }
   w.buildAnchorGroups=originalBuild;r.setRenderTarget(saved);points.dispose();field.dispose();probe.dispose();copy.dispose();
   return{parameters:{...p},seedsTested:64,rows:result.toSorted((a,b)=>a.score-b.score)};
  });
 }else if(mode==='system'){
  report.system=await page.evaluate(async()=>{
   const f=window.__lab.variants.F,w=f.ocean,p=w.parameters,{spectrumClock,spectralGain,windSpectrum}=await import('/src/water/spectrum.ts'),clock=spectrumClock(p),peakK=windSpectrum(p.wind,p.fetch).peak**2/9.81,octaves=new Map(),longModes=[];
   let total=0,strongest=null;
   for(const c of w.cascades){const seed=c.seed,N=seed.band.N,dk=2*Math.PI/seed.band.L,co=seed.coefficients;
    for(let z=0;z<N;z++)for(let x=0;x<N;x++){
     const kx=x-N/2,kz=z-N/2,k=Math.hypot(kx,kz)*dk,i=(z*N+x)*4;if(k===0)continue;
     const gain=spectralGain(k,peakK,p)*(p.model==='jonswap'&&p.peakOnly&&seed.band.name==='C2'?1.5:1),energy=2*(co[i]**2+co[i+1]**2)*gain*gain;if(!energy)continue;
     const oct=Math.floor(Math.log2(k/(2*Math.PI/p.sheetSizeMetres))),o=octaves.get(oct)??{octave:oct,heightVariance:0,slopeVariance:0,modes:0};o.heightVariance+=energy;o.slopeVariance+=energy*k*k;o.modes++;octaves.set(oct,o);total+=energy;
     if(kx<0||(kx===0&&kz<0)||2*Math.PI/k<p.sheetSizeMetres*.5)continue;
     const pair=2*(co[i]**2+co[i+1]**2+co[i+2]**2+co[i+3]**2)*gain*gain,omega=Math.max(1,Math.round(Math.sqrt(9.81*k)*3.63*clock/(2*Math.PI)))*2*Math.PI/3.63;
     const mode={kx,kz,wavelength:2*Math.PI/k,pairVariance:pair,omega,r:co[i],im:co[i+1],rc:co[i+2],ic:co[i+3],gain};longModes.push(mode);if(!strongest||pair>strongest.pairVariance)strongest=mode;
    }
   }
   const envelope=[];for(let i=0;i<242;i++){const t=i*.03+p.phaseOffset;let energy=0;for(const m of longModes){const c=Math.cos(m.omega*t),s=Math.sin(m.omega*t),real=(m.r+m.rc)*c-(m.im-m.ic)*s,imag=(m.im+m.ic)*c+(m.r-m.rc)*s;energy+=2*(real*real+imag*imag)*m.gain*m.gain;}envelope.push(Math.sqrt(energy));}
   const dominantEnvelope=Array.from({length:242},(_,i)=>{const m=strongest,t=i*.03+p.phaseOffset,c=Math.cos(m.omega*t),s=Math.sin(m.omega*t),real=(m.r+m.rc)*c-(m.im-m.ic)*s,imag=(m.im+m.ic)*c+(m.r-m.rc)*s;return Math.sqrt(2*(real*real+imag*imag))*m.gain;});
   const dominantMaximum=Math.max(...dominantEnvelope),dominantMinimum=Math.min(...dominantEnvelope),dominantGrowth=[];
   for(let i=0;i<121;i++)if(dominantEnvelope[i]<=.3*dominantMaximum){for(let j=i+1;j<=i+15;j++)if(dominantEnvelope[j]>=.9*dominantMaximum){dominantGrowth.push({from:i*.03,to:j*.03,seconds:(j-i)*.03});break;}}
   const maximum=Math.max(...envelope),minimum=Math.min(...envelope),growth=[];
   for(let i=0;i<121;i++)if(envelope[i]<=.3*maximum){for(let j=i+1;j<=i+15;j++)if(envelope[j]>=.9*maximum){growth.push({from:i*.03,to:j*.03,seconds:(j-i)*.03});break;}}
   const anchor=[];for(let i=0;i<121;i++){w.updateAnchor(i*.03,false);anchor.push({time:i*.03,x:w.anchor.x,y:w.anchor.y,z:w.anchor.z});}
   const T=await import('/node_modules/three/build/three.module.js'),{computeMaterial}=await import('/src/water/gpu-fft.ts'),r=w.renderer;
   const target=new T.WebGLRenderTarget(204,4,{type:T.FloatType,depthBuffer:false});target.scissorTest=true;
   const uniforms={uMap:{value:w.baseGeometry.texture},uSize:{value:p.sheetSizeMetres},uMVP:{value:new T.Matrix4()}};
   const probe=computeMaterial('uniform sampler2D uMap;uniform float uSize;uniform mat4 uMVP;out vec4 outColor;void main(){int i=int(gl_FragCoord.y);vec2 q=i==0?vec2(-5.,-5.):i==1?vec2(-5.,5.):i==2?vec2(5.,-5.):vec2(5.,5.);vec3 d=texture(uMap,q/10.+.5).xyz,p=vec3(q.x,0.,q.y)+d*(10./uSize);vec4 clip=uMVP*vec4(p,1.);outColor=vec4(clip.xy/clip.w*.5+.5,p.y,1.);}',uniforms),pixels=new Float32Array(204*4*4),saved=r.getRenderTarget();
   for(let i=0;i<204;i++){const t=i/28;w.evolve(t);f.view.pose(t+p.phaseOffset,0,0,0);f.view.root.updateMatrixWorld(true);f.view.camera.updateMatrixWorld();uniforms.uMVP.value.multiplyMatrices(f.view.camera.projectionMatrix,f.view.camera.matrixWorldInverse).multiply(f.view.root.matrixWorld);target.viewport.set(i,0,1,4);target.scissor.set(i,0,1,4);w.pass.draw(probe,target);}
   r.readRenderTargetPixels(target,0,0,204,4,pixels);r.setRenderTarget(saved);probe.dispose();target.dispose();
   const pointRows=Array.from({length:4},(_,j)=>Array.from({length:204},(_,i)=>[pixels[(j*204+i)*4],pixels[(j*204+i)*4+1]])),mean=(a,k)=>a.reduce((s,p)=>s+p[k],0)/a.length,range=(a,k)=>Math.max(...a.map(p=>p[k]))-Math.min(...a.map(p=>p[k]));
   const top=pointRows.toSorted((a,b)=>mean(b,1)-mean(a,1))[0],bottom=pointRows.toSorted((a,b)=>mean(a,1)-mean(b,1))[0],left=pointRows.toSorted((a,b)=>mean(a,0)-mean(b,0))[0],right=pointRows.toSorted((a,b)=>mean(b,0)-mean(a,0))[0];
   const materialCorners={topY:range(top,1),bottomY:range(bottom,1),leftX:range(left,0),rightX:range(right,0),method:'Same current C0+C1 maps and scene matrices, undisplaced material corners at +/-5; 204 samples at 28 Hz. Foam silhouette extrema are a separate video measurement.'};
   await f.seek(0);
   return{parameters:{...p},clock,lowestCycles:Math.round(Math.sqrt(9.81*2*Math.PI/p.cascadeLengths[0])*3.63*clock/(2*Math.PI)),octaves:[...octaves.values()].sort((a,b)=>a.octave-b.octave),strongest:strongest?{kx:strongest.kx,kz:strongest.kz,wavelength:strongest.wavelength,varianceFraction:strongest.pairVariance/total}:null,longBandVarianceFraction:longModes.reduce((s,m)=>s+m.pairVariance,0)/total,envelope:{minimum,maximum,minOverMax:minimum/maximum,growth},dominantEnvelope:{minimum:dominantMinimum,maximum:dominantMaximum,minOverMax:dominantMinimum/dominantMaximum,growth:dominantGrowth},anchor,materialCorners,worldHeave:(Math.max(...anchor.map(a=>a.y))-Math.min(...anchor.map(a=>a.y)))/10,patchMinimumArea:.015,patchDensityThreshold:.3,patchAreas:w.patchAreas};
  });
 }else if(mode==='toggle'){
  const choose=page.locator('[data-tile="F"] select').filter({has:page.locator('option').filter({hasText:'Turbulent box (Phillips)'})});
  await page.locator('[data-tile="F"] .tune').click();report.toggle=[];
  for(const [label,expected]of [['Storm box (JONSWAP)','jonswap'],['Turbulent box (Phillips)','phillips']]){
   await choose.selectOption({label});await page.waitForFunction(expected=>window.__lab.variants.F.parameters.model===expected&&window.__lab.variants.F.ready&&document.querySelector('[data-tile="F"] .tile-loading').hidden,expected,{timeout:90000});
   report.toggle.push(await page.evaluate(()=>({model:window.__lab.variants.F.parameters.model,ready:window.__lab.variants.F.ready,options:[...document.querySelectorAll('[data-tile="F"] select option')].map(o=>o.textContent)})));
  }
 }else if(mode==='curve'){
  report.curve=await page.evaluate(async()=>{
   const f=window.__lab.variants.F,w=f.ocean,r=w.renderer,T=await import('/node_modules/three/build/three.module.js'),{computeMaterial}=await import('/src/water/gpu-fft.ts');window.__lab.pause();
   const m=computeMaterial('precision highp sampler2DArray;uniform sampler2DArray uFoam;uniform float uFrame;in vec2 vUv;out vec4 outColor;void main(){outColor=texture(uFoam,vec3(vUv,uFrame));}',{uFoam:{value:w.frozenFoam.texture},uFrame:{value:0}}),rt=new T.WebGLRenderTarget(64,64,{type:T.FloatType,depthBuffer:false}),pixels=new Float32Array(64*64*4),saved=r.getRenderTarget(),rows=[];
   for(let frame=0;frame<121;frame++){m.uniforms.uFrame.value=frame;w.pass.draw(m,rt);r.readRenderTargetPixels(rt,0,0,64,64,pixels);let far=0,near=0;for(let z=0;z<64;z++)for(let x=0;x<64;x++){if(pixels[(z*64+x)*4]>.5){if(x+z<63)far++;else near++;}}rows.push({frame,coverage:(far+near)/4096,far:far/4096,near:near/4096,patchAreas:w.patchAreas[frame]});}
   r.setRenderTarget(saved);m.dispose();rt.dispose();return rows;
  });
 }else if(mode==='patches'){
  report.patches=await page.evaluate(async()=>{
   const f=window.__lab.variants.F,w=f.ocean,T=await import('/node_modules/three/build/three.module.js'),{computeMaterial}=await import('/src/water/gpu-fft.ts');await window.__lab.setTime(0);
   const m=computeMaterial('precision highp sampler2DArray;uniform sampler2DArray uPatch,uFoam;in vec2 vUv;out vec4 outColor;void main(){float a=texture(uPatch,vec3(vUv,0.)).r,b=texture(uPatch,vec3(vUv,1.)).r,d=texture(uFoam,vec3(vUv,0.)).r;outColor=vec4(a,b,d,1.);}',{uPatch:{value:w.foamPatches},uFoam:{value:w.frozenFoam.texture}}),rt=new T.WebGLRenderTarget(256,256,{type:T.FloatType,depthBuffer:false}),data=new Float32Array(256*256*4),saved=w.renderer.getRenderTarget();w.pass.draw(m,rt);w.renderer.readRenderTargetPixels(rt,0,0,256,256,data);w.renderer.setRenderTarget(saved);
   let a=0,b=0,both=0,eligible=0;for(let i=0;i<data.length;i+=4){a+=data[i]>.5;b+=data[i+1]>.5;both+=Math.min(data[i],data[i+1])>.5;eligible+=Math.min(data[i],data[i+1])>.5&&data[i+2]>.3;}
   const v=f.view.aeration,old=v.material,v2=old.clone();v2.vertexShader=v2.vertexShader.replace('*step(.5,connectedMask)','');v.material=v2;const forced=await f.capture();v.material=old;v2.dispose();m.dispose();rt.dispose();
   return{a,b,both,eligible,areas:w.patchAreas[0],size:{width:256,height:256,depth:121},debug:old.uniforms.uDebug.value,forced};
  });await writeFile(path.join(out,'forced-puffs.png'),bytes(report.patches.forced));delete report.patches.forced;delete report.patches.size?.data;
 }else if(mode==='video'){
  report.queueBefore=execFileSync('cmd.exe',['/d','/s','/c','agent-tools status'],{encoding:'utf8',windowsHide:true});
  const recorded=await page.evaluate(async()=>{
   const api=window.__lab,f=api.variants.F;await api.setTime(0);const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=281;
   const ctx=canvas.getContext('2d'),ref=document.querySelector('[data-tile="reference"] canvas'),stream=canvas.captureStream(28),mime='video/webm;codecs=vp9',chunks=[];
   const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6500000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data.arrayBuffer());};
   let running=true;const draw=()=>{if(!running)return;ctx.drawImage(ref,0,0,500,281);ctx.drawImage(f.canvas,500,0,500,281);requestAnimationFrame(draw);};
   draw();recorder.start(1000);api.play();await new Promise(resolve=>setTimeout(resolve,7260));api.pause();running=false;
   await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop();});stream.getTracks().forEach(t=>t.stop());
   let binary='';for(const b of await Promise.all(chunks)){const a=new Uint8Array(b);for(let i=0;i<a.length;i+=32768)binary+=String.fromCharCode(...a.subarray(i,i+32768));}
   return{base64:btoa(binary),parameters:{...f.parameters},visible:document.visibilityState==='visible'};
  });
  await writeFile(path.join(out,`${model}-live.webm`),Buffer.from(recorded.base64,'base64'));delete recorded.base64;report.video=recorded;
  report.queueAfter=execFileSync('cmd.exe',['/d','/s','/c','agent-tools status'],{encoding:'utf8',windowsHide:true});
 }else{
  report.frames=[];for(const frame of [...new Set([0,20,40,60,80,100,120,...Array.from({length:12},(_,i)=>60+i*3)])].sort((a,b)=>a-b)){
   const data=await page.evaluate(async frame=>{
    await window.__lab.setTime(frame*.03);const f=window.__lab.variants.F,w=f.ocean;
    const image=await f.capture(),mask=await f.mask(),evidence=await f.evidence();let puffIds;
    if(frame%20===0){
     const T=await import('/node_modules/three/build/three.module.js'),v=f.view,volume=v.aeration,vm=volume.material,wm=v.top.material;
     const idMaterial=vm.clone();idMaterial.uniforms=vm.uniforms;idMaterial.transparent=false;idMaterial.depthWrite=true;
     idMaterial.vertexShader=idMaterial.vertexShader.replace('varying vec2 vQuad;','flat varying vec3 vPuffId;varying vec2 vQuad;').replace('vQuad=position.xy;','vPuffId=fract(sin(vec3(aSite.z*17.13,aSite.z*23.7,aSite.z*43.7))*43758.5453);vQuad=position.xy;');
     idMaterial.fragmentShader=idMaterial.fragmentShader.replace('varying vec2 vQuad;','flat varying vec3 vPuffId;varying vec2 vQuad;').replace('gl_FragColor=vec4(col,alpha);','gl_FragColor=vec4(vPuffId,1.);');
     const black=new T.ShaderMaterial({side:wm.side,toneMapped:false,uniforms:wm.uniforms,vertexShader:wm.vertexShader,fragmentShader:'void main(){gl_FragColor=vec4(0.,0.,0.,1.);}'});
     const visible=[v.ball.visible,v.floor.visible,v.lip.visible],film=v.post.output.uniforms.uFilm.value,bloom=v.post.bloom.enabled,gain=v.post.output.uniforms.uBloom.value;
     try{v.ball.visible=v.floor.visible=v.lip.visible=false;v.top.material=black;volume.material=idMaterial;v.post.output.uniforms.uFilm.value=false;v.post.bloom.enabled=false;v.post.output.uniforms.uBloom.value=0;v.post.render();puffIds=f.canvas.toDataURL('image/png');}
     finally{[v.ball.visible,v.floor.visible,v.lip.visible]=visible;v.top.material=wm;volume.material=vm;v.post.output.uniforms.uFilm.value=film;v.post.bloom.enabled=bloom;v.post.output.uniforms.uBloom.value=gain;idMaterial.dispose();black.dispose();f.present();}
    }
    return{image,mask,evidence:{...evidence,anchor:[w.anchor.x,w.anchor.y,w.anchor.z],acceptedPatchAreas:w.patchAreas[frame]},puffIds};
   },frame);
   if(!data.image.startsWith('data:image/png;base64,'))throw new Error(`Invalid PNG for ${model}/${frame}: ${data.image.slice(0,80)}`);
   await writeFile(path.join(out,`${model}-${String(frame).padStart(3,'0')}.png`),bytes(data.image));await writeFile(path.join(out,`${model}-${String(frame).padStart(3,'0')}-mask.png`),bytes(data.mask));
   if(data.puffIds)await writeFile(path.join(out,`${model}-${String(frame).padStart(3,'0')}-puff-ids.png`),bytes(data.puffIds));
   report.frames.push({frame,...data.evidence});
  }
  report.seam=await page.evaluate(async()=>{const a=window.__lab;await a.setTime(0);const first=await a.variants.F.capture();await a.setTime(3.63);return first===await a.variants.F.capture();});
 }
 await page.screenshot({path:path.join(out,`${model}-${mode}-pane.png`)});report.completed=true;
}catch(error){report.failure=String(error.stack??error);process.exitCode=1;}
finally{await browser.close();await writeFile(path.join(out,`${model}-${mode}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({mode,stage,model,completed:report.completed,failure:report.failure,errors:report.errors,seam:report.seam,search:report.search?.rows.slice(0,8)},null,2));}
