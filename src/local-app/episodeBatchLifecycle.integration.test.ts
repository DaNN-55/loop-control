// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {embeddedStudioFixture} from './embeddedStudio.fixture';

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
  expect(await f.post('episode-lifecycle','applyEpisodeBatchItem',{episodeId:f.episode,action:'rename',title:'旧批量改名请求',expectedTitle:(await read()).title})).toMatchObject({status:400});
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
