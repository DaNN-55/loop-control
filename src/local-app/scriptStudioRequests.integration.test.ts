// @vitest-environment node
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {LocalConnections} from './connections';
import {createProviderProbe} from './providerProbe';
import {createScriptStudioReader,createScriptStudioDiscussionReader} from './scriptStudioProvider';
import {localScriptStudioPlan,estimateScriptDuration,studioShotNarrationEnabled,studioShotCaptionsEnabled} from '../scriptStudio';
import {workspaceScriptExample} from './workspaceScriptInput';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {readFile,writeFile} from 'node:fs/promises';
import {scriptStudioAttachmentRef,type ScriptStudioAttachmentRef} from '../scriptStudioAttachments';
import {join} from 'node:path';
import type {SecretStore} from './connectionPorts';
import type {MediaFetcher} from '../worker/mediaProviders';
import {csrfFor} from './sessions';
import {canonicalFingerprint} from './configurationCommands';
const contextPath=process.env.LOOP_SCRIPT_STUDIO_TEST_CONTEXT;
let f:Awaited<ReturnType<typeof productionWorkspaceFixture>>,provider:ReturnType<typeof createServer>,providerOrigin='',posts=0,version='',textConnection='';
const providerEfforts:string[]=[];
const providerImageParts:string[][]=[],providerFileParts:string[][]=[],providerInstructions:string[]=[];
const providerInputs:{conversation?:{role:string;content:string}[];previousPlan?:{shots:{visual:string}[]};attachments?:ScriptStudioAttachmentRef[];documents?:{name:string;text:string}[]}[]=[];
let mode:'ok'|'hold'|'drop'|'duration'|'empty-voice'|'empty-caption'|'request-setting'='ok',release:(()=>void)|undefined;
const source='一个人推门走进咖啡馆，门铃轻响。他走到窗边坐下，望向对面的空座位，等待朋友。';
const secrets=new Map<string,string>();
const selection=()=>({capability:'language_model',provider:'openai',adapter:'openai_responses',connectionVersionId:version,model:'gpt-5.6-luna'});
const data=(text=source)=>({episodeId:f.episode,expectedScriptRevisionId:f.script,text,targetDuration:15,mode:'optimize',instruction:'',selection:selection()});
async function post(d:Record<string,unknown>,id=randomUUID(),token?:string,csrf=true,command='optimize'){const session=token??f.token,r=await fetch(f.origin+'/api/local/script-studio',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+session,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrfFor(session)}:{})},body:JSON.stringify({command,idempotencyKey:id,data:d})});return{status:r.status,body:await r.json()};}
beforeAll(async()=>{
 if(!contextPath)return;const {runtimeContext}=await import(contextPath),context=runtimeContext();if(context.dailyRuntime!==false||!(context.isolatedFixtureContainer||context.isolatedFixtureNative&&context.nativeConnection))throw Error('Only explicitly isolated fixture');
 provider=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;if(req.url==='/__fixture/state'){res.setHeader('Content-Type','application/json');if(req.method==='POST'){const requested=JSON.parse(body).mode;if(!['ok','drop'].includes(requested)){res.statusCode=400;res.end('{}');return;}mode=requested;}res.end(JSON.stringify({posts,mode,imageCounts:providerImageParts.map(parts=>parts.length),lastInput:providerInputs.at(-1),lastInstructions:providerInstructions.at(-1)}));return;}if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'gpt-5.6-luna'},{id:'gpt-6.1-sol'},{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]}));return;}
  posts++;const wire=JSON.parse(body),content=wire.input[0].content,parts=typeof content==='string'?[]:content as {type:string;text?:string;image_url?:string;file_data?:string}[];
  const d=JSON.parse(typeof content==='string'?content:parts.find(part=>part.type==='input_text')!.text!);providerInputs.push(d);providerEfforts.push(wire.reasoning.effort);providerImageParts.push(parts.filter(part=>part.type==='input_image').map(part=>part.image_url!));providerFileParts.push(parts.filter(part=>part.type==='input_file').map(part=>part.file_data!));providerInstructions.push(wire.instructions);
  if(mode==='drop'){req.socket.destroy();return;}if(mode==='hold')await new Promise<void>(r=>{release=r;});
  if(JSON.parse(body).text.format.name==='script_studio_discussion_v1'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:wire.model.startsWith('deepseek-')?randomUUID():'resp_'+randomUUID(),status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:d.instruction==='17乘19等于多少？请直接计算。'?'17×19=323。':'继续保留口播，不增加人物。'})}]}],usage:{input_tokens:35,output_tokens:15}}));return;}const plan=localScriptStudioPlan(d.source,d.targetDuration);plan.sourceUse='画面描述';plan.summary='增加两个视觉落点，保持原文与总时长。';
  if(!d.instruction.includes('单镜头')){const durations=[Number((plan.durationSeconds*.2).toFixed(2)),Number((plan.durationSeconds*.4).toFixed(2))];durations.push(Number((plan.durationSeconds-durations[0]-durations[1]).toFixed(2)));plan.shots=Array.from({length:3},(_,i)=>({...plan.shots[0],title:'镜头 '+(i+1),durationSeconds:durations[i],camera:'缓慢前移',videoPrompt:'缓慢前移，表达等待。'}));}
  if(/加旁白|加口播/.test([...(d.conversation??[]).filter((m:{role:string})=>m.role==='user').map((m:{content:string})=>m.content),d.instruction].join('\n'))){plan.narrationEnabled=true;plan.captionsEnabled=true;let cursor=0;const spoken=localScriptStudioPlan(d.source,d.targetDuration).shots.map(s=>s.narration).join(' ')||d.source;plan.shots=plan.shots.map((shot,i)=>{const end=i===plan.shots.length-1?spoken.length:Math.round(spoken.length*plan.shots.slice(0,i+1).reduce((n,s)=>n+s.durationSeconds,0)/plan.durationSeconds),narration=spoken.slice(cursor,end);cursor=end;return{...shot,narration};});}
  if(mode==='empty-voice'){plan.narrationEnabled=true;plan.shots[0].narration=d.source;}
  if(mode==='empty-caption')plan.captionsEnabled=true;
  if(mode==='duration')plan.durationSeconds=20;
  if(mode==='request-setting')plan.settings.push({field:'targetDuration',value:String(d.targetDuration)});
  const {durationSeconds:_,narrationEnabled:__,captionsEnabled:___,canProceed:____,shots,...metadata}=plan;
  const direction={...metadata,shots:shots.map(shot=>{const {durationSeconds,...rest}=shot;return{...rest,timingWeight:mode==='duration'?0:Math.max(1,Math.round(durationSeconds*10)),narrationEnabled:studioShotNarrationEnabled(plan,shot),captionsEnabled:studioShotCaptionsEnabled(plan,shot),settings:shot.settings.filter(s=>!['口播启用','旁白启用','字幕'].includes(s.field))};}),settings:plan.settings.filter(s=>!['口播启用','旁白启用','字幕'].includes(s.field))};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:wire.model.startsWith('deepseek-')?randomUUID():'resp_'+randomUUID(),status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(direction)}]}],usage:{input_tokens:123,output_tokens:45}}));
 });provider.listen(0,'127.0.0.1');await once(provider,'listening');providerOrigin=`http://127.0.0.1:${(provider.address() as {port:number}).port}`;
 const transport:MediaFetcher=(url,init)=>fetch(providerOrigin+new URL(String(url)).pathname,init),store:SecretStore={mode:'keychain',async putImmutable(ref,value){if(secrets.has(ref)&&secrets.get(ref)!==value)throw Error('immutable');secrets.set(ref,value);},async get(ref){if(!secrets.has(ref))throw Error('missing');return secrets.get(ref)!;}};
 const probe=createProviderProbe({directory:'/not-used',policySha256:''},transport,undefined,{manualVerification:true});
 f=await productionWorkspaceFixture({testContextModule:contextPath,migrations:['db/local/209-script-studio.sql','db/local/210-script-language-models.sql','db/local/211-script-studio-conversations.sql'],runtime:{mountPath:'/'},connections:pool=>new LocalConnections(pool,store,probe,undefined,undefined,undefined,undefined,createScriptStudioReader(transport),createScriptStudioDiscussionReader(transport))});
 const created=await f.post('connections','create',{name:'Script studio fixture',provider:'openai',adapter:'openai_responses',secret:'synthetic-script-studio'});expect(created.status,JSON.stringify(created.body)).toBe(200);version=created.body.connection.current_version_id;textConnection=created.body.connection.id;
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
it.skipIf(!contextPath)('binds modifications to the same source and duration and retires standalone adaptation',async()=>{
 const d=data(source+'\n修改'),first=await post(d);expect(first.body.status).toBe('completed');
 const second=await post({...d,instruction:'保留单镜头',previousRequestId:first.body.requestId});expect(second.body.plan.shots).toHaveLength(1);
 expect((await post({...d,text:d.text+'变化',instruction:'保留单镜头',previousRequestId:first.body.requestId})).status).toBe(409);
 const sent=posts,adapted=await post({...d,mode:'adapt',previousRequestId:first.body.requestId});expect(adapted.status).toBe(410);expect(adapted.body.error).toContain('退役');expect(posts).toBe(sent);
});
it.skipIf(!contextPath)('binds native reasoning to the provider request and receipt identity while reusing default none',async()=>{
 const d=data(source+' 推理强度'),count=posts,base=await post(d);expect(base.body.status).toBe('completed');expect(providerEfforts.at(-1)).toBe('none');
 expect((await post({...d,reasoningEffort:'none'})).body.requestId).toBe(base.body.requestId);expect(posts).toBe(count+1);
 const high=await post({...d,reasoningEffort:'high'});expect(high.body.status,JSON.stringify(high.body)).toBe('completed');expect(high.body.requestId).not.toBe(base.body.requestId);expect(providerEfforts.at(-1)).toBe('high');expect((await post({...d,reasoningEffort:'high'})).body.requestId).toBe(high.body.requestId);expect(posts).toBe(count+2);
 const snapshot=(await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[high.body.requestId])).rows[0].request_snapshot;expect(snapshot.body.reasoning.effort).toBe('high');expect(snapshot.data.reasoningEffort).toBe('high');
 expect((await post({...d,reasoningEffort:'invalid'})).status).toBe(400);expect((await post({...d,selection:{...selection(),provider:'deepseek',model:'deepseek-flash'},reasoningEffort:'medium'})).status).toBe(400);expect(posts).toBe(count+2);
 const talk=await post({...d,mode:'discuss',instruction:'需要怎样调整？',previousRequestId:high.body.requestId,reasoningEffort:'low'});expect(talk.body.status).toBe('completed');expect(providerEfforts.at(-1)).toBe('low');
});
it.skipIf(!contextPath)('retains historical adaptation receipts for conversation and adoption without reintroducing new requests',async()=>{
 const d=data(source+' 历史改编'),old=await post(d),count=posts,result={...old.body,plan:{...old.body.plan,changes:['历史改编记录'],shots:old.body.plan.shots.map((shot:Record<string,unknown>,index:number)=>index?shot:{...shot,visual:'历史方案的画面。'})}};
 await f.c.query("UPDATE local_identity.script_format_requests SET request_snapshot=jsonb_set(request_snapshot,'{data,mode}','\"adapt\"'::jsonb),result=$2 WHERE id=$1",[old.body.requestId,result]);
 const {episodeId,expectedScriptRevisionId,text,targetDuration}=d,restored=await post({episodeId,expectedScriptRevisionId,text,targetDuration},randomUUID(),undefined,true,'conversation');expect(restored.body.mode).toBe('revision');expect(restored.body.result.plan.changes).toEqual(['历史改编记录']);
 const saved=await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text:d.text,targetDuration:15,reason:'历史方案验收',requestId:old.body.requestId});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(posts).toBe(count);expect((await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[old.body.requestId])).rows[0].request_snapshot.data.mode).toBe('adapt');await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);
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
it.skipIf(!contextPath)('derives immutable manual shot receipts without Provider dispatch and carries them into refinement and approval',async()=>{
 const text=source+' 手动修订验证',base=await post(data(text)),count=posts,id=randomUUID(),edit={episodeId:f.episode,expectedScriptRevisionId:f.script,text,targetDuration:15,previousRequestId:base.body.requestId,index:0,fields:{visual:'窗边的柔和晨光，镜头缓慢向前。',camera:'固定机位'}};
 const changed=await post(edit,id,undefined,true,'editShot');expect(changed.status,JSON.stringify(changed.body)).toBe(200);expect(changed.body.plan.shots[0].visual).toBe(edit.fields.visual);expect(posts).toBe(count);expect((await post(edit,id,undefined,true,'editShot')).body).toEqual(changed.body);expect((await post({...edit,fields:{visual:'不同内容'}},id,undefined,true,'editShot')).status).toBe(409);
 const original=(await f.c.query('SELECT result FROM local_identity.script_format_requests WHERE id=$1',[base.body.requestId])).rows[0].result;expect(original.plan.shots[0].visual).not.toBe(edit.fields.visual);
 expect((await post({...edit,text:text+'改变'},randomUUID(),undefined,true,'editShot')).status).toBe(409);expect((await post({...edit,fields:{durationSeconds:30}},randomUUID(),undefined,true,'editShot')).status).toBe(400);expect((await post(edit,randomUUID(),f.otherToken,true,'editShot')).status).toBe(404);expect((await post(edit,randomUUID(),undefined,false,'editShot')).status).toBe(403);expect(posts).toBe(count);
 const refined=await post({...data(text),mode:'optimize',instruction:'调整整体节奏',previousRequestId:changed.body.requestId});expect(refined.body.status,JSON.stringify(refined.body)).toBe('completed');expect(providerInputs.at(-1)?.previousPlan?.shots[0].visual).toBe(edit.fields.visual);
 const saved=await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text,targetDuration:15,reason:'手动修订验收',requestId:changed.body.requestId});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 try{const read=await fetch(f.origin+`/api/local/script-studio?episodeId=${f.episode}&scriptRevisionId=${saved.body.id}`,{headers:{Cookie:'loop_owner_session='+f.token}}).then(r=>r.json());expect(read.sourceText).toBe(text);expect(read.plan.shots[0].visual).toBe(edit.fields.visual);expect(read.plan.shots[0].camera).toBe('固定机位');expect(read.plan.durationSeconds).toBe(15);expect(posts).toBe(count+1);}finally{await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);}
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
it.skipIf(!contextPath)('uses manually edited enabled narration and captions in the actual prepared project while preserving the original',async()=>{
 const text='朋友坐下。',base=await post({...data(text),instruction:'加旁白'}),count=posts;
 const edited=await post({episodeId:f.episode,expectedScriptRevisionId:f.script,text,targetDuration:15,previousRequestId:base.body.requestId,index:0,fields:{narration:'手动口播。',subtitle:'手动字幕。'}},randomUUID(),undefined,true,'editShot');expect(edited.status,JSON.stringify(edited.body)).toBe(200);expect(posts).toBe(count);expect((await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[edited.body.requestId])).rows[0].request_snapshot.data.mode).toBe('revision');
 const saved=await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text,targetDuration:15,reason:'直接编辑口播字幕',requestId:edited.body.requestId});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect((await f.request('start')).status).toBe(200);
 try{const old=(await f.c.query('SELECT id,revision FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0],prepared=await f.request(old?'replanWorkspace':'prepareWorkspace',{...(old?{workspaceId:old.id,expectedRevision:Number(old.revision),reason:'手动文字实际制作验收'}:{}),expectedScriptRevisionId:saved.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.captions[0].contract.text).toBe('手动字幕。');const read=await fetch(f.origin+`/api/local/script-studio?episodeId=${f.episode}&scriptRevisionId=${saved.body.id}`,{headers:{Cookie:'loop_owner_session='+f.token}}).then(r=>r.json());expect(read.sourceText).toBe(text);expect(read.plan.shots[0].narration).toBe('手动口播。');}finally{await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);}
});
it.skipIf(!contextPath||!process.env.LOOP_SCRIPT_STUDIO_UI_FIXTURE)('holds an isolated script studio browser fixture',async()=>{
 const {createServer:createVite}=await import('vite'),{default:react}=await import('@vitejs/plugin-react'),{writeFile,access}=await import('node:fs/promises');
 const app=await createVite({configFile:false,root:process.cwd(),envFile:false,cacheDir:process.env.LOOP_SCRIPT_STUDIO_UI_CACHE??'.scratch/script-chat-features-20261118/vite-cache',plugins:[react()],optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:0,proxy:Object.fromEntries(['/api/local','/_local-artifact'].map(path=>[path,{target:f.origin,changeOrigin:true,headers:{Origin:f.origin}}]))}});
 try{await app.listen();const origin=`http://127.0.0.1:${(app.httpServer!.address() as {port:number}).port}`,output=process.env.LOOP_SCRIPT_STUDIO_UI_FIXTURE!,accountId=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,created=await f.post('episode-commands','create',{accountId,title:'新对话与图片附件浏览器验收'});expect(created.status,JSON.stringify(created.body)).toBe(200);await writeFile(output,JSON.stringify({origin,email:f.email,password:f.password,episodeId:created.body.id,providerOrigin,stopFile:output+'.stop'}),{mode:0o600});const deadline=Date.now()+600000;while(Date.now()<deadline){try{await access(output+'.stop');break;}catch{await new Promise(r=>setTimeout(r,250));}}}finally{await app.close();}
},630000);

it.skipIf(!contextPath)('persists multi-turn discussion, restores without a provider call and retains the plan through discussion and manual edits',async()=>{
 const d=data(source+'\n聊天恢复'),first=await post({...d,instruction:'不增加人物。'});expect(first.body.status).toBe('completed');
 const talk=await post({...d,mode:'discuss',instruction:'节奏还能慢一些吗？',previousRequestId:first.body.requestId});expect(talk.status,JSON.stringify(talk.body)).toBe(200);expect(talk.body.message).toContain('不增加人物');expect(talk.body.plan).toBeUndefined();
 expect((await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text:d.text,targetDuration:15,reason:'',requestId:talk.body.requestId})).status).toBe(409);
 const count=posts,{episodeId,expectedScriptRevisionId,text,targetDuration}=d,read={episodeId,expectedScriptRevisionId,text,targetDuration};
 const restored=await post(read,randomUUID(),undefined,true,'conversation');expect(restored.status,JSON.stringify(restored.body)).toBe(200);expect(restored.body.latestRequestId).toBe(talk.body.requestId);expect(restored.body.result.requestId).toBe(first.body.requestId);expect(restored.body.turns.map((t:{instruction:string})=>t.instruction)).toEqual(['不增加人物。','节奏还能慢一些吗？']);expect(restored.body.turns[0]).toMatchObject({model:'gpt-5.6-luna',provider:'openai'});expect(posts).toBe(count);
 expect((await post(read,randomUUID(),f.otherToken,true,'conversation')).status).toBe(404);expect((await post({...read,text:text+'变化'},randomUUID(),undefined,true,'conversation')).body.turns).toEqual([]);
 const edit=await post({...read,previousRequestId:talk.body.requestId,index:0,fields:{visual:'不增加人物，保留柔和晨光。'}},randomUUID(),undefined,true,'editShot');expect(edit.status,JSON.stringify(edit.body)).toBe(200);expect(posts).toBe(count);
 const next=await post({...d,instruction:'放缓节奏',previousRequestId:edit.body.requestId});expect(next.body.status,JSON.stringify(next.body)).toBe('completed');expect(providerInputs.at(-1)?.previousPlan?.shots[0].visual).toContain('柔和晨光');expect(providerInputs.at(-1)?.conversation).toContainEqual({role:'user',content:'不增加人物。'});expect(providerInputs.at(-1)?.conversation).toContainEqual({role:'user',content:'节奏还能慢一些吗？'});
 expect((await post({...d,targetDuration:16,instruction:'修改',previousRequestId:talk.body.requestId})).status).toBe(409);
});

it.skipIf(!contextPath)('retains prior user voice requirements in the immutable approval validation context',async()=>{
 const text='口播：关闭\n画面：窗边。',d=data(text),talk=await post({...d,mode:'discuss',instruction:'加旁白，逐字使用原文。'});expect(talk.body.status).toBe('completed');
 const generated=await post({...d,instruction:'按前面要求安排',previousRequestId:talk.body.requestId});expect(generated.body.status,JSON.stringify(generated.body)).toBe('completed');expect(generated.body.plan.narrationEnabled).toBe(true);
 const snapshot=(await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[generated.body.requestId])).rows[0].request_snapshot;expect(snapshot.data.instruction).toContain('加旁白');expect(snapshot.data.turnInstruction).toBe('按前面要求安排');
 const saved=await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text,targetDuration:15,reason:'跨轮要求验收',requestId:generated.body.requestId});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);
});

it.skipIf(!contextPath)('executes every supported GPT variant and binds the required Sol default before deduplication',async()=>{
 const count=posts;expect((await post({...data(source+' 未启用型号'),selection:{...selection(),model:'gpt-6.1-sol'}})).status).toBe(409);expect(posts).toBe(count);
 const models=['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol','gpt-5.6','gpt-6.1-sol','gpt-6.1-terra'];expect((await f.post('connection-models','save',{connectionId:textConnection,versionId:version,revision:'default',enabledModels:models})).status).toBe(200);
 for(const model of models){const d={...data(source+' 型号验收 '+model),selection:{...selection(),model}},result=await post(d);expect(result.body.status,JSON.stringify(result.body)).toBe('completed');expect(providerEfforts.at(-1)).toBe(model==='gpt-6.1-sol'?'low':'none');if(model==='gpt-6.1-sol'){const sent=posts;expect((await post({...d,reasoningEffort:'low'})).body.requestId).toBe(result.body.requestId);expect((await post({...d,reasoningEffort:'none'})).status).toBe(400);expect(posts).toBe(sent);}}
});
it.skipIf(!contextPath)('deletes a shot through an immutable receipt, restores markers and prepares exactly the remaining shots',async()=>{
 const d=data(source+' 删除验收'),base=await post(d),sent=posts,edit={episodeId:f.episode,expectedScriptRevisionId:f.script,text:d.text,targetDuration:15,previousRequestId:base.body.requestId,index:1},id=randomUUID();
 const removed=await post(edit,id,undefined,true,'deleteShot');expect(removed.status,JSON.stringify(removed.body)).toBe(200);expect((await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[removed.body.requestId])).rows[0].request_snapshot.data.mode).toBe('revision');expect(removed.body.plan.shots).toHaveLength(2);expect(removed.body.plan.durationSeconds).toBe(15);expect(removed.body.modifiedShotIndexes).toEqual([0,1]);expect(posts).toBe(sent);expect((await post(edit,id,undefined,true,'deleteShot')).body).toEqual(removed.body);expect((await post({...edit,index:0},id,undefined,true,'deleteShot')).status).toBe(409);
 expect((await post({...edit,fields:{visual:'不接受附加字段'}},randomUUID(),undefined,true,'deleteShot')).status).toBe(400);expect((await post({...edit,index:99},randomUUID(),undefined,true,'deleteShot')).status).toBe(400);expect((await post({...edit,text:d.text+'变化'},randomUUID(),undefined,true,'deleteShot')).status).toBe(409);expect((await post(edit,randomUUID(),f.otherToken,true,'deleteShot')).status).toBe(404);expect((await post(edit,randomUUID(),undefined,false,'deleteShot')).status).toBe(403);
 expect((await f.c.query('SELECT result FROM local_identity.script_format_requests WHERE id=$1',[base.body.requestId])).rows[0].result.plan.shots).toHaveLength(3);
 const {episodeId,expectedScriptRevisionId,text,targetDuration}=edit,restored=await post({episodeId,expectedScriptRevisionId,text,targetDuration},randomUUID(),undefined,true,'conversation');expect(restored.body.result.modifiedShotIndexes).toEqual([0,1]);expect(restored.body.turns.at(-1).instruction).toContain('删除第 2');
 const one=await post({...edit,previousRequestId:removed.body.requestId,index:0},randomUUID(),undefined,true,'deleteShot');expect(one.body.plan.shots).toHaveLength(1);expect((await post({...edit,previousRequestId:one.body.requestId,index:0},randomUUID(),undefined,true,'deleteShot')).body.error).toContain('至少保留');expect(posts).toBe(sent);
 const saved=await f.request('confirmScriptStudio',{expectedScriptRevisionId:f.script,text:d.text,targetDuration:15,reason:'删除镜头验收',requestId:removed.body.requestId});expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect((await f.request('start')).status).toBe(200);
 try{const old=(await f.c.query('SELECT id,revision FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0],prepared=await f.request(old?'replanWorkspace':'prepareWorkspace',{...(old?{workspaceId:old.id,expectedRevision:Number(old.revision),reason:'删除镜头实际准备'}:{}),expectedScriptRevisionId:saved.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.clips).toHaveLength(2);const project=JSON.parse(await readFile(join(f.assetRoot,prepared.body.project.relativePath),'utf8'));expect(project.timelines[0].items.filter((item:{kind:string})=>item.kind!=='audio').reduce((end:number,item:{startFrame:number;durationInFrames:number})=>Math.max(end,item.startFrame+item.durationInFrames),0)).toBe(15*project.timelines[0].fps);const read=await fetch(f.origin+`/api/local/script-studio?episodeId=${f.episode}&scriptRevisionId=${saved.body.id}`,{headers:{Cookie:'loop_owner_session='+f.token}}).then(r=>r.json());expect(read.sourceText).toBe(d.text);expect(read.plan.shots).toHaveLength(2);}finally{await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);}
});


async function importedImage(name:string,episodeId=f.episode){
 const bytes=await readFile(workspaceTestMedia('still-striped.png')),result=await f.request('importMaterial',{episodeId,materialType:'image',sourceKind:'file',sourcePath:name,mimeType:'image/png',contentBase64:bytes.toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});
 expect(result.status,JSON.stringify(result.body)).toBe(200);return{material:result.body,ref:scriptStudioAttachmentRef(result.body),bytes};
}
function conversationScope(d:ReturnType<typeof data>){return{episodeId:d.episodeId,expectedScriptRevisionId:d.expectedScriptRevisionId,text:d.text,targetDuration:d.targetDuration};}

it.skipIf(!contextPath)('imports a real image once, sends actual image parts and persists only immutable references with idempotent replay',async()=>{
 const sent=posts,count=Number((await f.c.query('SELECT count(*) FROM public.production_material_revisions WHERE episode_id=$1',[f.episode])).rows[0].count),image=await importedImage('assistant-upload.png');
 expect(posts).toBe(sent);expect((await importedImage('assistant-upload.png')).ref).toEqual(image.ref);expect(Number((await f.c.query('SELECT count(*) FROM public.production_material_revisions WHERE episode_id=$1',[f.episode])).rows[0].count)).toBe(count+1);
 const d={...data(source+' 图片实际传输'),instruction:'参考图片优化镜头，保留原文。',attachments:[image.ref]},id=randomUUID(),result=await post(d,id);
 expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.status).toBe('completed');expect(result.body.attachments).toEqual([image.ref]);expect(providerImageParts.at(-1)).toEqual(['data:image/png;base64,'+image.bytes.toString('base64')]);expect(providerInputs.at(-1)?.attachments).toEqual([image.ref]);expect(providerInstructions.at(-1)).toContain('原文');
 const row=(await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[id])).rows[0],serialized=JSON.stringify(row.request_snapshot);expect(row.request_snapshot.attachments).toEqual([image.ref]);expect(row.request_snapshot.data.attachments).toEqual([image.ref]);expect(typeof row.request_snapshot.body.input[0].content).toBe('string');expect(serialized).not.toContain('data:image');expect(serialized).not.toContain(image.bytes.toString('base64'));expect(Buffer.byteLength(serialized)).toBeLessThan(128*1024);
 expect((await post(d,id)).body).toEqual(result.body);expect((await post(d)).body).toEqual(result.body);expect(posts).toBe(sent+1);expect((await post({...d,attachments:[{...image.ref,sha256:'0'.repeat(64)}]},id)).status).toBe(409);expect(posts).toBe(sent+1);
 expect((await f.c.query('SELECT main_script_revision_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].main_script_revision_id).toBe(f.script);
});

it.skipIf(!contextPath)('carries sent image references through later text, discussion and manual shot changes while a new conversation starts without images',async()=>{
 const a=await importedImage('assistant-chain-a.png'),b=await importedImage('assistant-chain-b.png'),d=data(source+' 图片会话链'),scope=conversationScope(d),first=await post({...d,attachments:[a.ref]});expect(first.body.status,JSON.stringify(first.body)).toBe('completed');
 const talk=await post({...d,mode:'discuss',instruction:'',attachments:[b.ref],previousRequestId:first.body.requestId});expect(talk.body.status,JSON.stringify(talk.body)).toBe('completed');expect(talk.body.attachments).toEqual([a.ref,b.ref]);expect(providerImageParts.at(-1)).toHaveLength(2);
 const talkSnapshot=(await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[talk.body.requestId])).rows[0].request_snapshot;expect(talkSnapshot.data.attachments).toEqual([b.ref]);expect(talkSnapshot.attachments).toEqual([a.ref,b.ref]);
 const sent=posts,edited=await post({...scope,previousRequestId:talk.body.requestId,index:0,fields:{visual:'保留柔光。'}},randomUUID(),undefined,true,'editShot');expect(edited.body.status).toBe('completed');expect(edited.body.attachments).toEqual([a.ref,b.ref]);expect(posts).toBe(sent);
 const removed=await post({...scope,previousRequestId:edited.body.requestId,index:1},randomUUID(),undefined,true,'deleteShot');expect(removed.body.status).toBe('completed');expect(removed.body.attachments).toEqual([a.ref,b.ref]);expect(posts).toBe(sent);
 const next=await post({...d,instruction:'保持整体节奏',previousRequestId:removed.body.requestId});expect(next.body.status,JSON.stringify(next.body)).toBe('completed');expect(providerImageParts.at(-1)).toHaveLength(2);expect(providerInputs.at(-1)?.attachments).toEqual([a.ref,b.ref]);
 const restored=await post(scope,randomUUID(),undefined,true,'conversation');expect(restored.body.attachments).toEqual([a.ref,b.ref]);expect(restored.body.turns[0].attachments).toEqual([a.ref]);expect(restored.body.turns[1].attachments).toEqual([b.ref]);expect(restored.body.turns.at(-1)).not.toHaveProperty('attachments');
 const created=await post(scope,randomUUID(),undefined,true,'newConversation');expect(created.status,JSON.stringify(created.body)).toBe(200);const conversationId=created.body.id;
 const empty=await post({...scope,conversationId},randomUUID(),undefined,true,'conversation');expect(empty.body.turns).toEqual([]);expect(empty.body).not.toHaveProperty('attachments');
 const fresh=await post({...d,conversationId});expect(fresh.body.status).toBe('completed');expect(fresh.body).not.toHaveProperty('attachments');expect(providerImageParts.at(-1)).toEqual([]);expect(providerInputs.at(-1)?.conversation).toBeUndefined();expect(providerInputs.at(-1)?.previousPlan).toBeUndefined();
 expect((await post(scope,randomUUID(),undefined,true,'conversation')).body.attachments).toEqual([a.ref,b.ref]);
});

it.skipIf(!contextPath)('rejects foreign, forged, inline and altered real-file image identities before dispatch',async()=>{
 const own=await importedImage('assistant-permission.png'),d=data(source+' 图片权限'),sent=posts;
 expect((await post({...d,attachments:[own.ref]},randomUUID(),f.otherToken)).status).toBe(404);
 for(const ref of [{...own.ref,materialRevisionId:randomUUID()},{...own.ref,sha256:'1'.repeat(64)},{...own.ref,mimeType:'image/jpeg'},{...own.ref,fileSize:own.ref.fileSize+1},{...own.ref,name:'forged.png'}])expect((await post({...d,attachments:[ref]})).status).toBe(ref.materialRevisionId===own.ref.materialRevisionId?409:404);
 expect((await post({...d,attachments:[{...own.ref,dataUrl:'data:image/png;base64,AAAA'}]})).status).toBe(400);
 const accountId=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,foreignEpisode=await f.post('episode-commands','create',{accountId,title:'附件跨生产单隔离'});expect(foreignEpisode.status).toBe(200);const foreign=await importedImage('foreign-assistant.png',foreignEpisode.body.id);expect((await post({...d,attachments:[foreign.ref]})).status).toBe(404);
 const path=join(f.assetRoot,own.material.storage_path);await writeFile(path,Buffer.concat([own.bytes,Buffer.from('tampered')]));try{const response=await post({...d,attachments:[own.ref]});expect(response.status,JSON.stringify(response.body)).toBe(409);}finally{await writeFile(path,own.bytes);}
 expect(posts).toBe(sent);
});

it.skipIf(!contextPath)('blocks unsupported image models and enforces per-message counts before provider transport',async()=>{
 const image=await importedImage('assistant-unsupported.png'),d=data(source+' 图片能力'),created=await f.post('connections','create',{name:'Text-only DeepSeek fixture',provider:'deepseek',adapter:'deepseek_responses',secret:'synthetic-deepseek-images'});expect(created.status,JSON.stringify(created.body)).toBe(200);const connection=created.body.connection;
 expect((await f.post('connections','verify',{connectionId:connection.id})).status).toBe(200);expect((await f.post('connection-models','save',{connectionId:connection.id,versionId:connection.current_version_id,revision:'default',enabledModels:['deepseek-flash','deepseek-v4-pro']})).status).toBe(200);
 const textOnly={capability:'language_model',provider:'deepseek',adapter:'deepseek_responses',connectionVersionId:connection.current_version_id,model:'deepseek-v4-pro'},sent=posts;
 const unsupported=await post({...d,selection:textOnly,attachments:[image.ref]});expect(unsupported.status,JSON.stringify(unsupported.body)).toBe(400);expect(unsupported.body.error).toContain('不支持');expect(posts).toBe(sent);
 const refs=Array.from({length:5},()=>({...image.ref,materialRevisionId:randomUUID()}));expect((await post({...d,attachments:refs})).status).toBe(400);expect(posts).toBe(sent);
 const supported=await post({...d,selection:{...textOnly,model:'deepseek-flash'},attachments:[image.ref]});expect(supported.body.status,JSON.stringify(supported.body)).toBe('completed');expect(providerImageParts.at(-1)).toHaveLength(1);expect(posts).toBe(sent+1);
 const later=await post({...d,selection:textOnly,instruction:'继续讨论',previousRequestId:supported.body.requestId});expect(later.status,JSON.stringify(later.body)).toBe(400);expect(later.body.error).toContain('不支持');expect(posts).toBe(sent+1);
});

it.skipIf(!contextPath)('keeps unknown image request identity and prevents switching conversations from bypassing uncertainty',async()=>{
 const image=await importedImage('assistant-unknown.png'),d=data(source+' 图片未知结果'),scope=conversationScope(d),created=await post(scope,randomUUID(),undefined,true,'newConversation');expect(created.status).toBe(200);const id=randomUUID(),input={...d,attachments:[image.ref]},sent=posts;let unknown;
 mode='drop';try{unknown=await post(input,id);}finally{mode='ok';}expect(unknown.body.status).toBe('unknown');expect(posts).toBe(sent+1);expect(providerImageParts.at(-1)).toHaveLength(1);
 expect((await post(input,id)).body).toEqual(unknown.body);expect((await post(input)).body).toEqual(unknown.body);expect((await post({...input,attachments:[{...image.ref,sha256:'2'.repeat(64)}]},id)).status).toBe(409);
 expect((await post({...d,instruction:'尝试另一条消息',conversationId:created.body.id})).status).toBe(409);expect((await post(scope,randomUUID(),undefined,true,'newConversation')).status).toBe(409);
 const read=await post(scope,randomUUID(),undefined,true,'conversation');expect(read.body.latest.status).toBe('unknown');expect(read.body).not.toHaveProperty('attachments');expect(read.body.turns[0].attachments).toEqual([image.ref]);expect(posts).toBe(sent+1);
});

it.skipIf(!contextPath)('requires the trusted latest parent in an existing explicit conversation and rejects cross-conversation parents',async()=>{
 const d=data(source+' 显式会话可信父链'),scope=conversationScope(d),legacy=await post(d),created=await post(scope,randomUUID(),undefined,true,'newConversation');expect(created.status).toBe(200);const conversationId=created.body.id;
 expect((await post({...d,conversationId,previousRequestId:legacy.body.requestId})).status).toBe(409);
 const first=await post({...d,conversationId,instruction:'新会话首次'});expect(first.body.status,JSON.stringify(first.body)).toBe('completed');const sent=posts;
 expect((await post({...d,conversationId,instruction:'不能漏掉父链'})).status).toBe(409);expect(posts).toBe(sent);
 const second=await post({...d,conversationId,previousRequestId:first.body.requestId,instruction:'保留单镜头'});expect(second.body.status,JSON.stringify(second.body)).toBe('completed');
 expect((await post({...d,conversationId,previousRequestId:first.body.requestId,instruction:'过期父链不能分叉'})).status).toBe(409);expect(posts).toBe(sent+1);
});

// These documents enter through the same authenticated material registration used by the UI.
it.skipIf(!contextPath)('dispatches registered common documents as bounded text or native PDF without persisting their content',async()=>{
 const docx=Buffer.from('UEsDBBQAAAAIALmAcl2sbhJangAAANwAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbF2PsQ7CMBBDf6XKitqrGBhQ24UdGPiBU3JtI5pLlBwF/p4EpA6Mlu1nubu9A6Xq5RZOvZpFwhEg6ZkcpsYH4uyMPjqULOMEAfUdJ4J92x5AexZiqaUw1NBdVorRGqquGOWMjnoFTx8NGK8fLiebTFPV6Vcry73CEBarUaxnWNn8bdZ+HK2mrV9oIXpNKVme3NJsjkPLu4KHoYPvqeEDUEsDBBQAAAAIALmAcl0FhLhFhAAAALAAAAARAAAAd29yZC9kb2N1bWVudC54bWxFzsEOgjAMBuBXIdyxaKIxy+RBuOEosMjapSuZvr0MD16+P02bP7XZjOy2gKTVO6yUTH7Ui2o0AMktGIZ04oi07yaWMOg+ygyZZYzCDlPyNIcVLm17gzB4qjubzZPHT8lYkIJ2ghMKksNG+YXU9Nf7ucqLV6zcFi2Um6IcxsNfD/x/7L5QSwECFAMUAAAACAC5gHJdrG4SWp4AAADcAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIALmAcl0FhLhFhAAAALAAAAARAAAAAAAAAAAAAACAAc8AAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAACCAQAAAAA=','base64');
 const pdfObjects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const stream='BT /F1 12 Tf 20 100 Td (reference-token-Z581 white cup) Tj ET';pdfObjects.push('<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream');
 let pdf='%PDF-1.7\n',offsets=[0];for(const [index,object]of pdfObjects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=(index+1)+' 0 obj\n'+object+'\nendobj\n';}const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 const kinds=[['txt','text/plain'],['md','text/markdown'],['csv','text/csv'],['json','application/json'],['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['pdf','application/pdf']];
 for(const [extension,mimeType]of kinds){
  const bytes=extension==='docx'?docx:extension==='pdf'?Buffer.from(pdf):Buffer.from(extension==='json'?'{"reference":"reference-token-Z581 white cup"}':'reference-token-Z581 white cup');
  const registered=await f.request('importMaterial',{episodeId:f.episode,materialType:'reference',sourceKind:'file',sourcePath:'assistant-document.'+extension,mimeType,contentBase64:bytes.toString('base64'),isMainScript:false,materialPurpose:'general_reference',scriptStudioAttachment:true});
  expect(registered.status,JSON.stringify(registered.body)).toBe(200);const ref=scriptStudioAttachmentRef(registered.body),id=randomUUID(),d={...data(source+' 文档'+extension),mode:'discuss',instruction:'参考附件讨论拍法',attachments:[ref]},result=await post(d,id);
  expect(result.body.status,JSON.stringify(result.body)).toBe('completed');expect(result.body.attachments).toEqual([ref]);
  if(extension==='pdf')expect(providerFileParts.at(-1)).toEqual(['data:application/pdf;base64,'+bytes.toString('base64')]);else expect(providerInputs.at(-1)?.documents?.[0].text).toContain('reference-token-Z581');
  const snapshot=(await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[id])).rows[0].request_snapshot,serialized=JSON.stringify(snapshot);
  expect(snapshot.attachments).toEqual([ref]);expect(serialized).not.toContain('reference-token-Z581');expect(serialized).not.toContain(bytes.toString('base64'));expect(serialized).not.toContain('file_data');
  const later=await post({...d,instruction:'继续参考附件',attachments:undefined,previousRequestId:id});expect(later.body.status).toBe('completed');if(extension==='pdf')expect(providerFileParts.at(-1)).toHaveLength(1);else expect(providerInputs.at(-1)?.documents?.[0].text).toContain('reference-token-Z581');
 }
});

it.skipIf(!contextPath)('validates assistant documents before material publication without restricting legacy reference imports',async()=>{
 const upload=(name:string,mimeType:string,bytes:Buffer,flag:unknown)=>f.request('importMaterial',{episodeId:f.episode,materialType:'reference',sourceKind:'file',sourcePath:name,mimeType,contentBase64:bytes.toString('base64'),isMainScript:false,materialPurpose:'general_reference',...(flag===undefined?{}:{scriptStudioAttachment:flag})});
 const count=Number((await f.c.query('SELECT count(*) FROM public.production_material_revisions WHERE episode_id=$1',[f.episode])).rows[0].count),sent=posts;
 for(const [name,mime,bytes,flag]of [
  ['false-marker.txt','text/plain',Buffer.from('valid text'),false],
  ['broken.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',Buffer.from('PK\x03\x04invalid'),true],
  ['forged.pdf','application/pdf',Buffer.from('plain text'),true],
  ['nonutf8.txt','text/plain',Buffer.from([0xff,0xfe,0,1]),true],
  ['too-long.txt','text/plain',Buffer.from('字'.repeat(20001)),true],
 ] as const){const result=await upload(name,mime,bytes,flag);expect(result.status,JSON.stringify(result.body)).toBe(400);}
 expect(Number((await f.c.query('SELECT count(*) FROM public.production_material_revisions WHERE episode_id=$1',[f.episode])).rows[0].count)).toBe(count);expect(posts).toBe(sent);
 const legacy=await upload('legacy-large-reference.txt','text/plain',Buffer.from('字'.repeat(20001)),undefined);expect(legacy.status,JSON.stringify(legacy.body)).toBe(200);
});

it.skipIf(!contextPath)('keeps historical discussion receipts and unknowns but uses a new contract for fresh free chat',async()=>{
 const d={...data(source+' 自由交流升级'),mode:'discuss',instruction:'解释二进制浮点误差，无需联系视频。'},id=randomUUID(),first=await post(d,id);
 expect(first.body.status).toBe('completed');
 const oldHash=canonicalFingerprint({version:'script-studio/v1',wireVersion:'script-studio-direction/v2',data:d});
 await f.c.query("UPDATE local_identity.script_format_requests SET payload_hash=$2,request_snapshot=jsonb_set(request_snapshot,'{wireVersion}','\"script-studio-direction/v2\"'),result=jsonb_set(result,'{message}','\"我只能讨论视频拍法。\"') WHERE id=$1",[id,oldHash]);
 const before=(await f.c.query('SELECT payload_hash,request_snapshot,result FROM local_identity.script_format_requests WHERE id=$1',[id])).rows[0],sent=posts;
 const restored=await post(conversationScope(d),randomUUID(),undefined,true,'conversation');expect(restored.body.turns.at(-1).answer).toBe('我只能讨论视频拍法。');
 expect((await post(d,id)).body.message).toBe('我只能讨论视频拍法。');expect(posts).toBe(sent);
 const fresh=await post(d);expect(fresh.body.status).toBe('completed');expect(posts).toBe(sent+1);expect(providerInstructions.at(-1)).toContain('不局限于视频拍法');
 const snapshot=(await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[fresh.body.requestId])).rows[0].request_snapshot;expect(snapshot.wireVersion).toBe('script-studio-free-chat/v1');expect(JSON.parse(snapshot.body.input[0].content).mode).toBe('discuss');
 expect((await f.c.query('SELECT payload_hash,request_snapshot,result FROM local_identity.script_format_requests WHERE id=$1',[id])).rows[0]).toEqual(before);
 const unknown={...d,text:d.text+'未知'},unknownId=randomUUID();mode='drop';let result;try{result=await post(unknown,unknownId);}finally{mode='ok';}expect(result.body.status).toBe('unknown');
 const unknownHash=canonicalFingerprint({version:'script-studio/v1',wireVersion:'script-studio-direction/v2',data:unknown});await f.c.query("UPDATE local_identity.script_format_requests SET payload_hash=$2,request_snapshot=jsonb_set(request_snapshot,'{wireVersion}','\"script-studio-direction/v2\"') WHERE id=$1",[unknownId,unknownHash]);
 const attempts=posts;expect((await post(unknown,unknownId)).body).toEqual(result.body);expect((await post(unknown)).body).toEqual(result.body);expect(posts).toBe(attempts);
});
