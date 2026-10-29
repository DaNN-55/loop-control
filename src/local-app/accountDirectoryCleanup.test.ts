// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,realpath,lstat,rename,rm,symlink,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {planEmptyAccountDirectories,cleanupEmptyAccountDirectories} from './accountDirectoryCleanup';

it('removes only empty blueprint roots and registered copies, preserving directories with any contents',async()=>{
 const temporary=await realpath(await mkdtemp(join(tmpdir(),'account-empty-'))),media=join(temporary,'media'),root=join(media,'account'),old=join(temporary,'old'),copy=join(old,'account'),nonempty=join(media,'nonempty'),outside=join(temporary,'history');
 try{
  for(const path of [root,copy,nonempty,outside])await mkdir(path,{recursive:true});
  await writeFile(join(nonempty,'.DS_Store'),'hidden metadata');await writeFile(join(outside,'keep.txt'),'history and other account data');
  const targets=await planEmptyAccountDirectories(media,[root,nonempty,outside],[old]);
  expect(targets.map(t=>t.path)).toEqual([root,copy]);
  expect((await cleanupEmptyAccountDirectories(targets,async()=>false)).map(r=>r.status)).toEqual(['removed','removed']);
  for(const path of [root,copy])await expect(lstat(path)).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(join(nonempty,'.DS_Store'),'utf8')).toBe('hidden metadata');
  expect(await readFile(join(outside,'keep.txt'),'utf8')).toBe('history and other account data');
  expect((await lstat(media)).isDirectory()).toBe(true);
 }finally{await rm(temporary,{recursive:true,force:true});}
});

it('keeps shared roots, new contents and replacements, and never follows a directory link',async()=>{
 const temporary=await realpath(await mkdtemp(join(tmpdir(),'account-kept-'))),media=join(temporary,'media'),shared=join(media,'shared'),changed=join(media,'changed'),replaced=join(media,'replaced'),linked=join(media,'linked'),outside=join(temporary,'outside');
 try{
  for(const path of [shared,changed,replaced,outside])await mkdir(path,{recursive:true});
  await symlink(outside,linked,'dir');
  const targets=await planEmptyAccountDirectories(media,[shared,changed,replaced,linked],[]);
  expect(targets.map(t=>t.path)).toEqual([shared,changed,replaced]);
  await writeFile(join(changed,'new.txt'),'new material');
  await rename(replaced,replaced+'-original');await mkdir(replaced);
  expect((await cleanupEmptyAccountDirectories(targets,async aliases=>aliases.includes(shared))).map(r=>r.status)).toEqual(['retained','retained','retained']);
  for(const path of [shared,replaced,outside])expect((await lstat(path)).isDirectory()).toBe(true);
  expect(await readFile(join(changed,'new.txt'),'utf8')).toBe('new material');
 }finally{await rm(temporary,{recursive:true,force:true});}
});

it('keeps an empty child directory and supports safe retry after permission failure',async()=>{
 const temporary=await realpath(await mkdtemp(join(tmpdir(),'account-retry-'))),media=join(temporary,'media'),root=join(media,'empty'),nested=join(media,'nested');
 try{
  await mkdir(root,{recursive:true});await mkdir(join(nested,'episodes'),{recursive:true});
  const targets=await planEmptyAccountDirectories(media,[root,nested],[]);expect(targets.map(t=>t.path)).toEqual([root]);
  await chmod(media,0o500);
  expect((await cleanupEmptyAccountDirectories(targets,async()=>false))[0].status).toBe('retained');
  await chmod(media,0o700);
  expect((await cleanupEmptyAccountDirectories(targets,async()=>false))[0].status).toBe('removed');
  expect((await cleanupEmptyAccountDirectories(targets,async()=>false))[0].status).toBe('missing');
  expect((await lstat(join(nested,'episodes'))).isDirectory()).toBe(true);
 }finally{await chmod(media,0o700).catch(()=>{});await rm(temporary,{recursive:true,force:true});}
});
