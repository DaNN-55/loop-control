// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,link,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {archiveNativeStudioImports,type NativeStudioImport} from './nativeStudioImports';
async function fixture(){
 const root=await mkdtemp('/private/tmp/loop-native-import-'),base='episodes/test',dataDir=join(root,base,'openchatcut-work/current/runtime');
 await mkdir(join(dataDir,'media/uploads'),{recursive:true});
 const path=join(dataDir,'media/uploads/new-image.png');await writeFile(path,'first');
 const project={assets:[{id:'native',name:'自己的图片.png',kind:'image',src:'/media/uploads/new-image.png'}],timelines:[{items:[{id:'free-native-item',kind:'image',src:'/media/uploads/new-image.png',sourceAssetId:'native'}]}]};
 return{root,base,dataDir,path,project,run:(knownSources=new Map<string,string>(),imports:NativeStudioImport[]=[])=>archiveNativeStudioImports({assetRoot:root,episodeRelativePath:base,dataDir,project,knownSources,imports}),close:()=>rm(root,{recursive:true,force:true})};
}
it('archives real native bytes once and preserves the native URL and unbound clip identity',async()=>{
 const f=await fixture();try{
  const a=await f.run();expect(a.imports).toHaveLength(1);expect(a.imports[0]).toMatchObject({kind:'image',displayName:'自己的图片.png',fileSize:5});expect(await readFile(join(f.root,a.imports[0].relativePath),'utf8')).toBe('first');
  expect(a.sources.get('/media/uploads/new-image.png')).toBe(a.imports[0].relativePath);expect(f.project.timelines[0].items[0].id).toBe('free-native-item');expect(f.project.assets[0].src).toBe('/media/uploads/new-image.png');
  const b=await f.run(a.sources,a.imports);expect(b.imports).toEqual(a.imports);
 }finally{await f.close();}
});
it('archives changed upload bytes even when size and mtime match, without overwriting the earlier snapshot',async()=>{
 const f=await fixture();try{
  const a=await f.run(),fixed=new Date('2026-01-01');await writeFile(f.path,'other');await utimes(f.path,fixed,fixed);
  const b=await f.run(a.sources,a.imports);expect(b.sources.get('/media/uploads/new-image.png')).not.toBe(a.sources.get('/media/uploads/new-image.png'));expect(await readFile(join(f.root,a.imports[0].relativePath),'utf8')).toBe('first');expect(b.imports.at(-1)?.sha256).not.toBe(a.imports[0].sha256);
 }finally{await f.close();}
});
it.each(['symlink','hardlink'])('rejects a native upload %s before copying it',async kind=>{
 const f=await fixture();try{await rm(f.path);const outside=join(f.root,'outside');await writeFile(outside,'foreign');await(kind==='symlink'?symlink(outside,f.path):link(outside,f.path));await expect(f.run()).rejects.toThrow(/安全普通文件|符号链接/);}finally{await f.close();}
});
it('rejects escaped native paths and keeps missing-media failures recoverable',async()=>{
 const f=await fixture();try{
  f.project.assets[0].src='/media/uploads/%2e%2e%2foutside.png';await expect(f.run()).rejects.toThrow(/路径/);
  f.project.assets[0].src='/media/uploads/new-image.png';await rm(f.path);await expect(f.run()).rejects.toThrow();await writeFile(f.path,'retry');expect((await f.run()).imports).toHaveLength(1);
 }finally{await f.close();}
});

it('rehydrates a lost transient SDK upload from the verified immutable archive',async()=>{
 const f=await fixture();try{const a=await f.run();await rm(f.path);const b=await f.run(a.sources,a.imports);expect(b.imports).toEqual(a.imports);expect(await readFile(f.path,'utf8')).toBe('first');}finally{await f.close();}
});
