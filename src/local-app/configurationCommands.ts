import {accountDeletionOperations} from './accountDeletion.js';
import {createStorageContainer} from './seriesDirectories.js';
import {createAccountDirectory} from './accountCreation.js';
import {creativeAccountRules} from '../creativeAccountRules.js';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {ownerTransaction} from './ownerTransaction.js';
import {tokenHash,type OwnerSession} from './sessions.js';
import {readMediaDeployment} from './mediaDeployment.js';
import {planEmptyAccountDirectories,planRegisteredEmptyAccountDirectories,cleanupEmptyAccountDirectories,type EmptyAccountDirectory} from './accountDirectoryCleanup.js';
import type {WorkerPreflightResult} from '../worker/contracts.js';
export class ConfigurationError extends Error {constructor(public status:number,message:string,public preflight?:WorkerPreflightResult){super(message);}}
export function validateConfigurationPolicy(value:unknown,allowExternal=false):string[]{
 const refs=new Set<string>();
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ConfigurationError(400,'蓝图规则必须是对象。');
 function visit(node:unknown){
  if(!node||typeof node!=='object')return;
  for(const [key,v] of Object.entries(node)){
   if(['secret','password','api_key','access_token','refresh_token'].includes(key))throw new ConfigurationError(400,'蓝图不能保存密钥。');
   if(key==='credential_ref'&&v){if(!allowExternal)throw new ConfigurationError(409,'本地外部连接尚未就绪，请先完成连接管理。');if(typeof v!=='string'||!uuid.test(v))throw new ConfigurationError(400,'连接版本引用无效。');refs.add(v);}
   if(key==='execution_path'&&v==='external'&&!allowExternal)throw new ConfigurationError(409,'本地外部连接尚未就绪，请先完成连接管理。');
   visit(v);
  }
 }
 visit(value);
 return [...refs];
}
function validatePolicySecrets(value:unknown):void{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ConfigurationError(400,'蓝图规则必须是对象。');
 function visit(node:unknown):void{if(!node||typeof node!=='object')return;for(const[key,v]of Object.entries(node)){if(['secret','password','api_key','access_token','refresh_token'].includes(key))throw new ConfigurationError(400,'蓝图不能保存密钥。');visit(v);}}
 visit(value);
}
export function canonical(value:unknown):unknown{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort().map(([k,v])=>[k,canonical(v)])):value;}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const commands={
 createAccount:{sql:'select to_jsonb(public.create_account($1,$2,$3,$4)) result',fields:['name','slug','timezone','policy']},
 updateBlueprint:{sql:'select to_jsonb(public.update_current_blueprint($1,$2)) result',fields:['accountId','policy']},
 createBlueprint:{sql:'select to_jsonb(public.create_blueprint_version($1,$2)) result',fields:['accountId','policy']},
 activateBlueprint:{sql:'select to_jsonb(public.activate_blueprint_version($1,$2)) result',fields:['accountId','blueprintId']},
 archiveBlueprint:{sql:'select to_jsonb(public.set_blueprint_archived($1,$2,$3)) result',fields:['accountId','blueprintId','archived']},
 renameAccount:{sql:'select to_jsonb(public.rename_account($1,$2)) result',fields:['accountId','name']},
 archiveAccount:{sql:'select to_jsonb(public.set_account_archived($1,$2)) result',fields:['accountId','archived']},
 deleteAccount:{sql:'select to_jsonb(public.delete_account($1,$2)) result',fields:['accountId','confirmation']},
 createSeries:{sql:'select to_jsonb(public.create_series($1,$2,$3)) result',fields:['accountId','name','rules']},
 renameSeries:{sql:'select to_jsonb(public.rename_series($1,$2)) result',fields:['seriesId','name']},
 createSeriesVersion:{sql:'select to_jsonb(public.create_series_version($1,$2)) result',fields:['seriesId','rules']},
 createPromptVersion:{sql:'select to_jsonb(public.create_prompt_version($1,$2,$3,$4,$5)) result',fields:['accountId','capability','name','summary','instructions']},
} as const;
export async function executeConfiguration(pool:Pool,session:OwnerSession,body:Record<string,unknown>,mediaRoot:string,checkExternalReferences?: (client:PoolClient,refs:string[])=>Promise<void>){
 if(typeof body.command!=='string'||!Object.hasOwn(commands,body.command))throw new ConfigurationError(404,'配置命令不可用。');
 if(typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey))throw new ConfigurationError(400,'缺少操作标识。');
 if(!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new ConfigurationError(400,'配置内容无效。');
 const data=body.data as Record<string,unknown>,command=body.command as keyof typeof commands,definition=commands[command];
 const hash=createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
 for(const field of definition.fields){
  const value=data[field];
  if(field.endsWith('Id')||field==='accountId'){if(typeof value!=='string'||!uuid.test(value))throw new ConfigurationError(400,'引用无效。');}
  else if(field==='archived'){if(typeof value!=='boolean')throw new ConfigurationError(400,'归档选项无效。');}
  else if(field==='policy'){validatePolicySecrets(value);data.policy=creativeAccountRules(value as Record<string,unknown>);validateConfigurationPolicy(data.policy,true);}
  else if(field==='rules'){if(!value||typeof value!=='object'||Array.isArray(value))throw new ConfigurationError(400,'系列规则必须是对象。');validatePolicySecrets(value);}
  else if(typeof value!=='string'||value.length>100000)throw new ConfigurationError(400,'配置字段无效。');
 }
 if(command==='updateBlueprint'&&Object.keys(data).some(k=>!definition.fields.includes(k as never)))throw new ConfigurationError(400,'账号规则字段无效。');
 if(command==='createAccount'){try{new Intl.DateTimeFormat('en',{timeZone:String(data.timezone)});}catch{throw new ConfigurationError(400,'时区无效。');}}
 if(command==='createAccount'){if(data.assetRoot!==undefined&&data.assetRoot!=='')throw new ConfigurationError(400,'新账号会自动建立专属目录；历史目录请在账号资料的恢复与迁移中处理。');return createAccountDirectory(pool,session,String(body.idempotencyKey),hash,data,mediaRoot,checkExternalReferences,validateConfigurationPolicy(data.policy,!!checkExternalReferences));}
 if((command==='createSeries'||command==='renameSeries')&&Object.keys(data).some(k=>!definition.fields.includes(k as never)))throw new ConfigurationError(400,'系列资料字段无效。');
 if(command==='createSeries')return createStorageContainer(pool,session,String(body.idempotencyKey),hash,data,mediaRoot,'series');
 const result=await ownerTransaction(pool,session.id,false,async client=>{
  const valid=await client.query('SELECT token_hash FROM local_identity.sessions WHERE token_hash=$1 AND owner_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[tokenHash(session.token),session.id]);
  if(!valid.rowCount)throw new ConfigurationError(401,'会话已失效。');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':'+body.idempotencyKey]);
  const receipt=await client.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2',[session.id,body.idempotencyKey]);
  if(receipt.rowCount){if(receipt.rows[0].payload_hash!==hash)throw new ConfigurationError(409,'同一操作标识不能用于不同内容。');return receipt.rows[0].result;}
  if(data.accountId){
   const locked=await client.query('SELECT local_identity.lock_owned_account_row($1) owned',[data.accountId]);
   if(!locked.rows[0].owned)throw new ConfigurationError(404,'账号不可见。');
   const account=await client.query('SELECT a.current_blueprint_version_id,b.policy,md5(b.policy::text) revision FROM public.accounts a LEFT JOIN public.account_blueprint_versions b ON b.id=a.current_blueprint_version_id WHERE a.id=$1',[data.accountId]);
   if(!account.rowCount)throw new ConfigurationError(404,'账号不可见。');
   if(command==='updateBlueprint'&&body.expectedRevision!==account.rows[0].revision)throw new ConfigurationError(409,'蓝图已变化，请刷新后重试。');
  }
  // Capture exact roots before their blueprints are deleted; filesystem writes wait for COMMIT.
  if(command==='deleteAccount'){const operations=await accountDeletionOperations(client,String(data.accountId));if(operations.creationCount||operations.deletionCount)throw new ConfigurationError(409,'账号有未完成的目录创建或删除操作，请先恢复原操作。');}
  const registeredAccountRoot=command==='deleteAccount'?(await client.query('SELECT actual_root,device_id,inode_id FROM local_identity.account_asset_directories WHERE account_id=$1',[data.accountId])).rows[0]:undefined;
  const registeredContainers=command==='deleteAccount'?(await client.query('SELECT directory_relative_path,device_id,inode_id FROM local_identity.account_storage_containers WHERE account_id=$1',[data.accountId])).rows:[];
  const accountAssetRoots=command==='deleteAccount'?(await client.query("SELECT COALESCE(d.actual_root,b.policy->>'asset_root') asset_root FROM public.accounts a LEFT JOIN public.account_blueprint_versions b ON b.id=a.current_blueprint_version_id LEFT JOIN local_identity.account_asset_directories d ON d.account_id=a.id WHERE a.id=$1",[data.accountId])).rows.map(row=>row.asset_root):[];
  if(data.policy){
   const refs=validateConfigurationPolicy(data.policy,!!checkExternalReferences);if(refs.length)await checkExternalReferences!(client,refs);

  }
  const {rows:[row]}=await client.query(definition.sql,definition.fields.map(f=>data[f]));
  let value=row.result;
  if(command==='deleteAccount'){
   const candidates=[...await planRegisteredEmptyAccountDirectories(registeredAccountRoot,registeredContainers),...await planEmptyAccountDirectories(mediaRoot,accountAssetRoots,accountAssetRoots.some(root=>typeof root==='string'&&root)?await readMediaDeployment(client,mediaRoot):[])],emptyAccountDirectories:EmptyAccountDirectory[]=[];
   for(const target of candidates)if(!(await client.query('SELECT local_identity.account_directory_has_references($1::text[]) referenced',[target.aliases])).rows[0].referenced)emptyAccountDirectories.push(target);
   value={deletedAccountId:data.accountId,value:row.result,emptyAccountDirectories};
  }
  await client.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)',[session.id,body.idempotencyKey,hash,value]);
  return value;
 });
 // Keep the public boolean response and old receipts compatible. A replay only retries
 // originally empty directories with the same device/inode, never discovers new roots.
 if(command==='deleteAccount'&&result?.deletedAccountId===data.accountId&&Array.isArray(result.emptyAccountDirectories)){
  await ownerTransaction(pool,session.id,true,client=>cleanupEmptyAccountDirectories(result.emptyAccountDirectories as EmptyAccountDirectory[],async aliases=>(await client.query('SELECT local_identity.account_directory_has_references($1::text[]) referenced',[aliases])).rows[0].referenced)).catch(()=>{/* Account deletion committed; inaccessible directories remain intact for replay. */});
  return result.value;
 }
 return result;
}
