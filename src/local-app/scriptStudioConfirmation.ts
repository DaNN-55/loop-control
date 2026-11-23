import {scriptStudioReceiptOptions} from '../scriptStudioLegacy.js';
import {parseProductionScript} from '../reviews/productionScript.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {scriptStudioContractVersion,scriptStudioMaxCharacters,localScriptStudioPlan,validateScriptStudioPlan,validateStudioDuration,scriptStudioText,type ScriptStudioPlan} from '../scriptStudio.js';
import {ownerTransaction} from './ownerTransaction.js';
import {ConfigurationError} from './configurationCommands.js';
import {reconfirmScript} from './scriptRevisionCommands.js';
import {snapshotInput} from './localFiles.js';
import {verifyEpisodeFile} from './episodeFiles.js';
import {resolveEpisodeAssetRoot} from './accountAssetRoots.js';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function readScriptStudio(pool:Pool,mediaRoot:string,ownerId:string,episodeId:string,revisionId:string){
 if(!uuid.test(episodeId)||!uuid.test(revisionId))throw new ConfigurationError(400,'脚本标识无效。');
 return ownerTransaction(pool,ownerId,true,c=>readScriptStudioInTransaction(c,mediaRoot,ownerId,episodeId,revisionId));
}
export async function readScriptStudioInTransaction(c:PoolClient,mediaRoot:string,ownerId:string,episodeId:string,revisionId:string){
  const source=(await c.query("SELECT s.* FROM public.production_material_revisions s JOIN public.episodes e ON e.id=s.episode_id JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=$3 AND m.role='owner' WHERE s.episode_id=$1 AND s.id=$2 AND s.is_main_script AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin r WHERE r.episode_id=e.id)",[episodeId,revisionId,ownerId])).rows[0];
  if(!source)throw new ConfigurationError(404,'当前脚本不可见。');
  const root=await resolveEpisodeAssetRoot(c,mediaRoot,episodeId),canonical=(await verifyEpisodeFile(c,root,episodeId,source.storage_path,source.sha256,Number(source.file_size))).toString('utf8');
  const saved=(await c.query('SELECT * FROM local_identity.script_studio_confirmations WHERE owner_id=$1 AND episode_id=$2 AND script_revision_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[ownerId,episodeId,revisionId])).rows[0];
  if(saved){if(saved.script_sha256!==source.sha256||saved.source_sha256!==sha(saved.source_text))throw new ConfigurationError(409,'原文与制作基准指纹不一致，请保留草稿后核对。');return{sourceText:saved.source_text,targetDuration:saved.target_duration===null?null:Number(saved.target_duration),plan:saved.plan as ScriptStudioPlan};}
  const old=(await c.query('SELECT r.source_text FROM local_identity.script_recognition_confirmations x JOIN local_identity.script_format_requests r ON r.owner_id=x.owner_id AND r.id=x.request_id WHERE x.owner_id=$1 AND x.episode_id=$2 AND x.script_revision_id=$3 ORDER BY x.created_at DESC LIMIT 1',[ownerId,episodeId,revisionId])).rows[0];
  const sourceText=old?.source_text??canonical;
  return{sourceText,targetDuration:null,...(Array.from(sourceText).length<=scriptStudioMaxCharacters?{plan:localScriptStudioPlan(sourceText,null)}:{})};
}
export function scriptStudioLocalConfirmationPlan(text:string,targetDuration:number|null){
 try{return validateScriptStudioPlan(localScriptStudioPlan(text,targetDuration),text,{targetDuration,mode:'optimize'});}
 catch(error){throw new ConfigurationError(400,(error as Error).message);}
}
export async function scriptStudioReceiptPlan(c:PoolClient,ownerId:string,episodeId:string,revisionId:string|null,text:string,targetDuration:number|null,requestId:string){
 const request=(await c.query('SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND id=$2 AND episode_id=$3',[ownerId,requestId,episodeId])).rows[0];
 if(!request||request.status!=='completed'||request.script_revision_id!==revisionId||request.source_text!==text||request.request_snapshot?.version!==scriptStudioContractVersion||request.request_snapshot?.data?.targetDuration!==targetDuration||!request.result?.plan)throw new ConfigurationError(409,'方案与当前原文、时长或基准不一致，请重新优化并审批。');
 try{return validateScriptStudioPlan(request.result.plan,text,scriptStudioReceiptOptions(request.request_snapshot.data));}catch(error){throw new ConfigurationError(400,(error as Error).message);}
}
/** Confirmation only accepts an original and a receipt identity, never client-provided plan JSON. */
export async function confirmScriptStudio(c:PoolClient,root:string,ownerId:string,e:{id:string;main_script_revision_id:string|null;stage:string;archived_at:string|null},data:Record<string,unknown>,directory:string){
 if(data.expectedScriptRevisionId!==e.main_script_revision_id||e.archived_at||e.stage==='production_completed')throw new ConfigurationError(409,'脚本基准或生产单状态已变化。');
 if(typeof data.text!=='string'||!data.text.trim()||Array.from(data.text).length>scriptStudioMaxCharacters||typeof data.reason!=='string'||data.reason.length>4000||data.requestId!==undefined&&(typeof data.requestId!=='string'||!uuid.test(data.requestId)))throw new ConfigurationError(400,'请提供有效原文和当前方案，最多支持 20000 字符。');
 try{validateStudioDuration(data.targetDuration);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
 const targetDuration=data.targetDuration as number|null;
 const plan=typeof data.requestId==='string'?await scriptStudioReceiptPlan(c,ownerId,e.id,e.main_script_revision_id,data.text,targetDuration,data.requestId):scriptStudioLocalConfirmationPlan(data.text,targetDuration);
 if(!plan.canProceed)throw new ConfigurationError(409,'当前方案尚有待确认问题，请先补充原文或调整要求。');
 if((await c.query("SELECT 1 FROM public.tasks WHERE episode_id=$1 AND status='running' LIMIT 1",[e.id])).rowCount)throw new ConfigurationError(409,'制作任务正在运行，请完成或停止后确认脚本。');
 let notes:string[]=[];try{notes=parseProductionScript(data.text)?.notes??[];}catch{}
 const text=scriptStudioText(plan)+'\n## 本期补充约束（可选）\n'+notes.map(note=>'- '+note+'\n').join('')+'- 制作备注：原文指纹 '+sha(data.text)+'\n',scriptSha=sha(text);
 let result:{id:string;[key:string]:unknown},alreadyStarted=false;
 if(e.main_script_revision_id){
  const old=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[e.main_script_revision_id,e.id])).rows[0];
  if(old?.sha256===scriptSha){await verifyEpisodeFile(c,root,e.id,old.storage_path,old.sha256,Number(old.file_size));result=old;alreadyStarted=e.stage!=='waiting_input';}
  else result=await reconfirmScript(c,root,e,{expectedScriptRevisionId:e.main_script_revision_id,text,reason:data.reason.trim()||(data.requestId?'采用已审批拍法方案':'更新主脚本原文与制作安排')},directory);
 }else{
  const file=await snapshotInput(root,e.id,{sourceKind:'file',sourcePath:'script-studio.md',isMainScript:true,contentBase64:Buffer.from(text).toString('base64')},directory);
  result=(await c.query("SELECT to_jsonb(public.import_production_material($1,'script','file',$2,$3,'text/markdown',$4,$5,true,'main_script')) result",[e.id,file.sourcePath,file.storagePath,file.sha256,file.fileSize])).rows[0].result;
 }
 await c.query('UPDATE local_identity.input_episodes SET script_template_version=3 WHERE episode_id=$1',[e.id]);
 await c.query('INSERT INTO local_identity.script_studio_confirmations(id,owner_id,episode_id,script_revision_id,request_id,source_text,source_sha256,script_sha256,target_duration,plan) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(owner_id,request_id) DO NOTHING',[randomUUID(),ownerId,e.id,result.id,data.requestId??null,data.text,sha(data.text),scriptSha,targetDuration,plan]);
 return{...result,alreadyStarted};
}
