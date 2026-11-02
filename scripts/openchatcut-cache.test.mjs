// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,utimes,realpath,rm,access,symlink,open,link} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pruneOpenChatCutCache} from './openchatcut-cache.mjs';

const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function fixture() {
  const root=await realpath(await mkdtemp(join(tmpdir(),'loop-cache-retention-')));roots.push(root);
  const cache=join(root,'node_modules/.cache/webpack'),version=join(cache,'remotion-production-4.0.509');
  await mkdir(version,{recursive:true});
  const packs=[];
  for(let i=0;i<4;i++) {
    const directory=join(version,String(i).padStart(32,'0'));await mkdir(directory);
    const pack=join(directory,'0.pack');await writeFile(pack,'rebuildable compiler data');await utimes(pack,100+i,100+i);packs.push(directory);
  }
  return {root,cache,version,packs};
}
const exists=path=>access(path).then(()=>true,()=>false);

it('retains the two most recently written packs and preserves unrelated files',async()=>{
  const f=await fixture(),unknown=join(f.cache,'unrelated-cache');await mkdir(unknown);await writeFile(join(unknown,'keep'),'keep');
  await writeFile(join(f.version,'unrecognized-file'),'keep');
  const result=await pruneOpenChatCutCache(f.root);
  expect(result).toMatchObject({status:'pruned',keptEntries:2});
  expect(await Promise.all(f.packs.map(exists))).toEqual([false,false,true,true]);
  expect(await exists(join(unknown,'keep'))).toBe(true);expect(await exists(join(f.version,'unrecognized-file'))).toBe(true);
});
it('also respects allocated byte limits and permits an explicit full cache clear',async()=>{
  const f=await fixture();
  const result=await pruneOpenChatCutCache(f.root,{maxBytes:4096,maxEntries:2});
  expect(result.keptBytes).toBeLessThanOrEqual(4096);expect(result.keptEntries).toBeLessThanOrEqual(1);
  const cleared=await pruneOpenChatCutCache(f.root,{maxBytes:0,maxEntries:0});expect(cleared.status).toBe('pruned');
  expect(await Promise.all(f.packs.map(exists))).toEqual([false,false,false,false]);
});
it('skips a cache with an actual open pack file',async()=>{
  const f=await fixture(),fd=await open(join(f.packs[0],'0.pack'),'r');
  try {expect(await pruneOpenChatCutCache(f.root,{maxEntries:0})).toMatchObject({status:'skipped',reason:'in-use'});}
  finally {await fd.close();}
  expect(await Promise.all(f.packs.map(exists))).toEqual([true,true,true,true]);
});
it('skips an active SDK process even when it has no cache fd open',async()=>{
  const f=await fixture(),child=spawn(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{cwd:f.root,stdio:['ignore','pipe','pipe']});
  try {
    await once(child.stdout,'data');
    expect(await pruneOpenChatCutCache(f.root,{maxEntries:0})).toMatchObject({status:'skipped',reason:'in-use'});
    expect(await Promise.all(f.packs.map(exists))).toEqual([true,true,true,true]);
  } finally {child.kill();await once(child,'close');}
});
it.each(['symlink','hardlink'])('preserves the whole cache if a pack contains a %s',async kind=>{
  const f=await fixture(),source=join(f.root,'important-file');await writeFile(source,'keep');
  if(kind==='symlink')await symlink(source,join(f.packs[0],'unsafe'));else await link(source,join(f.packs[0],'unsafe'));
  expect((await pruneOpenChatCutCache(f.root,{maxEntries:0})).status).toBe('skipped');
  expect(await Promise.all(f.packs.map(exists))).toEqual([true,true,true,true]);expect(await exists(source)).toBe(true);
});
it('does not follow an aliased SDK root or create missing caches',async()=>{
  const f=await fixture(),alias=join(f.root,'alias');await symlink(f.root,alias);
  expect(await pruneOpenChatCutCache(alias)).toMatchObject({status:'skipped',reason:'unsafe-path'});
  const absent=join(f.root,'absent');expect(await pruneOpenChatCutCache(absent)).toEqual({status:'absent'});expect(await exists(absent)).toBe(false);
});
