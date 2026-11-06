import {spawnSync}from'node:child_process';
import {readFile,writeFile,copyFile}from'node:fs/promises';
import path from'node:path';
const env={...process.env,RAYON_NUM_THREADS:'4',GOMAXPROCS:'4',OMP_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4'},report={workers:4};
const pkg=JSON.parse(await readFile('node_modules/typescript/package.json','utf8'));
for(const [name,args]of [['typecheck',[path.resolve('node_modules/typescript',pkg.bin.tsc),'--noEmit']],['mainBuild',['node_modules/vite/bin/vite.js','build','--config','vite.main.config.ts']],['labBuild',['node_modules/vite/bin/vite.js','build','--config','vite.lab.config.ts']]]){
 const result=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});await writeFile(`output/perf/${name}.log`,`${result.stdout??''}${result.stderr??''}`);report[name]=result.status===0;
 console.log(`${name}: ${report[name]?'passed':'failed'}`);if(!report[name])throw Error(result.stderr||result.stdout||String(result.error));
}
const notices=await readFile('THIRD_PARTY_NOTICES.md');for(const dir of ['dist','dist-lab'])await copyFile('THIRD_PARTY_NOTICES.md',`${dir}/THIRD_PARTY_NOTICES.md`);
report.noticesMatch=(await readFile('dist/THIRD_PARTY_NOTICES.md')).equals(notices)&&(await readFile('dist-lab/THIRD_PARTY_NOTICES.md')).equals(notices);
await writeFile('output/perf/builds.json',JSON.stringify(report,null,2));if(!report.noticesMatch)throw Error('Notice copy mismatch');console.log('Both outputs contain matching notices');
