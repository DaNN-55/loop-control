// @vitest-environment node
import {it,expect} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectionCatalogFixture} from './connectionCatalog.fixture';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('distinguishes an empty Owner history from search, archive and content filters through read-only HTTP',async()=>{
 const f=await connectionCatalogFixture();
 try{
  const events:{path:string;status:number}[]=[];
  const read=async(path:string,token=f.token)=>{const r=await fetch(f.origin+'/api/local/'+path,{headers:token?{Cookie:'loop_owner_session='+token}:{}});events.push({path,status:r.status});return{status:r.status,body:await r.json()};};
  const empty=await read('history-episodes');expect(empty.status).toBe(200);expect(empty.body.totalHistory).toBe(0);
  expect((await read('history')).body.sourceCounts).toEqual({active:0,archived:0});
  if(process.env.LOOP_HISTORY_BROWSER_MODULE){const browser=await import(process.env.LOOP_HISTORY_BROWSER_MODULE);await browser.verify({f,phase:'empty'});}
  const source=randomBytes(32).toString('hex'),foreign=randomBytes(32).toString('hex'),ids=[randomUUID(),randomUUID(),randomUUID()];
  await f.admin.query("INSERT INTO local_identity.history_sources(id,owner_id,kind,label)VALUES($1,$2,'postgres','独立诊断来源'),($3,$4,'postgres','other private')",[source,f.owner,foreign,f.other]);
  for(let n=0;n<3;n++){
   const who=n===2?f.other:f.owner,src=n===2?foreign:source,id=ids[n],payload={id,title:'历史作品 '+n},sha=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
   await f.admin.query("INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload)VALUES('public.episodes',$1,$2,$3,$4)",[{id},sha,who,payload]);
   await f.admin.query("INSERT INTO local_identity.history_source_rows(source_id,table_name,row_key,payload_sha256)VALUES($1,'public.episodes',$2,$3)",[src,{id},sha]);
   if(n===1){await f.admin.query("INSERT INTO local_identity.history_files(source_id,logical_path,sha256,bytes,kind)VALUES($1,$2,$3,1,'text')",[source,`episodes/${id}/script.md`,sha]);await f.admin.query('INSERT INTO local_identity.history_episode_preferences(owner_id,episode_id,archived_at)VALUES($1,$2,now())',[who,id]);}
  }
  const account=(await f.admin.query('SELECT id FROM public.accounts LIMIT 1')).rows[0].id;
  await f.admin.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active)VALUES($1,$1,1,$2,true)",[account,{asset_root:f.root}]);
  await f.admin.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[account]);
  await f.admin.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage,archived_at)VALUES($1,$2,$2,'真实归档作品','waiting_input',now())",[ids[0],account]);
  const fingerprint=async()=>JSON.stringify((await f.admin.query("SELECT (SELECT jsonb_agg(to_jsonb(x)) FROM local_identity.history_sources x) sources,(SELECT jsonb_agg(to_jsonb(x)) FROM local_identity.history_versions x) versions,(SELECT jsonb_agg(to_jsonb(x)) FROM local_identity.history_episode_preferences x) preferences,(SELECT jsonb_agg(to_jsonb(x)) FROM local_identity.history_files x) files,(SELECT jsonb_agg(to_jsonb(x)) FROM local_identity.history_source_preferences x) sourcePreferences,(SELECT jsonb_agg(to_jsonb(x)) FROM local_identity.history_episode_deletions x) deletions,(SELECT jsonb_agg(to_jsonb(x)) FROM public.episodes x) episodes")).rows);
  const before=await fingerprint();
  for(const query of ['','?q=无匹配','?state=active','?state=archived','?contentOnly=false','?q=无匹配&state=all&contentOnly=false&page=2']){
   const result=await read('history-episodes'+query);expect(result.status).toBe(200);expect(result.body.totalHistory).toBe(2);
  }
  expect((await read('history-episodes?state=active')).body.total).toBe(0);
  expect((await read('history-episodes?state=archived')).body.items.map((x:{episode_id:string})=>x.episode_id)).toEqual([ids[1]]);
  expect((await read('history-episodes?contentOnly=false&state=all')).body.total).toBe(2);
  expect((await read('history-episodes',f.otherToken)).body.totalHistory).toBe(1);
  const noMatch=await read('history?sourcesQ=无匹配');expect(noMatch.body.sources).toEqual([]);expect(noMatch.body.sourceCounts).toEqual({active:1,archived:0});
  const sourceResult=await read('history?source='+source+'&q=无匹配');expect(sourceResult.body.source.id).toBe(source);expect(sourceResult.body.pagination.fileTotal).toBe(0);expect(sourceResult.body.pagination.versionTotal).toBe(0);
  expect((await read('history?source='+source,f.otherToken)).status).toBe(404);expect((await read('history-episodes','')).status).toBe(401);
  expect(await fingerprint()).toBe(before);expect(f.secretReads).toBe(0);
  if(process.env.LOOP_HISTORY_BROWSER_MODULE){const browser=await import(process.env.LOOP_HISTORY_BROWSER_MODULE);await browser.verify({f,source,ids,phase:'data'});}
  expect(await fingerprint()).toBe(before);
  if(process.env.LOOP_STORY_EVIDENCE)await writeFile(join(process.env.LOOP_STORY_EVIDENCE,'history-empty-states.json'),JSON.stringify({events,baseTotal:2,unchangedHistory:true,secretReads:f.secretReads,paidCalls:0},null,2));
 }finally{await f.close();}
},120000);
