import type {VideoVisualInputRole} from './videoVisualInputs.js';

export interface PromptReferenceBinding {token:string;materialRevisionId:string}
export interface PromptReferenceInput {materialRevisionId:string;kind:'image'|'video';name:string;role?:VideoVisualInputRole}
export function promptReferenceOptions(inputs:readonly PromptReferenceInput[],bindings:readonly PromptReferenceBinding[]=[]){
 const used=new Set(bindings.map(binding=>binding.token));
 return inputs.filter((input,index)=>inputs.findIndex(other=>other.materialRevisionId===input.materialRevisionId)===index).map(input=>{
  const existing=bindings.find(binding=>binding.materialRevisionId===input.materialRevisionId);
  let index=1,token=existing?.token;
  if(!token){const prefix=input.kind==='video'?'视频':'图片';while(used.has(`@${prefix}${index}`))index++;token=`@${prefix}${index}`;used.add(token);}
  return {...input,token};
 });
}

/** Resolve only explicitly bound mentions against the inputs frozen for this request. */
export function resolvePromptReferences(prompt:string,raw:unknown,inputs:readonly PromptReferenceInput[],context:{provider?:string;characterOrder?:boolean;referenceMode?:boolean}={}){
 if(raw!==undefined&&(!Array.isArray(raw)||raw.length>128||raw.some(binding=>!binding||typeof binding!=='object'||Object.keys(binding).some(key=>!['token','materialRevisionId'].includes(key))||typeof binding.token!=='string'||!/^@(图片|视频)[1-9]\d{0,3}$/.test(binding.token)||typeof binding.materialRevisionId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(binding.materialRevisionId))))throw Error('提示词素材引用无效，请重新插入。');
 const bindings=(raw??[]) as PromptReferenceBinding[];
 if(new Set(bindings.map(binding=>binding.token)).size!==bindings.length)throw Error('提示词素材引用重复，请重新插入。');
 return prompt.replace(/@(图片|视频)[1-9]\d*/g,token=>{
  const binding=bindings.find(binding=>binding.token===token),input=binding&&inputs.find(input=>input.materialRevisionId===binding.materialRevisionId);
  if(!input)throw Error(`${token} 对应的素材已移除或不适用于当前模式，请重新选择引用。`);
  if((token.startsWith('@视频')?'video':'image')!==input.kind)throw Error(`${token} 的素材类型不匹配。`);
  const index=inputs.filter(entry=>entry.kind===input.kind).findIndex(entry=>entry.materialRevisionId===input.materialRevisionId)+1;
  if(context.characterOrder)return `character${inputs.indexOf(input)+1}`;
  if(context.provider==='minimax'&&context.referenceMode)return `<${input.kind==='video'?'Video':'Picture'} ${index}>`;
  if(context.provider==='kling'&&context.referenceMode)return `<<<${input.kind==='video'?'video':'image'}_${index}>>>`;
  if(context.provider==='volcengine'&&context.referenceMode)return `${input.kind==='video'?'视频':'图片'}${index}`;
  if(input.role==='firstFrame')return '首帧图像';
  if(input.role==='lastFrame')return '尾帧图像';
  return input.kind==='video'?`第 ${index} 段参考视频`:`参考图 ${index}`;
 });
}
