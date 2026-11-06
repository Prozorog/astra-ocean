import {launch,isolateHMR} from './pass9-harness.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await launch(),page=await browser.newPage({viewport:{width:640,height:360}}),root='output/cache/ultra-water',manifest={};await mkdir(root,{recursive:true});
try{
 await isolateHMR(page);await page.goto('http://localhost:4103/?freeze=1');await page.waitForFunction(()=>window.__ready,null,{timeout:240000});await page.evaluate(()=>window.__chunk.view.simulation.buildStorm());
 for(let tile=1;tile<=9;tile++){
  const meta=await page.evaluate(async tile=>{
   const {ChunkSimulation}=await import('/src/ultra/simulation.js'),{lookForTile}=await import('/src/ultra/choices.js'),{cacheKey}=await import('/src/ultra/cache.js');
   const sim=window.__cacheExport=new ChunkSimulation(window.__chunk.renderer,lookForTile(tile));await sim.initialize(()=>{},false,false);return{key:await cacheKey(sim),settings:sim.settings,brewing:sim.brewing};
  },tile);
  await mkdir(`${root}/${meta.key}`,{recursive:true});
  const sizes={};
  for(const [name,property]of [['foam','history'],['spray','sprayHistory']]){
   const length=await page.evaluate(async property=>{
    const sim=window.__cacheExport,target=sim[property],r=sim.renderer;
    const stream=new ReadableStream({async start(controller){try{for(let i=0;i<121;i++){
      r.setRenderTarget(target,i);const data=new Uint16Array(target.width*target.height*4);await r.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,data);controller.enqueue(new Uint8Array(data.buffer));
    }controller.close();}catch(e){controller.error(e);}}});
    const bytes=window.__cacheBytes=new Uint8Array(await new Response(stream.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());return bytes.length;
   },property);
   const chunks=[];
   for(let offset=0;offset<length;offset+=1024*1024){const chunk=await page.evaluate(offset=>{const bytes=window.__cacheBytes.subarray(offset,offset+1024*1024);let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);},offset);chunks.push(Buffer.from(chunk,'base64'));}
   const data=Buffer.concat(chunks);await writeFile(`${root}/${meta.key}/${name}.gz`,data);sizes[name]=data.length;
  }
  manifest[meta.key]={tile,...meta,sizes};await writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2));await page.evaluate(()=>{window.__cacheExport.dispose();window.__cacheExport=window.__cacheBytes=null;});console.log(`Tile ${tile}: exact foam ${sizes.foam} bytes, spray ${sizes.spray} bytes`);
 }
}finally{await browser.close();}
