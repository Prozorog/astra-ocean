import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2),option=(name,fallback)=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const url=option('url','http://localhost:4103'),stage=option('stage','baseline'),mode=option('mode','diagnostics'),out=path.resolve(`output/playwright/crest-character/${stage}`);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1}),report={url,stage,mode,errors:[],phases:[]};
page.on('pageerror',e=>report.errors.push(e.stack??String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
try{
 if(mode==='reference'){
  const gif=await readFile(path.resolve('..','floating-ocean','ocean simalation.gif'));
  await page.setContent(`<img id="reference" style="width:500px;height:281px" src="data:image/gif;base64,${gif.toString('base64')}">`);
  await page.waitForFunction(()=>document.querySelector('img').complete&&document.querySelector('img').naturalWidth>0);
  report.reference=await page.evaluate(async()=>{const img=document.querySelector('img'),c=document.createElement('canvas');c.width=500;c.height=281;const x=c.getContext('2d',{willReadFrequently:true}),rows=[],start=performance.now();
   for(let i=0;i<61;i++){await new Promise(r=>setTimeout(r,120));x.drawImage(img,0,0,500,281);const d=x.getImageData(0,0,500,281).data;let hash=2166136261;for(let j=0;j<d.length;j+=97)hash=Math.imul(hash^d[j],16777619);rows.push({ms:performance.now()-start,hash:hash>>>0});}
   return{width:img.naturalWidth,height:img.naturalHeight,elapsedMs:performance.now()-start,samples:rows};});
  await page.screenshot({path:path.join(out,'reference-playing.png')});
 }else{
  await page.goto(`${url}/?freeze=1`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__ready,null,{timeout:180000});
  const presetFile=option('set',null),change=presetFile?JSON.parse(await readFile(presetFile,'utf8')):{};
  if(Object.keys(change).length)await page.evaluate(async change=>{const a=window.__ocean;Object.assign(a.water.parameters,change);if('chop'in change)a.settings.chop=change.chop;await a.water.rebuild();await window.__setTime(0);},change);
  if(option('origin','')){const origin=option('origin','').split(',').map(Number);if(origin.length!==2||!origin.every(Number.isFinite))throw new Error('Origin requires two physical metre coordinates');
   await page.evaluate(async origin=>{const a=window.__ocean,w=a.water,rebuild=w.rebuildCascades.bind(w);w.rebuildCascades=function(){rebuild();for(const c of w.cascades){const {N,L}=c.seed.band,d=c.seed.coefficients;for(let z=0;z<N;z++)for(let x=0;x<N;x++){const angle=((x-N/2)*origin[0]+(z-N/2)*origin[1])*2*Math.PI/L,cs=Math.cos(angle),sn=Math.sin(angle),i=(z*N+x)*4;for(const j of [i,i+2]){const re=d[j],im=d[j+1];d[j]=re*cs-im*sn;d[j+1]=re*sn+im*cs;}}c.seed.texture.needsUpdate=true;}};await w.rebuild();await window.__setTime(0);},origin);
   report.windowOffsetMetres=origin;report.originMethod='Diagnostic-only common phase translation of every h0 pair in all cascades; unchanged energy/gain/camera. Not a production preset field.';
  }
  report.parameters=await page.evaluate(()=>({...window.__ocean.water.parameters}));
  report.spectrum=await page.evaluate(async()=>{
   const {spectralGain,G,TAU,windSpectrum,makeSpectrum}=await import('/src/water/spectrum.ts'),w=window.__ocean.water,p=w.parameters,kp=windSpectrum(p.wind,p.fetch).peak**2/G;
   const analyse=seed=>{const b=seed.band,groups={},modes=[];let total=0,squares=0;
    for(let z=0;z<b.N;z++)for(let x=0;x<b.N;x++){const i=(z*b.N+x)*4,c=seed.coefficients,kx=(x-b.N/2)*TAU/b.L,kz=(z-b.N/2)*TAU/b.L,k=Math.hypot(kx,kz);if(!k)continue;const energy=2*(c[i]*c[i]+c[i+1]*c[i+1])*spectralGain(k,kp,p)**2;if(energy<1e-20)continue;const cycles=Math.max(1,Math.round(Math.sqrt(G*k)*3.63*p.tau/TAU));groups[cycles]=(groups[cycles]??0)+energy;total+=energy;squares+=energy*energy;modes.push({x:x-b.N/2,z:z-b.N/2,wavelength:TAU/k,directionDegrees:Math.atan2(kz,kx)*180/Math.PI,cycles,energy});}
    modes.sort((a,b)=>b.energy-a.energy);return{band:b.name,totalVariance:total,effectiveModeCount:total*total/squares,temporalEnergyFractions:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v/total])),strongest:modes.slice(0,16).map(m=>({...m,fraction:m.energy/total}))};};
   const current=w.cascades.map(c=>analyse(c.seed)),band=w.cascades[0].seed.band,wind=makeSpectrum(band,{...p,swell:0},p.seed),swell=makeSpectrum(band,{...p,swell:1},p.seed);
   try{return{current,C0windOnly:analyse(wind),C0swellOnly:analyse(swell),representedSwellFraction:w.cascades.reduce((s,c)=>s+c.seed.swellVariance,0)/w.cascades.reduce((s,c)=>s+c.seed.variance,0)};}finally{wind.texture.dispose();swell.texture.dispose();}
  });
  await page.evaluate(async()=>{
   const a=window.__ocean,T=await import('/node_modules/three/build/three.module.js'),{computeMaterial,floatTarget}=await import('/src/water/gpu-fft.ts');
   const edge=computeMaterial('uniform sampler2D uBase,uVisual;uniform float uSize;in vec2 vUv;out vec4 outColor;void main(){vec2 e=vec2(1./512.,0.);float dx=uSize/512.;vec3 tx=vec3(1.,0.,0.)+(texture(uBase,vUv+e).xyz-texture(uBase,vUv-e).xyz)/(2.*dx),tz=vec3(0.,0.,1.)+(texture(uBase,vUv+e.yx).xyz-texture(uBase,vUv-e.yx).xyz)/(2.*dx);float minimum=.5*(tx.x+tz.z-sqrt(max(0.,(tx.x-tz.z)*(tx.x-tz.z)+4.*tx.z*tz.x)));outColor=vec4(tx.x*tz.z-tx.z*tz.x,texture(uVisual,vUv).a,texture(uBase,vUv).y,minimum);}',{uBase:{value:a.water.baseGeometry.texture},uVisual:{value:a.water.geometry.textures[1]},uSize:{value:a.water.parameters.sheetSizeMetres}});
   const clay=new T.ShaderMaterial({side:T.DoubleSide,toneMapped:false,uniforms:a.top.material.uniforms,vertexShader:a.top.material.vertexShader,fragmentShader:'uniform sampler2D uDx,uDz;uniform mat3 uSheet;varying vec2 vBase;varying vec3 vWorld;void main(){vec2 uv=vBase/10.+.5;vec3 N=normalize(uSheet*cross(texture2D(uDz,uv).xyz,texture2D(uDx,uv).xyz));if(!gl_FrontFacing)N=-N;float light=.28+.52*max(dot(N,normalize(vec3(-.7,1.2,-.7))),0.)+.14*max(N.y,0.);gl_FragColor=vec4(vec3(light),1.);}'});
   const carrierClay=new T.ShaderMaterial({side:T.DoubleSide,toneMapped:false,uniforms:a.top.material.uniforms,vertexShader:a.top.material.vertexShader,fragmentShader:'varying vec3 vWorld;void main(){vec3 N=normalize(cross(dFdx(vWorld),dFdy(vWorld)));if(dot(N,cameraPosition-vWorld)<0.)N=-N;float light=.28+.52*max(dot(N,normalize(vec3(-.7,1.2,-.7))),0.)+.14*max(N.y,0.);gl_FragColor=vec4(vec3(light),1.);}'});
   window.__crestInspection={edge,target:floatTarget(256),pixels:new Float32Array(256*256*4),clay,carrierClay};
  });
  for(const frame of mode==='motion'?[]:mode==='variance'?[0]:mode==='carrier-scan'?Array.from({length:121},(_,i)=>i):[0,20,40,60,80,100,120]){
   await page.evaluate(t=>window.__setTime(t),frame*.03);if(mode!=='carrier-scan')await page.screenshot({path:path.join(out,`${String(frame).padStart(3,'0')}.png`)});
   const state=await page.evaluate(()=>{const a=window.__ocean,d=window.__crestInspection,w=a.water;w.pass.draw(d.edge,d.target);a.renderer.readRenderTargetPixels(d.target,0,0,256,256,d.pixels);const all={samples:0,carrierFold:0,visualFold:0,minCarrier:Infinity,minVisual:Infinity,minEigenvalue:Infinity},edge={...all};let low=Infinity,high=-Infinity,sum=0,squares=0,peakIndex=0;
    for(let i=0;i<256*256;i++){const x=i%256,z=Math.floor(i/256),c=d.pixels[i*4],v=d.pixels[i*4+1],e=d.pixels[i*4+3],h=d.pixels[i*4+2];low=Math.min(low,h);if(h>high){high=h;peakIndex=i;}sum+=h;squares+=h*h;for(const s of [all,...(x<8||z<8||x>247||z>247?[edge]:[])]){s.samples++;s.carrierFold+=c<0?1:0;s.visualFold+=v<0?1:0;s.minCarrier=Math.min(s.minCarrier,c);s.minVisual=Math.min(s.minVisual,v);s.minEigenvalue=Math.min(s.minEigenvalue,e);}}
    return{phase:w.time,ball:a.ball.position.toArray(),camera:a.camera.position.toArray(),target:a.controls.target.toArray(),root:a.sheetRoot.rotation.toArray(),height:{minimumMetres:low,maximumMetres:high,peakMaterialMetres:[((peakIndex%256+.5)/256-.5)*w.parameters.sheetSizeMetres,((Math.floor(peakIndex/256)+.5)/256-.5)*w.parameters.sheetSizeMetres],rangeScene:(high-low)*10/w.parameters.sheetSizeMetres,rangeOverSheet:(high-low)/w.parameters.sheetSizeMetres,windowStdDevMetres:Math.sqrt(Math.max(0,squares/(256*256)-(sum/(256*256))**2)),method:'Carrier C0+C1 in sheet coordinates before rigid tilt; C1 ripple is not subtracted. Equal material samples, not a physical-area energy estimate.'},jacobian:{all,edge,method:'Equal material-grid samples, not physical area; edge is the outer eight cells of a 256x256 diagnostic map.'}};});report.phases.push({frame,...state});
   if(args.includes('--diagnostics')&&[0,60,100].includes(frame)){
    for(const [name,debug]of [['normal',1],['environment',11],['body',12],['sun',13],['macro-foam',4]]){await page.evaluate(debug=>{const a=window.__ocean;a.top.material.uniforms.uDebug.value=debug;a.post.render();},debug);await page.screenshot({path:path.join(out,`${frame}-${name}.png`)});}
    await page.evaluate(()=>{const a=window.__ocean;a.top.material.uniforms.uDebug.value=0;a.top.material.uniforms.uSmallRipples.value=0;a.post.render();});await page.screenshot({path:path.join(out,`${frame}-no-C2-normal.png`)});
    await page.evaluate(()=>{const a=window.__ocean,d=window.__crestInspection;a.top.material.uniforms.uSmallRipples.value=a.settings.ripples;d.oldMaterial=a.top.material;a.top.material=d.clay;a.post.render();});await page.screenshot({path:path.join(out,`${frame}-clay.png`)});
    await page.evaluate(()=>{const a=window.__ocean;a.lip.visible=false;a.post.render();});await page.screenshot({path:path.join(out,`${frame}-clay-no-lip.png`)});
    await page.evaluate(()=>{const a=window.__ocean,d=window.__crestInspection;d.rotation=a.sheetRoot.rotation.clone();d.matrix=a.top.material.uniforms.uSheet.value.clone();a.sheetRoot.rotation.set(0,0,0);a.sheetRoot.updateMatrixWorld(true);a.top.material.uniforms.uSheet.value.setFromMatrix4(a.sheetRoot.matrixWorld);a.post.render();});await page.screenshot({path:path.join(out,`${frame}-clay-no-rigid.png`)});
    await page.evaluate(()=>{const a=window.__ocean,d=window.__crestInspection;a.sheetRoot.rotation.copy(d.rotation);a.sheetRoot.updateMatrixWorld(true);d.oldMaterial.uniforms.uSheet.value.copy(d.matrix);a.top.material=d.oldMaterial;a.lip.visible=true;a.post.render();});
   }
   if(args.includes('--crest')&&[0,60,100].includes(frame)){
    await page.evaluate(async frame=>{const a=window.__ocean,w=a.water,d=window.__crestInspection,T=await import('/node_modules/three/build/three.module.js'),{floatTarget}=await import('/src/water/gpu-fft.ts'),previous=floatTarget(256),sourceTarget=floatTarget(256),resume=w.resumeFoamMaterial,savedFrame=resume.uniforms.uFrame.value;
     resume.uniforms.uFrame.value=(frame+120)%121;w.pass.draw(resume,previous);resume.uniforms.uFrame.value=savedFrame;
     const src=w.foamMaterial,marker='vec2 p=(vUv-.5)*uSize/uLength2+.5;',fragment=src.fragmentShader.replace(marker,'outColor=vec4(vec3(source),1.);return;'+marker);if(fragment===src.fragmentShader)throw new Error('Actual foam source insertion point is absent');
     const uniforms=Object.fromEntries(Object.entries(src.uniforms).map(([name,u])=>[name,{value:u.value}]));uniforms.uPrevious.value=previous.texture;uniforms.uDt.value=.03;
     const sourcePass=new T.RawShaderMaterial({glslVersion:src.glslVersion,vertexShader:src.vertexShader,fragmentShader:fragment,uniforms,depthTest:false,depthWrite:false});w.pass.draw(sourcePass,sourceTarget);
     const material=a.top.material,display=new T.ShaderMaterial({side:T.DoubleSide,toneMapped:false,uniforms:material.uniforms,vertexShader:material.vertexShader,fragmentShader:material.fragmentShader});display.uniforms.uCrestSource={value:sourceTarget.texture};
     d.crest={material,display,sourcePass,sourceTarget,previous};material.uniforms.uDebug.value=0;a.top.material=d.carrierClay;material.uniforms.uCarrier.value=true;a.post.render();
    },frame);await page.screenshot({path:path.join(out,`${frame}-carrier-clay.png`)});
    await page.evaluate(()=>{const a=window.__ocean,d=window.__crestInspection;d.crest.material.uniforms.uCarrier.value=false;a.top.material=d.carrierClay;a.post.render();});await page.screenshot({path:path.join(out,`${frame}-crest-clay.png`)});
    for(const [name,expression]of [['source','texture2D(uCrestSource,uv).rgb'],['history','vec3(history.r)'],['foam','(1.-F)*foam*opacity'],['crest-sun','sun']]){
     await page.evaluate(expression=>{const a=window.__ocean,d=window.__crestInspection,c=d.crest; c.display.fragmentShader=c.material.fragmentShader.replace('uniform sampler2D uGeometry,','uniform sampler2D uCrestSource,uGeometry,').replace('gl_FragColor=vec4(col,1.);',`gl_FragColor=vec4(${expression},1.);`);c.display.needsUpdate=true;a.top.material=c.display;a.post.render();},expression);
     await page.screenshot({path:path.join(out,`${frame}-${name}.png`)});
    }
    await page.evaluate(()=>{const a=window.__ocean,d=window.__crestInspection,c=d.crest;a.top.material=c.material;delete c.material.uniforms.uCrestSource;c.display.dispose();c.sourcePass.dispose();c.sourceTarget.dispose();c.previous.dispose();delete d.crest;a.post.render();});
   }
   if(args.includes('--reflection')&&[0,60,100].includes(frame)){
    await page.evaluate(()=>{const a=window.__ocean;a.top.material.uniforms.uDebug.value=7;a.post.render();});await page.screenshot({path:path.join(out,`${frame}-reflection.png`)});
    await page.evaluate(()=>{const a=window.__ocean;a.top.material.uniforms.uDebug.value=0;a.post.render();});
   }
   if(mode!=='carrier-scan'||frame%20===0)console.log(`${stage}: phase ${frame}`);
  }
  report.roughness=await page.evaluate(async()=>{
   const a=window.__ocean,T=await import('/node_modules/three/build/three.module.js'),m=a.top.material,original=m.fragmentShader,r=a.renderer,previous=r.getRenderTarget(),clear=r.getClearColor(new T.Color()),alpha=r.getClearAlpha();
   const hidden=[a.lip,a.ball,a.floor,...a.scene.children.filter(o=>o.isPoints)],visibility=hidden.map(o=>o.visible),target=new T.WebGLRenderTarget(1280,720,{type:T.FloatType,depthBuffer:true}),pixels=new Float32Array(1280*720*4);
   try{hidden.forEach(o=>o.visible=false);m.fragmentShader=original.replace('gl_FragColor=vec4(col,1.);','gl_FragColor=vec4(rough,variance,opacity,1.);');m.needsUpdate=true;r.setRenderTarget(target);r.setClearColor(0,0);r.clear();r.render(a.scene,a.camera);r.readRenderTargetPixels(target,0,0,1280,720,pixels);
    const hist=Array.from({length:4},()=>new Uint32Array(1024)),sums=[0,0,0,0],counts=[0,0,0,0],scales=[1,1,1,4];
    for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>.5){const values=[pixels[i],pixels[i+1],pixels[i+2],pixels[i+1]>1e-8?pixels[i]*pixels[i]/Math.sqrt(pixels[i+1]):null];values.forEach((v,j)=>{if(v===null||!Number.isFinite(v))return;hist[j][Math.min(1023,Math.max(0,Math.floor(v/scales[j]*1024)))]++;sums[j]+=v;counts[j]++;});}
    const stats=Object.fromEntries(['perceptualRoughness','unresolvedVariance','foamOpacity','ggxAlphaToRmsSlope'].map((name,j)=>{const q=p=>{let n=0;for(let i=0;i<1024;i++){n+=hist[j][i];if(n>=counts[j]*p)return(i+.5)/1024*scales[j];}return null;};return[name,{pixels:counts[j],mean:sums[j]/counts[j],p05:q(.05),p50:q(.5),p95:q(.95)}];}));
    const means=expression=>{m.fragmentShader=original.replace('gl_FragColor=vec4(col,1.);',expression);m.needsUpdate=true;r.clear();r.render(a.scene,a.camera);r.readRenderTargetPixels(target,0,0,1280,720,pixels);const total=[0,0,0];let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>.5){count++;for(let j=0;j<3;j++)total[j]+=pixels[i+j];}return total.map(v=>v/count);};
    stats.foamStateMeans=means('gl_FragColor=vec4(history.r,mass,morphology,1.);');
    stats.denseLayerMoments=means('gl_FragColor=vec4(morphology,morphology*morphology,film.b,step(.5,film.r));');
    stats.tailAndPixelVariance=means('vec4 base=textureLod(uGrad2,metres/uLengths.z+.5,0.);gl_FragColor=vec4(max(0.,g2.z-dot(g2.xy,g2.xy)),max(0.,base.z-dot(base.xy,base.xy)),(dot(dFdx(N),dFdx(N))+dot(dFdy(N),dFdy(N)))/12.,1.);');
    if(window.__ocean.top.material.uniforms.uGlow.value>0){
     m.fragmentShader=original.replace('gl_FragColor=vec4(col,1.);','gl_FragColor=vec4(orange.r,length(offset.xz)/(2.*uRadius),along/(2.*uRadius),1.);');m.needsUpdate=true;r.clear();r.render(a.scene,a.camera);r.readRenderTargetPixels(target,0,0,1280,720,pixels);
     let total=0,within2=0,within3=0,cameraSide=0;const bins=new Float64Array(100);
     for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>.5&&pixels[i]>0){const weight=pixels[i],distance=pixels[i+1];total+=weight;within2+=distance<=2?weight:0;within3+=distance<=3?weight:0;cameraSide+=pixels[i+2]>=0?weight:0;bins[Math.min(99,Math.max(0,Math.floor(distance*20)))]+=weight;}
     let sum=0,p95=null;for(let i=0;i<bins.length;i++){sum+=bins[i];if(total>0&&sum>=total*.95){p95=(i+.5)/20;break;}}
     stats.reflectionFootprint={summedRedRadiance:total,withinTwoDiameters:total?within2/total:null,withinThreeDiameters:total?within3/total:null,cameraSide:total?cameraSide/total:null,p95RadiusInDiameters:p95,method:'Actual isolated sphere-reflection red radiance on visible water; radiance-weighted, not a colour/foam-area mask.'};
    }
    return stats;
   }finally{m.fragmentShader=original;m.needsUpdate=true;hidden.forEach((o,i)=>o.visible=visibility[i]);r.setRenderTarget(previous);r.setClearColor(clear,alpha);target.dispose();}
  });
  await page.evaluate(()=>{const d=window.__crestInspection;d.edge.dispose();d.target.dispose();d.clay.dispose();d.carrierClay.dispose();delete window.__crestInspection;});
  if(mode==='motion'||args.includes('--motion')){
   report.motion=await page.evaluate(async()=>{await window.__setTime(0);window.__play();const a=window.__ocean,stream=a.renderer.domElement.captureStream(30),mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t)),chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6500000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data.arrayBuffer());};
    window.__crestStop=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Recorder finalization exceeded 15s')),15000);recorder.onerror=e=>{clearTimeout(timer);reject(new Error(String(e.error)));};recorder.onstop=async()=>{try{const buffers=await Promise.all(chunks);stream.getTracks().forEach(t=>t.stop());let binary='';for(const buffer of buffers){const data=new Uint8Array(buffer);for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));}clearTimeout(timer);resolve(btoa(binary));}catch(e){clearTimeout(timer);reject(e);}};recorder.stop();});
    const startPhase=a.water.time;recorder.start(1000);return{startPhase,mime,seconds:3*3.63,inspectionOnly:true,note:'Water-only fixed-input motion; kinematic inspection ball is not buoyancy evidence.'};});
   await page.waitForTimeout(3*3630);const data=await page.evaluate(()=>window.__crestStop());await writeFile(path.join(out,'continuous.webm'),Buffer.from(data,'base64'));
  }
 }
 if(report.errors.length)throw new Error(report.errors.join('\n'));report.completed=true;
}catch(e){report.failure=e.stack??String(e);process.exitCode=1;}finally{await browser.close();await writeFile(path.join(out,`inspection-${mode}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({out,completed:report.completed,failure:report.failure,spectrum:report.spectrum?.current.map(c=>({band:c.band,modeCount:c.effectiveModeCount,temporalFractions:c.temporalEnergyFractions})),roughness:report.roughness,errors:report.errors},null,2));}
