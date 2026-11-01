import {wanVideoModel,wanUnsupportedReason} from '../wanVideoModels.js';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {OwnerSession} from './sessions.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import {ConfigurationError} from './configurationCommands.js';
import type {SecretStore} from './connectionPorts.js';
import {ownedConnectionVersion} from '../worker/localConnection.js';
import {defaultConnectionModels,modelDiscoveryAvailability,registeredConnectionModels,type ConnectionModelSettings} from '../connections/connectionModels.js';
import type {ProviderModelsReader} from './providerModels.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function current(c:PoolClient,connectionId:string){
 const connection=(await c.query('SELECT current_version_id FROM public.external_connections WHERE id=$1',[connectionId])).rows[0];
 if(!connection)throw new ConfigurationError(404,'连接不可见。');
 const version=await ownedConnectionVersion(c,connection.current_version_id);
 if(!version||version.revoked_at||!version.is_current)throw new ConfigurationError(409,'当前连接版本不可用。');
 const models=registeredConnectionModels(version.provider,version.adapter);
 if(!models.length)throw new ConfigurationError(400,'此服务不需要模型设置。');
 return {version,models};
}
async function read(c:PoolClient,connectionId:string):Promise<ConnectionModelSettings>{
 const {version,models}=await current(c,connectionId);
 const saved=(await c.query('SELECT * FROM local_identity.connection_model_settings WHERE connection_id=$1',[connectionId])).rows[0];
 const defaults=defaultConnectionModels(version.provider,version.adapter),enabled=saved?.enabled_models??defaults.map(m=>m.id);
 const discovered=saved?.discovery_version_id===version.id?saved.discovered_models as string[]:[];
 const visible=version.provider==='bailian'?models.filter(m=>defaults.some(d=>d.id===m.id)||enabled.includes(m.id)||discovered.includes(m.id)):models;
 return{connectionId,versionId:version.id,revision:saved?.revision??'default',enabledModels:enabled,models:visible.map(m=>({...m,listed:discovered.includes(m.id)})),discovery:modelDiscoveryAvailability(version.provider)};
}
export class LocalConnectionModels{
 constructor(private pool:Pool,private store:SecretStore,private reader:ProviderModelsReader,private available:(provider:string)=>boolean){}
 read(ownerId:string,connectionId:string){return ownerTransaction(this.pool,ownerId,true,c=>read(c,connectionId));}
 async command(session:OwnerSession,body:Record<string,unknown>){
  if(!['sync','save'].includes(String(body.command))||Object.keys(body).some(k=>!['command','data','idempotencyKey'].includes(k))||typeof body.idempotencyKey!=='string'||!uuid.test(body.idempotencyKey)||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new ConfigurationError(400,'模型设置请求无效。');
  const data=body.data as Record<string,unknown>,save=body.command==='save';
  if(Object.keys(data).some(k=>!(save?['connectionId','versionId','revision','enabledModels']:['connectionId','versionId']).includes(k))||typeof data.connectionId!=='string'||!uuid.test(data.connectionId)||typeof data.versionId!=='string'||!uuid.test(data.versionId)||save&&(typeof data.revision!=='string'||data.revision!=='default'&&!uuid.test(data.revision)||!Array.isArray(data.enabledModels)||data.enabledModels.length>256||data.enabledModels.some(id=>typeof id!=='string'||id.length>200)))throw new ConfigurationError(400,'模型设置内容无效。');
  const connectionId=data.connectionId,versionId=data.versionId;
  const assertVersion=(actual:string)=>{if(actual!==versionId)throw new ConfigurationError(409,'连接版本已变化，请重新打开模型设置。');};
  if(save)return sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT local_identity.lock_owned_connection($1)',[connectionId]);
   const settings=await read(c,connectionId);assertVersion(settings.versionId);
   const enabled=[...new Set(data.enabledModels as string[])].sort();
   if(enabled.some(id=>!settings.models.some(m=>m.id===id&&m.adapted)))throw new ConfigurationError(400,'只能启用本平台已适配的模型。');
   // Retried identical saves are safe even after the response was lost.
   if(settings.revision!==data.revision){if(JSON.stringify([...settings.enabledModels].sort())===JSON.stringify(enabled))return settings;throw new ConfigurationError(409,'模型设置已被修改，请重新打开后保存。');}
   await c.query('INSERT INTO local_identity.connection_model_settings(connection_id,owner_id,enabled_models,revision) VALUES($1,$2,$3,$4) ON CONFLICT(connection_id) DO UPDATE SET enabled_models=excluded.enabled_models,revision=excluded.revision,updated_at=clock_timestamp()',[connectionId,session.id,enabled,randomUUID()]);
   return read(c,connectionId);
  });
  const {version}=await sessionTransaction(this.pool,session,async c=>{const result=await current(c,connectionId);assertVersion(result.version.id);return result;});
  if(!modelDiscoveryAvailability(version.provider).supported)throw new ConfigurationError(400,'当前服务没有可用的公开模型目录。');
  if(!this.available(version.provider))throw new ConfigurationError(503,'当前网络策略不允许读取此供应商目录。');
  if(this.store.mode!=='keychain'||version.store_mode!=='keychain'||!version.secret_ref)throw new ConfigurationError(409,'本机密钥未绑定，未读取模型目录。');
  let discovered:Awaited<ReturnType<ProviderModelsReader>>;
  try{discovered=await this.reader({provider:version.provider,secret:await this.store.get(version.secret_ref)});}
  catch(error){throw new ConfigurationError(502,error instanceof Error&&/^(读取百炼目录需要|目录读取失败（HTTP|供应商模型|供应商没有|供应商目录|模型目录)/.test(error.message)?error.message:'模型目录读取失败，请检查连接或稍后重试。');}
  return sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT local_identity.lock_owned_connection($1)',[connectionId]);
   const settings=await read(c,connectionId);assertVersion(settings.versionId);
   const ids=new Set(discovered.map(m=>m.id));
   if(version.provider==='bailian'){
    const compatible=discovered.filter(m=>wanVideoModel(m.id)).map(m=>m.id);
    await c.query('INSERT INTO local_identity.connection_model_settings(connection_id,owner_id,enabled_models,revision,discovered_models,discovery_version_id,discovered_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) ON CONFLICT(connection_id) DO UPDATE SET discovered_models=excluded.discovered_models,discovery_version_id=excluded.discovery_version_id,discovered_at=excluded.discovered_at,revision=excluded.revision',[connectionId,session.id,settings.enabledModels,randomUUID(),compatible,version.id]);
    Object.assign(settings,await read(c,connectionId));
   }
   const adapted=settings.models;
   settings.models=[...adapted.map(m=>({...m,listed:ids.has(m.id)})),...discovered.filter(m=>!adapted.some(s=>s.id===m.id)).map(m=>({...m,adapted:false,listed:true,...(version.provider==='bailian'?{reason:wanUnsupportedReason(m.id,m.capability)}:{})}))];
   settings.discovery={supported:true,readAt:new Date().toISOString(),detail:`已读取 ${discovered.length} 个供应商模型。目录未列出的已支持模型仍保留；能否生成取决于服务权限和额度。`};return settings;
  });
 }
}
