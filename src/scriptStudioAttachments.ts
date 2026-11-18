/** Only small immutable references are persisted; file content exists during dispatch. */
export const scriptStudioAttachmentMaxFiles=4;
export const scriptStudioAttachmentMaxConversationFiles=16;
export const scriptStudioAttachmentMaxBytes=10*1024*1024;
export const scriptStudioAttachmentMaxTotalBytes=24*1024*1024;
export const scriptStudioAttachmentMaxTextCharacters=20000;
export const scriptStudioAttachmentMaxTotalTextCharacters=40000;
export const scriptStudioAttachmentMimes=['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/markdown','text/csv','application/json','application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export type ScriptStudioAttachmentMime=typeof scriptStudioAttachmentMimes[number];
export interface ScriptStudioAttachmentRef {materialRevisionId:string;sha256:string;mimeType:ScriptStudioAttachmentMime;fileSize:number;name:string}
export interface ScriptStudioImageInput extends ScriptStudioAttachmentRef {dataUrl:string}
export type ScriptStudioAttachmentInput=ScriptStudioAttachmentRef&({dataUrl:string;text?:never}|{text:string;dataUrl?:never});
export interface ScriptStudioAttachmentMaterial {id:string;storage_path:string;source_path:string;material_type?:string;mime_type?:string;file_size?:number|string;sha256?:string}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const extensions:Readonly<Record<string,ScriptStudioAttachmentMime>>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',txt:'text/plain',md:'text/markdown',markdown:'text/markdown',csv:'text/csv',json:'application/json',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
export function scriptStudioAttachmentMimeForName(name:string):ScriptStudioAttachmentMime|null{return extensions[name.split('.').pop()?.toLowerCase()??'']??null;}
export function scriptStudioAttachmentIsImage(mime:string){return mime==='image/png'||mime==='image/jpeg'||mime==='image/webp';}
export function scriptStudioAttachmentIsText(mime:string){return ['text/plain','text/markdown','text/csv','application/json'].includes(mime);}
export function scriptStudioImageMime(bytes:Uint8Array):ScriptStudioAttachmentMime|null{
 if([137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=12&&[82,73,70,70].every((value,index)=>bytes[index]===value)&&[87,69,66,80].every((value,index)=>bytes[index+8]===value))return 'image/webp';
 return null;
}
export function scriptStudioReadAttachmentText(bytes:Uint8Array,mime:string):string{
 if(!scriptStudioAttachmentIsText(mime))throw Error('附件文本类型无效。');
 if(bytes.byteLength>scriptStudioAttachmentMaxTextCharacters*4+3)throw Error('单份文档最多20000字符，请精简后重新上传。');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('文档必须使用UTF-8编码，请转换后重新上传。');}
 if(!text.trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw Error('文档缺少有效文本或包含二进制控制字符。');
 if(Array.from(text).length>scriptStudioAttachmentMaxTextCharacters)throw Error('单份文档最多20000字符，请精简后重新上传。');
 return text;
}
export function validateScriptStudioAttachmentRefs(value:unknown):ScriptStudioAttachmentRef[]{
 if(!Array.isArray(value)||value.length>scriptStudioAttachmentMaxConversationFiles)throw Error('每个对话最多引用16个附件，请新开对话。');
 const result:ScriptStudioAttachmentRef[]=[];
 for(const raw of value){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='fileSize,materialRevisionId,mimeType,name,sha256'||typeof raw.materialRevisionId!=='string'||!uuid.test(raw.materialRevisionId)||typeof raw.sha256!=='string'||!/^[a-f0-9]{64}$/.test(raw.sha256)||!scriptStudioAttachmentMimes.includes(raw.mimeType)||!Number.isSafeInteger(raw.fileSize)||raw.fileSize<=0||raw.fileSize>scriptStudioAttachmentMaxBytes||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>240||/[\x00-\x1f/\\]/.test(raw.name))throw Error('附件引用无效，支持图片、PDF、TXT、Markdown、CSV、JSON、DOCX，单个不超过10 MiB。');
  const ref=raw as ScriptStudioAttachmentRef;
  if(result.some(item=>item.materialRevisionId===ref.materialRevisionId))throw Error('附件不能重复。');
  result.push({...ref});
 }
 if(result.reduce((sum,ref)=>sum+ref.fileSize,0)>scriptStudioAttachmentMaxTotalBytes)throw Error('同一对话附件总大小不能超过24 MiB，请新开对话。');
 return result;
}
export function mergeScriptStudioAttachments(...groups:readonly (readonly unknown[])[]):ScriptStudioAttachmentRef[]{
 const combined:ScriptStudioAttachmentRef[]=[];
 for(const group of groups)for(const ref of validateScriptStudioAttachmentRefs(group)){
  const previous=combined.find(item=>item.materialRevisionId===ref.materialRevisionId);
  if(previous&&(previous.sha256!==ref.sha256||previous.mimeType!==ref.mimeType||previous.fileSize!==ref.fileSize||previous.name!==ref.name))throw Error('附件身份已变化，请重新选择。');
  if(!previous)combined.push(ref);
 }
 return validateScriptStudioAttachmentRefs(combined);
}
export function scriptStudioAttachmentRef(material:ScriptStudioAttachmentMaterial):ScriptStudioAttachmentRef{
 return validateScriptStudioAttachmentRefs([{materialRevisionId:material.id,sha256:material.sha256,mimeType:material.mime_type,fileSize:Number(material.file_size),name:material.source_path.split('/').pop()}])[0];
}
export function scriptStudioAttachmentUrl(episodeId:string,ref:ScriptStudioAttachmentRef,materials:readonly ScriptStudioAttachmentMaterial[]):string|undefined{
 const material=materials.find(item=>item.id===ref.materialRevisionId&&item.sha256===ref.sha256);
 return material?'/_local-artifact?'+new URLSearchParams({episode:episodeId,path:material.storage_path,sha256:ref.sha256}):undefined;
}
export function scriptStudioAttachmentInputRefs(inputs:readonly ScriptStudioAttachmentInput[]):ScriptStudioAttachmentRef[]{return validateScriptStudioAttachmentRefs(inputs.map(({dataUrl:_,text:__,...ref})=>ref));}
export function scriptStudioImageRefs(images:readonly ScriptStudioImageInput[]):ScriptStudioAttachmentRef[]{return scriptStudioAttachmentInputRefs(images);}
/** JSONB may reorder object keys. Acknowledgement compares immutable identities, not serialization. */
export function sameScriptStudioAttachments(a:readonly ScriptStudioAttachmentRef[],b:readonly ScriptStudioAttachmentRef[]):boolean{
 const fields=['materialRevisionId','sha256','mimeType','fileSize','name'] as const;
 return a.length===b.length&&a.every((ref,index)=>fields.every(field=>ref[field]===b[index][field]));
}
