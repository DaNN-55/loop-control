// @vitest-environment node
import {it,expect} from 'vitest';
import {connectionCatalogFixture} from './connectionCatalog.fixture';
it.skipIf(!process.env.LOOP_TEST_CONTEXT_MODULE)('exposes registered service groups and updates exact verified connection choices through Owner HTTP',async()=>{
 const f=await connectionCatalogFixture();
 try{
  expect((await f.request(undefined,'')).status).toBe(401);
  const empty=await f.request();expect(empty.status).toBe(200);
  expect(empty.body.serviceCatalog.groups.map((g:{capability:string})=>g.capability)).toEqual(['image','video','speech','music_sound']);
  const image=()=>f.request().then(r=>r.body.serviceCatalog.groups.find((g:{capability:string})=>g.capability==='image').services);
  expect((await image())[0]).toMatchObject({provider:'openai',adapter:'openai_images',models:['gpt-image-2'],inputModes:['text','reference_images'],executable:false,unavailableReason:'尚未添加连接。'});
  const created=await f.command('create',{name:'Studio images',provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'});expect(created.status).toBe(200);
  const connection=created.body.connection;const before=await f.request();
  expect((await image())[0]).toMatchObject({connectionId:connection.id,connectionName:'Studio images',connectionVersionId:connection.current_version_id,executable:false});
  expect((await f.command('verify',{connectionId:connection.id})).body.ready).toBe(true);
  expect((await image())[0]).toMatchObject({executable:true,status:'verified',constraints:{referenceImages:{max:16,mimeTypes:['image/png','image/jpeg','image/webp']}}});
  expect((await f.command('update',{connectionId:connection.id,name:'Renamed images',description:'Controlled service'})).status).toBe(200);
  const renamed=await f.request();expect((await image())[0]).toMatchObject({connectionName:'Renamed images',connectionVersionId:connection.current_version_id});expect(renamed.body.versions).toHaveLength(before.body.versions.length);expect(f.secrets.size).toBe(1);
  const second=await f.command('create',{name:'Another image credential',provider:'openai',adapter:'openai_images',secret:'synthetic-invalid-key'});expect(second.status).toBe(200);
  expect((await f.command('verify',{connectionId:second.body.connection.id})).body.ready).toBe(false);
  expect((await image()).map((service:{connectionName:string;status:string;executable:boolean})=>({name:service.connectionName,status:service.status,executable:service.executable}))).toEqual([{name:'Renamed images',status:'verified',executable:true},{name:'Another image credential',status:'invalid',executable:false}]);
  const rotated=await f.command('rotate',{connectionId:connection.id,provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'});expect(rotated.status).toBe(200);expect(rotated.body.connection.current_version_id).not.toBe(connection.current_version_id);
  expect((await image())[0]).toMatchObject({connectionVersionId:rotated.body.connection.current_version_id,executable:false});
  expect((await f.request()).body.versions.find((v:{id:string})=>v.id===connection.current_version_id)).toMatchObject({status:'verified',is_current:false});
  expect((await f.command('verify',{connectionId:connection.id})).body.ready).toBe(true);
  const secretCount=f.secrets.size;
  expect((await f.command('create',{name:'Wrong authentication',provider:'openai',adapter:'volcengine_tts',secret:'synthetic-openai-key'})).status).toBe(400);expect(f.secrets.size).toBe(secretCount);
  expect((await f.command('verify',{connectionId:connection.id},f.otherToken)).status).toBe(404);
  expect((await f.command('update',{connectionId:connection.id,name:'CSRF rejected',description:''},f.token,false)).status).toBe(403);
  expect((await f.request(undefined,f.otherToken)).body.connections).toEqual([]);expect(JSON.stringify((await f.request(undefined,f.otherToken)).body.serviceCatalog)).not.toContain(connection.id);
  const reads=f.secretReads;f.setNetworkAvailable(false);expect((await image())[0]).toMatchObject({executable:false,unavailableReason:'当前执行网络不可用。'});expect(f.secretReads).toBe(reads);
  const video=renamed.body.serviceCatalog.groups.find((g:{capability:string})=>g.capability==='video').services;
  expect(video.filter((s:{adapter:string})=>s.adapter==='wan_video')).toHaveLength(1);expect(video.find((s:{provider:string})=>s.provider==='pexels')).toMatchObject({mode:'search',models:[],inputModes:['query'],constraints:{query:{maxLength:100}}});
  expect(JSON.stringify(renamed.body)).not.toContain('synthetic-openai-key');
 }finally{await f.close();}
},60000);
