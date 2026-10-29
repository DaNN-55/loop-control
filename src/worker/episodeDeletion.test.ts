import{it,expect}from'vitest';
import{mkdtemp,mkdir,writeFile,readFile,rename,symlink,rm,lstat,readlink,chmod,realpath}from'node:fs/promises';
import{join}from'node:path';
import{tmpdir}from'node:os';
import{stageLocalEpisodeDirectoryForDeletion,restoreStagedLocalEpisodeDirectory,finalizeStagedLocalEpisodeDirectory}from'./episodeDeletion';
it('stages an Episode reversibly and rejects a replaced staging parent before cleanup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'t22-delete-')),id='00000000-0000-4000-8000-000000000022';
 try{
  await mkdir(join(root,'episodes',id),{recursive:true});await writeFile(join(root,'episodes',id,'evidence.txt'),'recoverable synthetic data');
  const staged=await stageLocalEpisodeDirectoryForDeletion(root,id);expect(staged.existed).toBe(true);
  await restoreStagedLocalEpisodeDirectory(root,id);expect(await readFile(join(root,'episodes',id,'evidence.txt'),'utf8')).toBe('recoverable synthetic data');
  await stageLocalEpisodeDirectoryForDeletion(root,id);
  await rename(join(root,'episodes','.deletion-staging'),join(root,'kept-staging'));
  await symlink(join(root,'kept-staging'),join(root,'episodes','.deletion-staging'),'dir');
  await expect(finalizeStagedLocalEpisodeDirectory(root,id)).rejects.toThrow('父目录不是安全目录');
  expect(await readFile(join(root,'kept-staging',id,'evidence.txt'),'utf8')).toBe('recoverable synthetic data');
  await rm(join(root,'episodes','.deletion-staging'));await rename(join(root,'kept-staging'),join(root,'episodes','.deletion-staging'));
  expect(await finalizeStagedLocalEpisodeDirectory(root,id)).toBe(true);expect(await finalizeStagedLocalEpisodeDirectory(root,id)).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('cleans only exact title links after commit, preserving other orders, history and originals',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'episode-title-cleanup-'))),id='00000000-0000-4000-8000-000000000023',other='00000000-0000-4000-8000-000000000024',episodes=join(root,'episodes'),navigation=join(episodes,'按标题浏览');
 try{
  await mkdir(join(episodes,id),{recursive:true});await writeFile(join(episodes,id,'output.txt'),'generated');
  await mkdir(join(episodes,other));await writeFile(join(episodes,other,'keep.txt'),'other order');
  for(const folder of ['history','materials']){await mkdir(join(root,folder));await writeFile(join(root,folder,'keep.txt'),folder);}
  await mkdir(navigation);
  await symlink('../'+id,join(navigation,'旧标题'),'dir');await symlink(join(episodes,id),join(navigation,'新标题'),'dir');
  await symlink('../'+other,join(navigation,'其他生产单'),'dir');await symlink('../missing-order',join(navigation,'其他失效链接'),'dir');
  await mkdir(join(navigation,'普通目录'));
  await stageLocalEpisodeDirectoryForDeletion(root,id);
  expect((await lstat(join(navigation,'旧标题'))).isSymbolicLink()).toBe(true);
  await restoreStagedLocalEpisodeDirectory(root,id);
  expect(await readFile(join(navigation,'旧标题','output.txt'),'utf8')).toBe('generated');
  await stageLocalEpisodeDirectoryForDeletion(root,id);
  expect(await finalizeStagedLocalEpisodeDirectory(root,id)).toBe(true);
  for(const name of ['旧标题','新标题'])await expect(lstat(join(navigation,name))).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(join(episodes,other,'keep.txt'),'utf8')).toBe('other order');
  expect(await readlink(join(navigation,'其他失效链接'))).toBe('../missing-order');
  expect((await lstat(join(navigation,'普通目录'))).isDirectory()).toBe(true);
  for(const folder of ['history','materials'])expect(await readFile(join(root,folder,'keep.txt'),'utf8')).toBe(folder);
  await expect(lstat(join(episodes,'.deletion-staging'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});

it('removes empty Episode containers while retaining the account and supports an already absent staged directory',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'episode-empty-cleanup-'))),id='00000000-0000-4000-8000-000000000025';
 try{
  const navigation=join(root,'episodes','按标题浏览');await mkdir(navigation,{recursive:true});await symlink('../'+id,join(navigation,'已删除'),'dir');
  expect(await finalizeStagedLocalEpisodeDirectory(root,id)).toBe(false);
  await expect(lstat(join(root,'episodes'))).rejects.toMatchObject({code:'ENOENT'});
  expect((await lstat(root)).isDirectory()).toBe(true);
  expect(await finalizeStagedLocalEpisodeDirectory(root,id)).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('retries title cleanup after the staged files have already been removed',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'episode-cleanup-retry-'))),id='00000000-0000-4000-8000-000000000026',navigation=join(root,'episodes','按标题浏览');
 try{
  await mkdir(join(root,'episodes',id),{recursive:true});await mkdir(navigation);await symlink('../'+id,join(navigation,'标题'),'dir');
  await stageLocalEpisodeDirectoryForDeletion(root,id);await chmod(navigation,0o500);
  await expect(finalizeStagedLocalEpisodeDirectory(root,id)).rejects.toMatchObject({code:'EACCES'});
  await expect(lstat(join(root,'episodes','.deletion-staging',id))).rejects.toMatchObject({code:'ENOENT'});
  await chmod(navigation,0o700);
  expect(await finalizeStagedLocalEpisodeDirectory(root,id)).toBe(false);
  await expect(lstat(join(root,'episodes'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await chmod(navigation,0o700).catch(()=>{});await rm(root,{recursive:true,force:true});}
});

it('rejects linked navigation directories and recreated Episode directories without deleting their targets',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'episode-cleanup-boundary-'))),outside=await realpath(await mkdtemp(join(tmpdir(),'episode-title-outside-'))),id='00000000-0000-4000-8000-000000000027',episodes=join(root,'episodes');
 try{
  await mkdir(join(episodes,id),{recursive:true});await writeFile(join(episodes,id,'output.txt'),'staged data');
  await symlink(join(episodes,id),join(outside,'保留标题'),'dir');await symlink(outside,join(episodes,'按标题浏览'),'dir');
  await stageLocalEpisodeDirectoryForDeletion(root,id);
  await expect(finalizeStagedLocalEpisodeDirectory(root,id)).rejects.toThrow('安全目录');
  expect((await lstat(join(outside,'保留标题'))).isSymbolicLink()).toBe(true);
  await rm(join(episodes,'按标题浏览'));
  await mkdir(join(episodes,id));await writeFile(join(episodes,id,'keep.txt'),'unconfirmed replacement');
  await expect(finalizeStagedLocalEpisodeDirectory(root,id)).rejects.toThrow('重新出现');
  expect(await readFile(join(episodes,id,'keep.txt'),'utf8')).toBe('unconfirmed replacement');
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
