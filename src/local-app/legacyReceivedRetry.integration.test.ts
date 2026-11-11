// @vitest-environment node
import{it,expect}from'vitest';
import{readFile,writeFile}from'node:fs/promises';
import{workspaceImageGenerationFixture}from'./workspaceImageGeneration.fixture';
import{narrationFixture}from'./workspaceNarration.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled).each(['image','speech']as const)('17/24 legacy received without recoverable evidence requires a new confirmation; fact/hold still prohibit it: %s',async kind=>{
 const image=kind==='image'?await workspaceImageGenerationFixture():null,f=image?.f??await narrationFixture();try{
  let w=await f.read(),base={workspaceId:w.id,expectedRevision:w.revision},args:Record<string,unknown>,command:string;
  if(kind==='image'){
   const version=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id;
   command='requestWorkspaceImageCandidates';args={...base,targetItemId:w.clips[0].itemId,selection:{capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:version},prompt:'旧回执兼容验收',settings:{size:'1152x2048',quality:'high',count:1},referenceMaterialRevisionIds:[image!.ref.body.id],reservationCents:100};
  }else{
   command='generateWorkspaceNarration';const clipId=w.clips[0].id;
   for(const[name,data]of [['saveWorkspaceNarration',{...base,clipId,mode:'tts',...f.narrationSettings,text:'旧回执兼容验收。'}],['confirmWorkspaceNarration',{...base,clipId}]]as const){const r=await f.request(name,data);expect(r.status,JSON.stringify(r.body)).toBe(200);w=r.body;}
   args={workspaceId:w.id,expectedRevision:w.revision,clipId,retry:true,reservationCents:100};
  }
  const q=await f.request(command,args);expect(q.status,JSON.stringify(q.body)).toBe(200);const old=kind==='image'?q.body.visualTasks[0].taskId:q.body.narration[0].taskId;
  await writeFile(f.responseMode,'unknown');await f.execute(old,false);
  const table=kind==='image'?'workspace_visual_submissions':'workspace_narration_submissions';
  // Model an old executor's premature received marker using only disposable data.
  await f.c.query(`UPDATE local_identity.${table} SET outcome='received' WHERE task_id=$1`,[old]);
  const retryArgs={...args,retryOfTaskId:old};
  const proposal=()=>f.rawRequest('prepareWorkspaceCall',{workspaceId:args.workspaceId,expectedRevision:args.expectedRevision,callCommand:command,callData:{episodeId:f.episode,...retryArgs}});
  expect((await proposal()).status).toBe(409); // Any new protocol fact forbids this legacy exception.
  await f.c.query('DELETE FROM local_identity.provider_dispatch_facts WHERE task_id=$1',[old]);
  await f.c.query('INSERT INTO local_identity.native_output_publications(task_id,attempt,lease_token) SELECT task_id,attempt,lease_token FROM public.task_runs WHERE task_id=$1 ORDER BY attempt DESC LIMIT 1',[old]);
  expect((await proposal()).status).toBe(409); // A private publication hold always wins.
  await f.c.query('DELETE FROM local_identity.native_output_publications WHERE task_id=$1',[old]);
  const pending=await proposal();expect(pending.status,JSON.stringify(pending.body)).toBe(200);expect(pending.body.summary.retryOfTaskId).toBe(old);
  const submissions=kind==='image'?image!.submissions:f.submissions;expect((await readFile(submissions,'utf8')).trim().split('\n')).toHaveLength(1);
  await writeFile(f.responseMode,'success');const confirmed=await f.rawRequest('confirmWorkspaceCall',{workspaceId:args.workspaceId,expectedRevision:args.expectedRevision,confirmationId:pending.body.confirmationId});expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);
  const next=kind==='image'?confirmed.body.visualTasks[0].taskId:confirmed.body.narration[0].taskId;expect(next).not.toBe(old);expect((await f.execute(next))?.status).toBe('completed');
  expect((await readFile(submissions,'utf8')).trim().split('\n')).toHaveLength(2);expect((await f.c.query(`SELECT outcome FROM local_identity.${table} WHERE task_id=$1`,[old])).rows[0].outcome).toBe('received');
  expect((await f.request(command,retryArgs)).status).toBe(409); // One replacement per original.
 }finally{await f.close();}
},120000);
