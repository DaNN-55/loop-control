import ts from '/Users/dan/.codex/worktrees/maintenance-20261111/loop-control/node_modules/typescript/lib/typescript.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=process.cwd();
const configs=['tsconfig.app.json','tsconfig.node.json','tsconfig.worker.json','tsconfig.local-app.json'];
const types={};
for(const name of configs){
 const config=ts.readConfigFile(name,ts.sys.readFile);
 const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
 const program=ts.createProgram(parsed.fileNames,{...parsed.options,noEmit:true,incremental:false});
 const sources=program.getSourceFiles().map(s=>s.fileName);
 types[name]={rootFiles:parsed.fileNames.length,sourceFiles:sources.length,explicitTypes:parsed.options.types??null,packages:Object.fromEntries(['node','pg','react','react-dom'].map(p=>[p,sources.filter(f=>f.includes('/node_modules/@types/'+p+'/')).map(f=>path.relative(root,f))]))};
}
fs.writeFileSync('/tmp/loop-maint-step3-20261111/type-resolution.json',JSON.stringify(types,null,2)+'\n');
const manifest=JSON.parse(fs.readFileSync('package.json')),lock=JSON.parse(fs.readFileSync('package-lock.json'));
const installed=Object.entries(lock.packages).filter(([p])=>p&&fs.existsSync(path.join(p,'package.json'))).map(([p,v])=>({path:p,name:JSON.parse(fs.readFileSync(path.join(p,'package.json'))).name,version:JSON.parse(fs.readFileSync(path.join(p,'package.json'))).version,optional:!!v.optional,dev:!!v.dev}));
let entries=0,logicalBytes=0,blocks=0;const inodes=new Set();
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name),s=fs.lstatSync(p);entries++;const id=s.dev+':'+s.ino;if(!inodes.has(id)){inodes.add(id);blocks+=s.blocks??0;if(s.isFile())logicalBytes+=s.size;}if(e.isDirectory()&&!e.isSymbolicLink())walk(p);}}
walk('node_modules');
const result={node:process.version,rootManifestSha256:crypto.createHash('sha256').update(fs.readFileSync('package.json')).digest('hex'),lockSha256:crypto.createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex'),directCount:Object.keys(manifest.dependencies).length+Object.keys(manifest.devDependencies).length,lockPackageEntries:Object.keys(lock.packages).length-1,installedLockPackages:installed.length,installed,measurement:{entries,uniqueInodes:inodes.size,regularFileLogicalBytes:logicalBytes,allocatedBytesFromStatBlocks:blocks*512}};
fs.writeFileSync('/tmp/loop-maint-step3-20261111/install-before.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({types:Object.fromEntries(Object.entries(types).map(([c,v])=>[c,Object.fromEntries(Object.entries(v.packages).map(([p,files])=>[p,files.length]))])),install:{installedLockPackages:installed.length,measurement:result.measurement}},null,2));
