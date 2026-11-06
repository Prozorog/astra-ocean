import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2), option = (key, fallback) => argv.find(x => x.startsWith(`--${key}=`))?.slice(key.length+3) ?? fallback;
const mode=option('mode','frames'), stage=option('stage','pass5-final'), out=path.resolve('output/playwright',stage), base='http://localhost:4103';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
const report={mode,stage,errors:[],frames:[]}, bytes=s=>Buffer.from(s.slice(s.indexOf(',')+1),'base64');
page.on('pageerror',e=>report.errors.push(e.stack??String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
async function capture(fr,prefix='F'){
  const data=await page.evaluate(async fr=>{
    const a=window.__lab,f=a.variants.F,w=f.ocean;
    await a.setTime(fr*.03);
    const img=await f.capture(),mask=await f.mask(),ev=await f.evidence();
    const bloomGain=f.view.post.output.uniforms.uBloom,savedBloom=bloomGain.value;
    let noBloom;
    try{bloomGain.value=0;noBloom=await f.capture();}finally{bloomGain.value=savedBloom;}
    const ballLight=f.material.uniforms.uGlow,savedLight=ballLight.value;let noBallLight;
    try{ballLight.value=0;noBallLight=await f.capture();}finally{ballLight.value=savedLight;}
    // Actual orange-reflection radiance and world distance on visible water.
    const T=await import('/node_modules/three/build/three.module.js');
    const original=f.view.top.material, r=f.view.renderer, previous=r.getRenderTarget();
    const m=new T.ShaderMaterial({side:original.side,toneMapped:false,vertexShader:original.vertexShader,uniforms:original.uniforms,
      fragmentShader:original.fragmentShader.replace('gl_FragColor=vec4(col,1.);','gl_FragColor=vec4(orange.r*(1.-foamMask),radD,alongD,1.);')});
    const target=new T.WebGLRenderTarget(500,281,{type:T.FloatType}),pixels=new Float32Array(500*281*4),visibility=[f.view.ball.visible,f.view.lip.visible,f.view.floor.visible,f.view.aeration?.visible];
    let reflection;
    try{
      f.view.ball.visible=f.view.lip.visible=f.view.floor.visible=false;if(f.view.aeration)f.view.aeration.visible=false;f.view.top.material=m;
      r.setRenderTarget(target);r.setClearColor(0,0);r.clear();r.render(f.view.scene,f.view.camera);r.readRenderTargetPixels(target,0,0,500,281,pixels);
      const all=[],distances=[];let cameraSide=0;
      for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>.5&&pixels[i]>.12){all.push(pixels[i]);distances.push(pixels[i+1]);if(pixels[i+2]>=0)cameraSide++;}
      distances.sort((a,b)=>a-b);
      const sb=f.view.screenBall(),radius=sb.radius*500/f.view.width;
      reflection={pixels:all.length,discAreaRatio:all.length/(Math.PI*radius*radius),cameraSideShare:cameraSide/(all.length||1),p90DistanceDiameters:distances[Math.floor(distances.length*.9)]??null,maxDistanceDiameters:distances.at(-1)??null,thresholdLinearRed:.12};
      const bitmap=await createImageBitmap(await (await fetch(img)).blob()),colourCanvas=document.createElement('canvas');colourCanvas.width=500;colourCanvas.height=281;
      const context=colourCanvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0,500,281);bitmap.close();const rgba=context.getImageData(0,0,500,281).data;
      const darkBitmap=await createImageBitmap(await (await fetch(noBallLight)).blob());context.clearRect(0,0,500,281);context.drawImage(darkBitmap,0,0,500,281);darkBitmap.close();const darkRgba=context.getImageData(0,0,500,281).data;
      const cx=sb.centre[0]*500,cy=sb.centre[1]*281,visibleDistances=[],screenDistances=[];let visibleSide=0;
      for(let y=0;y<281;y++)for(let x=0;x<500;x++){
        const c=(y*500+x)*4,i=((280-y)*500+x)*4,radial=Math.hypot(x-cx,y-cy);
        if(pixels[i+3]>.5&&radial>radius&&rgba[c]-darkRgba[c]>8&&rgba[c]>75&&rgba[c]>rgba[c+1]*1.1&&rgba[c]>rgba[c+2]*1.35){
          visibleDistances.push(pixels[i+1]);screenDistances.push(radial/(2*radius));if(pixels[i+2]>=0)visibleSide++;
        }
      }
      visibleDistances.sort((a,b)=>a-b);screenDistances.sort((a,b)=>a-b);
      reflection.visibleColour={pixels:visibleDistances.length,discAreaRatio:visibleDistances.length/(Math.PI*radius*radius),cameraSideShare:visibleSide/(visibleDistances.length||1),p90WorldDiameters:visibleDistances[Math.floor(visibleDistances.length*.9)]??null,p90ScreenDiameters:screenDistances[Math.floor(screenDistances.length*.9)]??null,method:'Final beauty minus identical water with ball lighting/reflection disabled: delta R>8, R>75, R>1.1G, R>1.35B; outside the projected ball disc, positions from the float surface pass. Bloom is identical in both images.'};
    }finally{f.view.top.material=original;[f.view.ball.visible,f.view.lip.visible,f.view.floor.visible]=visibility;if(f.view.aeration)f.view.aeration.visible=visibility[3];r.setRenderTarget(previous);target.dispose();m.dispose();f.present();}
    return{img,mask,noBloom,noBallLight,ev,reflection};
  },fr);
  await writeFile(path.join(out,`${prefix}-${String(fr).padStart(3,'0')}.png`),bytes(data.img));
  await writeFile(path.join(out,`${prefix}-${String(fr).padStart(3,'0')}-mask.png`),bytes(data.mask));
  await writeFile(path.join(out,`${prefix}-${String(fr).padStart(3,'0')}-no-bloom.png`),bytes(data.noBloom));
  await writeFile(path.join(out,`${prefix}-${String(fr).padStart(3,'0')}-no-ball-light.png`),bytes(data.noBallLight));
  report.frames.push({frame:fr,prefix,ev:data.ev,reflection:data.reflection});
}
try{
  await page.goto(base+(mode==='mainmotion'?'/':'/lab.html?variant=F'),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__ready||window.__lab?.ready,null,{timeout:180000});await page.bringToFront();
  if(option('model',''))await page.evaluate(async({model,main})=>{
    const s=await import('/src/water/spectrum.ts'),selected=model==='jonswap'?s.STORM_BOX:s.TURBULENT_BOX;
    if(main){Object.assign(window.__ocean.water.parameters,selected);window.__ocean.water.parameters.cascadeLengths=[...selected.cascadeLengths];window.__ocean.settings.chop=selected.chop;await window.__ocean.rebuild();window.__play();}
    else await window.__lab.setPreset('F',selected);
  },{model:option('model',''),main:mode==='mainmotion'});
  if(option('set','')){
    const settings=JSON.parse(await readFile(option('set',''),'utf8'));
    await page.evaluate(settings=>window.__lab.setPreset('F',settings),settings);
  }
  if(mode==='eventsearch'){
    report.events=[];
    for(const seed of [123456789,100029,20371179,20380352,20407871,20279449,20417044,20261103,20306968,538421,731209,917331]){
      const event=await page.evaluate(async seed=>{
        const a=window.__lab,f=a.variants.F,w=f.ocean;
        await a.setPreset('F',{...f.parameters,seed,phaseOffset:0});
        const curves=[],pixels=new Float32Array(256*256*4),previous=w.renderer.getRenderTarget(),old=w.resumeFoamMaterial.uniforms.uFrame.value;
        for(let frame=0;frame<121;frame+=5){
          w.resumeFoamMaterial.uniforms.uFrame.value=frame;w.pass.draw(w.resumeFoamMaterial,w.diagnosticTarget);w.renderer.readRenderTargetPixels(w.diagnosticTarget,0,0,256,256,pixels);
          let far=0,near=0,mass=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>.5){const point=i/4,x=point%256,z=Math.floor(point/256);if(x+z<255)far++;else near++;}mass+=pixels[i];}
          curves.push({frame,far:far/65536,near:near/65536,total:(far+near)/65536,mass:mass/65536});
        }
        w.resumeFoamMaterial.uniforms.uFrame.value=old;w.renderer.setRenderTarget(previous);
        let best;
        for(let i=0;i<curves.length;i++){
          const c=curves[i],mid=.5*(curves[(i+8)%curves.length].total+curves[(i+12)%curves.length].total),score=c.far-1.8*c.near-.65*mid;
          if(!best||score>best.score)best={...c,score,mid};
        }
        await a.setPreset('F',{...f.parameters,phaseOffset:best.frame*.03});
        return{seed,best,curves};
      },seed);
      report.events.push(event);
      for(const frame of [0,40])await capture(frame,`event${seed}`);
      console.log(JSON.stringify(event.best));
    }
  }else if(mode==='gallery'){
    const choices=[[123456789,1.8],[100029,2.42],[20371179,2.42],[20380352,.29],[20407871,2.72],[20279449,.59],[20417044,3.02],[20261103,1.8],[20306968,1.19]];
    for(const [seed,phaseOffset] of choices){
      await page.evaluate(async p=>{const f=window.__lab.variants.F;await window.__lab.setPreset('F',{...f.parameters,...p});},{seed,phaseOffset});
      for(const frame of [0,40])await capture(frame,`seed${seed}`);
    }
  }else if(mode==='diagnostics'){
    report.analysis=await page.evaluate(async()=>{
      const f=window.__lab.variants.F,w=f.ocean;
      await window.__lab.setTime(1.2);
      const old=w.copyFoam.uniforms.uHistory.value,previous=w.renderer.getRenderTarget();
      w.copyFoam.uniforms.uHistory.value=w.cascades[2].maps.textures[1];w.pass.draw(w.copyFoam,w.diagnosticTarget);
      w.renderer.readRenderTargetPixels(w.diagnosticTarget,0,0,256,256,w.heights);w.renderer.setRenderTarget(previous);w.copyFoam.uniforms.uHistory.value=old;
      let sx=0,sz=0,moment=0,mx=0;for(let i=0;i<w.heights.length;i+=4){sx+=w.heights[i]**2;sz+=w.heights[i+1]**2;moment+=w.heights[i+2];mx=Math.max(mx,Math.hypot(w.heights[i],w.heights[i+1]));}
      return{rmsX:Math.sqrt(sx/65536),rmsZ:Math.sqrt(sz/65536),rmsFromMoment:Math.sqrt(moment/65536),maxSlope:mx};
    });
    for(const fr of [0,40]){
      await page.evaluate(fr=>window.__lab.setTime(fr*.03),fr);
      for(const [name,debug] of [['normal',1],['environment',11],['body',12],['sun',13],['tail',10]]){
        const data=await page.evaluate(debug=>{const f=window.__lab.variants.F;f.material.uniforms.uDebug.value=debug;f.present();return f.canvas.toDataURL('image/png');},debug);
        await writeFile(path.join(out,`${name}-${fr}.png`),bytes(data));
      }
    }
    console.log(JSON.stringify(report.analysis));
  }else if(mode==='audit'){
    report.audit=await page.evaluate(async()=>{
      const f=window.__lab.variants.F,w=f.ocean,r=f.view.renderer,rows=[];
      for(let frame=0;frame<121;frame++){
        await window.__lab.setTime(frame*.03);
        const d=w.diagnostics(),gpu=new Float32Array(4);r.readRenderTargetPixels(w.ballState,0,0,1,1,gpu);
        rows.push({frame,reliefPercent:d.reliefPercent,areaAboveMean:d.areaAboveMeanFraction,minJ:d.minFinalJacobian,folded:d.foldedParameterFraction,nonfinite:d.nonfinite,anchorError:Math.hypot(gpu[0]-w.anchor.x,gpu[1]-w.anchor.y,gpu[2]-w.anchor.z)});
      }
      await window.__lab.setTime(0);
      const view=f.view,objects=[view.top,view.lip,view.ball,...(view.aeration?[view.aeration]:[])],visibility=objects.map(o=>o.visible),post=view.post,film=post.output.uniforms.uFilm.value,bloom=post.bloom.enabled,shadowStrength=view.floor.material.uniforms.uShadowStrength;
      const previous=shadowStrength.value;
      let shadow;
      try{
        objects.forEach(o=>o.visible=false);post.bloom.enabled=false;post.output.uniforms.uFilm.value=false;
        view.render(0); // Update the shadow map from the actual sheet, then isolate the floor.
        post.bloom.enabled=false;post.output.uniforms.uFilm.value=false;post.render();
        const gl=r.getContext(),a=new Uint8Array(view.width*view.height*4),b=new Uint8Array(a.length);
        gl.readPixels(0,0,view.width,view.height,gl.RGBA,gl.UNSIGNED_BYTE,a);
        shadowStrength.value=0;post.render();gl.readPixels(0,0,view.width,view.height,gl.RGBA,gl.UNSIGNED_BYTE,b);
        const ratios=[];
        for(let i=0;i<a.length;i+=4){const la=.2126*a[i]+.7152*a[i+1]+.0722*a[i+2],lb=.2126*b[i]+.7152*b[i+1]+.0722*b[i+2];if(lb>0&&la/lb<.96)ratios.push(la/lb);}
        ratios.sort((a,b)=>a-b);shadow={min:ratios[0],p05:ratios[Math.floor(ratios.length*.05)],median:ratios[Math.floor(ratios.length*.5)],pixels:ratios.length,method:'Isolated rendered floor against identical no-shadow baseline; linear image pipeline, output-space luminance ratio.'};
      }finally{shadowStrength.value=previous;post.output.uniforms.uFilm.value=film;post.bloom.enabled=bloom;objects.forEach((o,i)=>o.visible=visibility[i]);f.present();}
      return{rows,shadow,msaaSamples:view.post.target.samples,settings:{...w.parameters},renderer:view.rendererName(),maxAnchorError:Math.max(...rows.map(x=>x.anchorError)),minimumJacobian:Math.min(...rows.map(x=>x.minJ)),maxRelief:Math.max(...rows.map(x=>x.reliefPercent)),maxFoldedFraction:Math.max(...rows.map(x=>x.folded))};
    });
    console.log(JSON.stringify({...report.audit,rows:undefined},null,2));
  }else if(mode==='search'){
    for(const angle of [50,70,90]){
      await page.evaluate(async angle=>{globalThis.__crossAngle=angle;const f=window.__lab.variants.F;await window.__lab.setPreset('F',{...f.parameters,seed:123456789,heroHeight:4.2,chop:1.35,crestSharpening:.2});},angle);
      for(const fr of [0,40,100])await capture(fr,`angle${angle}`);
    }
    report.seedSearch=await page.evaluate(async()=>{
      const f=window.__lab.variants.F,w=f.ocean,T=await import('/node_modules/three/build/three.module.js'),{computeMaterial,floatTarget}=await import('/src/water/gpu-fft.ts');
      const savedBuild=w.buildAnchorGroups.bind(w);w.buildAnchorGroups=()=>{};
      const m=computeMaterial('uniform sampler2D uBase;uniform float uSize;in vec2 vUv;out vec4 outColor;void main(){vec2 e=vec2(1./256.,0.);float dx=uSize/256.;vec3 tx=vec3(1.,0.,0.)+(texture(uBase,vUv+e).xyz-texture(uBase,vUv-e).xyz)/(2.*dx),tz=vec3(0.,0.,1.)+(texture(uBase,vUv+e.yx).xyz-texture(uBase,vUv-e.yx).xyz)/(2.*dx);float lo=.5*(tx.x+tz.z-sqrt(max(0.,pow(tx.x-tz.z,2.)+4.*tx.z*tz.x)));outColor=vec4(texture(uBase,vUv).y,tx.x*tz.z-tx.z*tz.x,lo,texture(uBase,vUv).a);}',{uBase:{value:w.baseGeometry.texture},uSize:{value:w.parameters.sheetSizeMetres}}),target=floatTarget(128),pixels=new Float32Array(128*128*4),rows=[];
      try{
        for(const angle of [50,70,90])for(const seed of [123456789,100029,...Array.from({length:18},(_,i)=>20261103+i*9173)]){
          globalThis.__crossAngle=angle;Object.assign(w.parameters,{seed,heroHeight:4.2,chop:1.35,crestSharpening:.2});w.rebuildCascades();
          let minJ=Infinity,minEigen=Infinity,reliefMax=0,aboveSum=0,folded=0,crestFrame=0,crestScore=-Infinity,far=0;
          const phases=[];
          for(let fr=0;fr<121;fr+=10){
            w.evolve(fr*.03);w.pass.draw(m,target);w.renderer.readRenderTargetPixels(target,0,0,128,128,pixels);
            let lo=Infinity,hi=-Infinity,mean=0,above=0,maxPoint=0,farCompressed=0,nearCompressed=0;
            for(let i=0;i<pixels.length;i+=4){let h=pixels[i];lo=Math.min(lo,h);if(h>hi){hi=h;maxPoint=i/4;}mean+=h;minJ=Math.min(minJ,pixels[i+1]);minEigen=Math.min(minEigen,pixels[i+2]);folded+=pixels[i+1]<0?1:0;}
            mean/=128*128;
            for(let i=0;i<pixels.length;i+=4){let h=pixels[i],x=(i/4%128+.5)/128-.5,z=(Math.floor(i/4/128)+.5)/128-.5;if(h>mean)above++;if(h>w.heroHs*.22&&pixels[i+3]<.55){if(x+z<0)farCompressed++;else nearCompressed++;}}
            const relief=(hi-lo)/w.parameters.sheetSizeMetres,area=above/(128*128),score=farCompressed-.6*nearCompressed;
            phases.push({fr,relief,area,farCompressed,nearCompressed,crest:[(maxPoint%128+.5)/128-.5,(Math.floor(maxPoint/128)+.5)/128-.5]});
            reliefMax=Math.max(reliefMax,relief);aboveSum+=area;
            if(score>crestScore){crestScore=score;crestFrame=fr;far=farCompressed;}
          }
          rows.push({angle,seed,minJ,minEigen,reliefMax,areaAboveMean:aboveSum/phases.length,folded,crestFrame,crestScore,far,phases});
        }
      }finally{w.buildAnchorGroups=savedBuild;m.dispose();target.dispose();}
      return rows;
    });
    console.log(JSON.stringify(report.seedSearch.toSorted((a,b)=>Math.abs(a.reliefMax-.21)-Math.abs(b.reliefMax-.21)).slice(0,15).map(({phases,...r})=>r),null,2));
  }else if(mode==='motion'||mode==='mainmotion'){
    if(mode==='mainmotion')await page.waitForTimeout(5000);
    else await page.waitForTimeout(1500);
    report.queueBefore=execFileSync('cmd.exe',['/d','/s','/c','agent-tools status'],{encoding:'utf8',windowsHide:true});
    // GPU trace is accumulated in a strip and read once AFTER playback. No per-frame CPU/GPU stalls.
    report.motion=await page.evaluate(async ({main,record})=>{
      const f=main?null:window.__lab.variants.F,w=main?window.__ocean.water:f.ocean,r=w.renderer,T=await import('/node_modules/three/build/three.module.js'),{computeMaterial}=await import('/src/water/gpu-fft.ts');
      const target=new T.WebGLRenderTarget(4096,1,{type:T.FloatType,depthBuffer:false});target.scissorTest=true;
      const shader=computeMaterial('uniform sampler2D uState;uniform vec3 uOffset;uniform float uImmersion;out vec4 outColor;void main(){vec3 a=texture(uState,vec2(.5)).xyz;outColor=vec4(a+vec3(0.,uImmersion,0.)+uOffset,a.y);}',{uState:{value:w.ballState.textures[0]},uOffset:{value:new T.Vector3()},uImmersion:{value:w.ballRadius*.4}});
      const rows=[],original=(main?window.__ocean.post:f.view).render.bind(main?window.__ocean.post:f.view),host=main?window.__ocean.post:f.view;let index=0,recording=true;
      host.render=function(...args){
        const result=original(...args);if(!recording||index>=4096)return result;
        shader.uniforms.uOffset.value.copy(main?window.__ocean.effects.gpuOffset:new T.Vector3(0,f.dropOffset*10/f.parameters.sheetSizeMetres,0));
        target.viewport.set(index,0,1,1);target.scissor.set(index,0,1,1);const previous=r.getRenderTarget();w.pass.draw(shader,target);r.setRenderTarget(previous);
        rows.push({wall:performance.now(),phase:w.time,frame:index,cpu:main?window.__ocean.ball.position.toArray():f.view.ball.position.toArray(),mode:main?window.__ocean.effects.mode:'track',offset:shader.uniforms.uOffset.value.toArray(),anchor:[w.anchor.x,w.anchor.y,w.anchor.z]});index++;return result;
      };
      const canvas=main?r.domElement:document.createElement('canvas');
      if(!main){canvas.width=1000;canvas.height=281;}
      const ctx=main?null:canvas.getContext('2d'),ref=main?null:document.querySelector('[data-tile="reference"] canvas');
      function pair(){if(recording&&!main&&record){ctx.drawImage(ref,0,0,500,281);ctx.drawImage(f.canvas,500,0,500,281);requestAnimationFrame(pair);}}pair();
      const stream=record?canvas.captureStream(30):null,mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x)),chunks=[],recorder=record?new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000}):null;if(recorder)recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data.arrayBuffer());};
      if(main){if(window.__ocean.paused)window.__play();}else if(!window.__lab.playing)window.__lab.play();
      const started=performance.now();recorder?.start(1000);await new Promise(resolve=>setTimeout(resolve,3*3630));recording=false;
      if(recorder)await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop();});stream?.getTracks().forEach(t=>t.stop());
      host.render=original;const pix=new Float32Array(4096*4);r.readRenderTargetPixels(target,0,0,4096,1,pix);
      rows.forEach((row,i)=>{row.gpu=Array.from(pix.slice(i*4,i*4+3));row.water=pix[i*4+3];row.immersion=(row.water+w.ballRadius-row.gpu[1])/(2*w.ballRadius);});
      target.dispose();shader.dispose();let binary='';for(const buffer of await Promise.all(chunks)){const data=new Uint8Array(buffer);for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));}
      return{rows,video:btoa(binary),mime,elapsed:performance.now()-started,renderer:main?window.__evidence().renderer:f.view.rendererName(),paneVisible:document.visibilityState==='visible',size:[innerWidth,innerHeight]};
    },{main:mode==='mainmotion',record:!argv.includes('--trace-only')});
    if(report.motion.video)await writeFile(path.join(out,mode==='mainmotion'?'main-live.webm':'reference-f-live.webm'),Buffer.from(report.motion.video,'base64'));delete report.motion.video;
    report.queueAfter=execFileSync('cmd.exe',['/d','/s','/c','agent-tools status'],{encoding:'utf8',windowsHide:true});
    await page.screenshot({path:path.join(out,mode==='mainmotion'?'main-pane.png':'lab-pane.png')});
  }else{
    for(const fr of [0,20,40,60,80,100,120])await capture(fr);
    report.seam=await page.evaluate(async()=>{const a=window.__lab,f=a.variants.F;await a.setTime(0);const before=await f.capture();await a.setTime(3.63);const after=await f.capture();return{pixelIdentical:before===after};});
    await page.screenshot({path:path.join(out,'lab-pair.png')});
    report.preset=await page.evaluate(()=>window.__lab.preset());
  }
  if(report.errors.length)throw new Error(report.errors.join('\n'));
  report.completed=true;
}catch(error){report.failure=error.stack??String(error);process.exitCode=1;}
finally{await browser.close();await writeFile(path.join(out,`${mode}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({stage,completed:report.completed,errors:report.errors,failure:report.failure,seam:report.seam,frames:report.frames.map(({frame,reflection,ev,prefix})=>({frame,prefix,reflection,reliefPercent:ev.reliefPercent,areaAboveMean:ev.spectrum.areaAboveMeanFraction,minJ:ev.spectrum.minFinalJacobian}))},null,2));}
