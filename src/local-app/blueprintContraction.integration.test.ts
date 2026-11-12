// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {csrfFor} from './sessions';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('Owner saves creative-only accounts without media connections and retains referenced legacy blueprint evidence',async()=>{
 const f=await productionWorkspaceFixture();try{
 const config=async(command:string,data:unknown,extra:Record<string,unknown>={})=>{const r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data,...extra})});return{status:r.status,body:await r.json()};};
 const policy={positioning:'纪实，保留事实',tone:'克制',allowed_tools:['read','write'],asset_root:'/not-an-authorized-root',approval_gates:['old'],review:{enabled:true},executors:{storyboard_planning:{model:'old'}},budgets:{storyboard_planning_cents:900},narration:{credential_ref:randomUUID(),execution_path:'external'},static_visual:{enabled:true},a_roll:{},b_roll:{},soundtrack:{}};
 const accountKey=randomUUID(),accountSlug='creative-'+randomUUID();
 const created=await config('createAccount',{name:'内容规则账号',slug:accountSlug,timezone:'Asia/Shanghai',policy},{idempotencyKey:accountKey});expect(created.status,JSON.stringify(created.body)).toBe(200);
 expect((await config('createAccount',{name:'内容规则账号',slug:accountSlug,timezone:'Asia/Shanghai',policy:{...policy,asset_root:'/another-retired-root'}},{idempotencyKey:accountKey})).status).toBe(409);
 const catalog=await fetch(f.origin+'/api/local/catalog?view=accounts',{headers:{Cookie:'loop_owner_session='+f.token}});expect(catalog.status).toBe(200);const all=await catalog.json();const current=all.blueprints.find((b:any)=>b.account_id===created.body.id);expect(current.policy).toEqual({positioning:'纪实，保留事实',tone:'克制'});
 const before=(await f.c.query('SELECT b.*,md5(b.policy::text) revision FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[f.episode])).rows[0];
 const saved=await config('updateBlueprint',{accountId:before.account_id,policy:{positioning:'新的内容规则'}},{expectedRevision:before.revision});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 const old=(await f.c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[f.episode])).rows[0];expect(old.policy).toEqual(before.policy);expect((await f.c.query('SELECT policy,version FROM public.account_blueprint_versions WHERE id=$1',[before.id])).rows[0]).toEqual({policy:before.policy,version:before.version});
 expect((await config('createAccount',{name:'拒绝秘密',slug:'secret-'+randomUUID(),timezone:'Asia/Shanghai',policy:{positioning:'创作',api_key:'never-store'}})).status).toBe(400);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('retired planning settings and retries retain exact historical selections and tasks',async()=>{
 const {formalWorkflowFixture}=await import('./formalWorkflow.fixture');const f=await formalWorkflowFixture({configurePlanning:false,scriptText:'# 普通脚本\n\n## 正文\n原画面中的事实'});try{
 const harness=(await f.c.query("SELECT id FROM public.prompt_versions WHERE account_id=(SELECT account_id FROM public.episodes WHERE id=$1) AND capability='storyboard_planning' AND is_active ORDER BY version DESC",[f.newEpisode])).rows[0];
 const selection={provider:'codex',adapter:'codex',model:'historical-model',harnessId:harness.id,budgetCents:37,allowedTools:['read','write']},taskId=randomUUID();
 // Seed records that predate retirement; no new production request is submitted.
 await f.c.query('INSERT INTO local_identity.episode_planning_selections(episode_id,selection,revision) VALUES($1,$2,3) ON CONFLICT(episode_id) DO UPDATE SET selection=excluded.selection,revision=excluded.revision',[f.newEpisode,selection]);
 await f.c.query("INSERT INTO public.tasks(id,episode_id,task_type,status,input_snapshot,provider,model,prompt_version,budget_limit_cents) VALUES($1,$2,'draft_storyboard','failed',$3,'codex','historical-model','historical-planning-v1',37)",[taskId,f.newEpisode,{capability:'storyboard_planning',harness:selection,script_revision_id:f.main}]);
 const historical=async()=>({selection:(await f.c.query('SELECT to_jsonb(s) record FROM local_identity.episode_planning_selections s WHERE episode_id=$1',[f.newEpisode])).rows[0].record,task:(await f.c.query('SELECT to_jsonb(t) record FROM public.tasks t WHERE id=$1',[taskId])).rows[0].record,taskCount:(await f.c.query('SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1',[f.newEpisode])).rows[0].n});
 const before=await historical();
 for(const [command,data]of[
  ['saveWorkspacePlanningSelection',{selection:{...selection,model:'new-model'},expectedSelectionRevision:3}],
  ['retryWorkspacePlanning',{expectedScriptRevisionId:f.main,taskId}],
  ['replanWorkspace',{expectedScriptRevisionId:f.main,planningTaskId:taskId}],
 ]as const){const r=await f.send(command,data);expect(r.status,JSON.stringify(r.body)).toBe(410);expect(r.body.error).toContain('已退役');}
 expect(await historical()).toEqual(before);
 const read=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect(read.status).toBe(200);const body=await read.json();expect(body).not.toHaveProperty('planningSelection');expect(body).not.toHaveProperty('globalPlanningConfigured');
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('v2 direct preparation needs no planner and new media requests require explicit service selection',async()=>{
 const {formalWorkflowFixture}=await import('./formalWorkflow.fixture');const f=await formalWorkflowFixture();try{
 const started=await f.send('start');expect(started.status,JSON.stringify(started.body)).toBe(200);expect(started.body.stage).toBe('script_approved');
 expect((await f.c.query("SELECT count(*)::int n FROM public.tasks WHERE episode_id=$1 AND (provider='codex' OR task_type IN('prepare_visual_brief','draft_storyboard','draft_storyboard_revision'))",[f.newEpisode])).rows[0].n).toBe(0);
 const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);const w=prepared.body;expect(w.id).toBeTruthy();expect((await f.c.query('SELECT selection FROM local_identity.episode_planning_selections WHERE episode_id=$1',[f.newEpisode])).rows.every((row:{selection:unknown})=>row.selection===null)).toBe(true);
 const base={workspaceId:w.id,expectedRevision:w.revision},clip=w.clips[0];
 for(const [command,data]of[
 ['requestWorkspaceImageCandidates',{...base,targetItemId:clip.itemId,prompt:'保留主体',settings:{size:'864x1536',quality:'auto',count:1},referenceMaterialRevisionIds:[],reservationCents:10}],
 ['requestWorkspaceVisualCandidate',{...base,targetItemId:clip.itemId,firstFrameMaterialRevisionId:randomUUID(),prompt:'原画面',durationSeconds:4,reservationCents:10}],
 ['saveWorkspaceNarration',{...base,clipId:clip.id,mode:'tts',text:'完整正文',voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1}],
 ]as const){const r=await f.send(command,data);expect(r.status,JSON.stringify(r.body)).toBe(400);expect(r.body.error).toContain('选择本次制作服务');}
 const manual=await f.send('saveWorkspaceNarration',{...base,clipId:clip.id,mode:'none',text:'使用上传画面与人工来源'});expect(manual.status,JSON.stringify(manual.body)).toBe(200);
 }finally{await f.close();}
},120000);
