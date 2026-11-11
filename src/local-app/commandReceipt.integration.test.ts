// @vitest-environment node
import{it,expect}from'vitest';
import{randomUUID,createHash}from'node:crypto';
import{nativeWorkspaceFixture}from'./nativeWorkspace.fixture';
import{csrfFor}from'./sessions';
import{canonical}from'./configurationCommands';
const enabled=process.env.LOOP_WORKSPACE_ACCEPTANCE==='1';
it.skipIf(!enabled)('5 real HTTP receipt recovery binds Owner, full payload, session and CSRF without repeating mutation',async()=>{
 const f=await nativeWorkspaceFixture();try{
  await f.start();const key=randomUUID(),operation={command:'renameAccount',idempotencyKey:key,data:{accountId:randomUUID(),name:'committed original'}},result={id:'committed-result',name:'committed original'};
  const hash=createHash('sha256').update(JSON.stringify(canonical(operation))).digest('hex');
  await f.c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[f.owner,key,hash,result]);
  const query=async(body:unknown,token=f.token,csrf=true)=>fetch(f.origin+'/api/local/command-receipt',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+token,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrfFor(token)}:{})},body:JSON.stringify(body)});
  const body={endpoint:'configuration',operation};
  expect(await(await query(body)).json()).toEqual({status:'committed',result});
  expect(await(await query(body,f.otherToken)).json()).toEqual({status:'unknown'});
  expect((await query(body,f.token,false)).status).toBe(403);
  expect((await query({...body,operation:{...operation,data:{...operation.data,name:'different'}}})).status).toBe(409);
  expect(await(await query({...body,operation:{...operation,idempotencyKey:randomUUID()}})).json()).toEqual({status:'unknown'});
  expect((await f.c.query('SELECT count(*)::integer n FROM local_identity.command_receipts WHERE owner_id=$1',[f.owner])).rows[0].n).toBe(1);
 }finally{await f.close();}
},120000);
it.skipIf(!enabled)('5 lifecycle receipt readback never exposes a private deletion inventory or executes cleanup',async()=>{
 const f=await nativeWorkspaceFixture();try{
  await f.start();const key=randomUUID(),operation={command:'deleteEpisode',idempotencyKey:key,data:{episodeId:randomUUID()}},result={episodeId:'public-id',cleanupKey:key,cleanupPending:true,cleanupRoot:'/private/synthetic',cleanupTargets:[{files:['sensitive manifest']}],historyCleanupTargets:['private-history'],recycleInventory:{secretPath:'private-file'},title:'public title'};
  const hash=createHash('sha256').update(JSON.stringify(canonical({endpoint:'episode-lifecycle',...operation}))).digest('hex');
  await f.c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[f.owner,key,hash,result]);
  const response=await fetch(f.origin+'/api/local/command-receipt',{method:'POST',headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({endpoint:'episode-lifecycle',operation})});
  expect(response.status).toBe(200);const value=await response.json();expect(value).toEqual({status:'committed',result:{episodeId:'public-id',cleanupKey:key,cleanupPending:true,title:'public title'}});expect(JSON.stringify(value)).not.toContain('private');
 }finally{await f.close();}
},120000);
