import {defaultWanModel,wanVideoModel} from '../wanVideoModels.js';
import {ownedConnectionVersion} from '../worker/localConnection.js';
import type {PoolClient} from 'pg';
import {registeredAdapters,type ProductionCapability} from '../worker/registeredAdapters.js';
import type {ProductionSelection} from '../productionSelection.js';
import {ConfigurationError} from './configurationCommands.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Resolve all channels through the registered service facts; never consult blueprint tools. */
export async function resolveProductionSelection(c:PoolClient,value:unknown,capability:ProductionCapability){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ConfigurationError(400,'请选择本次制作服务。');
 const s=value as ProductionSelection;
 if(Object.keys(s).some(key=>!['capability','provider','adapter','model','preset','connectionVersionId'].includes(key)))throw new ConfigurationError(400,'本次制作选择包含不支持的字段。');
 if(s.capability!==capability||typeof s.provider!=='string'||typeof s.adapter!=='string'||s.model!==undefined&&typeof s.model!=='string'||s.preset!==undefined&&typeof s.preset!=='string')throw new ConfigurationError(400,'本次制作选择无效。');
 const choice=registeredAdapters.productionChoices().find(x=>x.capability===capability&&x.provider===s.provider&&x.adapter===s.adapter);
 if(!choice||s.model!==undefined&&!choice.models.includes(s.model)||choice.mode==='generation'&&!s.model||s.preset!==undefined&&!choice.presets.includes(s.preset)||choice.mode==='search'&&s.model!==undefined)throw new ConfigurationError(400,'所选服务不支持该模型或预设。');
 let connection:{id:string;connection_id:string;name:string;version:number}|undefined;
 if(choice.connection.kind==='owner_managed'){
  if(typeof s.connectionVersionId!=='string'||!uuid.test(s.connectionVersionId))throw new ConfigurationError(400,'请选择有效连接版本。');
  const initial=await ownedConnectionVersion(c,s.connectionVersionId);
  if(initial)await c.query('SELECT local_identity.lock_owned_connection($1)',[initial.connection_id]);
  const owned=await ownedConnectionVersion(c,s.connectionVersionId);
  const verified=(await c.query("SELECT public.connection_version_is_verified($1) AND EXISTS(SELECT 1 FROM local_identity.connection_probe_evidence WHERE version_id=$1 AND mode='live' AND outcome='verified') allowed",[s.connectionVersionId])).rows[0]?.allowed;
  if(!owned||owned.revoked_at||!owned.is_current||owned.provider!==s.provider||owned.adapter!==s.adapter||owned.store_mode!=='keychain'||!owned.secret_ref||!verified)throw new ConfigurationError(409,'所选连接不可用、无权使用或尚未验证。');
  const preference=(await c.query('SELECT enabled_models FROM local_identity.connection_model_settings WHERE connection_id=$1',[owned.connection_id])).rows[0];
  if(s.model&&(preference?!preference.enabled_models.includes(s.model):s.provider==='bailian'&&s.model!==defaultWanModel))throw new ConfigurationError(409,'该连接尚未启用或已停用此模型，请读取模型并启用后重新选择。');
  const metadata=(await c.query('SELECT v.version,c.name FROM public.list_external_connection_versions(NULL) v JOIN public.external_connections c ON c.id=v.connection_id WHERE v.id=$1',[owned.id])).rows[0];
  connection={id:owned.id,connection_id:owned.connection_id,name:metadata.name,version:metadata.version};
 }else if(s.connectionVersionId!==undefined)throw new ConfigurationError(400,'本地服务不使用外部连接。');
 const selection:ProductionSelection={capability,provider:choice.provider,adapter:choice.adapter,...(s.model?{model:s.model}:{}),...(s.preset?{preset:s.preset}:{}),...(connection?{connectionVersionId:connection.id}:{})};
 const profile=s.provider==='bailian'&&s.model?wanVideoModel(s.model):undefined;
 const selectedChoice=profile?{...choice,constraints:{...choice.constraints,durationSeconds:{min:profile.durations[0],max:profile.durations.at(-1)!,integer:true},resolutions:profile.resolutions,firstFrame:{...choice.constraints.firstFrame!,maxBytes:profile.maxBytes}}}:choice;
 return {choice:selectedChoice,selection,connection,execution:{execution_path:choice.executionPath,...(connection?{credential_ref:connection.id}:{}),executor:{provider:choice.provider,adapter:choice.adapter,...(s.model?{model:s.model}:{}),...(s.preset?{preset:s.preset}:{}),prompt_version:'production-request-v1'}}};
}
