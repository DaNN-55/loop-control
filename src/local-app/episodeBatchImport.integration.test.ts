// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {lstat,readFile,readdir} from 'node:fs/promises';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {csrfFor} from './sessions';
import {createEpisodeReader} from '../episodes/episodeReadService';
import type {EpisodeProductionSnapshot} from '../episodes/episodeSnapshot';
import type {ImportedScript} from './episodeBatchImportTypes';
import {defaultShotCaptionContract} from '../shotCaptions';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {nativeWorkerPort} from './workerDatabase';
import {executeWorkspaceDeliveryWorker} from '../worker/workspaceDeliveryWorker';
import type {ClaimedTaskRow} from '../orchestration/workerDispatch';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner import preserves successful membership and follows the current script and delivery stages',async()=>{
 const volume=await workspaceAudioVolume(),f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,wake(){}},migrations:['db/current/220-episode-batch-import.sql']}).catch(async cause=>{await volume.close();throw cause;});
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
  const repeatedBatchId=randomUUID();
  const repeated=await send('episode-imports',{action:'submit',batchId:repeatedBatchId,...data,items:[{...first,duplicate:'skip'},{...second,duplicate:'create'}]});
  expect(repeated).toMatchObject({status:200,body:{items:[
   {itemId:first.itemId,status:'skipped',reason:expect.stringContaining('同脚本')},
   {itemId:second.itemId,status:'succeeded'},
  ]}});
  expect(repeated.body.items[1].episodeId).not.toBe(result.body.items[1].episodeId);
  expect(await get('episode-imports')).toMatchObject({batches:[
   {batchId:repeatedBatchId,accountName:account.name,firstTitle:first.title,createdAt:expect.any(String),itemCount:2,createdCount:1},
   {batchId,accountName:account.name,itemCount:2,createdCount:2},
  ],hasMore:false});
  const otherHistory=await fetch(f.origin+'/api/local/episode-imports',{headers:{Cookie:'loop_owner_session='+f.otherToken}});
  expect(otherHistory.status).toBe(200);
  expect(await otherHistory.json()).toEqual({batches:[],hasMore:false});

  const firstId=result.body.items[0].episodeId,secondId=result.body.items[1].episodeId,otherId=repeated.body.items[1].episodeId;
  const manual=await send('episode-commands',{command:'create',idempotencyKey:randomUUID(),data:{accountId:account.id,seriesVersionId:series.id,title:'手工建单'}});
  expect(manual.status,JSON.stringify(manual.body)).toBe(200);
  const members=async(query:string)=>(await get('catalog?'+query)).episodes.map((episode:{id:string})=>episode.id);
  expect(await members('importBatchId='+repeatedBatchId)).toEqual([otherId]);
  expect(await members('importBatchId='+batchId+'&batchStage=script_review')).toEqual([secondId,firstId]);
  expect(await members('importBatchId='+batchId+'&batchStage=export_review')).toEqual([]);
  expect(await members('importBatchId='+batchId+'&batchStage=done')).toEqual([]);
  const confirmation=await send('episode-commands',{command:'confirmScriptStudio',idempotencyKey:randomUUID(),data:{episodeId:firstId,expectedScriptRevisionId:null,text:first.sourceText,targetDuration:null,reason:''}});
  expect(confirmation.status,JSON.stringify(confirmation.body)).toBe(200);
  const started=await send('episode-commands',{command:'start',idempotencyKey:randomUUID(),data:{episodeId:firstId}});
  expect(started.status,JSON.stringify(started.body)).toBe(200);
  expect(await members('importBatchId='+batchId+'&batchStage=script_review')).toEqual([secondId]);
  expect(await members('importBatchId='+batchId)).toEqual([firstId,secondId]);
  expect(await members('accountId='+account.id)).toEqual(expect.arrayContaining([firstId,secondId,otherId,manual.body.id]));
  const foreignScope=await fetch(f.origin+'/api/local/catalog?importBatchId='+batchId,{headers:{Cookie:'loop_owner_session='+f.otherToken}});
  expect(foreignScope.status).toBe(200);
  expect((await foreignScope.json()).episodes).toEqual([]);

  const command=async(command:string,data:Record<string,unknown>={})=>{
   const response=await send('episode-commands',{command,idempotencyKey:randomUUID(),data:{episodeId:firstId,...data}});
   expect(response.status,JSON.stringify(response.body)).toBe(200);
   return response.body;
  };
  let workspace=await command('prepareWorkspace',{expectedScriptRevisionId:confirmation.body.id});
  const workspaceCommand=(name:string,data:Record<string,unknown>={})=>command(name,{workspaceId:workspace.id,expectedRevision:workspace.revision,...data});
  const localImage=await command('importMaterial',{sourceKind:'file',sourcePath:'still-striped.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64')});
  const assetRoot=(await get('episodes/'+firstId)).sections.localAssetRoot;
  const project=JSON.parse(await readFile(resolve(assetRoot,workspace.project.relativePath),'utf8'));
  for(const clip of workspace.clips){
   const timeline=project.timelines.find((t:{items:Array<{id:string}>})=>t.items.some(item=>item.id===clip.itemId));
   const item=timeline.items.find((item:{id:string})=>item.id===clip.itemId);
   workspace=await workspaceCommand('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:localImage.id,usage:'still',durationSeconds:item.durationInFrames/timeline.fps,fit:'contain',focusX:0,focusY:0});
   workspace=await workspaceCommand('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  }
  workspace=await workspaceCommand('exportWorkspace');
  const exported=workspace.exports[0];
  expect(exported.status,JSON.stringify(exported.checks)).toBe('ready');
  expect(await members('importBatchId='+batchId+'&batchStage=export_review')).toEqual([firstId]);
  workspace=await workspaceCommand('completeWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:workspace.contentSha256});
  expect(await members('importBatchId='+batchId+'&batchStage=export_review')).toEqual([]);
  expect(await members('importBatchId='+batchId+'&batchStage=done')).toEqual([]);
  await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2)');
  const worker=f.workerPool();
  try{
   const tasks=await nativeWorkerPort(worker).rpc('claim_next_worker_task',{p_task_id:workspace.deliveries[0].taskId,p_worker_capacity:2});
   const completed=await executeWorkspaceDeliveryWorker(worker,assetRoot,tasks[0] as ClaimedTaskRow);
   expect(completed.status,JSON.stringify(completed)).toBe('completed');
  }finally{await worker.end();}
  expect(await members('importBatchId='+batchId+'&batchStage=done')).toEqual([firstId]);
  expect(await members('importBatchId='+batchId+'&batchStage=script_review')).toEqual([secondId]);




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
  expect(await members('importBatchId='+retryBatchId)).toEqual([partial.body.items[0].episodeId]);
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
  expect(await members('importBatchId='+retryBatchId)).toEqual([resumed.body.items[1].episodeId,resumed.body.items[0].episodeId]);
  expect(await send('episode-imports',{action:'submit',batchId:retryBatchId,...interruptedData})).toEqual(resumed);
  const directory=await readEpisode(resumed.body.items[1].episodeId);
  expect(directory.importedScript.sourceText).toBe(second.sourceText);
  expect(await readdir(directory.localDirectoryPath)).toEqual([]);
 }finally{await f.close();await volume.close();}
},180000);
