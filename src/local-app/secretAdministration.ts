import type {Pool,PoolClient} from 'pg';
import {tokenHash,type OwnerSession} from './sessions.js';
import {verifyPassword,type PasswordDigest} from './password.js';
import type {SecretStore} from './connectionPorts.js';
import {SecretInventory,controlReference,secretReferencePattern,type SecretInventoryConfiguration} from './secretInventory.js';
import type {SecretMetadata} from './secretAdministrationTypes.js';
export type SecretOperation='list'|'detail'|'view'|'copy';
type Reply={status:number;body:unknown};
export interface SecretAdministrationConfiguration extends SecretInventoryConfiguration {adminOwnerId:string}
export class SecretAdministration {
 private inventory:SecretInventory;
 constructor(private pool:Pool,private config:SecretAdministrationConfiguration,private store:Pick<SecretStore,'get'>){
  if(!secretReferencePattern.test(config.adminOwnerId))throw Error('Invalid secret administrator configuration');this.inventory=new SecretInventory(config);
 }
 allowed(session:OwnerSession){return session.id===this.config.adminOwnerId;}
 async rejected(actor:string|null,operation:SecretOperation,reason:string,reference:string|null=null){
  const safe=reference===controlReference||secretReferencePattern.test(reference??'')?reference:null;
  await this.pool.query('INSERT INTO local_identity.secret_access_audit(actor_id,reference,operation,outcome,reason) VALUES($1,$2,$3,\'denied\',$4)',[actor,safe,operation,reason]);
 }
 private async transaction(session:OwnerSession,operation:SecretOperation,reference:string|null,run:(client:PoolClient)=>Promise<Reply>):Promise<Reply>{
  if(!this.allowed(session)){await this.rejected(session.id,operation,'not_administrator',reference);return{status:403,body:{error:'仅指定管理员可访问密钥管理。'}};}
  const c=await this.pool.connect();try{
   await c.query('BEGIN');await c.query("SELECT set_config('loop.owner_id',$1,true)",[session.id]);
   const valid=await c.query('SELECT token_hash FROM local_identity.sessions WHERE token_hash=$1 AND owner_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[tokenHash(session.token),session.id]);
   let result:Reply;
   if(!valid.rowCount)result={status:401,body:{error:'会话已失效，请重新登录。'}};
   else{
    const scope=operation==='view'||operation==='copy'?'plaintext':'metadata';
    const count=(await c.query(`INSERT INTO local_identity.secret_access_windows(owner_id,scope,started_at,requests) VALUES($1,$2,clock_timestamp(),1)
     ON CONFLICT(owner_id,scope) DO UPDATE SET requests=CASE WHEN local_identity.secret_access_windows.started_at<=clock_timestamp()-interval '1 minute' THEN 1 ELSE local_identity.secret_access_windows.requests+1 END,started_at=CASE WHEN local_identity.secret_access_windows.started_at<=clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE local_identity.secret_access_windows.started_at END RETURNING requests`,[session.id,scope])).rows[0].requests;
    result=count>(scope==='plaintext'?5:120)?{status:429,body:{error:'操作过于频繁，请稍后再试。'}}:await run(c);
   }
   // A long metadata scan or Keychain authorization prompt may outlive expiry.
   if(result.status===200&&!(await c.query('SELECT 1 FROM local_identity.sessions WHERE token_hash=$1 AND owner_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[tokenHash(session.token),session.id])).rowCount)result={status:401,body:{error:'会话已失效，请重新登录。'}};
   const body=result.body as{reason?:string;error?:string};
   await c.query('INSERT INTO local_identity.secret_access_audit(actor_id,reference,operation,outcome,reason) VALUES($1,$2,$3,$4,$5)',[session.id,reference===controlReference||secretReferencePattern.test(reference??'')?reference:null,operation,result.status===200?'success':'denied',body.reason??(result.status===200?'completed':result.status===401?'session_expired':result.status===429?'rate_limited':'rejected')]);
   if(body.reason)delete body.reason;
   await c.query('COMMIT');return result;
  }catch{await c.query('ROLLBACK').catch(()=>{});await this.rejected(session.id,operation,'service_unavailable',reference);return{status:503,body:{error:'密钥管理暂不可用；未返回密钥值。'}};}
  finally{c.release();}
 }
 private async metadata(c:PoolClient,session:OwnerSession){const inventory=(await c.query('SELECT local_identity.secret_reference_inventory($1) inventory',[tokenHash(session.token)])).rows[0].inventory;return this.inventory.read(inventory);}
 list(session:OwnerSession,search:URLSearchParams):Promise<Reply>{return this.transaction(session,'list',null,async c=>{
  if([...search.keys()].some(k=>!['q','category','page'].includes(k)||search.getAll(k).length!==1)||(search.get('q')??'').length>200||!['all','system','connection','history','unreferenced'].includes(search.get('category')??'all')||!/^\d{1,6}$/.test(search.get('page')??'1'))return{status:400,body:{error:'密钥筛选条件无效。',reason:'invalid_request'}};
  const query=(search.get('q')??'').toLowerCase(),category=search.get('category')??'all';
  const inventory=await this.metadata(c,session);
  const categoryCounts=Object.fromEntries(['system','connection','history','unreferenced'].map(category=>[category,inventory.filter(row=>row.category===category).length]));
  const rows=inventory.filter(row=>(category==='all'||row.category===category)&&[...row.names,...row.aliases,row.reference,row.purpose,...row.connections.map(v=>v.name)].join('\n').toLowerCase().includes(query));
  const page=Math.max(1,Math.min(Number(search.get('page')??1),Math.max(1,Math.ceil(rows.length/50))));
  return{status:200,body:{categoryCounts,items:rows.slice((page-1)*50,page*50),total:rows.length,page,pageSize:50,observedAt:new Date().toISOString()}};
 });}
 detail(session:OwnerSession,reference:string):Promise<Reply>{return this.transaction(session,'detail',reference,async c=>{
  if(reference!==controlReference&&!secretReferencePattern.test(reference))return{status:400,body:{error:'密钥引用无效。',reason:'invalid_reference'}};
  const item=(await this.metadata(c,session)).find(row=>row.reference===reference);
  return item?{status:200,body:{item}}:{status:404,body:{error:'密钥引用未登记。',reason:'unknown_reference'}};
 });}
 reveal(session:OwnerSession,input:Record<string,unknown>):Promise<Reply>{
  const operation:SecretOperation=input.action==='copy'?'copy':'view',reference=typeof input.reference==='string'?input.reference:'';
  return this.transaction(session,operation,reference,async c=>{
   const denied=(status:number,error:string,reason:string):Reply=>({status,body:{error,reason}});
   if(Object.keys(input).some(k=>!['reference','password','action'].includes(k))||!['view','copy'].includes(String(input.action))||!secretReferencePattern.test(reference)||typeof input.password!=='string'||!input.password||input.password.length>1024)return denied(400,'密钥请求无效。','invalid_request');
   let item:SecretMetadata|undefined=(await this.metadata(c,session)).find(row=>row.reference===reference);
   if(!item)return denied(404,'密钥引用未登记。','unknown_reference');
   if(!item.revealAllowed)return denied(403,'系统控制密钥不提供网页明文读取。','control_secret');
   const row=(await c.query('SELECT password_digest,coalesce(locked_until>clock_timestamp(),false) locked FROM local_identity.credentials WHERE owner_id=$1 FOR UPDATE',[session.id])).rows[0] as{password_digest:PasswordDigest;locked:boolean}|undefined;
   if(!row||row.locked)return denied(429,'登录验证已暂时锁定，请稍后重试。','credential_locked');
   if(!await verifyPassword(input.password,row.password_digest)){
    await c.query("UPDATE local_identity.credentials SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=5 THEN clock_timestamp()+interval '15 minutes' END WHERE owner_id=$1",[session.id]);
    return denied(403,'当前密码验证失败。','wrong_password');
   }
   // The current immutable reference/control status is checked again after reauthentication.
   item=(await this.metadata(c,session)).find(row=>row.reference===reference);
   if(!item?.revealAllowed)return denied(403,'密钥引用或控制状态已变化，请重新查询。','reference_changed');
   let value:string;try{value=await this.store.get(reference);}catch{return denied(503,'专用 Keychain 已锁定、条目缺失或系统授权不可用；请检查本机 Keychain。','keychain_unavailable');}
   return{status:200,body:{value,expiresAt:new Date(Date.now()+30000).toISOString()}};
  });
 }
}
