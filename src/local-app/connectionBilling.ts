import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {billingProvider,type ConnectionBillingSettings} from '../connections/connectionBilling.js';
import {connectionUsagePlaceholder,type ConnectionUsageSummary} from '../connections/connectionUsage.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import type {SecretStore} from './connectionPorts.js';
import {ConfigurationError} from './configurationCommands.js';
import {createBillingReader,parseBillingCredential,billingReadSucceeded,type BillingReader} from './providerBilling.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function settings(c:PoolClient,connectionId:string):Promise<ConnectionBillingSettings>{
 const connection=(await c.query('SELECT provider FROM public.external_connections WHERE id=$1',[connectionId])).rows[0];
 if(!connection)throw new ConfigurationError(404,'连接不可见。');const provider=billingProvider(connection.provider);if(!provider)throw new ConfigurationError(400,'此服务尚未支持独立账务接入。');
 const current=(await c.query("SELECT id,updated_at FROM local_identity.connection_billing_credentials WHERE connection_id=$1 AND status='current'",[connectionId])).rows[0];
 return {connectionId,provider,configured:Boolean(current),revision:current?.id??'default',updatedAt:current?.updated_at?.toISOString()??null};
}
export class LocalConnectionBilling{
 private cache=new Map<string,{pending:boolean;expires:number;request:Promise<ConnectionUsageSummary>}>();
 constructor(private pool:Pool,private store:SecretStore,private reader:BillingReader=createBillingReader()){}
 read(ownerId:string,connectionId:string){return ownerTransaction(this.pool,ownerId,true,c=>settings(c,connectionId));}
 private async credential(ownerId:string,connectionId:string){return ownerTransaction(this.pool,ownerId,true,async c=>{const s=await settings(c,connectionId);const row=s.configured?(await c.query("SELECT secret_ref FROM local_identity.connection_billing_credentials WHERE id=$1 AND status='current'",[s.revision])).rows[0]:null;return {s,row};});}
 async usage(ownerId:string,connectionId:string,force=false):Promise<ConnectionUsageSummary>{
  const {s,row}=await this.credential(ownerId,connectionId);if(!row)return connectionUsagePlaceholder(s.provider==='aliyun'?'bailian':s.provider);
  const key=ownerId+':'+s.revision,previous=this.cache.get(key);if(previous&&(previous.pending||!force&&previous.expires>Date.now()))return previous.request;
  if(this.store.mode!=='keychain')throw new ConfigurationError(503,'本机Keychain不可用，未读取账务凭据。');
  const request=(async()=>{
   let result:ConnectionUsageSummary;try{result=await this.reader(s.provider,parseBillingCredential(s.provider,await this.store.get(row.secret_ref)));}
   catch{result={remaining:{label:'可用额',text:'读取失败',detail:'账务凭据无法读取，请重新配置或稍后重试。',status:'unavailable'},recent:{label:'近7天',text:'读取失败',detail:'账务凭据无法读取，请重新配置或稍后重试。',status:'unavailable'},updatedAt:null};}
   // Rotation/disconnection while the request was in flight must not publish an old account's data.
   const latest=await this.read(ownerId,connectionId);if(latest.revision!==s.revision)throw new ConfigurationError(409,'账务设置已变化，请重新读取。');return result;
  })();
  if(this.cache.size>=64)this.cache.delete(this.cache.keys().next().value!);
  const item={pending:true,expires:Date.now()+5*60000,request};this.cache.set(key,item);void request.finally(()=>{item.pending=false;}).catch(()=>{});return request;
 }
 async command(session:OwnerSession,body:Record<string,unknown>):Promise<ConnectionBillingSettings>{
  const data=body.data as Record<string,unknown>|undefined,save=body.command==='save';
  if(!['save','refresh','disconnect'].includes(String(body.command))||Object.keys(body).some(k=>!['command','data','idempotencyKey'].includes(k))||typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==(save?3:2)||Object.keys(data).some(k=>!(save?['connectionId','revision','credential']:['connectionId','revision']).includes(k))||typeof data.connectionId!=='string'||!uuid.test(data.connectionId)||typeof data.revision!=='string'||data.revision!=='default'&&!uuid.test(data.revision)||save&&(typeof data.credential!=='string'||Buffer.byteLength(data.credential)>4096))throw new ConfigurationError(400,'账务设置请求无效。');
  const connectionId=data.connectionId,revision=data.revision,key=body.idempotencyKey;
  const assertRevision=(s:ConnectionBillingSettings)=>{if(s.revision!==revision)throw new ConfigurationError(409,'账务设置已被修改，请重新打开后重试。');};
  const initial=await sessionTransaction(this.pool,session,async c=>{const s=await settings(c,connectionId);return s;});
  if(body.command==='refresh'){assertRevision(initial);if(!initial.configured)throw new ConfigurationError(409,'请先配置账务凭据。');const usage=await this.usage(session.id,connectionId,true),latest=await this.read(session.id,connectionId);assertRevision(latest);return {...latest,usage};}
  if(body.command==='disconnect')return sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT local_identity.lock_owned_connection($1)',[connectionId]);const s=await settings(c,connectionId);if(!s.configured)return s;assertRevision(s);
   await c.query("UPDATE local_identity.connection_billing_credentials SET status='retired',updated_at=clock_timestamp() WHERE id=$1",[s.revision]);this.cache.delete(session.id+':'+s.revision);return settings(c,connectionId);
  });
  if(this.store.mode!=='keychain')throw new ConfigurationError(503,'真实Keychain未就绪，未保存账务凭据。');
  let credential;try{credential=parseBillingCredential(initial.provider,data.credential as string);}catch{throw new ConfigurationError(400,'账务凭据格式无效，请检查输入。');}
  const secret=JSON.stringify(credential),hash=createHash('sha256').update(connectionId+':'+initial.provider+':'+secret).digest('hex');
  const prior=await ownerTransaction(this.pool,session.id,true,c=>c.query('SELECT id,status,request_hash,connection_id FROM local_identity.connection_billing_credentials WHERE owner_id=$1 AND operation_key=$2',[session.id,key]));
  if(prior.rows[0]){const row=prior.rows[0];if(row.request_hash!==hash||row.connection_id!==connectionId)throw new ConfigurationError(409,'操作标识已用于不同账务内容。');if(row.status==='current'){const usage=await this.usage(session.id,connectionId),latest=await this.read(session.id,connectionId);if(latest.revision!==row.id)throw new ConfigurationError(409,'账务设置已变化，请重新打开。');return {...latest,usage};}if(row.status==='retired')throw new ConfigurationError(409,'此保存操作已被新设置替代，请重新打开。');}
  assertRevision(initial);
  const usage=await this.reader(initial.provider,credential);
  if(!billingReadSucceeded(usage))throw new ConfigurationError(502,usage.recent.detail||'账务验证未通过，未保存。');
  const record=await sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT local_identity.lock_owned_connection($1)',[connectionId]);
   const existing=(await c.query('SELECT id,secret_ref,request_hash,status FROM local_identity.connection_billing_credentials WHERE owner_id=$1 AND operation_key=$2',[session.id,key])).rows[0];
   if(existing){if(existing.request_hash!==hash||existing.status==='retired')throw new ConfigurationError(409,'账务保存操作已变化。');return existing;}
   assertRevision(await settings(c,connectionId));
   return (await c.query("INSERT INTO local_identity.connection_billing_credentials(id,connection_id,owner_id,provider,secret_ref,request_hash,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,secret_ref,status",[randomUUID(),connectionId,session.id,initial.provider,randomUUID(),hash,key])).rows[0];
  });
  try{await this.store.putImmutable(record.secret_ref,secret);}catch{throw new ConfigurationError(503,'Keychain保存失败，原账务设置未改变。');}
  const result=await sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT local_identity.lock_owned_connection($1)',[connectionId]);const s=await settings(c,connectionId);if(s.revision===record.id)return s;assertRevision(s);
   if(s.configured)await c.query("UPDATE local_identity.connection_billing_credentials SET status='retired',updated_at=clock_timestamp() WHERE id=$1",[s.revision]);
   await c.query("UPDATE local_identity.connection_billing_credentials SET status='current',updated_at=clock_timestamp() WHERE id=$1 AND status='pending'",[record.id]);return settings(c,connectionId);
  });
  this.cache.set(session.id+':'+result.revision,{pending:false,expires:Date.now()+5*60000,request:Promise.resolve(usage)});return {...result,usage};
 }
}
