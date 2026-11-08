// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('freezes and executes all four GPT Image 2.5 identities through Owner HTTP, queue and Worker',async()=>{
 const {f,ref,submissions}=await workspaceImageGenerationFixture(['db/local/152-gpt-image-25-models.sql']);
 try{
  let w=await f.read();const project=w.project.sha256;
  const version=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id;
  const models=['gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08'];
  for(const [index,model] of models.entries()){
   const quality=index%2?'max':'xhigh',references=index%2?[ref.body.id]:[];
   const callData={episodeId:f.episode,workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'image',provider:'openai',adapter:'openai_images',model,connectionVersionId:version},prompt:'生成参考画面',settings:{size:'864x1536',quality,count:1},referenceMaterialRevisionIds:references};
   const prepared=await f.rawRequest('prepareWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,callCommand:'requestWorkspaceImageCandidates',callData});
   expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.summary.estimate.manualReservation).toBe(true);expect(prepared.body.summary.model).toBe(model);expect(prepared.body.summary.parameters).toContain('质量：'+(quality==='max'?'最高':'超高'));
   const queued=await f.rawRequest('confirmWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,confirmationId:prepared.body.confirmationId,reservationCents:100});
   expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;
   const task=(await f.c.query('SELECT id,model,input_snapshot FROM public.tasks WHERE episode_id=$1 AND model=$2',[f.episode,model])).rows[0];
   expect(task.model).toBe(model);expect(task.input_snapshot.executor.model).toBe(model);expect(task.input_snapshot.media.static_visual.settings.quality).toBe(quality);
   expect((await f.execute(task.id))?.status).toBe('completed');w=await f.read();expect(w.project.sha256).toBe(project);
   const call=JSON.parse((await readFile(submissions,'utf8')).trim().split('\n').at(-1)!);expect(call.body).toMatchObject({model,quality,n:1,output_format:'png'});expect(call.url).toContain(references.length?'/images/edits':'/images/generations');
  }
  expect(w.visualCandidates).toHaveLength(4);
  const invalid=await f.rawRequest('prepareWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,callCommand:'requestWorkspaceImageCandidates',callData:{episodeId:f.episode,workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:version},prompt:'不支持的质量',settings:{size:'864x1536',quality:'max',count:1},referenceMaterialRevisionIds:[]}});
  expect(invalid.status).toBe(400);expect(invalid.body.error).toContain('图片生成设置不可用');expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND task_type=\'generate_static_visual\'',[f.episode])).rows[0].n).toBe(4);
 }finally{await f.close();}
},180000);
