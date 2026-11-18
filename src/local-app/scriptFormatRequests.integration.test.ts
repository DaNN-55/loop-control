// @vitest-environment node
import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {LocalConnections} from './connections';
import {createProviderProbe} from './providerProbe';
import {createScriptFormatReader} from './scriptFormatProvider';
import type {SecretStore} from './connectionPorts';
import type {MediaFetcher} from '../worker/mediaProviders';
import {csrfFor} from './sessions';
const contextPath=process.env.LOOP_SCRIPT_FORMAT_TEST_CONTEXT;
let f:Awaited<ReturnType<typeof productionWorkspaceFixture>>,provider:ReturnType<typeof createServer>,providerOrigin='';
let mode:'ok'|'drop'|'hold'|'rewrite'='ok',release:(()=>void)|undefined,posts=0;
const secrets=new Map<string,string>(),seen:Array<{url:string;body?:Record<string,unknown>}>=[];
const source='# 雨后\n\n## 旁白脚本\n\n雨停了，慢一点回家。';
const body=(text=source)=>({title:'雨后',settings:[],shots:[{narration:text.split('## 旁白脚本')[1].trim().replace(/\n+/g,' '),subtitle:null,visual:'',videoPrompt:'',visualSource:'unassigned',settings:[]}],warnings:[],canRecognize:true});
const versions:Record<string,string>={};
async function post(command:string,data:Record<string,unknown>,id=randomUUID(),token?:string){
 const session=token??f.token,r=await fetch(f.origin+'/api/local/script-recognition',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+session,'Content-Type':'application/json','X-CSRF-Token':csrfFor(session)},body:JSON.stringify({command,data,idempotencyKey:id})});return{status:r.status,body:await r.json()};
}
const data=(provider='openai',text=source)=>({episodeId:f.episode,expectedScriptRevisionId:f.script,text,selection:{capability:'language_model',provider,adapter:provider==='openai'?'openai_responses':'deepseek_responses',connectionVersionId:versions[provider],model:provider==='openai'?'gpt-5.6-luna':'deepseek-flash'}});
const protectedRows=async()=>{
 const result:Record<string,unknown>={};for(const table of ['public.episodes','public.production_material_revisions','public.tasks','public.task_runs'])result[table]=(await f.c.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text) digest FROM ${table} t`)).rows[0];return result;
};
beforeAll(async()=>{
 if(!contextPath)return;
 const {runtimeContext}=await import(contextPath),c=runtimeContext();if(c.dailyRuntime!==false||!(c.isolatedFixtureContainer||c.isolatedFixtureNative&&c.nativeConnection))throw Error('Only explicitly isolated fixtures');c.assertDatabase();
 provider=createServer(async(req,res)=>{
  let bytes='';for await(const chunk of req)bytes+=chunk;
  if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/models'?{data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]}:{data:[{id:'gpt-5.6-luna'}]}));return;}
  posts++;const input=JSON.parse(bytes),text=JSON.parse(input.input[0].content).source as string;
  if(mode==='drop'){req.socket.destroy();return;}
  if(mode==='hold')await new Promise<void>(resolve=>{release=resolve;});
  const suggestion=body(text);if(mode==='rewrite')suggestion.shots[0].narration=suggestion.shots[0].narration.replace('慢一点','快一点');
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:req.url==='/responses'?randomUUID():'resp_'+randomUUID(),status:'completed',model:input.model,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(suggestion)}]}],usage:{input_tokens:123,output_tokens:45}}));
 });provider.listen(0,'127.0.0.1');await once(provider,'listening');providerOrigin=`http://127.0.0.1:${(provider.address() as {port:number}).port}`;
 const transport:MediaFetcher=async(url,init)=>{seen.push({url:String(url),...(init?.body?{body:JSON.parse(String(init.body))}:{})});return fetch(providerOrigin+new URL(String(url)).pathname,init);};
 const store:SecretStore={mode:'keychain',async putImmutable(ref,value){if(secrets.has(ref)&&secrets.get(ref)!==value)throw Error('immutable');secrets.set(ref,value);},async get(ref){if(!secrets.has(ref))throw Error('missing');return secrets.get(ref)!;}};
 const probe=createProviderProbe({directory:'/not-used',policySha256:''},transport,undefined,{manualVerification:true});
 f=await productionWorkspaceFixture({testContextModule:contextPath,runtime:{mountPath:'/'},connections:pool=>new LocalConnections(pool,store,probe,undefined,undefined,undefined,createScriptFormatReader(transport))});
 for(const name of ['openai','deepseek']){
  const created=await f.post('connections','create',{name:name+' text fixture',provider:name,adapter:name==='openai'?'openai_responses':'deepseek_responses',secret:'synthetic-'+name});expect(created.status,JSON.stringify(created.body)).toBe(200);versions[name]=created.body.connection.current_version_id;
  const verified=await f.post('connections','verify',{connectionId:created.body.connection.id});expect(verified.status,JSON.stringify(verified.body)).toBe(200);expect(verified.body.ready).toBe(true);
 }
},90000);
afterAll(async()=>{await f?.close();if(provider?.listening){provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));}},90000);

it.skipIf(!contextPath).each(['openai','deepseek'])('uses a verified %s text connection and replays completed recognition without modifying saved production or sending again',async name=>{
 mode='ok';const before=await protectedRows(),count=posts,id=randomUUID(),d=data(name,source+'\n'+name);
 const response=await post('recognize',d,id);expect(response.status,JSON.stringify(response.body)).toBe(200);expect(response.body).toMatchObject({status:'completed',recognition:body(d.text),usage:{inputTokens:123,outputTokens:45}});
 expect(await post('recognize',d,id)).toEqual(response);expect(await post('recognize',d)).toEqual(response);expect(posts).toBe(count+1);expect(await protectedRows()).toEqual(before);
 const snapshot=(await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[id])).rows[0].request_snapshot;
 expect(snapshot).toMatchObject({version:'script-recognition/v1',selection:d.selection,url:name==='openai'?'https://api.openai.com/v1/responses':'https://api.deepseek.com/responses',body:{model:d.selection.model}});
 expect(snapshot.body).toEqual(seen.filter(request=>request.body).at(-1)!.body);expect(JSON.stringify(snapshot)).not.toContain('synthetic-');expect(snapshot).not.toHaveProperty('headers');
 const catalog=await fetch(f.origin+'/api/local/connections',{headers:{Cookie:'loop_owner_session='+f.token}}).then(r=>r.json());
 expect(catalog.versions.find((v:{id:string})=>v.id===versions[name]).usage).toMatchObject({requests:1,episodes:1});
});
it.skipIf(!contextPath)('does not send for valid scripts, wrong Owner, CSRF failures, changed baselines, or image/text adapter mismatches',async()=>{
 const count=posts;
 expect((await post('recognize',data('openai',source.replace('旁白脚本','正文')))).status).toBe(409);
 expect((await post('recognize',data(),randomUUID(),f.otherToken)).status).toBe(404);
 expect((await post('recognize',{...data(),expectedScriptRevisionId:randomUUID()})).status).toBe(409);
 expect((await post('recognize',{...data(),selection:{...data().selection,adapter:'openai_images'}})).status).toBe(400);
 const r=await fetch(f.origin+'/api/local/script-recognition',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json'},body:JSON.stringify({command:'recognize',data:data(),idempotencyKey:randomUUID()})});expect(r.status).toBe(403);expect(posts).toBe(count);
});
it.skipIf(!contextPath)('coalesces concurrent submissions and records unknown delivery without resending after different client ids or reopening',async()=>{
 mode='hold';const count=posts,d=data('deepseek',source+'\n并发场景'),first=post('recognize',d);
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 expect((await post('recognize',d)).body.status).toBe('pending');expect(posts).toBe(count+1);release!();release=undefined;expect((await first).body.status).toBe('completed');
 mode='drop';const unknown=data('openai',source+'\n未知场景');const attempt=await post('recognize',unknown);expect(attempt.body.status).toBe('unknown');const sent=posts;
 expect((await post('recognize',unknown)).body).toEqual(attempt.body);expect(posts).toBe(sent);mode='ok';
});
it.skipIf(!contextPath)('rejects rewritten content and preserves a completed receipt when the baseline changes before the response returns',async()=>{
 mode='rewrite';const before=await protectedRows();expect((await post('recognize',data('openai',source+'\n无损校验'))).body.status).toBe('failed');expect(await protectedRows()).toEqual(before);
 mode='hold';const id=randomUUID(),d=data('deepseek',source+'\n基准变化'),pending=post('recognize',d,id);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 await f.c.query('UPDATE public.episodes SET main_script_revision_id=NULL WHERE id=$1',[f.episode]);release!();release=undefined;
 expect((await pending).status).toBe(409);expect((await f.c.query('SELECT status FROM local_identity.script_format_requests WHERE id=$1',[id])).rows[0].status).toBe('completed');
 await f.c.query('UPDATE public.episodes SET main_script_revision_id=$2 WHERE id=$1',[f.episode,f.script]);mode='ok';
});
it.skipIf(!contextPath)('requires explicit model enablement before using DeepSeek Pro',async()=>{
 const count=posts,d={...data('deepseek',source+'\n启用模型'),selection:{...data('deepseek').selection,model:'deepseek-v4-pro'}};
 expect((await post('recognize',d)).status).toBe(409);expect(posts).toBe(count);
 const connection=(await f.c.query('SELECT connection_id FROM public.external_connection_versions WHERE id=$1',[versions.deepseek])).rows[0].connection_id;
 const enabled=await f.post('connection-models','save',{connectionId:connection,versionId:versions.deepseek,revision:'default',enabledModels:['deepseek-flash','deepseek-v4-pro']});expect(enabled.status,JSON.stringify(enabled.body)).toBe(200);
 expect((await post('recognize',d)).body.status).toBe('completed');expect(posts).toBe(count+1);
});
it.skipIf(!contextPath)('never resends after a real receipt-write failure and keeps archived episodes read-only',async()=>{
 const d=data('openai',source+'\n回执写入失败'),count=posts;
 await f.c.query("CREATE FUNCTION local_identity.script_format_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.status='completed' THEN RAISE EXCEPTION 'Controlled receipt fault';END IF;RETURN NEW;END $$;CREATE TRIGGER script_format_receipt_fault BEFORE UPDATE ON local_identity.script_format_requests FOR EACH ROW EXECUTE FUNCTION local_identity.script_format_receipt_fault()");
 try{expect((await post('recognize',d)).status).toBe(503);}finally{await f.c.query('DROP TRIGGER script_format_receipt_fault ON local_identity.script_format_requests;DROP FUNCTION local_identity.script_format_receipt_fault()');}
 expect(posts).toBe(count+1);expect((await post('recognize',d)).body.status).toBe('pending');expect(posts).toBe(count+1);
 await f.c.query('UPDATE public.episodes SET archived_at=clock_timestamp() WHERE id=$1',[f.episode]);
 try{expect((await post('recognize',data('deepseek',source+'\n归档只读'))).status).toBe(409);}finally{await f.c.query('UPDATE public.episodes SET archived_at=NULL WHERE id=$1',[f.episode]);}
 expect(posts).toBe(count+1);
});
it.skipIf(!contextPath)('confirms a receipted single shot into real production while retaining its original source',async()=>{
 mode='ok';const d=data('openai',source+'\n\n第二段仍在同一个镜头中。'),result=await post('recognize',d);expect(result.body.status).toBe('completed');
 const payload={episodeId:f.episode,expectedScriptRevisionId:f.script,text:d.text,reason:'确认识别后的单镜头',recognitionRequestId:result.body.requestId};
 const count=posts;
 expect((await f.request('confirmRecognizedScript',{...payload,text:d.text+'篡改'})).status).toBe(409);
 expect((await f.request('confirmRecognizedScript',{...payload,recognitionRequestId:randomUUID()})).status).toBe(409);
 expect((await f.request('confirmRecognizedScript',{...payload,recognition:{shots:[]}})).status).toBe(400);
 expect((await f.request('confirmRecognizedScript',payload,{token:f.otherToken})).status).toBe(404);
 const saved=await f.request('confirmRecognizedScript',payload);expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 const original=(await f.c.query('SELECT r.source_text,x.script_revision_id FROM local_identity.script_recognition_confirmations x JOIN local_identity.script_format_requests r ON r.owner_id=x.owner_id AND r.id=x.request_id WHERE x.request_id=$1',[result.body.requestId])).rows[0];expect(original).toMatchObject({source_text:d.text,script_revision_id:saved.body.id});
 const started=await f.request('start');expect(started.status,JSON.stringify(started.body)).toBe(200);
 const prepared=await f.request('prepareWorkspace',{expectedScriptRevisionId:saved.body.id});expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);expect(prepared.body.clips).toHaveLength(1);expect(prepared.body.captions[0].contract.text).toBe(body(d.text).shots[0].narration);expect(prepared.body.clips[0].text).toContain('第二段仍在同一个镜头中');expect(posts).toBe(count);
 // Restore the fixture's editing basis for the optional browser scenario.
 await f.c.query("UPDATE public.episodes SET main_script_revision_id=$2,stage='storyboard_approved' WHERE id=$1",[f.episode,f.script]);
});
it.skipIf(!contextPath||!process.env.LOOP_SCRIPT_FORMAT_UI_FIXTURE)('holds an isolated text-model UI fixture',async()=>{
 const {createServer:createVite}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
 const {writeFile,access}=await import('node:fs/promises');
 const vite=await createVite({configFile:false,root:process.cwd(),envFile:false,cacheDir:'.scratch/script-format-fallback-20261117/vite-cache',plugins:[react()],server:{host:'127.0.0.1',port:0,proxy:Object.fromEntries(['/api/local','/_local-artifact'].map(path=>[path,{target:f.origin,changeOrigin:true,headers:{Origin:f.origin}}]))}});
 try{
  const before=await protectedRows();
  await vite.listen();const origin=`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}`,output=process.env.LOOP_SCRIPT_FORMAT_UI_FIXTURE!;
  await writeFile(output,JSON.stringify({origin,email:f.email,password:f.password,episodeId:f.episode,stopFile:output+'.stop'}),{mode:0o600});
  const deadline=Date.now()+300000;while(Date.now()<deadline){try{await access(output+'.stop');break;}catch{await new Promise(r=>setTimeout(r,250));}}
  const unchanged=JSON.stringify(await protectedRows())===JSON.stringify(before);
  if(process.env.LOOP_SCRIPT_RECOGNITION_UI_CONFIRM){const current=(await f.c.query('SELECT main_script_revision_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].main_script_revision_id;expect(current).not.toBe(f.script);const workspace=(await f.c.query('SELECT bindings,script_revision_id FROM local_identity.production_workspaces WHERE episode_id=$1',[f.episode])).rows[0];expect(workspace.script_revision_id).toBe(current);expect(workspace.bindings).toHaveLength(1);}else expect(unchanged).toBe(true);
  const requests=(await f.c.query("SELECT model,status,result->'usage' usage FROM local_identity.script_format_requests ORDER BY created_at")).rows;
  await writeFile(output+'.result.json',JSON.stringify({protectedRowsUnchanged:unchanged,confirmedSingleShot:!!process.env.LOOP_SCRIPT_RECOGNITION_UI_CONFIRM,requests}),{mode:0o600});
 }finally{await vite.close();}
},330000);
