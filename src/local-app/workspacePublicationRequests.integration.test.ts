// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {LocalConnections} from './connections';
import {csrfFor} from './sessions';
import {createProviderProbe} from './providerProbe';
import {createPublicationReader} from './workspacePublicationProvider';
import type {SecretStore} from './connectionPorts';
import type {MediaFetcher} from '../worker/mediaProviders';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('executes a dedicated publication request once, preserves revisions, undo, failures and late results across completed access and restarts',async()=>{
 const secrets=new Map<string,string>(),store:SecretStore={mode:'keychain',async putImmutable(ref,value){secrets.set(ref,value);},async get(ref){return secrets.get(ref)!;}};
 let mode:'ok'|'hold'|'drop'|'invalid'='ok',posts=0,release:(()=>void)|undefined,wire:any;
 const transport:MediaFetcher=async(_url,init)=>{
  if(init?.method!=='POST')return new Response(JSON.stringify({data:[{id:'gpt-5.6-luna'}]}));
  posts++;wire=JSON.parse(String(init.body));if(mode==='drop')throw Error('network');if(mode==='hold')await new Promise<void>(r=>{release=r;});
  return new Response(JSON.stringify({id:'resp_'+randomUUID(),status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(mode==='invalid'?{title:'incomplete'}:{title:'实际保留商品',description:'仅依据当前镜头。',tags:['#测试']})}]}]}));
 };
 const probe=createProviderProbe({directory:'/not-used',policySha256:''},transport,undefined,{manualVerification:true});
 const f=await productionWorkspaceFixture({connections:pool=>new LocalConnections(pool,store,probe,undefined,undefined,undefined,undefined,undefined,undefined,createPublicationReader(transport))});
 try{
  let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
  w=await f.fillVisuals(w);
  const created=await f.post('connections','create',{name:'文案测试模型',provider:'openai',adapter:'openai_responses',secret:'synthetic'});expect(created.status,JSON.stringify(created.body)).toBe(200);
  expect((await f.post('connections','verify',{connectionId:created.body.connection.id})).status).toBe(200);
  const selection={capability:'language_model',provider:'openai',adapter:'openai_responses',connectionVersionId:created.body.connection.current_version_id,model:'gpt-5.6-luna'},path=`episodes/${f.episode}/publication`,ai=path+'-ai';
  const content={title:'手改标题',description:'我的简介',tags:['手改'],instruction:'简短'};
  const saved=await f.post(path,'save',{expectedRevision:0,content});expect(saved.status).toBe(200);
  await f.c.query("UPDATE public.episodes SET stage='production_completed' WHERE id=$1",[f.episode]);
  const send=async(input:unknown,key:string)=>{const r=await fetch(f.origin+'/api/local/'+ai,{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token),'Content-Type':'application/json'},body:JSON.stringify({command:'generate',data:input,idempotencyKey:key})});return{status:r.status,body:await r.json()};};
  const input={expectedRevision:1,selection},key=randomUUID(),count=posts,first=await send(input,key);expect(first.status,JSON.stringify(first.body)).toBe(200);expect(first.body.status,JSON.stringify(first.body)).toBe('completed');expect(first.body.publication.content.title).toBe('实际保留商品');expect(posts).toBe(count+1);
  expect(wire.text.format.name).toBe('workspace_publication_v1');expect(JSON.parse(wire.input[0].content).context.accountRules).not.toHaveProperty('asset_root');expect(JSON.parse(wire.input[0].content)).toMatchObject({current:{title:'手改标题'},instruction:'简短'});
  expect((await send(input,key)).body).toEqual(first.body);expect(posts).toBe(count+1);
  const undone=await f.post(ai,'undo',{expectedRevision:2});expect(undone.status,JSON.stringify(undone.body)).toBe(200);expect(undone.body.content).toEqual(content);
  mode='hold';const pending=f.post(ai,'generate',{expectedRevision:3,selection});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  const before=posts,duplicate=await f.post(ai,'generate',{expectedRevision:3,selection});expect(duplicate.body.status).toBe('dispatching');expect(posts).toBe(before);
  expect((await f.post(path,'save',{expectedRevision:3,content:{...content,title:'生成期间的新修改'}})).status).toBe(200);
  release!();const late=await pending;expect(late.body.status).toBe('stale');
  mode='invalid';const invalid=await f.post(ai,'generate',{expectedRevision:4,selection});expect(invalid.body.status).toBe('failed');
  mode='drop';const unknown=await f.post(ai,'generate',{expectedRevision:4,selection});expect(unknown.body.status).toBe('unknown');const sent=posts;mode='ok';await f.restart();expect((await f.post(ai,'generate',{expectedRevision:4,selection})).body.status).toBe('unknown');expect(posts).toBe(sent);
  const latest=await fetch(f.origin+'/api/local/'+path,{headers:{Cookie:'loop_owner_session='+f.token}});expect((await latest.json()).content.title).toBe('生成期间的新修改');
  const identity=(await f.c.query('SELECT revision,content_sha256 FROM local_identity.production_workspaces WHERE id=$1',[w.id])).rows[0];expect(Number(identity.revision)).toBe(w.revision);expect(identity.content_sha256).toBe(w.contentSha256);
  expect((await f.c.query('SELECT stage FROM public.episodes WHERE id=$1',[f.episode])).rows[0].stage).toBe('production_completed');
 }finally{release?.();await f.close();}
},90000);
