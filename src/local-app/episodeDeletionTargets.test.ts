// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink,rm,realpath,lstat,readlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {episodeDeletionTargets,verifyEpisodeDeletionTarget} from './episodeDeletionTargets';
import {stageLocalEpisodeDirectoryForDeletion,finalizeStagedLocalEpisodeDirectory} from '../worker/episodeDeletion';

it('discovers only registered copies of this account/ID and preserves originals, symlink destinations and other orders',async()=>{
 const temporary=await realpath(await mkdtemp(join(tmpdir(),'loop-delete-targets-'))),media=join(temporary,'media'),root=join(media,'account'),old=join(temporary,'old'),copy=join(old,'account'),id=randomUUID(),other=randomUUID(),original=join(temporary,'original.txt');
 try{
  await writeFile(original,'original source');
  for(const account of [root,copy,join(temporary,'unregistered','account')]){
   await mkdir(join(account,'episodes',id),{recursive:true});await writeFile(join(account,'episodes',id,'output.txt'),'generated output');
   await mkdir(join(account,'episodes',other));await writeFile(join(account,'episodes',other,'keep.txt'),'other order');
   await mkdir(join(account,'materials'));await writeFile(join(account,'materials','raw.txt'),'original media');
  }
  await symlink(original,join(copy,'episodes',id,'source-link'));
  await symlink(join(copy,'materials'),join(copy,'episodes',id,'original-library'),'dir');
  const targets=await episodeDeletionTargets(media,root,id,[old,old,join(temporary,'absent')]);
  expect(targets.map(t=>t.path)).toEqual([join(root,'episodes',id),join(copy,'episodes',id)]);
  for(const target of targets){await verifyEpisodeDeletionTarget(target,'original');await stageLocalEpisodeDirectoryForDeletion(target.root,id);await verifyEpisodeDeletionTarget(target,'staged');await finalizeStagedLocalEpisodeDirectory(target.root,id);}
  expect(await readFile(original,'utf8')).toBe('original source');
  for(const account of [root,copy]){expect(await readFile(join(account,'materials','raw.txt'),'utf8')).toBe('original media');expect(await readFile(join(account,'episodes',other,'keep.txt'),'utf8')).toBe('other order');}
  expect(await readFile(join(temporary,'unregistered','account','episodes',id,'output.txt'),'utf8')).toBe('generated output');
 }finally{await rm(temporary,{recursive:true,force:true});}
});
it('rejects a replaced directory or a link to original media before deleting anything',async()=>{
 const temporary=await realpath(await mkdtemp(join(tmpdir(),'loop-delete-identity-'))),media=join(temporary,'media'),root=join(media,'account'),id=randomUUID(),path=join(root,'episodes',id);
 try{
  await mkdir(path,{recursive:true});await writeFile(join(path,'keep.txt'),'original output');
  const [target]=await episodeDeletionTargets(media,root,id,[]);
  await rename(path,path+'-preserved');await mkdir(path);
  await expect(verifyEpisodeDeletionTarget(target,'original')).rejects.toThrow('已变化');
  await rm(path,{recursive:true});await symlink(path+'-preserved',path,'dir');
  await expect(episodeDeletionTargets(media,root,id,[])).rejects.toThrow('安全目录');
  expect(await readFile(join(path+'-preserved','keep.txt'),'utf8')).toBe('original output');
  await rm(path);await rename(path+'-preserved',path);
  await stageLocalEpisodeDirectoryForDeletion(root,id);
  await rename(target.stagingPath,target.stagingPath+'-preserved');await mkdir(target.stagingPath);await writeFile(join(target.stagingPath,'keep.txt'),'unconfirmed replacement');
  await expect(verifyEpisodeDeletionTarget(target,'staged')).rejects.toThrow('已变化');
  expect(await readFile(join(target.stagingPath,'keep.txt'),'utf8')).toBe('unconfirmed replacement');
  expect(await readFile(join(target.stagingPath+'-preserved','keep.txt'),'utf8')).toBe('original output');
 }finally{await rm(temporary,{recursive:true,force:true});}
});
it('blocks when a configured external volume is unavailable, without creating a mount directory',async()=>{
 const temporary=await realpath(await mkdtemp(join(tmpdir(),'loop-delete-offline-'))),root=join(temporary,'account');
 try{await mkdir(root);await expect(episodeDeletionTargets(temporary,root,randomUUID(),['/Volumes/loop-delete-offline-'+randomUUID()])).rejects.toThrow('外部盘不可访问');}
 finally{await rm(temporary,{recursive:true,force:true});}
});
it('includes a registered copy with only this Episode title link left, excluding other dangling titles',async()=>{
 const temporary=await realpath(await mkdtemp(join(tmpdir(),'loop-delete-title-targets-'))),media=join(temporary,'media'),root=join(media,'account'),old=join(temporary,'old'),copy=join(old,'account'),unrelated=join(temporary,'unrelated'),id=randomUUID();
 try{
  await mkdir(root,{recursive:true});
  for(const account of [copy,join(unrelated,'account')])await mkdir(join(account,'episodes','按标题浏览'),{recursive:true});
  await symlink('../'+id,join(copy,'episodes','按标题浏览','旧标题'),'dir');
  await symlink('../'+randomUUID(),join(unrelated,'account','episodes','按标题浏览','无关标题'),'dir');
  const targets=await episodeDeletionTargets(media,root,id,[old,unrelated]);
  expect(targets.map(t=>t.path)).toEqual([join(root,'episodes',id),join(copy,'episodes',id)]);
  for(const target of targets){expect(target.identity).toBeNull();await verifyEpisodeDeletionTarget(target,'staged');await finalizeStagedLocalEpisodeDirectory(target.root,id);}
  await expect(lstat(join(copy,'episodes','按标题浏览','旧标题'))).rejects.toMatchObject({code:'ENOENT'});
  expect(await readlink(join(unrelated,'account','episodes','按标题浏览','无关标题'))).toMatch(/^\.\.\//);
 }finally{await rm(temporary,{recursive:true,force:true});}
});
