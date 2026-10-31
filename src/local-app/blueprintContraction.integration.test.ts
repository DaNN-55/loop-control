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

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('ordinary planning drafts persist before workspace creation and failed retries retain their frozen selection',async()=>{
 const {formalWorkflowFixture}=await import('./formalWorkflow.fixture');const f=await formalWorkflowFixture({configurePlanning:false,scriptText:'# 普通脚本\n\n## 正文\n原画面中的事实'});try{
 const harnesses=(await f.c.query("SELECT id FROM public.prompt_versions WHERE account_id=(SELECT account_id FROM public.episodes WHERE id=$1) AND capability='storyboard_planning' AND is_active ORDER BY version DESC",[f.newEpisode])).rows;
 const selection={provider:'codex',adapter:'codex',model:'gpt-5.6-luna',harnessId:harnesses[0].id,budgetCents:37,allowedTools:['read','write']};
 const saved=await f.send('saveWorkspacePlanningSelection',{selection,expectedSelectionRevision:0});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 const read=await fetch(`${f.origin}/api/local/episodes/${f.newEpisode}/workspace`,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await read.json()).planningSelection.selection).toEqual(selection);
 await f.send('importMaterial',{sourceKind:'file',sourcePath:'ref.mp4',materialType:'video',materialPurpose:'visual_reference',mimeType:'video/mp4',isMainScript:false,contentBase64:(await (await import('node:fs/promises')).readFile(f.assetRoot+'/'+f.videoPath)).toString('base64')});
 expect((await f.send('start')).status).toBe(200);const first=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(first.status,JSON.stringify(first.body)).toBe(200);expect(first.body.planning).toBe(true);
 const original=(await f.c.query('SELECT input_snapshot,model,budget_limit_cents FROM public.tasks WHERE id=$1',[first.body.taskId])).rows[0];expect(original.model).toBe(selection.model);expect(original.budget_limit_cents).toBe(37);expect(original.input_snapshot.harness.id).toBe(selection.harnessId);
 expect((await f.send('saveWorkspacePlanningSelection',{selection:{...selection,model:'gpt-5.6-codex',budgetCents:83},expectedSelectionRevision:1})).status).toBe(200);
 await f.c.query("UPDATE public.tasks SET status='failed' WHERE id=$1",[first.body.taskId]);const retry=await f.send('retryWorkspacePlanning',{expectedScriptRevisionId:f.main,taskId:first.body.taskId});expect(retry.status,JSON.stringify(retry.body)).toBe(200);
 const frozen=(await f.c.query('SELECT input_snapshot,model,budget_limit_cents FROM public.tasks WHERE id=$1',[retry.body.taskId])).rows[0];expect(frozen.model).toBe(selection.model);expect(frozen.budget_limit_cents).toBe(37);expect(frozen.input_snapshot.harness).toEqual(original.input_snapshot.harness);expect(frozen.input_snapshot.allowed_tools).toEqual(original.input_snapshot.allowed_tools);
 await f.c.query("UPDATE public.tasks SET status='failed' WHERE id=$1",[retry.body.taskId]);const replanned=await f.send('replanWorkspace',{expectedScriptRevisionId:f.main,planningTaskId:retry.body.taskId});expect(replanned.status,JSON.stringify(replanned.body)).toBe(200);expect((await f.c.query('SELECT model,budget_limit_cents FROM public.tasks WHERE id=$1',[replanned.body.taskId])).rows[0]).toEqual({model:'gpt-5.6-codex',budget_limit_cents:83});
 await f.c.query('UPDATE public.episodes SET archived_at=clock_timestamp() WHERE id=$1',[f.newEpisode]);expect((await f.send('saveWorkspacePlanningSelection',{selection,expectedSelectionRevision:2})).status).toBe(409);
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('v2 direct preparation needs no planner and new media requests require explicit service selection',async()=>{
 const {formalWorkflowFixture}=await import('./formalWorkflow.fixture');const f=await formalWorkflowFixture();try{
 expect((await f.send('start')).status).toBe(200);const prepared=await f.send('prepareWorkspace',{expectedScriptRevisionId:f.main});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);const w=prepared.body;expect(w.id).toBeTruthy();expect((await f.c.query('SELECT selection FROM local_identity.episode_planning_selections WHERE episode_id=$1',[f.newEpisode])).rows[0].selection).toBeNull();
 const base={workspaceId:w.id,expectedRevision:w.revision},clip=w.clips[0];
 for(const [command,data]of[
 ['requestWorkspaceImageCandidates',{...base,targetItemId:clip.itemId,prompt:'保留主体',settings:{size:'864x1536',quality:'auto',count:1},referenceMaterialRevisionIds:[],reservationCents:10}],
 ['requestWorkspaceVisualCandidate',{...base,targetItemId:clip.itemId,firstFrameMaterialRevisionId:randomUUID(),prompt:'原画面',durationSeconds:4,reservationCents:10}],
 ['saveWorkspaceNarration',{...base,clipId:clip.id,mode:'tts',text:'完整正文',voice:'zh_female_vv_uranus_bigtts',languageCode:'zh-CN',speakingRate:1}],
 ]as const){const r=await f.send(command,data);expect(r.status,JSON.stringify(r.body)).toBe(400);expect(r.body.error).toContain('选择本次制作服务');}
 const manual=await f.send('saveWorkspaceNarration',{...base,clipId:clip.id,mode:'none',text:'使用上传画面与人工来源'});expect(manual.status,JSON.stringify(manual.body)).toBe(200);
 }finally{await f.close();}
},120000);
