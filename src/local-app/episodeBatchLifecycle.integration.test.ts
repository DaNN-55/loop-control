// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {lstat,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_BATCH_LIFECYCLE_ACCEPTANCE!=='1')('applies Owner-only title changes once and keeps the production directory and files in place',async()=>{
 if(!process.env.LOOP_TEST_CONTEXT_MODULE)throw Error('Explicit isolated test context required');
 const f=await embeddedStudioFixture();
 try{
  const get=async()=>{
   const response=await fetch(f.origin+'/api/local/episodes/'+f.episode,{headers:{Cookie:'loop_owner_session='+f.token}});
   expect(response.status).toBe(200);
   return (await response.json()).sections;
  };
  const before=await get(),original='隔离 Studio153 验收',title='新版 / 显示标题';
  const directory=before.localDirectoryPath,probe=join(directory,'handwritten.txt');
  await writeFile(probe,'original production bytes');
  const beforeStat=await lstat(directory);
  const key=randomUUID();
  const rename=async(next:string,token=f.token,csrf=true,idempotencyKey=key)=>{
   const response=await fetch(f.origin+'/api/local/episode-lifecycle',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({
    command:'applyEpisodeBatchItem',idempotencyKey,data:{episodeId:f.episode,action:'rename',expectedTitle:original,title:next},
   })});
   return {status:response.status,body:await response.json()};
  };
  expect(await rename(title,f.token,false)).toMatchObject({status:403});
  expect(await rename(title,f.otherToken)).toMatchObject({status:200,body:{episodeId:f.episode,status:'skipped'}});
  const applied=await rename(title);
  expect(applied).toEqual({status:200,body:{episodeId:f.episode,status:'success'}});
  expect(await rename(title)).toEqual(applied);
  expect(await rename('different payload')).toMatchObject({status:409});
  expect(await rename('stale preview',f.token,true,randomUUID())).toMatchObject({status:200,body:{status:'skipped',reason:expect.any(String)}});
  const after=await get(),afterStat=await lstat(directory);
  expect(after.episode.title).toBe(title);
  expect(after.localDirectoryPath).toBe(directory);
  expect([afterStat.dev,afterStat.ino]).toEqual([beforeStat.dev,beforeStat.ino]);
  expect(await readFile(probe,'utf8')).toBe('original production bytes');
 }finally{await f.close();}
},30000);

it.skipIf(process.env.LOOP_BATCH_LIFECYCLE_ACCEPTANCE!=='1')('archives and unarchives eligible orders and skips already-applied and protected states',async()=>{
 if(!process.env.LOOP_TEST_CONTEXT_MODULE)throw Error('Explicit isolated test context required');
 const f=await embeddedStudioFixture();
 try{
  const apply=(action:'archive'|'unarchive',token=f.token)=>f.post('episode-lifecycle','applyEpisodeBatchItem',{episodeId:f.episode,action},{token});
  const read=async()=>{
   const response=await fetch(f.origin+'/api/local/episodes/'+f.episode,{headers:{Cookie:'loop_owner_session='+f.token}});
   expect(response.status).toBe(200);
   return (await response.json()).sections.episode;
  };
  expect(await apply('unarchive')).toMatchObject({status:200,body:{status:'skipped',reason:expect.any(String)}});
  expect(await apply('archive',f.otherToken)).toMatchObject({status:200,body:{status:'skipped',reason:expect.any(String)}});
  const migration=randomUUID(),accountId=(await read()).account_id;
  await f.c.query("INSERT INTO local_identity.account_directory_migrations(id,account_id,status,manifest) VALUES($1,$2,'copying','{}')",[migration,accountId]);
  const blocked=await apply('archive');
  expect(blocked).toMatchObject({status:409,body:{error:'账号资料正在迁移，请先完成、恢复或回滚原操作。'}});
  expect((await read()).archived_at).toBeNull();
  await f.c.query("UPDATE local_identity.account_directory_migrations SET status='rolled_back' WHERE id=$1",[migration]);
  expect(await apply('archive')).toMatchObject({status:200,body:{status:'success'}});
  const archived=await read();
  expect(archived.archived_at).toBeTruthy();
  expect(await apply('archive')).toMatchObject({status:200,body:{status:'skipped'}});
  expect(await read()).toEqual(archived);
  await f.c.query('INSERT INTO local_identity.historical_episodes(episode_id) VALUES($1)',[f.episode]);
  expect(await apply('unarchive')).toMatchObject({status:200,body:{status:'skipped',reason:expect.any(String)}});
  await f.c.query('DELETE FROM local_identity.historical_episodes WHERE episode_id=$1',[f.episode]);
  expect(await apply('unarchive')).toMatchObject({status:200,body:{status:'success'}});
  expect((await read()).archived_at).toBeNull();
  expect(await f.post('episode-lifecycle','archiveEpisode',{episodeId:f.episode,archived:true})).toMatchObject({status:200,body:{id:f.episode,archived_at:expect.any(String)}});
  expect(await f.post('episode-lifecycle','renameEpisode',{episodeId:f.episode,title:'单张重命名'})).toMatchObject({status:200,body:{id:f.episode,title:'单张重命名'}});
 }finally{await f.close();}
},30000);
