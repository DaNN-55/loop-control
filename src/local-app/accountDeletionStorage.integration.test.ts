// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {csrfFor} from './sessions';
import {deletionFixtureFingerprint} from './deletionFingerprint.fixture';

it.skipIf(process.env.LOOP_ACCOUNT_DELETION_ACCEPTANCE!=='1')('account deletion cleans only registered empty containers, retaining unknown parents and immutable completed creation history',async()=>{
 const f=await embeddedStudioFixture();
 const post=async(endpoint:string,command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/'+endpoint,{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 try{
  const created=await post('configuration','createAccount',{name:'空账号 中文 %_[]',slug:'empty-'+randomUUID(),timezone:'UTC',policy:{}});expect(created.status,JSON.stringify(created.body)).toBe(200);const account=created.body.id;
  const series=await post('configuration','createSeries',{accountId:account,name:'系列 %_[]',rules:{}});expect(series.status,JSON.stringify(series.body)).toBe(200);expect((await post('account-commands','createUnassignedDirectory',{accountId:account})).status).toBe(200);
  const root=(await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[account])).rows[0].actual_root,containers=(await f.c.query('SELECT * FROM local_identity.account_storage_containers WHERE account_id=$1',[account])).rows;
  const before=(await f.c.query('SELECT to_jsonb(i) value FROM local_identity.container_creation_intents i WHERE account_id=$1 ORDER BY idempotency_key',[account])).rows;
  const accountIntent=(await f.c.query('SELECT to_jsonb(i) value FROM local_identity.account_creation_intents i WHERE account_id=$1',[account])).rows;
  const receipts=async()=>(await f.c.query('SELECT to_jsonb(r) value FROM local_identity.command_receipts r WHERE owner_id=$1 AND idempotency_key IN (SELECT idempotency_key FROM local_identity.container_creation_intents WHERE account_id=$2 UNION SELECT idempotency_key FROM local_identity.account_creation_intents WHERE account_id=$2) ORDER BY idempotency_key',[f.owner,account])).rows,beforeReceipts=await receipts();
  const source=createHash('sha256').update('T10 history '+account).digest('hex'),payload={id:account,name:'immutable account history'};await f.c.query("INSERT INTO local_identity.history_sources(id,owner_id,kind,label) VALUES($1,$2,'fixture','T10 immutable creation history')",[source,f.owner]);await f.c.query("INSERT INTO local_identity.history_versions(table_name,row_key,payload_sha256,owner_id,payload) VALUES('public.accounts',$1,$2,$3,$4)",[{id:account},createHash('sha256').update(JSON.stringify(payload)).digest('hex'),f.owner,payload]);
  const history=async()=>{const rows=[];for(const table of ['history_sources','history_versions','history_source_rows','history_projection_results','history_files'])rows.push((await f.c.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') value FROM local_identity.${table} t`)).rows[0].value);return rows;},beforeHistory=await history();
  const unknown=join(root,'unknown empty manual directory');await mkdir(unknown);
  const foreignBefore=await deletionFixtureFingerprint(f.assetRoot);
  const deleted=await post('configuration','deleteAccount',{accountId:account,confirmation:'空账号 中文 %_[]'});expect(deleted,JSON.stringify(deleted.body)).toEqual({status:200,body:true});
  for(const container of containers)await expect(access(join(root,container.directory_relative_path))).rejects.toMatchObject({code:'ENOENT'});
  await access(unknown);expect(await deletionFixtureFingerprint(f.assetRoot)).toEqual(foreignBefore);expect((await f.c.query('SELECT to_jsonb(i) value FROM local_identity.container_creation_intents i WHERE account_id=$1 ORDER BY idempotency_key',[account])).rows).toEqual(before);expect((await f.c.query('SELECT to_jsonb(i) value FROM local_identity.account_creation_intents i WHERE account_id=$1',[account])).rows).toEqual(accountIntent);expect(await receipts()).toEqual(beforeReceipts);expect(await history()).toEqual(beforeHistory);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_ACCOUNT_DELETION_ACCEPTANCE!=='1')('a pending registered container creation reserves its account against parent deletion',async()=>{
 const f=await embeddedStudioFixture();
 const post=async(command:string,data:Record<string,unknown>)=>{const response=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:randomUUID(),data})});return{status:response.status,body:await response.json()};};
 try{
  const created=await post('createAccount',{name:'Pending container',slug:'pending-'+randomUUID(),timezone:'UTC',policy:{}}),account=created.body.id;expect(created.status).toBe(200);expect((await post('createSeries',{accountId:account,name:'Completed container',rules:{}})).status).toBe(200);
  const key=randomUUID(),id=randomUUID();await f.c.query("INSERT INTO local_identity.container_creation_intents(owner_id,idempotency_key,payload_hash,container_id,account_id,kind,directory_relative_path,account_root,account_device_id,account_inode_id,root_binding,marker) SELECT owner_id,$2,payload_hash,$3,account_id,'series',$4,account_root,account_device_id,account_inode_id,root_binding,$5 FROM local_identity.container_creation_intents WHERE account_id=$1 LIMIT 1",[account,key,id,'reserved-'+id,randomUUID()]);
  const root=(await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[account])).rows[0].actual_root,before=await deletionFixtureFingerprint(root),intent=(await f.c.query('SELECT to_jsonb(i) value FROM local_identity.container_creation_intents i WHERE idempotency_key=$1',[key])).rows;
  const rejected=await post('deleteAccount',{accountId:account,confirmation:'Pending container'});expect(rejected.status,JSON.stringify(rejected.body)).toBe(409);expect(rejected.body.error).toContain('未完成');expect(await deletionFixtureFingerprint(root)).toEqual(before);expect((await f.c.query('SELECT to_jsonb(i) value FROM local_identity.container_creation_intents i WHERE idempotency_key=$1',[key])).rows).toEqual(intent);
 }finally{await f.close();}
},300000);

it.skipIf(process.env.LOOP_ACCOUNT_DELETION_ACCEPTANCE!=='1')('a parent account cannot cascade an active, archived or completed production',async()=>{
 const f=await embeddedStudioFixture();
 try{
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id,before=await deletionFixtureFingerprint(f.assetRoot);
  for(const state of [{stage:'qc_review',archived:false},{stage:'qc_review',archived:true},{stage:'production_completed',archived:true}]){
   await f.c.query('UPDATE public.episodes SET stage=$2,archived_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1',[f.episode,state.stage,state.archived]);const response=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'deleteAccount',idempotencyKey:randomUUID(),data:{accountId:account,confirmation:'Studio153 fixture'}})});expect(response.status,JSON.stringify(await response.json())).toBe(409);expect(await deletionFixtureFingerprint(f.assetRoot)).toEqual(before);
  }
 }finally{await f.close();}
},300000);
