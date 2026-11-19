// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,utimes,symlink,access} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareStudioProgram,acquireStudioViteCache,pruneStudioProgramCache} from './openchatcut-program-cache.mjs';
async function fixture(){
 const root=await mkdtemp('/private/tmp/loop-program-cache-'),sdk=join(root,'sdk'),host=join(root,'host'),cache=join(root,'cache');
 for(const p of ['src','remotion','assets','config'])await mkdir(join(sdk,p),{recursive:true});
 await mkdir(join(host,'scripts'),{recursive:true});await writeFile(join(sdk,'package.json'),'{}');await writeFile(join(sdk,'src/editor.ts'),'first');await writeFile(join(host,'scripts/openchatcut-test.mjs'),'host');
 const build=vi.fn(async(_sdk,out)=>{await mkdir(out,{recursive:true});await writeFile(join(out,'index.html'),'<script src="main.js"></script>');await writeFile(join(out,'main.js'),'program');return out;});
 return{root,sdk,host,cache,build,prepare:()=>prepareStudioProgram({sdkRoot:sdk,cacheRoot:cache,sourceRoot:host,build}),close:()=>rm(root,{recursive:true,force:true})};
}
it('coalesces program builds, reuses exact bytes and gives concurrent Vite writers a private fallback',async()=>{
 const f=await fixture();try{
  const [a,b]=await Promise.all([f.prepare(),f.prepare()]);expect(f.build).toHaveBeenCalledTimes(1);expect(a.bundle).toBe(b.bundle);
  const v1=await acquireStudioViteCache(a,'private-a'),v2=await acquireStudioViteCache(b,'private-b');expect(v2.directory).toBe('private-b');await v1.release();const v3=await acquireStudioViteCache(b,'private-c');expect(v3.directory).toBe(v1.directory);await v3.release();await v2.release();await a.release();await b.release();
  const c=await f.prepare();expect(c.cacheHit).toBe(true);expect(f.build).toHaveBeenCalledTimes(1);await c.release();
 }finally{await f.close();}
});
it('invalidates equal-size/equal-mtime SDK edits and host adapter edits',async()=>{
 const f=await fixture();try{
  const a=await f.prepare();await a.release();const fixed=new Date('2026-01-01');await utimes(join(f.sdk,'src/editor.ts'),fixed,fixed);await writeFile(join(f.sdk,'src/editor.ts'),'other');await utimes(join(f.sdk,'src/editor.ts'),fixed,fixed);
  const b=await f.prepare();expect(b.key).not.toBe(a.key);await b.release();await writeFile(join(f.host,'scripts/openchatcut-test.mjs'),'changed');const c=await f.prepare();expect(c.key).not.toBe(b.key);expect(f.build).toHaveBeenCalledTimes(3);await c.release();
 }finally{await f.close();}
});
it('repairs incomplete or corrupted output and retries a failed build',async()=>{
 const f=await fixture();try{
  const a=await f.prepare();await a.release();await writeFile(join(a.bundle,'main.js'),'corrupt');const b=await f.prepare();expect(await readFile(join(b.bundle,'main.js'),'utf8')).toBe('program');await b.release();
  await rm(join(b.bundle,'index.html'));f.build.mockRejectedValueOnce(Error('compiler failed'));await expect(f.prepare()).rejects.toThrow('compiler failed');const c=await f.prepare();expect(c.cacheHit).toBe(false);await c.release();
 }finally{await f.close();}
});
it('keeps active versions and bounds inactive retention without following links',async()=>{
 const f=await fixture();try{
  const a=await f.prepare();await writeFile(join(f.sdk,'src/editor.ts'),'version2');const b=await f.prepare();await b.release();await writeFile(join(f.sdk,'src/editor.ts'),'version3');const c=await f.prepare();await c.release();
  await pruneStudioProgramCache(f.cache,{maxEntries:1,maxBytes:100000});await expect(access(a.directory)).resolves.toBeUndefined();await expect(access(b.directory)).rejects.toThrow();await a.release();
  const foreign=join(f.root,'foreign');await mkdir(foreign);await writeFile(join(foreign,'keep'),'safe');await symlink(foreign,join(f.cache,'f'.repeat(64)));await pruneStudioProgramCache(f.cache,{maxEntries:0,maxBytes:0});expect(await readFile(join(foreign,'keep'),'utf8')).toBe('safe');
 }finally{await f.close();}
});
it('does not publish a build whose source changes while compiling',async()=>{
 const f=await fixture();try{
  const original=f.build.getMockImplementation();f.build.mockImplementationOnce(async(...args)=>{const out=await original(...args);await writeFile(join(f.sdk,'src/editor.ts'),'changed during compile');return out;});await expect(f.prepare()).rejects.toThrow(/changed/);const next=await f.prepare();expect(next.cacheHit).toBe(false);await next.release();
 }finally{await f.close();}
});

it('recovers exited compiler owners and removes stale reader leases',async()=>{
 const f=await fixture();try{
  await mkdir(f.cache);await writeFile(join(f.cache,'.maintenance'),JSON.stringify({pid:2147483647,token:'exited'}));
  const a=await f.prepare();await a.release();
  await writeFile(join(a.directory,'.vite-owner'),JSON.stringify({pid:2147483647,token:'exited'}));
  await writeFile(join(a.directory,'.lease-exited.json'),JSON.stringify({pid:2147483647}));
  const b=await f.prepare(),vite=await acquireStudioViteCache(b,'private');expect(vite.directory).not.toBe('private');await vite.release();await b.release();
  await pruneStudioProgramCache(f.cache,{maxEntries:0,maxBytes:0});await expect(access(a.directory)).rejects.toThrow();
 }finally{await f.close();}
});
