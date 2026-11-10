// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {officialVideoBody} from '../worker/officialVideoProvider';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('free isolated Owner HTTP freezes @ references and the actual image Worker submits resolved text',async()=>{
 const {f,ref,submissions}=await workspaceImageGenerationFixture();try{
  const w=await f.read(),selection={capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id};
  const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection,prompt:'让@图片1 保持外观',promptReferences:[{token:'@图片1',materialRevisionId:ref.body.id}],referenceMaterialRevisionIds:[ref.body.id],settings:{size:'1024x1024',quality:'low',count:1},reservationCents:100};
  const missing=await f.request('requestWorkspaceImageCandidates',{...args,referenceMaterialRevisionIds:[]});expect(missing.status).toBe(400);expect(missing.body.error).toContain('已移除');
  const queued=await f.request('requestWorkspaceImageCandidates',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);
  await f.execute(queued.body.visualTasks[0].taskId);
  const call=JSON.parse((await readFile(submissions,'utf8')).trim());expect(call.body.prompt).toContain('让参考图 1 保持外观');expect(call.body.prompt).not.toContain('@图片1');expect(call.body.images).toHaveLength(1);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('free isolated MiniMax confirmation and queue preserve bindings while translating reordered media labels',async()=>{
 const f=await narrationFixture(undefined,undefined,{provider:'minimax',model:'MiniMax-H3-Highspeed'});try{
  await f.authorize();const ids:string[]=[];
  for(const sourcePath of ['A.png','B.png']){const ref=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath,mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(ref.status).toBe(200);ids.push(ref.body.id);}
  const w=await f.read();
  const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,prompt:'让@图片1 跟随@图片2',promptReferences:ids.map((materialRevisionId,index)=>({token:`@图片${index+1}`,materialRevisionId})),videoMode:'references',visualInputs:[...ids].reverse().map(materialRevisionId=>({role:'referenceImages',materialRevisionId})),durationSeconds:4,videoResolution:'480P',reservationCents:200};
  const queued=await f.chosenRequest('requestWorkspaceVisualCandidate',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);
  const task=queued.body.visualTasks[0],snapshot=(await f.c.query('SELECT request_snapshot FROM local_identity.workspace_visual_candidates WHERE task_id=$1',[task.taskId])).rows[0].request_snapshot;
  expect(snapshot.actualPrompt).toContain('让<Picture 2> 跟随<Picture 1>');expect(snapshot.promptReferences).toEqual(args.promptReferences);
  const bytes=await readFile(workspaceTestMedia('still-striped.png'));
  const body=officialVideoBody({provider:'minimax',model:'MiniMax-H3-Highspeed',prompt:snapshot.actualPrompt,durationSeconds:4,resolution:'480P',visualMode:'references',visualInputs:snapshot.visualInputs.map((input:any)=>({...input,image:bytes}))});
  expect((body as any).content[0].text).toContain('<Picture 2>');expect((body as any).content.slice(1).map((entry:any)=>entry.role)).toEqual(['reference_image','reference_image']);
  const reservation=await f.c.query('SELECT count(*) FROM public.paid_generation_reservations WHERE task_id=$1',[task.taskId]);expect(Number(reservation.rows[0].count)).toBe(0);
 }finally{await f.close();}
},120000);
