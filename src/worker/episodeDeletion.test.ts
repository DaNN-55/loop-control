import{it,expect}from'vitest';
import{mkdtemp,mkdir,writeFile,readFile,rename,symlink,rm}from'node:fs/promises';
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
