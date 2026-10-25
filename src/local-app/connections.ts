import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {OwnerSession} from './sessions.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError} from './configurationCommands.js';
import {disabledSecretStore,disabledConnectionProbe,type SecretStore,type ConnectionProbe} from './connectionPorts.js';
import {ownedConnectionVersion,verifyLocalConnection} from '../worker/localConnection.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fields={create:['name','provider','adapter','secret'],rotate:['connectionId','provider','adapter','secret'],rebind:['versionId','secret'],update:['connectionId','name','description'],revoke:['versionId'],verify:['connectionId']} as const;
const metadataJSON=(value:Record<string,string>)=>JSON.stringify(Object.entries(value).sort());
function invalid(message='连接请求无效。'):never{throw new ConfigurationError(400,message);}
export function parseConnectionCommand(body:Record<string,unknown>){
 if(typeof body.command!=='string'||!Object.hasOwn(fields,body.command))invalid();
 if(typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey))invalid('缺少操作标识。');
 if(Object.keys(body).some(k=>!['command','data','idempotencyKey'].includes(k)))invalid();
 const command=body.command as keyof typeof fields;
 if(!body.data||typeof body.data!=='object'||Array.isArray(body.data))invalid();
 const data=body.data as Record<string,unknown>;
 if(Object.keys(data).length!==fields[command].length||Object.keys(data).some(k=>!(fields[command] as readonly string[]).includes(k)))invalid();
 const metadata:Record<string,string>={command};let secret='';
 for(const key of fields[command]){
  const value=data[key];if(typeof value!=='string')invalid();
  if(key.endsWith('Id')&&!uuid.test(value))invalid();
  if(key==='secret'){if(!value.trim()||Buffer.byteLength(value)>4096)invalid('认证材料无效。');secret=value;}
  else{const clean=value.trim();if(clean.length>(key==='description'?500:100)||key!=='description'&&!clean)invalid();metadata[key]=clean;}
 }
 return {command,key:body.idempotencyKey,metadata,secret};
}
async function lockIntent(client:PoolClient,ownerId:string,key:string){await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['connection:'+ownerId+':'+key]);}
export class LocalConnections {
 constructor(private pool:Pool,private store:SecretStore=disabledSecretStore,private probe:ConnectionProbe=disabledConnectionProbe){}
 get externalReady(){return this.store.mode==='keychain'&&this.probe.mode==='live'&&this.probe.networkAvailable!==false;}
 async assertBlueprintReferences(client:PoolClient,refs:string[]){
  if(!this.externalReady)throw new ConfigurationError(409,'真实Keychain及在线验证尚未就绪。');
  const owners=await Promise.all(refs.map(id=>ownedConnectionVersion(client,id)));
  if(owners.some(v=>!v))throw new ConfigurationError(409,'连接版本不可见。');
  for(const connectionId of [...new Set(owners.map(v=>v!.connection_id))].sort())await client.query('SELECT local_identity.lock_owned_connection($1)',[connectionId]);
  for(const id of [...refs].sort()){
   const v=await ownedConnectionVersion(client,id);
   if(!v||v.revoked_at||!v.is_current||v.store_mode!=='keychain'||!v.secret_ref)throw new ConfigurationError(409,'连接版本未绑定、已变化或已撤销。');
   const verified=(await client.query("SELECT public.connection_version_is_verified($1) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence WHERE version_id=$1 AND mode='live' AND outcome='verified') allowed",[id])).rows[0];
   if(!verified.allowed)throw new ConfigurationError(409,'连接版本需要真实验证。');
   await this.store.get(v.secret_ref); // Availability check; resolved bytes never enter SQL/HTTP.
  }
 }
 async read(ownerId:string){
  return ownerTransaction(this.pool,ownerId,true,async client=>{
   const connections=(await client.query('SELECT * FROM public.external_connections WHERE created_by=$1 ORDER BY created_at,id',[ownerId])).rows;
   const versions=(await client.query('SELECT * FROM public.list_external_connection_versions(NULL)')).rows;
   const bindings=(await client.query('SELECT version_id,store_mode FROM local_identity.connection_bindings WHERE owner_id=$1',[ownerId])).rows;
   const qualifications=(await client.query('SELECT version_id,qualified FROM local_identity.connection_qualifications WHERE owner_id=$1',[ownerId])).rows;
   const latest=(await client.query('SELECT DISTINCT ON(connection_version_id) connection_version_id,status FROM public.external_connection_verifications ORDER BY connection_version_id,created_at DESC,id DESC')).rows;
   const pending=(await client.query('SELECT idempotency_key,metadata,created_at FROM local_identity.connection_intents WHERE owner_id=$1 AND applied_at IS NULL ORDER BY created_at',[ownerId])).rows;
   const externalReady=this.store.mode==='keychain'&&this.probe.mode==='live'&&this.probe.networkAvailable!==false;
   const localVersions=versions.map(v=>{const binding=bindings.find(b=>b.version_id===v.id),qualified=qualifications.some(q=>q.version_id===v.id&&q.qualified);return {...v,historicalStatus:v.status,status:v.revoked_at?'revoked':!externalReady||!binding||binding.store_mode!=='keychain'?'retryable':qualified?'verified':v.status==='verified'?'retryable':v.status,secretState:binding?'bound-unchecked':'unbound'};});
   // Historical provider text is never used as a diagnostic response channel;
   // an imported verified flag cannot stand in for a usable native binding.
   for(const c of connections){const current=localVersions.find(v=>v.id===c.current_version_id);if(current?.status==='revoked')c.status='invalid';else if(current)c.status=current.status;
    const last=latest.find(p=>p.connection_version_id===c.current_version_id);
    c.last_verification_detail=current?.secretState==='unbound'?'本机秘密未绑定，请显式重新录入。':!externalReady?'真实Keychain及在线验证尚未启用。':last?.status==='retryable'&&c.status==='verified'?'本次测试暂不可用；上次有效验证资格保留，生产前仍须检查。':c.status==='verified'?'已验证；运行时仍检查秘密可用性。':'需要在本机重新验证。';}
   return {connections,versions:localVersions,pending,capabilities:{secrets:this.store.mode,verification:this.probe.mode,externalReady,networkAvailable:this.probe.mode==='live'&&this.probe.networkAvailable!==false}};
  });
 }
 async command(session:OwnerSession,body:Record<string,unknown>){
  const input=parseConnectionCommand(body),{metadata,key,command}=input;
  if(['create','rotate','rebind'].includes(command)){
   if(this.store.mode==='disabled')throw new ConfigurationError(503,'Keychain尚未授权启用；认证材料未写入。');
   // Persist only a recoverable intent and opaque references BEFORE helper I/O.
   await sessionTransaction(this.pool,session,async client=>{
    await lockIntent(client,session.id,key);
    const old=(await client.query('SELECT metadata,store_mode FROM local_identity.connection_intents WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];
    if(old){if(metadataJSON(old.metadata)!==metadataJSON(metadata)||old.store_mode!==this.store.mode)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return;}
    let connectionId:string=randomUUID(),versionId:string=randomUUID(),reference:string=randomUUID();
    if(command==='create'||command==='rotate'){
     const endpoint=(await client.query('SELECT public.official_external_connection_endpoint($1,$2) endpoint',[metadata.provider,metadata.adapter])).rows[0].endpoint;
     if(!endpoint)invalid('只支持已登记的供应商和适配器。');
    }
    if(command==='rotate'){
     const c=(await client.query('SELECT id FROM public.external_connections WHERE id=$1 AND created_by=$2',[metadata.connectionId,session.id])).rows[0];
     if(!c)throw new ConfigurationError(404,'连接不可见。');connectionId=c.id;
    }
    if(command==='rebind'){
     const v=await ownedConnectionVersion(client,metadata.versionId);
     if(!v||v.revoked_at)throw new ConfigurationError(404,'版本不可见或已撤销。');
     if(v.store_mode&&v.store_mode!==this.store.mode)throw new ConfigurationError(409,'存储模式不匹配。');
     connectionId=v.connection_id;versionId=v.id;reference=v.secret_ref??reference;
    }
    const membership=(await client.query("SELECT EXISTS(SELECT 1 FROM public.account_memberships WHERE user_id=$1 AND role='owner') allowed",[session.id])).rows[0];
    if(!membership.allowed)throw new ConfigurationError(403,'需要账号所有者关系。');
    await client.query('INSERT INTO local_identity.connection_intents(owner_id,idempotency_key,metadata,connection_id,version_id,secret_ref,store_mode) VALUES($1,$2,$3,$4,$5,$6,$7)',[session.id,key,metadata,connectionId,versionId,reference,this.store.mode]);
   });
   return sessionTransaction(this.pool,session,async client=>{
    await lockIntent(client,session.id,key);
    const i=(await client.query('SELECT * FROM local_identity.connection_intents WHERE owner_id=$1 AND idempotency_key=$2 FOR UPDATE',[session.id,key])).rows[0];
    if(i.applied_at)return {connection:i.result,replayed:true};
    const membership=(await client.query("SELECT EXISTS(SELECT 1 FROM public.account_memberships WHERE user_id=$1 AND role='owner') allowed",[session.id])).rows[0];
    if(!membership.allowed)throw new ConfigurationError(403,'需要账号所有者关系。');
    if(command==='rotate'){
     // Serialize version allocation and avoid revocation/rotation during I/O.
     await client.query('SELECT local_identity.lock_owned_connection($1)',[i.connection_id]);
    }else if(command==='rebind'){
     await client.query('SELECT local_identity.lock_owned_connection($1)',[i.connection_id]);
     const v=await ownedConnectionVersion(client,i.version_id);if(!v||v.revoked_at||v.secret_ref&&v.secret_ref!==i.secret_ref)throw new ConfigurationError(409,'版本或绑定已变化。');
    }
    await this.store.putImmutable(i.secret_ref,input.secret);
    const result=(await client.query('SELECT local_identity.apply_connection_intent($1) result',[key])).rows[0].result;
    return {connection:result,replayed:false};
   });
  }
  const hash=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
  return sessionTransaction(this.pool,session,async client=>{
   await lockIntent(client,session.id,key);
   const old=(await client.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,key])).rows[0];
   if(old){if(old.payload_hash!==hash)throw new ConfigurationError(409,'操作标识冲突。');return old.result;}
   let result:unknown;
   if(command==='update'){
    result=(await client.query('SELECT to_jsonb(public.update_external_connection($1,$2,$3)) result',[metadata.connectionId,metadata.name,metadata.description])).rows[0].result;
   }else if(command==='revoke'){
    const v=await ownedConnectionVersion(client,metadata.versionId);if(!v)throw new ConfigurationError(404,'版本不可见。');
    await client.query('SELECT local_identity.lock_owned_connection($1)',[v.connection_id]);
    await client.query('SELECT public.revoke_external_connection_version($1)',[v.id]);result={revoked:true,versionId:v.id};
   }else{
    const c=(await client.query('SELECT current_version_id FROM public.external_connections WHERE id=$1 AND created_by=$2',[metadata.connectionId,session.id])).rows[0];
    if(!c)throw new ConfigurationError(404,'连接不可见。');
    await client.query('SELECT local_identity.lock_owned_connection($1)',[metadata.connectionId]);
    const current=(await client.query('SELECT current_version_id FROM public.external_connections WHERE id=$1',[metadata.connectionId])).rows[0];
    const v=await ownedConnectionVersion(client,current.current_version_id);if(!v)throw new ConfigurationError(404,'版本不可见。');
    result=await verifyLocalConnection(client,this.store,this.probe,v);
   }
   await client.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,key,hash,result]);
   return result;
  });
 }
}
