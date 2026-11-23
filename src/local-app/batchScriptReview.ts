import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {scriptStudioMaxCharacters,validateStudioDuration,type ScriptStudioPlan} from '../scriptStudio.js';
import type {ManualScriptReviewDraft as PendingSource} from '../episodes/episodeSnapshot.js';
import {canonicalFingerprint,ConfigurationError} from './configurationCommands.js';
import {buildImportedScriptStudioPlan,validateImportedScriptStudioPlan} from './episodeImportedScriptPlan.js';
import {readImportedScript} from './episodeBatchImport.js';
import {ownerTransaction} from './ownerTransaction.js';
import {readScriptStudioInTransaction,scriptStudioLocalConfirmationPlan,scriptStudioReceiptPlan} from './scriptStudioConfirmation.js';

export type ScriptReview =
 | {status:'ready';reviewFingerprint:string;sourceText:string;targetDuration:number|null;plan:ScriptStudioPlan;sourceName?:string}
 | {status:'skipped';reason:string};

type ReviewEpisode={id:string;title:string;stage:string;archived_at:string|null;main_script_revision_id:string|null};
type ReviewDraft=PendingSource&{importedVersion?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function readManualScriptReviewDraft(c:PoolClient,ownerId:string,episodeId:string):Promise<PendingSource|null>{
 const draft=(await c.query(`SELECT d.version,d.source_text,d.target_duration,d.reason,d.request_id
  FROM local_identity.manual_script_review_drafts d JOIN public.episodes e ON e.id=d.episode_id
  WHERE d.episode_id=$1 AND d.owner_id=$2 AND e.stage='waiting_input'
  AND e.archived_at IS NULL AND e.main_script_revision_id IS NULL AND NOT local_identity.is_recycled_episode(e.id)`,[episodeId,ownerId])).rows[0];
 return draft?{version:draft.version,sourceText:draft.source_text,targetDuration:draft.target_duration===null?null:Number(draft.target_duration),reason:draft.reason,requestId:draft.request_id??undefined}:null;
}
function pendingPlan(c:PoolClient,ownerId:string,episodeId:string,draft:Pick<PendingSource,'sourceText'|'targetDuration'|'requestId'>){
 return draft.requestId?scriptStudioReceiptPlan(c,ownerId,episodeId,null,draft.sourceText,draft.targetDuration,draft.requestId):scriptStudioLocalConfirmationPlan(draft.sourceText,draft.targetDuration);
}

export async function saveScriptReviewDraft(c:PoolClient,ownerId:string,episode:ReviewEpisode,data:Record<string,unknown>){
 if(episode.stage!=='waiting_input'||episode.archived_at||episode.main_script_revision_id)throw new ConfigurationError(409,'只有尚未确认脚本的生产单可保存待确认脚本。');
 if((await readImportedScript(c,ownerId,episode.id))?.shots.length)throw new ConfigurationError(409,'请核对 Excel 导入的分镜。');
 const {text,targetDuration,reason='',requestId}=data;
 if(typeof text!=='string'||!text.trim()||Array.from(text).length>scriptStudioMaxCharacters||typeof reason!=='string'||reason.length>4000||requestId!==undefined&&(typeof requestId!=='string'||!uuid.test(requestId)))throw new ConfigurationError(400,'请提供有效脚本正文与拍法，最多支持 20000 字符。');
 try{validateStudioDuration(targetDuration);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
 if(!(await pendingPlan(c,ownerId,episode.id,{sourceText:text,targetDuration,requestId})).canProceed)throw new ConfigurationError(409,'当前方案尚有待确认问题，请先补充原文或调整要求。');
 const draft=await readManualScriptReviewDraft(c,ownerId,episode.id);
 if(draft?.sourceText===text&&draft.targetDuration===targetDuration&&draft.reason===reason&&draft.requestId===requestId)return {id:episode.id,version:draft.version};
 const version=randomUUID();
 await c.query(`INSERT INTO local_identity.manual_script_review_drafts(episode_id,owner_id,version,source_text,target_duration,reason,request_id)
  VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (episode_id) DO UPDATE SET version=excluded.version,source_text=excluded.source_text,target_duration=excluded.target_duration,reason=excluded.reason,request_id=excluded.request_id`,
  [episode.id,ownerId,version,text,targetDuration,reason,requestId??null]);
 return {id:episode.id,version};
}

export async function resolveScriptReview(c:PoolClient,mediaRoot:string,ownerId:string,episode:ReviewEpisode):Promise<{review:ScriptReview;draft:ReviewDraft|null}>{
 if(episode.archived_at||episode.stage!=='waiting_input')return {review:{status:'skipped',reason:'生产单当前不在待脚本确认阶段。'},draft:null};
 const imported=episode.main_script_revision_id?null:await readImportedScript(c,ownerId,episode.id);
 const structured=imported?.shots.length?imported:null;
 const manual=episode.main_script_revision_id||structured?null:await readManualScriptReviewDraft(c,ownerId,episode.id);
 const draft:ReviewDraft|null=manual??(imported&&{sourceText:imported.sourceText,targetDuration:imported.targetDuration,version:imported.version,reason:'',...(structured?{importedVersion:structured.version}:{})});
 const source=episode.main_script_revision_id?await readScriptStudioInTransaction(c,mediaRoot,ownerId,episode.id,episode.main_script_revision_id)
  :draft&&{sourceText:draft.sourceText,targetDuration:draft.targetDuration,plan:structured?validateImportedScriptStudioPlan(buildImportedScriptStudioPlan(structured,episode.title)):await pendingPlan(c,ownerId,episode.id,draft)};
 if(!source?.plan?.canProceed)return {review:{status:'skipped',reason:'请先在生产单中保存可确认的脚本。'},draft:null};
 const {sourceText,targetDuration,plan}=source;
 const reviewFingerprint=canonicalFingerprint({episodeId:episode.id,revision:episode.main_script_revision_id,draftVersion:draft?.version,sourceText,targetDuration,plan});
 return {review:{status:'ready',reviewFingerprint,sourceText,targetDuration,plan,sourceName:imported?.sourceName},draft};
}

export async function readBatchScriptReview(pool:Pool,mediaRoot:string,ownerId:string,episodeId:string){
 return ownerTransaction(pool,ownerId,true,async c=>{
  const episode=(await c.query(`SELECT e.id,e.title,e.stage,e.archived_at,e.main_script_revision_id FROM public.episodes e
   JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=$2 AND m.role='owner'
   WHERE e.id=$1 AND NOT local_identity.is_recycled_episode(e.id)`,[episodeId,ownerId])).rows[0];
  if(!episode)throw new ConfigurationError(404,'生产单不可见。');
  return (await resolveScriptReview(c,mediaRoot,ownerId,episode)).review;
 });
}
