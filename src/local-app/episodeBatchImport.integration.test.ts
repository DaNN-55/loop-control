// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {lstat,readdir} from 'node:fs/promises';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {csrfFor} from './sessions';
import {createEpisodeReader} from '../episodes/episodeReadService';
import type {EpisodeProductionSnapshot} from '../episodes/episodeSnapshot';
import type {ImportedScript} from './episodeBatchImportTypes';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner import creates a batch of waiting scripts with stable directories and no production work',async()=>{
 const volume=await workspaceAudioVolume(),f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath},migrations:['db/current/220-episode-batch-import.sql']}).catch(async cause=>{await volume.close();throw cause;});
 const headers={Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)};
 const get=async(path:string)=>{
  const response=await fetch(f.origin+'/api/local/'+path,{headers});
  expect(response.status,await response.clone().text()).toBe(200);
  return response.json();
 };
 const send=async(path:string,body:unknown)=>{
  const response=await fetch(f.origin+'/api/local/'+path,{method:'POST',headers,body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 };
 const config=async(command:string,data:unknown)=>{
  const result=await send('configuration',{command,idempotencyKey:randomUUID(),data});
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  return result.body;
 };
 try{
  const account=await config('createAccount',{name:'批量建单验收',slug:'batch-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});
  const series=await config('createSeries',{accountId:account.id,name:'脚本导入',rules:{extension:{original:true}}});
  const first={itemId:randomUUID(),sourceName:'路灯.txt',title:'路灯',sourceText:'最后一盏灯仍然亮着。\r\n'};
  const second={itemId:randomUUID(),sourceName:'夜雨.md',title:'夜雨',sourceText:'# 夜雨\n\n窗外下起了雨。\n'};
  const batchId=randomUUID(),data={accountId:account.id,seriesVersionId:series.id,items:[first,second]};
  const invalid=await send('episode-imports',{action:'submit',batchId,...data,items:[first,{...second,sourceText:''}]});
  expect(invalid).toMatchObject({status:400,body:{error:expect.stringContaining('夜雨.md')}});
  const result=await send('episode-imports',{action:'submit',batchId,...data});
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({batchId,items:[{itemId:first.itemId,status:'succeeded'},{itemId:second.itemId,status:'succeeded'}]});
  expect((await get('episode-imports/'+batchId)).items).toEqual(result.body.items);
  expect((await fetch(f.origin+'/api/local/episode-imports/'+batchId,{headers:{Cookie:'loop_owner_session='+f.otherToken}})).status).toBe(404);
  const readEpisode=createEpisodeReader<EpisodeProductionSnapshot&{importedScript:ImportedScript;localDirectoryPath:string}>((episodeId,known)=>get('episodes/'+episodeId+'?known='+encodeURIComponent(JSON.stringify(known))));
  for(const [index,item] of [first,second].entries()){
   const episodeId=result.body.items[index].episodeId;
   const sections=await readEpisode(episodeId);
   expect(sections.episode).toMatchObject({stage:'waiting_input',main_script_revision_id:null,title:item.title,series_version_id:series.id});
   expect(sections.importedScript).toMatchObject({sourceName:item.sourceName,sourceText:item.sourceText,targetDuration:null,shots:[]});
   expect(sections.seriesVersion).toMatchObject({id:series.id,rules:{extension:{original:true}}});
   expect(sections.tasks).toEqual([]);
   expect(sections.transitions).toEqual([]);
   expect((await lstat(sections.localDirectoryPath)).isDirectory()).toBe(true);
   expect(await readdir(sections.localDirectoryPath)).toEqual([]);
  }
  const duplicate=await send('episode-imports',{action:'preview',...data});
  expect(duplicate).toMatchObject({status:200,body:{items:[
   {itemId:first.itemId,duplicateEpisodeId:result.body.items[0].episodeId},
   {itemId:second.itemId,duplicateEpisodeId:result.body.items[1].episodeId},
  ]}});
  const repeated=await send('episode-imports',{action:'submit',batchId:randomUUID(),...data,items:[{...first,duplicate:'skip'},{...second,duplicate:'create'}]});
  expect(repeated).toMatchObject({status:200,body:{items:[
   {itemId:first.itemId,status:'skipped',reason:expect.stringContaining('同脚本')},
   {itemId:second.itemId,status:'succeeded'},
  ]}});
  expect(repeated.body.items[1].episodeId).not.toBe(result.body.items[1].episodeId);

  const retryBatchId=randomUUID();
  const interruptedData={...data,items:[
   {...first,itemId:randomUUID(),title:'先成功'},
   {...second,itemId:randomUUID(),title:'待重试'},
  ]};
  // Fail the real final receipt write so the order, draft, and batch membership
  // must all roll back together after the directory has been created.
  await f.c.query(`
   CREATE FUNCTION public.test_import_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
    IF NEW.result->>'title'='待重试' THEN RAISE EXCEPTION 'controlled receipt failure'; END IF;
    RETURN NEW;
   END $$;
   CREATE TRIGGER test_import_receipt_failure BEFORE INSERT ON local_identity.command_receipts
   FOR EACH ROW EXECUTE FUNCTION public.test_import_receipt_failure();
  `);
  const partial=await send('episode-imports',{action:'submit',batchId:retryBatchId,...interruptedData});
  expect(partial).toMatchObject({status:200,body:{items:[{status:'succeeded'},{status:'failed',episodeId:null,reason:expect.any(String)}]}});
  expect((await get('episode-imports/'+retryBatchId)).items).toEqual(partial.body.items);
  const conflicting=await send('episode-imports',{action:'submit',batchId:retryBatchId,...interruptedData,items:[first,second]});
  expect(conflicting.status).toBe(409);
  await f.c.query('DROP TRIGGER test_import_receipt_failure ON local_identity.command_receipts; DROP FUNCTION public.test_import_receipt_failure();');
  const [resumed,concurrentRetry]=await Promise.all([
   send('episode-imports',{action:'retry',batchId:retryBatchId}),
   send('episode-imports',{action:'retry',batchId:retryBatchId}),
  ]);
  expect(concurrentRetry).toEqual(resumed);
  expect(resumed).toMatchObject({status:200,body:{batchId:retryBatchId,items:[partial.body.items[0],{status:'succeeded'}]}});
  expect(await send('episode-imports',{action:'retry',batchId:retryBatchId})).toEqual(resumed);
  expect(await send('episode-imports',{action:'submit',batchId:retryBatchId,...interruptedData})).toEqual(resumed);
  const directory=await readEpisode(resumed.body.items[1].episodeId);
  expect(directory.importedScript.sourceText).toBe(second.sourceText);
  expect(await readdir(directory.localDirectoryPath)).toEqual([]);
 }finally{await f.close();await volume.close();}
},120000);
