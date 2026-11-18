import type {PoolClient} from 'pg';
import {validateScriptStudioAttachmentRefs,scriptStudioImageMime,scriptStudioAttachmentIsImage,scriptStudioAttachmentIsText,scriptStudioAttachmentMimeForName,scriptStudioReadAttachmentText,scriptStudioAttachmentMaxTotalTextCharacters,type ScriptStudioAttachmentRef,type ScriptStudioAttachmentInput} from '../scriptStudioAttachments.js';
import {ConfigurationError} from './configurationCommands.js';
import {verifyEpisodeFile} from './episodeFiles.js';
import {resolveEpisodeStorageLocation} from './episodeStorageLocation.js';
import {validateImportedMaterial} from './materialAcceptance.js';
import {readScriptStudioDocx,validateScriptStudioPdf} from './scriptStudioDocuments.js';

/** Resolve only server-registered immutable attachments; client paths/URLs are never accepted. */
export async function resolveScriptStudioAttachments(c:PoolClient,mediaRoot:string,ownerId:string,episodeId:string,value:unknown):Promise<{attachments:ScriptStudioAttachmentRef[];inputs:ScriptStudioAttachmentInput[]}>{
 let attachments:ScriptStudioAttachmentRef[];try{attachments=validateScriptStudioAttachmentRefs(value);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
 if(!attachments.length)return{attachments:[],inputs:[]};
 const rows=(await c.query("SELECT m.* FROM public.production_material_revisions m JOIN public.episodes e ON e.id=m.episode_id JOIN public.account_memberships a ON a.account_id=e.account_id AND a.user_id=$2 AND a.role='owner' WHERE m.episode_id=$1 AND m.id=ANY($3::uuid[])",[episodeId,ownerId,attachments.map(ref=>ref.materialRevisionId)])).rows;
 if(rows.length!==attachments.length)throw new ConfigurationError(404,'附件不属于当前生产单或已不可见，请重新选择。');
 const location=await resolveEpisodeStorageLocation(c,mediaRoot,episodeId),inputs:ScriptStudioAttachmentInput[]=[];
 for(const ref of attachments){
  const row=rows.find(item=>item.id===ref.materialRevisionId);
  if(!row||row.material_type!==(scriptStudioAttachmentIsImage(ref.mimeType)?'image':'reference')||row.is_main_script||row.sha256!==ref.sha256||Number(row.file_size)!==ref.fileSize||row.mime_type!==ref.mimeType||row.source_path.split('/').pop()!==ref.name||scriptStudioAttachmentMimeForName(ref.name)!==ref.mimeType)throw new ConfigurationError(409,'附件身份或内容已变化，请重新选择。');
  const bytes=await verifyEpisodeFile(c,location.assetRoot,episodeId,row.storage_path,ref.sha256,ref.fileSize);
  if(scriptStudioAttachmentIsImage(ref.mimeType)){
   if(scriptStudioImageMime(bytes)!==ref.mimeType)throw new ConfigurationError(409,'图片附件的真实类型与登记类型不一致。');
   await validateImportedMaterial(bytes,{sourcePath:ref.name,materialType:'image',mimeType:ref.mimeType,materialPurpose:'visual_reference',isMainScript:false});
   inputs.push({...ref,dataUrl:'data:'+ref.mimeType+';base64,'+bytes.toString('base64')});
  }else try{
   if(ref.mimeType==='application/pdf'){validateScriptStudioPdf(bytes);inputs.push({...ref,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')});}
   else{const text=scriptStudioAttachmentIsText(ref.mimeType)?scriptStudioReadAttachmentText(bytes,ref.mimeType):readScriptStudioDocx(bytes);inputs.push({...ref,text});}
  }catch(error){throw new ConfigurationError(400,ref.name+'：'+(error as Error).message);}

 }
 if(inputs.reduce((count,item)=>count+(typeof item.text==='string'?Array.from(item.text).length:0),0)>scriptStudioAttachmentMaxTotalTextCharacters)throw new ConfigurationError(400,'同一对话文档文本总量不能超过40000字符，请新开对话。');
 return{attachments,inputs};
}
