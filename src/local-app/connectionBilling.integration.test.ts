// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {connectionCatalogFixture} from './connectionCatalog.fixture';
import {createBillingReader} from './providerBilling';
import {csrfFor} from './sessions';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('billing Owner HTTP + real PG preserves generation refs, masks secrets, caches, rotates, disconnects and fences old revisions',async()=>{
 let calls=0;
 const reader=createBillingReader(async(url,init)=>{
  calls++;expect(String(url)).toBe('https://business.aliyuncs.com/');const p=new URLSearchParams(String(init?.body));expect(p.get('AccessKeyId')).toBe('synthetic-ak-01');expect(p.has('Signature')).toBe(true);
  return Response.json({Success:true,Data:p.get('Action')==='QueryAccountBalance'?{AvailableAmount:'12.34',Currency:'CNY'}:{TotalCount:1,Items:{Item:[{Currency:'CNY',PretaxAmount:'0.01',PaymentAmount:'0.02'}]}}});
 },()=>new Date('2026-11-01T12:00:00Z'),0);
 const f=await connectionCatalogFixture({billingReader:reader});
 try{
  const created=await f.command('create',{name:'Billing fixture',provider:'bailian',adapter:'wan_video',secret:'synthetic-generation-key'});expect(created.status).toBe(200);const connection=created.body.connection,id=connection.id;
  const read=async(token=f.token)=>{const r=await fetch(f.origin+'/api/local/connection-billing?connectionId='+id,{headers:{Cookie:'loop_owner_session='+token}});return{status:r.status,body:await r.json()};};
  const command=async(action:string,data:Record<string,unknown>,key=randomUUID(),token=f.token,csrf=true)=>{const r=await fetch(f.origin+'/api/local/connection-billing',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify({command:action,data,idempotencyKey:key})});return{status:r.status,body:await r.json()};};
  expect((await read()).body).toMatchObject({configured:false,revision:'default'});expect((await read(f.otherToken)).status).toBe(404);expect((await read('')).status).toBe(401);
  const credential=JSON.stringify({accessKeyId:'synthetic-ak-01',accessKeySecret:'synthetic-secret-0123456789'}),data={connectionId:id,revision:'default',credential},operation=randomUUID();
  expect((await command('save',data,randomUUID(),f.token,false)).status).toBe(403);expect((await command('save',data,randomUUID(),f.otherToken)).status).toBe(404);expect(calls).toBe(0);
  const saved=await command('save',data,operation);expect(saved.status).toBe(200);expect(saved.body).toMatchObject({configured:true,usage:{remaining:{text:'¥12.34'},recent:{text:'¥0.07'}}});expect(JSON.stringify(saved.body)).not.toContain('synthetic-secret');expect(JSON.stringify(saved.body)).not.toContain('secret_ref');
  expect(calls).toBe(8);const secrets=[...f.secrets.values()];expect(secrets).toContain('synthetic-generation-key');expect(secrets).toContain(credential);
  expect((await command('save',data,operation)).body.revision).toBe(saved.body.revision);expect(calls).toBe(8);
  const usage=await fetch(f.origin+'/api/local/connection-usage?connectionId='+id,{headers:{Cookie:'loop_owner_session='+f.token}});expect(usage.status).toBe(200);expect((await usage.json()).usage.remaining.text).toBe('¥12.34');expect(calls).toBe(8);
  const revision=saved.body.revision;const refreshed=await command('refresh',{connectionId:id,revision});expect(refreshed.status).toBe(200);expect(calls).toBe(16);
  const rotated=await command('save',{connectionId:id,revision,credential:JSON.stringify({accessKeyId:'synthetic-ak-01',accessKeySecret:'synthetic-secret-new-value'})});expect(rotated.status).toBe(200);expect(rotated.body.revision).not.toBe(revision);
  expect((await command('disconnect',{connectionId:id,revision})).status).toBe(409);
  expect((await command('disconnect',{connectionId:id,revision:rotated.body.revision})).body.configured).toBe(false);
  const records=(await f.admin.query('SELECT status,secret_ref FROM local_identity.connection_billing_credentials ORDER BY created_at')).rows;expect(records.map(r=>r.status)).toEqual(['retired','retired']);
  expect((await f.admin.query('SELECT current_version_id FROM public.external_connections WHERE id=$1',[id])).rows[0].current_version_id).toBe(connection.current_version_id);
  expect((await f.request()).body.connections[0].status).toBe('unverified');expect((await f.admin.query('SELECT count(*)::int n FROM public.external_connection_versions WHERE connection_id=$1',[id])).rows[0].n).toBe(1);
  // The existing trusted inventory also accounts for billing Keychain references.
  const inventory=await f.pool.connect();try{await inventory.query('BEGIN');await inventory.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);const v=(await inventory.query('SELECT local_identity.secret_reference_inventory($1) inventory',[await import('./sessions').then(m=>m.tokenHash(f.token))])).rows[0].inventory;expect(v.connections.filter((r:{name:string})=>r.name.endsWith(' · 账务'))).toHaveLength(2);await inventory.query('ROLLBACK');}finally{inventory.release();}
 }finally{await f.close();}
},120000);

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('does not store invalid billing credentials or replace a current binding when Keychain fails',async()=>{
 const {vi}=await import('vitest');let allowed=false;
 const fail={label:'组织7天',text:'读取失败',detail:'账务权限不足',status:'unavailable' as const},good={label:'组织7天',text:'US$0.15',detail:'组织账务',status:'ready' as const};
 const f=await connectionCatalogFixture({billingReader:async()=>({remaining:{label:'余额',text:'控制台查看',detail:'不支持',status:'unsupported'},recent:allowed?good:fail,updatedAt:new Date().toISOString()})});
 try{
  const c=await f.command('create',{name:'OpenAI billing fixture',provider:'openai',adapter:'openai_images',secret:'synthetic-openai-key'});expect(c.status).toBe(200);const id=c.body.connection.id;
  const send=async(revision:string,credential:string,key=randomUUID())=>{const r=await fetch(f.origin+'/api/local/connection-billing',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'save',idempotencyKey:key,data:{connectionId:id,revision,credential}})});return{status:r.status,body:await r.json()};};
  const credential=JSON.stringify({apiKey:'synthetic-admin-key'});expect((await send('default',credential)).status).toBe(502);expect(f.secrets.size).toBe(1);expect((await f.admin.query('SELECT count(*)::int n FROM local_identity.connection_billing_credentials')).rows[0].n).toBe(0);
  allowed=true;const first=await send('default',credential);expect(first.status).toBe(200);
  const key=randomUUID(),next=JSON.stringify({apiKey:'synthetic-admin-key-rotated'}),put=vi.spyOn(f.secrets,'set').mockImplementation(()=>{throw Error('Synthetic keychain locked');});
  const rejected=await send(first.body.revision,next,key);expect(rejected.status).toBe(503);expect(JSON.stringify(rejected.body)).not.toContain('synthetic-admin-key');put.mockRestore();
  expect((await f.admin.query("SELECT id FROM local_identity.connection_billing_credentials WHERE status='current'")).rows[0].id).toBe(first.body.revision);
  const restored=await send(first.body.revision,next,key);expect(restored.status).toBe(200);expect(restored.body.revision).not.toBe(first.body.revision);
  await expect(f.admin.query("UPDATE local_identity.connection_billing_credentials SET request_hash=repeat('0',64) WHERE id=$1",[restored.body.revision])).rejects.toMatchObject({code:'23514'});
 }finally{await f.close();}
},120000);
