// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {csrfFor} from './sessions';
import {workspaceImageGenerationFixture} from './workspaceImageGeneration.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('explicit image selections freeze two independent connections without blueprint image authority',async()=>{
 const {f,ref,submissions}=await workspaceImageGenerationFixture();try{
 const a=(await f.c.query("SELECT v.id FROM public.external_connection_versions v WHERE adapter='openai_images'")).rows[0].id;
 await f.c.query('BEGIN');
 const b=randomUUID(),connection=randomUUID(),secret=randomUUID();
 await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'openai','openai_images','Image B',$2,$3,'https://api.openai.com/v1')",[connection,f.owner,b]);
 await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'openai','openai_images','https://api.openai.com/v1',$3)",[b,connection,secret]);
 await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[b,f.owner,secret]);
 await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[b,f.owner]);
 await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[b,f.owner]);
 await f.c.query('COMMIT');
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
 await f.c.query('BEGIN');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);await f.c.query('SET SESSION AUTHORIZATION loop_app');
 await f.c.query('SELECT public.update_current_blueprint($1,$2)',[account,{asset_root:f.assetRoot,positioning:'明亮纪实，不添加商标'}]);
 const series=(await f.c.query('SELECT (public.create_series($1,$2,$3)).id',[account,'冻结系列',{visual_style:'保持金色画框',restrictions:'不改变产品文字'}])).rows[0].id;
 await f.c.query('SET SESSION AUTHORIZATION DEFAULT');await f.c.query('UPDATE public.episodes SET blueprint_version_id=(SELECT current_blueprint_version_id FROM public.accounts WHERE id=$2),series_version_id=$3 WHERE id=$1',[f.episode,account,series]);await f.c.query('COMMIT');
 let w=await f.read();const sha=w.project.sha256;
 const selection=(id:string)=>({capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:id});
 const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection:selection(a),prompt:'保留主体，改变背景。',settings:{size:'864x1536',quality:'high',count:1},referenceMaterialRevisionIds:[ref.body.id],reservationCents:100};
 const key=randomUUID(),submit=async(data:unknown)=>{const r=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'requestWorkspaceImageCandidates',idempotencyKey:key,data:{episodeId:f.episode,...data as Record<string,unknown>}})});return{status:r.status,body:await r.json()};};
 const queued=await submit(args);expect((await submit(args)).body).toEqual(queued.body);expect((await submit({...args,prompt:'Different request'})).status).toBe(409);expect(queued.status,JSON.stringify(queued.body)).toBe(200);w=queued.body;
 const taskA=w.visualTasks[0].taskId;
 // Rotation/default changes cannot mutate the already submitted exact version.
 await f.c.query('BEGIN');const rotated=randomUUID();await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) SELECT $2,connection_id,2,provider,adapter,endpoint,vault_secret_id FROM public.external_connection_versions WHERE id=$1",[a,rotated]);await f.c.query('UPDATE public.external_connections SET current_version_id=$2 WHERE current_version_id=$1',[a,rotated]);await f.c.query('COMMIT');
 expect((await f.request('requestWorkspaceImageCandidates',{...args,selection:selection(b)})).status).toBe(409);
 await f.execute(taskA);w=await f.read();expect(w.project.sha256).toBe(sha);
 const next=await f.request('requestWorkspaceImageCandidates',{...args,expectedRevision:w.revision,selection:selection(b)});expect(next.status,JSON.stringify(next.body)).toBe(200);
 const taskB=next.body.visualTasks.find((t:any)=>t.taskId!==taskA).taskId;
 await f.restartWorker();await f.execute(taskB);w=await f.read();expect(w.visualCandidates).toHaveLength(2);expect(w.visualCandidates.every((c:any)=>c.status==='available')).toBe(true);
 const calls=(await readFile(submissions,'utf8')).trim().split('\n').map(s=>JSON.parse(s));expect(calls).toHaveLength(2);expect(calls[0].body.prompt).toContain('明亮纪实，不添加商标');expect(calls[0].body.prompt).toContain('保持金色画框');
 const records=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=ANY($1::uuid[]) ORDER BY created_at',[ [taskA,taskB] ])).rows;
 expect(records.map(r=>r.input_snapshot.credential_ref)).toEqual([a,b]);expect(records[0].input_snapshot.production_context.accountId).toBeTruthy();expect(records[0].input_snapshot.workspace_target.projectSha256).toBe(sha);
 const candidate=w.visualCandidates[0];const prepared=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target',motionPolicy:'preserve-target'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
 const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:prepared.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);expect(adopted.body.project.sha256).not.toBe(sha);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('rejects invalid choices, settings, references and budget; unknown submission cannot charge twice',async()=>{
 const {f,ref,submissions}=await workspaceImageGenerationFixture();try{
 const version=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id;
 const w=await f.read(),selection={capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:version};
 const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,selection,prompt:'受控图片',settings:{size:'864x1536',quality:'auto',count:1},referenceMaterialRevisionIds:[ref.body.id],reservationCents:100};
 for(const change of [{selection:{...selection,model:'unsupported'}},{settings:{...args.settings,size:'1x1'}},{settings:{...args.settings,duration:5}},{referenceMaterialRevisionIds:[randomUUID()]}])expect((await f.request('requestWorkspaceImageCandidates',{...args,...change})).status).toBe(400);
 expect((await f.request('requestWorkspaceImageCandidates',{...args,selection:{...selection,connectionVersionId:randomUUID()}})).status).toBe(409);
 expect((await f.request('requestWorkspaceImageCandidates',args,{token:f.otherToken})).status).toBe(404);
 expect((await f.request('requestWorkspaceImageCandidates',args,{csrf:false})).status).toBe(403);
 await f.c.query('UPDATE local_identity.connection_qualifications SET qualified=false WHERE version_id=$1',[version]);expect((await f.request('requestWorkspaceImageCandidates',args)).status).toBe(409);await f.c.query('UPDATE local_identity.connection_qualifications SET qualified=true WHERE version_id=$1',[version]);
 const tooMuch=await f.request('requestWorkspaceImageCandidates',{...args,reservationCents:1001});expect(tooMuch.status,JSON.stringify(tooMuch.body)).toBe(409);expect(tooMuch.body.error).toContain('预算');expect((await f.read()).visualTasks).toHaveLength(0);
 const queued=await f.request('requestWorkspaceImageCandidates',args);expect(queued.status,JSON.stringify(queued.body)).toBe(200);const task=queued.body.visualTasks[0].taskId;
 await writeFile(f.responseMode,'unknown');await f.execute(task,false);await f.restart();await f.restartWorker();
 const repeated=await f.request('requestWorkspaceImageCandidates',args);expect(repeated.status,JSON.stringify(repeated.body)).toBe(409);expect(repeated.body.error).toContain('未知');
 expect((await readFile(submissions,'utf8')).trim().split('\n')).toHaveLength(1);
 const reservations=(await f.c.query('SELECT reserved_cents,request_state FROM public.paid_generation_reservations WHERE task_id=$1',[task])).rows;expect(reservations).toEqual([{reserved_cents:100,request_state:'submitting'}]);expect((await f.read()).visualTasks).toHaveLength(1);
 }finally{await f.close();}
},120000);
