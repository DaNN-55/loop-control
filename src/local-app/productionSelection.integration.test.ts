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
 const calls=(await readFile(submissions,'utf8')).trim().split('\n').map(s=>JSON.parse(s));expect(calls).toHaveLength(2);const secretA=(await f.c.query('SELECT secret_ref FROM local_identity.connection_bindings WHERE version_id=$1',[a])).rows[0].secret_ref;expect(calls.map(call=>call.credentialRef)).toEqual([secretA,secret]);expect(calls[0].body.prompt).toContain('明亮纪实，不添加商标');expect(calls[0].body.prompt).toContain('保持金色画框');
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

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('legacy queued image snapshots execute unchanged after content-only saves and new requests still require a selection',async()=>{
 const {f,ref}=await workspaceImageGenerationFixture();try{
 const w=await f.read(),id=randomUUID(),version=(await f.c.query("SELECT id FROM public.external_connection_versions WHERE adapter='openai_images'")).rows[0].id;
 const execution={execution_path:'external',credential_ref:version,executor:{provider:'openai',adapter:'openai_images',model:'gpt-image-2',prompt_version:'static-visual-v1'},budget_cents:100,max_attempts:1},policy={positioning:'历史纪实',tone:'克制',asset_root:f.assetRoot,allowed_tools:['read','write'],budgets:{storyboard_planning_cents:90},static_visual:execution};
 const blueprint=(await f.c.query('SELECT blueprint_version_id,account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0];
 // Seed a pre-108 historical policy in this disposable DB; production writes stay projected.
 await f.c.query('BEGIN');await f.c.query('ALTER TABLE public.account_blueprint_versions DISABLE TRIGGER a_blueprint_creative_write');await f.c.query('ALTER TABLE public.account_blueprint_versions DISABLE TRIGGER validate_blueprint_external_connections_before_write');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);await f.c.query('UPDATE public.account_blueprint_versions SET policy=$2 WHERE id=$1',[blueprint.blueprint_version_id,policy]);await f.c.query('ALTER TABLE public.account_blueprint_versions ENABLE TRIGGER a_blueprint_creative_write');await f.c.query('ALTER TABLE public.account_blueprint_versions ENABLE TRIGGER validate_blueprint_external_connections_before_write');await f.c.query('COMMIT');
 const auth=(await f.c.query('SELECT authorization_hash FROM local_identity.script_productions WHERE episode_id=$1',[f.episode])).rows[0].authorization_hash;
 const target=w.clips[0],snapshot={kind:'image',usage:'still',execution,prompt:'已入队的旧图',imageSettings:{size:'864x1536',quality:'auto',count:1},references:[],referenceMaterialRevisionIds:[],durationSeconds:3,reservationCents:100,authorizationHash:auth};
 await f.c.query('BEGIN');await f.c.query('INSERT INTO local_identity.workspace_visual_candidates(id,workspace_id,episode_id,clip_id,shot_id,target_item_id,input_fingerprint,target_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,w.id,f.episode,target.id,target.shotId,target.itemId,'c'.repeat(64),JSON.stringify({kind:'text'}),JSON.stringify(snapshot)]);await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);await f.c.query('SET SESSION AUTHORIZATION loop_app');const taskId=(await f.c.query('SELECT local_identity.queue_workspace_images($1) id',[id])).rows[0].id;await f.c.query('SET SESSION AUTHORIZATION DEFAULT');await f.c.query('COMMIT');
 const before=(await f.c.query('SELECT input_snapshot::text bytes FROM public.tasks WHERE id=$1',[taskId])).rows[0].bytes;
 const r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'updateBlueprint',idempotencyKey:randomUUID(),expectedRevision:(await f.c.query('SELECT md5(policy::text) revision FROM public.account_blueprint_versions WHERE id=$1',[blueprint.blueprint_version_id])).rows[0].revision,data:{accountId:blueprint.account_id,policy:{positioning:'之后的新内容规则'}}})});expect(r.status,JSON.stringify(await r.json())).toBe(200);
 expect((await f.c.query('SELECT input_snapshot::text bytes FROM public.tasks WHERE id=$1',[taskId])).rows[0].bytes).toBe(before);
 const args={workspaceId:w.id,expectedRevision:w.revision,targetItemId:target.itemId,prompt:'新的明确选择',settings:snapshot.imageSettings,referenceMaterialRevisionIds:[ref.body.id],reservationCents:100};expect((await f.request('requestWorkspaceImageCandidates',args)).status).toBe(400);
 await f.restart();await f.restartWorker();expect((await f.execute(taskId))?.status).toBe('completed');const current=await f.read();expect(current.visualCandidates.some((c:any)=>c.taskId===taskId)).toBe(true);
 const executed=(await f.c.query("SELECT input_snapshot-'runtime_constraints' frozen FROM public.tasks WHERE id=$1",[taskId])).rows[0].frozen,original=JSON.parse(before);delete original.runtime_constraints;expect(executed).toEqual(original);expect((await f.c.query('SELECT policy FROM public.account_blueprint_versions WHERE id=$1',[blueprint.blueprint_version_id])).rows[0].policy).toEqual(policy);
 const next=await f.request('requestWorkspaceImageCandidates',{...args,selection:{capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:version}});expect(next.status,JSON.stringify(next.body)).toBe(200);const selected=next.body.visualTasks.find((t:any)=>t.taskId!==taskId);const context=(await f.c.query('SELECT input_snapshot FROM public.tasks WHERE id=$1',[selected.taskId])).rows[0].input_snapshot.production_context;expect(context.accountRules).toEqual({positioning:'历史纪实',tone:'克制'});await f.execute(selected.taskId);
 }finally{await f.close();}
},120000);
