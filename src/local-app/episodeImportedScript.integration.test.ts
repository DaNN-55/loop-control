// @vitest-environment node
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {csrfFor} from './sessions';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('single and batch approval retain the imported source and prepare exact shots with independent captions',async()=>{
 const volume=await workspaceAudioVolume();
 const f=await embeddedStudioFixture({testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath},migrations:['db/current/220-episode-batch-import.sql','db/current/223-manual-script-review-drafts.sql','db/current/225-structured-import-script.sql']}).catch(async cause=>{await volume.close();throw cause;});
 const headers={Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)};
 const get=async(path:string)=>{
  const response=await fetch(f.origin+'/api/local/'+path,{headers});
  expect(response.status,await response.clone().text()).toBe(200);
  return response.json();
 };
 const command=(command:string,data:Record<string,unknown>)=>f.post('episode-commands',command,data);
 const importRequest=(body:Record<string,unknown>)=>fetch(f.origin+'/api/local/episode-imports',{method:'POST',headers,body:JSON.stringify(body)});
 try{
  const account=await f.post('configuration','createAccount',{name:'结构化脚本验收',slug:'structured-'+randomUUID(),timezone:'Asia/Shanghai',policy:{}});
  expect(account.status,JSON.stringify(account.body)).toBe(200);
  const shots=[
   {sequence:3,visual:'玻璃上有雨滴',videoPrompt:'固定特写',narration:'',caption:'第一滴雨',durationSeconds:5},
   {sequence:7,visual:'车驶入雨幕',videoPrompt:'从街尾跟拍',narration:'车来了。',caption:'',durationSeconds:6},
  ];
  const source='原稿中的尾声还在。\n';
  const items=['仅分镜','含原稿'].map((title,index)=>({itemId:randomUUID(),sourceName:'结构化.xlsx',title,sourceText:index?source:'',targetDuration:15,shots}));
  const invalid=await importRequest({action:'readWorkbook',name:'坏文件.xlsx',contentBase64:Buffer.from('不是工作簿').toString('base64')});
  expect(invalid.status).toBe(400);
  const importData={accountId:account.body.id,seriesVersionId:null,items},batchId=randomUUID();
  const response=await importRequest({action:'submit',batchId,...importData});
  expect(response.status,await response.clone().text()).toBe(200);
  const {items:receipt}=await response.json();
  const single=receipt[0].episodeId,batch=receipt[1].episodeId;
  const retry=await importRequest({action:'retry',batchId});
  expect(await retry.json()).toMatchObject({batchId,items:receipt});
  const waiting=await get('episodes/'+single);
  const draft=waiting.sections.importedScript;
  expect(draft).toMatchObject({sourceText:'',targetDuration:15,shots});
  expect(waiting.sections.episode).toMatchObject({stage:'waiting_input',main_script_revision_id:null});
  const expected={episodeId:single,expectedScriptRevisionId:null,text:'',targetDuration:15,reason:''};
  expect((await command('confirmScriptStudio',{...expected,importedVersion:randomUUID()})).status).toBe(409);
  const confirmed=await command('confirmScriptStudio',{...expected,importedVersion:draft.version});
  expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);
  const preview=await get('episodes/'+batch+'/batch-script-review');
  expect(preview).toMatchObject({status:'ready',sourceText:source,targetDuration:15,plan:{durationSeconds:11,shots:[
   expect.objectContaining({title:'镜头 3',narration:'',subtitle:'第一滴雨',videoPrompt:'固定特写',durationSeconds:5}),
   expect.objectContaining({title:'镜头 7',narration:'车来了。',subtitle:null,videoPrompt:'从街尾跟拍',durationSeconds:6}),
  ]}});
  const batchConfirmed=await command('confirmReviewedScript',{episodeId:batch,reviewFingerprint:preview.reviewFingerprint});
  expect(batchConfirmed).toMatchObject({status:200,body:{status:'success'}});
  expect((await command('start',{episodeId:single})).status).toBe(200);
  for(const [episodeId,text] of [[single,''],[batch,source]]){
   const snapshot=await get('episodes/'+episodeId),scriptId=snapshot.sections.episode.main_script_revision_id;
   const saved=await get('script-studio?episodeId='+episodeId+'&scriptRevisionId='+scriptId);
   expect(saved).toMatchObject({sourceText:text,targetDuration:15,plan:{...preview.plan,title:text?'含原稿':'仅分镜',sourceUse:expect.any(String)}});
   const prepared=await command('prepareWorkspace',{episodeId,expectedScriptRevisionId:scriptId});
   expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
   expect(prepared.body.clips).toHaveLength(2);
   expect(prepared.body.narration).toEqual([
    expect.objectContaining({enabled:false,text:''}),
    expect.objectContaining({enabled:true,text:'车来了。'}),
   ]);
   expect(prepared.body.captions.map((shot:{contract:unknown})=>shot.contract)).toEqual([
    expect.objectContaining({enabled:true,contentMode:'independent',text:'第一滴雨'}),
    expect.objectContaining({enabled:false}),
   ]);
  }
  const duplicate=await importRequest({action:'preview',...importData});
  expect(await duplicate.json()).toMatchObject({items:[{duplicateEpisodeId:single},{duplicateEpisodeId:batch}]});
 }finally{await f.close();await volume.close();}
},60000);
