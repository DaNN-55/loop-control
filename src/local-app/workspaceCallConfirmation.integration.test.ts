// @vitest-environment node
import {it,expect} from 'vitest';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
async function setup(){const fixture=await workspaceImageGenerationFixture();const {f,ref}=fixture,w=await f.read(),selection={capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id};
 const payload={episodeId:f.episode,workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection,prompt:'产品摄影',settings:{size:'864x1536',quality:'auto',count:1},referenceMaterialRevisionIds:[ref.body.id],reservationCents:150};
 const propose=()=>f.rawRequest('prepareWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,callCommand:'requestWorkspaceImageCandidates',callData:payload});
 const confirm=(id:string,revision=w.revision,options={})=>f.rawRequest('confirmWorkspaceCall',{workspaceId:w.id,expectedRevision:revision,confirmationId:id},options);
 return{...fixture,w,payload,propose,confirm};}
it.skipIf(!enabled)('confirmation does not queue, legacy enablement cannot bypass it, and one confirmation queues exactly once without enabling the episode',async()=>{
 const {f,w,payload,propose,confirm}=await setup();try{
 expect((await f.rawRequest('requestWorkspaceImageCandidates',payload)).status).toBe(409);
 await f.c.query('UPDATE local_identity.script_productions SET enabled=false WHERE episode_id=$1',[f.episode]);
 const before=(await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n;
 const proposal=await propose();expect(proposal.status,JSON.stringify(proposal.body)).toBe(200);expect(proposal.body.summary).toMatchObject({kind:'图片生成',reservationCents:150,provider:'openai',model:'gpt-image-2',target:w.clips[0].shotId});expect(proposal.body.summary.inputs).toEqual(['reference.png']);
 expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(before);expect((await f.c.query('SELECT count(*)::int n FROM public.paid_generation_reservations r JOIN public.tasks t ON t.id=r.task_id WHERE t.episode_id=$1',[f.episode])).rows[0].n).toBe(0);
 const denied=await confirm(proposal.body.confirmationId,w.revision,{token:f.otherToken});expect(denied.status).toBe(404);
 const altered=await f.rawRequest('confirmWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,confirmationId:proposal.body.confirmationId,reservationCents:0});expect(altered.status).toBe(400);
 const results=await Promise.all([confirm(proposal.body.confirmationId),confirm(proposal.body.confirmationId)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 expect((await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(before+1);
 expect((await f.c.query('SELECT enabled FROM local_identity.script_productions WHERE episode_id=$1',[f.episode])).rows[0].enabled).toBe(false);
 const task=results.find(r=>r.status===200)!.body.visualTasks[0].taskId;await f.execute(task);expect((await f.read()).visualCandidates).toHaveLength(1);
 const reservation=(await f.c.query('SELECT reserved_cents,request_state FROM public.paid_generation_reservations WHERE task_id=$1',[task])).rows[0];expect(reservation).toEqual({reserved_cents:150,request_state:'succeeded'});
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('expired and changed-input confirmations fail without consuming the proposal or queueing a task',async()=>{
 const {f,w,propose,confirm}=await setup();try{
 const expired=await propose();expect(expired.status).toBe(200);await f.c.query("UPDATE local_identity.workspace_call_confirmations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.body.confirmationId]);expect((await confirm(expired.body.confirmationId)).status).toBe(409);
 const stale=await propose();expect(stale.status).toBe(200);
 const changed=await f.rawRequest('editWorkspaceStructure',{workspaceId:w.id,expectedRevision:w.revision,operation:{kind:'insert',afterShotId:w.clips[0].shotId,text:'新增镜头'}});expect(changed.status,JSON.stringify(changed.body)).toBe(200);
 expect((await confirm(stale.body.confirmationId,changed.body.revision)).status).toBe(409);
 expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_call_confirmations WHERE consumed_at IS NOT NULL')).rows[0].n).toBe(0);
 expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND task_type='generate_static_visual'",[f.episode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('connection or reference changes require a fresh confirmation and failed validation rolls consumption back',async()=>{
 const {f,w,payload,propose,confirm}=await setup();try{
 const proposal=await propose();expect(proposal.status).toBe(200);
 await f.c.query('UPDATE public.external_connections SET name=$2 WHERE id=(SELECT connection_id FROM public.external_connection_versions WHERE id=$1)',[payload.selection.connectionVersionId,'Changed connection']);
 const result=await confirm(proposal.body.confirmationId);expect(result.status).toBe(409);expect(result.body.error).toContain('重新确认');
 expect((await f.c.query('SELECT consumed_at FROM local_identity.workspace_call_confirmations WHERE id=$1',[proposal.body.confirmationId])).rows[0].consumed_at).toBeNull();
 expect((await f.rawRequest('authorizeWorkspacePreparation',{workspaceId:w.id,expectedRevision:w.revision,enabled:true})).status).toBe(409);
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('confirmation records follow the existing guarded production-order deletion',async()=>{
 const {f,propose}=await setup();try{
 expect((await propose()).status).toBe(200);
 await f.c.query('UPDATE public.episodes SET archived_at=clock_timestamp() WHERE id=$1',[f.episode]);
 const plan=await f.post('episode-lifecycle','planDeletion',{episodeId:f.episode});expect(plan.status,JSON.stringify(plan.body)).toBe(200);
 const deleted=await f.post('episode-lifecycle','deleteEpisode',{episodeId:f.episode,confirmation:plan.body.confirmation,expectedPath:plan.body.path,expectedPaths:plan.body.paths,expectedRevision:plan.body.revision});expect(deleted.status,JSON.stringify(deleted.body)).toBe(200);
 expect((await f.c.query('SELECT count(*)::int n FROM local_identity.workspace_call_confirmations WHERE episode_id=$1',[f.episode])).rows[0].n).toBe(0);
 }finally{await f.close();}
},120000);

it.skipIf(!enabled)('automatically estimates a call and atomically freezes the Owner-adjusted reservation in the actual queued task',async()=>{
 const {f,w,payload}=await setup();try{
 const {reservationCents:_,...input}=payload;
 const proposal=await f.rawRequest('prepareWorkspaceCall',{workspaceId:w.id,expectedRevision:w.revision,callCommand:'requestWorkspaceImageCandidates',callData:input});expect(proposal.status,JSON.stringify(proposal.body)).toBe(200);expect(proposal.body.summary.reservationCents).toBeGreaterThan(0);expect(proposal.body.summary.reservationCents).toBe(proposal.body.summary.estimate.suggestedCents);
 const base={workspaceId:w.id,expectedRevision:w.revision,confirmationId:proposal.body.confirmationId};
 for(const amount of [null,'321',0,1.5,100001])expect((await f.rawRequest('confirmWorkspaceCall',{...base,reservationCents:amount})).status).toBe(400);
 expect((await f.rawRequest('confirmWorkspaceCall',{...base,prompt:'篡改内容',reservationCents:321})).status).toBe(400);
 const queued=await f.rawRequest('confirmWorkspaceCall',{...base,reservationCents:321});expect(queued.status,JSON.stringify(queued.body)).toBe(200);
 const task=queued.body.visualTasks[0].taskId;expect((await f.c.query('SELECT budget_limit_cents FROM public.tasks WHERE id=$1',[task])).rows[0].budget_limit_cents).toBe(321);
 const record=(await f.c.query('SELECT payload,summary,consumed_at FROM local_identity.workspace_call_confirmations WHERE id=$1',[proposal.body.confirmationId])).rows[0];expect(record.payload.reservationCents).toBe(321);expect(record.summary.reservationCents).toBe(321);expect(record.consumed_at).toBeTruthy();
 expect((await f.rawRequest('confirmWorkspaceCall',{...base,reservationCents:999})).status).toBe(409);
 await f.execute(task);expect((await f.c.query('SELECT reserved_cents FROM public.paid_generation_reservations WHERE task_id=$1',[task])).rows[0].reserved_cents).toBe(321);
 }finally{await f.close();}
},120000);
