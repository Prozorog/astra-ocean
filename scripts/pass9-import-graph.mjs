import { readFile,readdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
const files=[];async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(/\.[jt]s$/.test(p))files.push(p.replaceAll('\\','/'));}}await walk('src');const known=new Set(files),graph={};
function resolve(from,name){if(!name.startsWith('.'))return;const p=path.posix.normalize(path.posix.join(path.posix.dirname(from),name));return[p,`${p}.ts`,`${p}.js`,`${p}/index.ts`,`${p}/index.js`].find(p=>known.has(p));}
for(const file of files){const source=await readFile(file,'utf8'),deps=new Set();for(const m of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)){const d=resolve(file,m[1]);if(d)deps.add(d);}graph[file]=[...deps];}
const roots=['src/entry.ts','src/lab/main.ts','src/ultra/settings-page.js','src/ultra/compare.js'],reachable=new Set();function mark(f){if(reachable.has(f))return;reachable.add(f);for(const d of graph[f]??[])mark(d);}roots.forEach(mark);
const report={roots,reachable:[...reachable].sort(),unreachable:files.filter(f=>!reachable.has(f)),graph};await writeFile('output/perf/import-graph.json',JSON.stringify(report,null,2));console.log(JSON.stringify({unreachable:report.unreachable}));
