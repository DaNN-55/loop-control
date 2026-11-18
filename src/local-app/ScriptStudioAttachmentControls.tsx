import {useEffect,useRef,useState} from 'react';
import {Paperclip,Upload,X,FileText,Image as ImageIcon} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
import {scriptStudioAttachmentUrl,scriptStudioAttachmentIsImage,type ScriptStudioAttachmentRef,type ScriptStudioAttachmentMaterial} from '../scriptStudioAttachments';
import type {ScriptStudioAttachmentsState} from './useScriptStudioAttachments';
import {ScriptStudioIcon,ScriptStudioPopup} from './ScriptStudioTools';
import './script-studio-attachments.css';
export function ScriptStudioAttachmentTrigger({state,disabled=false}:{state:ScriptStudioAttachmentsState;disabled?:boolean}){
 const [open,setOpen]=useState(false),input=useRef<HTMLInputElement>(null),blocked=disabled||state.disabled||state.busy||!state.supported;
 useEffect(()=>setOpen(false),[state.scope]);
 return <><input ref={input} className="script-studio-attachment-input" type="file" name="referenceAttachments" aria-label={uiText('上传附件')} accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.markdown,.csv,.json,.docx" multiple disabled={blocked} onChange={event=>{const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';setOpen(false);void state.addFiles(files);}}/>
  <ScriptStudioPopup label="附件" className="script-studio-attachments-popover" open={open} onOpenChange={setOpen} trigger={<ScriptStudioIcon label="附件" tip={state.supported?'上传图片或文档附件':'先选择模型，再上传附件'} icon={Paperclip} disabled={blocked} active={!!state.pending.length}/>}>
   {close=><div className="script-studio-attachment-picker" {...state.dropHandlers} onDrop={event=>{state.dropHandlers.onDrop(event);close();}}><button type="button" className="script-studio-attachment-upload" aria-label={uiText('选择附件文件')} disabled={blocked} onClick={()=>{close();input.current?.click();}}><Upload size={18} aria-hidden="true"/><strong>{uiText('上传附件')}</strong><span>{uiText('图片 / PDF / TXT / MD / CSV / JSON / DOCX')}</span><small>{uiText('最多4个，单个≤10 MiB；DOCX仅读取文字。')}</small></button></div>}
  </ScriptStudioPopup></>;
}
export function ScriptStudioAttachmentPreviews({episodeId,refs,materials,onRemove,disabled=false}:{episodeId:string;refs:readonly ScriptStudioAttachmentRef[];materials:readonly ScriptStudioAttachmentMaterial[];onRemove?:(materialRevisionId:string)=>void;disabled?:boolean}){
 if(!refs.length)return null;
 return <ul className="script-studio-attachment-previews" aria-label={uiText(onRemove?'待发送附件':'本轮附件')}>{refs.map(ref=>{const src=scriptStudioAttachmentUrl(episodeId,ref,materials),image=scriptStudioAttachmentIsImage(ref.mimeType),content=image&&src?<img src={src} alt={ref.name}/>:<span className="script-studio-attachment-missing" title={ref.name}>{image?<ImageIcon size={20} aria-hidden="true"/>:<FileText size={20} aria-hidden="true"/>}<span>{ref.name}</span></span>;return <li key={ref.materialRevisionId}>{src?<a href={src} target="_blank" rel="noreferrer" aria-label={uiText('查看附件 {value0}',{value0:ref.name})}>{content}</a>:content}{onRemove&&<Button type="button" size="xs" color="tertiary" className="script-studio-attachment-remove" aria-label={uiText('移除附件 {value0}',{value0:ref.name})} iconLeading={X} isDisabled={disabled} onPress={()=>onRemove(ref.materialRevisionId)}/>}</li>;})}</ul>;
}
