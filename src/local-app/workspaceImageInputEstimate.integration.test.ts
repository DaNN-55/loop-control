// @vitest-environment node
import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
import {imagePromptTokens} from './workspaceCallEstimate';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1',exec=promisify(execFile);
it.skipIf(!enabled)('estimates the complete wire prompt and real reference pixels, then freezes the same inputs through a controlled image Worker',async()=>{
 const {f,submissions}=await workspaceImageGenerationFixture();try{
 const references=[];
 for(const size of [256,2048]){
  const path=join(f.root,`ref-${size}.png`);await exec('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i',`color=c=blue:s=${size}x${size}`,'-frames:v','1',path]);
  const imported=await f.rawRequest('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:`ref-${size}.png`,mimeType:'image/png',contentBase64:(await readFile(path)).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(imported.status,JSON.stringify(imported.body)).toBe(200);references.push(imported.body.id);
 }
 const w=await f.read(),selection={capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id};
 const payload={episodeId:f.episode,workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection,prompt:'A natural product photo，保留主体。',settings:{size:'1024x1024',quality:'auto',count:1},imageBrief:{references:[{materialRevisionId:references[0],purpose:'product',preserve:'图案',change:'背景'}],framing:'full',captionSpace:'bottom',crop:'protect'},referenceMaterialRevisionIds:references};
 const propose=(data=payload)=>f.rawRequest('prepareWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,callCommand:'requestWorkspaceImageCandidates',callData:data});
 const proposal=await propose();expect(proposal.status,JSON.stringify(proposal.body)).toBe(200);const input=proposal.body.summary.estimate.imageInputs;
 expect(input.references).toEqual([{width:256,height:256,tokens:2560},{width:2048,height:2048,tokens:34816}]);expect(input.referenceTokens).toBe(37376);expect(input.textCharacters).toBeGreaterThan(Array.from(payload.prompt).length);expect(input.quality).toBe('high');expect(input.outputTokensPerImage).toBe(7024);
 const short=await propose({...payload,referenceMaterialRevisionIds:[references[0]]});expect(short.status).toBe(200);expect(short.body.summary.reservationCents).toBeLessThan(proposal.body.summary.reservationCents);
 const high=await propose({...payload,settings:{...payload.settings,quality:'high'}});expect(high.status).toBe(200);expect(high.body.summary.reservationCents).toBe(proposal.body.summary.reservationCents);
 const queued=await f.rawRequest('confirmWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,confirmationId:proposal.body.confirmationId});expect(queued.status,JSON.stringify(queued.body)).toBe(200);const task=queued.body.visualTasks[0].taskId;await f.execute(task);
 const wire=JSON.parse((await readFile(submissions,'utf8')).trim()).body;expect(wire.prompt).toContain('账号创作规则：');expect(wire.prompt).toContain('系列创作规则：');expect(wire.prompt).toContain('保留：图案');expect(wire.prompt).toContain('下方留字幕空间');expect(Array.from(wire.prompt).length).toBe(input.textCharacters);expect(imagePromptTokens(wire.prompt)).toBe(input.textTokens);expect(wire.images).toHaveLength(2);expect(wire.quality).toBe('auto');
 const snapshot=(await f.c.query('SELECT request_snapshot FROM local_identity.workspace_visual_candidates WHERE task_id=$1',[task])).rows[0].request_snapshot;expect(snapshot.actualPrompt).toBe(wire.prompt);expect((await f.c.query('SELECT reserved_cents FROM public.paid_generation_reservations WHERE task_id=$1',[task])).rows[0].reserved_cents).toBe(proposal.body.summary.reservationCents);
 expect((await f.read()).project.sha256).toBe(w.project.sha256);
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('changed reference bytes invalidate confirmation instead of silently using a zero or stale dimension estimate',async()=>{
 const {f,ref}=await workspaceImageGenerationFixture();try{
 const w=await f.read(),selection={capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id};
 const proposal=await f.rawRequest('prepareWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,callCommand:'requestWorkspaceImageCandidates',callData:{episodeId:f.episode,workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection,prompt:'自然产品图',settings:{size:'1024x1024',quality:'auto',count:1},referenceMaterialRevisionIds:[ref.body.id]}});expect(proposal.status).toBe(200);
 const m=(await f.c.query('SELECT storage_path FROM public.production_material_revisions WHERE id=$1',[ref.body.id])).rows[0];await writeFile(join(f.assetRoot,m.storage_path),'changed reference');
 const submitted=await f.rawRequest('confirmWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,confirmationId:proposal.body.confirmationId});expect(submitted.status,JSON.stringify(submitted.body)).toBe(409);expect((await f.c.query('SELECT consumed_at FROM local_identity.workspace_call_confirmations WHERE id=$1',[proposal.body.confirmationId])).rows[0].consumed_at).toBeNull();expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND task_type='generate_static_visual'",[f.episode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);
