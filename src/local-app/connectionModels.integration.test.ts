import {openAiImageModels} from '../imageGeneration';
// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {connectionCatalogFixture} from './connectionCatalog.fixture';
import {csrfFor} from './sessions';
import {ownerTransaction} from './ownerTransaction';
import {resolveProductionSelection} from './productionSelection';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('owns, discovers and persists model settings through HTTP, enforces new selections and rejects stale saves',async()=>{
 const f=await connectionCatalogFixture();
 try{
  const created=await f.command('create',{name:'Model fixture',provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'});expect(created.status).toBe(200);const connection=created.body.connection;
  const call=async(command?:string,data?:unknown,token=f.token,csrf=true)=>{const r=await fetch(f.origin+'/api/local/connection-models'+(command?'':'?connectionId='+connection.id),{method:command?'POST':'GET',headers:{Origin:f.origin,Cookie:'loop_owner_session='+token,...(command?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},...(command?{body:JSON.stringify({command,data,idempotencyKey:randomUUID()})}:{})});return{status:r.status,body:await r.json()};};
  const before=f.secretReads,initial=await call();expect(initial.status).toBe(200);expect(initial.body).toMatchObject({revision:'default',enabledModels:openAiImageModels,models:openAiImageModels.map(id=>({id,adapted:true,listed:false}))});expect(f.secretReads).toBe(before);
  expect((await call(undefined,undefined,f.otherToken)).status).toBe(404);expect((await call(undefined,undefined,'')).status).toBe(401);
  const sync=await call('sync',{connectionId:connection.id,versionId:connection.current_version_id});expect(sync.status,JSON.stringify(sync.body)).toBe(200);expect(sync.body.models).toEqual([...openAiImageModels.map(id=>({id,capability:'图片',adapted:true,listed:id==='gpt-image-2'})),{id:'unadapted-example',capability:'未分类',adapted:false,listed:true}]);expect(f.secretReads).toBe(before+1);
  const data={connectionId:connection.id,versionId:connection.current_version_id,revision:'default',enabledModels:[]};
  expect((await call('save',data,f.token,false)).status).toBe(403);expect((await call('save',data,f.otherToken)).status).not.toBe(200);
  expect((await call('save',{...data,enabledModels:['unadapted-example']})).status).toBe(400);
  const saved=await call('save',data);expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body.enabledModels).toEqual([]);expect(saved.body.revision).not.toBe('default');
  expect((await call('save',data)).body).toEqual(saved.body); // Lost-response retry.
  expect((await call('save',{...data,enabledModels:['gpt-image-2']})).status).toBe(409);
  expect((await call()).body.enabledModels).toEqual([]);
  const catalog=(await f.request()).body.serviceCatalog.groups.flatMap((g:any)=>g.services);expect(catalog.find((s:any)=>s.connectionId===connection.id).models).toEqual([]);
  expect((await f.command('verify',{connectionId:connection.id})).status).toBe(200);
  const selection={capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:connection.current_version_id};
  await expect(ownerTransaction(f.pool,f.owner,false,c=>resolveProductionSelection(c,selection,'image'))).rejects.toThrow('已停用');
  const enabled=await call('save',{...data,revision:saved.body.revision,enabledModels:['gpt-image-2']});expect(enabled.status).toBe(200);
  expect((await ownerTransaction(f.pool,f.owner,false,c=>resolveProductionSelection(c,selection,'image'))).selection).toEqual(selection);
  const rotated=await f.command('rotate',{connectionId:connection.id,provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'});expect(rotated.status).toBe(200);
  expect((await call('save',{...data,revision:enabled.body.revision})).status).toBe(409);expect((await call('sync',{connectionId:connection.id,versionId:connection.current_version_id})).status).toBe(409);
  expect((await call()).body.enabledModels).toEqual(['gpt-image-2']);
  expect((await f.admin.query('SELECT count(*)::int n FROM public.external_connection_versions WHERE connection_id=$1',[connection.id])).rows[0].n).toBe(2);
  expect((await f.admin.query('SELECT count(*)::int n FROM public.tasks')).rows[0].n).toBe(0);expect(JSON.stringify(sync.body)).not.toContain('synthetic-openai-key');expect(f.secrets.size).toBe(2);
  expect((await ownerTransaction(f.pool,f.other,true,c=>c.query('SELECT * FROM local_identity.connection_model_settings'))).rows).toEqual([]);
 }finally{await f.close();}
},60000);

it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('rejects in-flight discovery when the current version rotates and keeps settings unchanged on errors',async()=>{
 let finish!:(value:{id:string;capability:string}[])=>void,started!:()=>void;const gate=new Promise<void>(r=>started=r);
 const f=await connectionCatalogFixture({modelsReader:async()=>{started();return new Promise(r=>finish=r);}});
 try{
  const connection=(await f.command('create',{name:'Rotating model fixture',provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'})).body.connection;
  const pending=fetch(f.origin+'/api/local/connection-models',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'sync',idempotencyKey:randomUUID(),data:{connectionId:connection.id,versionId:connection.current_version_id}})});
  await gate;expect((await f.command('rotate',{connectionId:connection.id,provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'})).status).toBe(200);finish([{id:'unadapted',capability:'未分类'}]);
  const r=await pending;expect(r.status).toBe(409);expect((await r.json()).error).toContain('版本已变化');expect((await f.admin.query('SELECT count(*)::int n FROM local_identity.connection_model_settings')).rows[0].n).toBe(0);
 }finally{await f.close();}
},60000);
