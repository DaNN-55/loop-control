// @vitest-environment node
import {it,expect} from 'vitest';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('HTTP → isolated queue → actual Worker publishes a reference-based image batch; selecting and adopting remain explicit',async()=>{
 const {f,ref,submissions}=await workspaceImageGenerationFixture();try{
 let w=await f.read();const sha=w.project.sha256;
 const missing=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(missing.status).toBe(409);expect(missing.body.error).toContain('采用');
 const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:{capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id},prompt:'保留参考图主体，改变背景。',imageBrief:{references:[{materialRevisionId:ref.body.id,purpose:'subject',preserve:'产品图案',change:'背景'}],framing:'full',captionSpace:'bottom',crop:'protect'},settings:{size:'1152x2048',quality:'high',count:4},referenceMaterialRevisionIds:[ref.body.id],reservationCents:100};
 const queued=await f.request('requestWorkspaceImageCandidates',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;
 expect(w.project.sha256).toBe(sha);expect(w.visualTasks[0].kind).toBe('image');expect(w.visualCandidates).toHaveLength(0);
 expect((await f.request('requestWorkspaceImageCandidates',args)).status).toBe(409);
 await f.execute(w.visualTasks[0].taskId);w=await f.read();
 expect(w.project.sha256).toBe(sha);expect(w.visualCandidates).toHaveLength(4);expect(w.readiness.placeholders).toHaveLength(2);
 const call=JSON.parse((await readFile(submissions,'utf8')).trim());expect(call.url).toBe('https://api.openai.com/v1/images/edits');expect(call.body).toMatchObject({n:4,quality:'high',size:'1152x2048',model:'gpt-image-2'});expect(call.body.prompt).toContain('保留：产品图案');expect(call.body.prompt).toContain('下方留字幕空间');expect(call.body.prompt).toContain('裁切');expect(w.visualCandidates[0].generation.imageBrief).toEqual(args.imageBrief);expect(call.body.images[0].image_url).toMatch(/^data:image\/png;base64,/);
 const candidate=w.visualCandidates[2];expect(candidate.materialRevisionId).toBeTruthy();expect(candidate.width).toBeGreaterThan(0);
 const prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target',motionPolicy:'preserve-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
 const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);w=adopted.body;expect(w.readiness.placeholders).toHaveLength(1);
 const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines[0].items[0].kind).toBe('image');expect(project.timelines[0].items[0].src).toBe(candidate.relativePath);
 const reservation=(await f.c.query('SELECT kind,reserved_cents,request_state FROM public.paid_generation_reservations WHERE task_id=$1',[w.visualTasks[0].taskId])).rows[0];expect(reservation).toEqual({kind:'image',reserved_cents:100,request_state:'succeeded'});
 }finally{await f.close();}
},120000);
