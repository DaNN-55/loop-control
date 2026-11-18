import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {recognizedScriptText,validateScriptRecognition,scriptFormatContractVersion} from '../scriptFormat.js';
import {ConfigurationError} from './configurationCommands.js';
import {reconfirmScript} from './scriptRevisionCommands.js';
import {snapshotInput} from './localFiles.js';
import {verifyEpisodeFile} from './episodeFiles.js';
/** The client confirms a receipted interpretation, never supplies trusted shot JSON. */
export async function confirmRecognizedScript(c:PoolClient,root:string,ownerId:string,e:{id:string;main_script_revision_id:string|null;stage:string;archived_at:string|null},data:Record<string,unknown>,directory:string){
 if(data.expectedScriptRevisionId!==e.main_script_revision_id||e.archived_at||e.stage==='production_completed')throw new ConfigurationError(409,'脚本基准或生产单状态已变化。');
 if(typeof data.recognitionRequestId!=='string'||!/^[a-f0-9-]{36}$/.test(data.recognitionRequestId)||typeof data.text!=='string'||typeof data.reason!=='string'||data.reason.length>4000)throw new ConfigurationError(400,'请确认有效的分镜识别结果。');
 const request=(await c.query('SELECT * FROM local_identity.script_format_requests WHERE owner_id=$1 AND id=$2 AND episode_id=$3',[ownerId,data.recognitionRequestId,e.id])).rows[0];
 if(!request||request.status!=='completed'||request.script_revision_id!==e.main_script_revision_id||request.source_text!==data.text||request.request_snapshot?.version!==scriptFormatContractVersion||!request.result?.recognition?.canRecognize)throw new ConfigurationError(409,'识别结果与当前原稿或基准不一致，请重新识别并确认。');
 const recognition=validateScriptRecognition(request.result.recognition,request.source_text),text=recognizedScriptText(recognition),sha=createHash('sha256').update(text).digest('hex');
 if((await c.query("SELECT 1 FROM public.tasks WHERE episode_id=$1 AND status='running' LIMIT 1",[e.id])).rowCount)throw new ConfigurationError(409,'制作任务正在运行，请完成或停止后确认新分镜。');
 let result:{id:string;[key:string]:unknown},alreadyStarted=false;
 if(e.main_script_revision_id){
  if(!data.reason.trim())throw new ConfigurationError(400,'请填写修订原因。');
  const old=(await c.query('SELECT * FROM public.production_material_revisions WHERE id=$1 AND episode_id=$2',[e.main_script_revision_id,e.id])).rows[0];
  if(old?.sha256===sha){await verifyEpisodeFile(c,root,e.id,old.storage_path,old.sha256,Number(old.file_size));result=old;alreadyStarted=e.stage!=='waiting_input';}
  else result=await reconfirmScript(c,root,e,{...data,text},directory);
 }else{
  const file=await snapshotInput(root,e.id,{sourceKind:'file',sourcePath:'recognized-script.md',isMainScript:true,contentBase64:Buffer.from(text).toString('base64')},directory);
  result=(await c.query("SELECT to_jsonb(public.import_production_material($1,'script','file',$2,$3,'text/markdown',$4,$5,true,'main_script')) result",[e.id,file.sourcePath,file.storagePath,file.sha256,file.fileSize])).rows[0].result;
 }
 await c.query('UPDATE local_identity.input_episodes SET script_template_version=3 WHERE episode_id=$1',[e.id]);
 await c.query('INSERT INTO local_identity.script_recognition_confirmations(owner_id,request_id,episode_id,script_revision_id,source_sha256,script_sha256) VALUES($1,$2,$3,$4,$5,$6)',[ownerId,request.id,e.id,result.id,createHash('sha256').update(request.source_text).digest('hex'),sha]);
 return {...result,alreadyStarted};
}
