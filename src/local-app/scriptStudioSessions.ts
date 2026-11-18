import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {scriptStudioContractVersion,type ScriptStudioConversationSession} from '../scriptStudio.js';
import type {StudioConversationScope} from './scriptStudioConversation.js';
import {ConfigurationError} from './configurationCommands.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sourceHash=(text:string)=>createHash('sha256').update(text).digest('hex');
const scopeValues=(owner:string,scope:StudioConversationScope)=>[owner,scope.episodeId,scope.expectedScriptRevisionId,sourceHash(scope.text),scope.targetDuration];
const scoped='owner_id=$1 AND episode_id=$2 AND script_revision_id IS NOT DISTINCT FROM $3::uuid AND source_sha256=$4 AND target_duration IS NOT DISTINCT FROM $5::numeric';
const receiptScoped="owner_id=$1 AND episode_id=$2 AND script_revision_id IS NOT DISTINCT FROM $3::uuid AND source_text=$4 AND request_snapshot->>'version'=$5 AND request_snapshot->'data'->'targetDuration'=$6::jsonb";
const receiptValues=(owner:string,scope:StudioConversationScope)=>[owner,scope.episodeId,scope.expectedScriptRevisionId,scope.text,scriptStudioContractVersion,JSON.stringify(scope.targetDuration)];
async function lockScope(c:PoolClient,owner:string,scope:StudioConversationScope){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['script-studio-conversation:'+JSON.stringify([owner,scope.episodeId,scope.expectedScriptRevisionId,scope.text,scope.targetDuration])]);}
/** A historical implicit chain is a virtual item; listing never rewrites its durable receipts. */
export async function listStudioConversations(c:PoolClient,owner:string,scope:StudioConversationScope):Promise<ScriptStudioConversationSession[]>{
 const explicit=(await c.query(`SELECT id,created_at FROM local_identity.script_studio_conversations WHERE ${scoped} ORDER BY created_at,id`,scopeValues(owner,scope))).rows;
 const legacy=(await c.query(`SELECT min(created_at) AS created_at FROM local_identity.script_format_requests WHERE ${receiptScoped} AND coalesce(request_snapshot->'data'->>'conversationId','')=''`,receiptValues(owner,scope))).rows[0];
 const values=[...explicit.map(row=>({id:row.id as string|null,createdAt:new Date(row.created_at).toISOString()})),...(legacy?.created_at?[{id:null,createdAt:new Date(legacy.created_at).toISOString()}]:[])];
 return values.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||(a.id??'').localeCompare(b.id??'')).map((value,index)=>({...value,number:index+1}));
}
export async function assertStudioConversation(c:PoolClient,owner:string,scope:StudioConversationScope):Promise<void>{
 if(scope.conversationId===undefined)return;
 if(!uuid.test(scope.conversationId)||(await c.query(`SELECT id FROM local_identity.script_studio_conversations WHERE ${scoped} AND id=$6`,[...scopeValues(owner,scope),scope.conversationId])).rows.length!==1)throw new ConfigurationError(409,'对话与当前原文、时长或脚本版本不一致。');
}
/** Uncertainty belongs to the complete source scope, so another conversation cannot bypass recovery. */
export async function assertNoUnresolvedStudioRequest(c:PoolClient,owner:string,scope:StudioConversationScope):Promise<void>{
 await lockScope(c,owner,scope);
 if((await c.query(`SELECT id FROM local_identity.script_format_requests WHERE ${receiptScoped} AND status IN ('prepared','dispatching','unknown') LIMIT 1`,receiptValues(owner,scope))).rows.length)throw new ConfigurationError(409,'当前脚本有处理中或结果未知的请求，请先核对，不能重复调用模型或新开对话。');
}
/** Caller owns the writable Owner/session transaction; the identifier is its idempotency key. */
export async function createStudioConversation(c:PoolClient,owner:string,scope:StudioConversationScope,id:string):Promise<ScriptStudioConversationSession>{
 if(!uuid.test(id))throw new ConfigurationError(400,'新对话标识无效。');
 await lockScope(c,owner,scope);
 const same=(await c.query(`SELECT id FROM local_identity.script_studio_conversations WHERE ${scoped} AND id=$6`,[...scopeValues(owner,scope),id])).rows[0];
 if(!same){
  await assertNoUnresolvedStudioRequest(c,owner,scope);
  const inserted=await c.query('INSERT INTO local_identity.script_studio_conversations(owner_id,episode_id,script_revision_id,source_sha256,target_duration,id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',[...scopeValues(owner,scope),id]);
  if(!inserted.rows.length)throw new ConfigurationError(409,'同一对话标识不能用于不同上下文。');
 }
 const item=(await listStudioConversations(c,owner,scope)).find(value=>value.id===id);
 if(!item)throw new ConfigurationError(409,'新对话尚未读取，请重新核对。');return item;
}
