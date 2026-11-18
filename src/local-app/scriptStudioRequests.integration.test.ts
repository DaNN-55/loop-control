// @vitest-environment node
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {LocalConnections} from './connections';
import {createProviderProbe} from './providerProbe';
import {createScriptStudioReader} from './scriptStudioProvider';
import {localScriptStudioPlan,estimateScriptDuration,studioShotNarrationEnabled,studioShotCaptionsEnabled} from '../scriptStudio';
import {workspaceScriptExample} from './workspaceScriptInput';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {SecretStore} from './connectionPorts';
import type {MediaFetcher} from '../worker/mediaProviders';
import {csrfFor} from './sessions';
import {canonicalFingerprint} from './configurationCommands';
const contextPath=process.env.LOOP_SCRIPT_STUDIO_TEST_CONTEXT;
let f:Awaited<ReturnType<typeof productionWorkspaceFixture>>,provider:ReturnType<typeof createServer>,providerOrigin='',posts=0,version='';
let mode:'ok'|'hold'|'drop'|'duration'|'empty-voice'|'empty-caption'|'request-setting'='ok',release:(()=>void)|undefined;
const source='一个人推门走进咖啡馆，门铃轻响。他走到窗边坐下，望向对面的空座位，等待朋友。';
const secrets=new Map<string,string>();
const selection=()=>({capability:'language_model',provider:'openai',adapter:'openai_responses',connectionVersionId:version,model:'gpt-5.6-luna'});
const data=(text=source)=>({episodeId:f.episode,expectedScriptRevisionId:f.script,text,targetDuration:15,mode:'optimize',instruction:'',selection:selection()});
async function post(d:Record<string,unknown>,id=randomUUID(),token?:string,csrf=true){const session=token??f.token,r=await fetch(f.origin+'/api/local/script-studio',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+session,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrfFor(session)}:{})},body:JSON.stringify({command:'optimize',idempotencyKey:id,data:d})});return{status:r.status,body:await r.json()};}
beforeAll(async()=>{
 if(!contextPath)return;const {runtimeContext}=await import(contextPath),context=runtimeContext();if(context.dailyRuntime!==false||!context.isolatedFixtureContainer)throw Error('Only explicitly isolated fixture');
 provider=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'gpt-5.6-luna'}));return;}
  posts++;if(mode==='drop'){req.socket.destroy();return;}if(mode==='hold')await new Promise<void>(r=>{release=r;});
  const d=JSON.parse(JSON.parse(body).input[0].content),plan=localScriptStudioPlan(d.source,d.targetDuration);plan.sourceUse='画面描述';plan.summary='增加两个视觉落点，保持原文与总时长。';
  if(!d.instruction.includes('单镜头')){const durations=[Number((plan.durationSeconds*.2).toFixed(2)),Number((plan.durationSeconds*.4).toFixed(2))];durations.push(Number((plan.durationSeconds-durations[0]-durations[1]).toFixed(2)));plan.shots=Array.from({length:3},(_,i)=>({...plan.shots[0],title:'镜头 '+(i+1),durationSeconds:durations[i],camera:'缓慢前移',videoPrompt:'缓慢前移，表达等待。'}));}
  if(/加旁白|加口播/.test(d.instruction)){plan.narrationEnabled=true;plan.captionsEnabled=true;let cursor=0;const spoken=localScriptStudioPlan(d.source,d.targetDuration).shots.map(s=>s.narration).join(' ')||d.source;plan.shots=plan.shots.map((shot,i)=>{const end=i===plan.shots.length-1?spoken.length:Math.round(spoken.length*plan.shots.slice(0,i+1).reduce((n,s)=>n+s.durationSeconds,0)/plan.durationSeconds),narration=spoken.slice(cursor,end);cursor=end;return{...shot,narration};});}
  if(d.mode==='adapt'){plan.changes=['新增朋友出现的情节'];plan.shots[2].visual='朋友出现在门口。';}
  if(mode==='empty-voice'){plan.narrationEnabled=true;plan.shots[0].narration=d.source;}
  if(mode==='empty-caption')plan.captionsEnabled=true;
  if(mode==='duration')plan.durationSeconds=20;
  if(mode==='request-setting')plan.settings.push({field:'targetDuration',value:String(d.targetDuration)});
  const {durationSeconds:_,narrationEnabled:__,captionsEnabled:___,canProceed:____,shots,...metadata}=plan;
  const direction={...metadata,shots:shots.map(shot=>{const {durationSeconds,...rest}=shot;return{...rest,timingWeight:mode==='duration'?0:Math.max(1,Math.round(durationSeconds*10)),narrationEnabled:studioShotNarrationEnabled(plan,shot),captionsEnabled:studioShotCaptionsEnabled(plan,shot),settings:shot.settings.filter(s=>!['口播启用','旁白启用','字幕'].includes(s.field))};}),settings:plan.settings.filter(s=>!['口播启用','旁白启用','字幕'].includes(s.field))};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'resp_'+randomUUID(),status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(direction)}]}],usage:{input_tokens:123,output_tokens:45}}));
 });provider.listen(0,'127.0.0.1');await once(provider,'listening');providerOrigin=`http://127.0.0.1:${(provider.address() as {port:number}).port}`;
 const transport:MediaFetcher=(url,init)=>fetch(providerOrigin+new URL(String(url)).pathname,init),store:SecretStore={mode:'keychain',async putImmutable(ref,value){if(secrets.has(ref)&&secrets.get(ref)!==value)throw Error('immutable');secrets.set(ref,value);},async get(ref){if(!secrets.has(ref))throw Error('missing');return secrets.get(ref)!;}};
 const probe=createProviderProbe({directory:'/not-used',policySha256:''},transport,undefined,{manualVerification:true});
 f=await productionWorkspaceFixture({testContextModule:contextPath,migrations:['db/local/209-script-studio.sql'],runtime:{mountPath:'/'},connections:pool=>new LocalConnections(pool,store,probe,undefined,undefined,undefined,undefined,createScriptStudioReader(transport))});
 const created=await f.post('connections','create',{name:'Script studio fixture',provider:'openai',adapter:'openai_responses',secret:'synthetic-script-studio'});expect(created.status,JSON.stringify(created.body)).toBe(200);version=created.body.connection.current_version_id;
 expect((await f.post('connections','verify',{connectionId:created.body.connection.id})).status).toBe(200);
},90000);
afterAll(async()=>{await f?.close();if(provider?.listening){provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));}},90000);
it.skipIf(!contextPath)('retains a rejected metadata setting receipt and allows only an explicit new attempt without changing production',async()=>{
 const d=data(source+'\n请求参数回归'),id=randomUUID(),count=posts;
 mode='request-setting';let rejected;
 try{rejected=await post(d,id);}finally{mode='ok';}
 expect(rejected.status).toBe(200);expect(rejected.body).toMatchObject({status:'failed',message:'拍法包含不支持的全局制作设置：targetDuration'});
 expect(rejected.body.diagnostic.modelOutput.settings).toContainEqual({field:'targetDuration',value:'15'});expect(rejected.body.responseId).toMatch(/^resp_/);expect(rejected.body.usage.inputTokens).toBe(123);expect(rejected.body.plan).toBeUndefined();
 expect((await post(d,id)).body).toEqual(rejected.body);expect(posts).toBe(count+1);
 const retried=await post(d);expect(retried.body.status).toBe('completed');expect(posts).toBe(count+2);
 expect((await f.c.query('SELECT main_script_revision_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].main_script_revision_id).toBe(f.script);
 expect((await f.c.query('SELECT status FROM local_identity.script_format_requests WHERE id=$1',[id])).rows[0].status).toBe('failed');
});
it.skipIf(!contextPath)('retains legacy request identities but never reuses an older design contract for a fresh optimization',async()=>{
 const d=data(source+'\n合同升级'),id=randomUUID(),first=await post(d,id),sent=posts;
 expect(first.body.status).toBe('completed');
 await f.c.query("UPDATE local_identity.script_format_requests SET payload_hash=$2,request_snapshot=request_snapshot-'wireVersion' WHERE id=$1",[id,canonicalFingerprint({version:'script-studio/v1',data:d})]);
 expect((await post(d,id)).body).toEqual(first.body);expect(posts).toBe(sent);
 expect((await post(d)).body.status).toBe('completed');expect(posts).toBe(sent+1);
 const uncertain=data(source+'\n旧合同未知结果'),unknownId=randomUUID();mode='drop';let unknown;
 try{unknown=await post(uncertain,unknownId);}finally{mode='ok';}
 expect(unknown.body.status).toBe('unknown');
 await f.c.query("UPDATE local_identity.script_format_requests SET payload_hash=$2,request_snapshot=request_snapshot-'wireVersion' WHERE id=$1",[unknownId,canonicalFingerprint({version:'script-studio/v1',data:uncertain})]);
 const attempts=posts;expect((await post(uncertain)).body).toEqual(unknown.body);expect(posts).toBe(attempts);
});
it.skipIf(!contextPath)('reads original script with exact Owner, episode and file identity while allowing completed read-only access',async()=>{
 const url=f.origin+`/api/local/script-studio?episodeId=${f.episode}&scriptRevisionId=${f.script}`;
 const get=async(token=f.token)=>{const r=await fetch(url,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};};
 expect((await get()).body.sourceText).toContain('已确认的第一镜');expect((await get(f.otherToken)).status).toBe(404);
 await f.c.query("UPDATE public.episodes SET stage='production_completed',archived_at=now() WHERE id=$1",[f.episode]);
 try{expect((await get()).status).toBe(200);expect((await post(data())).status).toBe(409);}finally{await f.c.query("UPDATE public.episodes SET stage='storyboard_approved',archived_at=NULL WHERE id=$1",[f.episode]);}
});
it.skipIf(!contextPath)('explicitly designs valid prose, deduplicates retries and preserves the saved production until approval',async()=>{
 const count=posts,id=randomUUID(),d=data(source+'\n一');const r=await post(d,id);expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body).toMatchObject({status:'completed',plan:{durationSeconds:15,narrationEnabled:false,captionsEnabled:false}});expect(r.body.plan.shots).toHaveLength(3);
 expect(await post(d,id)).toEqual(r);expect(await post(d)).toEqual(r);expect(posts).toBe(count+1);expect((await f.c.query('SELECT main_script_revision_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].main_script_revision_id).toBe(f.script);
});
it.skipIf(!contextPath)('requires exact Origin/CSRF/Owner/baseline and rejects altered duration or hidden client plan fields',async()=>{
 const count=posts;expect((await post(data(),randomUUID(),f.otherToken)).status).toBe(404);expect((await post(data(),randomUUID(),undefined,false)).status).toBe(403);expect((await post({...data(),expectedScriptRevisionId:randomUUID()})).status).toBe(409);expect((await post({...data(),plan:{}})).status).toBe(400);expect(posts).toBe(count);
 mode='duration';try{expect((await post(data(source+'\n时长冲突'))).body.status).toBe('failed');}finally{mode='ok';}
});
it.skipIf(!contextPath)('recovers concurrent and unknown requests without duplicate provider calls',async()=>{
 mode='hold';const count=posts,d=data(source+'\n并发'),pending=post(d);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));expect((await post(d)).body.status).toBe('pending');release!();release=undefined;expect((await pending).body.status).toBe('completed');expect(posts).toBe(count+1);
 mode='drop';try{const d=data(source+'\n未知'),r=await post(d),sent=posts;expect(r.body.status).toBe('unknown');expect((await post(d)).body).toEqual(r.body);expect(posts).toBe(sent);}finally{mode='ok';}
});
it.skipIf(!contextPath)('binds modifications to the same source and duration and separates explicit adaptation',async()=>{
 const d=data(source+'\n修改'),first=await post(d);expect(first.body.status).toBe('completed');
 const second=await post({...d,instruction:'保留单镜头',previousRequestId:first.body.requestId});expect(second.body.plan.shots).toHaveLength(1);
 expect((await post({...d,text:d.text+'变化',instruction:'保留单镜头',previousRequestId:first.body.requestId})).status).toBe(409);
 const adapted=await post({...d,mode:'adapt',previousRequestId:first.body.requestId});expect(adapted.body.plan.changes).toHaveLength(1);
});
it.skipIf(!contextPath)('locks an empty target to the displayed estimate and retains completed receipts after a baseline change',async()=>{
 const text=source+'\n预计时长',r=await post({...data(text),targetDuration:null});expect(r.body.status).toBe('completed');expect(r.body.plan.durationSeconds).toBe(estimateScriptDuration(text));
 mode='hold';const id=randomUUID(),pending=post(data(source+'\n基准变化'),id);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));await f.c.query('UPDATE public.episodes SET main_script_revision_id=NULL WHERE id=$1',[f.episode]);release!();release=undefined;
 try{expect((await pending).status).toBe(409);expect((await f.c.query('SELECT status FROM local_identity.script_format_requests WHERE id=$1',[id])).rows[0].status).toBe('completed');}finally{await f.c.query('UPDATE public.episodes SET main_script_revision_id=$2 WHERE id=$1',[f.episode,f.script]);mode='ok';}
});
it.skipIf(!contextPath)('never resends after a durable receipt write failure',async()=>{
 const d=data(source+'\n写入失败'),count=posts;await f.c.query("CREATE FUNCTION local_identity.studio_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.status='completed' THEN RAISE EXCEPTION 'Controlled receipt fault';END IF;RETURN NEW;END $$;CREATE TRIGGER studio_receipt_fault BEFORE UPDATE ON local_identity.script_format_requests FOR EACH ROW EXECUTE FUNCTION local_identity.studio_receipt_fault()");
 try{expect((await post(d)).status).toBe(503);}finally{await f.c.query('DROP TRIGGER studio_receipt_fault ON local_identity.script_format_requests;DROP FUNCTION local_identity.studio_receipt_fault()');}
 expect(posts).toBe(count+1);expect((await post(d)).body.status).toBe('pending');expect(posts).toBe(count+1);
});
it.skipIf(!contextPath)('rejects blank enabled voice/subtitle fields and cannot approve the failed receipt',async()=>{
 const text='朋友坐下。';
 for(const invalid of ['empty-voice','empty-caption'] as const){mode=invalid;try{const r=await post(data(text));expect(r.body.status).toBe('failed');expect(r.body.message).toContain(invalid==='empty-voice'?'每个启用口播':'每个启用字幕');expect((await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text,targetDuration:15,reason:'',requestId:r.body.requestId})).status).toBe(409);}finally{mode='ok';}}
});
it.skipIf(!contextPath)('approves a receipted plan once, retains original source and prepares a real silent three-shot project',async()=>{
 const d=data(),r=await post(d),payload={episodeId:f.episode,expectedScriptRevisionId:f.script,text:source,targetDuration:15,reason:'',requestId:r.body.requestId};expect(r.body.status).toBe('completed');
 expect((await f.request('confirmScriptStudio',{...payload,plan:r.body.plan})).status).toBe(400);expect((await f.request('confirmScriptStudio',{...payload,targetDuration:16})).status).toBe(409);expect((await f.request('confirmScriptStudio',{...payload,text:source+'篡改'})).status).toBe(409);
 const saved=await f.request('confirmScriptStudio',payload);expect(saved.status,JSON.stringify(saved.body)).toBe(200);const script=saved.body.id;
 const read=await fetch(f.origin+`/api/local/script-studio?episodeId=${f.episode}&scriptRevisionId=${script}`,{headers:{Cookie:'loop_owner_session='+f.token}}).then(r=>r.json());expect(read.sourceText).toBe(source);expect(read.plan.shots).toHaveLength(3);expect(read.targetDuration).toBe(15);
 expect((await f.request('start')).status).toBe(200);const prepared=await f.request('prepareWorkspace',{expectedScriptRevisionId:script});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.clips).toHaveLength(3);expect(prepared.body.narration.every((n:{enabled:boolean})=>!n.enabled)).toBe(true);expect(prepared.body.captions.every((c:{contract:{enabled:boolean}})=>!c.contract.enabled)).toBe(true);
 await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);
});
it.skipIf(!contextPath)('continues arbitrary Markdown directly without any provider request and with original source retained',async()=>{
 const count=posts,text='# 自由原文\n\n这是第一段。\n\n仍是同一场景。',saved=await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text,targetDuration:null,reason:''});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(posts).toBe(count);
 const read=await fetch(f.origin+`/api/local/script-studio?episodeId=${f.episode}&scriptRevisionId=${saved.body.id}`,{headers:{Cookie:'loop_owner_session='+f.token}}).then(r=>r.json());expect(read.sourceText).toBe(text);expect(read.plan.shots).toHaveLength(1);
 await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);
});
it.skipIf(!contextPath)('prepares a 180-second logical shot and a 15000-character source without splitting or enabling audio',async()=>{
 const text='原'.repeat(15000),saved=await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text,targetDuration:180,reason:''});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 expect((await f.request('start')).status).toBe(200);
 const old=(await f.c.query('SELECT id,revision FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0];
 const prepared=await f.request(old?'replanWorkspace':'prepareWorkspace',{...(old?{workspaceId:old.id,expectedRevision:Number(old.revision),reason:'验证长片段'}:{}),expectedScriptRevisionId:saved.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.clips).toHaveLength(1);expect(prepared.body.narration[0].enabled).toBe(false);
 let w=prepared.body;const image=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'long-shot.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});expect(image.status,JSON.stringify(image.body)).toBe(200);
 const matched=await f.request('matchWorkspaceImage',{workspaceId:w.id,expectedRevision:w.revision,clipId:w.clips[0].id,materialRevisionId:image.body.id,usage:'still',durationSeconds:180,fit:'cover',focusX:0,focusY:0});expect(matched.status,JSON.stringify(matched.body)).toBe(200);w=matched.body;
 const registered=await f.request('registerWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,targetItemId:w.clips[0].itemId,materialRevisionId:image.body.id,usage:'still',durationSeconds:180});expect(registered.status,JSON.stringify(registered.body)).toBe(200);w=registered.body;
 const candidate=w.visualCandidates.find((v:{materialRevisionId:string})=>v.materialRevisionId===image.body.id),approval=await f.request('prepareWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,durationPolicy:'keep-target',motionPolicy:'preserve-target'});expect(approval.status,JSON.stringify(approval.body)).toBe(200);
 const adopted=await f.request('adoptWorkspaceVisualCandidate',{workspaceId:w.id,expectedRevision:w.revision,candidateId:candidate.id,adoptionId:approval.body.adoptionId});expect(adopted.status,JSON.stringify(adopted.body)).toBe(200);
 const native=JSON.parse(await readFile(join(f.assetRoot,adopted.body.project.relativePath),'utf8')),item=native.timelines[0].items.find((item:{id:string})=>item.id===w.clips[0].itemId);expect(item.kind).toBe('image');expect(item.durationInFrames).toBe(5400);expect(adopted.body.readiness.placeholders).not.toContain(item.id);
 await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);
});
it.skipIf(!contextPath)('keeps explicit global voice-off and each existing subtitle switch in the actual project',async()=>{
 const text=workspaceScriptExample.replace('- 旁白音色：默认','- 口播启用：关闭\n- 旁白音色：默认'),saved=await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text,targetDuration:null,reason:''});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect((await f.request('start')).status).toBe(200);
 const old=(await f.c.query('SELECT id,revision FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0],prepared=await f.request('replanWorkspace',{workspaceId:old.id,expectedRevision:Number(old.revision),expectedScriptRevisionId:saved.body.id,reason:'验证原有逐镜设置'});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.narration.every((n:{enabled:boolean})=>!n.enabled)).toBe(true);expect(prepared.body.captions.map((c:{contract:{enabled:boolean}})=>c.contract.enabled)).toEqual([true,true,false]);
 await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);
});
it.skipIf(!contextPath)('assembles null-subtitle lanes from exactly the approved narration instead of visual fallback text',async()=>{
 const text='朋友坐下。',proposed=await post({...data(text),instruction:'加旁白'});expect(proposed.body.status,JSON.stringify(proposed.body)).toBe('completed');expect(proposed.body.plan.shots.every((s:{subtitle:string|null})=>s.subtitle===null)).toBe(true);
 const saved=await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text,targetDuration:15,reason:'',requestId:proposed.body.requestId});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect((await f.request('start')).status).toBe(200);
 const old=(await f.c.query('SELECT id,revision FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0],prepared=await f.request(old?'replanWorkspace':'prepareWorkspace',{...(old?{workspaceId:old.id,expectedRevision:Number(old.revision),reason:'验证明确字幕正文'}:{}),expectedScriptRevisionId:saved.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
 expect(prepared.body.captions.map((c:{contract:{text:string}})=>c.contract.text)).toEqual(proposed.body.plan.shots.map((s:{narration:string})=>s.narration));expect(prepared.body.narration.every((n:{enabled:boolean})=>n.enabled)).toBe(true);
 await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);
});
it.skipIf(!contextPath)('continues explicit subtitle-only prose with the exact independent caption and voice disabled',async()=>{
 const text='画面：窗边一盏灯。\n字幕：慢一点回家。\n口播：关闭',count=posts,saved=await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text,targetDuration:6,reason:''});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(posts).toBe(count);expect((await f.request('start')).status).toBe(200);
 const old=(await f.c.query('SELECT id,revision FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0],prepared=await f.request(old?'replanWorkspace':'prepareWorkspace',{...(old?{workspaceId:old.id,expectedRevision:Number(old.revision),reason:'验证字幕原文'}:{}),expectedScriptRevisionId:saved.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.narration[0].enabled).toBe(false);expect(prepared.body.captions[0].contract).toMatchObject({enabled:true,contentMode:'independent',text:'慢一点回家。'});
 await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);
});
it.skipIf(!contextPath||!process.env.LOOP_SCRIPT_STUDIO_UI_FIXTURE)('holds an isolated script studio browser fixture',async()=>{
 const {createServer:createVite}=await import('vite'),{default:react}=await import('@vitejs/plugin-react'),{writeFile,access}=await import('node:fs/promises');
 const app=await createVite({configFile:false,root:process.cwd(),envFile:false,cacheDir:'.scratch/script-studio-20261117/vite-cache',plugins:[react()],optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:0,proxy:Object.fromEntries(['/api/local','/_local-artifact'].map(path=>[path,{target:f.origin,changeOrigin:true,headers:{Origin:f.origin}}]))}});
 try{await app.listen();const origin=`http://127.0.0.1:${(app.httpServer!.address() as {port:number}).port}`,output=process.env.LOOP_SCRIPT_STUDIO_UI_FIXTURE!,accountId=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,created=await f.post('episode-commands','create',{accountId,title:'脚本改版浏览器验收'});expect(created.status,JSON.stringify(created.body)).toBe(200);await writeFile(output,JSON.stringify({origin,email:f.email,password:f.password,episodeId:created.body.id,stopFile:output+'.stop'}),{mode:0o600});const deadline=Date.now()+600000;while(Date.now()<deadline){try{await access(output+'.stop');break;}catch{await new Promise(r=>setTimeout(r,250));}}}finally{await app.close();}
},630000);
