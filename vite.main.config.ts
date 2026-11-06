import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const root=import.meta.dirname;
export default defineConfig({
  build:{rollupOptions:{input:Object.fromEntries(['index','settings','pick','compare'].map(name=>[name,resolve(root,`${name}.html`)]))}},
  plugins:[{name:'ocean-review-media',generateBundle(){
    // Static HTML media is emitted by Vite. Only JS-selected tile URLs need copies.
    const files=Array.from({length:9},(_,i)=>[`tile-${i+1}/loop.webm`,`tile-${i+1}/still.png`]).flat().map(name=>`output/playwright/pass8-round1-reflections/${name}`);
    const cache='output/cache/ultra-water';
    if(existsSync(resolve(root,cache))){files.push(`${cache}/manifest.json`);for(const entry of readdirSync(resolve(root,cache),{withFileTypes:true}))if(entry.isDirectory())for(const name of ['foam.gz','spray.gz'])files.push(`${cache}/${entry.name}/${name}`);}
    for(const file of files)if(existsSync(resolve(root,file)))this.emitFile({type:'asset',fileName:file,source:readFileSync(resolve(root,file))});
  }}],
});
