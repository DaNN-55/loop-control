import fs from 'node:fs';import path from 'node:path';
const root=process.cwd(),s=JSON.parse(fs.readFileSync('/tmp/loop-maint-step1-20261111/scan.json'));const test=p=>/\.test\.|\.fixture\.|\/fixtures\//.test(p);const roots=new Set(s.files.filter(p=>p.startsWith('scripts/')&&!test(p)));roots.add('src/local-app/main.tsx');
for(const f of ['tsconfig.local-app.json','tsconfig.worker.json'])for(const p of JSON.parse(fs.readFileSync(f)).include)roots.add(p);
for(const p of s.files.filter(p=>/\.prototype\.(tsx?|mjs)$/.test(p)))roots.add(p);
for(const [f,es] of Object.entries(s.imports)){if(test(f))continue;for(const e of es)if(e.dynamic&&!e.resolved&&e.specifier){} }
const app=fs.readFileSync('scripts/runtime/application.mjs','utf8');for(const m of app.matchAll(/await load\('([^']+)'\)/g))roots.add('src/'+m[1].replace(/\.js$/,'.ts'));
const host=fs.readFileSync('scripts/openchatcut-host-modules.mjs','utf8');for(const m of host.matchAll(/'((?:src|scripts)\/[^']+\.(?:ts|mjs))'/g))roots.add(m[1]);
const reached=new Set();const walk=p=>{if(reached.has(p))return;reached.add(p);for(const e of s.imports[p]??[])if(e.resolved&&s.files.includes(e.resolved))walk(e.resolved);};for(const p of roots)walk(p);
const unreached=s.files.filter(p=>!test(p)&&!reached.has(p));const result={roots:[...roots].sort(),reachedCount:reached.size,unreached};fs.writeFileSync('/tmp/loop-maint-step1-20261111/reachability.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
