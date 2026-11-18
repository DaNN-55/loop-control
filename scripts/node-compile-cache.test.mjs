// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,realpath,rm,utimes,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pruneNodeCompileCache} from './openchatcut-cache.mjs';
const roots=[];
async function fixture(){const root=await realpath(await mkdtemp(join(tmpdir(),'loop-node-cache-')));roots.push(root);const directory=join(root,'cache'),version=join(directory,'v24.20.0-arm64-abcdef01-501');await mkdir(version,{recursive:true});return{root,directory,version};}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('expires cold generated cache files while preserving aliases, shared files, recent writes and unknown data',async()=>{
 const{root,directory,version}=await fixture();
 await writeFile(join(version,'aabb'),'cold');await utimes(join(version,'aabb'),1,1);
 await writeFile(join(version,'ccdd'),'fresh');await writeFile(join(version,'notes.txt'),'keep');
 const original=join(root,'original');await writeFile(original,'original');await symlink(original,join(version,'eeff'));await link(original,join(version,'0011'));
 const result=await pruneNodeCompileCache({directory,maxBytes:0});expect(result.removed).toEqual([join(version,'aabb')]);expect(await readFile(original,'utf8')).toBe('original');expect((await readdir(version)).sort()).toEqual(['0011','ccdd','eeff','notes.txt']);
});
it('keeps the newest packs within its allocated byte budget and fails closed on directory aliases',async()=>{
 const{root,directory,version}=await fixture();
 for(const[name,time]of[['aa',1],['bb',2]]){await writeFile(join(version,name),'cache');await utimes(join(version,name),time,time);}
 const result=await pruneNodeCompileCache({directory,maxBytes:4096,minAgeMs:0,maxAgeMs:Number.MAX_SAFE_INTEGER});expect(result.removed).toEqual([join(version,'aa')]);expect(await readdir(version)).toEqual(['bb']);
 const alias=join(root,'alias');await symlink(directory,alias);expect(await pruneNodeCompileCache({directory:alias,maxBytes:0,minAgeMs:0})).toMatchObject({status:'skipped',reason:'unsafe-path'});
});
it('removes a real Node compile cache without changing module results, then lets Node recreate it',async()=>{
 const{root,directory}=await fixture(),module=join(root,'sample.mjs');await writeFile(module,'export const answer=42;');
 const run=()=>execFileSync(process.execPath,['--input-type=module','-e',`console.log((await import(${JSON.stringify(module)})).answer)`],{encoding:'utf8',env:{PATH:process.env.PATH,NODE_COMPILE_CACHE:directory}}).trim();
 expect(run()).toBe('42');const pruned=await pruneNodeCompileCache({directory,maxBytes:0,minAgeMs:0});expect(pruned.removed.length).toBeGreaterThan(0);expect(run()).toBe('42');
});
