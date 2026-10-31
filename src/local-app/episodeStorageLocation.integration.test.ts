// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,lstat,readFile,rename,symlink,rmdir,copyFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {csrfFor} from './sessions';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner opens the full production directory, including legacy archived productions, without creating input folders',async()=>{
 const f=await embeddedStudioFixture();
 try{
  await f.c.query('DELETE FROM local_identity.input_episodes WHERE episode_id=$1',[f.episode]);
  await f.c.query('UPDATE public.episodes SET archived_at=now() WHERE id=$1',[f.episode]);
  const result=await f.request('openDirectory');expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body).toMatchObject({opened:true,path:join(f.assetRoot,'episodes',f.episode)});
  await expect(lstat(join(f.assetRoot,'episodes',f.episode,'input'))).rejects.toMatchObject({code:'ENOENT'});
  const file=f.files[0],response=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(file.relativePath)}&sha256=${file.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(join(f.assetRoot,file.relativePath)));
 }finally{await f.close();}
},300000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('persisted collection paths survive restart and rename; Owner HTTP preview/open reject foreign, missing and replaced locations',async()=>{
 const f=await embeddedStudioFixture();
 try{
  const relativePath='系列 stable-collection/生产单 stable-production',path=join(f.assetRoot,relativePath);await mkdir(path,{recursive:true});const identity=await lstat(path,{bigint:true});
  await f.c.query('UPDATE local_identity.episode_asset_locations SET directory_relative_path=$2,directory_device_id=$3,directory_inode_id=$4,layout_version=2 WHERE episode_id=$1',[f.episode,relativePath,String(identity.dev),String(identity.ino)]);
  const original=f.files[0],artifactPath=relativePath+'/owned.mp4';await copyFile(join(f.assetRoot,original.relativePath),join(f.assetRoot,artifactPath));await f.c.query("INSERT INTO public.artifacts(episode_id,producer_task_id,artifact_type,relative_path,sha256,file_size) VALUES($1,$2,'render',$3,$4,$5)",[f.episode,f.task,artifactPath,original.sha256,original.fileSize]);
  await f.c.query("UPDATE public.episodes SET title='改名不移动' WHERE id=$1",[f.episode]);await f.restart();
  const detail=await(await fetch(f.origin+'/api/local/episodes/'+f.episode,{headers:{Cookie:'loop_owner_session='+f.token}})).json();expect(detail.sections.localDirectoryPath).toBe(path);
  const opened=await f.request('openDirectory');expect(opened.status,JSON.stringify(opened.body)).toBe(200);expect(opened.body.path).toBe(path);
  const preview=await fetch(f.origin+`/_local-artifact?episode=${f.episode}&path=${encodeURIComponent(artifactPath)}&sha256=${original.sha256}`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(preview.status).toBe(200);expect(Buffer.from(await preview.arrayBuffer())).toEqual(await readFile(join(f.assetRoot,original.relativePath)));
  expect((await f.request('openDirectory',{}, {token:f.otherToken})).status).toBe(404);expect((await f.request('openDirectory',{}, {csrf:false})).status).toBe(403);expect((await f.request('openDirectory',{path:'/tmp'})).status).toBe(400);
  await rename(path,path+'-original');const missing=await f.request('openDirectory');expect(missing.status).toBe(409);expect(missing.body.error).toContain('缺失');await expect(lstat(path)).rejects.toMatchObject({code:'ENOENT'});
  await mkdir(path);const replaced=await f.request('openDirectory');expect(replaced.status).toBe(409);expect(replaced.body.error).toContain('身份');await rmdir(path);await symlink(path+'-original',path);const alias=await f.request('openDirectory');expect(alias.status).toBe(409);expect(alias.body.error).toContain('身份');
 }finally{await f.close();}
},300000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('a repeated folder-open action rechecks location availability and reports actual permission failures',async()=>{
 const f=await embeddedStudioFixture();
 try{
  const path=join(f.assetRoot,'episodes',f.episode),body=JSON.stringify({command:'openDirectory',data:{episodeId:f.episode},idempotencyKey:randomUUID()}),open=()=>fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body});
  expect((await open()).status).toBe(200);await rename(path,path+'-offline');const repeated=await open();expect(repeated.status).toBe(409);expect((await repeated.json()).error).toContain('缺失');await rename(path+'-offline',path);
  await chmod(path,0);try{const denied=await f.request('openDirectory');expect(denied.status).toBe(403);expect(denied.body.error).toContain('权限');}finally{await chmod(path,0o700);}
 }finally{await f.close();}
},300000);
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('desktop-open failure remains recoverable without starting production or changing files',async()=>{
 const f=await embeddedStudioFixture({runtime:{openDirectory:async()=>{throw Error('controlled desktop session unavailable');}}});
 try{const result=await f.request('openDirectory');expect(result.status).toBe(503);expect(result.body.error).toContain('复制路径');const file=f.files[0];expect((await readFile(join(f.assetRoot,file.relativePath))).length).toBe(file.fileSize);expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(1);}finally{await f.close();}
},300000);
