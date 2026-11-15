import type {PoolClient} from 'pg';
import {basename} from 'node:path';
import type {ResolvedProductionPlan} from '../reviews/productionPlan.js';
import {ConfigurationError,canonicalFingerprint as productionHash} from './configurationCommands.js';

export interface ScriptEpisode {id:string;account_id:string;series_id?:string;series_version_id:string|null;main_script_revision_id:string|null;stage:string;policy:Record<string,unknown>;tts_voice?:string;tts_language_code?:string;tts_speaking_rate?:number}
export interface ScriptProductionRecord {episode_id:string;owner_id:string;script_sha256:string;script_revision_id:string;authorization_hash:string;enabled:boolean;plan:ResolvedProductionPlan;progress:Record<string,unknown>;last_status:string}
export {productionHash};
export function savedProductionPlanIdentity(episodeId:string,record:Pick<ScriptProductionRecord,'script_revision_id'|'script_sha256'|'plan'>){
 return{version:'legacy-production-plan/v1',episodeId,scriptRevisionId:record.script_revision_id,scriptSha256:record.script_sha256,plan:record.plan};
}
export class ScriptProductionStore {
 async read(c:PoolClient,episodeId:string){
  const e=(await c.query("SELECT e.id,e.main_script_revision_id FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner' WHERE e.id=$1",[episodeId])).rows[0] as Pick<ScriptEpisode,'id'|'main_script_revision_id'>|undefined;
  if(!e)throw new ConfigurationError(404,'本地生产单不可见。');
  // A historical read never resolves today's script, defaults or material pool.
  // The saved declaration is not proof that its host files are still available.
  const record=(await c.query('SELECT * FROM local_identity.script_productions WHERE episode_id=$1',[e.id])).rows[0] as ScriptProductionRecord|undefined;
  return{version:'legacy-production-plan/v1' as const,readOnly:true,sourceVerification:'not_checked' as const,
   v2:record?.plan.version===2,inspection:record?.plan??null,plan:record?.plan??null,enabled:false,
   savedEnabled:record?.enabled??false,savedAuthorizationHash:record?.authorization_hash??null,
   savedScriptRevisionId:record?.script_revision_id??null,savedScriptSha256:record?.script_sha256??null,
   currentScriptRevisionId:e.main_script_revision_id,scriptMatchesCurrent:record?record.script_revision_id===e.main_script_revision_id:null,
   planSha256:record?productionHash(savedProductionPlanIdentity(e.id,record)):null,
   status:record?'历史计划只读，请通过当前工作区继续制作。':'未保存旧制作计划'};
 }
 async alias(c:PoolClient,ownerId:string,materialId:string,name:string){
  await c.query('INSERT INTO local_identity.material_reference_names(material_id,owner_id,name) VALUES($1,$2,$3) ON CONFLICT(material_id) DO NOTHING',[materialId,ownerId,basename(name).replace(/\.(png|jpg|jpeg|webp|mp3|wav|m4a|aac|flac|ogg|mp4|mov|webm)$/i,'').normalize('NFC')]);
 }
}
