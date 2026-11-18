import {useEffect,useRef,useState,type DragEvent} from 'react';
import {supportsLanguageModelAttachment} from '../languageModels';
import {mergeScriptStudioAttachments,scriptStudioAttachmentMimeForName,scriptStudioAttachmentIsImage,scriptStudioAttachmentIsText,scriptStudioReadAttachmentText,scriptStudioAttachmentRef,scriptStudioImageMime,scriptStudioAttachmentMaxFiles,scriptStudioAttachmentMaxBytes,type ScriptStudioAttachmentMaterial,type ScriptStudioAttachmentRef} from '../scriptStudioAttachments';
import {readWorkspaceUploadFile} from './workspaceUploads';
export interface ScriptStudioAttachmentUpload {episodeId:string;materialType:'image'|'reference';sourceKind:'file';sourcePath:string;mimeType:string;contentBase64:string;isMainScript:false;materialPurpose:'visual_reference'|'general_reference';scriptStudioAttachment:true}
interface Options {scope:string;episodeId:string;materials:readonly ScriptStudioAttachmentMaterial[];importMaterial:(data:ScriptStudioAttachmentUpload)=>Promise<ScriptStudioAttachmentMaterial>;disabled:boolean;supported:boolean;provider?:string;model?:string;restoredAttachments?:readonly ScriptStudioAttachmentRef[]}
const key=(scope:string)=>'loop-control.script-studio-attachments.v1:'+scope;
function read(scope:string){try{return mergeScriptStudioAttachments(JSON.parse(localStorage.getItem(key(scope))??'[]'));}catch{return[];}}
function materialRefs(materials:readonly ScriptStudioAttachmentMaterial[]){return materials.flatMap(material=>{try{return ['image','reference'].includes(material.material_type??'')?[scriptStudioAttachmentRef(material)]:[];}catch{return[];}});}
/** Draft references follow the conversation; files are registered through the existing Owner command. */
export function useScriptStudioAttachments(options:Options){
 const {scope,disabled,supported}=options;
 const [stored,setStored]=useState(()=>({scope,refs:read(scope)})),pending=stored.scope===scope?stored.refs:read(scope);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[dragging,setDragging]=useState(false);
 const current=useRef({...options,pending,active:true,locked:false});Object.assign(current.current,options,{pending});
 useEffect(()=>{current.current.active=true;return()=>{current.current.active=false;};},[]);
 useEffect(()=>{setStored({scope,refs:read(scope)});setError('');setDragging(false);},[scope]);
 function replace(refs:ScriptStudioAttachmentRef[],captured=scope){
  if(current.current.scope!==captured||!current.current.active)return;
  current.current.pending=refs;setStored({scope:captured,refs});
  try{if(refs.length)localStorage.setItem(key(captured),JSON.stringify(refs));else localStorage.removeItem(key(captured));}catch{setError('附件草稿暂无法保存，请保持页面打开。');}
 }
 function supports(mime:string){const value=current.current;return value.provider&&value.model?supportsLanguageModelAttachment(value.provider,value.model,mime):value.supported;}
 function unsupported(mime:string){return mime==='application/pdf'?'当前模型不支持本地PDF附件，请选择支持PDF的模型。':mime.startsWith('image/')?'当前模型不支持图片，请选择支持图片的模型。':'请先选择支持附件的模型。';}
 function allowed(){if(current.current.disabled||current.current.locked)return false;if(!current.current.supported){setError('请先选择支持附件的模型。');return false;}return true;}
 function append(ref:ScriptStudioAttachmentRef){
  if(!supports(ref.mimeType))throw Error(unsupported(ref.mimeType));
  const next=mergeScriptStudioAttachments(current.current.pending,[ref]);
  if(next.length>scriptStudioAttachmentMaxFiles)throw Error('每条消息最多附加4个附件。');
  mergeScriptStudioAttachments(current.current.restoredAttachments??[],next);replace(next);
 }
 function select(ref:ScriptStudioAttachmentRef){if(!allowed())return;try{append(ref);setError('');}catch(cause){setError((cause as Error).message);}}
 async function addFiles(files:FileList|readonly File[]){
  if(!allowed())return;const batch=Array.from(files);if(!batch.length)return;
  if(batch.length>scriptStudioAttachmentMaxFiles){setError('每次最多上传4个附件。');return;}
  const captured=scope,episodeId=current.current.episodeId,known=[...current.current.materials];current.current.locked=true;setBusy(true);setError('');
  try{for(const file of batch){
   if(!file.size||file.size>scriptStudioAttachmentMaxBytes)throw Error(file.name+'：附件不能为空，单个不超过10 MiB。');
   const mime=scriptStudioAttachmentMimeForName(file.name);if(!mime)throw Error(file.name+'：请选择图片、PDF、TXT、Markdown、CSV、JSON或DOCX。');
   if(!supports(mime))throw Error(unsupported(mime));
   const base64=await readWorkspaceUploadFile(file),bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
   if(scriptStudioAttachmentIsImage(mime)){
    if(scriptStudioImageMime(bytes)!==mime||file.type&&!['application/octet-stream',mime].includes(file.type))throw Error(file.name+'：图片真实类型与扩展名不一致。');
   }else if(scriptStudioAttachmentIsText(mime))scriptStudioReadAttachmentText(bytes,mime);
   else if(mime==='application/pdf'){
    const head=new TextDecoder('latin1').decode(bytes.subarray(0,16)),tail=new TextDecoder('latin1').decode(bytes.subarray(-1024));
    if(!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(head)||!/%%EOF\s*$/.test(tail))throw Error(file.name+'：PDF文件无效或未完整结束。');
   }else if(bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4)throw Error(file.name+'：DOCX文件内容与扩展名不一致。');
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
   if(!current.current.active||current.current.scope!==captured)return;
   let material=known.find(item=>item.material_type===(scriptStudioAttachmentIsImage(mime)?'image':'reference')&&item.sha256===hash&&Number(item.file_size)===file.size&&item.mime_type===mime);
   const existing=material&&scriptStudioAttachmentRef(material),preview:ScriptStudioAttachmentRef=existing??{materialRevisionId:crypto.randomUUID(),sha256:hash,mimeType:mime,fileSize:file.size,name:file.name};
   const proposed=mergeScriptStudioAttachments(current.current.pending,[preview]);if(proposed.length>scriptStudioAttachmentMaxFiles)throw Error('每条消息最多附加4个附件。');
   mergeScriptStudioAttachments(current.current.restoredAttachments??[],proposed);
   if(!material){material=await current.current.importMaterial({episodeId,materialType:scriptStudioAttachmentIsImage(mime)?'image':'reference',sourceKind:'file',sourcePath:file.name,mimeType:mime,contentBase64:base64,isMainScript:false,scriptStudioAttachment:true,materialPurpose:scriptStudioAttachmentIsImage(mime)?'visual_reference':'general_reference'});known.push(material);}
   const ref=scriptStudioAttachmentRef(material);if(ref.sha256!==hash||ref.mimeType!==mime||ref.fileSize!==file.size)throw Error('上传结果与所选附件不一致，请重新核对。');
   if(!current.current.active||current.current.scope!==captured)return;append(ref);
  }}catch(cause){if(current.current.active&&current.current.scope===captured)setError(cause instanceof Error?cause.message:'附件上传未完成，请重试。');}
  finally{current.current.locked=false;if(current.current.active)setBusy(false);}
 }
 function remove(materialRevisionId:string){if(current.current.disabled||current.current.locked)return;replace(current.current.pending.filter(ref=>ref.materialRevisionId!==materialRevisionId));setError('');}
 function acknowledge(submitted:readonly ScriptStudioAttachmentRef[]){setError('');replace(current.current.pending.filter(ref=>!submitted.some(sent=>sent.materialRevisionId===ref.materialRevisionId&&sent.sha256===ref.sha256)));}
 let sendError='';try{const all=mergeScriptStudioAttachments(options.restoredAttachments??[],pending);const incompatible=all.find(ref=>!supports(ref.mimeType));if(incompatible)sendError=unsupported(incompatible.mimeType);}catch(cause){sendError=(cause as Error).message;}
 function dragOver(event:DragEvent<HTMLElement>){if(!Array.from(event.dataTransfer.types??[]).includes('Files'))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=disabled||!supported?'none':'copy';setDragging(!disabled&&supported);}
 const dropHandlers={onDragOver:dragOver,onDragEnter:dragOver,onDragLeave(event:DragEvent<HTMLElement>){if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setDragging(false);},onDrop(event:DragEvent<HTMLElement>){if(!Array.from(event.dataTransfer.types??[]).includes('Files'))return;event.preventDefault();event.stopPropagation();setDragging(false);void addFiles(event.dataTransfer.files);}};
 return{scope,episodeId:options.episodeId,materials:options.materials,available:materialRefs(options.materials),pending,busy,error,sendError,dragging,disabled,supported,addFiles,select,remove,acknowledge,dropHandlers};
}
export type ScriptStudioAttachmentsState=ReturnType<typeof useScriptStudioAttachments>;
